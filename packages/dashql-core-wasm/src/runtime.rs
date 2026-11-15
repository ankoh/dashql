//! The runtime of DashQL as one class of the module (docs/wip/runtime_api.md).
//!
//! `Runtime` owns the state of DashQL and its services on one platform object (`JsPlatform`). The host reads the state
//! as views by revision: the runtime tells the platform that it changed, the store of the host takes the changed slices
//! (`takeChanges`) and reads their views once per kind (`views`). Writes are one `dispatch` with a generated union of
//! actions; the work that takes time and returns a result is a method each (`analyzeTable`, `executeQuery`,
//! `cancelQuery`, `saveConnection`, ...).
//!
//! The runtime owns the computations of result tables, the connections with the histories of their queries, the
//! histories without a connection (the shell), the query executor and the saves of the connections. The other domains
//! join it step by step: a domain adds its state to `Runtime`, its slices to `ViewKind`, its targets and actions to
//! the unions.
//!
//! Every method takes `&self` and the state sits behind the `RefCell`s of the services, which no call holds across a
//! call into the platform. Arguments of the wrong type fail with a JS error, nothing panics.

pub(crate) mod computation;
pub(crate) mod connections;
pub(crate) mod queries;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use dashql_core::error::Error;
use dashql_core_runtime::catalog_loader::FollowedConnection;
use dashql_core_runtime::compute::service::{AnalysisHandles, ComputeService};
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions as RuntimeAnalyzeOptions;
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::compute::types::{OrderByConstraint, TableId};
use dashql_core_runtime::compute::ComputationOutcome;
use dashql_core_runtime::connection_setup::setup_action_from_json;
use dashql_core_runtime::connections::registry::{ListedConnection, QueryOwner, RegistryOutcome};
use dashql_core_runtime::connections::{CatalogUpdateTask, ConnectionAction, ConnectionParams, DetailedError};
use dashql_core_runtime::host::LogLevel;
use dashql_core_runtime::query::{QueryError, QueryExecutionAction, QueryExecutionState, QueryId, QueryResultTable};
use dashql_core_runtime::workbook::next_revision;
use js_sys::{Array, Function, Object, Promise, Reflect};
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::future_to_promise;

use crate::connection::view::{
    CatalogUpdateTaskStatus, CatalogUpdateVariant, ConnectionError, ConnectionListView, ConnectionRelationName, ConnectionTableName,
    ConnectionView, ConnectorType, JsonParams,
};
use crate::host::{lifetime_token, HandleEffect, JsPlatform, JsRuntimePlatform};
use crate::query_history::view::{ProfileLayoutView, QueryHistoryView, QueryMetadataView, QueryProfileKeys, QueryProfileProgressView, QueryStreamMetrics, QueryView};
use crate::query_history::{progress_recording, QueryProgressFollower};
use crate::restore::RestoredState;
use crate::storage_writer::StorageWriter;
use crate::views::{from_js, to_js, value_to_js, JsonValue};
use crate::{Catalog, SharedCatalog};
use computation::{AnalyzeTableOptions, ComputationOrderBy, ComputationSearchKind, ComputationView};
use connections::{Connections, NewConnection};
use queries::QueryArgs;

#[wasm_bindgen(typescript_custom_section)]
const RUNTIME_VIEWS: &str = r#"
/** The slices of the runtime by kind: the id of a slice, its view, and the keys of the payloads of its view that the host holds */
export interface RuntimeViews {
    computation: { id: number; view: ComputationView; known: undefined };
    connectionList: { id: 'root'; view: ConnectionListView; known: undefined };
    connection: { id: string; view: ConnectionView; known: undefined };
    query: { id: number; view: QueryView; known: (QueryProfileKeys | null)[] };
    history: { id: string; view: QueryHistoryView; known: undefined };
}
/** A kind of slices of the runtime */
export type ViewKind = keyof RuntimeViews;
/** The id of a slice of a kind */
export type ViewId<K extends ViewKind> = RuntimeViews[K]['id'];
/** The view of a slice of a kind */
export type ViewOf<K extends ViewKind> = RuntimeViews[K]['view'];
/** The keys of the payloads that the host holds, they don't cross again */
export type KnownKeys<K extends ViewKind> = RuntimeViews[K]['known'];
/** What the caller of a query hears while it runs: the timings, the result before its analysis, a refreshed access token of Trino */
export type QueryCallerEvent =
    | { type: 'timing'; label: string; elapsedMs: number }
    | { type: 'resultsReady' }
    | { type: 'trinoTokenRefreshed'; token: unknown };
/** The failure of a query, `hostValue` tells whether `value` is what the host failed with */
export interface QueryRunFailure {
    kind: 'error' | 'cancelled' | 'cacheMiss' | 'processing';
    message: string;
    details: Record<string, string>;
    target: string;
    hostValue: boolean;
}
/** How a query ended for its caller */
export type QueryRunOutcome =
    | { status: 'resolved'; hasResult: boolean; table: unknown }
    | { status: 'rejected'; failure: QueryRunFailure; value: unknown };
/** A query that runs: its id and its outcome */
export interface QueryTicket {
    queryId: number;
    done: Promise<QueryRunOutcome>;
}
export interface Runtime {
    /** The views of the slices of a kind, null for a slice that is gone. One crossing per kind and flush. */
    views<K extends ViewKind>(kind: K, ids: ViewId<K>[], known?: KnownKeys<K>): (ViewOf<K> | null)[];
}
"#;

/// The slice that an action changes
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum Target {
    /// The computation of a result table by its id
    Computation(u64),
    /// A connection by its id, with the queries of its history
    Connection(String),
    /// A history of queries without a connection by its name, e.g. the one of the shell
    History(String),
    /// The runtime: the list of the connections
    App,
}

