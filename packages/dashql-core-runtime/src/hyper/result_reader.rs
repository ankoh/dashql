//! The result of a query of the HTTP API of Hyper as a state machine.
//!
//! The query response holds the status of the query and, once the results are produced, the first chunk of the result.
//! The reader fetches the other chunks, up to a number of them in parallel, and passes them on in the order of the
//! result without reading them: the chunks are parts of one Arrow IPC stream, and the host builds the result from them.
//! The reader reads only the status of the query. While the query runs and no chunk is announced, it polls the status.
//! Every status, of a chunk or a poll, is merged into the status so far and reported as progress.
//!
//! The host drives the reader: `poll` returns the events so far, the requests to send and whether the result is read
//! to the end, `receive` takes the response of a request. The host sends the requests of one poll in parallel and
//! calls `poll` again after every response.
//!
//! Ported from `WebHyperResultReader` and `WebHyperDatabaseChannel` of
//! `packages/dashql-app/src/connections/hyper/platform/web_hyperdb_http_client.ts`.

use std::collections::VecDeque;

use super::client::{
    read_query_response, read_status_response, GetQueryChunkParams, GetQueryStatusParams, HyperHttpClient,
};
use super::error::HyperError;
use crate::http::{Body, Headers, HttpRequest, HttpResponse};
use super::status::QueryStatus;
use crate::query::{QueryExecutionMetrics, QueryExecutionProgress, Timestamp};

/// How long the server may wait for a new status when the reader polls
pub const CHUNK_POLL_DELAY_MS: u64 = 250;
/// The chunks that a reader fetches in parallel by default
pub const DEFAULT_PARALLEL_CHUNKS: usize = 4;

/// The id of a request of a reader
pub type RequestId = u64;

/// A request of a reader for the host
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderRequest {
    /// The id that the response comes back with
    pub id: RequestId,
    /// The request
    pub request: HttpRequest,
    /// Does a successful response carry a chunk of the result? The host may keep its body, the reader passes it on
    /// unread.
    pub chunk: bool,
}

/// What a reader reports
#[derive(Debug, Clone, PartialEq)]
pub enum ResultEvent {
    /// The status of the query changed
    Progress(QueryExecutionProgress),
    /// The next chunk of the result: a part of its Arrow IPC stream. A message may span chunks, a chunk may repeat
    /// the schema or end with an end-of-stream marker.
    Chunk(Body),
}

/// The outcome of a poll
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ReaderPoll {
    /// The events since the last poll, in order
    pub events: Vec<ResultEvent>,
    /// The requests to send
    pub requests: Vec<ReaderRequest>,
    /// Is the result read to the end?
    pub done: bool,
}

/// A chunk that is fetched
#[derive(Debug)]
struct ChunkSlot {
    request_id: RequestId,
    /// The body, once the response arrived
    body: Option<Body>,
}

/// The reader of the result of a query
#[derive(Debug)]
pub struct HyperResultReader {
    client: HyperHttpClient,
    query_id: String,
    /// The status so far
    status: QueryStatus,
    /// The chunks in flight at most
    parallel_chunks: usize,
    /// The index of the next chunk to fetch
    next_chunk: u64,
    /// Did a request or the query response ask for the schema already?
    schema_requested: bool,
    /// The chunks in flight, in the order of the result
    inflight: VecDeque<ChunkSlot>,
    /// The status poll in flight
    status_poll: Option<RequestId>,
    /// The id of the next request
    next_request_id: RequestId,
    /// The metrics of the response stream
    metrics: QueryExecutionMetrics,
    /// The events since the last poll
    events: Vec<ResultEvent>,
    /// Is the result read to the end?
    done: bool,
}

impl HyperResultReader {
    /// The reader of the result of a query response. The response must name its query in its status header. The body
    /// is the first chunk of the result if it isn't empty. The first event is the progress of the status.
    pub fn new(
        client: HyperHttpClient,
        mut response: HttpResponse,
        parallel_chunks: usize,
        now: Timestamp,
    ) -> Result<Self, HyperError> {
        let host_body = response.host_body.take();
        let response = read_query_response(response).map_err(|e| match e {
            HyperError::Http(error) => HyperError::from_http(error),
            other => other,
        })?;
        let status = response
            .status
            .filter(|status| !status.query_id.is_empty())
            .ok_or_else(|| HyperError::Protocol("v3 query response missing status header".to_string()))?;
        let initial = match host_body {
            Some(bytes) => Body::Host(bytes),
            None => Body::Bytes(response.body),
        };
        let mut reader = Self {
            client,
            query_id: status.query_id.clone(),
            status,
            parallel_chunks: parallel_chunks.max(1),
            next_chunk: if initial.is_empty() { 0 } else { 1 },
            schema_requested: !initial.is_empty(),
            inflight: VecDeque::new(),
            status_poll: None,
            next_request_id: 0,
            metrics: QueryExecutionMetrics::default(),
            events: Vec::new(),
            done: false,
        };
        reader.report_progress(now);
        reader.chunk(initial);
        Ok(reader)
    }

