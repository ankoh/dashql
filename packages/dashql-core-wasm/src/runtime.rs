//! The runtime of DashQL as one class of the module (docs/wip/runtime_api.md).
//!
//! `Runtime` owns the state of DashQL and its services on one platform object (`JsPlatform`). The host reads the state
//! as views by revision: the runtime tells the platform that it changed, the store of the host takes the changed slices
//! (`takeChanges`) and reads their views once per kind (`views`). Writes are one `dispatch` with a generated union of
//! actions; the work that takes time and returns a result is a method each (`analyzeTable`, `executeQuery`,
//! `cancelQuery`, `saveConnection`, `setupConnection`, ...).
//!
//! The runtime owns the computations of result tables, the connections with the histories of their queries, the
//! histories without a connection (the shell), the query executor, the setups and the health checks of the
//! connections, the catalog loader, the saves of the connections, the workbooks with their scripts, the runs of the
//! workbooks, the storage writer and the restore of the stored state. The other domains join it step by step: a domain adds its state to `Runtime`,
//! its slices to `ViewKind`, its targets and actions to the unions.
//!
//! Every method takes `&self` and the state sits behind the `RefCell`s of the services, which no call holds across a
//! call into the platform. Arguments of the wrong type fail with a JS error, nothing panics.

pub(crate) mod archives;
pub(crate) mod catalog;
pub(crate) mod computation;
pub(crate) mod connections;
pub(crate) mod exports;
pub(crate) mod imports;
pub(crate) mod queries;
pub(crate) mod runs;
pub(crate) mod setups;
pub(crate) mod storage;
pub(crate) mod workbooks;

use std::cell::RefCell;
use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use dashql_core::error::Error;
use dashql_core_runtime::compute::service::{AnalysisHandles, ComputeService};
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions as RuntimeAnalyzeOptions;
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::compute::types::{OrderByConstraint, TableId};
use dashql_core_runtime::compute::ComputationOutcome;
use dashql_core_runtime::connection_setup::setup_action_from_json;
use dashql_core_runtime::connections::registry::{ListedConnection, QueryOwner, RegistryOutcome};
use dashql_core_runtime::connections::{ConnectionAction, ConnectionParams};
use dashql_core_runtime::host::LogLevel;
use dashql_core_runtime::query::{QueryError, QueryExecutionAction, QueryExecutionState, QueryId, QueryResultTable};
use dashql_core_runtime::workbook::next_revision;
use js_sys::{Array, Function, Object, Promise, Reflect};
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::future_to_promise;

use crate::connection::view::{ConnectionListView, ConnectionTableName, ConnectionView, ConnectorType, JsonParams};
use crate::host::{lifetime_token, HandleEffect, JsPlatform, JsRuntimePlatform};
use crate::query_history::view::{ProfileLayoutView, QueryHistoryView, QueryMetadataView, QueryProfileKeys, QueryProfileProgressView, QueryStreamMetrics, QueryView};
use crate::query_history::{progress_recording, QueryProgressFollower};
use crate::views::{from_js, to_js, value_to_js, FlatBufferBytes, JsonValue};
use crate::{js_error, Catalog, ScriptSession, SharedCatalog, ENTRY_IDS};
use computation::{AnalyzeTableOptions, ComputationOrderBy, ComputationSearchKind, ComputationView};
use connections::{Connections, NewConnection};
use queries::QueryArgs;
use runs::view::{RunScriptOptions, RunWorkbookOptions, WorkbookRunView};
use runs::Runs;
use setups::{listener, SetupOptions, SetupOutcome};
use dashql_core::catalog::{Catalog as CoreCatalog, EntryIdSource};
use dashql_core_runtime::restore::{AppRestore, RestoreOptions, RestoredState};
use dashql_core_runtime::workbook_format::data::WORKBOOK_FORMAT_VERSION;
use storage::restore_view::{RestoreOutcome, RestoreProgress as RestoreProgressView, RestoredInvalidWorkbook};
use storage::view::{StorageWriteGenerations, StorageWriteTask};
use storage::{error_value, outcome_value, JsStorage, StorageCommand, StorageState, StorageView};
use workbooks::view::{StoredScriptView, WorkbookDataFile, WorkbookDerivedView, WorkbookListView, WorkbookScriptKeys, WorkbookScriptView, WorkbookView};
use workbooks::{NewWorkbook, StoredScriptRef, Workbooks};

#[wasm_bindgen(typescript_custom_section)]
const RUNTIME_VIEWS: &str = r#"
/** The slices of the runtime by kind: the id of a slice, its view, and the keys of the payloads of its view that the host holds */
export interface RuntimeViews {
    computation: { id: number; view: ComputationView; known: undefined };
    connectionList: { id: 'root'; view: ConnectionListView; known: undefined };
    connection: { id: string; view: ConnectionView; known: undefined };
    query: { id: number; view: QueryView; known: (QueryProfileKeys | null)[] };
    history: { id: string; view: QueryHistoryView; known: undefined };
    workbookList: { id: 'root'; view: WorkbookListView; known: undefined };
    workbook: { id: string; view: WorkbookView; known: undefined };
    script: { id: number; view: WorkbookScriptView; known: (WorkbookScriptKeys | null)[] };
    workbookDerived: { id: string; view: WorkbookDerivedView; known: undefined };
    storage: { id: 'root'; view: StorageView; known: undefined };
    run: { id: string; view: WorkbookRunView; known: undefined };
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
    /// A workbook by its id, with its scripts
    Workbook(String),
    /// The runtime: the lists of the connections and the workbooks
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
    /// Create a workbook without scripts on a connection and write it, the outcome names its id
    CreateWorkbook {
        /// The id, a new one without
        #[serde(default)]
        #[tsify(optional)]
        workbook_id: Option<String>,
        /// The connection of its first script
        connection_id: String,
        #[serde(default)]
        #[tsify(optional)]
        name: Option<String>,
        /// Is it the ephemeral workbook of the greeter? Its first script promotes it.
        #[serde(default)]
        #[tsify(optional)]
        ephemeral: Option<bool>,
        /// The file name the workbook is created from, e.g. the short name of its connector
        #[serde(default)]
        #[tsify(optional)]
        original_file_name: Option<String>,
    },
    /// Drop a workbook, its scripts leave the catalogs of their connections. Its files stay.
    DeleteWorkbook { workbook_id: String },