/// The actions of the runtime. An action changes the state in the call and returns its outcome; a failed action leaves
/// the state as it was.
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum RuntimeAction {
    // The computations
    /// Delete the computation, its runs are cancelled and its tables released
    DeleteComputation,
    /// Order the rows, an empty ordering clears it
    OrderBy { constraints: Vec<ComputationOrderBy> },
    /// Select a range of bins of the histogram of a column group, null clears the selection of the column
    HistogramFilter { column_group: u32, selection: Option<(f64, f64)> },
    /// Select a frequent value of a column group by its id, the selected value again or null clears the selection
    MostFrequentValueFilter { column_group: u32, value_id: Option<i64> },
    /// Clear the selections of all column groups
    ClearCrossFilters,
    /// Search the columns or the data, an empty pattern ends the search
    SetResultSearchPattern { search: ComputationSearchKind, pattern: String },
    /// Summarize a column group over the selected rows if its summary is outdated, e.g. once it shows
    RequestFilteredColumnAggregation { column_group: u32 },

    // The runtime
    /// Create a connection with an empty catalog, the outcome names its id. An active connection is written into the
    /// app manifest right away.
    CreateConnection {
        /// The id, a new one without
        #[serde(default)]
        #[tsify(optional)]
        connection_id: Option<String>,
        #[tsify(type = "ConnectorType")]
        connector_type: ConnectorType,
        /// The params of the connector that the details of the setup start with
        #[serde(default)]
        #[tsify(optional)]
        setup_params: Option<JsonParams>,
        /// Does the connection belong to a committed workbook or was it connected once?
        #[serde(default)]
        #[tsify(optional)]
        active: Option<bool>,
        /// The params, the setup params by default
        #[serde(default)]
        #[tsify(optional)]
        params: Option<JsonParams>,
        #[serde(default)]
        #[tsify(optional)]
        params_draft: Option<JsonParams>,
        #[serde(default)]
        #[tsify(optional)]
        name: Option<String>,
        #[serde(default)]
        #[tsify(optional)]
        cache_query_results: Option<bool>,
    },
    /// The workbooks that use the connections, until the workbooks are part of the runtime
    SetConnectionReferences {
        #[tsify(type = "[string, string[]][]")]
        references: Vec<(String, Vec<String>)>,
    },

    // A connection
    /// Set the draft of the params, params of another connector are ignored
    SetDraft { params: JsonParams },
    /// Drop the draft and the errors of the last setup
    DiscardDraft,
    /// The params were saved
    CommitParams { params: JsonParams },
    /// Rename the connection, a blank name removes the name
    Rename { name: String },
    /// Choose whether the connection caches query results
    SetQueryResultCaching { caching: bool },
    /// Stop the connection and drop it with its catalog. A connection that workbooks use is never deleted.
    DeleteConnection,
    /// Stop the connection and clear its catalog and queries
    ResetConnection,
    /// Switch a connection that was never configured to another connector
    SwitchConnectorType {
        #[tsify(type = "ConnectorType")]
        connector_type: ConnectorType,
    },
    /// Executed statements touched relations, the names have nulls for the parts that a statement left out
    RelationsTouched { names: Vec<ConnectionTableName> },
    /// A catalog update started, the host keeps its record (cancellation and error) under the handle
    UpdateCatalog {
        task_id: u32,
        handle: u32,
        #[tsify(type = "CatalogUpdateVariant")]
        variant: CatalogUpdateVariant,
        #[serde(default)]
        #[tsify(optional)]
        started_at: Option<f64>,
        #[serde(default)]
        #[tsify(optional)]
        touched_relations: Option<Vec<ConnectionRelationName>>,
    },
    /// A catalog update started a query
    CatalogUpdateRegisterQuery { task_id: u32, query_id: u32 },
    /// A catalog update finished with a final status, an update that didn't succeed with an error. A lookup tells
    /// whether it changed the catalog.
    CatalogUpdateFinished {
        task_id: u32,
        #[tsify(type = "CatalogUpdateTaskStatus")]
        status: CatalogUpdateTaskStatus,
        #[serde(default)]
        #[tsify(optional)]
        error: Option<ConnectionError>,
        #[serde(default)]
        #[tsify(optional)]
        changed: Option<bool>,
    },
    /// Restore the state of the catalog updates from the files of the catalog, null keeps a field
    RestoreCatalogUpdates {
        #[serde(default)]
        #[tsify(optional)]
        described: Option<bool>,
        #[serde(default)]
        #[tsify(optional)]
        touched_relations: Option<Vec<ConnectionRelationName>>,
    },
    /// A step of a setup or a health check, by the name of the action of the connector (e.g. `TRINO_CHANNEL_READY`).
    /// The channel of a ready step is a handle that the connection takes.
    SetupStep {
        step: String,
        #[serde(default)]
        #[tsify(optional)]
        value: Option<JsonValue>,
        #[serde(default)]
        #[tsify(optional)]
        channel: Option<u32>,
    },
    /// Replace the text of the script with the functions of the connection
    ReplaceFunctionScriptText { text: String },

    // A history without a connection
    /// Create the history, it keeps at most `limit` queries. An existing history stays.
    CreateHistory {
        #[serde(default)]
        #[tsify(optional)]
        limit: Option<u32>,
    },
    /// Drop the history, the handles of its queries are released
    DropHistory,

    // The queries that the host runs itself, of a connection or of a history
    /// Start tracking a query, the outcome names its id. The host keeps the record of the query under the handle, an
    /// abort of the handle stops the query.
    TrackQuery {
        trace_id: f64,
        text: String,
        metadata: QueryMetadataView,
        #[serde(default)]
        #[tsify(optional)]
        handle: Option<u32>,
    },
    QuerySending { query_id: f64 },
    QueryRunning { query_id: f64 },
    QueryProcessingResults { query_id: f64 },
    QueryProcessedResults { query_id: f64 },
    QuerySucceeded { query_id: f64 },
    /// The query failed, with the stream metrics so far if the connector has them
    QueryFailed {
        query_id: f64,
        message: String,
        #[serde(default)]
        #[tsify(optional)]
        details: Option<String>,
        #[serde(default)]
        #[tsify(optional)]
        metrics: Option<QueryStreamMetrics>,
    },
    /// The query was cancelled, with the stream metrics so far if the connector has them
    QueryCancelled {
        query_id: f64,
        message: String,
        #[serde(default)]
        #[tsify(optional)]
        details: Option<String>,
        #[serde(default)]
        #[tsify(optional)]
        metrics: Option<QueryStreamMetrics>,
    },
    /// All batches arrived, the history takes the table of the handle table
    QueryReceivedAllBatches {
        query_id: f64,
        table: u32,
        rows: f64,
        #[serde(default)]
        #[tsify(optional)]
        metrics: Option<QueryStreamMetrics>,
    },
    /// The cached result of the query was deleted
    QueryCacheDeleted { query_id: f64 },
}

