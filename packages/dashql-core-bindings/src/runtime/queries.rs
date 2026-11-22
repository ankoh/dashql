//! The queries of the runtime: the host of the query executor of the crate, the command that runs a query and the
//! views of a query (docs/design/dashql_core.md).
//!
//! A query of a connection is in the history of the connection from the start: `executeQuery` hands out its id from
//! the registry, registers it and runs it once the runtime described it (`Connections::describe`): the target on the
//! channel of its connection, the key of its result in the query result cache (`result_key`, the SHA-256 digest
//! through `crypto` of the platform) and what the executor does around it. The connection owns its channel: the module
//! speaks Trino, Hyper over HTTP and the Hyper of Salesforce itself, the platform describes only a channel of the host
//! (`channels.describe`), which it keeps for the query until the run of the query is dropped (`channels.forget`). The
//! executor reports every event into the history right away, the start and the end of a query as urgent changes, the
//! rest with the next frame. What stays with the host goes through the platform: fetch, the channels of the host, the
//! query result cache, the result tables by handle. The analysis of a result runs on the computations of the runtime,
//! the history decides which result of an owner is the latest and the computations of the others go.
//!
//! Every query is one `QueryRun`, the run of the executor (`ExecutorRun`): the executor hands it to every call of its
//! host, so the host never looks a query up by its id. Its token is the one cancellation of the query, see there.
//!
//! The result of a query never lives in the module: its parts go into a table of the platform as they arrive
//! (`tables.open` and `tables.push`), the channels of the host push their batches into it, the platform builds the
//! table at the end (`tables.finish`). The run owns the table, the history and the analysis take handles of their own,
//! the analysis reads only its rows and its schema (`tables.describe`).
//!
//! The runtime runs queries of its own as well (`run_internal`): the metadata queries of the catalog loader and the
//! probes of the health checks, and the statements of the runs of workbooks (`run_statement`). They are queries of
//! their connection like the others and are described in the same way. The specs of the client functions come from
//! the platform (`extensions`) when a call runs.

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::pin::Pin;
use std::rc::{Rc, Weak};
use std::task::{Context, Poll};

use dashql_core_runtime::clfn::{client_function_binding, ClientFunctionCallDescription};
use dashql_core_runtime::compute::service::AnalysisHandles;
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions as RuntimeAnalyzeOptions;
use dashql_core_runtime::connections::{ConnectionAction, ConnectionChannel, ConnectorType, DetailedError};
use dashql_core_runtime::executor::cache_key::{connection_cache_signature, result_key_input, result_key_of_digest};
use dashql_core_runtime::executor::{
    ChannelMessage, ClientFunctionTarget, ExecutorHost, ExecutorRun, FailureKind, HostTable, QueryControls, QueryEvent,
    QueryFailure, QueryId, QueryOutcome, QueryRequest, QueryTarget, ResultRequest, StoredFile,
};
use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::signal::{oneshot, Receiver, Sender};
use dashql_core_runtime::host::{Host, HostError, LogLevel, OnHost};
use dashql_core_runtime::http::{Body, CancellationToken, Headers, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::query::{
    QueryError, QueryExecutionAction, QueryExecutionProgress, QueryExecutionState, QueryMetadata, QueryResultTable,
};
use dashql_core_runtime::salesforce::SharedSalesforceChannel;
use dashql_core_runtime::trino::TimeZoneOffsets;
use js_sys::{Function, Promise, Uint8Array};
use serde::{Deserialize, Serialize};
use std::future::Future;
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use super::connections::Connections;
use super::results;
use crate::host::{field, host_value, lifetime_token, IntlTimeZones, JsPlatform, RuntimeChannelTarget};
use crate::query_history::view::{QueryMetadataView, QueryProgressView, QueryStreamMetrics};
use crate::views::{to_js, JsonValue};

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
    /// The stored result of the script of the query, none for a query of no script
    #[serde(default)]
    #[tsify(optional)]
    pub result: Option<QueryResultOptions>,
}

/// The stored result of the script of a query (docs/design/workbook_results.md)
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultOptions {
    /// The workbook of the script
    pub workbook_id: String,
    /// The file name of the script
    pub script: String,
    /// The result key of the script, the file of the result is named after it
    pub key: String,
    /// The name of the file of the result, the run names it when it plans
    pub name: String,
    /// Read this file of the results of the workbook instead of running the query, fail with a miss if it is gone
    #[serde(default)]
    #[tsify(optional)]
    pub read: Option<QueryResultFile>,
}

/// A file of the results of a workbook
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultFile {
    /// The file name
    pub name: String,
    /// The key in its name
    pub key: String,
    /// When it was written, in milliseconds since the epoch
    pub written_at: f64,
}

impl From<&ResultRequest> for QueryResultOptions {
    fn from(result: &ResultRequest) -> Self {
        QueryResultOptions {
            workbook_id: result.workbook_id.clone(),
            script: result.script.clone(),
            key: result.key.clone(),
            name: result.name.clone(),
            read: result.read.as_ref().map(|file| QueryResultFile {
                name: file.name.clone(),
                key: file.key.clone(),
                written_at: file.written_at,
            }),
        }
    }
}

