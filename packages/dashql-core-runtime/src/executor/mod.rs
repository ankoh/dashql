//! The query executor: a query is an async task on a host.
//!
//! The task runs a query on its connection and reports what happens as `QueryEvent`s, the host applies them to the
//! query history of the connection (`query::QueryExecutionHistory` of the Rust connection). It serves a result from the
//! query result cache or drives the connector: Trino over `TrinoQuery`, Hyper over its HTTP API with a
//! `HyperResultReader` (Salesforce Data Cloud too, with its bearer token), client functions with a
//! `ClientFunctionCallRun`, all over `HttpHost::fetch` and the timers of the host. A connection whose channel is an
//! object of the host (the gRPC channel of Hyper in the desktop app, the embedded Hyper, a channel of a test) stays a
//! channel of the host: the task asks the host to run the query and follows the metrics of its batches.
//!
//! A result never lives in the module, it passes through one page at a time where a protocol needs a conversion. The
//! chunks of Hyper over HTTP are parts of one Arrow IPC stream already, they go to the host as they arrive, unread and
//! mostly without entering the module (`ExecutorHost::fetch_result`). A page of Trino or of a client function becomes
//! the next part of an Arrow IPC stream and goes to the host right away (`QueryEvent::ResultData`). The batches of a
//! channel of the host stay with the host. Once the result is complete, the host builds its table from the parts
//! (`ExecutorHost::finish_result`).
//!
//! The task keeps the progress model of its query (`query::progress`): the progress payloads of the engine become
//! the structured progress of the query (its stages, the plan once it is known, their execution state), every
//! progress update carries it to the history.
//!
//! The host keeps what the runtime holds as JavaScript values: the result tables, the query result cache (Parquet
//! files of the embedded Hyper), the analysis of the results on the compute database and the relations that a
//! statement touches. The task decides when they happen.
//!
//! The caller owns the run of a query: it creates the cancellation token and hands it over with the request, and what
//! it keeps of the run (`QueryRequest::keep_alive`) lives as long as the task or a follow-up of it runs, e.g. the write
//! of the result into the cache after the query ended. Cancelling a query cancels its token: the requests of the query
//! stop, the query is cancelled at the backend (a Trino or Hyper query by its request, a channel of the host by the
//! host) and the task ends as cancelled.
//!
//! Ported from `QueryExecutorService` of `packages/dashql/src/runtime/connections/query_executor_service.ts`.

pub mod cache_key;
pub mod connectors;
pub mod ipc;
pub mod json;
mod wait;

use std::any::Any;
use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::rc::Rc;

use dashql_buffers::profile::ProfileLayoutConfig;

use crate::clfn::{ClientFunctionCallDescription, ClientFunctionError, ClientFunctionSpec};
use crate::connections::ConnectorType;
use crate::host::signal::{oneshot, Sender};
use crate::host::{HostError, LogLevel};
use crate::http::{Body, CancellationToken, Headers, HttpHost, HttpRequest, HttpResponse};
use crate::hyper::{HyperError, HyperHttpChannel};
use crate::query::{QueryExecutionMetrics, QueryExecutionProgress};
use crate::salesforce::SalesforceTokens;
use crate::trino::{NoTimeZones, SharedTrinoChannel, TimeZoneOffsets, TrinoAccessToken, TrinoError};
use wait::Controls;

/// The target of the log messages of the executor
pub const LOG_TARGET: &str = "query_executor";

/// The id of a query, the host allocates it
pub type QueryId = u64;

/// A value of the host, e.g. a JavaScript value in the module
pub type HostValue = Rc<dyn Any>;

/// How a query uses the query result cache
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheRequest {
    /// The key of the result
    pub key: String,
    /// Run the query on the backend instead of serving the cached result, and store the new result
    pub refresh: bool,
}

/// A client function call on a connection
#[derive(Debug, Clone)]
pub struct ClientFunctionTarget {
    /// The connector of the connection
    pub connector: ConnectorType,
    /// The spec of the client functions of the connector, none if it has none
    pub spec: Option<Rc<ClientFunctionSpec>>,
    /// The call as the core describes it
    pub description: ClientFunctionCallDescription,
    /// The tokens of a Salesforce connection, none without a channel
    pub tokens: Option<SalesforceTokens>,
}