/// The id of a slice or of what an action created: a number or a string
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(untagged)]
pub enum SliceId {
    Number(u64),
    Text(String),
}

/// What a dispatch did
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct DispatchOutcome {
    /// Was the action applied? A failed action leaves the state as it was.
    pub ok: bool,
    /// Did the action change the state?
    pub changed: bool,
    /// The error of a failed action
    pub error: Option<String>,
    /// What the action created: the id of a connection or of a query
    pub id: Option<SliceId>,
}

impl DispatchOutcome {
    fn changed(changed: bool) -> Self {
        DispatchOutcome { ok: true, changed, error: None, id: None }
    }

    fn created(id: SliceId) -> Self {
        DispatchOutcome { ok: true, changed: true, error: None, id: Some(id) }
    }

    fn failed(error: impl Into<String>) -> Self {
        DispatchOutcome { ok: false, changed: false, error: Some(error.into()), id: None }
    }
}

/// A slice that changed since the host took the changes, its revision is null if it went
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct SliceChange {
    #[tsify(type = "ViewKind")]
    pub kind: String,
    pub id: SliceId,
    pub revision: Option<u64>,
}

/// The changes since the host took them last: the changed slices and the effects on handles, in order
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ChangeSet {
    pub changes: Vec<SliceChange>,
    pub effects: Vec<HandleEffect>,
}

/// The kinds of the slices
const COMPUTATION: &str = "computation";
const CONNECTION_LIST: &str = "connectionList";
const CONNECTION: &str = "connection";
const QUERY: &str = "query";
const HISTORY: &str = "history";
/// The id of the list of the connections
const ROOT: &str = "root";

/// What decides the view of a connection
#[derive(Clone, PartialEq)]
struct ConnectionKey {
    state: u64,
    queries: u64,
    workbooks: Vec<String>,
    save: u64,
}

/// The revisions of the slices that the host took
#[derive(Default)]
struct Taken {
    computations: BTreeMap<TableId, u64>,
    list: Option<(Vec<ListedConnection>, u64)>,
    /// The connections and the histories are few, they are lists
    connections: Vec<(String, ConnectionKey, u64)>,
    histories: Vec<(String, Vec<QueryId>, u64)>,
    /// The queries of every history: the revision of the history and the revisions of its queries
    queries: Vec<(QueryOwner, u64, BTreeMap<QueryId, u64>)>,
}

/// Take the entry of a key out of a list
fn take_entry<K: PartialEq, V>(list: &mut Vec<(K, V)>, key: &K) -> Option<V> {
    let index = list.iter().position(|(held, _)| held == key)?;
    Some(list.swap_remove(index).1)
}

/// The runtime of DashQL, see the module
#[wasm_bindgen]
pub struct Runtime {
    platform: JsPlatform,
    computations: ComputeService<JsPlatform>,
    connections: Rc<Connections>,
    taken: RefCell<Taken>,
}

/// A checked integer id of the host
fn integer(value: f64, what: &str) -> Result<u64, JsError> {
    if value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value <= 9_007_199_254_740_991.0 {
        Ok(value as u64)
    } else {
        Err(JsError::new(&format!("the {what} is no integer")))
    }
}

/// The views of slices as JS objects, maps as plain objects
fn views_to_js<T: Serialize>(views: &T) -> Result<JsValue, JsError> {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true).serialize_maps_as_objects(true);
    views.serialize(&serializer).map_err(|e| JsError::new(&e.to_string()))
}

/// The error of a failed action as text
fn error_text(error: Error) -> String {
    error.what().to_string()
}

impl Runtime {
    /// Take the effects of an outcome and tell the host
    fn settle(&self, outcome: dashql_core::error::Result<ComputationOutcome>) -> DispatchOutcome {
        match outcome {
            Ok(outcome) => {
                self.platform.push_effects(&outcome.effects);
                if outcome.changed || !outcome.effects.is_empty() {
                    self.platform.signal(true);
                }
                DispatchOutcome::changed(outcome.changed)
            }
            Err(error) => DispatchOutcome::failed(error.message),
        }
    }

    /// The ids of a call of `views`
    fn ids(ids: &JsValue) -> Result<Vec<JsValue>, JsError> {
        if !Array::is_array(ids) {
            return Err(JsError::new("the ids of the views are no array"));
        }
        Ok(Array::from(ids).iter().collect())
    }

    fn number_ids(ids: &JsValue, what: &str) -> Result<Vec<u64>, JsError> {
        Self::ids(ids)?.into_iter().map(|id| integer(id.as_f64().unwrap_or(f64::NAN), what)).collect()
    }

    fn text_ids(ids: &JsValue, what: &str) -> Result<Vec<String>, JsError> {
        Self::ids(ids)?.into_iter().map(|id| id.as_string().ok_or_else(|| JsError::new(&format!("the id of a {what} is no string")))).collect()
    }

    /// The connections in their order, the catalog loader follows them
    pub(crate) fn followed_connections(&self) -> Vec<(String, FollowedConnection)> {
        let registry = self.connections.registry.borrow();
        registry.connections().map(|(id, connection)| (id.to_string(), connection.clone())).collect()
    }

    /// Apply an action to a connection
    fn connection_outcome(&self, outcome: dashql_core::error::Result<RegistryOutcome>) -> DispatchOutcome {
        match outcome {
            Ok(outcome) => DispatchOutcome::changed(outcome.changed),
            Err(error) => DispatchOutcome::failed(error_text(error)),
        }
    }