impl From<&QueryResultOptions> for ResultRequest {
    fn from(result: &QueryResultOptions) -> Self {
        ResultRequest {
            workbook_id: result.workbook_id.clone(),
            script: result.script.clone(),
            key: result.key.clone(),
            name: result.name.clone(),
            read: result.read.as_ref().map(|file| StoredFile {
                name: file.name.clone(),
                key: file.key.clone(),
                written_at: file.written_at,
            }),
        }
    }
}

/// A query that runs: its id and its outcome
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct QueryTicket {
    pub query_id: f64,
    #[serde(serialize_with = "serde_wasm_bindgen::preserve::serialize")]
    #[tsify(type = "Promise<QueryRunOutcome>")]
    pub done: JsValue,
}

/// How a query ended for its caller: resolved with the result table, or rejected with the failure and what the host
/// failed with
#[derive(Serialize, Tsify)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(hashmap_as_object)]
pub enum QueryRunOutcome {
    Resolved {
        has_result: bool,
        /// The result table, null without a result
        #[serde(serialize_with = "serde_wasm_bindgen::preserve::serialize")]
        #[tsify(type = "unknown")]
        table: JsValue,
    },
    Rejected {
        failure: QueryRunFailure,
        /// What the host failed with, undefined for a failure of the module
        #[serde(serialize_with = "serde_wasm_bindgen::preserve::serialize")]
        #[tsify(type = "unknown")]
        value: JsValue,
    },
}

/// The kind of the failure of a query
#[derive(Clone, Copy, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum QueryRunFailureKind {
    Error,
    Cancelled,
    CacheMiss,
    Processing,
}

/// The failure of a query, `hostValue` tells whether `value` of the outcome is what the host failed with
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct QueryRunFailure {
    pub kind: QueryRunFailureKind,
    pub message: String,
    #[tsify(type = "Record<string, string>")]
    pub details: BTreeMap<String, String>,
    pub target: String,
    pub host_value: bool,
}

impl From<&QueryFailure> for QueryRunFailure {
    fn from(failure: &QueryFailure) -> Self {
        QueryRunFailure {
            kind: match failure.kind {
                FailureKind::Error => QueryRunFailureKind::Error,
                FailureKind::Cancelled => QueryRunFailureKind::Cancelled,
                FailureKind::CacheMiss => QueryRunFailureKind::CacheMiss,
                FailureKind::Processing => QueryRunFailureKind::Processing,
            },
            message: failure.message.clone(),
            details: failure.details.iter().cloned().collect(),
            target: failure.target.clone(),
            host_value: failure.value.is_some(),
        }
    }
}

/// What the caller of a query hears while it runs: the timings and the result before its analysis
#[derive(Serialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum QueryCallerEvent {
    Timing { label: String, elapsed_ms: f64 },
    ResultsReady,
}

/// A query that the runtime describes before the executor runs it: its connection, the text and the metadata of the
/// history, and the options of the caller
struct QueryDescription {
    connection_id: String,
    text: String,
    metadata: QueryMetadata,
    options: QueryOptions,
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
/// The command that runs the query holds it, so do the executor and its follow-ups after the end of the query (the
/// write of its result into the cache, the touch of a cached entry); the runs of the connections know it weakly. Its
/// token is the one cancellation of the query: a cancel, a reset of its connection and a caller that stops waiting
/// cancel it, before the executor runs the query or while it does, and the executor stops a channel of the host with
/// it, also one that still opens the query. Its controls count the views of its profile from the start. The run owns
/// its result table, the history and the analysis take handles of their own; once the last holder lets go, the run
/// releases its tables and the platform forgets the channel of the query.
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
    /// The setup epoch of the channel that the query was described on, none before. A failed refresh of a token of that
    /// channel fails the connection only while it keeps the channel.
    channel_epoch: Cell<Option<u64>>,
    /// The views of the profile of the query
    controls: QueryControls,
    /// What the caller hears
    caller: QueryCaller,
    /// The tables and the steps of the query
    state: RefCell<RunState>,
    platform: JsPlatform,
}

/// What the caller of a query hears, apart from what the platform keeps: the timings and the result before its
/// analysis, and the end of the query for those who wait for it
#[derive(Default)]
struct QueryCaller {
    /// The events of the caller: the timings and the result before its analysis
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
    /// Did the query end?
    ended: bool,
}

impl QueryRun {
    fn new(
        query_id: QueryId,
        connection_id: &str,
        text: &str,
        log_details: Vec<(String, String)>,
        preset_failure: bool,
        platform: &JsPlatform,
    ) -> Self {
        QueryRun {
            query_id,
            connection_id: connection_id.to_string(),
            text: text.to_string(),
            log_details,
            preset_failure,
            token: CancellationToken::new(),
            channel_epoch: Cell::new(None),
            controls: QueryControls::default(),
            caller: QueryCaller::default(),
            state: RefCell::new(RunState::default()),
            platform: platform.clone(),
        }
    }

