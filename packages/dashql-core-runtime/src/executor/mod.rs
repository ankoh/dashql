//! The query executor: a query is an async task on a host.
//!
//! The task runs a query on its connection and reports what happens as `QueryEvent`s, the host applies them to the
//! query history of the connection (`query::QueryExecutionHistory` of the Rust connection). It serves a result from the
//! stored result of its script or drives the connector: Trino over `TrinoQuery`, Hyper over its HTTP API with a
//! `HyperResultReader` (Salesforce Data Cloud too, with its bearer token), both over `HttpHost::fetch` and the timers
//! of the host. A connection whose channel is an object of the host (the gRPC channel of Hyper in the desktop app, the embedded Hyper, a channel of a test) stays a
//! channel of the host: the task asks the host to run the query and follows the metrics of its batches.
//!
//! A result never lives in the module, it passes through one page at a time where a protocol needs a conversion. The
//! chunks of Hyper over HTTP are parts of one Arrow IPC stream already, they go to the host as they arrive, unread and
//! mostly without entering the module (`ExecutorHost::fetch_result`). A page of Trino becomes the next part of an
//! Arrow IPC stream and goes to the host right away (`ExecutorHost::push_result`). The batches of a
//! channel of the host stay with the host. Once the result is complete, the host builds its table from the parts
//! (`ExecutorHost::finish_result`).
//!
//! The task keeps the progress model of its query (`query::progress`): the progress payloads of the engine become
//! the structured progress of the query (its stages, the plan once it is known, their execution state), every
//! progress update carries it to the history.
//!
//! The host keeps what the runtime holds as JavaScript values: the result tables, the stored results of the scripts
//! (Parquet files of the workbooks that the embedded Hyper reads and writes), the analysis of the results on the compute database and the relations that a
//! statement touches. The task decides when they happen.
//!
//! The host owns the run of a query (`ExecutorHost::Run`): the id of the query, its cancellation token and its
//! controls, from the registration of the query on. The executor gets the run with the request and hands it to every
//! call of the host, the task and its follow-ups hold it: the analysis of the result and the write of the stored
//! result, which run after the query ended. The token is the one cancellation of the query: the requests of the query
//! stop, the query is cancelled at the backend (a Trino or Hyper query by its request, a channel of the host by
//! `channel_cancel`, also while it opens) and the task ends as cancelled. A cancel after the query ended stops the
//! analysis of its result.

pub mod connectors;
pub mod ipc;
mod wait;

use std::cell::RefCell;
use std::future::Future;
use std::rc::Rc;

use dashql_buffers::profile::ProfileLayoutConfig;

use crate::connections::DetailedError;
use crate::host::signal::{oneshot, Sender};
use crate::host::{HostError, LogLevel};
use crate::http::{Body, CancellationToken, Headers, HttpHost, HttpRequest, HttpResponse};
use crate::hyper::{HyperError, HyperHttpChannel};
use crate::query::{QueryExecutionMetrics, QueryExecutionProgress};
use crate::trino::{NoTimeZones, SharedTrinoChannel, TimeZoneOffsets, TrinoError};
pub use wait::QueryControls;

/// The target of the log messages of the executor
pub const LOG_TARGET: &str = "query_executor";

/// The id of a query, the host allocates it
pub type QueryId = u64;

/// A value of the host, e.g. a JavaScript value in the module
pub type HostValue = Rc<dyn std::any::Any>;

/// A file of the results of a workbook (docs/design/workbook_results.md)
#[derive(Debug, Clone, PartialEq)]
pub struct StoredFile {
    /// The file name below the results folder of the workbook
    pub name: String,
    /// The key in the name of the file
    pub key: String,
    /// When the file was written, in milliseconds since the epoch
    pub written_at: f64,
}

/// The stored result of the script of a query: the query reads a file of the results of the workbook, or it runs and
/// its result becomes the file of the script
#[derive(Debug, Clone, PartialEq)]
pub struct ResultRequest {
    /// The workbook
    pub workbook_id: String,
    /// The file name of the script
    pub script: String,
    /// The result key of the script, the file of a result that the query stores is named after it
    pub key: String,
    /// The name of the file of the result that the query stores, the run names it when it plans
    pub name: String,
    /// Read this file instead of running the query, a query whose file is gone fails with a miss
    pub read: Option<StoredFile>,
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
}