/// Where a query runs
#[derive(Debug, Clone)]
pub enum QueryTarget {
    /// The channel of the connection is an object of the host, the host runs the query
    Host,
    /// The Trino channel of the connection, the queries of the connection share it with its access token
    Trino(SharedTrinoChannel),
    /// The HTTP API of a Hyper, the auth headers go with every request
    HyperHttp { channel: HyperHttpChannel, auth: Headers },
    /// A client function call, it sends its requests to the services of the spec
    ClientFunction(ClientFunctionTarget),
}

/// A query to run
pub struct QueryRequest {
    /// The id, the host registered the query in the history of the connection already
    pub query_id: QueryId,
    /// The connection
    pub connection_id: String,
    /// The text of the query
    pub text: String,
    /// Where the query runs
    pub target: QueryTarget,
    /// Collect the result? A statement whose output is discarded is drained without a table.
    pub publish_results: bool,
    /// Analyze the result on the compute database
    pub analyze_results: bool,
    /// The query result cache, none if the query doesn't use it
    pub cache: Option<CacheRequest>,
    /// Serve the cached result or fail, never run the query. A query without a cache fails.
    pub cache_only: bool,
    /// May the statement change the relations of the connection? The catalog loader then asks the connection.
    pub touches_relations: bool,
    /// Reject with the error of a failed query instead of resolving without a result
    pub throw_on_error: bool,
    /// Record the query as failed with this error instead of running it
    pub failure: Option<QueryFailure>,
    /// The details of the log messages of the query, e.g. the workbook
    pub log_details: Vec<(String, String)>,
    /// What the host keeps of the query, held until the task and its follow-ups ended: the write of the result into
    /// the cache and the touch of a cached entry run after the query and report into its history
    pub keep_alive: Option<HostValue>,
}

/// What kind of failure ended a query
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// The query failed
    Error,
    /// The query was cancelled
    Cancelled,
    /// A query that may only come from the cache missed it
    CacheMiss,
    /// The analysis of the result failed
    Processing,
}

/// The error of a failed or cancelled query
#[derive(Clone)]
pub struct QueryFailure {
    /// What kind of failure
    pub kind: FailureKind,
    /// The message
    pub message: String,
    /// The details for the log and the viewer of error details
    pub details: Vec<(String, String)>,
    /// The target of the error in the log
    pub target: String,
    /// What the host failed with, it goes back to the host unchanged
    pub value: Option<HostValue>,
}

impl std::fmt::Debug for QueryFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QueryFailure")
            .field("kind", &self.kind)
            .field("message", &self.message)
            .field("details", &self.details)
            .field("target", &self.target)
            .field("value", &self.value.is_some())
            .finish()
    }
}

impl QueryFailure {
    /// An error of the executor
    pub fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), details: Vec::new(), target: LOG_TARGET.to_string(), value: None }
    }

    /// The query was cancelled
    pub fn cancelled() -> Self {
        Self::new(FailureKind::Cancelled, "Query was cancelled")
    }

    /// A failed host call, it keeps what the host failed with
    pub fn from_host(error: &HostError) -> Self {
        Self {
            kind: FailureKind::Error,
            message: error.message().to_string(),
            details: Vec::new(),
            target: LOG_TARGET.to_string(),
            value: error.value().cloned(),
        }
    }

    /// The failure as another kind
    pub fn with_kind(mut self, kind: FailureKind) -> Self {
        self.kind = kind;
        self
    }
}

impl From<TrinoError> for QueryFailure {
    fn from(error: TrinoError) -> Self {
        Self {
            kind: FailureKind::Error,
            message: error.message,
            details: error.data.into_iter().collect(),
            target: "trino_channel".to_string(),
            value: None,
        }
    }
}

impl From<HyperError> for QueryFailure {
    fn from(error: HyperError) -> Self {
        Self {
            kind: FailureKind::Error,
            message: error.message(),
            details: error.key_values(),
            target: error.target().to_string(),
            value: None,
        }
    }
}