    /// The id of the query
    pub fn query_id(&self) -> &str {
        &self.query_id
    }

    /// The status so far
    pub fn status(&self) -> &QueryStatus {
        &self.status
    }

    /// The metrics of the response stream
    pub fn metrics(&self) -> &QueryExecutionMetrics {
        &self.metrics
    }

    /// The chunk requests in flight
    pub fn chunks_in_flight(&self) -> usize {
        self.inflight.len()
    }

    /// Is the result read to the end?
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// The request that cancels the query at the server
    pub fn cancel_request(&self, auth: &Headers) -> HttpRequest {
        self.client.cancel_query(&self.query_id, auth)
    }

    fn report_progress(&mut self, now: Timestamp) {
        self.events.push(ResultEvent::Progress(self.status.progress_update(&self.metrics, now)));
    }

    /// Pass a chunk on, an empty one is left out
    fn chunk(&mut self, body: Body) {
        if body.is_empty() {
            return;
        }
        self.metrics.total_data_bytes_received += body.len() as u64;
        self.events.push(ResultEvent::Chunk(body));
    }

    fn allocate_request_id(&mut self) -> RequestId {
        let id = self.next_request_id;
        self.next_request_id += 1;
        id
    }

    /// Fetch the announced chunks, up to the chunks in parallel
    fn fill_prefetch_window(&mut self, auth: &Headers, requests: &mut Vec<ReaderRequest>) {
        let chunk_count = self.status.chunks();
        while self.inflight.len() < self.parallel_chunks && self.next_chunk < chunk_count {
            let chunk_id = self.next_chunk;
            self.next_chunk += 1;
            let omit_schema = self.schema_requested;
            self.schema_requested = true;
            let id = self.allocate_request_id();
            let params = GetQueryChunkParams { query_id: self.query_id.clone(), chunk_id, omit_schema };
            let request = self.client.get_query_chunk(&params, None, auth);
            requests.push(ReaderRequest { id, request, chunk: true });
            self.inflight.push_back(ChunkSlot { request_id: id, body: None });
        }
    }

    /// Advance the reader: pass on the chunks that arrived in order, fetch the next chunks, poll the status of a query
    /// that runs without announced chunks. The auth headers go on the new requests.
    pub fn poll(&mut self, auth: &Headers) -> Result<ReaderPoll, HyperError> {
        let mut requests = Vec::new();
        if !self.done {
            // The chunks are passed on in the order of the result
            while let Some(body) = self.inflight.front_mut().and_then(|slot| slot.body.take()) {
                self.inflight.pop_front();
                self.fill_prefetch_window(auth, &mut requests);
                self.chunk(body);
            }
            self.fill_prefetch_window(auth, &mut requests);
            if self.inflight.is_empty() {
                if self.status.completion_status.is_completed() && self.next_chunk >= self.status.chunks() {
                    self.done = true;
                } else if self.status_poll.is_none() {
                    // No chunks yet and the query still runs
                    let id = self.allocate_request_id();
                    let params = GetQueryStatusParams {
                        query_id: self.query_id.clone(),
                        wait_time_ms: Some(CHUNK_POLL_DELAY_MS),
                    };
                    let request = self.client.get_query_status(&params, auth);
                    requests.push(ReaderRequest { id, request, chunk: false });
                    self.status_poll = Some(id);
                }
            }
        }
        Ok(ReaderPoll { events: std::mem::take(&mut self.events), requests, done: self.done })
    }

    /// Take the response of a request. A status updates the progress, the body of a chunk waits for the chunks
    /// before it. An error response of the server is a query error if the module recognizes the error.
    pub fn receive(&mut self, id: RequestId, mut response: HttpResponse, now: Timestamp) -> Result<(), HyperError> {
        let to_query_error = |e: HyperError| match e {
            HyperError::Http(error) => HyperError::from_http(error),
            other => other,
        };
        if self.status_poll == Some(id) {
            self.status_poll = None;
            let status = read_status_response(&response).map_err(to_query_error)?;
            self.status = self.status.merge(&status);
            self.report_progress(now);
            return Ok(());
        }
        let Some(index) = self.inflight.iter().position(|slot| slot.request_id == id && slot.body.is_none()) else {
            return Err(HyperError::Protocol(format!("a response to an unknown request {id}")));
        };
        let host_body = response.host_body.take();
        let response = read_query_response(response).map_err(to_query_error)?;
        if let Some(status) = response.status {
            self.status = self.status.merge(&status);
            self.report_progress(now);
        }
        if let Some(slot) = self.inflight.get_mut(index) {
            slot.body = Some(match host_body {
                Some(bytes) => Body::Host(bytes),
                None => Body::Bytes(response.body),
            });
        }
        Ok(())
    }
}