    /// The result table that the run owns, none before the result arrived
    fn result(&self) -> Option<Handle> {
        self.state.borrow().result
    }

    /// Own a result table, the one before is released
    fn adopt_result(&self, table: Handle) {
        let previous = self.state.borrow_mut().result.replace(table);
        if let Some(previous) = previous.filter(|previous| *previous != table) {
            self.platform.push_release(previous);
            self.platform.signal(false);
        }
    }

    /// The table that the result streams into, opened with the first part
    fn stream_table(&self) -> Result<Handle, HostError> {
        let table = self.state.borrow().table;
        if let Some(table) = table {
            return Ok(table);
        }
        let table = self.platform.open_table()?;
        self.state.borrow_mut().table = Some(table);
        Ok(table)
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

    /// Tell the caller about an event, an observer that throws changes nothing
    fn notify(&self, event: &QueryCallerEvent) {
        if let (Some(events), Ok(event)) = (&self.caller.events, to_js(event)) {
            let _ = events.call1(&JsValue::NULL, &event.into());
        }
    }
}

impl ExecutorRun for QueryRun {
    fn query_id(&self) -> QueryId {
        self.query_id
    }

    fn token(&self) -> &CancellationToken {
        &self.token
    }

    fn controls(&self) -> &QueryControls {
        &self.controls
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
    field(value, "metrics")
        .and_then(|metrics| serde_wasm_bindgen::from_value::<QueryStreamMetrics>(metrics).ok())
        .unwrap_or_default()
        .into()
}

fn channel_message(value: &JsValue) -> Result<ChannelMessage, HostError> {
    match field(value, "type").and_then(|kind| kind.as_string()).as_deref() {
        Some("progress") => Ok(ChannelMessage::Progress(Box::new(channel_progress(field(value, "progress"))))),
        Some("batch") => Ok(ChannelMessage::Batch { metrics: channel_metrics(value) }),
        Some("end") => Ok(ChannelMessage::End { metrics: channel_metrics(value) }),
        _ => Err(HostError::new("an unknown message of a channel")),
    }
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

    /// Log a message of a query with its trace
    fn log_query(&self, run: &QueryRun, level: LogLevel, message: &str, details: &[(String, String)], target: &str) {
        let mut all: Vec<(String, String)> = run.log_details.clone();
        all.extend(details.iter().cloned());
        let pairs: Vec<(&str, &str)> = all.iter().map(|(key, value)| (key.as_str(), value.as_str())).collect();
        self.platform.log_on(level, message, &pairs, target);
    }

    /// Delete the computation of a result if it has one
    pub(crate) fn delete_computation_of(&self, query_id: QueryId) {
        if self.computations.read(|state| state.computation(query_id).is_some()) {
            self.delete_computation(query_id);
        }
    }

    /// Apply an event of the executor to the history of its query. The start and the end of a query are urgent
    /// changes, the rest follows with the next frame.
    pub(crate) fn report(self: &Rc<Self>, run: &QueryRun, event_: QueryEvent) {
        let query_id = run.query_id;
        let now = self.now() as i64;
        let action = match event_ {
            QueryEvent::Sending => QueryExecutionAction::QuerySending { query_id, now },
            QueryEvent::Running => QueryExecutionAction::QueryRunning { query_id, now },
            QueryEvent::Progress(progress) => QueryExecutionAction::QueryProgressUpdated { query_id, progress, now },
            QueryEvent::ReceivedBatch(metrics) => QueryExecutionAction::QueryReceivedBatch { query_id, metrics, now },
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
                        self.log_query(
                            run,
                            LogLevel::Warn,
                            "Failed to keep the result of a query",
                            &details,
                            LOG_TARGET,
                        );
                        return;
                    }
                };
                let action = QueryExecutionAction::QueryReceivedAllBatches {
                    query_id,
                    table: QueryResultTable { id: table, rows },
                    metrics,
                    now,
                };
                // A history that refuses the result took no handle, the handle goes again
                if let Err(error) = self.apply_query(&run.connection_id, action, false) {
                    self.release_table(table);
                    self.log_query(
                        run,
                        LogLevel::Debug,
                        "A query event changed nothing",
                        &[("error".into(), error.what().to_string())],
                        LOG_TARGET,
                    );
                }
                return;
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
                    self.log_query(run, LogLevel::Warn, &failure.message, &details, &failure.target);
                }
                QueryExecutionAction::QueryFailed { query_id, error: query_error(&failure), metrics, now }
            }
            QueryEvent::Cancelled { failure, metrics } => {
                // A query that was cancelled while its result was analyzed keeps no computation, the history lets go of
                // its result
                self.delete_computation_of(query_id);
                QueryExecutionAction::QueryCancelled { query_id, error: query_error(&failure), metrics, now }
            }
            QueryEvent::CacheRecorded { served_from_cache } => {
                QueryExecutionAction::QueryCacheRecorded { query_id, served_from_cache }
            }
            QueryEvent::TouchRelations => {
                let touched =
                    dashql_core::touched_relations::touched_relations(&run.text).relations.unwrap_or_default();
                if !touched.is_empty() {
                    // Following the catalog must not change the outcome of the statement
                    if let Err(error) =
                        self.apply(&run.connection_id, ConnectionAction::RelationsTouched(touched), None)
                    {
                        let details =
                            [("query".into(), query_id.to_string()), ("error".into(), error.what().to_string())];
                        self.log_query(
                            run,
                            LogLevel::Warn,
                            "Failed to read the relations of a statement",
                            &details,
                            LOG_TARGET,
                        );
                    }
                }
                return;
            }
            QueryEvent::Timing { label, elapsed_ms } => {
                run.notify(&QueryCallerEvent::Timing { label: label.to_string(), elapsed_ms });
                return;
            }
            QueryEvent::ResultsReady => {
                let ready = run.caller.ready.borrow_mut().take();
                if let Some(ready) = ready {
                    ready.send(());
                }
                run.notify(&QueryCallerEvent::ResultsReady);
                return;
            }
            QueryEvent::Log { level, message, details, target } => {
                self.log_query(run, level, &message, &details, &target);
                return;
            }
        };
        let urgent = matches!(
            action,
            QueryExecutionAction::QuerySending { .. }
                | QueryExecutionAction::QuerySucceeded { .. }
                | QueryExecutionAction::QueryFailed { .. }
                | QueryExecutionAction::QueryCancelled { .. }
        );
        if let Err(error) = self.apply_query(&run.connection_id, action, urgent) {
            self.log_query(
                run,
                LogLevel::Debug,
                "A query event changed nothing",
                &[("error".into(), error.what().to_string())],
                LOG_TARGET,
            );
        }
    }

    /// Analyze the result of a query on the computations. The history decides which result of an owner is the latest
    /// once the query succeeded, the computations of the results that it supersedes go then. A cancel stops the
    /// analysis: the new computation goes and the earlier result of the owner keeps its computation.
    fn analyze(self: &Rc<Self>, run: &Rc<QueryRun>) -> impl Future<Output = Result<(), HostError>> + 'static {
        let connections = self.clone();
        let run = run.clone();
        async move {
            let query_id = run.query_id;
            let token = run.token.clone();
            let Some(table) = run.result() else {
                return Ok(());
            };
            // The analysis computes on the compute database, a query without one has nothing to analyze
            if !connections.platform.has_compute() {
                return Ok(());
            }
            if token.is_cancelled() {
                return Err(HostError::cancelled());
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
            let analysis = connections.computations.analyze_table(
                query_id,
                shape,
                handles,
                connection_id,
                None,
                RuntimeAnalyzeOptions::default(),
            );
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
                return Err(HostError::cancelled());
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

impl OnHost for QueryHost {
    type Inner = JsPlatform;

    fn inner_host(&self) -> &JsPlatform {
        &self.platform
    }

    fn log_on_host(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, LOG_TARGET);
    }
}

impl HttpHost for QueryHost {
    fn fetch(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.platform.send(request, cancellation, false)
    }
}

impl ExecutorHost for QueryHost {
    type Run = QueryRun;

    fn report(&self, run: &QueryRun, event: QueryEvent) {
        if let Some(connections) = self.connections.upgrade() {
            connections.report(run, event);
        }
    }

    fn push_result(&self, run: &QueryRun, part: Body) -> Result<(), HostError> {
        let part = match part {
            Body::Bytes(bytes) => Uint8Array::from(bytes.as_slice()).into(),
            Body::Host(bytes) => host_value(Some(bytes.value())),
        };
        let table = run.stream_table()?;
        self.platform.push_table(table, &part)
    }

    fn finish_result(&self, run: &Rc<QueryRun>) -> impl Future<Output = Result<HostTable, HostError>> + 'static {
        let finished = run.stream_table().and_then(|table| {
            let finished = self.platform.finish_table(table)?;
            // A table that didn't finish stays the table of the run, which releases it
            run.state.borrow_mut().table = None;
            run.adopt_result(table);
            Ok(finished)
        });
        std::future::ready(finished)
    }

    fn result_read(
        &self,
        run: &Rc<QueryRun>,
        workbook_id: &str,
        name: &str,
    ) -> impl Future<Output = Result<Option<HostTable>, HostError>> + 'static {
        let read = self.platform.results_read(workbook_id, name);
        let run = run.clone();
        async move {
            let Some(read) = read.await? else { return Ok(None) };
            // The run owns the table
            run.adopt_result(read.table);
            let count = |n: f64| if n.is_finite() { n.max(0.0) as u64 } else { 0 };
            Ok(Some(HostTable { rows: count(read.rows), columns: count(read.columns), batches: 0 }))
        }
    }

    fn result_write(
        &self,
        run: &Rc<QueryRun>,
        result: &ResultRequest,
    ) -> impl Future<Output = Result<String, HostError>> + 'static {
        // The write holds the run, its table is there. The platform takes the table when it is called. A run names the
        // file when it plans, the keys downstream of the script cover the name.
        let platform = self.platform.clone();
        let result = result.clone();
        let name = result.name.clone();
        let write = match run.result() {
            Some(table) => Ok((table, platform.results_pin(&result.workbook_id, &name))),
            None => Err(HostError::new("The query has no result")),
        };
        async move {
            let (table, pin) = write?;
            let pin = pin.await?;
            let written = platform.results_write(&result.workbook_id, &name, table).await;
            platform.results_release(pin).await;
            written?;
            // The older files of the script stay until the run ended, the newest file is the result of the script.
            // Removing them now would make the compute database forget them while the queries of the run use it.
            Ok(name)
        }
    }

    fn result_clear(&self, workbook_id: &str, script: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let platform = self.platform.clone();
        let workbook_id = workbook_id.to_string();
        let script = script.to_string();
        async move { results::remove_files_of_script(&platform, &workbook_id, &script).await }
    }

    fn analyze_result(&self, run: &Rc<QueryRun>) -> impl Future<Output = Result<(), HostError>> + 'static {
        let analysis = self.connections().map(|connections| connections.analyze(run));
        async move { analysis?.await }
    }

    fn fetch_result(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.platform.send(request, cancellation, true)
    }

    fn channel_open(&self, run: &Rc<QueryRun>) -> impl Future<Output = Result<bool, HostError>> + 'static {
        let opened = run.stream_table().map(|table| self.platform.channel_open(run.query_id as f64, table));
        async move { opened?.await }
    }

    fn channel_next(&self, run: &QueryRun) -> impl Future<Output = Result<ChannelMessage, HostError>> + 'static {
        let next = self.platform.channel_next(run.query_id as f64);
        async move { channel_message(&next.await?) }
    }

    fn channel_cancel(&self, run: &QueryRun) -> impl Future<Output = Result<(), HostError>> + 'static {
        self.platform.channel_cancel(run.query_id as f64)
    }

    fn channel_auth(&self, run: &QueryRun) -> impl Future<Output = Result<Option<Headers>, HostError>> + 'static {
        // The headers of the Hyper of Salesforce follow the tokens of the channel, e.g. after a refresh
        let auth = self
            .connections()
            .ok()
            .and_then(|connections| connections.salesforce_channel_of(&run.connection_id))
            .map(|channel| channel.auth());
        std::future::ready(Ok(auth))
    }

    fn token_refresh_ended(&self, run: &QueryRun, outcome: Result<(), DetailedError>) {
        // The executor refreshes the token of a channel that the description of the query named
        let Some(epoch) = run.channel_epoch.get() else { return };
        if let Some(connections) = self.connections.upgrade() {
            connections.token_refresh_ended(&run.connection_id, epoch, outcome);
        }
    }

    fn time_zones(&self) -> Rc<dyn TimeZoneOffsets> {
        Rc::new(IntlTimeZones)
    }
}

