use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::client::conn::http1;
use hyper::header::HOST;
use hyper::Request;
use hyper_util::rt::TokioIo;
use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::status::Status;

const DOCKER_SOCKET_PATH: &str = "/var/run/docker.sock";

#[derive(Debug, PartialEq)]
pub enum DockerStreamBatchEvent {
    StreamFailed,
    StreamFinished,
    FlushAfterClose,
    FlushAfterTimeout,
    FlushAfterBytes,
    ReadIdle,
}

impl DockerStreamBatchEvent {
    pub fn to_str(&self) -> &'static str {
        match self {
            DockerStreamBatchEvent::StreamFailed => "StreamFailed",
            DockerStreamBatchEvent::StreamFinished => "StreamFinished",
            DockerStreamBatchEvent::FlushAfterClose => "FlushAfterClose",
            DockerStreamBatchEvent::FlushAfterTimeout => "FlushAfterTimeout",
            DockerStreamBatchEvent::FlushAfterBytes => "FlushAfterBytes",
            DockerStreamBatchEvent::ReadIdle => "ReadIdle",
        }
    }
}

#[derive(Debug)]
pub struct DockerStreamBatch {
    pub event: DockerStreamBatchEvent,
    pub body_chunks: Vec<Vec<u8>>,
    pub total_body_bytes: usize,
}

impl Default for DockerStreamBatch {
    fn default() -> Self {
        Self {
            event: DockerStreamBatchEvent::StreamFailed,
            body_chunks: Vec::new(),
            total_body_bytes: 0,
        }
    }
}

#[derive(Debug)]
enum DockerStreamEvent {
    BodyChunk(Vec<u8>),
    BodyEnd,
    BodyReadFailed(String),
    RequestFailed(String),
}

pub struct DockerStream {
    receiver: Mutex<tokio::sync::mpsc::Receiver<DockerStreamEvent>>,
}

#[derive(Default)]
pub struct DockerLogStreamManager {
    pub next_stream_id: AtomicUsize,
    pub streams: RwLock<HashMap<usize, Arc<DockerStream>>>,
}

