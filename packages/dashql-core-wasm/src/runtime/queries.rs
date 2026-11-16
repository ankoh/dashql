//! The queries of the runtime: the host of the query executor of the crate, the command that runs a query and the
//! views of a query (docs/wip/runtime_api.md).
//!
//! A query of a connection is in the history of the connection from the start: `executeQuery` hands out its id from
//! the registry, registers it and runs it once the runtime described it (`Connections::describe`): the target on the
//! channel of its connection, the key of its result in the query result cache (`result_key`, the SHA-256 digest
//! through `crypto` of the platform) and what the executor does around it. The platform only describes the channel
//! (`channels.describe`): a channel that the module speaks, or one of the host that it keeps for the query until the
//! run of the query is dropped (`channels.forget`). The executor reports every event into the history right away. What
//! stays with the host goes through the platform: fetch, the channels of the host, the query result cache, the result
//! tables by handle. The analysis of a result runs on the computations of the runtime, the history decides which result
//! of an owner is the latest and the computations of the others go.
//!
//! Every query is one `QueryRun` with the one cancellation token of the query, see there.
//!
//! The result of a query never lives in the module: its parts go into a table of the platform as they arrive
//! (`tables.open` and `tables.push`), the channels of the host push their batches into it, the platform builds the
//! table at the end (`tables.finish`). The run owns the table, the history and the analysis take handles of their own,
//! the analysis reads only its rows and its schema (`tables.describe`).
//!
//! The runtime runs queries of its own as well (`run_internal`): the metadata queries of the catalog loader and the
//! probes of the health checks, and the statements of the runs of workbooks (`run_statement`). They are queries of
//! their connection like the others and are described in the same way. The specs of the client functions come from the platform (`extensions`) when a call
//! runs.

use std::cell::RefCell;
use std::pin::Pin;
use std::rc::{Rc, Weak};
use std::task::{Context, Poll};

use dashql_core_runtime::compute::service::AnalysisHandles;
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions as RuntimeAnalyzeOptions;
use dashql_core_runtime::clfn::{ClientFunctionBinding, ClientFunctionCallDescription};
use dashql_core_runtime::connections::registry::QueryOwner;
use dashql_core_runtime::connections::{ConnectionAction, ConnectorType, TrinoAction};
use dashql_core_runtime::executor::cache_key::{connection_cache_signature, result_key_input, result_key_of_digest};
use dashql_core_runtime::executor::json::{failure_json, target_from_json};
use dashql_core_runtime::executor::{
    CacheEntry, CacheRequest, ChannelMessage, ClientFunctionTarget, ExecutorHost, FailureKind, HostTable, QueryEvent, QueryFailure, QueryId, QueryOutcome, QueryRequest,
    QueryTarget,
};
use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::signal::{oneshot, Receiver, Sender};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::host::CANCELLED_MESSAGE;
use dashql_core_runtime::http::{Body, CancellationToken, Headers, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::trino::{SharedTrinoChannel, TimeZoneOffsets, TrinoAccessToken};
use dashql_core_runtime::salesforce::SalesforceTokens;
use dashql_core_runtime::query::{QueryError, QueryExecutionAction, QueryExecutionProgress, QueryExecutionState, QueryMetadata, QueryResultTable};
use js_sys::{Function, Object, Promise, Reflect, Uint8Array};
use serde::{Deserialize, Serialize};
use std::future::Future;
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use super::connections::Connections;
use crate::host::{field, host_table, host_value, lifetime_token, IntlTimeZones, JsPlatform};
use crate::query_history::view::{QueryMetadataView, QueryProgressView, QueryStreamMetrics};
use crate::views::JsonValue;

/// The target of the log messages of the executor
const LOG_TARGET: &str = "query_executor";

/// A query that the runtime runs
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryArgs {
    /// The text of the query as the history shows it
    pub text: String,
    pub metadata: QueryMetadataView,
    /// The trace and the span of the log messages of the query
    pub trace_id: f64,
    #[serde(default)]
    #[tsify(optional)]
    pub span_id: Option<f64>,
    /// What the executor does around the query
    #[serde(default)]
    #[tsify(optional)]
    pub options: QueryOptions,
}

/// What the executor does around a query besides running its text
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct QueryOptions {
    /// Analyze the result on the compute database, false by default
    #[serde(default)]
    #[tsify(optional)]
    pub analyze_results: Option<bool>,
    /// Collect the result, true by default. A statement whose output nothing reads drains it.
    #[serde(default)]
    #[tsify(optional)]
    pub publish_results: Option<bool>,
    /// Reject with the error of a failed query instead of resolving
    #[serde(default)]
    #[tsify(optional)]
    pub throw_on_error: Option<bool>,
    /// A call of a client function that runs instead of the text, as the core describes it
    #[serde(default)]
    #[tsify(optional)]
    pub client_function_call: Option<JsonValue>,
    /// The time to wait for the next batch of a channel of the host, the default of the channel without
    #[serde(default)]
    #[tsify(optional)]
    pub read_timeout_ms: Option<u32>,
    /// The query result cache, none for a query that never reads or writes it
    #[serde(default)]
    #[tsify(optional)]
    pub cache: Option<QueryCacheOptions>,
}

/// How a query uses the query result cache
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct QueryCacheOptions {
    /// The semantic signature of the script that the key of the result derives from, with the params of the connection
    pub signature: String,
    /// Run the query instead of serving a cached result, the result becomes the newest file of its key
    #[serde(default)]
    #[tsify(optional)]
    pub refresh: bool,
    /// Serve the cached result or fail with a cache miss instead of running the query
    #[serde(default)]
    #[tsify(optional)]
    pub only: bool,
}

/// A query that the runtime describes before the executor runs it: its connection, the text and the metadata of the
/// history, and the options of the caller
struct QueryDescription {
    connection_id: String,
    text: String,
    metadata: QueryMetadata,
    options: QueryOptions,
    /// The message of the failure that the caller set
    failure: Option<String>,
}

/// A query of a channel of the host as the platform needs it to run the query on the channel
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelQuery<'a> {
    text: &'a str,
    read_timeout_ms: Option<u32>,
    publish_results: bool,
    /// The name of the connector, e.g. for the error of a channel that is not set up
    connector: &'static str,
    /// Is the query a call of a client function? The runtime sends its requests itself, the platform names only the
    /// tokens of the channel.
    client_function: bool,
}