impl Connections {
    /// The refresh of a token of the channel of a connection ended. The channel keeps a new token, the view of the
    /// connection summarizes it; a failed refresh fails the connection that is online and still keeps the channel of
    /// setup epoch `epoch`.
    pub(crate) fn token_refresh_ended(
        self: &Rc<Self>,
        connection_id: &str,
        epoch: u64,
        outcome: Result<(), DetailedError>,
    ) {
        match outcome {
            Ok(()) => self.platform.changed(super::changes::Slice::Connection(connection_id), false),
            Err(error) => {
                if let Err(failure) =
                    self.apply(connection_id, ConnectionAction::TokenRefreshFailed { epoch, error }, None)
                {
                    self.platform.log_on(
                        LogLevel::Warn,
                        "Failed to fail a connection after a token refresh",
                        &[("connectionId", connection_id), ("error", failure.what())],
                        LOG_TARGET,
                    );
                }
            }
        }
    }

    /// The Salesforce channel of a connection, none for other channels
    fn salesforce_channel_of(&self, connection_id: &str) -> Option<SharedSalesforceChannel> {
        let registry = self.registry.borrow();
        let state = registry.get(connection_id)?.state.try_borrow().ok()?;
        state.details().channel.as_ref().and_then(ConnectionChannel::salesforce).cloned()
    }
}