impl From<ClientFunctionError> for QueryFailure {
    fn from(error: ClientFunctionError) -> Self {
        let details = error.status.map(|status| vec![("status".to_string(), status.to_string())]).unwrap_or_default();
        Self { kind: FailureKind::Error, message: error.message, details, target: "clfn".to_string(), value: None }
    }
}

/// What happens to a query, in order. The host applies it to the history of the connection of the query.
pub enum QueryEvent {
    /// The query is sent to the backend
    Sending,
    /// The backend runs the query, its result streams
    Running,
    /// The backend reported progress, with the structured progress of the progress model of the query
    Progress(Box<QueryExecutionProgress>),
    /// The next part of the Arrow IPC stream of the result, in the order of the result. A message may span parts, a
    /// part may repeat the schema or hold an end-of-stream marker. The host holds the parts until `finish_result`.
    ResultData(Body),
    /// A batch of the result arrived, with the metrics of the stream so far
    ReceivedBatch(QueryExecutionMetrics),
    /// The result is complete, the host holds its table
    ReceivedAllBatches { rows: u64, metrics: QueryExecutionMetrics },
    /// The analysis of the result started
    ProcessingResults,
    /// The analysis of the result finished
    ProcessedResults,
    /// The query succeeded
    Succeeded,
    /// The query failed
    Failed { failure: QueryFailure, metrics: Option<QueryExecutionMetrics> },
    /// The query was cancelled
    Cancelled { failure: QueryFailure, metrics: Option<QueryExecutionMetrics> },
    /// The result is in the query result cache, served from it or written to it
    CacheRecorded { key: String, served_from_cache: bool, cached_at: Option<f64> },
    /// The statement may have changed relations of the connection
    TouchRelations,
    /// A step of the query took a time, `Results` until the result arrived and `Postprocess` for its analysis
    Timing { label: &'static str, elapsed_ms: f64 },
    /// The result arrived, before its analysis
    ResultsReady,
    /// A log message of the query
    Log { level: LogLevel, message: String, details: Vec<(String, String)>, target: String },
}

/// How a query ended for the caller
#[derive(Debug)]
pub enum QueryOutcome {
    /// The query ended, with or without a result. A failure without `throw_on_error` resolves without one.
    Resolved { has_result: bool },
    /// The query failed and the caller gets the error
    Rejected(QueryFailure),
}

/// An entry of the query result cache
#[derive(Debug, Clone, PartialEq)]
pub struct CacheEntry {
    /// The name of the file
    pub name: String,
    /// When the entry was written, in milliseconds since the epoch
    pub cached_at: f64,
}

/// A result table that the host holds: one it read from the cache or one it built from the parts of a stream
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct HostTable {
    pub rows: u64,
    pub columns: u64,
    /// The record batches, 0 if the host doesn't say
    pub batches: u64,
}

/// What a channel of the host reports while it streams a result. The batches stay with the host.
pub enum ChannelMessage {
    /// Progress of the backend, an engine payload of it goes into the progress model of the query
    Progress(Box<QueryExecutionProgress>),
    /// A batch arrived at the host, with the metrics of the stream so far
    Batch { metrics: QueryExecutionMetrics },
    /// The result is complete
    End { metrics: QueryExecutionMetrics },
}

/// What the executor asks of the host
pub trait ExecutorHost: HttpHost {
    /// Apply an event of a query to the history of its connection
    fn report(&self, query_id: QueryId, event: QueryEvent);

    /// Look up a result in the query result cache
    fn cache_lookup(&self, query_id: QueryId, key: &str) -> impl Future<Output = Result<Option<CacheEntry>, HostError>> + 'static;
    /// Read a cached result, the host holds it as the result of the query
    fn cache_read(&self, query_id: QueryId, entry: &CacheEntry) -> impl Future<Output = Result<HostTable, HostError>> + 'static;
    /// Record that a cached result was used, for the eviction
    fn cache_touch(&self, query_id: QueryId, entry: &CacheEntry) -> impl Future<Output = Result<(), HostError>> + 'static;
    /// Write the result of a query into the cache
    fn cache_write(&self, query_id: QueryId, key: &str) -> impl Future<Output = Result<(), HostError>> + 'static;

