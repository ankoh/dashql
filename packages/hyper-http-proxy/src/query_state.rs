use std::sync::{Arc, RwLock};
use std::time::Duration;
use std::time::Instant;

use bytes::Bytes;
use tokio::sync::Notify;

use crate::status::{CompletionStatus, QueryStatus};

/// Per-query buffered state. One instance per active `queryId`.
///
/// A consumer task drains the gRPC server-stream into `chunks` and flips
/// `status` on each message. Handlers read snapshots and wait on
/// `change_notify` for wake-ups.
pub struct QueryState {
    pub query_id: String,
    pub expires_at: Instant,
    pub chunks: RwLock<Vec<Bytes>>,
    pub status: RwLock<QueryStatus>,
    /// Surfaces a terminal gRPC error to handlers so they can return an error
    /// response instead of silently serving a truncated stream.
    pub error: RwLock<Option<tonic::Status>>,
    pub change_notify: Notify,
    pub cancelled: RwLock<bool>,
}

impl QueryState {
    pub fn new(query_id: String, ttl: Duration) -> Self {
        Self {
            expires_at: Instant::now() + ttl,
            status: RwLock::new(QueryStatus::running(query_id.clone())),
            chunks: RwLock::new(Vec::new()),
            error: RwLock::new(None),
            change_notify: Notify::new(),
            cancelled: RwLock::new(false),
            query_id,
        }
    }

    pub fn snapshot_status(&self) -> QueryStatus {
        self.status.read().unwrap().clone()
    }

    pub fn snapshot_chunks(&self) -> Vec<Bytes> {
        self.chunks.read().unwrap().clone()
    }

    pub fn chunk_at(&self, idx: usize) -> Option<Bytes> {
        self.chunks.read().unwrap().get(idx).cloned()
    }

    pub fn chunk_count(&self) -> usize {
        self.chunks.read().unwrap().len()
    }

    pub fn is_terminal(&self) -> bool {
        self.status.read().unwrap().completion_status.is_terminal()
    }

    pub fn take_error(&self) -> Option<tonic::Status> {
        self.error.read().unwrap().clone()
    }

    pub fn append_chunk(&self, chunk: Bytes) {
        {
            let mut chunks = self.chunks.write().unwrap();
            chunks.push(chunk);
            let mut status = self.status.write().unwrap();
            status.chunk_count = Some(chunks.len() as u64);
        }
        self.change_notify.notify_waiters();
    }

    pub fn mark_finished(&self) {
        {
            let mut status = self.status.write().unwrap();
            status.completion_status = CompletionStatus::Finished;
            if status.chunk_count.is_none() {
                status.chunk_count = Some(self.chunks.read().unwrap().len() as u64);
            }
        }
        self.change_notify.notify_waiters();
    }

    pub fn mark_error(&self, err: tonic::Status) {
        {
            let mut guard = self.error.write().unwrap();
            *guard = Some(err);
            let mut status = self.status.write().unwrap();
            status.completion_status = CompletionStatus::Finished;
        }
        self.change_notify.notify_waiters();
    }

    pub fn request_cancel(&self) {
        *self.cancelled.write().unwrap() = true;
        self.change_notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        *self.cancelled.read().unwrap()
    }

    /// Wait for any state change or the deadline to elapse.
    /// Returns immediately if already terminal.
    pub async fn wait_for_change(self: &Arc<Self>, timeout: Duration) {
        if self.is_terminal() {
            return;
        }
        let notified = self.change_notify.notified();
        tokio::pin!(notified);
        let _ = tokio::time::timeout(timeout, &mut notified).await;
    }
}