/// A query that the runtime runs, one object from its registration in the history to the end of its last follow-up.
/// The command that runs the query holds it, so do the follow-ups of the executor after the end of the query (the write
/// of its result into the cache, the touch of a cached entry), the runs of the connections know it weakly. Its token is
/// the one cancellation of the query: a cancel, a reset of its connection and a caller that stops waiting cancel it,
/// before the executor runs the query or while it does. The run owns its result table, the history and the analysis
/// take handles of their own; once the last holder lets go, the run releases its tables and the platform forgets the
/// channel of the query.
pub(crate) struct QueryRun {
    pub query_id: QueryId,
    pub connection_id: String,
    pub text: String,
    /// The details of the log messages of the query: the trace, the span and the workbook
    pub log_details: Vec<(String, String)>,
    /// Was the query failed by the caller before it ran?
    pub preset_failure: bool,
    /// Cancels the query
    pub token: CancellationToken,
    /// What the caller hears
    caller: QueryCaller,
    /// The tables and the steps of the query
    state: RefCell<RunState>,
    platform: JsPlatform,
}

/// What the caller of a query hears, apart from what the platform keeps: the timings and the result before its
/// analysis, and the end of the query for those who wait for it. The refreshed token of a Trino channel still reaches
/// the platform through the events of the caller.
#[derive(Default)]
struct QueryCaller {
    /// The events of the caller: the timings, the result before its analysis, a refreshed token of Trino
    events: Option<Function>,
    /// Hears that the result arrived, before its analysis: a statement of a run of a workbook
    ready: RefCell<Option<Sender<()>>>,
    /// Hear that the query ended, e.g. a cancel
    ended: RefCell<Vec<Sender<()>>>,
}

/// The tables and the steps of a query
#[derive(Default)]
struct RunState {
    /// The table that the parts of the result stream into
    table: Option<Handle>,
    /// The result table once it is finished, the run owns it
    result: Option<Handle>,
    /// Did the history take a handle of the result table?
    in_history: bool,
    /// Does the executor run it?
    started: bool,
    /// Did the query end?
    ended: bool,
    /// The views that show the profile of the query before it started
    profile_viewers: i32,
}

impl QueryRun {
    fn new(query_id: QueryId, connection_id: &str, text: &str, log_details: Vec<(String, String)>, preset_failure: bool, platform: &JsPlatform) -> Self {
        QueryRun {
            query_id,
            connection_id: connection_id.to_string(),
            text: text.to_string(),
            log_details,
            preset_failure,
            token: CancellationToken::new(),
            caller: QueryCaller::default(),
            state: RefCell::new(RunState::default()),
            platform: platform.clone(),
        }
    }

    /// The result table that the run owns, none before the result arrived
    fn result(&self) -> Option<Handle> {
        self.state.borrow().result
    }

    /// The query ended, those who wait for it hear it
    fn end(&self) {
        self.state.borrow_mut().ended = true;
        let waiters = std::mem::take(&mut *self.caller.ended.borrow_mut());
        for waiter in waiters {
            waiter.send(());
        }
    }

    /// A future that completes once the query ended
    fn ended(&self) -> impl Future<Output = ()> + 'static {
        let receiver = (!self.state.borrow().ended).then(|| {
            let (sender, receiver) = oneshot();
            self.caller.ended.borrow_mut().push(sender);
            receiver
        });
        async move {
            if let Some(receiver) = receiver {
                receiver.await;
            }
        }
    }
}

impl Drop for QueryRun {
    fn drop(&mut self) {
        // The platform lets go of the channel of the query
        self.platform.forget_channel_query(self.query_id as f64);
        let state = self.state.get_mut();
        let tables: Vec<Handle> = state.table.take().into_iter().chain(state.result.take()).collect();
        if !tables.is_empty() {
            for table in tables {
                self.platform.push_release(table);
            }
            self.platform.signal(false);
        }
    }
}

/// The host of the executor: the platform and the connections of the runtime, weakly
pub(crate) struct QueryHost {
    connections: Weak<Connections>,
    platform: JsPlatform,
}

impl QueryHost {
    pub fn new(connections: Weak<Connections>, platform: JsPlatform) -> Self {
        Self { connections, platform }
    }

    fn connections(&self) -> Result<Rc<Connections>, HostError> {
        self.connections.upgrade().ok_or_else(|| HostError::new("the runtime was destroyed"))
    }
}

/// The error of a failed query as the history keeps it, with the details of what the host failed with
fn query_error(failure: &QueryFailure) -> QueryError {
    let mut details: serde_json::Map<String, serde_json::Value> =
        failure.details.iter().map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone()))).collect();
    let value = host_value(failure.value.as_ref());
    if let Some(key_values) = field(&value, "keyValues") {
        if let serde_json::Value::Object(values) = JsonValue::of(&key_values).0 {
            for (key, value) in values {
                if let serde_json::Value::String(value) = value {
                    details.insert(key, serde_json::Value::String(value));
                }
            }
        }
    }
    let details = (!details.is_empty()).then(|| serde_json::Value::Object(details).to_string());
    QueryError { message: failure.message.clone(), details }
}

/// The progress of a channel of the host, a progress that doesn't read is an update without fields
fn channel_progress(value: Option<JsValue>) -> QueryExecutionProgress {
    let view = value.and_then(|value| serde_wasm_bindgen::from_value::<QueryProgressView>(value).ok());
    view.map(Into::into).unwrap_or_default()
}

/// The metrics of a message of a channel, missing counters are 0
fn channel_metrics(value: &JsValue) -> dashql_core_runtime::query::QueryExecutionMetrics {
    field(value, "metrics").and_then(|metrics| serde_wasm_bindgen::from_value::<QueryStreamMetrics>(metrics).ok()).unwrap_or_default().into()
}

fn channel_message(value: &JsValue) -> Result<ChannelMessage, HostError> {
    match field(value, "type").and_then(|kind| kind.as_string()).as_deref() {
        Some("progress") => Ok(ChannelMessage::Progress(Box::new(channel_progress(field(value, "progress"))))),
        Some("batch") => Ok(ChannelMessage::Batch { metrics: channel_metrics(value) }),
        Some("end") => Ok(ChannelMessage::End { metrics: channel_metrics(value) }),
        _ => Err(HostError::new("an unknown message of a channel")),
    }
}