/// The outcome of a query for its caller, the result table while the run still owns it
fn outcome_value(outcome: QueryOutcome, table: JsValue) -> Result<JsValue, JsValue> {
    let outcome = match outcome {
        QueryOutcome::Resolved { has_result } => {
            QueryRunOutcome::Resolved { has_result, table: if has_result { table } else { JsValue::NULL } }
        }
        QueryOutcome::Rejected(failure) => QueryRunOutcome::Rejected {
            failure: QueryRunFailure::from(&failure),
            value: host_value(failure.value.as_ref()),
        },
    };
    to_js(&outcome).map(JsValue::from).map_err(JsValue::from)
}

impl Connections {
    /// Run a query on a connection, see `Runtime.executeQuery`. Returns the id of the query and the promise of its
    /// outcome.
    pub(crate) fn execute(
        self: &Rc<Self>,
        connection_id: &str,
        args: QueryArgs,
        failure: JsValue,
        events: Option<Function>,
    ) -> (QueryId, Promise) {
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
        let state =
            QueryExecutionState::new(query_id, args.trace_id as u64, args.text.clone(), metadata.clone(), now as i64);
        // The query is in the history of the connection from the start
        if let Err(error) =
            self.apply_query(connection_id, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true)
        {
            let message = format!("Couldn't find a connection with id {connection_id}");
            self.platform.log_on(
                LogLevel::Error,
                "Connection not configured",
                &[("connectionId", connection_id), ("error", error.what())],
                LOG_TARGET,
            );
            let failed =
                outcome_value(QueryOutcome::Rejected(QueryFailure::new(FailureKind::Error, message)), JsValue::NULL);
            return (query_id, failed.map_or_else(|error| Promise::reject(&error), |failed| Promise::resolve(&failed)));
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
        };
        let connections = self.clone();
        let done = wasm_bindgen_futures::future_to_promise(async move {
            let outcome = connections.run(&run, description, failure).await;
            // The caller gets the object of the result table while the run still owns it
            let table = match &outcome {
                QueryOutcome::Resolved { has_result: true } => {
                    run.result().map(|table| connections.platform.handle(table)).unwrap_or(JsValue::NULL)
                }
                _ => JsValue::NULL,
            };
            outcome_value(outcome, table)
        });
        (query_id, done)
    }