    /// Analyze the result of a query on the compute database. A cancellation of the token stops the analysis, the host
    /// keeps no analysis of a cancelled query and fails with the cancellation.
    fn analyze_result(&self, query_id: QueryId, cancellation: &CancellationToken) -> impl Future<Output = Result<(), HostError>> + 'static;

    /// Send a request whose response carries a part of a result. The body of a successful response may stay with the
    /// host (`HttpResponse::host_body`), the module passes it on unread.
    fn fetch_result(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.fetch(request, cancellation)
    }
    /// The result of a query streamed to its end: the host builds its table from the parts of the stream or from the
    /// batches of its channel and holds it as the result of the query.
    fn finish_result(&self, query_id: QueryId) -> impl Future<Output = Result<HostTable, HostError>> + 'static;

    /// Run a query on the channel of its connection, false if the channel returned no result
    fn channel_open(&self, query_id: QueryId) -> impl Future<Output = Result<bool, HostError>> + 'static;
    /// The next message of the result of a query on a channel
    fn channel_next(&self, query_id: QueryId) -> impl Future<Output = Result<ChannelMessage, HostError>> + 'static;
    /// Cancel the query of a channel at the backend
    fn channel_cancel(&self, query_id: QueryId) -> impl Future<Output = Result<(), HostError>> + 'static;
    /// Is the profile of the query shown? A channel fetches the plan and its statistics only then.
    fn channel_profile_detail(&self, query_id: QueryId, wanted: bool);

    /// The auth headers of the channel of a Hyper query over HTTP as they are now, asked before every round of requests
    /// of its result. None keeps the headers that the query started with.
    fn channel_auth(&self, _query_id: QueryId) -> impl Future<Output = Result<Option<Headers>, HostError>> + 'static {
        std::future::ready(Ok(None))
    }

    /// A shared Trino channel refreshed its OAuth access token, the connection that owns the channel keeps it
    fn trino_token_refreshed(&self, _channel: &SharedTrinoChannel, _token: &TrinoAccessToken) {}

    /// The offsets of named time zones, e.g. for the timestamps of Trino with a named zone. Without, such a timestamp
    /// is null.
    fn time_zones(&self) -> Rc<dyn TimeZoneOffsets> {
        Rc::new(NoTimeZones)
    }
}

/// A query that runs
struct Running {
    token: CancellationToken,
    controls: Controls,
    /// Was the query cancelled through the executor? The cancel of a channel of the host is sent once.
    cancel_sent: bool,
    /// The callers that wait for the end of the query
    waiters: Vec<Sender<()>>,
}

#[derive(Default)]
struct ExecutorState {
    running: HashMap<QueryId, Running>,
    /// The writes into the query result cache that run
    cache_writes: usize,
    /// The callers that wait for the cache writes
    cache_waiters: Vec<Sender<()>>,
    /// The layout of the plans of the progress of queries, none for the default one
    progress_layout: Option<ProfileLayoutConfig>,
}

/// Change the state of the executor when a guard drops. A guard that drops while the state is borrowed, e.g. a task
/// that is dropped within a call of the executor, changes it in a task of the host once the borrow ended.
fn update_later<H: ExecutorHost>(
    host: &Rc<H>,
    state: &Rc<RefCell<ExecutorState>>,
    update: impl FnOnce(&mut ExecutorState) -> Vec<Sender<()>> + 'static,
) {
    let waiters = match state.try_borrow_mut() {
        Ok(mut borrowed) => update(&mut borrowed),
        Err(_) => {
            let state = state.clone();
            host.spawn(Box::pin(async move {
                let waiters = update(&mut state.borrow_mut());
                for waiter in waiters {
                    waiter.send(());
                }
            }));
            return;
        }
    };
    for waiter in waiters {
        waiter.send(());
    }
}

/// Removes a query from the running ones when its task ends
struct RunningGuard<H: ExecutorHost> {
    host: Rc<H>,
    state: Rc<RefCell<ExecutorState>>,
    query_id: QueryId,
}

