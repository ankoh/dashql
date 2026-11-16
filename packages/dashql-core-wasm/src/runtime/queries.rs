//! The queries of the runtime: the host of the query executor of the crate, the command that runs a query and the
//! views of a query (docs/wip/runtime_api.md).
//!
//! A query of a connection is in the history of the connection from the start: `executeQuery` hands out its id from
//! the registry, registers it and runs it once the runtime described it (`Connections::describe`): the target on the
//! channel of its connection, the key of its result in the query result cache (`result_key`, the SHA-256 digest
//! through `crypto` of the platform) and what the executor does around it. The platform only describes the channel
//! (`channels.describe`): a channel that the module speaks, or one of the host that it keeps for the query until the
//! query is forgotten (`channels.forget`). The executor reports every event into the history right away. What stays with the host goes through the platform:
//! fetch, the channels of the host, the query result cache, the result tables by handle. The analysis of a result runs
//! on the computations of the runtime, a result replaces the computation of the earlier result of its owner.
//!
//! The result of a query never lives in the module: its parts go into a table of the platform as they arrive
//! (`tables.open` and `tables.push`), the channels of the host push their batches into it, the platform builds the
//! table at the end (`tables.finish`). The history takes the table by its handle, the analysis takes a handle of its
//! own.
//!
//! The runtime runs queries of its own as well (`run_internal`): the metadata queries of the catalog loader and the
//! probes of the health checks, and the statements of the runs of workbooks (`run_statement`). They are queries of
//! their connection like the others and are described in the same way. The specs of the client functions come from the platform (`extensions`) when a call
//! runs.

use std::pin::Pin;
use std::rc::{Rc, Weak};
use std::task::{Context, Poll};