/// An event for the caller of a query
fn event(kind: &str, fields: &[(&str, JsValue)]) -> JsValue {
    let object = Object::new();
    let _ = Reflect::set(&object, &JsValue::from_str("type"), &JsValue::from_str(kind));
    for (key, value) in fields {
        let _ = Reflect::set(&object, &JsValue::from_str(key), value);
    }
    object.into()
}

impl Connections {
    /// The run of a query that is still held
    pub(crate) fn run_of(&self, query_id: QueryId) -> Option<Rc<QueryRun>> {
        self.runs.borrow().get(&query_id).and_then(Weak::upgrade)
    }

    /// The ids of the queries whose runs are held
    pub(crate) fn run_ids(&self) -> Vec<QueryId> {
        self.runs.borrow().iter().filter(|(_, run)| run.strong_count() > 0).map(|(id, _)| *id).collect()
    }

    /// Know a new run, the runs that nobody holds any more leave
    fn adopt_run(&self, run: QueryRun) -> Rc<QueryRun> {
        let run = Rc::new(run);
        let mut runs = self.runs.borrow_mut();
        runs.retain(|_, held| held.strong_count() > 0);
        runs.insert(run.query_id, Rc::downgrade(&run));
        run
    }

    /// Release a table that no run keeps, with the next changes
    fn release_table(&self, table: Handle) {
        self.platform.push_release(table);
        self.platform.signal(false);
    }

    /// The table that the result of a query streams into, opened with the first part
    fn table_of(&self, query_id: QueryId) -> Result<Handle, HostError> {
        let Some(run) = self.run_of(query_id) else {
            return Err(HostError::new(format!("unknown query {query_id}")));
        };
        let table = run.state.borrow().table;
        if let Some(table) = table {
            return Ok(table);
        }
        let table = self.platform.open_table()?;
        run.state.borrow_mut().table = Some(table);
        Ok(table)
    }

    /// Log a message of a query with its trace
    fn log_query(&self, run: Option<&QueryRun>, level: LogLevel, message: &str, details: &[(String, String)], target: &str) {
        let mut all: Vec<(String, String)> = run.map(|run| run.log_details.clone()).unwrap_or_default();
        all.extend(details.iter().cloned());
        let pairs: Vec<(&str, &str)> = all.iter().map(|(key, value)| (key.as_str(), value.as_str())).collect();
        self.platform.log_on(level, message, &pairs, target);
    }

    /// Tell the caller of a query about an event, an observer that throws changes nothing
    fn notify(run: &QueryRun, event: JsValue) {
        if let Some(events) = &run.caller.events {
            let _ = events.call1(&JsValue::NULL, &event);
        }
    }

    /// Delete the computation of a result if it has one
    pub(crate) fn delete_computation_of(&self, query_id: QueryId) {
        if self.computations.read(|state| state.computation(query_id).is_some()) {
            self.delete_computation(query_id);
        }
    }

    /// Apply an event of the executor to the history of its query. The follow-ups of a query hold its run, so every
    /// event finds it; a log message of a run that is gone still goes to the log.
    pub(crate) fn report(self: &Rc<Self>, query_id: QueryId, event_: QueryEvent) {
        let Some(run) = self.run_of(query_id) else {
            if let QueryEvent::Log { level, message, details, target } = event_ {
                self.log_query(None, level, &message, &details, &target);
            }
            return;
        };
        let owner = QueryOwner::Connection(run.connection_id.clone());
        let now = self.now() as i64;
        let action = match event_ {
            QueryEvent::Sending => QueryExecutionAction::QuerySending { query_id, now },
            QueryEvent::Running => QueryExecutionAction::QueryRunning { query_id, now },
            QueryEvent::Progress(progress) => {
                let _ = self.apply_query(&owner, QueryExecutionAction::QueryProgressUpdated { query_id, progress, now }, false);
                return;
            }
            QueryEvent::ResultData(body) => {
                let part = match body {
                    Body::Bytes(bytes) => Uint8Array::from(bytes.as_slice()).into(),
                    Body::Host(bytes) => host_value(Some(bytes.value())),
                };
                let pushed = self.table_of(query_id).and_then(|table| self.platform.push_table(table, &part));
                if let Err(error) = pushed {
                    self.log_query(Some(&run), LogLevel::Warn, "Failed to keep a part of a result", &[("error".into(), error.message().into())], LOG_TARGET);
                }
                return;
            }
            QueryEvent::ReceivedBatch(metrics) => {
                let _ = self.apply_query(&owner, QueryExecutionAction::QueryReceivedBatch { query_id, metrics, now }, false);
                return;
            }
            QueryEvent::ReceivedAllBatches { rows, metrics } => {
                // The history takes a handle of its own, the run keeps the result until it ends
                let result = {
                    let mut state = run.state.borrow_mut();
                    let result = state.result.filter(|_| !state.in_history);
                    state.in_history |= result.is_some();
                    result
                };
                let Some(result) = result else { return };
                let table = match self.platform.duplicate(result) {
                    Ok(table) => table,
                    Err(error) => {
                        let details = [("error".into(), error.message().to_string())];
                        self.log_query(Some(&run), LogLevel::Warn, "Failed to keep the result of a query", &details, LOG_TARGET);
                        return;
                    }
                };
                QueryExecutionAction::QueryReceivedAllBatches { query_id, table: QueryResultTable { id: table, rows }, metrics, now }
            }
            QueryEvent::ProcessingResults => QueryExecutionAction::QueryProcessingResults { query_id, now },
            QueryEvent::ProcessedResults => QueryExecutionAction::QueryProcessedResults { query_id, now },
            QueryEvent::Succeeded => QueryExecutionAction::QuerySucceeded { query_id, now },
            QueryEvent::Failed { failure, metrics } => {
                // The preset failure and a failed analysis are logged already. The failed run shows the error inline, the
                // log keeps it as a warning.
                if !run.preset_failure && failure.kind != FailureKind::Processing {
                    let mut details = failure.details.clone();
                    details.push(("queryId".into(), query_id.to_string()));
                    self.log_query(Some(&run), LogLevel::Warn, &failure.message, &details, &failure.target);
                }
                QueryExecutionAction::QueryFailed { query_id, error: query_error(&failure), metrics, now }
            }
            QueryEvent::Cancelled { failure, metrics } => {
                // A query that was cancelled while its result was analyzed keeps no computation
                self.delete_computation_of(query_id);
                QueryExecutionAction::QueryCancelled { query_id, error: query_error(&failure), metrics, now }
            }
            QueryEvent::CacheRecorded { key, served_from_cache, cached_at } => {
                QueryExecutionAction::QueryCacheRecorded { query_id, cache_key: key, served_from_cache, cached_at: cached_at.map(|at| at as i64) }
            }
            QueryEvent::TouchRelations => {
                let touched = dashql_core_script::touched_relations::touched_relations(&run.text).relations.unwrap_or_default();
                if !touched.is_empty() {
                    // Following the catalog must not change the outcome of the statement
                    if let Err(error) = self.apply(&run.connection_id, ConnectionAction::RelationsTouched(touched), None) {
                        let details = [("query".into(), query_id.to_string()), ("error".into(), error.what().to_string())];
                        self.log_query(Some(&run), LogLevel::Warn, "Failed to read the relations of a statement", &details, LOG_TARGET);
                    }
                }
                return;
            }
            QueryEvent::Timing { label, elapsed_ms } => {
                Self::notify(&run, event("timing", &[("label", JsValue::from_str(label)), ("elapsedMs", JsValue::from_f64(elapsed_ms))]));
                return;
            }
            QueryEvent::ResultsReady => {
                let ready = run.caller.ready.borrow_mut().take();
                if let Some(ready) = ready {
                    ready.send(());
                }
                Self::notify(&run, event("resultsReady", &[]));
                return;
            }
            QueryEvent::Log { level, message, details, target } => {
                self.log_query(Some(&run), level, &message, &details, &target);
                return;
            }
        };
        if let Err(error) = self.apply_query(&owner, action, true) {
            self.log_query(Some(&run), LogLevel::Debug, "A query event changed nothing", &[("error".into(), error.what().to_string())], LOG_TARGET);
        }
    }