impl<H: ExecutorHost> Drop for RunningGuard<H> {
    fn drop(&mut self) {
        let query_id = self.query_id;
        update_later(&self.host, &self.state, move |state| {
            state.running.remove(&query_id).map(|running| running.waiters).unwrap_or_default()
        });
    }
}

/// Counts a write into the cache while it runs
struct CacheWriteGuard<H: ExecutorHost> {
    host: Rc<H>,
    state: Rc<RefCell<ExecutorState>>,
}

impl<H: ExecutorHost> Drop for CacheWriteGuard<H> {
    fn drop(&mut self) {
        update_later(&self.host, &self.state, |state| {
            state.cache_writes = state.cache_writes.saturating_sub(1);
            if state.cache_writes == 0 {
                std::mem::take(&mut state.cache_waiters)
            } else {
                Vec::new()
            }
        });
    }
}

/// Runs queries on connections. One executor serves every connection.
pub struct QueryExecutor<H: ExecutorHost> {
    host: Rc<H>,
    state: Rc<RefCell<ExecutorState>>,
}

impl<H: ExecutorHost> Clone for QueryExecutor<H> {
    fn clone(&self) -> Self {
        Self { host: self.host.clone(), state: self.state.clone() }
    }
}

impl<H: ExecutorHost> QueryExecutor<H> {
    pub fn new(host: Rc<H>) -> Self {
        Self { host, state: Rc::new(RefCell::new(ExecutorState::default())) }
    }

    /// The host
    pub fn host(&self) -> &Rc<H> {
        &self.host
    }

    /// Run a query with the token of its caller, a token that was cancelled before ends it as cancelled. It counts as
    /// running right away, the returned future runs it. The future settles once the query ended, a write of its result
    /// into the cache may still run.
    pub fn execute(&self, request: QueryRequest, token: CancellationToken) -> impl Future<Output = QueryOutcome> + 'static {
        let controls = Controls::default();
        let running = Running { token: token.clone(), controls: controls.clone(), cancel_sent: false, waiters: Vec::new() };
        self.state.borrow_mut().running.insert(request.query_id, running);
        let guard = RunningGuard { host: self.host.clone(), state: self.state.clone(), query_id: request.query_id };
        let task = QueryTask { host: self.host.clone(), state: self.state.clone(), token, controls, request };
        async move {
            let outcome = task.run().await;
            drop(guard);
            outcome
        }
    }

    /// The layout of the plans of the progress of the queries that start later, none for the default one
    pub fn set_progress_layout(&self, layout: Option<ProfileLayoutConfig>) {
        if let Ok(mut state) = self.state.try_borrow_mut() {
            state.progress_layout = layout;
        }
    }

    /// Is a query running?
    pub fn is_running(&self, query_id: QueryId) -> bool {
        self.state.borrow().running.contains_key(&query_id)
    }

    /// Cancel a query. The future settles once the query ended, at once for a query that doesn't run.
    pub fn cancel(&self, query_id: QueryId) -> impl Future<Output = ()> + 'static {
        let cancelled = {
            let mut state = self.state.borrow_mut();
            state.running.get_mut(&query_id).map(|running| {
                let first = !running.cancel_sent;
                running.cancel_sent = true;
                running.token.cancel();
                let (sender, receiver) = oneshot();
                running.waiters.push(sender);
                (receiver, first.then(|| running.controls.clone()))
            })
        };
        let receiver = cancelled.map(|(receiver, controls)| {
            // A channel of the host that streams is cancelled at the backend right away, the task waits for it
            if let Some(controls) = controls.filter(Controls::host_stream) {
                controls.set_backend_cancel(self.host.channel_cancel(query_id));
            }
            receiver
        });
        async move {
            if let Some(receiver) = receiver {
                receiver.await;
            }
        }
    }

    /// A view starts (`delta` 1) or stops (-1) showing the profile of a running query. A channel of the host that
    /// streams learns it right away.
    pub fn watch_profile(&self, query_id: QueryId, delta: i32) {
        let controls = self.state.borrow().running.get(&query_id).map(|running| running.controls.clone());
        let Some(controls) = controls else { return };
        if let Some(shown) = controls.watch_profile(delta) {
            self.host.channel_profile_detail(query_id, shown);
        }
    }

    /// Wait for the writes into the query result cache that run, e.g. before a process ends
    pub fn flush_cache_writes(&self) -> impl Future<Output = ()> + 'static {
        let receiver = {
            let mut state = self.state.borrow_mut();
            (state.cache_writes > 0).then(|| {
                let (sender, receiver) = oneshot();
                state.cache_waiters.push(sender);
                receiver
            })
        };
        async move {
            if let Some(receiver) = receiver {
                receiver.await;
            }
        }
    }
}