    /// Apply an action to a connection, the actions of its queries included
    fn dispatch_connection(&self, connection_id: String, action: RuntimeAction) -> Result<DispatchOutcome, JsError> {
        let connections = &self.connections;
        let connector = connections.registry.borrow().get(&connection_id).map(|connection| connection.state.borrow().connector_type());
        let Some(connector) = connector else {
            return Ok(DispatchOutcome::failed(format!("no connection registered with id {connection_id}")));
        };
        let params = |params: JsonParams| params.connection_params().map_err(error_text);
        let error = |error: Option<ConnectionError>| error.map(DetailedError::from).unwrap_or_default();
        let action = match action {
            RuntimeAction::SetDraft { params: draft } => match params(draft) {
                // Params of another connector are ignored
                Ok(draft) => ConnectionAction::SetDraft(draft),
                Err(error) => return Ok(DispatchOutcome::failed(error)),
            },
            RuntimeAction::DiscardDraft => ConnectionAction::DiscardDraft,
            RuntimeAction::CommitParams { params: committed } => match params(committed) {
                Ok(committed) => ConnectionAction::CommitParams(committed),
                Err(error) => return Ok(DispatchOutcome::failed(error)),
            },
            RuntimeAction::Rename { name } => ConnectionAction::Rename(name),
            RuntimeAction::SetQueryResultCaching { caching } => ConnectionAction::SetQueryResultCaching(caching),
            RuntimeAction::DeleteConnection => ConnectionAction::Delete,
            RuntimeAction::ResetConnection => ConnectionAction::Reset,
            RuntimeAction::SwitchConnectorType { connector_type } => ConnectionAction::SwitchConnectorType(connector_type.into()),
            RuntimeAction::RelationsTouched { names } => ConnectionAction::RelationsTouched(names.into_iter().map(Into::into).collect()),
            RuntimeAction::UpdateCatalog { task_id, handle, variant, started_at, touched_relations } => {
                let mut task = CatalogUpdateTask::new(task_id, variant.into(), connections.now());
                task.started_at = started_at;
                task.touched_relations = touched_relations.unwrap_or_default().into_iter().map(Into::into).collect();
                task.handle = Some(handle);
                ConnectionAction::UpdateCatalog(task)
            }
            RuntimeAction::CatalogUpdateRegisterQuery { task_id, query_id } => ConnectionAction::CatalogUpdateRegisterQuery { task_id, query_id },
            RuntimeAction::CatalogUpdateFinished { task_id, status, error: failure, changed } => {
                let action = match status {
                    CatalogUpdateTaskStatus::SUCCEEDED => ConnectionAction::CatalogUpdateSucceeded { task_id },
                    CatalogUpdateTaskStatus::FAILED => ConnectionAction::CatalogUpdateFailed { task_id, error: error(failure) },
                    CatalogUpdateTaskStatus::CANCELLED => ConnectionAction::CatalogUpdateCancelled { task_id, error: error(failure) },
                    CatalogUpdateTaskStatus::PARTIALLY_SUCCEEDED => {
                        ConnectionAction::CatalogUpdatePartiallySucceeded { task_id, error: error(failure) }
                    }
                    CatalogUpdateTaskStatus::STARTED => return Ok(DispatchOutcome::failed("a catalog update can't finish as started")),
                };
                return Ok(self.connection_outcome(connections.apply(&connection_id, action, changed)));
            }
            RuntimeAction::RestoreCatalogUpdates { described, touched_relations } => {
                let connection = connections.registry.borrow().get(&connection_id).cloned();
                if let Some(connection) = connection {
                    let touched = touched_relations.map(|names| names.into_iter().map(Into::into).collect());
                    connection.state.borrow_mut().restore_catalog_updates(described, touched);
                    self.platform.signal(true);
                }
                return Ok(DispatchOutcome::changed(true));
            }
            RuntimeAction::SetupStep { step, value, channel } => {
                let value = value.map(|value| value.0).unwrap_or(serde_json::Value::Null);
                match setup_action_from_json(connector, &step, &value, channel) {
                    Ok(action) => action,
                    Err(error) => {
                        // The connection doesn't take the channel of a step that fails
                        if let Some(channel) = channel {
                            self.platform.push_release(channel);
                        }
                        return Ok(DispatchOutcome::failed(error));
                    }
                }
            }
            RuntimeAction::ReplaceFunctionScriptText { text } => {
                let connection = connections.registry.borrow().get(&connection_id).cloned();
                let replaced = match connection {
                    Some(connection) => connection.state.borrow_mut().replace_function_script_text(&text),
                    None => Ok(()),
                };
                return Ok(match replaced {
                    Ok(()) => DispatchOutcome::changed(false),
                    Err(error) => DispatchOutcome::failed(error_text(error)),
                });
            }
            action => return self.dispatch_query(QueryOwner::Connection(connection_id), action),
        };
        let channel = match &action {
            ConnectionAction::Hyper(dashql_core_runtime::connections::HyperAction::ChannelReady { channel, .. })
            | ConnectionAction::Trino(dashql_core_runtime::connections::TrinoAction::ChannelReady(channel))
            | ConnectionAction::Salesforce(dashql_core_runtime::connections::SalesforceAction::ChannelReady(channel)) => Some(*channel),
            _ => None,
        };
        let outcome = connections.apply(&connection_id, action, None);
        if let (Err(_), Some(channel)) = (&outcome, channel) {
            // The connection doesn't take the channel of an action that fails
            self.platform.push_release(channel);
            self.platform.signal(true);
        }
        if let Err(error) = &outcome {
            connections.log(LogLevel::Warn, error.what(), &[("connectionId", &connection_id)]);
        }
        Ok(self.connection_outcome(outcome))
    }