    /// Analyze the result of a query on the computations. The history decides which result of an owner is the latest
    /// once the query succeeded, the computations of the results that it supersedes go then. A cancel stops the
    /// analysis: the new computation goes and the earlier result of the owner keeps its computation.
    fn analyze(self: &Rc<Self>, query_id: QueryId, cancellation: &CancellationToken) -> impl Future<Output = Result<(), HostError>> + 'static {
        let connections = self.clone();
        let token = cancellation.clone();
        async move {
            let Some(run) = connections.run_of(query_id) else {
                return Ok(());
            };
            let Some(table) = run.result() else {
                return Ok(());
            };
            // The analysis computes on the compute database, a query without one has nothing to analyze
            if !connections.platform.has_compute() {
                return Ok(());
            }
            if token.is_cancelled() {
                return Err(HostError::new(CANCELLED_MESSAGE));
            }
            // The module reads the rows and the schema of the result, its data stays with the host
            let shape = connections.platform.describe_table(table)?;
            if shape.schema.fields().is_empty() {
                return Ok(());
            }
            let table = connections.platform.duplicate(table)?;
            let lifetime = match connections.platform.register(&lifetime_token()) {
                Ok(lifetime) => lifetime,
                Err(error) => {
                    connections.release_table(table);
                    return Err(error);
                }
            };
            let handles = AnalysisHandles { table, lifetime };
            let connection_id = Some(run.connection_id.clone());
            let analysis = connections.computations.analyze_table(query_id, shape, handles, connection_id, None, RuntimeAnalyzeOptions::default());
            // A cancel deletes the computation, which cancels the runs of the analysis
            let analyzed = CancellationToken::new();
            {
                let connections = connections.clone();
                let analyzed = analyzed.clone();
                let token = token.clone();
                connections.platform.clone().spawn(Box::pin(async move {
                    if analyzed.run(token.cancelled()).await.is_some() {
                        connections.delete_computation_of(query_id);
                    }
                }));
            }
            let outcome = analysis.await;
            analyzed.cancel();
            if token.is_cancelled() {
                connections.delete_computation_of(query_id);
                return Err(HostError::new(CANCELLED_MESSAGE));
            }
            if let Err(error) = outcome {
                // The previous result of the owner stays
                connections.delete_computation_of(query_id);
                return Err(HostError::new(error.what().to_string()));
            }
            Ok(())
        }
    }
}

impl Host for QueryHost {
    fn now(&self) -> f64 {
        self.platform.now()
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        self.platform.sleep(ms)
    }

    fn spawn(&self, task: LocalTask) {
        self.platform.spawn(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, LOG_TARGET);
    }
}

impl HttpHost for QueryHost {
    fn fetch(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.platform.send(request, cancellation, false)
    }
}

impl ExecutorHost for QueryHost {
    fn report(&self, query_id: QueryId, event: QueryEvent) {
        if let Some(connections) = self.connections.upgrade() {
            connections.report(query_id, event);
        }
    }