/// The task of a query
struct QueryTask<H: ExecutorHost> {
    host: Rc<H>,
    state: Rc<RefCell<ExecutorState>>,
    token: CancellationToken,
    controls: Controls,
    request: QueryRequest,
}

/// What the task knows of a result once it arrived
struct ResultSummary {
    /// Does the query have a result table?
    has_table: bool,
    /// Was it served from the cache?
    served_from_cache: bool,
}

impl<H: ExecutorHost> QueryTask<H> {
    fn report(&self, event: QueryEvent) {
        self.host.report(self.request.query_id, event);
    }

    /// Log a message of the query with the details of the query
    fn log(&self, level: LogLevel, message: &str, details: Vec<(String, String)>) {
        self.report(QueryEvent::Log { level, message: message.to_string(), details, target: LOG_TARGET.to_string() });
    }

    /// The details of the query for the log: the workbook and the id
    fn query_details(&self) -> Vec<(String, String)> {
        let mut details = self.request.log_details.clone();
        details.push(("query".to_string(), self.request.query_id.to_string()));
        details
    }

    async fn run(self) -> QueryOutcome {
        if self.token.is_cancelled() {
            let failure = QueryFailure::cancelled();
            self.report(QueryEvent::Cancelled { failure: failure.clone(), metrics: None });
            return QueryOutcome::Rejected(failure);
        }
        if let Some(failure) = self.request.failure.clone() {
            self.report(QueryEvent::Failed { failure: failure.clone(), metrics: None });
            return QueryOutcome::Rejected(failure);
        }
        let mut details = self.query_details();
        details.push(("text".to_string(), self.request.text.clone()));
        self.log(LogLevel::Info, "Executing query", details);

        let mut metrics: Option<QueryExecutionMetrics> = None;
        let summary = match self.fetch_result(&mut metrics).await {
            Ok(summary) => summary,
            Err(failure) => {
                if self.token.is_cancelled() || failure.kind == FailureKind::Cancelled {
                    self.log(LogLevel::Warn, "Cancelled query", self.query_details());
                    let failure = failure.with_kind(FailureKind::Cancelled);
                    self.report(QueryEvent::Cancelled { failure: failure.clone(), metrics });
                    self.touch_relations();
                    return self.fail(failure);
                }
                // The host logs the failure with what it failed with, the failed run shows the error inline
                self.report(QueryEvent::Failed { failure: failure.clone(), metrics });
                self.touch_relations();
                return self.fail(failure);
            }
        };
        if !summary.served_from_cache {
            self.touch_relations();
        }
        self.report(QueryEvent::ResultsReady);

        if summary.has_table && self.request.analyze_results {
            if let Err(failure) = self.analyze().await {
                if failure.kind == FailureKind::Cancelled {
                    self.log(LogLevel::Warn, "Cancelled query during result processing", self.query_details());
                    self.report(QueryEvent::Cancelled { failure: failure.clone(), metrics });
                    return self.fail(failure);
                }
                let mut details = self.query_details();
                details.push(("error".to_string(), failure.message.clone()));
                details.extend(failure.details.iter().cloned());
                self.log(LogLevel::Warn, "Query result processing failed", details);
                self.report(QueryEvent::Failed { failure: failure.clone(), metrics: None });
                return QueryOutcome::Rejected(failure);
            }
        }
        if summary.has_table && !summary.served_from_cache {
            self.store_in_cache();
        }
        self.report(QueryEvent::Succeeded);
        QueryOutcome::Resolved { has_result: summary.has_table }
    }