    /// Apply an action to a query that the host runs itself, or to a history without a connection
    fn dispatch_query(&self, owner: QueryOwner, action: RuntimeAction) -> Result<DispatchOutcome, JsError> {
        let connections = &self.connections;
        let now = connections.now() as i64;
        let ended = |query_id: f64, message: String, details: Option<String>, metrics: Option<QueryStreamMetrics>, cancelled: bool| {
            let query_id = integer(query_id, "query id")?;
            let error = QueryError { message, details };
            let metrics = metrics.map(Into::into);
            Ok::<_, JsError>(if cancelled {
                QueryExecutionAction::QueryCancelled { query_id, error, metrics, now }
            } else {
                QueryExecutionAction::QueryFailed { query_id, error, metrics, now }
            })
        };
        let action = match action {
            RuntimeAction::CreateHistory { limit } => {
                let QueryOwner::History(name) = &owner else { return Ok(DispatchOutcome::failed("a connection has its own history")) };
                connections.registry.borrow_mut().create_history(name, limit.map(|limit| limit as usize));
                connections.platform.signal(true);
                return Ok(DispatchOutcome::changed(true));
            }
            RuntimeAction::DropHistory => {
                let QueryOwner::History(name) = &owner else { return Ok(DispatchOutcome::failed("a connection has its own history")) };
                let outcome = connections.registry.borrow_mut().drop_history(name);
                connections.settle(None, &outcome, true);
                return Ok(DispatchOutcome::changed(true));
            }
            RuntimeAction::TrackQuery { trace_id, text, metadata, handle } => {
                if connections.registry.borrow().history(&owner).is_none() {
                    // The host keeps the handle of a query that wasn't tracked
                    return Ok(DispatchOutcome::failed(format!("no query history of {owner:?}")));
                }
                let query_id = connections.registry.borrow_mut().next_query_id();
                let mut state = QueryExecutionState::new(query_id, integer(trace_id, "trace id")?, text, metadata.into(), now);
                state.handle = handle;
                return Ok(match connections.apply_query(&owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true) {
                    Ok(_) => DispatchOutcome::created(SliceId::Number(query_id)),
                    Err(error) => DispatchOutcome::failed(error_text(error)),
                });
            }
            RuntimeAction::QuerySending { query_id } => QueryExecutionAction::QuerySending { query_id: integer(query_id, "query id")?, now },
            RuntimeAction::QueryRunning { query_id } => QueryExecutionAction::QueryRunning { query_id: integer(query_id, "query id")?, now },
            RuntimeAction::QueryProcessingResults { query_id } => {
                QueryExecutionAction::QueryProcessingResults { query_id: integer(query_id, "query id")?, now }
            }
            RuntimeAction::QueryProcessedResults { query_id } => {
                QueryExecutionAction::QueryProcessedResults { query_id: integer(query_id, "query id")?, now }
            }
            RuntimeAction::QuerySucceeded { query_id } => QueryExecutionAction::QuerySucceeded { query_id: integer(query_id, "query id")?, now },
            RuntimeAction::QueryFailed { query_id, message, details, metrics } => ended(query_id, message, details, metrics, false)?,
            RuntimeAction::QueryCancelled { query_id, message, details, metrics } => ended(query_id, message, details, metrics, true)?,
            RuntimeAction::QueryReceivedAllBatches { query_id, table, rows, metrics } => QueryExecutionAction::QueryReceivedAllBatches {
                query_id: integer(query_id, "query id")?,
                table: QueryResultTable { id: table, rows: rows.max(0.0) as u64 },
                metrics: metrics.map(Into::into).unwrap_or_default(),
                now,
            },
            RuntimeAction::QueryCacheDeleted { query_id } => QueryExecutionAction::QueryCacheDeleted { query_id: integer(query_id, "query id")? },
            _ => return Ok(DispatchOutcome::failed("the action doesn't apply to the target")),
        };
        // The history releases a table that it doesn't take
        Ok(match connections.apply_query(&owner, action, true) {
            Ok(outcome) => DispatchOutcome::changed(outcome.changed),
            Err(error) => DispatchOutcome::failed(error_text(error)),
        })
    }

    /// Apply an action of the runtime
    fn dispatch_app(&self, action: RuntimeAction) -> Result<DispatchOutcome, JsError> {
        let connections = &self.connections;
        match action {
            RuntimeAction::CreateConnection {
                connection_id,
                connector_type,
                setup_params,
                active,
                params,
                params_draft,
                name,
                cache_query_results,
            } => {
                let parse = |params: Option<JsonParams>| -> Result<Option<ConnectionParams>, String> {
                    params.map(|params| params.connection_params().map_err(error_text)).transpose()
                };
                let (params, params_draft) = match (parse(params), parse(params_draft)) {
                    (Ok(params), Ok(draft)) => (params, draft),
                    (Err(error), _) | (_, Err(error)) => return Ok(DispatchOutcome::failed(error)),
                };
                let created = connections.create(NewConnection {
                    connection_id,
                    connector: connector_type.into(),
                    setup_params: setup_params.map(|params| params.0),
                    active: active.unwrap_or(false),
                    params,
                    params_draft,
                    name,
                    cache_query_results,
                });
                Ok(match created {
                    Ok(id) => DispatchOutcome::created(SliceId::Text(id)),
                    Err(error) => DispatchOutcome::failed(error_text(error)),
                })
            }
            RuntimeAction::SetConnectionReferences { references } => {
                let changed = connections.registry.borrow_mut().set_references(references);
                if changed {
                    connections.platform.signal(true);
                }
                Ok(DispatchOutcome::changed(changed))
            }
            _ => Ok(DispatchOutcome::failed("the action doesn't apply to the runtime")),
        }
    }
}

#[wasm_bindgen]
impl Runtime {
    /// A runtime on a platform
    pub fn create(platform: JsRuntimePlatform) -> Runtime {
        let platform = JsPlatform::new(platform);
        let computations = ComputeService::new(platform.clone());
        let connections = Connections::new(platform.clone(), computations.clone());
        // A runtime starts with an empty list of connections, the host reads none until it changes
        let taken = Taken { list: Some((Vec::new(), 0)), ..Taken::default() };
        Runtime { computations, connections, platform, taken: RefCell::new(taken) }
    }