    fn cache_lookup(&self, _query_id: QueryId, key: &str) -> impl Future<Output = Result<Option<CacheEntry>, HostError>> + 'static {
        let lookup = self.platform.cache_lookup(key);
        async move {
            let value = lookup.await?;
            Ok(field(&value, "name").and_then(|name| name.as_string()).map(|name| CacheEntry {
                name,
                cached_at: field(&value, "cachedAt").and_then(|at| at.as_f64()).unwrap_or_default(),
            }))
        }
    }

    fn cache_read(&self, query_id: QueryId, entry: &CacheEntry) -> impl Future<Output = Result<HostTable, HostError>> + 'static {
        let read = self.platform.cache_read(&entry.name);
        let connections = self.connections.clone();
        let platform = self.platform.clone();
        async move {
            let value = read.await?;
            let table = field(&value, "table").and_then(|table| table.as_f64()).ok_or_else(|| HostError::new("the cache returned no table"))? as Handle;
            // The run owns the table, a run that is gone releases it
            let Some(run) = connections.upgrade().and_then(|connections| connections.run_of(query_id)) else {
                platform.push_release(table);
                platform.signal(false);
                return Err(HostError::new(format!("unknown query {query_id}")));
            };
            let previous = run.state.borrow_mut().result.replace(table);
            if let Some(previous) = previous {
                platform.push_release(previous);
                platform.signal(false);
            }
            Ok(host_table(&value))
        }
    }

    fn cache_touch(&self, _query_id: QueryId, entry: &CacheEntry) -> impl Future<Output = Result<(), HostError>> + 'static {
        self.platform.cache_touch(&entry.name)
    }

    fn cache_write(&self, query_id: QueryId, key: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        // The write holds the run, its table is there
        let table = self.connections.upgrade().and_then(|connections| connections.run_of(query_id)).and_then(|run| run.result());
        // The platform takes the table when it is called
        let write = table.map(|table| self.platform.cache_write(key, table));
        // The cache keeps its limits after every file of a key
        let evict = self.platform.evict_cache();
        async move {
            match write {
                Some(write) => {
                    write.await?;
                    evict.await;
                    Ok(())
                }
                None => Err(HostError::new("The query has no result")),
            }
        }
    }

    fn analyze_result(&self, query_id: QueryId, cancellation: &CancellationToken) -> impl Future<Output = Result<(), HostError>> + 'static {
        let analysis = self.connections().map(|connections| connections.analyze(query_id, cancellation));
        async move { analysis?.await }
    }

    fn fetch_result(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.platform.send(request, cancellation, true)
    }

    fn finish_result(&self, query_id: QueryId) -> impl Future<Output = Result<HostTable, HostError>> + 'static {
        let finished = (|| {
            let connections = self.connections()?;
            let table = connections.table_of(query_id)?;
            let finished = self.platform.finish_table(table);
            // A table that didn't finish stays the table of the run, which releases it
            if finished.is_ok() {
                if let Some(run) = connections.run_of(query_id) {
                    let mut state = run.state.borrow_mut();
                    state.table = None;
                    state.result = Some(table);
                }
            }
            finished
        })();
        async move { finished }
    }

    fn channel_open(&self, query_id: QueryId) -> impl Future<Output = Result<bool, HostError>> + 'static {
        let table = self.connections().and_then(|connections| connections.table_of(query_id));
        let opened = table.map(|table| self.platform.channel_open(query_id as f64, table));
        async move { opened?.await }
    }

    fn channel_next(&self, query_id: QueryId) -> impl Future<Output = Result<ChannelMessage, HostError>> + 'static {
        let next = self.platform.channel_next(query_id as f64);
        async move { channel_message(&next.await?) }
    }

    fn channel_cancel(&self, query_id: QueryId) -> impl Future<Output = Result<(), HostError>> + 'static {
        self.platform.channel_cancel(query_id as f64)
    }

    fn channel_profile_detail(&self, query_id: QueryId, wanted: bool) {
        self.platform.channel_profile_detail(query_id as f64, wanted);
    }

    fn channel_auth(&self, query_id: QueryId) -> impl Future<Output = Result<Option<Headers>, HostError>> + 'static {
        self.platform.channel_auth(query_id as f64)
    }

    fn trino_token_refreshed(&self, channel: &SharedTrinoChannel, token: &TrinoAccessToken) {
        if let Some(connections) = self.connections.upgrade() {
            connections.trino_token_refreshed(channel, token);
        }
    }

    fn time_zones(&self) -> Rc<dyn TimeZoneOffsets> {
        Rc::new(IntlTimeZones)
    }
}

impl Connections {
    /// The Trino channel of a connection refreshed its access token: the connection that owns the channel keeps it
    fn trino_token_refreshed(self: &Rc<Self>, channel: &SharedTrinoChannel, token: &TrinoAccessToken) {
        let owns = |state: &dashql_core_runtime::connections::ConnectionState| {
            state.details().trino().and_then(|trino| trino.channel.as_ref()).is_some_and(|owned| owned.same(channel))
        };
        let owner = self
            .registry
            .borrow()
            .connections()
            .find(|(_, connection)| connection.state.try_borrow().is_ok_and(|state| owns(&state)))
            .map(|(connection_id, _)| connection_id.to_string());
        let Some(connection_id) = owner else { return };
        let action = ConnectionAction::Trino(TrinoAction::AccessTokenRefreshed { channel: channel.clone(), token: token.to_json().to_string() });
        if let Err(error) = self.apply(&connection_id, action, None) {
            self.platform.log_on(LogLevel::Warn, "Failed to keep a refreshed access token", &[("connectionId", &connection_id), ("error", error.what())], LOG_TARGET);
        }
    }
}

/// The outcome of a query for the host: `{ status: 'resolved', hasResult, table }` with the result table, or
/// `{ status: 'rejected', failure, value }` with the failure as JSON and what the host failed with
fn outcome_value(outcome: QueryOutcome, table: JsValue) -> JsValue {
    let object = Object::new();
    let set = |key: &str, value: &JsValue| {
        let _ = Reflect::set(&object, &JsValue::from_str(key), value);
    };
    match outcome {
        QueryOutcome::Resolved { has_result } => {
            set("status", &JsValue::from_str("resolved"));
            set("hasResult", &JsValue::from_bool(has_result));
            set("table", &if has_result { table } else { JsValue::NULL });
        }
        QueryOutcome::Rejected(failure) => {
            set("status", &JsValue::from_str("rejected"));
            set("failure", &JsonValue(failure_json(&failure)).to_js().unwrap_or(JsValue::NULL));
            set("value", &host_value(failure.value.as_ref()));
        }
    }
    object.into()
}

/// The outcome of a query that failed before it reached the executor
fn rejected(failure: QueryFailure) -> JsValue {
    outcome_value(QueryOutcome::Rejected(failure), JsValue::NULL)
}

impl Connections {
    /// Run a query on a connection, see `Runtime.executeQuery`. Returns the id of the query and the promise of its
    /// outcome.
    pub(crate) fn execute(self: &Rc<Self>, connection_id: &str, args: QueryArgs, failure: JsValue, events: Option<Function>) -> (QueryId, Promise) {
        let owner = QueryOwner::Connection(connection_id.to_string());
        let query_id = self.registry.borrow_mut().next_query_id();
        let now = self.now();
        let mut log_details = vec![("trace_id".to_string(), (args.trace_id as u64).to_string())];
        if let Some(span) = args.span_id {
            log_details.push(("span_id".to_string(), (span as u64).to_string()));
        }
        if let Some(workbook_id) = &args.metadata.workbook_id {
            log_details.push(("workbookId".to_string(), workbook_id.clone()));
        }
        let metadata: QueryMetadata = args.metadata.into();
        let state = QueryExecutionState::new(query_id, args.trace_id as u64, args.text.clone(), metadata.clone(), now as i64);
        // The query is in the history of the connection from the start
        if let Err(error) = self.apply_query(&owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true) {
            let message = format!("Couldn't find a connection with id {connection_id}");
            self.platform.log_on(LogLevel::Error, "Connection not configured", &[("connectionId", connection_id), ("error", error.what())], LOG_TARGET);
            let failed = rejected(QueryFailure::new(FailureKind::Error, message));
            return (query_id, Promise::resolve(&failed));
        }
        let preset_failure = !failure.is_undefined() && !failure.is_null();
        let mut run = QueryRun::new(query_id, connection_id, &args.text, log_details, preset_failure, &self.platform);
        run.caller.events = events;
        let run = self.adopt_run(run);
        let description = QueryDescription {
            connection_id: connection_id.to_string(),
            text: args.text,
            metadata,
            options: args.options,
            failure: preset_failure.then(|| crate::host::message_of(&failure)),
        };
        let connections = self.clone();
        let done = wasm_bindgen_futures::future_to_promise(async move {
            let outcome = connections.run(&run, owner, description, failure).await;
            // The caller gets the object of the result table while the run still owns it
            let table = match &outcome {
                QueryOutcome::Resolved { has_result: true } => run.result().map(|table| connections.platform.handle(table)).unwrap_or(JsValue::NULL),
                _ => JsValue::NULL,
            };
            Ok(outcome_value(outcome, table))
        });
        (query_id, done)
    }