    // A workbook
    /// Create a script at an index of the feed, appended without one. The base names its file, the connection is the
    /// one of its neighbors without one.
    CreateScript {
        #[serde(default)]
        #[tsify(optional)]
        index: Option<u32>,
        #[serde(default)]
        #[tsify(optional)]
        text: Option<String>,
        base: String,
        #[serde(default)]
        #[tsify(optional)]
        connection_id: Option<String>,
    },
    DeleteScript { file_name: String },
    /// Rename a script, the name is a display name
    RenameScript { file_name: String, new_name: String },
    /// Order the scripts by their file names
    ReorderScripts { order: Vec<String> },
    /// Replace the text of a script, with a diff the rewrite is staged to accept or reject
    SetScriptText {
        script_key: u32,
        text: String,
        #[serde(default)]
        #[tsify(optional)]
        with_diff: Option<bool>,
    },
    AcceptPendingDiff { script_key: u32 },
    RejectPendingDiff { script_key: u32 },
    /// Set the Vega-Lite spec of the chart of a script
    SetScriptVisSpec { script_key: u32, spec: String },
    /// Set the value of an input in the scripts that use it
    SetWorkbookInput { name: String, literal: String, script_keys: Vec<u32> },
    /// Analyze a script if its analysis is outdated
    AnalyzeOutdatedScript { script_key: u32 },
    /// A query of a script started
    RegisterQuery { script_key: u32, query_id: u32 },
    /// A query of a script produced the result that the script shows
    RegisterScriptResult { script_key: u32, query_id: u32 },
    /// Rename the workbook, null removes the name
    RenameWorkbook {
        #[serde(default)]
        #[tsify(optional)]
        name: Option<String>,
    },
    /// Move a script to another connection
    SetScriptConnection { file_name: String, connection_id: String },
    /// Pick the connection of the next appended script
    SetPendingConnection { connection_id: String },
    /// Move the scripts and the pending connection on one connection to another
    ReplaceConnection { from: String, into: String },
    /// Let go of a connection that only the next script would use
    DetachConnection { from: String, into: String },
    /// The data files of the workbook as storage lists them
    SetWorkbookAttachments { files: Vec<WorkbookDataFile> },
    /// The columns of an attachment, read from the file with the stamp
    SetAttachmentColumns { file_name: String, stamp: String, columns: Vec<String> },
    /// An attachment whose file was renamed
    RenameAttachment { file_name: String, new_file_name: String },
    /// Link the workbook to a published workbook, the whole link is written into the workbook file, null removes it
    SetCloudLink {
        #[serde(default)]
        #[tsify(optional)]
        link: Option<JsonValue>,
    },
    /// Replace the scripts with the ones that storage holds, e.g. after the files changed outside of the app. Writes
    /// nothing back.
    ReplaceFromStorage { scripts: Vec<StoredScriptView> },

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
    /// A step of a setup or a health check that the host runs itself, e.g. a mock of a setup, by the name of the action
    /// of the connector (e.g. `TRINO_CHANNEL_READY`). The channel of a ready step is a handle that the connection takes.
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
const WORKBOOK_LIST: &str = "workbookList";
const WORKBOOK: &str = "workbook";
const SCRIPT: &str = "script";
const WORKBOOK_DERIVED: &str = "workbookDerived";
const STORAGE: &str = "storage";
const RUN: &str = "run";
/// The id of the lists of the connections and the workbooks and of the storage
const ROOT: &str = "root";

/// What decides the view of a connection
#[derive(Clone, PartialEq)]
struct ConnectionKey {
    state: u64,
    queries: u64,
    workbooks: Vec<String>,
    save: u64,
    catalog_version: u64,
    setup_running: bool,
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
    /// The key of the list of the workbooks and the revision of its slice
    workbook_list: Option<(u64, u64)>,
    /// The workbooks: the revision of the workbook of the crate, the key of its view and the revision of its slice
    workbooks: Vec<(String, (u64, u64, u64))>,
    /// The scripts of all workbooks by key
    scripts: BTreeMap<u32, u64>,
    /// What the derived views of the workbooks derive from, and the revision of their slices
    derived: Vec<(String, (u64, u64))>,
    /// The revision of the view of the storage
    storage: Option<(u64, u64)>,
    /// The revisions of the runs of the workbooks
    runs: BTreeMap<String, u64>,
}

/// What the derived view of a workbook derives from, as a hash: the names, the connections and the analyses of its
/// scripts and its attachments. The view derives again only when they change.
fn derived_key(workbook: &dashql_core_runtime::workbook::Workbook) -> u64 {
    let mut hasher = DefaultHasher::new();
    for script in workbook.scripts() {
        let connection = script.connection();
        script.key().hash(&mut hasher);
        script.file_name().hash(&mut hasher);
        connection.connection_id.hash(&mut hasher);
        connection.local.hash(&mut hasher);
        script.session().try_borrow().map(|session| session.text_version()).unwrap_or_default().hash(&mut hasher);
        script.editor_update().map(|update| (update.text_version, update.catalog_revision, update.analysis_available)).hash(&mut hasher);
    }
    for attachment in workbook.attachments().unwrap_or_default() {
        attachment.file_name.hash(&mut hasher);
        attachment.size_bytes.hash(&mut hasher);
        attachment.mtime_ms.hash(&mut hasher);
        attachment.columns.hash(&mut hasher);
    }
    hasher.finish()
}

/// Take the entry of a key out of a list
fn take_entry<K: PartialEq, V>(list: &mut Vec<(K, V)>, key: &K) -> Option<V> {
    let index = list.iter().position(|(held, _)| held == key)?;
    Some(list.swap_remove(index).1)
}

/// The runtime of DashQL, see the module
#[wasm_bindgen]
pub struct Runtime {
    pub(crate) platform: JsPlatform,
    computations: ComputeService<JsPlatform>,
    connections: Rc<Connections>,
    pub(crate) workbooks: Rc<Workbooks>,
    runs: Rc<Runs>,
    imports: Rc<imports::Imports>,
    storage: Rc<StorageState>,
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
pub(crate) fn views_to_js<T: Serialize>(views: &T) -> Result<JsValue, JsError> {
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
            RuntimeAction::CreateWorkbook { workbook_id, connection_id, name, ephemeral, original_file_name } => {
                let created = self.workbooks.create(NewWorkbook {
                    workbook_id,
                    connection_id,
                    name,
                    ephemeral: ephemeral.unwrap_or(false),
                    original_file_name,
                });
                Ok(match created {
                    Ok(id) => DispatchOutcome::created(SliceId::Text(id)),
                    Err(error) => DispatchOutcome::failed(error_text(error)),
                })
            }
            RuntimeAction::DeleteWorkbook { workbook_id } => {
                // The run of a workbook that is gone stops
                self.runs.stop(&workbook_id);
                Ok(DispatchOutcome::changed(self.workbooks.delete(&workbook_id)))
            }
            _ => Ok(DispatchOutcome::failed("the action doesn't apply to the runtime")),
        }
    }
}