    /// The slices that changed and the effects on handles since the last call
    #[wasm_bindgen(js_name = takeChanges)]
    pub fn take_changes(&self) -> Result<Ts<ChangeSet>, JsError> {
        let effects = self.platform.take_effects();
        let mut changes = Vec::new();
        let mut taken = self.taken.borrow_mut();
        let taken = &mut *taken;

        // The computations
        let current: BTreeMap<TableId, u64> =
            self.computations.read(|state| state.computations().map(|(id, computation)| (id, computation.revision())).collect());
        for (id, revision) in &current {
            if taken.computations.get(id) != Some(revision) {
                changes.push(SliceChange { kind: COMPUTATION.into(), id: SliceId::Number(*id), revision: Some(*revision) });
            }
        }
        for id in taken.computations.keys() {
            if !current.contains_key(id) {
                changes.push(SliceChange { kind: COMPUTATION.into(), id: SliceId::Number(*id), revision: None });
            }
        }
        taken.computations = current;

        let registry = self.connections.registry.borrow();

        // The list of the connections
        let list = registry.list();
        if taken.list.as_ref().map(|(taken, _)| taken) != Some(&list) {
            let revision = next_revision();
            changes.push(SliceChange { kind: CONNECTION_LIST.into(), id: SliceId::Text(ROOT.into()), revision: Some(revision) });
            taken.list = Some((list, revision));
        }

        // The connections
        let mut held: Vec<(String, (ConnectionKey, u64))> = std::mem::take(&mut taken.connections).into_iter().map(|(id, key, revision)| (id, (key, revision))).collect();
        for (id, connection) in registry.connections() {
            let key = ConnectionKey {
                state: connection.state.borrow().revision(),
                queries: connection.queries.borrow().snapshot_queries_active_finished(),
                workbooks: registry.workbooks_of(id).to_vec(),
                save: self.connections.save_revision(id),
            };
            let revision = match take_entry(&mut held, &id.to_string()) {
                Some((taken_key, revision)) if taken_key == key => revision,
                _ => {
                    let revision = next_revision();
                    changes.push(SliceChange { kind: CONNECTION.into(), id: SliceId::Text(id.to_string()), revision: Some(revision) });
                    revision
                }
            };
            taken.connections.push((id.to_string(), key, revision));
        }
        for (id, _) in held {
            changes.push(SliceChange { kind: CONNECTION.into(), id: SliceId::Text(id), revision: None });
        }

        // The histories without a connection
        let mut held: Vec<(String, (Vec<QueryId>, u64))> = std::mem::take(&mut taken.histories).into_iter().map(|(name, ids, revision)| (name, (ids, revision))).collect();
        for (name, history) in registry.histories() {
            let ids = QueryHistoryView::from(&*history.borrow()).queries;
            let revision = match take_entry(&mut held, &name.to_string()) {
                Some((taken_ids, revision)) if taken_ids == ids => revision,
                _ => {
                    let revision = next_revision();
                    changes.push(SliceChange { kind: HISTORY.into(), id: SliceId::Text(name.to_string()), revision: Some(revision) });
                    revision
                }
            };
            taken.histories.push((name.to_string(), ids, revision));
        }
        for (name, _) in held {
            changes.push(SliceChange { kind: HISTORY.into(), id: SliceId::Text(name), revision: None });
        }

        // The queries of every history, the histories that didn't change are skipped
        let owners: Vec<(QueryOwner, _)> = registry
            .connections()
            .map(|(id, connection)| (QueryOwner::Connection(id.to_string()), connection.queries.clone()))
            .chain(registry.histories().map(|(name, history)| (QueryOwner::History(name.to_string()), history.clone())))
            .collect();
        drop(registry);
        let mut held: Vec<(QueryOwner, (u64, BTreeMap<QueryId, u64>))> =
            std::mem::take(&mut taken.queries).into_iter().map(|(owner, revision, queries)| (owner, (revision, queries))).collect();
        for (owner, history) in owners {
            let history = history.borrow();
            let revision = history.revision();
            let queries = match take_entry(&mut held, &owner) {
                Some((taken_revision, taken_queries)) if taken_revision == revision => taken_queries,
                taken_entry => {
                    let mut taken_queries = taken_entry.map(|(_, queries)| queries).unwrap_or_default();
                    let mut current = BTreeMap::new();
                    for query_id in history.active_ids().iter().chain(history.finished_ids()) {
                        let Some(query) = history.query(*query_id) else { continue };
                        if taken_queries.remove(query_id) != Some(query.revision) {
                            changes.push(SliceChange { kind: QUERY.into(), id: SliceId::Number(*query_id), revision: Some(query.revision) });
                        }
                        current.insert(*query_id, query.revision);
                    }
                    for query_id in taken_queries.into_keys() {
                        changes.push(SliceChange { kind: QUERY.into(), id: SliceId::Number(query_id), revision: None });
                    }
                    current
                }
            };
            taken.queries.push((owner, revision, queries));
        }
        for (_, (_, gone)) in held {
            for query_id in gone.into_keys() {
                changes.push(SliceChange { kind: QUERY.into(), id: SliceId::Number(query_id), revision: None });
            }
        }
        to_js(&ChangeSet { changes, effects })
    }

    /// The views of slices, see the declaration of `views` in `RuntimeViews`
    #[wasm_bindgen(skip_typescript)]
    pub fn views(&self, kind: &str, ids: JsValue, known: JsValue) -> Result<JsValue, JsError> {
        match kind {
            COMPUTATION => {
                let ids = Self::number_ids(&ids, "id of a computation")?;
                let views: Vec<Option<ComputationView>> =
                    self.computations.read(|state| ids.iter().map(|id| state.computation(*id).map(ComputationView::from)).collect());
                value_to_js(&views).map_err(|e| JsError::new(&e.to_string()))
            }
            CONNECTION_LIST => {
                let ids = Self::text_ids(&ids, "connection list")?;
                let list = self.connections.registry.borrow().list();
                let views: Vec<Option<ConnectionListView>> =
                    ids.iter().map(|id| (id == ROOT).then(|| ConnectionListView::of(&list))).collect();
                views_to_js(&views)
            }
            CONNECTION => {
                let ids = Self::text_ids(&ids, "connection")?;
                let connections = &self.connections;
                let views: Vec<Option<ConnectionView>> = ids
                    .iter()
                    .map(|id| {
                        let registry = connections.registry.borrow();
                        let connection = registry.get(id)?;
                        let save = connections.save_view(id);
                        let view = ConnectionView::of(&connection.state.borrow(), &connection.queries.borrow(), registry.workbooks_of(id), save);
                        Some(view)
                    })
                    .collect();
                views_to_js(&views)
            }
            QUERY => {
                let ids = Self::number_ids(&ids, "id of a query")?;
                let known: Vec<Option<QueryProfileKeys>> = if known.is_undefined() || known.is_null() {
                    Vec::new()
                } else {
                    serde_wasm_bindgen::from_value(known).map_err(|e| JsError::new(&format!("the known keys of the queries: {e}")))?
                };
                let registry = self.connections.registry.borrow();
                let views: Vec<Option<QueryView>> = ids
                    .iter()
                    .enumerate()
                    .map(|(i, id)| {
                        let (owner, history) = registry.query_history(*id)?;
                        let history = history.borrow();
                        let query = history.query(*id)?;
                        let connection_id = match &owner {
                            QueryOwner::Connection(id) => Some(id.as_str()),
                            QueryOwner::History(_) => None,
                        };
                        let known = known.get(i).copied().flatten().unwrap_or_default();
                        Some(QueryView::of(query, connection_id, known))
                    })
                    .collect();
                views_to_js(&views)
            }
            HISTORY => {
                let ids = Self::text_ids(&ids, "history")?;
                let registry = self.connections.registry.borrow();
                let views: Vec<Option<QueryHistoryView>> = ids
                    .iter()
                    .map(|name| registry.history(&QueryOwner::History(name.clone())).map(|history| QueryHistoryView::from(&*history.borrow())))
                    .collect();
                views_to_js(&views)
            }
            _ => Err(JsError::new(&format!("the runtime has no views of the kind {kind}"))),
        }
    }