impl DockerLogStreamManager {
    /// Start a stream that issues a request to the Docker Unix socket and
    /// forwards body chunks to in-memory queues for pull-based consumption.
    pub fn start_stream(self: &Arc<Self>, method: &'static str, path: String) -> Result<usize, Status> {
        let reg = self.clone();
        let stream_id = reg
            .next_stream_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        const STREAM_CAPACITY: usize = 32;
        let (sender, receiver) = tokio::sync::mpsc::channel(STREAM_CAPACITY);
        let entry = Arc::new(DockerStream {
            receiver: Mutex::new(receiver),
        });
        if let Ok(mut streams) = self.streams.write() {
            streams.insert(stream_id, entry.clone());
        }

        tokio::spawn(async move {
            let stream = match UnixStream::connect(DOCKER_SOCKET_PATH).await {
                Ok(s) => s,
                Err(e) => {
                    let _ = sender
                        .send(DockerStreamEvent::RequestFailed(format!("socket connect: {}", e)))
                        .await;
                    return;
                }
            };
            let io = TokioIo::new(stream);
            let (mut req_sender, conn) = match http1::handshake(io).await {
                Ok(x) => x,
                Err(e) => {
                    let _ = sender
                        .send(DockerStreamEvent::RequestFailed(format!("handshake: {}", e)))
                        .await;
                    return;
                }
            };
            tokio::spawn(async move {
                if let Err(e) = conn.await {
                    log::debug!("Docker stream connection closed: {}", e);
                }
            });

            let request = match Request::builder()
                .method(method)
                .uri(&path)
                .header(HOST, "docker")
                .body(Full::new(Bytes::new()))
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = sender
                        .send(DockerStreamEvent::RequestFailed(format!("build req: {}", e)))
                        .await;
                    return;
                }
            };

            let response = match req_sender.send_request(request).await {
                Ok(r) => r,
                Err(e) => {
                    let _ = sender
                        .send(DockerStreamEvent::RequestFailed(format!("send: {}", e)))
                        .await;
                    return;
                }
            };
            let mut body = response.into_body();
            loop {
                match body.frame().await {
                    Some(Ok(frame)) => {
                        if let Ok(data) = frame.into_data() {
                            let buf: Vec<u8> = data.to_vec();
                            if sender
                                .send(DockerStreamEvent::BodyChunk(buf))
                                .await
                                .is_err()
                            {
                                return;
                            }
                        }
                    }
                    Some(Err(e)) => {
                        let _ = sender
                            .send(DockerStreamEvent::BodyReadFailed(e.to_string()))
                            .await;
                        return;
                    }
                    None => {
                        let _ = sender.send(DockerStreamEvent::BodyEnd).await;
                        return;
                    }
                }
            }
        });

        Ok(stream_id)
    }

    pub async fn read_stream(
        self: &Arc<Self>,
        stream_id: usize,
        read_timeout: Duration,
        flush_batch_after: Duration,
        flush_batch_bytes: usize,
    ) -> Result<DockerStreamBatch, Status> {
        let started_at = Instant::now();

        let stream = if let Some(streams) = self.streams.read().unwrap().get(&stream_id) {
            streams.clone()
        } else {
            return Err(Status::DockerStreamIsUnknown { stream_id });
        };

        let mut receiver = stream.receiver.lock().await;
        let mut batch = DockerStreamBatch::default();

        loop {
            let elapsed = started_at.elapsed();
            let event = if batch.body_chunks.is_empty() {
                let recv_timeout = read_timeout.checked_sub(elapsed).unwrap_or_default();
                match timeout(recv_timeout, receiver.recv()).await {
                    Ok(Some(e)) => e,
                    Ok(None) => return Err(Status::DockerStreamClosed { stream_id }),
                    Err(_) => {
                        batch.event = DockerStreamBatchEvent::ReadIdle;
                        return Ok(batch);
                    }
                }
            } else {
                let recv_timeout = match flush_batch_after.checked_sub(elapsed) {
                    Some(t) => t,
                    None => {
                        batch.event = DockerStreamBatchEvent::FlushAfterTimeout;
                        return Ok(batch);
                    }
                };
                match timeout(recv_timeout, receiver.recv()).await {
                    Ok(Some(e)) => e,
                    Ok(None) => {
                        batch.event = DockerStreamBatchEvent::FlushAfterClose;
                        return Ok(batch);
                    }
                    Err(_) => {
                        batch.event = DockerStreamBatchEvent::FlushAfterTimeout;
                        return Ok(batch);
                    }
                }
            };

            match event {
                DockerStreamEvent::RequestFailed(e) => {
                    if let Ok(mut streams) = self.streams.write() {
                        streams.remove(&stream_id);
                    }
                    return Err(Status::DockerStreamFailed { stream_id, error: e });
                }
                DockerStreamEvent::BodyReadFailed(e) => {
                    if let Ok(mut streams) = self.streams.write() {
                        streams.remove(&stream_id);
                    }
                    return Err(Status::DockerStreamFailed { stream_id, error: e });
                }
                DockerStreamEvent::BodyEnd => {
                    if let Ok(mut streams) = self.streams.write() {
                        streams.remove(&stream_id);
                    }
                    batch.event = DockerStreamBatchEvent::StreamFinished;
                    return Ok(batch);
                }
                DockerStreamEvent::BodyChunk(m) => {
                    batch.total_body_bytes += m.len();
                    batch.body_chunks.push(m);
                    if batch.total_body_bytes > flush_batch_bytes {
                        batch.event = DockerStreamBatchEvent::FlushAfterBytes;
                        return Ok(batch);
                    }
                }
            }
        }
    }

    pub async fn destroy_stream(self: &Arc<Self>, stream_id: usize) {
        if let Ok(mut streams) = self.streams.write() {
            streams.remove(&stream_id);
        }
    }
}