impl Runtime {
    /// The changed slices of the workbooks, their scripts, their derived views and the storage
    fn take_workbook_changes(&self, taken: &mut Taken, changes: &mut Vec<SliceChange>) {
        let list = Workbooks::list_key(&self.workbooks.entries.borrow(), self.workbooks.invalid_revision.get());
        if taken.workbook_list.map(|(taken, _)| taken) != Some(list) {
            let revision = next_revision();
            changes.push(SliceChange { kind: WORKBOOK_LIST.into(), id: SliceId::Text(ROOT.into()), revision: Some(revision) });
            taken.workbook_list = Some((list, revision));
        }

        let mut held = std::mem::take(&mut taken.workbooks);
        let mut held_derived = std::mem::take(&mut taken.derived);
        let mut scripts = BTreeMap::new();
        let entries = self.workbooks.entries.borrow();
        for entry in entries.iter() {
            let previous = take_entry(&mut held, &entry.id);
            let previous_derived = take_entry(&mut held_derived, &entry.id);
            let Ok(workbook) = entry.workbook.try_borrow() else {
                // A workbook that is busy keeps its slices until the next changes
                if let Some(previous) = previous {
                    taken.workbooks.push((entry.id.clone(), previous));
                }
                if let Some(previous) = previous_derived {
                    taken.derived.push((entry.id.clone(), previous));
                }
                continue;
            };
            let revision = workbook.revision();
            let slice = match previous {
                Some((taken_revision, key, slice)) if taken_revision == revision => (revision, key, slice),
                previous => {
                    let key = workbooks::workbook_key(entry, &workbook);
                    match previous {
                        Some((_, taken_key, slice)) if taken_key == key => (revision, key, slice),
                        _ => {
                            let slice = next_revision();
                            changes.push(SliceChange { kind: WORKBOOK.into(), id: SliceId::Text(entry.id.clone()), revision: Some(slice) });
                            (revision, key, slice)
                        }
                    }
                }
            };
            taken.workbooks.push((entry.id.clone(), slice));
            for script in workbook.scripts() {
                let key = script.key();
                if taken.scripts.get(&key) != Some(&script.revision()) {
                    changes.push(SliceChange { kind: SCRIPT.into(), id: SliceId::Number(key.into()), revision: Some(script.revision()) });
                }
                scripts.insert(key, script.revision());
            }
            let inputs = derived_key(&workbook);
            let derived = match previous_derived {
                Some((taken_inputs, slice)) if taken_inputs == inputs => (taken_inputs, slice),
                _ => {
                    let slice = next_revision();
                    changes.push(SliceChange { kind: WORKBOOK_DERIVED.into(), id: SliceId::Text(entry.id.clone()), revision: Some(slice) });
                    (inputs, slice)
                }
            };
            taken.derived.push((entry.id.clone(), derived));
        }
        drop(entries);
        for (id, _) in held {
            changes.push(SliceChange { kind: WORKBOOK.into(), id: SliceId::Text(id), revision: None });
        }
        for (id, _) in held_derived {
            changes.push(SliceChange { kind: WORKBOOK_DERIVED.into(), id: SliceId::Text(id), revision: None });
        }
        for key in taken.scripts.keys() {
            if !scripts.contains_key(key) {
                changes.push(SliceChange { kind: SCRIPT.into(), id: SliceId::Number((*key).into()), revision: None });
            }
        }
        taken.scripts = scripts;

        let revision = self.storage.revision();
        if taken.storage.map(|(taken, _)| taken) != Some(revision) {
            let slice = next_revision();
            changes.push(SliceChange { kind: STORAGE.into(), id: SliceId::Text(ROOT.into()), revision: Some(slice) });
            taken.storage = Some((revision, slice));
        }

        // The runs of the workbooks
        let runs: BTreeMap<String, u64> = self.runs.revisions().into_iter().collect();
        for (id, revision) in &runs {
            if taken.runs.get(id) != Some(revision) {
                changes.push(SliceChange { kind: RUN.into(), id: SliceId::Text(id.clone()), revision: Some(*revision) });
            }
        }
        for id in taken.runs.keys() {
            if !runs.contains_key(id) {
                changes.push(SliceChange { kind: RUN.into(), id: SliceId::Text(id.clone()), revision: None });
            }
        }
        taken.runs = runs;
    }

    /// The derived view of a workbook: the checked references, the dataflow and the inputs of its scripts
    fn derived_view(&self, workbook_id: &str) -> Option<WorkbookDerivedView> {
        let workbook = self.workbooks.get(workbook_id)?;
        let workbook = workbook.try_borrow().ok()?;
        let (references, dataflow, inputs) = workbook.with_planner(|request, sessions| {
            (crate::pack_reference_check(request, sessions), crate::pack_dataflow(request, sessions), crate::pack_inputs(request))
        });
        Some(WorkbookDerivedView {
            workbook_id: workbook_id.to_string(),
            script_keys: workbook.scripts().iter().map(|script| script.key()).collect(),
            references: FlatBufferBytes(references),
            dataflow: FlatBufferBytes(dataflow),
            inputs: FlatBufferBytes(inputs),
        })
    }

    /// The connection of the scripts on a connection by id
    fn script_connection(&self, connection_id: &str) -> Result<Rc<dashql_core_runtime::workbook::ScriptConnection>, String> {
        self.workbooks.script_connection(connection_id).map_err(error_text)
    }