    /// The key of the results of a script signature on a connection in the query result cache, none without a cache or
    /// before the connection has the params of a setup. The key derives from the params of the connector that identify
    /// its results, the platform computes the SHA-256 digest. The executor derives the same key, it uses the cache only
    /// with the compute database that reads and writes its files (`describe`); the cache indicators and the exports
    /// read the files of the keys without it.
    pub(crate) fn result_key(&self, connection_id: &str, signature: &str) -> impl Future<Output = Option<String>> + 'static {
        let input = if self.platform.has_cache() {
            let registry = self.registry.borrow();
            registry.get(connection_id).and_then(|connection| {
                let state = connection.state.try_borrow().ok()?;
                let params = state.details().setup_params.as_ref()?;
                Some(result_key_input(&connection_cache_signature(state.connector_type(), params), signature))
            })
        } else {
            None
        };
        let digest = input.map(|input| self.platform.sha256(input.as_bytes()));
        async move {
            let digest = digest?.await.ok()?;
            Some(result_key_of_digest(&digest))
        }
    }

    /// Describe where a query runs and what the executor does around it: the target on the channel of its connection,
    /// the key of its result in the query result cache, whether it touches relations and the details of its log
    /// messages. The platform describes the channel: one that the module speaks (Trino, Hyper over HTTP) or one of the
    /// host, which then keeps the channel for the query until the query is forgotten.
    async fn describe(self: &Rc<Self>, query_id: QueryId, description: &QueryDescription) -> Result<QueryRequest, QueryFailure> {
        let connection_id = description.connection_id.as_str();
        // The connection owns the channel of Trino and the tokens of Salesforce
        let connection = {
            let registry = self.registry.borrow();
            registry.get(connection_id).and_then(|connection| {
                let state = connection.state.try_borrow().ok()?;
                let details = state.details();
                let trino = details.trino().and_then(|trino| trino.channel.clone());
                let tokens = SalesforceTokens::of_connection(details.salesforce().and_then(|salesforce| salesforce.oauth_state.as_ref()));
                Some((state.connector_type(), details.channel, trino, tokens))
            })
        };
        let Some((connector, channel, trino, tokens)) = connection else {
            return Err(QueryFailure::new(FailureKind::Error, format!("Couldn't find a connection with id {connection_id}")));
        };
        let tokens = tokens.map_err(|message| QueryFailure::new(FailureKind::Error, message))?;
        let options = &description.options;
        // The executor reads and writes the files of the cache with the compute database, through the mounts
        let cache = match &options.cache {
            Some(cache) if self.platform.has_mounts() => {
                self.result_key(connection_id, &cache.signature).await.map(|key| CacheRequest { key, refresh: cache.refresh })
            }
            _ => None,
        };
        let publish_results = options.publish_results != Some(false);
        let query = ChannelQuery {
            text: &description.text,
            read_timeout_ms: options.read_timeout_ms,
            publish_results,
            connector: connector.display_name(),
            client_function: options.client_function_call.is_some(),
        };
        let target = match (&options.client_function_call, trino) {
            // The call runs with the spec that the catalog of the connection registered (`load_spec`) and sends its
            // requests with the tokens of the connection
            (Some(call), _) => {
                let description = ClientFunctionCallDescription::from_value(call.0.clone())
                    .map_err(|error| QueryFailure::new(FailureKind::Error, error.message))?;
                QueryTarget::ClientFunction(ClientFunctionTarget { connector, spec: None, description, tokens })
            }
            // The queries of a Trino connection share its channel. One without a channel is a channel of the host
            // without one: a query from the cache needs none, any other fails when it opens the channel.
            (None, Some(trino)) => QueryTarget::Trino(trino),
            (None, None) => {
                let query = serde_wasm_bindgen::to_value(&query).map_err(|error| QueryFailure::new(FailureKind::Error, error.to_string()))?;
                let described = self.platform.channel_describe(query_id as f64, channel, &query).await.map_err(|error| {
                    let mut failure = QueryFailure::from_host(&error);
                    failure.target = LOG_TARGET.to_string();
                    failure
                })?;
                let described = JsonValue::of(&described).0;
                target_from_json(&described).map_err(|message| QueryFailure::new(FailureKind::Error, message))?
            }
        };
        // Where a statement of a plan of workbook scripts comes from, e.g. `bar.sql 2/3 · inlines foo.sql`
        let mut log_details = Vec::new();
        if let Some(planned) = &description.metadata.planned {
            log_details.push(("planned".to_string(), description.metadata.title.clone().unwrap_or_default()));
            let node = planned.get("node").map(|node| node.as_str().map(str::to_string).unwrap_or_else(|| node.to_string()));
            log_details.push(("node".to_string(), node.unwrap_or_default()));
        }
        Ok(QueryRequest {
            query_id,
            connection_id: connection_id.to_string(),
            text: description.text.clone(),
            target,
            publish_results,
            analyze_results: options.analyze_results == Some(true),
            cache,
            cache_only: options.cache.as_ref().is_some_and(|cache| cache.only),
            // Nothing that runs on Salesforce changes its relations
            touches_relations: description.metadata.user_provided && connector != ConnectorType::SalesforceDataCloud,
            throw_on_error: options.throw_on_error == Some(true),
            failure: description.failure.clone().map(|message| QueryFailure::new(FailureKind::Error, message)),
            log_details,
            keep_alive: None,
        })
    }

    /// Describe a query and run it, the query ended once the future completed. Every step waits on the token of the run:
    /// a cancel before the executor runs the query ends it as cancelled, one while it runs stops it at the backend.
    async fn run(self: &Rc<Self>, run: &Rc<QueryRun>, owner: QueryOwner, description: QueryDescription, failure: JsValue) -> QueryOutcome {
        let outcome = self.run_steps(run, &owner, description, failure).await;
        run.end();
        outcome
    }

    async fn run_steps(self: &Rc<Self>, run: &Rc<QueryRun>, owner: &QueryOwner, description: QueryDescription, failure: JsValue) -> QueryOutcome {
        let query_id = run.query_id;
        let fail = |failure: QueryFailure| {
            let error = query_error(&failure);
            let now = self.now() as i64;
            let action = match failure.kind {
                FailureKind::Cancelled => QueryExecutionAction::QueryCancelled { query_id, error, metrics: None, now },
                _ => QueryExecutionAction::QueryFailed { query_id, error, metrics: None, now },
            };
            let _ = self.apply_query(owner, action, true);
            QueryOutcome::Rejected(failure)
        };
        let token = &run.token;
        let mut request = match token.run(self.describe(query_id, &description)).await {
            None => return fail(QueryFailure::cancelled()),
            Some(Err(failure)) => return fail(failure),
            Some(Ok(request)) => request,
        };
        match token.run(self.load_spec(&mut request)).await {
            None => return fail(QueryFailure::cancelled()),
            Some(Err(message)) => return fail(QueryFailure::new(FailureKind::Error, message)),
            Some(Ok(())) => {}
        }
        if request.analyze_results && !self.platform.has_compute() {
            return fail(QueryFailure::new(FailureKind::Error, "Compute database is not yet ready"));
        }
        if let Some(caller) = request.failure.take() {
            let value: Rc<dyn std::any::Any> = Rc::new(failure);
            request.failure = Some(QueryFailure { value: Some(value), ..caller });
        }
        let Some(executor) = self.executor() else {
            return fail(QueryFailure::new(FailureKind::Error, "the runtime was destroyed"));
        };
        // The executor and its follow-ups hold the run
        let keep_alive: Rc<dyn std::any::Any> = run.clone();
        request.keep_alive = Some(keep_alive);
        let viewers = {
            let mut state = run.state.borrow_mut();
            state.started = true;
            state.profile_viewers
        };
        // A token that was cancelled meanwhile ends the query as cancelled in the executor
        let outcome = executor.execute(request, token.clone());
        for _ in 0..viewers {
            executor.watch_profile(query_id, 1);
        }
        outcome.await
    }

    /// The spec of the client functions of a call: the one that the catalog of its connection registered, so a call
    /// runs only with the spec that the core checked it against. A connector without a binding has no spec, starting
    /// the call names it.
    async fn load_spec(&self, request: &mut QueryRequest) -> Result<(), String> {
        let QueryTarget::ClientFunction(target) = &mut request.target else { return Ok(()) };
        if target.spec.is_some() || ClientFunctionBinding::of_connector(target.connector).is_none() {
            return Ok(());
        }
        // A spec that the registration still loads is awaited
        let spec = self.loader.borrow().as_ref().map(|loader| loader.client_function_spec(&request.connection_id));
        let spec = match spec {
            Some(spec) => spec.await,
            None => None,
        };
        let Some(spec) = spec else {
            return Err(format!("The client functions of {} connections are not registered", target.connector.display_name()));
        };
        target.spec = Some(spec);
        Ok(())
    }

    /// Run a query of the runtime on a connection, e.g. a metadata query of the catalog loader or the probe of a health
    /// check. It is a query of the history of the connection, the platform describes where it runs. Returns its id and
    /// a future of its result: the result table as an Arrow IPC stream if `read` asks for it, empty bytes otherwise,
    /// none for a query without a result. The token cancels the query, it ends as cancelled at the backend.
    pub(crate) fn run_internal(
        self: &Rc<Self>,
        connection_id: &str,
        text: &str,
        metadata: QueryMetadata,
        read_timeout_ms: Option<u32>,
        read: bool,
        cancellation: &CancellationToken,
    ) -> (QueryId, InternalQuery) {
        let owner = QueryOwner::Connection(connection_id.to_string());
        let query_id = self.registry.borrow_mut().next_query_id();
        let description = QueryDescription {
            connection_id: connection_id.to_string(),
            text: text.to_string(),
            metadata: metadata.clone(),
            options: QueryOptions { read_timeout_ms, throw_on_error: Some(true), ..Default::default() },
            failure: None,
        };
        let state = QueryExecutionState::new(query_id, 0, text.to_string(), metadata, self.now() as i64);
        if self.apply_query(&owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true).is_err() {
            let failure = QueryFailure::new(FailureKind::Error, format!("Couldn't find a connection with id {connection_id}"));
            return (query_id, InternalQuery::Ready(Some(Err(failure))));
        }
        let run = self.adopt_run(QueryRun::new(query_id, connection_id, text, Vec::new(), false, &self.platform));
        // The query runs in a task of its own to its end, a caller that stops waiting leaves it to the cancellation
        let (sender, receiver) = oneshot();
        let ended = CancellationToken::new();
        {
            let connections = self.clone();
            let ended = ended.clone();
            let caller = cancellation.clone();
            self.platform.spawn(Box::pin(async move {
                if ended.run(caller.cancelled()).await.is_some() {
                    connections.cancel(query_id).await;
                }
            }));
        }
        let connections = self.clone();
        self.platform.spawn(Box::pin(async move {
            let outcome = connections.run(&run, owner, description, JsValue::UNDEFINED).await;
            ended.cancel();
            // The run owns its result table until it is dropped, the read happens before
            let result = match (outcome, run.result()) {
                (QueryOutcome::Resolved { has_result: true }, Some(table)) if read => {
                    connections.platform.read_table(table).map(Some).map_err(|error| QueryFailure::from_host(&error))
                }
                (QueryOutcome::Resolved { has_result: true }, Some(_)) => Ok(Some(Vec::new())),
                (QueryOutcome::Resolved { .. }, _) => Ok(None),
                (QueryOutcome::Rejected(failure), _) => Err(failure),
            };
            drop(run);
            sender.send(result);
        }));
        (query_id, InternalQuery::Waiting(receiver))
    }

    /// Run a statement of a run of a workbook on its connection. It is a query of the history of the connection, the
    /// platform describes where it runs with the options of the statement (`queries.describe`): the cache, whether it
    /// publishes and analyzes its result, a call of a client function. Returns its id, a future that completes once
    /// its result arrived and a future of its end: whether it has a result, or its failure. A statement that fails may
    /// never complete the first.
    pub(crate) fn run_statement(self: &Rc<Self>, statement: Statement) -> (QueryId, LocalFuture<()>, LocalFuture<Result<bool, QueryFailure>>) {
        let connection_id = statement.connection_id.as_str();
        let owner = QueryOwner::Connection(connection_id.to_string());
        let query_id = self.registry.borrow_mut().next_query_id();
        let description = QueryDescription {
            connection_id: connection_id.to_string(),
            text: statement.text.clone(),
            metadata: statement.metadata.clone(),
            options: QueryOptions {
                analyze_results: Some(statement.analyze_results),
                publish_results: Some(statement.publish_results),
                throw_on_error: Some(true),
                client_function_call: statement.client_function_call.clone().map(JsonValue),
                read_timeout_ms: None,
                cache: statement.cache.as_ref().map(|(signature, refresh, only)| QueryCacheOptions {
                    signature: signature.clone(),
                    refresh: *refresh,
                    only: *only,
                }),
            },
            failure: None,
        };
        let mut log_details = Vec::new();
        if let Some(workbook_id) = &statement.metadata.workbook_id {
            log_details.push(("workbookId".to_string(), workbook_id.clone()));
        }
        let state = QueryExecutionState::new(query_id, 0, statement.text.clone(), statement.metadata, self.now() as i64);
        if let Err(error) = self.apply_query(&owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true) {
            let failure = QueryFailure::new(FailureKind::Error, format!("Couldn't find a connection with id {connection_id}: {}", error.what()));
            return (query_id, Box::pin(std::future::pending()), Box::pin(std::future::ready(Err(failure))));
        }
        let (ready_sender, ready) = oneshot();
        let run = QueryRun::new(query_id, connection_id, &statement.text, log_details, false, &self.platform);
        *run.caller.ready.borrow_mut() = Some(ready_sender);
        let run = self.adopt_run(run);
        // The statement runs in a task of its own to its end, a run that stops waiting cancels it
        let (sender, done) = oneshot();
        let connections = self.clone();
        self.platform.spawn(Box::pin(async move {
            let outcome = connections.run(&run, owner, description, JsValue::UNDEFINED).await;
            drop(run);
            sender.send(match outcome {
                QueryOutcome::Resolved { has_result } => Ok(has_result),
                QueryOutcome::Rejected(failure) => Err(failure),
            });
        }));
        let ready = Box::pin(async move {
            // A statement that ended without its result never releases what follows it early
            if ready.await.is_none() {
                std::future::pending::<()>().await;
            }
        });
        let done = Box::pin(async move { done.await.unwrap_or_else(|| Err(QueryFailure::cancelled())) });
        (query_id, ready, done)
    }

    /// Cancel a query right away: its token is cancelled, a query that the executor runs stops at the backend, one that
    /// the host tracks is aborted through its record
    pub(crate) fn cancel_now(&self, query_id: QueryId) {
        let Some(run) = self.run_of(query_id) else {
            // A query of a computation aborts the call of its run
            if self.computations.host().stop(query_id) {
                return;
            }
            // A query that the host tracks is aborted through its record
            let history = self.registry.borrow().query_history(query_id).map(|(_, history)| history);
            let handle = history.and_then(|history| history.borrow().active(query_id).and_then(|query| query.handle));
            if let Some(handle) = handle {
                let effect = dashql_core_runtime::connections::registry::RegistryEffect::Abort { handle, reason: "Query was cancelled" };
                self.platform.push_registry_effects(&[effect]);
                self.platform.signal(true);
            }
            return;
        };
        // The executor cancels a channel of the host at the backend within the call, the token stops the rest
        match self.executor().filter(|executor| executor.is_running(query_id)) {
            Some(executor) => drop(executor.cancel(query_id)),
            None => run.token.cancel(),
        }
    }

    /// Cancel a query, see `cancel_now`. Resolves once a query of the runtime ended, before the executor ran it or after.
    pub(crate) fn cancel(&self, query_id: QueryId) -> impl Future<Output = ()> + 'static {
        self.cancel_now(query_id);
        let ended = self.run_of(query_id).map(|run| run.ended());
        async move {
            if let Some(ended) = ended {
                ended.await;
            }
        }
    }

    /// A view starts (1) or stops (-1) showing the profile of a query
    pub(crate) fn watch_profile(&self, query_id: QueryId, delta: i32) {
        let started = self.run_of(query_id).map(|run| {
            let mut state = run.state.borrow_mut();
            if !state.started {
                state.profile_viewers = (state.profile_viewers + delta).max(0);
            }
            state.started
        });
        if started == Some(true) {
            if let Some(executor) = self.executor() {
                executor.watch_profile(query_id, delta);
            }
        }
    }
}