    /// The outcome of a failed query: its error, or no result
    fn fail(&self, failure: QueryFailure) -> QueryOutcome {
        if self.request.throw_on_error {
            QueryOutcome::Rejected(failure)
        } else {
            QueryOutcome::Resolved { has_result: false }
        }
    }

    /// The statement may have changed relations, the catalog loader asks the connection about them. Also after a
    /// failure: a statement of many may have run, and a cancelled one may have run all the same.
    fn touch_relations(&self) {
        if self.request.touches_relations && !self.request.cache_only {
            self.report(QueryEvent::TouchRelations);
        }
    }

    /// Serve the result from the cache or run the query
    async fn fetch_result(&self, metrics: &mut Option<QueryExecutionMetrics>) -> Result<ResultSummary, QueryFailure> {
        if let Some(summary) = self.serve_from_cache().await? {
            return Ok(summary);
        }
        if self.request.cache_only {
            return Err(QueryFailure::new(FailureKind::CacheMiss, "The query result is not cached"));
        }
        self.report(QueryEvent::Sending);
        let started_at = self.host.now();
        let progress_layout = self.state.try_borrow().ok().and_then(|state| state.progress_layout);
        let mut stream = connectors::StreamContext::new(
            self.host.clone(),
            self.request.query_id,
            self.token.clone(),
            self.controls.clone(),
            self.request.publish_results,
            self.request.log_details.clone(),
            progress_layout,
        );
        let end = connectors::run(&mut stream, &self.request.target, &self.request.text).await;
        *metrics = stream.metrics_if_started();
        let end = end?;
        self.report(QueryEvent::Timing { label: "Results", elapsed_ms: self.host.now() - started_at });
        let Some(end) = end else {
            self.log(LogLevel::Warn, "Query returned no results", self.query_details());
            return Ok(ResultSummary { has_table: false, served_from_cache: false });
        };
        let mut stream_metrics = end.metrics;
        let table = if self.request.publish_results {
            // The host builds the table from the parts it holds
            let table = self.host.finish_result(self.request.query_id).await;
            if self.token.is_cancelled() {
                return Err(QueryFailure::cancelled());
            }
            let table = table.map_err(|error| QueryFailure::from_host(&error))?;
            stream_metrics.total_rows_received = table.rows;
            stream_metrics.total_batches_received = table.batches;
            *metrics = Some(stream_metrics.clone());
            Some(table)
        } else {
            None
        };
        let mut details = self.query_details();
        if let Some(table) = &table {
            details.push(("numRows".to_string(), table.rows.to_string()));
            details.push(("numCols".to_string(), table.columns.to_string()));
        }
        details.push(("batchesReceived".to_string(), stream_metrics.total_batches_received.to_string()));
        details.push(("dataBytesReceived".to_string(), stream_metrics.total_data_bytes_received.to_string()));
        self.log(LogLevel::Info, "Executed query", details);
        let Some(table) = table else {
            return Ok(ResultSummary { has_table: false, served_from_cache: false });
        };
        self.report(QueryEvent::ReceivedAllBatches { rows: table.rows, metrics: stream_metrics });
        Ok(ResultSummary { has_table: true, served_from_cache: false })
    }