    /// Apply an action to a workbook
    fn dispatch_workbook(&self, workbook_id: String, action: RuntimeAction) -> Result<DispatchOutcome, JsError> {
        use dashql_core_runtime::workbook::WorkbookAction as A;
        let workbooks = &self.workbooks;
        let connection = |id: &str| self.script_connection(id);
        let action = match action {
            RuntimeAction::CreateScript { index, text, base, connection_id } => {
                let connection = match connection_id.as_deref().map(connection).transpose() {
                    Ok(connection) => connection,
                    Err(error) => return Ok(DispatchOutcome::failed(error)),
                };
                A::CreateScript { index: index.map(|index| index as usize), text, base, connection }
            }
            RuntimeAction::DeleteScript { file_name } => A::DeleteScript { file_name },
            RuntimeAction::RenameScript { file_name, new_name } => A::RenameScript { file_name, new_name },
            RuntimeAction::ReorderScripts { order } => A::ReorderScripts { order },
            RuntimeAction::SetScriptText { script_key, text, with_diff } => {
                A::SetScriptText { key: script_key, text, with_diff: with_diff.unwrap_or(false) }
            }
            RuntimeAction::AcceptPendingDiff { script_key } => A::AcceptPendingDiff { key: script_key },
            RuntimeAction::RejectPendingDiff { script_key } => A::RejectPendingDiff { key: script_key },
            RuntimeAction::SetScriptVisSpec { script_key, spec } => A::SetScriptVisSpec { key: script_key, spec },
            RuntimeAction::SetWorkbookInput { name, literal, script_keys } => A::SetWorkbookInput { name, literal, keys: script_keys },
            RuntimeAction::AnalyzeOutdatedScript { script_key } => A::AnalyzeOutdatedScript { key: script_key },
            RuntimeAction::RegisterQuery { script_key, query_id } => A::RegisterQuery { key: script_key, query_id },
            RuntimeAction::RegisterScriptResult { script_key, query_id } => A::RegisterScriptResult { key: script_key, query_id },
            RuntimeAction::RenameWorkbook { name } => A::RenameWorkbook { name },
            RuntimeAction::SetScriptConnection { file_name, connection_id } => match connection(&connection_id) {
                Ok(connection) => A::SetScriptConnection { file_name, connection },
                Err(error) => return Ok(DispatchOutcome::failed(error)),
            },
            RuntimeAction::SetPendingConnection { connection_id } => match connection(&connection_id) {
                Ok(connection) => A::SetPendingConnection { connection },
                Err(error) => return Ok(DispatchOutcome::failed(error)),
            },
            RuntimeAction::ReplaceConnection { from, into } => match connection(&into) {
                Ok(into) => A::ReplaceConnection { from, into },
                Err(error) => return Ok(DispatchOutcome::failed(error)),
            },
            RuntimeAction::DetachConnection { from, into } => match connection(&into) {
                Ok(into) => A::DetachConnection { from, into },
                Err(error) => return Ok(DispatchOutcome::failed(error)),
            },
            RuntimeAction::SetWorkbookAttachments { files } => {
                let action = A::SetWorkbookAttachments { files: files.into_iter().map(Into::into).collect() };
                let outcome = self.workbook_outcome(&workbook_id, workbooks.apply(&workbook_id, action));
                // The columns of new Parquet attachments are read with the compute database
                self.runs.describe_attachments();
                return Ok(outcome);
            }
            RuntimeAction::SetAttachmentColumns { file_name, stamp, columns } => {
                A::SetAttachmentColumns { file_name, stamp, columns: columns.into_iter().map(std::sync::Arc::<str>::from).collect() }
            }
            RuntimeAction::RenameAttachment { file_name, new_file_name } => A::RenameAttachment { file_name, new_file_name },
            RuntimeAction::SetCloudLink { link } => {
                let link = link.map(|link| link.0).filter(|link| !link.is_null());
                return Ok(self.workbook_outcome(&workbook_id, workbooks.set_cloud_link(&workbook_id, link)));
            }
            RuntimeAction::ReplaceFromStorage { scripts } => {
                let scripts = scripts
                    .into_iter()
                    .map(|script| StoredScriptRef {
                        name: script.name,
                        sql: script.sql,
                        connection_id: script.connection_id,
                        unresolved_connection_id: script.unresolved_connection_id,
                    })
                    .collect();
                let outcome = self.workbook_outcome(&workbook_id, workbooks.replace_from_storage(&workbook_id, scripts));
                self.runs.describe_attachments();
                return Ok(outcome);
            }
            _ => return Ok(DispatchOutcome::failed("the action doesn't apply to a workbook")),
        };
        Ok(self.workbook_outcome(&workbook_id, workbooks.apply(&workbook_id, action)))
    }

    /// What restores the stored state into the runtime
    fn restorer(&self) -> Restorer {
        Restorer {
            platform: self.platform.clone(),
            storage: self.storage.clone(),
            connections: self.connections.clone(),
            workbooks: self.workbooks.clone(),
            runs: self.runs.clone(),
        }
    }

    /// The services that an export reads
    fn exports(&self) -> exports::Exports {
        exports::Exports { platform: self.platform.clone(), connections: self.connections.clone(), workbooks: self.workbooks.clone(), runs: self.runs.clone() }
    }

    /// The outcome of an action of a workbook, a failure is logged
    fn workbook_outcome(&self, workbook_id: &str, outcome: dashql_core::error::Result<bool>) -> DispatchOutcome {
        match outcome {
            Ok(changed) => DispatchOutcome::changed(changed),
            Err(error) => {
                let details = [("workbookId", workbook_id), ("error", error.what())];
                self.platform.log_on(LogLevel::Warn, "Workbook script action failed", &details, "workbook_scripts");
                DispatchOutcome::failed(error_text(error))
            }
        }
    }
}

/// What restores the stored state into the runtime: the restore of the app at startup and the restore of single
/// workbooks, e.g. after an import
#[derive(Clone)]
pub(crate) struct Restorer {
    pub platform: JsPlatform,
    pub storage: Rc<StorageState>,
    pub connections: Rc<Connections>,
    pub workbooks: Rc<Workbooks>,
    pub runs: Rc<Runs>,
}

impl Restorer {
    /// A restore over the storage of the platform that writes through the writer of the runtime
    fn app_restore(&self) -> AppRestore<JsStorage, JsStorage> {
        let host = JsStorage { platform: self.platform.clone(), state: self.storage.clone() };
        let platform = self.platform.clone();
        let options = RestoreOptions {
            offset_unit: Workbooks::offset_unit(),
            new_catalog: Box::new(|| CoreCatalog::with_entry_ids(ENTRY_IDS.with(EntryIdSource::clone))),
            new_uuid: Box::new(move || platform.random_uuid().unwrap_or_default()),
        };
        AppRestore::new(host, self.workbooks.writer.clone(), options)
    }