    /// Apply an action to a slice
    pub fn dispatch(&self, target: Ts<Target>, action: Ts<RuntimeAction>) -> Result<Ts<DispatchOutcome>, JsError> {
        let target = from_js(&target)?;
        let action = from_js(&action)?;
        let outcome = match target {
            Target::Computation(table_id) => {
                let service = &self.computations;
                match action {
                    RuntimeAction::DeleteComputation => self.settle(service.delete_computation(table_id)),
                    RuntimeAction::OrderBy { constraints } => {
                        self.settle(service.order_by(table_id, constraints.into_iter().map(OrderByConstraint::from).collect()))
                    }
                    RuntimeAction::HistogramFilter { column_group, selection } => {
                        self.settle(service.histogram_filter(table_id, column_group, selection))
                    }
                    RuntimeAction::MostFrequentValueFilter { column_group, value_id } => {
                        self.settle(service.most_frequent_value_filter(table_id, column_group, value_id))
                    }
                    RuntimeAction::ClearCrossFilters => self.settle(service.clear_cross_filters(table_id)),
                    RuntimeAction::SetResultSearchPattern { search, pattern } => {
                        self.settle(service.set_search_pattern(table_id, search.into(), pattern))
                    }
                    RuntimeAction::RequestFilteredColumnAggregation { column_group } => {
                        let requested =
                            service.request_filtered_column_aggregation(table_id, column_group).map(|_| ComputationOutcome::default());
                        self.settle(requested)
                    }
                    _ => DispatchOutcome::failed("the action doesn't apply to a computation"),
                }
            }
            Target::Connection(connection_id) => self.dispatch_connection(connection_id, action)?,
            Target::History(name) => self.dispatch_query(QueryOwner::History(name), action)?,
            Target::App => self.dispatch_app(action)?,
        };
        to_js(&outcome)
    }

    /// Analyze a result as the computation of a table: its import into the compute database, the statistics, the
    /// system columns, the summaries of the columns and the ordering of the options. The result is a table of the
    /// handle table, the computation takes its handle; an analysis that starts no computation releases it. Resolves
    /// once the analysis is done, rejects with the error of a failed task.
    #[wasm_bindgen(js_name = analyzeTable, unchecked_return_type = "Promise<void>")]
    pub fn analyze_table(&self, table_id: f64, table: f64, options: Ts<AnalyzeTableOptions>) -> Result<Promise, JsError> {
        let options = from_js(&options)?;
        let table_id = integer(table_id, "table id")? as TableId;
        let table = integer(table, "table handle")?;
        let table = u32::try_from(table).map_err(|_| JsError::new("the table handle is no integer"))?;
        let ipc = self.platform.read_table(table).map_err(|e| JsError::new(&e.to_string()))?;
        let result = ResultTable::from_ipc_stream(&ipc).map_err(|e| JsError::new(&e.message))?;
        let lifetime = self.platform.register(&lifetime_token()).map_err(|e| JsError::new(&e.to_string()))?;
        let handles = AnalysisHandles { table, lifetime };
        let analyze_options = RuntimeAnalyzeOptions { column_aggregates: options.column_aggregates.unwrap_or(true) };
        let analysis =
            self.computations.analyze_table(table_id, result, handles, options.connection_id, options.client_context, analyze_options);
        let ordering: Vec<OrderByConstraint> = options.ordering.unwrap_or_default().into_iter().map(OrderByConstraint::from).collect();
        let order = (!ordering.is_empty()).then(|| self.computations.order_by_and_wait(table_id, ordering));
        Ok(future_to_promise(async move {
            analysis.await.map_err(task_error)?;
            if let Some(order) = order {
                order.await.map_err(task_error)?;
            }
            Ok(JsValue::UNDEFINED)
        }))
    }

    /// Run a query on a connection. The query is in the history of the connection from the start; it runs once the
    /// host described where it runs (`request`, a promise of the request as JSON: the target, the cache, whether it
    /// publishes and analyzes its result). The caller hears the events of the query (`events`). `failure` is what a
    /// query that the caller failed fails with. Returns the id and the promise of the outcome.
    #[wasm_bindgen(js_name = executeQuery, unchecked_return_type = "QueryTicket")]
    pub fn execute_query(
        &self,
        connection_id: &str,
        args: Ts<QueryArgs>,
        #[wasm_bindgen(unchecked_param_type = "Promise<unknown>")] request: JsValue,
        failure: JsValue,
        #[wasm_bindgen(unchecked_param_type = "((event: QueryCallerEvent) => void) | null")] events: JsValue,
    ) -> Result<JsValue, JsError> {
        let args = from_js(&args)?;
        let events = if events.is_undefined() || events.is_null() {
            None
        } else {
            Some(events.dyn_into::<Function>().map_err(|_| JsError::new("the events of a query are no function"))?)
        };
        let (query_id, done) = self.connections.execute(connection_id, args, Promise::resolve(&request), failure, events);
        let ticket = Object::new();
        let _ = Reflect::set(&ticket, &JsValue::from_str("queryId"), &JsValue::from_f64(query_id as f64));
        let _ = Reflect::set(&ticket, &JsValue::from_str("done"), &done);
        Ok(ticket.into())
    }

    /// An id of the sequence of the queries without a query, e.g. for the computation of a result that no query of the
    /// runtime produced
    #[wasm_bindgen(js_name = allocateId)]
    pub fn allocate_id(&self) -> f64 {
        self.connections.registry.borrow_mut().allocate_id() as f64
    }

    /// Cancel a query, resolves once it ended
    #[wasm_bindgen(js_name = cancelQuery, unchecked_return_type = "Promise<void>")]
    pub fn cancel_query(&self, query_id: f64) -> Result<Promise, JsError> {
        let cancelled = self.connections.cancel(integer(query_id, "query id")?);
        Ok(future_to_promise(async move {
            cancelled.await;
            Ok(JsValue::UNDEFINED)
        }))
    }