use dashql_core_runtime::compute::service::AnalysisHandles;
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions as RuntimeAnalyzeOptions;
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::clfn::{ClientFunctionBinding, ClientFunctionCallDescription, ClientFunctionSpec};
use dashql_core_runtime::connections::registry::QueryOwner;
use dashql_core_runtime::connections::{ConnectionAction, ConnectorType};
use dashql_core_runtime::executor::cache_key::{connection_cache_signature, result_key_input, result_key_of_digest};
use dashql_core_runtime::executor::json::{failure_json, target_from_json, SpecCache};
use dashql_core_runtime::executor::{
    CacheEntry, CacheRequest, ChannelMessage, ClientFunctionTarget, ExecutorHost, FailureKind, HostTable, QueryEvent, QueryFailure, QueryId, QueryOutcome, QueryRequest,
    QueryTarget,
};
use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::signal::{oneshot, Receiver, Sender};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::{Body, CancellationToken, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::salesforce::SalesforceTokens;
use dashql_core_runtime::query::{QueryError, QueryExecutionAction, QueryExecutionProgress, QueryExecutionState, QueryMetadata, QueryResultTable};
use js_sys::{Function, Object, Promise, Reflect, Uint8Array};
use serde::{Deserialize, Serialize};
use std::future::Future;
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use super::connections::Connections;
use crate::host::{field, host_table, host_value, lifetime_token, JsPlatform};
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

/// What the runtime keeps of a query that the executor runs
pub(crate) struct QueryRun {
    pub connection_id: String,
    pub text: String,
    /// The table that the parts of the result stream into
    pub table: Option<Handle>,
    /// The result table once it is finished, the run owns it until the history takes it
    pub result: Option<Handle>,
    /// Did the history take the result table?
    pub in_history: bool,
    /// The events of the caller: the timings, the result before its analysis, a refreshed token of Trino
    pub events: Option<Function>,
    /// The owner of the result, its computation replaces the one of the earlier result of the owner
    pub result_owner: Option<String>,
    /// The details of the log messages of the query: the trace, the span and the workbook
    pub log_details: Vec<(String, String)>,
    /// Was the query failed by the caller before it ran?
    pub preset_failure: bool,
    /// Was the query cancelled before the executor ran it?
    pub cancelled: bool,
    /// Does the executor run it?
    pub started: bool,
    /// The views that show the profile of the query before it started
    pub profile_viewers: i32,
    /// Hears that the result arrived, before its analysis: a statement of a run of a workbook
    pub ready: Option<Sender<()>>,
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
    /// The run of a query, cloned out of the borrow
    fn run_of<R>(&self, query_id: QueryId, read: impl FnOnce(&mut QueryRun) -> R) -> Option<R> {
        self.runs.borrow_mut().iter_mut().find(|(id, _)| *id == query_id).map(|(_, run)| read(run))
    }

    /// The table that the result of a query streams into, opened with the first part
    fn table_of(&self, query_id: QueryId) -> Result<Handle, HostError> {
        if let Some(Some(table)) = self.run_of(query_id, |run| run.table) {
            return Ok(table);
        }
        let table = self.platform.open_table()?;
        let kept = self.run_of(query_id, |run| run.table.get_or_insert(table).to_owned());
        match kept {
            Some(kept) => Ok(kept),
            None => {
                self.platform.push_release(table);
                Err(HostError::new(format!("unknown query {query_id}")))
            }
        }
    }

    /// Log a message of a query with its trace
    fn log_query(&self, query_id: QueryId, level: LogLevel, message: &str, details: &[(String, String)], target: &str) {
        let mut all: Vec<(String, String)> = self.run_of(query_id, |run| run.log_details.clone()).unwrap_or_default();
        all.extend(details.iter().cloned());
        let pairs: Vec<(&str, &str)> = all.iter().map(|(key, value)| (key.as_str(), value.as_str())).collect();
        self.platform.log_on(level, message, &pairs, target);
    }

    /// Tell the caller of a query about an event, an observer that throws changes nothing
    fn notify(&self, query_id: QueryId, event: JsValue) {
        if let Some(Some(events)) = self.run_of(query_id, |run| run.events.clone()) {
            let _ = events.call1(&JsValue::NULL, &event);
        }
    }

    /// Apply an event of the executor to the history of its query
    pub(crate) fn report(self: &Rc<Self>, query_id: QueryId, event_: QueryEvent) {
        let Some((connection_id, preset_failure)) = self.run_of(query_id, |run| (run.connection_id.clone(), run.preset_failure)) else {
            return;
        };
        let owner = QueryOwner::Connection(connection_id.clone());
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
                    self.log_query(query_id, LogLevel::Warn, "Failed to keep a part of a result", &[("error".into(), error.message().into())], LOG_TARGET);
                }
                return;
            }
            QueryEvent::ReceivedBatch(metrics) => {
                let _ = self.apply_query(&owner, QueryExecutionAction::QueryReceivedBatch { query_id, metrics, now }, false);
                return;
            }
            QueryEvent::ReceivedAllBatches { rows, metrics } => {
                let table = self.run_of(query_id, |run| {
                    let table = run.result.filter(|_| !run.in_history);
                    run.in_history |= table.is_some();
                    table
                });
                let Some(Some(table)) = table else { return };
                QueryExecutionAction::QueryReceivedAllBatches { query_id, table: QueryResultTable { id: table, rows }, metrics, now }
            }
            QueryEvent::ProcessingResults => QueryExecutionAction::QueryProcessingResults { query_id, now },
            QueryEvent::ProcessedResults => QueryExecutionAction::QueryProcessedResults { query_id, now },
            QueryEvent::Succeeded => QueryExecutionAction::QuerySucceeded { query_id, now },
            QueryEvent::Failed { failure, metrics } => {
                // The preset failure and a failed analysis are logged already. The failed run shows the error inline, the
                // log keeps it as a warning.
                if !preset_failure && failure.kind != FailureKind::Processing {
                    let mut details = failure.details.clone();
                    details.push(("queryId".into(), query_id.to_string()));
                    self.log_query(query_id, LogLevel::Warn, &failure.message, &details, &failure.target);
                }
                QueryExecutionAction::QueryFailed { query_id, error: query_error(&failure), metrics, now }
            }
            QueryEvent::Cancelled { failure, metrics } => {
                // A query that was cancelled while its result was analyzed keeps no computation
                if self.computations.read(|state| state.computation(query_id).is_some()) {
                    self.delete_computation(query_id);
                }
                QueryExecutionAction::QueryCancelled { query_id, error: query_error(&failure), metrics, now }
            }
            QueryEvent::CacheRecorded { key, served_from_cache, cached_at } => {
                QueryExecutionAction::QueryCacheRecorded { query_id, cache_key: key, served_from_cache, cached_at: cached_at.map(|at| at as i64) }
            }
            QueryEvent::TouchRelations => {
                let Some(text) = self.run_of(query_id, |run| run.text.clone()) else { return };
                let touched = dashql_core_script::touched_relations::touched_relations(&text).relations.unwrap_or_default();
                if !touched.is_empty() {
                    // Following the catalog must not change the outcome of the statement
                    if let Err(error) = self.apply(&connection_id, ConnectionAction::RelationsTouched(touched), None) {
                        let details = [("query".into(), query_id.to_string()), ("error".into(), error.what().to_string())];
                        self.log_query(query_id, LogLevel::Warn, "Failed to read the relations of a statement", &details, LOG_TARGET);
                    }
                }
                return;
            }
            QueryEvent::Timing { label, elapsed_ms } => {
                self.notify(query_id, event("timing", &[("label", JsValue::from_str(label)), ("elapsedMs", JsValue::from_f64(elapsed_ms))]));
                return;
            }
            QueryEvent::ResultsReady => {
                if let Some(Some(ready)) = self.run_of(query_id, |run| run.ready.take()) {
                    ready.send(());
                }
                self.notify(query_id, event("resultsReady", &[]));
                return;
            }
            QueryEvent::Log { level, message, details, target } => {
                self.log_query(query_id, level, &message, &details, &target);
                return;
            }
            QueryEvent::TrinoTokenRefreshed(token) => {
                let token = JsonValue(token.to_json()).to_js().unwrap_or(JsValue::NULL);
                self.notify(query_id, event("trinoTokenRefreshed", &[("token", token)]));
                return;
            }
        };
        if let Err(error) = self.apply_query(&owner, action, true) {
            self.log_query(query_id, LogLevel::Debug, "A query event changed nothing", &[("error".into(), error.what().to_string())], LOG_TARGET);
        }
    }

    /// Analyze the result of a query on the computations: the result replaces the computation of the earlier result of
    /// its owner once it is analyzed
    fn analyze(self: &Rc<Self>, query_id: QueryId) -> impl Future<Output = Result<(), HostError>> + 'static {
        let connections = self.clone();
        async move {
            let Some((Some(table), connection_id, owner)) =
                connections.run_of(query_id, |run| (run.result, run.connection_id.clone(), run.result_owner.clone()))
            else {
                return Ok(());
            };
            // The analysis computes on the compute database, a query without one has nothing to analyze
            if !connections.platform.has_compute() {
                return Ok(());
            }
            let ipc = connections.platform.read_table(table)?;
            let result = ResultTable::from_ipc_stream(&ipc).map_err(|e| HostError::new(e.message))?;
            if result.schema().fields().is_empty() {
                return Ok(());
            }
            let handles = AnalysisHandles { table: connections.platform.duplicate(table)?, lifetime: connections.platform.register(&lifetime_token())? };
            let analysis = connections.computations.analyze_table(query_id, result, handles, Some(connection_id), None, RuntimeAnalyzeOptions::default());
            if let Err(error) = analysis.await {
                // The previous result of the owner stays
                connections.delete_computation(query_id);
                return Err(HostError::new(error.what().to_string()));
            }
            if let Some(unused) = owner.and_then(|owner| connections.retain_result(&owner, query_id)) {
                connections.delete_computation(unused);
            }
            Ok(())
        }
    }

    /// Forget a query that ended, the tables that nothing took are released
    fn forget(&self, query_id: QueryId) {
        let run = {
            let mut runs = self.runs.borrow_mut();
            let index = runs.iter().position(|(id, _)| *id == query_id);
            index.map(|index| runs.swap_remove(index).1)
        };
        // The platform lets go of the channel of the query
        self.platform.forget_channel_query(query_id as f64);
        let Some(run) = run else { return };
        if let Some(table) = run.table {
            self.platform.push_release(table);
        }
        if let Some(result) = run.result.filter(|_| !run.in_history) {
            self.platform.push_release(result);
        }
        self.platform.signal(false);
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
            let kept = connections.upgrade().and_then(|connections| connections.run_of(query_id, |run| run.result = Some(table)));
            if kept.is_none() {
                platform.push_release(table);
                return Err(HostError::new(format!("unknown query {query_id}")));
            }
            Ok(host_table(&value))
        }
    }

    fn cache_touch(&self, _query_id: QueryId, entry: &CacheEntry) -> impl Future<Output = Result<(), HostError>> + 'static {
        self.platform.cache_touch(&entry.name)
    }

    fn cache_write(&self, query_id: QueryId, key: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let table = self.connections.upgrade().and_then(|connections| connections.run_of(query_id, |run| run.result)).flatten();
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

    fn analyze_result(&self, query_id: QueryId) -> impl Future<Output = Result<(), HostError>> + 'static {
        let analysis = self.connections().map(|connections| connections.analyze(query_id));
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
            connections.run_of(query_id, |run| {
                run.table = None;
                // A table that didn't finish is released with the run
                match &finished {
                    Ok(_) => run.result = Some(table),
                    Err(_) => run.table = Some(table),
                }
            });
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
        let result_owner = args.metadata.result_owner.clone();
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
        self.runs.borrow_mut().push((
            query_id,
            QueryRun {
                connection_id: connection_id.to_string(),
                text: args.text.clone(),
                table: None,
                result: None,
                in_history: false,
                events,
                result_owner,
                log_details,
                preset_failure,
                cancelled: false,
                started: false,
                profile_viewers: 0,
                ready: None,
            },
        ));
        let description = QueryDescription {
            connection_id: connection_id.to_string(),
            text: args.text,
            metadata,
            options: args.options,
            failure: preset_failure.then(|| crate::host::message_of(&failure)),
        };
        let connections = self.clone();
        let done = wasm_bindgen_futures::future_to_promise(async move {
            let outcome = connections.run(query_id, owner, description, failure).await;
            let table = match &outcome {
                QueryOutcome::Resolved { has_result: true } => connections
                    .run_of(query_id, |run| run.result)
                    .flatten()
                    .map(|table| connections.platform.handle(table))
                    .unwrap_or(JsValue::NULL),
                _ => JsValue::NULL,
            };
            connections.forget(query_id);
            Ok(outcome_value(outcome, table))
        });
        (query_id, done)
    }

    /// The key of the results of a script signature on a connection in the query result cache, none without a cache or
    /// before the connection has the params of a setup. The key derives from the params of the connector that identify
    /// its results, the platform computes the SHA-256 digest.
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
        let connection = {
            let registry = self.registry.borrow();
            registry.get(connection_id).and_then(|connection| {
                let state = connection.state.try_borrow().ok()?;
                Some((state.connector_type(), state.details().channel))
            })
        };
        let Some((connector, channel)) = connection else {
            return Err(QueryFailure::new(FailureKind::Error, format!("Couldn't find a connection with id {connection_id}")));
        };
        let options = &description.options;
        // The cache holds Parquet files that the compute database writes and reads
        let cache = match &options.cache {
            Some(cache) if self.platform.has_cache() && self.platform.has_mounts() => {
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
        let query = serde_wasm_bindgen::to_value(&query).map_err(|error| QueryFailure::new(FailureKind::Error, error.to_string()))?;
        let described = self.platform.channel_describe(query_id as f64, channel, &query).await.map_err(|error| {
            let mut failure = QueryFailure::from_host(&error);
            failure.target = LOG_TARGET.to_string();
            failure
        })?;
        let described = JsonValue::of(&described).0;
        let target = match &options.client_function_call {
            // The runtime loads the spec of the connector through the extensions of the platform
            Some(call) => {
                let description = ClientFunctionCallDescription::from_value(call.0.clone())
                    .map_err(|error| QueryFailure::new(FailureKind::Error, error.message))?;
                let tokens = described.get("tokens").and_then(|tokens| {
                    let core = tokens.get("core")?;
                    let data_cloud = tokens.get("dataCloud")?;
                    SalesforceTokens::from_json(&core.to_string(), &data_cloud.to_string())
                });
                QueryTarget::ClientFunction(ClientFunctionTarget { connector, spec: None, description, tokens })
            }
            None => target_from_json(&described, &mut SpecCache::default()).map_err(|message| QueryFailure::new(FailureKind::Error, message))?,
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
        })
    }

    /// Describe a query and run it
    async fn run(self: &Rc<Self>, query_id: QueryId, owner: QueryOwner, description: QueryDescription, failure: JsValue) -> QueryOutcome {
        let now = || self.now() as i64;
        let fail = |failure: QueryFailure, kind: &'static str| {
            let error = query_error(&failure);
            let action = match kind {
                "cancelled" => QueryExecutionAction::QueryCancelled { query_id, error, metrics: None, now: now() },
                _ => QueryExecutionAction::QueryFailed { query_id, error, metrics: None, now: now() },
            };
            let _ = self.apply_query(&owner, action, true);
            QueryOutcome::Rejected(failure)
        };
        let described = self.describe(query_id, &description).await;
        if self.run_of(query_id, |run| run.cancelled).unwrap_or(true) {
            return fail(QueryFailure::cancelled(), "cancelled");
        }
        let mut request = match described {
            Ok(request) => request,
            Err(failure) => return fail(failure, "failed"),
        };
        if let Err(message) = self.load_spec(&mut request).await {
            return fail(QueryFailure::new(FailureKind::Error, message), "failed");
        }
        if request.analyze_results && !self.platform.has_compute() {
            return fail(QueryFailure::new(FailureKind::Error, "Compute database is not yet ready"), "failed");
        }
        if let Some(caller) = request.failure.take() {
            let value: Rc<dyn std::any::Any> = Rc::new(failure);
            request.failure = Some(QueryFailure { value: Some(value), ..caller });
        }
        let Some(executor) = self.executor() else {
            return fail(QueryFailure::new(FailureKind::Error, "the runtime was destroyed"), "failed");
        };
        let viewers = self.run_of(query_id, |run| {
            run.started = true;
            run.profile_viewers
        });
        let outcome = executor.execute(request);
        for _ in 0..viewers.unwrap_or(0) {
            executor.watch_profile(query_id, 1);
        }
        outcome.await
    }

    /// The spec of the client functions of a call, from the extension of its connector. A connector without a binding
    /// has no spec, starting the call names it.
    async fn load_spec(&self, request: &mut QueryRequest) -> Result<(), String> {
        let QueryTarget::ClientFunction(target) = &mut request.target else { return Ok(()) };
        if target.spec.is_some() {
            return Ok(());
        }
        let Some(binding) = ClientFunctionBinding::of_connector(target.connector) else { return Ok(()) };
        let extension = binding.extension();
        let cached = self.specs.borrow().iter().find(|(name, _)| *name == extension).map(|(_, spec)| spec.clone());
        let spec = match cached {
            Some(spec) => spec,
            None => {
                let text = self.platform.load_spec(extension).await.map_err(|error| error.message().to_string())?;
                let spec = Rc::new(ClientFunctionSpec::from_json(&text).map_err(|error| error.message)?);
                let mut specs = self.specs.borrow_mut();
                specs.retain(|(name, _)| *name != extension);
                specs.push((extension, spec.clone()));
                spec
            }
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
        let registered = self.apply_query(&owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true);
        if registered.is_ok() {
            self.runs.borrow_mut().push((
                query_id,
                QueryRun {
                    connection_id: connection_id.to_string(),
                    text: text.to_string(),
                    table: None,
                    result: None,
                    in_history: false,
                    events: None,
                    result_owner: None,
                    log_details: Vec::new(),
                    preset_failure: false,
                    cancelled: false,
                    started: false,
                    profile_viewers: 0,
                    ready: None,
                },
            ));
        }
        let connections = self.clone();
        let token = cancellation.clone();
        if registered.is_err() {
            let failure = QueryFailure::new(FailureKind::Error, format!("Couldn't find a connection with id {connection_id}"));
            return (query_id, InternalQuery::Ready(Some(Err(failure))));
        };
        // The query runs in a task of its own to its end, a caller that stops waiting leaves it to the cancellation
        let (sender, receiver) = oneshot();
        let ended = CancellationToken::new();
        {
            let connections = connections.clone();
            let ended = ended.clone();
            self.platform.spawn(Box::pin(async move {
                if ended.run(token.cancelled()).await.is_some() {
                    connections.cancel(query_id).await;
                }
            }));
        }
        self.platform.spawn(Box::pin(async move {
            let outcome = connections.run(query_id, owner, description, JsValue::UNDEFINED).await;
            ended.cancel();
            // The table is read before the run is forgotten, the run releases a table that the history didn't take
            let table = connections.run_of(query_id, |run| run.result).flatten();
            let result = match (outcome, table) {
                (QueryOutcome::Resolved { has_result: true }, Some(table)) if read => {
                    connections.platform.read_table(table).map(Some).map_err(|error| QueryFailure::from_host(&error))
                }
                (QueryOutcome::Resolved { has_result: true }, Some(_)) => Ok(Some(Vec::new())),
                (QueryOutcome::Resolved { .. }, _) => Ok(None),
                (QueryOutcome::Rejected(failure), _) => Err(failure),
            };
            connections.forget(query_id);
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
        let result_owner = statement.metadata.result_owner.clone();
        let state = QueryExecutionState::new(query_id, 0, statement.text.clone(), statement.metadata, self.now() as i64);
        if let Err(error) = self.apply_query(&owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true) {
            let failure = QueryFailure::new(FailureKind::Error, format!("Couldn't find a connection with id {connection_id}: {}", error.what()));
            return (query_id, Box::pin(std::future::pending()), Box::pin(std::future::ready(Err(failure))));
        }
        let (ready_sender, ready) = oneshot();
        self.runs.borrow_mut().push((
            query_id,
            QueryRun {
                connection_id: connection_id.to_string(),
                text: statement.text,
                table: None,
                result: None,
                in_history: false,
                events: None,
                result_owner,
                log_details,
                preset_failure: false,
                cancelled: false,
                started: false,
                profile_viewers: 0,
                ready: Some(ready_sender),
            },
        ));
        // The statement runs in a task of its own to its end, a run that stops waiting cancels it
        let (sender, done) = oneshot();
        let connections = self.clone();
        self.platform.spawn(Box::pin(async move {
            let outcome = connections.run(query_id, owner, description, JsValue::UNDEFINED).await;
            connections.forget(query_id);
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

    /// Cancel a query: one that the executor runs stops at the backend, one that waits for its description ends as
    /// cancelled, one that the host tracks is aborted through its record. Resolves once a query of the executor ended.
    pub(crate) fn cancel(&self, query_id: QueryId) -> impl Future<Output = ()> + 'static {
        let pending = self.run_of(query_id, |run| {
            let pending = !run.started;
            run.cancelled = true;
            pending
        });
        if pending.is_none() {
            // A query that the host tracks is aborted through its record
            let history = self.registry.borrow().query_history(query_id).map(|(_, history)| history);
            let handle = history.and_then(|history| history.borrow().active(query_id).and_then(|query| query.handle));
            if let Some(handle) = handle {
                let effect = dashql_core_runtime::connections::registry::RegistryEffect::Abort { handle, reason: "Query was cancelled" };
                self.platform.push_registry_effects(&[effect]);
                self.platform.signal(true);
            }
        }
        let cancelled = self.executor().map(|executor| executor.cancel(query_id));
        async move {
            if let Some(cancelled) = cancelled {
                cancelled.await;
            }
        }
    }

    /// A view starts (1) or stops (-1) showing the profile of a query
    pub(crate) fn watch_profile(&self, query_id: QueryId, delta: i32) {
        let started = self.run_of(query_id, |run| {
            if !run.started {
                run.profile_viewers = (run.profile_viewers + delta).max(0);
            }
            run.started
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