    /// The key of the result of a script signature on a connection, none without stored results or before the
    /// connection has the params of a setup. The key derives from the params of the connector that identify its
    /// results, the platform computes the SHA-256 digest.
    pub(crate) fn result_key(
        &self,
        connection_id: &str,
        signature: &str,
    ) -> impl Future<Output = Option<String>> + 'static {
        let input = if self.platform.has_results() {
            let registry = self.registry.borrow();
            registry.get(connection_id).and_then(|connection| {
                let state = connection.state.try_borrow().ok()?;
                Some(result_key_input(&connection_cache_signature(&state)?, signature))
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
    /// messages. The connection owns its channel: the module speaks Trino, Hyper over HTTP and the Hyper of Salesforce
    /// itself, the platform describes only a channel of the host, which it then keeps for the query until the query is
    /// forgotten.
    async fn describe(
        self: &Rc<Self>,
        run: &QueryRun,
        description: &QueryDescription,
    ) -> Result<QueryRequest, QueryFailure> {
        let query_id = run.query_id;
        let connection_id = description.connection_id.as_str();
        let connection = {
            let registry = self.registry.borrow();
            registry.get(connection_id).and_then(|connection| {
                let state = connection.state.try_borrow().ok()?;
                Some((state.connector_type(), state.details().channel.clone(), state.setup_epoch()))
            })
        };
        let Some((connector, channel, epoch)) = connection else {
            return Err(QueryFailure::new(
                FailureKind::Error,
                format!("Couldn't find a connection with id {connection_id}"),
            ));
        };
        run.channel_epoch.set(Some(epoch));
        // Credentials about to expire, e.g. a Data Cloud token, are refreshed before the query uses them, the channel
        // keeps the new ones. A failed refresh fails the connection.
        if let Some(channel) = &channel {
            if let Err(message) = channel.fresh(&Rc::new(self.platform.clone())).await {
                self.platform.log_on(
                    LogLevel::Warn,
                    "Failed to refresh the credentials of the connection",
                    &[("connectionId", connection_id), ("error", &message)],
                    LOG_TARGET,
                );
                self.token_refresh_ended(connection_id, epoch, Err(DetailedError::new(message.clone())));
                return Err(QueryFailure::new(FailureKind::Error, message));
            }
        }
        let options = &description.options;
        // The executor reads and writes the files of the results with the compute database
        let result = options.result.as_ref().filter(|_| self.platform.has_results()).map(ResultRequest::from);
        let publish_results = options.publish_results != Some(false);
        let query = ChannelQuery {
            text: &description.text,
            read_timeout_ms: options.read_timeout_ms,
            publish_results,
            connector: connector.connector().display_name(),
            client_function: options.client_function_call.is_some(),
        };
        let target = match (&options.client_function_call, channel) {
            // The call runs with the spec that the catalog of the connection registered (`load_spec`) and sends its
            // requests with the credentials of the channel of the connection
            (Some(call), channel) => {
                let description = ClientFunctionCallDescription::from_value(call.0.clone())
                    .map_err(|error| QueryFailure::new(FailureKind::Error, error.message))?;
                QueryTarget::ClientFunction(ClientFunctionTarget { connector, spec: None, description, channel })
            }
            // The queries of a connection share its channel
            (None, Some(ConnectionChannel::Trino(trino))) => QueryTarget::Trino(trino),
            (None, Some(ConnectionChannel::HyperHttp { channel, auth })) => QueryTarget::HyperHttp { channel, auth },
            (None, Some(ConnectionChannel::Salesforce(salesforce))) => {
                QueryTarget::HyperHttp { channel: salesforce.hyper(), auth: salesforce.auth() }
            }
            // A channel of the host, or none: a query from the cache needs none, any other fails when it opens the
            // channel
            (None, channel) => {
                let handle = channel.as_ref().and_then(ConnectionChannel::host_handle);
                let query = serde_wasm_bindgen::to_value(&query)
                    .map_err(|error| QueryFailure::new(FailureKind::Error, error.to_string()))?;
                let described =
                    self.platform.channel_describe(query_id as f64, handle, &query).await.map_err(|error| {
                        let mut failure = QueryFailure::from_host(&error);
                        failure.target = LOG_TARGET.to_string();
                        failure
                    })?;
                let RuntimeChannelTarget::Host = described;
                QueryTarget::Host
            }
        };
        // Where a statement of a plan of workbook scripts comes from, e.g. `bar.sql 2/3 · inlines foo.sql`
        let mut log_details = Vec::new();
        if let Some(planned) = &description.metadata.planned {
            log_details.push(("planned".to_string(), description.metadata.title.clone().unwrap_or_default()));
            let node =
                planned.get("node").map(|node| node.as_str().map(str::to_string).unwrap_or_else(|| node.to_string()));
            log_details.push(("node".to_string(), node.unwrap_or_default()));
        }
        Ok(QueryRequest {
            connection_id: connection_id.to_string(),
            text: description.text.clone(),
            target,
            publish_results,
            analyze_results: options.analyze_results == Some(true),
            result,
            // Nothing that runs on Salesforce changes its relations
            touches_relations: description.metadata.user_provided && connector != ConnectorType::SalesforceDataCloud,
            throw_on_error: options.throw_on_error == Some(true),
            log_details,
        })
    }

    /// Describe a query and run it, the query ended once the future completed. Every step waits on the token of the run:
    /// a cancel before the executor runs the query ends it as cancelled, one while it runs stops it at the backend.
    async fn run(self: &Rc<Self>, run: &Rc<QueryRun>, description: QueryDescription, failure: JsValue) -> QueryOutcome {
        let outcome = self.run_steps(run, description, failure).await;
        run.end();
        outcome
    }

    async fn run_steps(
        self: &Rc<Self>,
        run: &Rc<QueryRun>,
        description: QueryDescription,
        failure: JsValue,
    ) -> QueryOutcome {
        let query_id = run.query_id;
        let fail = |failure: QueryFailure| {
            let error = query_error(&failure);
            let now = self.now() as i64;
            let action = match failure.kind {
                FailureKind::Cancelled => QueryExecutionAction::QueryCancelled { query_id, error, metrics: None, now },
                _ => QueryExecutionAction::QueryFailed { query_id, error, metrics: None, now },
            };
            let _ = self.apply_query(&run.connection_id, action, true);
            QueryOutcome::Rejected(failure)
        };
        // A query that the caller failed is recorded with its failure, nothing of it runs
        if run.preset_failure {
            let message = crate::host::message_of(&failure);
            let value: Rc<dyn std::any::Any> = Rc::new(failure);
            return fail(QueryFailure { value: Some(value), ..QueryFailure::new(FailureKind::Error, message) });
        }
        let token = &run.token;
        let mut request = match token.run(self.describe(run, &description)).await {
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
        let Some(executor) = self.executor() else {
            return fail(QueryFailure::new(FailureKind::Error, "the runtime was destroyed"));
        };
        // The executor and its follow-ups hold the run. A token that was cancelled meanwhile ends the query as
        // cancelled in the executor.
        executor.execute(request, run.clone()).await
    }

    /// The spec of the client functions of a call: the one that the catalog of its connection registered, so a call
    /// runs only with the spec that the core checked it against. A connector without a binding has no spec, starting
    /// the call names it.
    async fn load_spec(&self, request: &mut QueryRequest) -> Result<(), String> {
        let QueryTarget::ClientFunction(target) = &mut request.target else { return Ok(()) };
        if target.spec.is_some() || client_function_binding(target.connector).is_none() {
            return Ok(());
        }
        // A spec that the registration still loads is awaited
        let spec = self.loader.borrow().as_ref().map(|loader| loader.client_function_spec(&request.connection_id));
        let spec = match spec {
            Some(spec) => spec.await,
            None => None,
        };
        let Some(spec) = spec else {
            return Err(format!(
                "The client functions of {} connections are not registered",
                target.connector.connector().display_name()
            ));
        };
        target.spec = Some(spec);
        Ok(())
    }

    /// Run a query of the runtime on a connection, e.g. a metadata query of the catalog loader or the probe of a health
    /// check. It is a query of the history of the connection, the platform describes where it runs. Returns its id and
    /// a future of its result: the result table as an Arrow IPC stream if `read` asks for it, empty bytes otherwise,
    /// none for a query without a result. The token of the caller cancels the query, it ends as cancelled at the
    /// backend.
    pub(crate) fn run_internal(
        self: &Rc<Self>,
        connection_id: &str,
        text: &str,
        metadata: QueryMetadata,
        read_timeout_ms: Option<u32>,
        read: bool,
        cancellation: &CancellationToken,
    ) -> (QueryId, InternalQuery) {
        let query_id = self.registry.borrow_mut().next_query_id();
        let description = QueryDescription {
            connection_id: connection_id.to_string(),
            text: text.to_string(),
            metadata: metadata.clone(),
            options: QueryOptions { read_timeout_ms, throw_on_error: Some(true), ..Default::default() },
        };
        let state = QueryExecutionState::new(query_id, 0, text.to_string(), metadata, self.now() as i64);
        if self.apply_query(connection_id, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true).is_err()
        {
            let failure =
                QueryFailure::new(FailureKind::Error, format!("Couldn't find a connection with id {connection_id}"));
            return (query_id, InternalQuery::Ready(Some(Err(failure))));
        }
        let run = self.adopt_run(QueryRun::new(query_id, connection_id, text, Vec::new(), false, &self.platform));
        // The query runs in a task of its own to its end, the token of a caller that stops waiting cancels the one of
        // the run. The forwarding ends with the query and leaves nothing with the token of the caller.
        let ended = CancellationToken::new();
        {
            let ended = ended.clone();
            let caller = cancellation.clone();
            let token = run.token.clone();
            self.platform.spawn(Box::pin(async move {
                if ended.run(caller.cancelled()).await.is_some() {
                    token.cancel();
                }
            }));
        }
        let (sender, receiver) = oneshot();
        let connections = self.clone();
        self.platform.spawn(Box::pin(async move {
            let outcome = connections.run(&run, description, JsValue::UNDEFINED).await;
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
    /// platform describes where it runs with the options of the statement (`queries.describe`): its stored result, whether it
    /// publishes and analyzes its result, a call of a client function. Returns its id, a future that completes once
    /// its result arrived and a future of its end: whether it has a result, or its failure. A statement that fails may
    /// never complete the first.
    pub(crate) fn run_statement(
        self: &Rc<Self>,
        statement: Statement,
    ) -> (QueryId, LocalFuture<()>, LocalFuture<Result<bool, QueryFailure>>) {
        let connection_id = statement.connection_id.as_str();
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
                result: statement.result.as_ref().map(QueryResultOptions::from),
            },
        };
        let mut log_details = Vec::new();
        if let Some(workbook_id) = &statement.metadata.workbook_id {
            log_details.push(("workbookId".to_string(), workbook_id.clone()));
        }
        let state =
            QueryExecutionState::new(query_id, 0, statement.text.clone(), statement.metadata, self.now() as i64);
        if let Err(error) =
            self.apply_query(connection_id, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true)
        {
            let failure = QueryFailure::new(
                FailureKind::Error,
                format!("Couldn't find a connection with id {connection_id}: {}", error.what()),
            );
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
            let outcome = connections.run(&run, description, JsValue::UNDEFINED).await;
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

    /// Cancel a query right away: the token of its run is cancelled and the query stops wherever it is, a channel of
    /// the host also while it opens the query. A query of a computation stops its run, one that the host tracks is
    /// aborted through its record.
    pub(crate) fn cancel_now(&self, query_id: QueryId) {
        if let Some(run) = self.run_of(query_id) {
            run.token.cancel();
            return;
        }
        // A query of a computation stops the run of its task
        if self.computations.host().stop(query_id) {
            return;
        }
        // A query that the host tracks is aborted through its record
        let history = self.registry.borrow().query_history(query_id).map(|(_, history)| history);
        let handle = history.and_then(|history| history.borrow().active(query_id).and_then(|query| query.handle));
        if let Some(handle) = handle {
            let effect = dashql_core_runtime::connections::registry::RegistryEffect::Abort {
                handle,
                reason: "Query was cancelled",
            };
            self.platform.push_registry_effects(&[effect]);
            self.platform.signal(true);
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

    /// A view starts (1) or stops (-1) showing the profile of a query, before the query started or while it runs
    pub(crate) fn watch_profile(&self, query_id: QueryId, delta: i32) {
        if let Some(run) = self.run_of(query_id) {
            run.controls.watch_profile(delta);
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
    /// The stored result of the script of the statement
    pub result: Option<ResultRequest>,
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
            InternalQuery::Ready(result) => {
                Poll::Ready(result.take().unwrap_or_else(|| Err(QueryFailure::cancelled())))
            }
            InternalQuery::Waiting(receiver) => {
                Pin::new(receiver).poll(cx).map(|result| result.unwrap_or_else(|| Err(QueryFailure::cancelled())))
            }
        }
    }
}