    /// Serve a cached result, none on a miss. A failed lookup or read is a miss.
    async fn serve_from_cache(&self) -> Result<Option<ResultSummary>, QueryFailure> {
        let Some(cache) = self.request.cache.as_ref().filter(|cache| !cache.refresh) else {
            return Ok(None);
        };
        let query_id = self.request.query_id;
        let entry = match self.host.cache_lookup(query_id, &cache.key).await {
            Ok(entry) => entry,
            Err(error) => {
                let mut details = vec![("query".to_string(), query_id.to_string())];
                details.push(("error".to_string(), error.message().to_string()));
                self.log(LogLevel::Warn, "Failed to read query cache", details);
                None
            }
        };
        // A cancel during the lookup behaves like any other cancel
        if self.token.is_cancelled() {
            return Err(QueryFailure::cancelled());
        }
        let Some(entry) = entry else { return Ok(None) };
        let table = match self.host.cache_read(query_id, &entry).await {
            Ok(table) => table,
            Err(error) => {
                let details = vec![("query".to_string(), query_id.to_string()), ("error".to_string(), error.message().to_string())];
                self.log(LogLevel::Warn, "Failed to read cached query result", details);
                return Ok(None);
            }
        };
        if self.token.is_cancelled() {
            return Err(QueryFailure::cancelled());
        }
        // The access counts for the eviction, a failure only makes the entry look colder. The touch holds the run, its
        // warning goes into the log of the query.
        let touch = self.host.cache_touch(query_id, &entry);
        let host = self.host.clone();
        let log_details = vec![("query".to_string(), query_id.to_string())];
        let keep_alive = self.request.keep_alive.clone();
        self.host.spawn(Box::pin(async move {
            let _keep_alive = keep_alive;
            if let Err(error) = touch.await {
                let mut details = log_details;
                details.push(("error".to_string(), error.message().to_string()));
                host.report(
                    query_id,
                    QueryEvent::Log {
                        level: LogLevel::Warn,
                        message: "Failed to record query cache access".to_string(),
                        details,
                        target: LOG_TARGET.to_string(),
                    },
                );
            }
        }));
        let mut details = self.query_details();
        details.push(("numRows".to_string(), table.rows.to_string()));
        details.push(("numCols".to_string(), table.columns.to_string()));
        details.push(("cachedAt".to_string(), crate::trino::time::iso_timestamp(entry.cached_at as i64)));
        self.log(LogLevel::Info, "Served query from cache", details);
        let metrics = QueryExecutionMetrics::default();
        self.report(QueryEvent::ReceivedAllBatches { rows: table.rows, metrics });
        self.report(QueryEvent::CacheRecorded {
            key: cache.key.clone(),
            served_from_cache: true,
            cached_at: Some(entry.cached_at),
        });
        Ok(Some(ResultSummary { has_table: true, served_from_cache: true }))
    }

    /// Analyze the result on the compute database. An analysis that ended stands, a cancel after it changes nothing.
    async fn analyze(&self) -> Result<(), QueryFailure> {
        self.report(QueryEvent::ProcessingResults);
        let started_at = self.host.now();
        let analyzed = self.host.analyze_result(self.request.query_id, &self.token).await;
        self.report(QueryEvent::Timing { label: "Postprocess", elapsed_ms: self.host.now() - started_at });
        match analyzed {
            Ok(()) => {}
            Err(_) if self.token.is_cancelled() => return Err(QueryFailure::cancelled()),
            Err(error) => return Err(QueryFailure::from_host(&error).with_kind(FailureKind::Processing)),
        }
        self.report(QueryEvent::ProcessedResults);
        Ok(())
    }

    /// Write the result into the cache after the query, the query doesn't wait for it. A failure only logs. The write
    /// holds the run, so the key and the warning reach the history of the query after the query ended.
    fn store_in_cache(&self) {
        let Some(cache) = self.request.cache.as_ref() else { return };
        let query_id = self.request.query_id;
        let key = cache.key.clone();
        let write = self.host.cache_write(query_id, &key);
        let host = self.host.clone();
        self.state.borrow_mut().cache_writes += 1;
        let guard = CacheWriteGuard { host: self.host.clone(), state: self.state.clone() };
        let keep_alive = self.request.keep_alive.clone();
        self.host.spawn(Box::pin(async move {
            let _keep_alive = keep_alive;
            match write.await {
                Ok(()) => host.report(query_id, QueryEvent::CacheRecorded { key, served_from_cache: false, cached_at: None }),
                Err(error) => host.report(
                    query_id,
                    QueryEvent::Log {
                        level: LogLevel::Warn,
                        message: "Failed to write query cache".to_string(),
                        details: vec![
                            ("query".to_string(), query_id.to_string()),
                            ("error".to_string(), error.message().to_string()),
                        ],
                        target: LOG_TARGET.to_string(),
                    },
                ),
            }
            drop(guard);
        }));
    }
}