    /// A view starts (`shown` true) or stops showing the profile of a query: the connector then fetches the plan and
    /// its statistics
    #[wasm_bindgen(js_name = watchProfile)]
    pub fn watch_profile(&self, query_id: f64, shown: bool) -> Result<(), JsError> {
        self.connections.watch_profile(integer(query_id, "query id")?, if shown { 1 } else { -1 });
        Ok(())
    }

    /// The layout of the plans of the progress of the queries that start later, null for the default one
    #[wasm_bindgen(js_name = setProgressLayout)]
    pub fn set_progress_layout(&self, layout: Option<Ts<ProfileLayoutView>>) -> Result<(), JsError> {
        let layout = layout.as_ref().map(from_js).transpose()?;
        if let Some(executor) = self.connections.executor() {
            executor.set_progress_layout(layout.map(Into::into));
        }
        Ok(())
    }

    /// Wait for the writes into the query result cache that run, e.g. before a process ends
    #[wasm_bindgen(js_name = flushCacheWrites, unchecked_return_type = "Promise<void>")]
    pub fn flush_cache_writes(&self) -> Promise {
        let flush = self.connections.executor().map(|executor| executor.flush_cache_writes());
        future_to_promise(async move {
            if let Some(flush) = flush {
                flush.await;
            }
            Ok(JsValue::UNDEFINED)
        })
    }

    /// The writer of the storage that the changes and the saves of the connections write through
    #[wasm_bindgen(js_name = setStorageWriter)]
    pub fn set_storage_writer(&self, writer: &StorageWriter) {
        *self.connections.writer.borrow_mut() = Some(writer.runtime());
    }

    /// Save a connection: the given params, else its draft, else its params. The app manifest first, then the params
    /// are committed and the copies of the workbooks that use the connection are written. The view of the connection
    /// shows the save while it runs.
    #[wasm_bindgen(js_name = saveConnection, unchecked_return_type = "Promise<ConnectionSaveOutcome>")]
    pub fn save_connection(&self, connection_id: String, params: Option<Ts<JsonParams>>) -> Result<Promise, JsError> {
        let params = params.as_ref().map(from_js).transpose()?.map(|params| params.connection_params().map_err(|e| JsError::new(e.what()))).transpose()?;
        let save = self.connections.save(connection_id, params);
        Ok(future_to_promise(async move {
            let outcome = save.await.map_err(task_error)?;
            Ok(to_js(&outcome).map_err(JsValue::from)?.into())
        }))
    }

    /// Write the copies of the last save of a connection into workbooks again, null without a save that wrote the app
    /// manifest
    #[wasm_bindgen(js_name = retrySave, unchecked_return_type = "Promise<ConnectionSaveOutcome | null>")]
    pub fn retry_save(&self, connection_id: String, workbook_ids: Vec<String>) -> Promise {
        let retry = self.connections.retry_save(connection_id, workbook_ids);
        future_to_promise(async move {
            match retry.await {
                Some(outcome) => Ok(to_js(&outcome).map_err(JsValue::from)?.into()),
                None => Ok(JsValue::NULL),
            }
        })
    }

    /// The catalog of a connection, shared with the connection and the scripts that analyze with it. None for an
    /// unknown connection.
    pub fn catalog(&self, connection_id: &str) -> Option<Catalog> {
        let registry = self.connections.registry.borrow();
        let connection = registry.get(connection_id)?;
        let catalog = connection.state.borrow().catalog().clone();
        Some(Catalog { inner: SharedCatalog(catalog) })
    }

    /// The text of the script with the functions of a connection, none once it is deleted
    #[wasm_bindgen(js_name = functionScriptText)]
    pub fn function_script_text(&self, connection_id: &str) -> Option<String> {
        let registry = self.connections.registry.borrow();
        let connection = registry.get(connection_id)?;
        let state = connection.state.borrow();
        state.function_script().map(|script| script.to_text())
    }

    /// Adopt a restored connection, returns its id. None if the restore handed it out already.
    #[wasm_bindgen(js_name = adoptRestoredConnection)]
    pub fn adopt_restored_connection(&self, restored: &mut RestoredState, index: u32) -> Result<Option<String>, JsError> {
        let Some(state) = restored.take_connection(index) else { return Ok(None) };
        self.connections.adopt(state).map(Some).map_err(|e| JsError::new(e.what()))
    }

    /// The recording of the progress of a query as JSON, none without structured progress
    #[wasm_bindgen(js_name = queryProgressRecording)]
    pub fn query_progress_recording(&self, query_id: f64) -> Result<Option<String>, JsError> {
        let query_id = integer(query_id, "query id")?;
        let registry = self.connections.registry.borrow();
        let history = registry.query_history(query_id).map(|(_, history)| history);
        Ok(history.and_then(|history| progress_recording(&history.borrow(), query_id)))
    }

    /// Follow the progress of a query with the layout of a follower, none without structured progress. The structure
    /// crosses only when its version differs from the one that the host holds.
    #[wasm_bindgen(js_name = followQueryProgress)]
    pub fn follow_query_progress(
        &self,
        query_id: f64,
        follower: &mut QueryProgressFollower,
        known: Option<Ts<QueryProfileKeys>>,
    ) -> Result<Option<Ts<QueryProfileProgressView>>, JsError> {
        let query_id = integer(query_id, "query id")?;
        let known = known.as_ref().map(from_js).transpose()?.unwrap_or_default();
        let history = {
            let registry = self.connections.registry.borrow();
            registry.query_history(query_id).map(|(_, history)| history)
        };
        match history {
            Some(history) => follower.follow(&history.borrow(), query_id, known),
            None => Ok(None),
        }
    }

    /// Stop the runtime: the queries are cancelled, the computations go, their runs are cancelled and their tables
    /// released with the next changes
    pub fn destroy(&self) {
        let running: Vec<QueryId> = self.connections.runs.borrow().iter().map(|(id, _)| *id).collect();
        for query_id in running {
            drop(self.connections.cancel(query_id));
        }
        self.connections.executor.borrow_mut().take();
        let ids: Vec<TableId> = self.computations.read(|state| state.computations().map(|(id, _)| id).collect());
        for id in ids {
            let deleted = self.computations.delete_computation(id);
            self.settle(deleted);
        }
    }
}

/// The error of a task as a JS error
fn task_error(error: Error) -> JsValue {
    JsError::new(error.what()).into()
}