    /// Restore a single workbook of the storage against the connections of the runtime, unknown connections are
    /// registered and a workbook with the same id is replaced
    pub async fn restore_workbook(self, workbook_id: String) -> Result<RestoreOutcome, dashql_core_runtime::host::HostError> {
        use dashql_core_runtime::restore::{script_connection_of, LiveConnection};
        use dashql_core_runtime::workbook_format::restore::RestoreConnection;
        let mut restore = self.app_restore();
        for (connection_id, connection) in self.connections.registry.borrow().connections() {
            let Ok(state) = connection.state.try_borrow() else { continue };
            let params = serde_json::Value::Object(state.params().to_object());
            let connection = RestoreConnection { connection_id: connection_id.to_string(), params, params_draft: None, name: None, cache_query_results: None };
            restore.add_live_connection(LiveConnection { connection, script_connection: script_connection_of(&state) });
        }
        match restore.restore_workbook(&workbook_id).await {
            Ok(state) => {
                let outcome = adopt_restored(&self.connections, &self.workbooks, state);
                self.runs.describe_attachments();
                Ok(outcome)
            }
            Err(error) => Err(dashql_core_runtime::host::HostError::new(error.what())),
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
        let storage = Rc::new(StorageState::default());
        let host = JsStorage { platform: platform.clone(), state: storage.clone() };
        let writer = dashql_core_runtime::storage::StorageWriter::new(host, WORKBOOK_FORMAT_VERSION.unsigned_abs());
        *connections.writer.borrow_mut() = Some(writer.clone());
        let workbooks = Workbooks::new(platform.clone(), connections.clone(), writer);
        let runs = Runs::new(platform.clone(), connections.clone(), workbooks.clone());
        let imports = imports::Imports::new(platform.clone(), connections.clone());
        // A runtime starts without connections, workbooks and writes, the host reads none until they change
        let taken = Taken {
            list: Some((Vec::new(), 0)),
            workbook_list: Some((Workbooks::list_key(&[], 0), 0)),
            storage: Some((0, 0)),
            ..Taken::default()
        };
        Runtime { computations, connections, workbooks, runs, imports, storage, platform, taken: RefCell::new(taken) }
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
                catalog_version: self.connections.catalog_version(id),
                setup_running: self.connections.setup_running(id),
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
        self.take_workbook_changes(taken, &mut changes);
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
                        let mut view = ConnectionView::of(&connection.state.borrow(), &connection.queries.borrow(), registry.workbooks_of(id), save);
                        view.catalog_version = connections.catalog_version(id);
                        view.setup_running = connections.setup_running(id);
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
            WORKBOOK_LIST => {
                let ids = Self::text_ids(&ids, "workbook list")?;
                let list = self.workbooks.list_view();
                let views: Vec<Option<WorkbookListView>> = ids.iter().map(|id| (id == ROOT).then(|| list.clone())).collect();
                views_to_js(&views)
            }
            WORKBOOK => {
                let ids = Self::text_ids(&ids, "workbook")?;
                let views: Vec<Option<WorkbookView>> = ids.iter().map(|id| self.workbooks.view(id)).collect();
                views_to_js(&views)
            }
            SCRIPT => {
                let ids = Self::number_ids(&ids, "key of a script")?;
                let known: Vec<Option<WorkbookScriptKeys>> = if known.is_undefined() || known.is_null() {
                    Vec::new()
                } else {
                    serde_wasm_bindgen::from_value(known).map_err(|e| JsError::new(&format!("the known keys of the scripts: {e}")))?
                };
                let views: Vec<Option<WorkbookScriptView>> = ids
                    .iter()
                    .enumerate()
                    .map(|(i, key)| {
                        let key = u32::try_from(*key).ok()?;
                        let (workbook_id, workbook) = self.workbooks.of_script(key)?;
                        let workbook = workbook.try_borrow().ok()?;
                        let script = workbook.script(key)?;
                        let known = known.get(i).cloned().flatten().unwrap_or_default();
                        Some(WorkbookScriptView::new(&workbook_id, script, &known))
                    })
                    .collect();
                views_to_js(&views)
            }
            WORKBOOK_DERIVED => {
                let ids = Self::text_ids(&ids, "workbook")?;
                let views: Vec<Option<WorkbookDerivedView>> = ids.iter().map(|id| self.derived_view(id)).collect();
                views_to_js(&views)
            }
            RUN => {
                let ids = Self::text_ids(&ids, "workbook")?;
                let views: Vec<Option<WorkbookRunView>> = ids.iter().map(|id| self.runs.view(id)).collect();
                views_to_js(&views)
            }
            STORAGE => {
                let ids = Self::text_ids(&ids, "storage")?;
                let view = self.storage.view();
                let views: Vec<Option<StorageView>> = ids.iter().map(|id| (id == ROOT).then(|| view.clone())).collect();
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
            Target::Workbook(workbook_id) => self.dispatch_workbook(workbook_id, action)?,
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

    /// Set up a connection with its connector: the channel of its params or of the params of the options, then the
    /// health check unless the connection is online with its channel. The steps go to the connection as they happen, the
    /// view of the connection shows them and whether a setup runs. A setup of the connection that runs is cancelled.
    /// Resolves with the outcome, a failure is in the view of the connection as well.
    #[wasm_bindgen(js_name = setupConnection, unchecked_return_type = "Promise<SetupOutcome>")]
    pub fn setup_connection(&self, connection_id: String, options: Option<Ts<SetupOptions>>) -> Result<Promise, JsError> {
        let options = options.as_ref().map(from_js).transpose()?.unwrap_or_default();
        let setup = self.connections.setup(connection_id, options);
        Ok(future_to_promise(async move { setup_outcome(setup.await) }))
    }

    /// Log in to Salesforce with the params of the connector, without a connection, e.g. the login of the shell. The
    /// steps go to the listener as `{ connector, type, value }`, `cancelSetup` with the id stops the login. The outcome
    /// of a success has the tokens and the user.
    #[wasm_bindgen(js_name = authenticateSalesforce, unchecked_return_type = "Promise<SetupOutcome>")]
    pub fn authenticate_salesforce(
        &self,
        setup_id: String,
        params: JsValue,
        options: Option<Ts<SetupOptions>>,
        #[wasm_bindgen(unchecked_param_type = "((step: { connector: string; type: string; value: any }) => void) | null")] events: JsValue,
    ) -> Result<Promise, JsError> {
        let options = options.as_ref().map(from_js).transpose()?.unwrap_or_default();
        let serde_json::Value::Object(params) = JsonValue::of(&params).0 else {
            return Err(JsError::new("the params of a login are no object"));
        };
        let login = self.connections.authenticate_salesforce(setup_id, params, options, listener(events)?);
        Ok(future_to_promise(async move { setup_outcome(login.await) }))
    }

    /// Cancel the setup of a connection or a login that runs, it ends as cancelled at its next step
    #[wasm_bindgen(js_name = cancelSetup)]
    pub fn cancel_setup(&self, setup_id: &str) {
        self.connections.cancel_setup(setup_id);
    }

    /// Request a refresh of the catalog of a connection, a forced one supersedes a running update. The catalog loader
    /// runs it once the connection is online.
    #[wasm_bindgen(js_name = refreshCatalog)]
    pub fn refresh_catalog(&self, connection_id: &str, force: bool) {
        if let Some(loader) = self.connections.loader() {
            loader.enqueue(connection_id, force);
        }
    }

    /// Start or stop the catalog loader. A stopped loader starts no update, the running ones finish.
    #[wasm_bindgen(js_name = runCatalogLoader)]
    pub fn run_catalog_loader(&self, running: bool) {
        if let Some(loader) = self.connections.loader() {
            if running {
                loader.start();
                self.connections.follow_later();
            } else {
                loader.stop();
            }
        }
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

    // The workbooks

    /// Report the update of an event that the editor of a script applied to the shared session of the script itself, a
    /// packed `EditorUpdate`. An update of a session that the script no longer holds is dropped. An editor that holds no
    /// staged rewrite of the script accepted it with an edit. Returns whether the workbook changed.
    #[wasm_bindgen(js_name = reportEditorUpdate)]
    pub fn report_editor_update(&self, workbook_id: &str, script_key: u32, session_id: u32, update: &[u8], holds_pending_diff: bool) -> Result<bool, JsError> {
        use dashql_core_runtime::workbook::WorkbookAction;
        let Some(workbook) = self.workbooks.get(workbook_id) else {
            return Ok(false);
        };
        let pending_diff = {
            let workbook = workbook.try_borrow().map_err(|_| JsError::new("the workbook is busy"))?;
            let script = workbook.script(script_key).filter(|script| Rc::as_ptr(script.session()) as usize as u32 == session_id);
            match script {
                Some(script) => script.pending_diff().is_some(),
                None => {
                    let key = script_key.to_string();
                    let details = [("workbookId", workbook_id), ("scriptKey", key.as_str())];
                    self.platform.log_on(LogLevel::Warn, "Dropping editor update of an unknown script or a stale session", &details, "workbook_scripts");
                    return Ok(false);
                }
            }
        };
        let update = flatbuffers::root::<dashql_buffers::editor::EditorUpdate>(update).map_err(|_| JsError::new("invalid editor update"))?.unpack();
        let mut changed = self.workbooks.apply(workbook_id, WorkbookAction::ReportEditorUpdate { key: script_key, update, accepts_diff: false }).map_err(js_error)?;
        // The editor accepted or rejected the staged rewrite, a rejection restored the text already
        if pending_diff && !holds_pending_diff {
            changed |= self.workbooks.apply(workbook_id, WorkbookAction::AcceptPendingDiff { key: script_key }).map_err(js_error)?;
        }
        Ok(changed)
    }

    /// The session of a script, shared with its workbook. Every call returns a new handle. None for an unknown script.
    #[wasm_bindgen(js_name = scriptSession)]
    pub fn script_session(&self, script_key: u32) -> Option<ScriptSession> {
        let (_, workbook) = self.workbooks.of_script(script_key)?;
        let workbook = workbook.try_borrow().ok()?;
        let script = workbook.script(script_key)?;
        Some(ScriptSession { catalog: SharedCatalog(script.connection().catalog.clone()), inner: script.session().clone() })
    }

    /// Is the analysis of a script outdated, also by a change that the workbook missed?
    #[wasm_bindgen(js_name = isAnalysisOutdated)]
    pub fn is_analysis_outdated(&self, script_key: u32) -> bool {
        let Some((_, workbook)) = self.workbooks.of_script(script_key) else { return false };
        workbook.try_borrow().ok().and_then(|workbook| workbook.script(script_key).map(|script| script.is_analysis_outdated())).unwrap_or(false)
    }

    /// Give the table parameters of a workbook to a session that is no script of it, e.g. the draft of the composer.
    /// Returns whether the analysis of the session is outdated by them.
    #[wasm_bindgen(js_name = attachTableParameters)]
    pub fn attach_table_parameters(&self, workbook_id: &str, session: &ScriptSession) -> Result<bool, JsError> {
        let Some(workbook) = self.workbooks.get(workbook_id) else { return Ok(false) };
        let workbook = workbook.try_borrow().map_err(|_| JsError::new("the workbook is busy"))?;
        let mut session = session.inner.try_borrow_mut().map_err(|_| JsError::new("the session is busy"))?;
        Ok(workbook.attach_table_parameters(&mut session))
    }

    /// Does storage hold the scripts of a workbook as they are: the same files in the same order, on the same
    /// connections, with the same texts?
    #[wasm_bindgen(js_name = matchesStoredScripts)]
    pub fn matches_stored_scripts(&self, workbook_id: &str, scripts: Vec<Ts<StoredScriptView>>) -> Result<bool, JsError> {
        let Some(workbook) = self.workbooks.get(workbook_id) else { return Ok(false) };
        let scripts = scripts
            .iter()
            .map(|script| {
                let script = script.to_rust()?;
                Ok(StoredScriptRef { name: script.name, sql: script.sql, connection_id: script.connection_id, unresolved_connection_id: script.unresolved_connection_id })
            })
            .collect::<Result<Vec<_>, JsError>>()?;
        let stored = self.workbooks.stored_scripts(scripts).map_err(js_error)?;
        let workbook = workbook.try_borrow().map_err(|_| JsError::new("the workbook is busy"))?;
        Ok(workbook.matches_stored_scripts(&stored))
    }

    // The restore

    /// Restore the connections of the app manifest and the workbooks of the workbook tree of the storage of the
    /// platform. The runtime takes them, the writes after the restore go through its writer. The listener hears the
    /// progress. Resolves with what was restored, the workbooks that were refused a load are in the list of the
    /// workbooks.
    #[wasm_bindgen(unchecked_return_type = "Promise<RestoreOutcome>")]
    pub fn restore(&self, #[wasm_bindgen(unchecked_param_type = "((progress: RestoreProgress) => void) | null")] progress: JsValue) -> Result<Promise, JsError> {
        let listener = if progress.is_undefined() || progress.is_null() {
            None
        } else {
            Some(progress.dyn_into::<Function>().map_err(|_| JsError::new("the progress of a restore is no function"))?)
        };
        self.storage.set_progress(listener);
        let restore = self.restorer().app_restore();
        let connections = self.connections.clone();
        let workbooks = self.workbooks.clone();
        let runs = self.runs.clone();
        let storage = self.storage.clone();
        Ok(future_to_promise(async move {
            let state = restore.restore().await;
            storage.set_progress(None);
            let invalid: Vec<RestoredInvalidWorkbook> = state.invalid_workbooks.iter().map(RestoredInvalidWorkbook::from).collect();
            workbooks.set_invalid(invalid);
            let outcome = adopt_restored(&connections, &workbooks, state);
            runs.describe_attachments();
            Ok(to_js(&outcome).map_err(JsValue::from)?.into())
        }))
    }

    /// Restore a single workbook of the storage, e.g. one that was imported or the folder of a run, against the
    /// connections of the runtime. Unknown connections are registered. A workbook with the same id is replaced. Rejects
    /// if the workbook can't be restored.
    #[wasm_bindgen(js_name = restoreWorkbook, unchecked_return_type = "Promise<RestoreOutcome>")]
    pub fn restore_workbook(&self, workbook_id: String) -> Result<Promise, JsError> {
        let restore = self.restorer().restore_workbook(workbook_id);
        Ok(future_to_promise(async move {
            match restore.await {
                Ok(outcome) => Ok(to_js(&outcome).map_err(JsValue::from)?.into()),
                Err(error) => Err(JsError::new(error.message()).into()),
            }
        }))
    }

    /// Delete the files of a workbook that was refused a load and drop it from the list
    #[wasm_bindgen(js_name = deleteInvalidWorkbook, unchecked_return_type = "Promise<void>")]
    pub fn delete_invalid_workbook(&self, workbook_id: String) -> Promise {
        let deletion = self.workbooks.writer.delete_workbook(&workbook_id);
        let workbooks = self.workbooks.clone();
        future_to_promise(async move {
            let deleted = deletion.await;
            if let Err(error) = &deleted {
                let details = [("workbookId", workbook_id.as_str()), ("error", error.message())];
                workbooks.platform.log_on(LogLevel::Error, "Failed to delete invalid workbook", &details, "workbook_scripts");
            }
            workbooks.forget_invalid(&workbook_id);
            Ok(JsValue::UNDEFINED)
        })
    }

    // The runs of workbooks

    /// Run the scripts of a workbook: all of them, the targets with what they need, or the scripts that a change of
    /// inputs affects. A change of inputs while the workbook is busy stops the run that holds it and starts once the
    /// workbook is free. The listener hears the events of the scripts and may prepare the connections. Resolves with how
    /// the run ended, `refused` names why it didn't start; `error` is what the platform failed with.
    #[wasm_bindgen(js_name = runWorkbook, unchecked_return_type = "Promise<{ outcome: RunOutcome; error: unknown }>")]
    pub fn run_workbook(
        &self,
        workbook_id: &str,
        options: Option<Ts<RunWorkbookOptions>>,
        #[wasm_bindgen(unchecked_param_type = "RunListener | null")] listener: JsValue,
    ) -> Result<Promise, JsError> {
        let options = options.map(|options| from_js(&options)).transpose()?.unwrap_or_default();
        let listener = listener.is_object().then_some(listener);
        let run = self.runs.run_workbook(workbook_id, options, listener);
        Ok(future_to_promise(async move { run_result(run.await) }))
    }

    /// Run a script of a workbook with the scripts it references, see `runWorkbook`. A run that holds the workbook
    /// refuses it.
    #[wasm_bindgen(js_name = runScript, unchecked_return_type = "Promise<{ outcome: RunOutcome; error: unknown }>")]
    pub fn run_script(&self, workbook_id: &str, script_key: u32, options: Option<Ts<RunScriptOptions>>) -> Result<Promise, JsError> {
        let options = options.map(|options| from_js(&options)).transpose()?.unwrap_or_default();
        let run = self.runs.run_script(workbook_id, script_key, options);
        Ok(future_to_promise(async move { run_result(run.await) }))
    }

    /// Stop the run of a workbook, the running statements are cancelled
    #[wasm_bindgen(js_name = stopRun)]
    pub fn stop_run(&self, workbook_id: &str) {
        self.runs.stop(workbook_id);
    }

    /// The reusable result keys of the scripts of a workbook in feed order, the keys that a run reads and writes: of the
    /// targets with what they need, of every script without. Null for a script without one, all null if the analyses as
    /// they are can't be planned.
    #[wasm_bindgen(js_name = resultKeys, unchecked_return_type = "Promise<(string | null)[]>")]
    pub fn result_keys(&self, workbook_id: &str, targets: Option<Vec<u32>>) -> Result<Promise, JsError> {
        let keys = self.runs.result_keys(workbook_id, targets).map_err(|message| JsError::new(&message))?;
        Ok(future_to_promise(async move {
            let keys = keys.await;
            Ok(keys.into_iter().map(|key| key.map(|key| JsValue::from_str(&key)).unwrap_or(JsValue::NULL)).collect::<Array>().into())
        }))
    }

    // The imports and exports of workbooks

    /// Export a workbook: a `.dashql` archive (a Blob of the handle table that the caller releases), a link, or the
    /// workbook tables, which go to `consume` and stay readable until it settled. The pending writes of the workbook
    /// are written first, the cached results are retained while the export reads them. Rejects with what the platform
    /// failed with.
    #[wasm_bindgen(js_name = exportWorkbook, unchecked_return_type = "Promise<ExportOutcome>")]
    pub fn export_workbook(
        &self,
        workbook_id: String,
        options: Ts<exports::ExportOptions>,
        #[wasm_bindgen(unchecked_param_type = "((tables: ExportedTables) => Promise<void>) | null")] consume: JsValue,
    ) -> Result<Promise, JsError> {
        let options = from_js(&options)?;
        let consume = imports::function_of(consume, "consumer of the workbook tables")?;
        let export = self.exports().export_workbook(workbook_id, options, consume);
        Ok(future_to_promise(async move {
            let outcome = export.await.map_err(|error| error_value(&error))?;
            Ok(to_js(&outcome).map_err(JsValue::from)?.into())
        }))
    }

    /// The link of a connection: an empty workbook that holds only the connection, the params sanitized for sharing
    #[wasm_bindgen(js_name = exportConnection, unchecked_return_type = "Promise<string>")]
    pub fn export_connection(&self, connection_id: String, options: Ts<exports::ConnectionLinkOptions>) -> Result<Promise, JsError> {
        let options = from_js(&options)?;
        let export = self.exports().export_connection(connection_id, options);
        Ok(future_to_promise(async move { export.await.map(|link| JsValue::from_str(&link)).map_err(|error| error_value(&error)) }))
    }

    /// The cached results of the scripts of a workbook that an export would carry, counted without reading them
    #[wasm_bindgen(js_name = exportedResults, unchecked_return_type = "Promise<ExportedResults>")]
    pub fn exported_results(&self, workbook_id: String) -> Promise {
        let exports = self.exports();
        future_to_promise(async move {
            let counts = exports.result_counts(&workbook_id).await.map_err(|error| error_value(&error))?;
            Ok(to_js(&counts).map_err(JsValue::from)?.into())
        })
    }

    /// Read a workbook to import: a `.dashql` archive, a workbook folder or the workbook tables of a cloud. Nothing is
    /// written, the import waits for `commitImport` or `dropImport`. Resolves with what an import would write, the
    /// registered workbook with the same id and the questions about the connections.
    #[wasm_bindgen(js_name = readImport, unchecked_return_type = "Promise<ImportPreview>")]
    pub fn read_import(&self, #[wasm_bindgen(unchecked_param_type = "ImportSource")] source: JsValue) -> Promise {
        let read = self.imports.clone().read(source);
        future_to_promise(async move {
            let preview = read.await.map_err(|error| error_value(&error))?;
            Ok(to_js(&preview).map_err(JsValue::from)?.into())
        })
    }

    /// Import a workbook that was read, with the answers to its questions: the connections are mapped, the cached
    /// results go to the query result cache, the workbook is written and restored. The listener hears the steps.
    #[wasm_bindgen(js_name = commitImport, unchecked_return_type = "Promise<ImportOutcome>")]
    pub fn commit_import(
        &self,
        import_id: u32,
        answers: Ts<imports::ImportAnswers>,
        #[wasm_bindgen(unchecked_param_type = "((step: ImportStep, results: ImportedResults | null) => void) | null")] listener: JsValue,
    ) -> Result<Promise, JsError> {
        let answers = from_js(&answers)?;
        let listener = imports::function_of(listener, "listener of the import")?;
        let commit = self.imports.clone().commit(import_id, answers, listener, self.restorer());
        Ok(future_to_promise(async move {
            let outcome = commit.await.map_err(|error| error_value(&error))?;
            Ok(to_js(&outcome).map_err(JsValue::from)?.into())
        }))
    }

    /// Drop an import that was read, its files are released
    #[wasm_bindgen(js_name = dropImport)]
    pub fn drop_import(&self, import_id: u32) {
        self.imports.drop_import(import_id);
    }

    // The storage writer

    /// Run a command of the storage writer: flush, settle, pause and resume it or the writes of a workbook, delete a
    /// workbook. `flushWorkbook` resolves whether every write of the workbook reached the storage, `deleteWorkbook`
    /// rejects with what the storage failed with.
    #[wasm_bindgen(js_name = storage, unchecked_return_type = "Promise<unknown>")]
    pub fn storage_command(&self, command: Ts<StorageCommand>) -> Result<Promise, JsError> {
        let command = from_js(&command)?;
        let writer = self.workbooks.writer.clone();
        let done = |value: JsValue| Promise::resolve(&value);
        Ok(match command {
            StorageCommand::Flush => {
                let flush = writer.flush();
                future_to_promise(async move {
                    flush.await;
                    Ok(JsValue::UNDEFINED)
                })
            }
            StorageCommand::Settle => {
                let settle = writer.settle();
                future_to_promise(async move {
                    settle.await;
                    Ok(JsValue::UNDEFINED)
                })
            }
            StorageCommand::Pause => {
                writer.pause();
                done(JsValue::UNDEFINED)
            }
            StorageCommand::Resume => {
                writer.resume();
                done(JsValue::UNDEFINED)
            }
            StorageCommand::PauseWorkbook { workbook_id } => {
                writer.pause_workbook(&workbook_id);
                done(JsValue::UNDEFINED)
            }
            StorageCommand::ResumeWorkbook { workbook_id } => {
                writer.resume_workbook(&workbook_id);
                self.storage.release_held(&workbook_id);
                self.platform.signal(true);
                done(JsValue::UNDEFINED)
            }
            StorageCommand::ReviveWorkbook { workbook_id } => {
                writer.revive_workbook(&workbook_id);
                done(JsValue::UNDEFINED)
            }
            StorageCommand::FlushWorkbook { workbook_id } => {
                let flush = writer.flush_workbook(&workbook_id);
                future_to_promise(async move { Ok(JsValue::from_bool(flush.await)) })
            }
            StorageCommand::DeleteWorkbook { workbook_id } => {
                let deletion = writer.delete_workbook(&workbook_id);
                future_to_promise(async move { deletion.await.map(|_| JsValue::UNDEFINED).map_err(|error| error_value(&error)) })
            }
            StorageCommand::CancelPendingWrites { workbook_id, keys } => {
                match keys {
                    Some(keys) => writer.cancel_pending_writes(&keys),
                    None => writer.cancel_pending_writes_for_workbook(&workbook_id),
                }
                done(JsValue::UNDEFINED)
            }
            StorageCommand::CancelPendingConnectionFileWrites { connection_id } => {
                writer.cancel_pending_connection_file_writes(&connection_id);
                done(JsValue::UNDEFINED)
            }
        })
    }

    /// Schedule a write that no state of the runtime describes, e.g. a script that the user kept over a change outside
    /// the app or the attachments of a workbook on disk. A durable write runs right away. Resolves with its outcome.
    #[wasm_bindgen(js_name = storageWrite, unchecked_return_type = "Promise<StorageWriteOutcome>")]
    pub fn storage_write(&self, key: &str, task: Ts<StorageWriteTask>, debounce_ms: f64, durable: bool) -> Result<Promise, JsError> {
        let task = StorageWriteTask::read(task)?.try_into()?;
        let writer = &self.workbooks.writer;
        let result = if durable { writer.write_durable(key, task) } else { writer.write(key, task, debounce_ms) };
        Ok(future_to_promise(async move { outcome_value(result.await) }))
    }

    /// The pending keys of the writes of a workbook, or all of them, in the order they were scheduled
    #[wasm_bindgen(js_name = storagePendingKeys)]
    pub fn storage_pending_keys(&self, workbook_id: Option<String>) -> Vec<String> {
        let writer = &self.workbooks.writer;
        match workbook_id {
            Some(workbook_id) => writer.pending_keys_for_workbook(&workbook_id),
            None => writer.pending_keys(),
        }
    }

    /// The statistics of the writes by key, `[key, statistics]` in the order the keys were first written. They change
    /// with every write and are no slice: a view of them reads them when it shows them.
    #[wasm_bindgen(js_name = storageStatistics, unchecked_return_type = "[string, StorageWriteStatistics][]")]
    pub fn storage_statistics(&self) -> Result<JsValue, JsError> {
        views_to_js(&self.storage.statistics())
    }

    /// The latest generation of the keys of a workbook
    #[wasm_bindgen(js_name = storageWriteGenerations)]
    pub fn storage_write_generations(&self, workbook_id: &str) -> Result<Ts<StorageWriteGenerations>, JsError> {
        to_js(&StorageWriteGenerations(self.workbooks.writer.write_generations_for_workbook(workbook_id)))
    }

    /// Are the writes of a workbook held, e.g. after one of its scripts changed outside the app?
    #[wasm_bindgen(js_name = isWorkbookPaused)]
    pub fn is_workbook_paused(&self, workbook_id: &str) -> bool {
        self.workbooks.writer.is_workbook_paused(workbook_id)
    }

    /// Stop the runtime: the queries are cancelled, the computations go, their runs are cancelled and their tables
    /// released with the next changes
    pub fn destroy(&self) {
        self.runs.stop_all();
        self.imports.drop_all();
        if let Some(loader) = self.connections.loader.borrow_mut().take() {
            loader.stop();
        }
        let setups: Vec<String> = self.connections.setups.borrow().iter().map(|setup| setup.id.clone()).collect();
        for setup_id in setups {
            self.connections.cancel_setup(&setup_id);
        }
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

/// Take what a restore restored: the connections and the workbooks join the runtime
fn adopt_restored(connections: &Rc<Connections>, workbooks: &Rc<Workbooks>, state: RestoredState) -> RestoreOutcome {
    let mut connection_ids = Vec::with_capacity(state.connections.len());
    for connection in state.connections {
        match connections.adopt(connection) {
            Ok(id) => connection_ids.push(id),
            Err(error) => connections.log(LogLevel::Error, "Failed to take a restored connection", &[("error", error.what())]),
        }
    }
    let mut workbook_ids = Vec::with_capacity(state.workbooks.len());
    for restored in state.workbooks {
        workbook_ids.push(restored.workbook.id().to_string());
        workbooks.adopt(restored.workbook, restored.metadata);
    }
    workbooks.sync_references();
    RestoreOutcome {
        connection_ids,
        workbook_ids,
        invalid_workbooks: state.invalid_workbooks.iter().map(RestoredInvalidWorkbook::from).collect(),
        progress: RestoreProgressView::from(&state.progress),
    }
}

/// How a run ended as `{ outcome, error }`, with what the platform failed with
fn run_result((outcome, error): (runs::view::RunOutcome, JsValue)) -> Result<JsValue, JsValue> {
    let result = Object::new();
    let _ = Reflect::set(&result, &JsValue::from_str("outcome"), &views_to_js(&outcome).map_err(JsValue::from)?);
    let _ = Reflect::set(&result, &JsValue::from_str("error"), &error);
    Ok(result.into())
}

/// The outcome of a setup as a JS value
fn setup_outcome(outcome: SetupOutcome) -> Result<JsValue, JsValue> {
    views_to_js(&outcome).map_err(JsValue::from)
}

/// The error of a task as a JS error
fn task_error(error: Error) -> JsValue {
    JsError::new(error.what()).into()
}