/// A query to run
pub struct QueryRequest {
    /// The connection
    pub connection_id: String,
    /// The text of the query
    pub text: String,
    /// Where the query runs
    pub target: QueryTarget,
    /// Collect the result? A statement whose output is discarded is drained without a table.
    pub publish_results: bool,
    /// Analyze the result on the compute database, after the query and without holding it up
    pub analyze_results: bool,
    /// The stored result of the script of the query, none for a query of no script
    pub result: Option<ResultRequest>,
    /// May the statement change the relations of the connection? The catalog loader then asks the connection.
    pub touches_relations: bool,
    /// Reject with the error of a failed query instead of resolving without a result
    pub throw_on_error: bool,
    /// The details of the log messages of the query, e.g. the workbook
    pub log_details: Vec<(String, String)>,
}

/// What kind of failure ended a query
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// The query failed
    Error,
    /// The query was cancelled
    Cancelled,
    /// A query that only reads the stored result of its script found no file
    CacheMiss,
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

    /// A failed host call, it keeps what the host failed with. A cancelled call cancelled the query.
    pub fn from_host(error: &HostError) -> Self {
        Self {
            kind: if error.is_cancelled() { FailureKind::Cancelled } else { FailureKind::Error },
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

/// What happens to a query, in order. The host applies it to the history of the connection of the query.
pub enum QueryEvent {
    /// The query is sent to the backend
    Sending,
    /// The backend runs the query, its result streams
    Running,
    /// The backend reported progress, with the structured progress of the progress model of the query
    Progress(Box<QueryExecutionProgress>),
    /// A batch of the result arrived, with the metrics of the stream so far
    ReceivedBatch(QueryExecutionMetrics),
    /// The result is complete, the host holds its table
    ReceivedAllBatches { rows: u64, metrics: QueryExecutionMetrics },
    /// The query succeeded
    Succeeded,
    /// The query failed
    Failed { failure: QueryFailure, metrics: Option<QueryExecutionMetrics> },
    /// The query was cancelled
    Cancelled { failure: QueryFailure, metrics: Option<QueryExecutionMetrics> },
    /// The result is the stored result of its script, read from its file or written to it
    CacheRecorded { served_from_cache: bool },
    /// The statement may have changed relations of the connection
    TouchRelations,
    /// The result arrived, `elapsed_ms` after the query was sent
    Timing { elapsed_ms: f64 },
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

/// A result table that the host holds: one it read from a file or one it built from the parts of a stream
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

/// A query as its host keeps it from its registration to the end of its last follow-up
pub trait ExecutorRun: 'static {
    /// The id of the query
    fn query_id(&self) -> QueryId;
    /// The one cancellation of the query
    fn token(&self) -> &CancellationToken;
    /// What the views ask of the query while it runs
    fn controls(&self) -> &QueryControls;
}

/// What the executor asks of the host. Every call of a query gets its run.
pub trait ExecutorHost: HttpHost {
    /// The run of a query, the host keeps the result of the query with it
    type Run: ExecutorRun;

    /// Apply an event of a query to the history of its connection
    fn report(&self, run: &Self::Run, event: QueryEvent);

    /// Keep the next part of the Arrow IPC stream of the result of a query, in the order of the result. A message may
    /// span parts, a part may repeat the schema or hold an end-of-stream marker. The host holds the parts until
    /// `finish_result`.
    fn push_result(&self, run: &Self::Run, part: Body) -> Result<(), HostError>;
    /// The result of a query streamed to its end: the host builds its table from the parts of the stream or from the
    /// batches of its channel and holds it as the result of the run.
    fn finish_result(&self, run: &Rc<Self::Run>) -> impl Future<Output = Result<HostTable, HostError>> + 'static;

    /// Read a file of the results of a workbook, the host holds it as the result of the run. None if the file is gone.
    fn result_read(
        &self,
        run: &Rc<Self::Run>,
        workbook_id: &str,
        name: &str,
    ) -> impl Future<Output = Result<Option<HostTable>, HostError>> + 'static;
    /// Write the result of a run as the new file of its script, `name` of the request. Resolves with the name of the
    /// file.
    fn result_write(
        &self,
        run: &Rc<Self::Run>,
        result: &ResultRequest,
    ) -> impl Future<Output = Result<String, HostError>> + 'static;
    /// Remove the files of a script whose query ended without a result, they describe an earlier text
    fn result_clear(&self, workbook_id: &str, script: &str) -> impl Future<Output = Result<(), HostError>> + 'static;

    /// Analyze the result of a run on the compute database, after the query and without holding it up. The call starts
    /// the analysis, e.g. the computation of the result, before the query succeeds, the future runs it to its end. A
    /// cancellation of the token of the run stops the analysis and fails it with the cancellation; the result stays
    /// with what its analysis computed, also after a failure.
    fn analyze_result(&self, run: &Rc<Self::Run>) -> impl Future<Output = Result<(), HostError>> + 'static;

    /// Send a request whose response carries a part of a result. The body of a successful response may stay with the
    /// host (`HttpResponse::host_body`), the module passes it on unread.
    fn fetch_result(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.fetch(request, cancellation)
    }

    /// Run a query on the channel of its connection, false if the channel returned no result. A query that is
    /// cancelled while the channel opens it is cancelled with `channel_cancel`, the open fails or returns a stream
    /// that the cancel stops.
    fn channel_open(&self, run: &Rc<Self::Run>) -> impl Future<Output = Result<bool, HostError>> + 'static;
    /// The next message of the result of a query on a channel
    fn channel_next(&self, run: &Self::Run) -> impl Future<Output = Result<ChannelMessage, HostError>> + 'static;
    /// Cancel the query of a channel: one that the channel still opens, or its stream at the backend
    fn channel_cancel(&self, run: &Self::Run) -> impl Future<Output = Result<(), HostError>> + 'static;

    /// The auth headers of the channel of a Hyper query over HTTP as they are now, asked before every round of requests
    /// of its result. None keeps the headers that the query started with.
    fn channel_auth(&self, _run: &Self::Run) -> impl Future<Output = Result<Option<Headers>, HostError>> + 'static {
        std::future::ready(Ok(None))
    }

    /// The refresh of a token of the channel of the connection of a query ended, e.g. of the OAuth access token of a
    /// Trino channel. The channel keeps a new token, a failure fails the connection.
    fn token_refresh_ended(&self, _run: &Self::Run, _outcome: Result<(), DetailedError>) {}

    /// The offsets of named time zones, e.g. for the timestamps of Trino with a named zone. Without, such a timestamp
    /// is null.
    fn time_zones(&self) -> Rc<dyn TimeZoneOffsets> {
        Rc::new(NoTimeZones)
    }
}

#[derive(Default)]
struct ExecutorState {
    /// The writes of stored results that run
    result_writes: usize,
    /// The callers that wait for the writes of stored results
    result_waiters: Vec<Sender<()>>,
    /// The layout of the plans of the progress of queries, none for the default one
    progress_layout: Option<ProfileLayoutConfig>,
}

/// Counts a write of a stored result while it runs. A guard that drops while the state is borrowed, e.g. a task that is
/// dropped within a call of the executor, changes it in a task of the host once the borrow ended.
struct ResultWriteGuard<H: ExecutorHost> {
    host: Rc<H>,
    state: Rc<RefCell<ExecutorState>>,
}

impl<H: ExecutorHost> Drop for ResultWriteGuard<H> {
    fn drop(&mut self) {
        let finish = |state: &mut ExecutorState| {
            state.result_writes = state.result_writes.saturating_sub(1);
            if state.result_writes == 0 {
                std::mem::take(&mut state.result_waiters)
            } else {
                Vec::new()
            }
        };
        let waiters = match self.state.try_borrow_mut() {
            Ok(mut state) => finish(&mut state),
            Err(_) => {
                let state = self.state.clone();
                self.host.spawn(Box::pin(async move {
                    let waiters = finish(&mut state.borrow_mut());
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

    /// Run a query of a run, a run whose token was cancelled before ends as cancelled. The future settles once the
    /// query ended, the analysis of its result and a write of its stored result may still run and hold the run.
    pub fn execute(&self, request: QueryRequest, run: Rc<H::Run>) -> impl Future<Output = QueryOutcome> + 'static {
        let task = QueryTask { host: self.host.clone(), state: self.state.clone(), run, request };
        task.run()
    }

    /// The layout of the plans of the progress of the queries that start later, none for the default one
    pub fn set_progress_layout(&self, layout: Option<ProfileLayoutConfig>) {
        if let Ok(mut state) = self.state.try_borrow_mut() {
            state.progress_layout = layout;
        }
    }

    /// Wait for the writes of stored results that run, e.g. before a process ends
    pub fn flush_result_writes(&self) -> impl Future<Output = ()> + 'static {
        let receiver = {
            let mut state = self.state.borrow_mut();
            (state.result_writes > 0).then(|| {
                let (sender, receiver) = oneshot();
                state.result_waiters.push(sender);
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
    run: Rc<H::Run>,
    request: QueryRequest,
}

/// What the task knows of a result once it arrived
struct ResultSummary {
    /// Does the query have a result table?
    has_table: bool,
    /// Was it read from the file of its stored result?
    served_from_cache: bool,
}

impl<H: ExecutorHost> QueryTask<H> {
    fn token(&self) -> &CancellationToken {
        self.run.token()
    }

    fn report(&self, event: QueryEvent) {
        self.host.report(&self.run, event);
    }

    /// Log a message of the query with the details of the query
    fn log(&self, level: LogLevel, message: &str, details: Vec<(String, String)>) {
        self.report(QueryEvent::Log { level, message: message.to_string(), details, target: LOG_TARGET.to_string() });
    }

    /// The details of the query for the log: the workbook and the id
    fn query_details(&self) -> Vec<(String, String)> {
        let mut details = self.request.log_details.clone();
        details.push(("query".to_string(), self.run.query_id().to_string()));
        details
    }

    async fn run(self) -> QueryOutcome {
        if self.token().is_cancelled() {
            let failure = QueryFailure::cancelled();
            self.report(QueryEvent::Cancelled { failure: failure.clone(), metrics: None });
            return QueryOutcome::Rejected(failure);
        }
        let mut details = self.query_details();
        details.push(("text".to_string(), self.request.text.clone()));
        self.log(LogLevel::Info, "Executing query", details);

        let mut metrics: Option<QueryExecutionMetrics> = None;
        let summary = match self.fetch_result(&mut metrics).await {
            Ok(summary) => summary,
            Err(failure) => {
                if self.token().is_cancelled() || failure.kind == FailureKind::Cancelled {
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
        // The query is done once its result is there, the analysis follows it
        if summary.has_table && self.request.analyze_results {
            self.analyze();
        }
        if !summary.served_from_cache && self.request.publish_results {
            self.store_result(summary.has_table);
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
        if self.request.touches_relations && !self.reads_file() {
            self.report(QueryEvent::TouchRelations);
        }
    }

    /// Does the query read the file of a stored result instead of running?
    fn reads_file(&self) -> bool {
        self.request.result.as_ref().is_some_and(|result| result.read.is_some())
    }

    /// Read the stored result or run the query
    async fn fetch_result(&self, metrics: &mut Option<QueryExecutionMetrics>) -> Result<ResultSummary, QueryFailure> {
        if let Some(summary) = self.read_stored().await? {
            return Ok(summary);
        }
        self.report(QueryEvent::Sending);
        let started_at = self.host.now();
        let progress_layout = self.state.try_borrow().ok().and_then(|state| state.progress_layout);
        let mut stream = connectors::StreamContext::new(
            self.host.clone(),
            self.run.clone(),
            self.request.publish_results,
            self.request.log_details.clone(),
            progress_layout,
        );
        let end = connectors::run(&mut stream, &self.request.target, &self.request.text).await;
        *metrics = stream.metrics_if_started();
        let end = end?;
        self.report(QueryEvent::Timing { elapsed_ms: self.host.now() - started_at });
        let Some(end) = end else {
            self.log(LogLevel::Warn, "Query returned no results", self.query_details());
            return Ok(ResultSummary { has_table: false, served_from_cache: false });
        };
        let mut stream_metrics = end.metrics;
        let table = if self.request.publish_results {
            // The host builds the table from the parts it holds
            let table = self.host.finish_result(&self.run).await;
            if self.token().is_cancelled() {
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

    /// Read the file of a stored result, none for a query that runs. A file that is gone or fails to read is a miss, the
    /// query fails with it and never runs.
    async fn read_stored(&self) -> Result<Option<ResultSummary>, QueryFailure> {
        let Some((result, file)) =
            self.request.result.as_ref().and_then(|result| Some((result, result.read.as_ref()?)))
        else {
            return Ok(None);
        };
        let mut details = self.query_details();
        details.push(("file".to_string(), file.name.clone()));
        // The read runs to its end, the run owns the table that it read
        let table = self.host.result_read(&self.run, &result.workbook_id, &file.name).await;
        if self.token().is_cancelled() {
            return Err(QueryFailure::cancelled());
        }
        let table = match table {
            Ok(Some(table)) => table,
            Ok(None) => return Err(QueryFailure::new(FailureKind::CacheMiss, "The stored result is gone")),
            Err(error) => {
                details.push(("error".to_string(), error.message().to_string()));
                self.log(LogLevel::Warn, "Failed to read a stored result", details);
                return Err(QueryFailure::new(
                    FailureKind::CacheMiss,
                    format!("The stored result can't be read: {}", error.message()),
                ));
            }
        };
        details.push(("numRows".to_string(), table.rows.to_string()));
        details.push(("numCols".to_string(), table.columns.to_string()));
        details.push(("writtenAt".to_string(), crate::time::iso_timestamp(file.written_at as i64)));
        self.log(LogLevel::Info, "Read a stored result", details);
        let metrics = QueryExecutionMetrics::default();
        self.report(QueryEvent::ReceivedAllBatches { rows: table.rows, metrics });
        self.report(QueryEvent::CacheRecorded { served_from_cache: true });
        Ok(Some(ResultSummary { has_table: true, served_from_cache: true }))
    }

    /// Analyze the result on the compute database after the query, the query doesn't wait for it. The analysis starts
    /// now, before the query succeeds, and holds the run, so a cancel of the query stops it. A failure only logs, the
    /// result stays.
    fn analyze(&self) {
        let analysis = self.host.analyze_result(&self.run);
        let host = self.host.clone();
        let run = self.run.clone();
        let details = self.query_details();
        self.host.spawn(Box::pin(async move {
            let started_at = host.now();
            let analyzed = analysis.await;
            let mut details = details;
            details.push(("duration".to_string(), format!("{}", (host.now() - started_at).max(0.0).floor())));
            let (level, message) = match analyzed {
                Ok(()) => (LogLevel::Debug, "Analyzed a query result"),
                Err(error) if run.token().is_cancelled() || error.is_cancelled() => {
                    (LogLevel::Info, "Stopped the analysis of a query result")
                }
                Err(error) => {
                    details.push(("error".to_string(), error.message().to_string()));
                    (LogLevel::Warn, "The analysis of a query result failed")
                }
            };
            let message = message.to_string();
            host.report(&run, QueryEvent::Log { level, message, details, target: LOG_TARGET.to_string() });
        }));
    }

    /// Store the result as the file of its script after the query, the query doesn't wait for it. A query that ended
    /// without a result removes the files of its script. A failure only logs. The write holds the run, so the key and
    /// the warning reach the history of the query after the query ended.
    fn store_result(&self, has_table: bool) {
        let Some(result) = self.request.result.clone() else { return };
        let host = self.host.clone();
        let run = self.run.clone();
        let write = has_table.then(|| self.host.result_write(&self.run, &result));
        let clear = (!has_table).then(|| self.host.result_clear(&result.workbook_id, &result.script));
        self.state.borrow_mut().result_writes += 1;
        let guard = ResultWriteGuard { host: self.host.clone(), state: self.state.clone() };
        self.host.spawn(Box::pin(async move {
            let log = |level: LogLevel, message: &str, error: &HostError| {
                let details = vec![
                    ("query".to_string(), run.query_id().to_string()),
                    ("script".to_string(), result.script.clone()),
                    ("error".to_string(), error.message().to_string()),
                ];
                let message = message.to_string();
                host.report(&run, QueryEvent::Log { level, message, details, target: LOG_TARGET.to_string() });
            };
            if let Some(write) = write {
                match write.await {
                    Ok(_) => host.report(&run, QueryEvent::CacheRecorded { served_from_cache: false }),
                    Err(error) => log(LogLevel::Warn, "Failed to store the result of a script", &error),
                }
            }
            if let Some(clear) = clear {
                if let Err(error) = clear.await {
                    log(LogLevel::Warn, "Failed to remove the stored result of a script", &error);
                }
            }
            drop(guard);
        }));
    }
}