/// A future of the runtime
pub(crate) type LocalFuture<T> = Pin<Box<dyn Future<Output = T>>>;

/// A statement of a run of a workbook
pub(crate) struct Statement {
    pub connection_id: String,
    pub text: String,
    pub metadata: QueryMetadata,
    /// A call of a client function as JSON, it runs instead of the text
    pub client_function_call: Option<serde_json::Value>,
    pub analyze_results: bool,
    pub publish_results: bool,
    /// The query result cache: the signature of the key, whether the statement refreshes the key, and whether it only
    /// reads the cache
    pub cache: Option<(String, bool, bool)>,
}

/// The result of a query that the runtime runs itself: its result table as an Arrow IPC stream, or its failure
pub(crate) enum InternalQuery {
    /// The query failed before it ran
    Ready(Option<Result<Option<Vec<u8>>, QueryFailure>>),
    /// The query runs in a task of its own
    Waiting(Receiver<Result<Option<Vec<u8>>, QueryFailure>>),
}

impl Future for InternalQuery {
    type Output = Result<Option<Vec<u8>>, QueryFailure>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match self.get_mut() {
            InternalQuery::Ready(result) => Poll::Ready(result.take().unwrap_or_else(|| Err(QueryFailure::cancelled()))),
            InternalQuery::Waiting(receiver) => Pin::new(receiver).poll(cx).map(|result| result.unwrap_or_else(|| Err(QueryFailure::cancelled()))),
        }
    }
}
