//! The runtime of DashQL as one class of the module (docs/design/dashql_core.md).
//!
//! `Runtime` owns the state of DashQL and its services on one platform object (`JsPlatform`). The host reads the state
//! as views by revision: the runtime tells the platform that it changed, the store of the host takes the changed slices
//! (`takeChanges`) and reads their views once per kind (`views`). Writes are one `dispatch` with a generated union of
//! actions per target (`actions.rs`); the work that takes time and returns a result is a method each (`analyzeTable`, `executeQuery`,
//! `cancelQuery`, `saveConnection`, `setupConnection`, ...).
//!
//! The runtime owns the computations of result tables, the connections with the histories of their queries, the query
//! executor, the setups and the health checks of the connections, the catalog loader, the saves of the connections, the
//! workbooks with their scripts, the runs of the workbooks, the storage writer and the restore of the stored state. A new domain adds its state to `Runtime`, its
//! slices to `ViewKind`, its target and its union of actions to `actions.rs`.
//!
//! Every method takes `&self` and the state sits behind the `RefCell`s of the services, which no call holds across a
//! call into the platform. The services mark the slices they change, `takeChanges` reads only those (`changes.rs`).
//! Arguments of the wrong type fail with a JS error, `dispatch` refuses them with a failed outcome, nothing panics.

pub(crate) mod actions;
pub(crate) mod archives;
pub(crate) mod attachments;
pub(crate) mod catalog;
pub(crate) mod changes;
pub(crate) mod computation;
pub(crate) mod compute_tracking;
pub(crate) mod connections;
pub(crate) mod exports;
pub(crate) mod external;
pub(crate) mod imports;
pub(crate) mod migrations;
pub(crate) mod persistence;
pub(crate) mod queries;
pub(crate) mod results;
pub(crate) mod runs;
pub(crate) mod sessions;
pub(crate) mod setups;
pub(crate) mod storage;
pub(crate) mod workbooks;

use std::cell::RefCell;
use std::rc::Rc;

use dashql_core::error::Error;
use dashql_core_runtime::catalog_loader::tables::relations_file_of_entry;
use dashql_core_runtime::compute::service::{AnalysisHandles, ComputeService};
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions as RuntimeAnalyzeOptions;
use dashql_core_runtime::compute::types::{OrderByConstraint, TableId};
use dashql_core_runtime::compute::ComputationOutcome;
use dashql_core_runtime::connections::registry::{
    ConnectionRegistry, RegistryOutcome, ReplacedConnection, WorkbookUse,
};
use dashql_core_runtime::connections::sharing::{self, sanitize_connection_params_for_sharing};
use dashql_core_runtime::connections::{ConnectionAction, ConnectionParams};
use dashql_core_runtime::host::LogLevel;
use dashql_core_runtime::query::{QueryExecutionState, QueryId};
use js_sys::{Array, Function, Object, Promise, Reflect};
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{future_to_promise, JsFuture};

use crate::host::{lifetime_token, HandleEffect, JsPlatform, JsRuntimePlatform};
use crate::query_history::view::{ProfileLayoutView, QueryProfileKeys, QueryProfileProgressView, QueryView};
use crate::query_history::{progress_recording, QueryProgressFollower};
use crate::runtime::connections::view::{
    ConnectionListView, ConnectionSecrets, ConnectionView, ConnectorType, JsonParams,
};
use crate::views::{from_js, to_js, value_to_js, FlatBufferBytes, JsonValue};
use crate::{js_error, Catalog, ScriptSession, SharedCatalog, WorkbookScriptSession};
use changes::{Read, Slice, Taken};
use computation::{AnalyzeTableOptions, ComputationView};
use compute_tracking::ComputeTracker;
use connections::{Connections, NewConnection};
use dashql_core_storage::restore::bundle::BundleHost;
use dashql_core_storage::restore::{AppRestore, RestoreOptions, RestoredState};
use persistence::Persistence;
use queries::{QueryArgs, QueryTicket};
use runs::view::{RunScriptOptions, RunWorkbookOptions, WorkbookRunView};
use runs::Runs;
use setups::{listener, SetupOptions, SetupOutcome};
use storage::restore_view::{RestoreOutcome, RestoreProgress as RestoreProgressView, RestoredInvalidWorkbook};
use storage::view::{StorageHoldReason, StorageKeyStatistics, StorageWriteStatistics};
use storage::{error_value, JsStorage, StorageCommand, StorageState, StorageView};
use workbooks::view::{
    EditorEventOutcome, StoredScriptView, WorkbookDerivedView, WorkbookListView, WorkbookScriptKeys,
    WorkbookScriptView, WorkbookView,
};
use workbooks::{Applied, NewWorkbook, StoredScriptRef, Workbooks};

#[wasm_bindgen(typescript_custom_section)]
const RUNTIME_VIEWS: &str = r#"
/** The slices of the runtime by kind: the id of a slice, its view, and the keys of the payloads of its view that the host holds */
export interface RuntimeViews {
    computation: { id: number; view: ComputationView; known: undefined };
    connectionList: { id: 'root'; view: ConnectionListView; known: undefined };
    connection: { id: string; view: ConnectionView; known: undefined };
    query: { id: number; view: QueryView; known: (QueryProfileKeys | null)[] };
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
/** The read of a slice that a task of the runtime holds: it moves with the next changes, the host keeps its view */
export type BusyView = 'busy';
/** Every action of the runtime, the union of the actions of the targets */
export type RuntimeAction = ComputationAction | ConnectionAction | WorkbookAction | AppAction;
/** The actions of a target: `dispatch` reads an action with the union of its target */
export type ActionOf<T extends Target> =
    T extends 'app' ? AppAction
    : T extends { workbook: string } ? WorkbookAction
    : T extends { connection: string } ? ConnectionAction
    : T extends { computation: number } ? ComputationAction
    : never;
export interface Runtime {
    /** The views of the slices of a kind, null for a slice that is gone, `'busy'` for one that a task holds. One crossing per kind and flush. */
    views<K extends ViewKind>(kind: K, ids: ViewId<K>[], known?: KnownKeys<K>): (ViewOf<K> | BusyView | null)[];
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
    /// A workbook by its id, with its scripts
    Workbook(String),
    /// The runtime: the lists of the connections and the workbooks
    App,
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
    /// What the action created: the id of a connection or of a query, the key of a script
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

/// How the workbooks use a connection and whether the user may delete it (`connectionUsage`)
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionUsageView {
    /// The workbooks that use the connection, without the ephemeral ones and the previews of published workbooks
    pub workbook_count: u32,
    /// The workbooks that keep the connection from being deleted
    pub blocking_workbook_count: u32,
    /// May the user delete the connection? The workbooks whose pending connection it is are detached from it first.
    pub deletable: bool,
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
const WORKBOOK_LIST: &str = "workbookList";
const WORKBOOK: &str = "workbook";
const SCRIPT: &str = "script";
const WORKBOOK_DERIVED: &str = "workbookDerived";
const STORAGE: &str = "storage";
const RUN: &str = "run";
/// The id of the lists of the connections and the workbooks and of the storage
const ROOT: &str = "root";

/// The runtime of DashQL, see the module
#[wasm_bindgen]
pub struct Runtime {
    pub(crate) platform: JsPlatform,
    computations: ComputeService<ComputeTracker>,
    connections: Rc<Connections>,
    pub(crate) workbooks: Rc<Workbooks>,
    runs: Rc<Runs>,
    imports: Rc<imports::Imports>,
    external: Rc<external::ExternalChanges>,
    storage: Rc<StorageState>,
    sessions: sessions::HostSessions,
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
    let serializer =
        serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true).serialize_maps_as_objects(true);
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
                    self.platform.changed(Slice::Computations, true);
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
        Self::ids(ids)?
            .into_iter()
            .map(|id| id.as_string().ok_or_else(|| JsError::new(&format!("the id of a {what} is no string"))))
            .collect()
    }

    /// Apply an action to a connection
    fn connection_outcome(&self, outcome: dashql_core::error::Result<RegistryOutcome>) -> DispatchOutcome {
        match outcome {
            Ok(outcome) => DispatchOutcome::changed(outcome.changed),
            Err(error) => DispatchOutcome::failed(error_text(error)),
        }
    }

    /// The views of slices of a kind, see `Read` for how they cross. The ids of the busy ones go to `busy`.
    fn read_views(
        &self,
        kind: &str,
        ids: JsValue,
        known: JsValue,
        busy: &mut Vec<JsValue>,
    ) -> Result<JsValue, JsError> {
        /// Note the id of a busy slice
        fn noted<T>(read: Read<T>, id: JsValue, busy: &mut Vec<JsValue>) -> Read<T> {
            if matches!(read, Read::Busy) {
                busy.push(id);
            }
            read
        }
        /// Every slice of a kind is busy
        fn all_busy(ids: Vec<JsValue>, busy: &mut Vec<JsValue>) -> Result<JsValue, JsError> {
            let reads: Vec<Read<()>> = ids.iter().map(|_| Read::Busy).collect();
            busy.extend(ids);
            views_to_js(&reads)
        }
        /// The read of the one slice of a kind, e.g. a list: gone for any other id
        fn root<'a, T>(read: &'a Read<T>, id: &str, busy: &mut Vec<JsValue>) -> Read<&'a T> {
            match read {
                _ if id != ROOT => Read::Gone,
                Read::Value(view) => Read::Value(view),
                Read::Gone => Read::Gone,
                Read::Busy => noted(Read::Busy, JsValue::from_str(id), busy),
            }
        }
        let text = |id: &str| JsValue::from_str(id);
        let number = |id: u64| JsValue::from_f64(id as f64);
        match kind {
            COMPUTATION => {
                let ids = Self::number_ids(&ids, "id of a computation")?;
                let reads: Option<Vec<Read<ComputationView>>> = self.computations.try_read(|state| {
                    ids.iter()
                        .map(|id| {
                            state
                                .computation(*id)
                                .map_or(Read::Gone, |computation| Read::Value(ComputationView::from(computation)))
                        })
                        .collect()
                });
                match reads {
                    Some(reads) => value_to_js(&reads).map_err(|e| JsError::new(&e.to_string())),
                    None => all_busy(ids.into_iter().map(number).collect(), busy),
                }
            }
            CONNECTION_LIST => {
                let ids = Self::text_ids(&ids, "connection list")?;
                let list = match self.connections.registry.try_borrow().ok().and_then(|registry| registry.list()) {
                    Some(list) => Read::Value(ConnectionListView::of(&list)),
                    None => Read::Busy,
                };
                let reads: Vec<Read<&ConnectionListView>> = ids.iter().map(|id| root(&list, id, busy)).collect();
                views_to_js(&reads)
            }
            CONNECTION => {
                let ids = Self::text_ids(&ids, "connection")?;
                let Ok(registry) = self.connections.registry.try_borrow() else {
                    return all_busy(ids.iter().map(|id| text(id)).collect(), busy);
                };
                let reads: Vec<Read<ConnectionView>> =
                    ids.iter().map(|id| noted(self.connections.view(&registry, id), text(id), busy)).collect();
                views_to_js(&reads)
            }
            QUERY => {
                let ids = Self::number_ids(&ids, "id of a query")?;
                let known: Vec<Option<QueryProfileKeys>> = if known.is_undefined() || known.is_null() {
                    Vec::new()
                } else {
                    serde_wasm_bindgen::from_value(known)
                        .map_err(|e| JsError::new(&format!("the known keys of the queries: {e}")))?
                };
                let Ok(registry) = self.connections.registry.try_borrow() else {
                    return all_busy(ids.iter().map(|id| number(*id)).collect(), busy);
                };
                let reads: Vec<Read<QueryView>> = ids
                    .iter()
                    .enumerate()
                    .map(|(i, id)| {
                        let read = read_query(&registry, *id, |connection_id, query| {
                            let known = known.get(i).copied().flatten().unwrap_or_default();
                            QueryView::of(query, connection_id, known)
                        });
                        noted(read, number(*id), busy)
                    })
                    .collect();
                views_to_js(&reads)
            }
            WORKBOOK_LIST => {
                let ids = Self::text_ids(&ids, "workbook list")?;
                let list = self.workbooks.list_view();
                let reads: Vec<Read<&WorkbookListView>> = ids.iter().map(|id| root(&list, id, busy)).collect();
                views_to_js(&reads)
            }
            WORKBOOK => {
                let ids = Self::text_ids(&ids, "workbook")?;
                let reads: Vec<Read<WorkbookView>> =
                    ids.iter().map(|id| noted(self.workbooks.view(id), text(id), busy)).collect();
                views_to_js(&reads)
            }
            SCRIPT => {
                let ids = Self::number_ids(&ids, "key of a script")?;
                let known: Vec<Option<WorkbookScriptKeys>> = if known.is_undefined() || known.is_null() {
                    Vec::new()
                } else {
                    serde_wasm_bindgen::from_value(known)
                        .map_err(|e| JsError::new(&format!("the known keys of the scripts: {e}")))?
                };
                let reads: Vec<Read<WorkbookScriptView>> = ids
                    .iter()
                    .enumerate()
                    .map(|(i, key)| {
                        let Ok(script_key) = u32::try_from(*key) else { return Read::Gone };
                        let read = match self.workbooks.of_script(script_key) {
                            Read::Gone => Read::Gone,
                            Read::Busy => Read::Busy,
                            Read::Value((workbook_id, workbook)) => match workbook.try_borrow() {
                                Err(_) => Read::Busy,
                                Ok(workbook) => match workbook.script(script_key) {
                                    None => Read::Gone,
                                    Some(script) => {
                                        let known = known.get(i).cloned().flatten().unwrap_or_default();
                                        Read::Value(WorkbookScriptView::new(&workbook_id, script, &known))
                                    }
                                },
                            },
                        };
                        noted(read, number(*key), busy)
                    })
                    .collect();
                views_to_js(&reads)
            }
            WORKBOOK_DERIVED => {
                let ids = Self::text_ids(&ids, "workbook")?;
                let reads: Vec<Read<WorkbookDerivedView>> = ids
                    .iter()
                    .map(|id| match noted(self.derived_parts(id), text(id), busy) {
                        Read::Value(parts) => {
                            let [references, dataflow, inputs] = &parts.buffers;
                            Read::Value(WorkbookDerivedView {
                                workbook_id: id.clone(),
                                script_keys: parts.script_keys.clone(),
                                script_files: parts.script_files.clone(),
                                attachments: parts.attachments.clone(),
                                colliding_attachments: parts.colliding_attachments.clone(),
                                references: FlatBufferBytes(references.clone()),
                                dataflow: FlatBufferBytes(dataflow.clone()),
                                inputs: FlatBufferBytes(inputs.clone()),
                                hashes: parts.hashes.map(|hash| format!("{hash:016x}")),
                            })
                        }
                        Read::Gone => Read::Gone,
                        Read::Busy => Read::Busy,
                    })
                    .collect();
                views_to_js(&reads)
            }
            RUN => {
                let ids = Self::text_ids(&ids, "workbook")?;
                let reads: Vec<Read<WorkbookRunView>> =
                    ids.iter().map(|id| noted(self.runs.view(id), text(id), busy)).collect();
                views_to_js(&reads)
            }
            STORAGE => {
                let ids = Self::text_ids(&ids, "storage")?;
                let view = self.storage.view();
                let reads: Vec<Read<&StorageView>> = ids.iter().map(|id| root(&view, id, busy)).collect();
                views_to_js(&reads)
            }
            _ => Err(JsError::new(&format!("the runtime has no views of the kind {kind}"))),
        }
    }

    /// Apply an action to a slice: the action is read with the union of the target. Malformed input and a refused
    /// action are failed outcomes.
    fn dispatch_action(&self, target: Target, action: JsValue) -> DispatchOutcome {
        fn read<A: serde::de::DeserializeOwned>(action: JsValue) -> Result<A, String> {
            serde_wasm_bindgen::from_value::<A>(action).map_err(|error| format!("the action is malformed: {error}"))
        }
        let outcome = match target {
            Target::Computation(table_id) => read(action).map(|action| self.dispatch_computation(table_id, action)),
            Target::Connection(connection_id) => {
                read(action).and_then(|action| self.dispatch_connection(connection_id, action))
            }
            Target::Workbook(workbook_id) => read(action).map(|action| self.dispatch_workbook(workbook_id, action)),
            Target::App => read(action).map(|action| self.dispatch_app(action)),
        };
        outcome.unwrap_or_else(DispatchOutcome::failed)
    }

    /// Apply an action to a computation
    fn dispatch_computation(&self, table_id: u64, action: actions::ComputationAction) -> DispatchOutcome {
        use actions::ComputationAction as A;
        let service = &self.computations;
        match action {
            A::DeleteComputation => self.settle(service.delete_computation(table_id)),
            A::OrderBy { constraints } => {
                self.settle(service.order_by(table_id, constraints.into_iter().map(OrderByConstraint::from).collect()))
            }
            A::HistogramFilter { column_group, selection } => {
                self.settle(service.histogram_filter(table_id, column_group, selection))
            }
            A::MostFrequentValueFilter { column_group, value_id } => {
                self.settle(service.most_frequent_value_filter(table_id, column_group, value_id))
            }
            A::ClearCrossFilters => self.settle(service.clear_cross_filters(table_id)),
            A::SetResultSearchPattern { search, pattern } => {
                self.settle(service.set_search_pattern(table_id, search.into(), pattern))
            }
            A::RequestFilteredColumnAggregation { column_group } => {
                let requested = service
                    .request_filtered_column_aggregation(table_id, column_group)
                    .map(|_| ComputationOutcome::default());
                self.settle(requested)
            }
        }
    }

    /// Apply an action to a connection, the actions of its queries included
    fn dispatch_connection(
        &self,
        connection_id: String,
        action: actions::ConnectionAction,
    ) -> Result<DispatchOutcome, String> {
        use actions::ConnectionAction as A;
        let connections = &self.connections;
        let Ok(registry) = connections.registry.try_borrow() else {
            return Ok(DispatchOutcome::failed("the connections are busy"));
        };
        if registry.get(&connection_id).is_none() {
            return Ok(DispatchOutcome::failed(format!("no connection registered with id {connection_id}")));
        }
        drop(registry);
        let action = match action {
            A::SetDraft { params: draft } => match draft.connection_params() {
                // Params of another connector are ignored
                Ok(draft) => ConnectionAction::SetDraft(draft),
                Err(error) => return Ok(DispatchOutcome::failed(error_text(error))),
            },
            A::DiscardDraft => ConnectionAction::DiscardDraft,
            A::Rename { name } => ConnectionAction::Rename(name),
            A::DeleteConnection => ConnectionAction::Delete,
            A::ResetConnection => ConnectionAction::Reset,
            A::RelationsTouched { names } => {
                ConnectionAction::RelationsTouched(names.into_iter().map(Into::into).collect())
            }
        };
        // The host logs a refused action
        let outcome = connections.apply(&connection_id, action, None);
        Ok(self.connection_outcome(outcome))
    }

    /// Apply an action of the runtime
    fn dispatch_app(&self, action: actions::AppAction) -> DispatchOutcome {
        use actions::AppAction as A;
        let connections = &self.connections;
        match action {
            A::CreateConnection { connection_id, connector_type, setup_params, active, params, params_draft, name } => {
                let parse = |params: Option<JsonParams>| -> Result<Option<ConnectionParams>, String> {
                    params.map(|params| params.connection_params().map_err(error_text)).transpose()
                };
                let (params, params_draft) = match (parse(params), parse(params_draft)) {
                    (Ok(params), Ok(draft)) => (params, draft),
                    (Err(error), _) | (_, Err(error)) => return DispatchOutcome::failed(error),
                };
                let created = connections.create(NewConnection {
                    connection_id,
                    connector: connector_type.into(),
                    setup_params: setup_params.map(|params| params.0),
                    active: active.unwrap_or(false),
                    params,
                    params_draft,
                    name,
                });
                match created {
                    Ok(id) => DispatchOutcome::created(SliceId::Text(id)),
                    Err(error) => DispatchOutcome::failed(error_text(error)),
                }
            }
            A::CreateWorkbook { workbook_id, connection_id, name, ephemeral, original_file_name } => {
                let created = self.workbooks.create(NewWorkbook {
                    workbook_id,
                    connection_id,
                    name,
                    ephemeral: ephemeral.unwrap_or(false),
                    original_file_name,
                });
                match created {
                    Ok(id) => DispatchOutcome::created(SliceId::Text(id)),
                    Err(error) => DispatchOutcome::failed(error_text(error)),
                }
            }
            // The run of a workbook that is gone stops and its slice goes, see `Runs::forget`
            A::DeleteWorkbook { workbook_id } => DispatchOutcome::changed(self.workbooks.delete(&workbook_id)),
        }
    }
}

impl Runtime {
    /// The connection of the scripts on a connection by id
    fn script_connection(
        &self,
        connection_id: &str,
    ) -> Result<Rc<dashql_core_runtime::workbook::ScriptConnection>, String> {
        self.workbooks.script_connection(connection_id).map_err(error_text)
    }

    /// Apply an action to a workbook
    fn dispatch_workbook(&self, workbook_id: String, action: actions::WorkbookAction) -> DispatchOutcome {
        use actions::WorkbookAction as W;
        use dashql_core_runtime::workbook::WorkbookAction as A;
        let workbooks = &self.workbooks;
        let connection = |id: &str| self.script_connection(id);
        let action = match action {
            W::CreateScript { index, text, base, connection_id } => {
                let connection = match connection_id.as_deref().map(connection).transpose() {
                    Ok(connection) => connection,
                    Err(error) => return DispatchOutcome::failed(error),
                };
                A::CreateScript { index: index.map(|index| index as usize), text, base, connection }
            }
            W::DeleteScript { file_name } => A::DeleteScript { file_name },
            W::RenameScript { file_name, new_name } => A::RenameScript { file_name, new_name },
            W::ReorderScripts { order } => A::ReorderScripts { order },
            W::SetScriptText { script_key, text, with_diff } => {
                A::SetScriptText { key: script_key, text, with_diff: with_diff.unwrap_or(false) }
            }
            W::AcceptPendingDiff { script_key } => A::AcceptPendingDiff { key: script_key },
            W::RejectPendingDiff { script_key } => A::RejectPendingDiff { key: script_key },
            W::SetScriptVisSpec { script_key, spec } => A::SetScriptVisSpec { key: script_key, spec },
            W::SetWorkbookInput { name, literal, script_keys } => {
                A::SetWorkbookInput { name, literal, keys: script_keys }
            }
            W::AnalyzeOutdatedScript { script_key } => A::AnalyzeOutdatedScript { key: script_key },
            W::ShowScript { script_key, selected } => {
                workbooks.visible.show(script_key, selected);
                return DispatchOutcome::changed(false);
            }
            W::HideScript { script_key, selected } => {
                workbooks.visible.hide(script_key, selected);
                return DispatchOutcome::changed(false);
            }
            W::RenameWorkbook { name } => A::RenameWorkbook { name },
            W::SetDefaultView { view } => A::SetDefaultView { view: view.into() },
            W::SetScriptConnection { file_name, connection_id } => match connection(&connection_id) {
                Ok(connection) => A::SetScriptConnection { file_name, connection },
                Err(error) => return DispatchOutcome::failed(error),
            },
            W::SetPendingConnection { connection_id } => match connection(&connection_id) {
                Ok(connection) => A::SetPendingConnection { connection },
                Err(error) => return DispatchOutcome::failed(error),
            },
            W::ReplaceConnection { from, into } => match connection(&into) {
                Ok(into) => A::ReplaceConnection { from, into },
                Err(error) => return DispatchOutcome::failed(error),
            },
            W::DetachConnection { from, into } => match connection(&into) {
                Ok(into) => A::DetachConnection { from, into },
                Err(error) => return DispatchOutcome::failed(error),
            },
            W::SetWorkbookAttachments { files } => {
                let action = A::SetWorkbookAttachments { files: files.into_iter().map(Into::into).collect() };
                let outcome =
                    self.workbook_outcome(workbooks.apply(&workbook_id, action).map(|applied| applied.changed));
                // The columns of new Parquet attachments are read with the compute database
                self.runs.describe_attachments();
                return outcome;
            }

            W::SetCloudLink { link } => {
                let link = link.map(|link| link.0).filter(|link| !link.is_null());
                return self.workbook_outcome(workbooks.set_cloud_link(&workbook_id, link));
            }
        };
        match workbooks.apply(&workbook_id, action) {
            // A created script is named by its key
            Ok(Applied { created: Some(key), .. }) => DispatchOutcome::created(SliceId::Number(key.into())),
            outcome => self.workbook_outcome(outcome.map(|applied| applied.changed)),
        }
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
        exports::Exports {
            platform: self.platform.clone(),
            connections: self.connections.clone(),
            workbooks: self.workbooks.clone(),
        }
    }

    /// The outcome of an action of a workbook, the host logs a refused one
    fn workbook_outcome(&self, outcome: dashql_core::error::Result<bool>) -> DispatchOutcome {
        match outcome {
            Ok(changed) => DispatchOutcome::changed(changed),
            Err(error) => DispatchOutcome::failed(error_text(error)),
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
    /// The connections of the runtime, a restored workbook resolves against them
    fn live_connections(&self) -> Vec<dashql_core_storage::restore::LiveConnection> {
        use dashql_core_storage::restore::{script_connection_of, LiveConnection};
        use dashql_core_storage::workbook_format::restore::RestoreConnection;
        let mut live = Vec::new();
        for (connection_id, connection) in self.connections.registry.borrow().connections() {
            let Ok(state) = connection.state.try_borrow() else { continue };
            let params = state.params().to_value();
            let connection =
                RestoreConnection { connection_id: connection_id.to_string(), params, params_draft: None, name: None };
            live.push(LiveConnection { connection, script_connection: script_connection_of(&state) });
        }
        live
    }

    /// Open the workbook of a bundle into memory against the connections of the runtime: the restore reads the bundle
    /// and writes nothing. Unknown connections are registered, a workbook with the same id is replaced.
    pub async fn restore_bundle(
        self,
        bundle: dashql_core_storage::workbook_format::bundle::WorkbookBundle<archives::HostFile>,
    ) -> Result<RestoreOutcome, dashql_core_runtime::host::HostError> {
        let workbook_id = bundle.workbook.workbook_id.clone();
        let files: Vec<(String, archives::HostFile)> =
            bundle.data.iter().map(|file| (file.name.clone(), file.bytes.clone())).collect();
        let options = RestoreOptions {
            offset_unit: Workbooks::offset_unit(),
            new_uuid: {
                let platform = self.platform.clone();
                Box::new(move || platform.random_uuid().ok())
            },
        };
        let host = BundleHost { host: archives::ImportHost(self.platform.clone()), bundle };
        type ImportBundle = BundleHost<archives::ImportHost, archives::HostFile>;
        let mut restore: AppRestore<ImportBundle, JsStorage> = AppRestore::in_memory(host, options);
        for live in self.live_connections() {
            restore.add_live_connection(live);
        }
        let state = restore.restore_workbook(&workbook_id).await?;
        let outcome = adopt_restored(&self.connections, &self.workbooks, state);
        // The workbook keeps the files of its attachments in memory, the import releases its own handles
        if let Some(memory) = self.workbooks.persistence.memory() {
            if let Err(error) = memory.keep(&workbook_id, &files) {
                self.workbooks.delete(&workbook_id);
                return Err(error);
            }
        }
        self.runs.describe_attachments();
        Ok(outcome)
    }

    /// A restore over the storage of the platform that writes through the writer of the runtime
    fn app_restore(&self) -> Result<AppRestore<JsStorage, JsStorage>, dashql_core_runtime::host::HostError> {
        let writer = self.workbooks.persistence.writer().cloned().ok_or_else(|| {
            dashql_core_runtime::host::HostError::new("the runtime keeps no files, its platform has no storage")
        })?;
        let host = JsStorage { platform: self.platform.clone(), state: self.storage.clone() };
        let platform = self.platform.clone();
        let options = RestoreOptions {
            offset_unit: Workbooks::offset_unit(),
            new_uuid: Box::new(move || platform.random_uuid().ok()),
        };
        Ok(AppRestore::new(host, writer, options))
    }

    /// Restore a single workbook of the storage against the connections of the runtime, unknown connections are
    /// registered and a workbook with the same id is replaced
    pub async fn restore_workbook(
        self,
        workbook_id: String,
    ) -> Result<RestoreOutcome, dashql_core_runtime::host::HostError> {
        let mut restore = self.app_restore()?;
        for live in self.live_connections() {
            restore.add_live_connection(live);
        }
        match restore.restore_workbook(&workbook_id).await {
            Ok(state) => {
                let outcome = adopt_restored(&self.connections, &self.workbooks, state);
                self.runs.describe_attachments();
                Ok(outcome)
            }
            Err(error) => Err(error),
        }
    }
}

#[wasm_bindgen]
impl Runtime {
    /// A runtime on a platform, fails for settings that don't read
    pub fn create(platform: JsRuntimePlatform) -> Result<Runtime, JsError> {
        let platform = JsPlatform::new(platform).map_err(|e| JsError::new(&e))?;
        let tracker = ComputeTracker::new(platform.clone());
        let computations = ComputeService::new(tracker.clone());
        let connections = Connections::new(platform.clone(), computations.clone());
        tracker.attach(&connections);
        let storage = Rc::new(StorageState::default());
        let host = JsStorage { platform: platform.clone(), state: storage.clone() };
        // A runtime without storage keeps nothing, e.g. the one of the shell or of an embed without OPFS
        let persistence = if platform.has_storage() {
            let writer = dashql_core_storage::storage::StorageWriter::new(host, storage.stamps.clone());
            *connections.writer.borrow_mut() = Some(writer.clone());
            Persistence::Writer(writer)
        } else {
            Persistence::Memory(Rc::new(persistence::MemoryFiles::new(platform.clone())))
        };
        let workbooks = Workbooks::new(platform.clone(), connections.clone(), persistence);
        let runs = Runs::new(platform.clone(), connections.clone(), workbooks.clone());
        let imports = imports::Imports::new(platform.clone(), connections.clone());
        let external = external::ExternalChanges::new(
            platform.clone(),
            storage.clone(),
            connections.clone(),
            workbooks.clone(),
            runs.clone(),
        );
        // A runtime starts without connections, workbooks and writes, the host reads none until they change
        Ok(Runtime {
            computations,
            connections,
            workbooks,
            runs,
            imports,
            external,
            storage,
            platform,
            sessions: Default::default(),
            taken: RefCell::new(Taken::default()),
        })
    }

    /// The slices that changed and the effects on handles since the last call: the slices that the services marked,
    /// see `changes.rs`. A slice that is busy is never reported as gone, it follows with the next changes. Changes that
    /// fail to cross come again with the next call.
    #[wasm_bindgen(js_name = takeChanges)]
    pub fn take_changes(&self) -> Result<Ts<ChangeSet>, JsError> {
        let changes = self.take();
        match to_js(&changes) {
            Ok(changes) => Ok(changes),
            Err(error) => {
                self.keep_unsent(changes);
                Err(error)
            }
        }
    }

    /// The host failed to project slices of a kind, e.g. a projection threw: they move with the next changes, also if
    /// their views didn't change, and the host is told
    pub fn resync(
        &self,
        #[wasm_bindgen(unchecked_param_type = "ViewKind")] kind: &str,
        #[wasm_bindgen(unchecked_param_type = "(string | number)[]")] ids: JsValue,
    ) -> Result<(), JsError> {
        let ids = Self::ids(&ids)?;
        self.resync_slices(kind, &ids)
    }

    /// The views of slices, see the declaration of `views` in `RuntimeViews`. A slice that is busy reads as `'busy'` and
    /// moves with the next changes, the host keeps its previous view.
    #[wasm_bindgen(skip_typescript)]
    pub fn views(&self, kind: &str, ids: JsValue, known: JsValue) -> Result<JsValue, JsError> {
        let mut busy: Vec<JsValue> = Vec::new();
        let views = self.read_views(kind, ids, known, &mut busy)?;
        if !busy.is_empty() {
            let details = [("kind", kind), ("slices", &busy.len().to_string())];
            self.platform.log_on(
                LogLevel::Warn,
                "Slices were busy when the host read their views, they follow with the next changes",
                &details,
                "runtime",
            );
            // The take that follows runs after the borrow ended
            let _ = self.resync_slices(kind, &busy);
        }
        Ok(views)
    }

    /// Apply an action to a slice, read with the union of the actions of its target (`ActionOf`). Never throws: a
    /// malformed target or action, an action of another target and a refused action are failed outcomes, logged as
    /// warnings.
    #[wasm_bindgen(unchecked_return_type = "DispatchOutcome")]
    pub fn dispatch(
        &self,
        #[wasm_bindgen(unchecked_param_type = "Target")] target: JsValue,
        #[wasm_bindgen(unchecked_param_type = "RuntimeAction")] action: JsValue,
    ) -> JsValue {
        let outcome = match serde_wasm_bindgen::from_value::<Target>(target.clone()) {
            Ok(target) => self.dispatch_action(target, action.clone()),
            Err(error) => DispatchOutcome::failed(format!("the target is malformed: {error}")),
        };
        if !outcome.ok {
            let target =
                js_sys::JSON::stringify(&target).ok().and_then(|target| target.as_string()).unwrap_or_default();
            let kind = Reflect::get(&action, &JsValue::from_str("kind"))
                .ok()
                .and_then(|kind| kind.as_string())
                .unwrap_or_default();
            let details = [
                ("target", target.as_str()),
                ("action", kind.as_str()),
                ("error", outcome.error.as_deref().unwrap_or_default()),
            ];
            self.platform.log_on(LogLevel::Warn, "The runtime refused an action", &details, "runtime");
        }
        views_to_js(&outcome).unwrap_or_else(|_| {
            let failed = Object::new();
            let _ = Reflect::set(&failed, &JsValue::from_str("ok"), &JsValue::FALSE);
            failed.into()
        })
    }
    /// Analyze a result as the computation of a table: its import into the compute database, the statistics, the
    /// system columns, the summaries of the columns and the ordering of the options. The result is a table of the
    /// handle table, the computation takes its handle; an analysis that starts no computation releases it, so does a
    /// call that fails. The module reads only the rows and the schema of the result. A result without columns has
    /// nothing to analyze, its handle is released. Resolves once the analysis is done, rejects with the error of a
    /// failed task.
    #[wasm_bindgen(js_name = analyzeTable, unchecked_return_type = "Promise<void>")]
    pub fn analyze_table(
        &self,
        table_id: f64,
        table: f64,
        options: Ts<AnalyzeTableOptions>,
    ) -> Result<Promise, JsError> {
        let table = integer(table, "table handle")?;
        let table = u32::try_from(table).map_err(|_| JsError::new("the table handle is no integer"))?;
        // The handle is the computation's from here on, a call that fails releases it
        let fail = |error: String| {
            self.platform.release_handle(table);
            JsError::new(&error)
        };
        let options: AnalyzeTableOptions =
            options.to_rust().map_err(|error| fail(format!("the options of the analysis: {error}")))?;
        let table_id =
            integer(table_id, "table id").map_err(|_| fail("the table id is no integer".to_string()))? as TableId;
        let result = self.platform.describe_table(table).map_err(|error| fail(error.to_string()))?;
        if result.schema.fields().is_empty() {
            self.platform.release_handle(table);
            return Ok(Promise::resolve(&JsValue::UNDEFINED));
        }
        let lifetime = self.platform.register(&lifetime_token()).map_err(|error| fail(error.to_string()))?;
        let handles = AnalysisHandles { table, lifetime };
        let analyze_options = RuntimeAnalyzeOptions { column_aggregates: options.column_aggregates.unwrap_or(true) };
        let analysis = self.computations.analyze_table(
            table_id,
            result,
            handles,
            options.connection_id,
            options.client_context,
            analyze_options,
            dashql_core_runtime::http::CancellationToken::new(),
        );
        let ordering: Vec<OrderByConstraint> =
            options.ordering.unwrap_or_default().into_iter().map(OrderByConstraint::from).collect();
        let order = (!ordering.is_empty()).then(|| self.computations.order_by_and_wait(table_id, ordering));
        Ok(future_to_promise(async move {
            analysis.await.map_err(task_error)?;
            if let Some(order) = order {
                order.await.map_err(task_error)?;
            }
            Ok(JsValue::UNDEFINED)
        }))
    }

    /// Rows of an analyzed result from `offset`, at most `limit`, in the order of the result and without the columns
    /// of its computation, as an Arrow IPC stream, e.g. the first rows for the table of a terminal. The filters, the
    /// searches and the ordering of the grid don't apply. With `row_numbers` the row numbers of the rows follow the
    /// fields, e.g. for a chart whose cross filters select rows by them. The rows are read from the data frame of the
    /// computation, the result itself doesn't enter the module. Rejects for a table that has no computation or whose
    /// analysis isn't done.
    #[wasm_bindgen(js_name = previewResult, unchecked_return_type = "Promise<Uint8Array>")]
    pub fn preview_result(
        &self,
        table_id: f64,
        offset: f64,
        limit: f64,
        row_numbers: bool,
    ) -> Result<Promise, JsError> {
        let table_id = integer(table_id, "table id")? as TableId;
        let offset = integer(offset, "offset")?;
        let limit = integer(limit, "limit")?;
        let preview = self.computations.preview(table_id, offset, limit, row_numbers);
        Ok(future_to_promise(async move {
            let ipc = preview.await.map_err(task_error)?;
            Ok(js_sys::Uint8Array::from(ipc.as_slice()).into())
        }))
    }

    /// Write all rows of an analyzed result into a Parquet file at a path of the compute database, e.g. a folder that
    /// the platform mounted for a download, in the order of the result and without the columns of its computation.
    /// Hyper copies the rows from the data frame of the computation, they don't pass through the module or the host.
    /// Rejects like `previewResult`.
    #[wasm_bindgen(js_name = exportResultParquet, unchecked_return_type = "Promise<void>")]
    pub fn export_result_parquet(&self, table_id: f64, path: String) -> Result<Promise, JsError> {
        let table_id = integer(table_id, "table id")? as TableId;
        let export = self.computations.export_parquet(table_id, path);
        Ok(future_to_promise(async move {
            export.await.map_err(task_error)?;
            Ok(JsValue::UNDEFINED)
        }))
    }

    /// A window of the rows that the grid of an analyzed result shows: the rows that pass its filters and its data
    /// search in the order of its ordering, from `offset`, at most `limit`, with the fields of the result and its row
    /// numbers, as an Arrow IPC stream, and the count of the rows that show. The rows are read from the data frame of
    /// the computation, the result itself doesn't enter the module. Rejects like `previewResult`.
    #[wasm_bindgen(js_name = readResultRows, unchecked_return_type = "Promise<{ rows: number; ipc: Uint8Array }>")]
    pub fn read_result_rows(&self, table_id: f64, offset: f64, limit: f64) -> Result<Promise, JsError> {
        let table_id = integer(table_id, "table id")? as TableId;
        let offset = integer(offset, "offset")?;
        let limit = integer(limit, "limit")?;
        let read = self.computations.read_rows(table_id, offset, limit);
        Ok(future_to_promise(async move {
            let window = read.await.map_err(task_error)?;
            let result = Object::new();
            let _ = Reflect::set(&result, &JsValue::from_str("rows"), &JsValue::from_f64(window.rows as f64));
            let ipc = js_sys::Uint8Array::from(window.ipc.as_slice());
            let _ = Reflect::set(&result, &JsValue::from_str("ipc"), &ipc);
            Ok(result.into())
        }))
    }

    /// Run a query on a connection. The query is in the history of the connection from the start; it runs once the
    /// runtime described it: the target on the channel of the connection, the stored result of its script and what the
    /// options of the arguments ask for. The caller hears the events of the query (`events`).
    /// `failure` is what a query that the caller failed fails with. Returns the id and the promise of the outcome.
    #[wasm_bindgen(js_name = executeQuery)]
    pub fn execute_query(
        &self,
        connection_id: &str,
        args: Ts<QueryArgs>,
        failure: JsValue,
        #[wasm_bindgen(unchecked_param_type = "((event: QueryCallerEvent) => void) | null")] events: JsValue,
    ) -> Result<Ts<QueryTicket>, JsError> {
        let args = from_js(&args)?;
        let events = if events.is_undefined() || events.is_null() {
            None
        } else {
            Some(events.dyn_into::<Function>().map_err(|_| JsError::new("the events of a query are no function"))?)
        };
        let (query_id, done) = self.connections.execute(connection_id, args, failure, events);
        to_js(&QueryTicket { query_id: query_id as f64, done: done.into() })
    }

    /// An id of the sequence of the queries without a query, e.g. for the computation of a result that no query of the
    /// runtime produced. Fails while a task holds the registry.
    #[wasm_bindgen(js_name = allocateId)]
    pub fn allocate_id(&self) -> Result<f64, JsError> {
        Ok(self.connections.registry.try_borrow_mut().map_err(|_| busy())?.allocate_id() as f64)
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

    /// A view shows a workbook. The first time a workbook is shown, the runtime reads the stored results of its scripts
    /// that show no result yet (docs/design/workbook_results.md).
    #[wasm_bindgen(js_name = showWorkbook)]
    pub fn show_workbook(&self, workbook_id: &str) {
        self.runs.show_workbook(workbook_id);
    }

    /// Use the file of the stored result of a script while it is pinned: `callback` gets its name below the results of
    /// the workbook, the pin is released once the promise of `callback` settled. Resolves with what `callback` resolves
    /// with, null if the script has no stored result (docs/design/workbook_results.md).
    #[wasm_bindgen(js_name = withStoredResult, unchecked_return_type = "Promise<unknown>")]
    pub fn with_stored_result(
        &self,
        workbook_id: String,
        script: String,
        #[wasm_bindgen(unchecked_param_type = "(name: string) => Promise<unknown>")] callback: Function,
    ) -> Promise {
        let platform = self.platform.clone();
        future_to_promise(async move {
            if !platform.has_results() {
                return Ok(JsValue::NULL);
            }
            let retained =
                results::retain(&platform, &workbook_id, &script).await.map_err(|error| error_value(&error))?;
            let Some((id, result)) = retained else { return Ok(JsValue::NULL) };
            let used = match callback.call1(&JsValue::NULL, &JsValue::from_str(&result.name)) {
                Ok(value) => JsFuture::from(Promise::resolve(&value)).await,
                Err(error) => Err(error),
            };
            platform.results_release(id).await;
            used
        })
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

    /// Wait for the writes of the stored results of scripts that run, e.g. before a process ends
    #[wasm_bindgen(js_name = flushResultWrites, unchecked_return_type = "Promise<void>")]
    pub fn flush_result_writes(&self) -> Promise {
        let flush = self.connections.executor().map(|executor| executor.flush_result_writes());
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
        let params = params
            .as_ref()
            .map(from_js)
            .transpose()?
            .map(|params| params.connection_params().map_err(|e| JsError::new(e.what())))
            .transpose()?;
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

    /// How the workbooks use a connection and whether the user may delete it (`ConnectionRegistry::usage`): ephemeral
    /// workbooks and previews of published workbooks don't count, a workbook keeps the connection if it runs scripts on
    /// it, every workbook keeps the embedded Hyper, which is never deleted
    #[wasm_bindgen(js_name = connectionUsage)]
    pub fn connection_usage(&self, connection_id: &str) -> Result<Ts<ConnectionUsageView>, JsError> {
        let registry =
            self.connections.registry.try_borrow().map_err(|_| JsError::new("the connections are in use"))?;
        let usage = registry.usage(connection_id, |workbook_id| {
            let workbook = self.workbooks.get(workbook_id)?;
            let held = workbook.try_borrow().ok()?;
            let scripts =
                held.scripts().iter().filter(|script| script.connection().connection_id == connection_id).count();
            Some(WorkbookUse { transient: held.ephemeral() || held.is_read_only(), scripts })
        });
        to_js(&ConnectionUsageView {
            workbook_count: usage.workbooks as u32,
            blocking_workbook_count: usage.blocking_workbooks as u32,
            deletable: usage.deletable,
        })
    }

    /// Replace connections with a target connection in every workbook, e.g. to merge connections that describe the same
    /// database (`ConnectionReplacement` of the registry): the scripts and the pending connections of the workbooks
    /// move to the target, then the workbook files are written. Resolves with the replaced connections that are dead,
    /// no workbook uses them and every workbook file was written: the host removes them with what it holds of them. The
    /// others stay, a later replacement continues with them. Rejects without the target.
    #[wasm_bindgen(js_name = replaceConnections, unchecked_return_type = "Promise<string[]>")]
    pub fn replace_connections(&self, source_ids: Vec<String>, target_id: String) -> Promise {
        let replacement = match self.connections.registry.try_borrow() {
            Ok(registry) => registry.replacement(&source_ids, &target_id).map_err(error_text),
            Err(_) => Err("the connections are in use".to_string()),
        };
        let replacement = match replacement {
            Ok(replacement) => replacement,
            Err(error) => return Promise::reject(&JsError::new(&error).into()),
        };
        for (source, workbooks) in &replacement.sources {
            for workbook_id in workbooks {
                let action =
                    actions::WorkbookAction::ReplaceConnection { from: source.clone(), into: target_id.clone() };
                let outcome = self.dispatch_workbook(workbook_id.clone(), action);
                if let Some(error) = outcome.error.as_deref().filter(|_| !outcome.ok) {
                    let details =
                        [("workbookId", workbook_id.as_str()), ("connectionId", source.as_str()), ("error", error)];
                    self.platform.log_on(
                        LogLevel::Warn,
                        "moving a workbook to another connection failed",
                        &details,
                        "connection_replace",
                    );
                }
            }
        }
        let to_write = self
            .connections
            .registry
            .try_borrow()
            .map(|registry| replacement.workbooks_to_write(&registry))
            .unwrap_or_default();
        let flushes: Vec<_> = to_write
            .into_iter()
            .map(|workbook_id| {
                let flush = self.workbooks.persistence.flush_workbook(&workbook_id);
                (workbook_id, flush)
            })
            .collect();
        let connections = self.connections.clone();
        future_to_promise(async move {
            let mut unwritten = Vec::new();
            for (workbook_id, flush) in flushes {
                if !flush.await {
                    unwritten.push(workbook_id);
                }
            }
            let settled = match connections.registry.try_borrow() {
                Ok(registry) => replacement.settle(&registry, &unwritten),
                Err(_) => return Err(JsError::new("the connections are in use").into()),
            };
            let dead = Array::new();
            for (connection_id, fate) in settled {
                match fate {
                    ReplacedConnection::Dead => {
                        let details =
                            [("connectionId", connection_id.as_str()), ("target", replacement.target.as_str())];
                        connections.platform.log_on(
                            LogLevel::Info,
                            "replaced connection",
                            &details,
                            "connection_replace",
                        );
                        dead.push(&JsValue::from_str(&connection_id));
                    }
                    ReplacedConnection::Kept { remaining, unwritten } => {
                        let (remaining, unwritten) = (remaining.join(","), unwritten.join(","));
                        let details = [
                            ("connectionId", connection_id.as_str()),
                            ("target", replacement.target.as_str()),
                            ("unwritten", unwritten.as_str()),
                            ("remaining", remaining.as_str()),
                        ];
                        connections.platform.log_on(
                            LogLevel::Warn,
                            "kept the replaced connection",
                            &details,
                            "connection_replace",
                        );
                    }
                }
            }
            Ok(dead.into())
        })
    }

    /// Set up a connection with its connector: the channel of its params or of the params of the options, then the
    /// health check unless the connection is online with its channel. The steps go to the connection as they happen, the
    /// view of the connection shows them and whether a setup runs. A setup of the connection that runs is cancelled.
    /// Resolves with the outcome, a failure is in the view of the connection as well.
    #[wasm_bindgen(js_name = setupConnection, unchecked_return_type = "Promise<SetupOutcome>")]
    pub fn setup_connection(
        &self,
        connection_id: String,
        options: Option<Ts<SetupOptions>>,
    ) -> Result<Promise, JsError> {
        let options = options.as_ref().map(from_js).transpose()?.unwrap_or_default();
        let setup = self.connections.setup(connection_id, options);
        Ok(future_to_promise(async move { setup_outcome(setup.await) }))
    }

    /// Set up the connections of a workbook that the app opens and that need nothing of the user: the embedded Hyper
    /// and the Hyper of a link once the tab holds its token. Every connection is considered once, the app calls it
    /// again when the workbook or the tokens of the links change.
    #[wasm_bindgen(js_name = setUpOpenedWorkbook)]
    pub fn set_up_opened_workbook(&self, workbook_id: &str) {
        let connection_ids = self
            .workbooks
            .get(workbook_id)
            .and_then(|workbook| workbook.try_borrow().ok().map(|workbook| workbook.connection_ids()));
        self.connections.set_up_opened(workbook_id, connection_ids.unwrap_or_default());
    }

    /// Log in to Salesforce with the params of the connector, without a connection, e.g. the login of the shell. The
    /// names of the steps go to the listener (`login_step_name`, e.g. `REQUESTING_CORE_AUTH_TOKEN`), never a code or a token;
    /// `cancelSetup` with the id stops the login. The outcome of a success has the tokens and the user.
    #[wasm_bindgen(js_name = authenticateSalesforce, unchecked_return_type = "Promise<SetupOutcome>")]
    pub fn authenticate_salesforce(
        &self,
        setup_id: String,
        params: JsValue,
        options: Option<Ts<SetupOptions>>,
        #[wasm_bindgen(unchecked_param_type = "((step: string) => void) | null")] events: JsValue,
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

    /// The tokens of a connection as their JSON, e.g. for the settings of a connection that show them on request. The
    /// views only summarize them. Null without the connection.
    #[wasm_bindgen(js_name = revealConnectionSecrets, unchecked_return_type = "ConnectionSecrets | null")]
    pub fn reveal_connection_secrets(&self, connection_id: &str) -> Result<JsValue, JsError> {
        let connection = self.connections.registry.try_borrow().map_err(|_| busy())?.get(connection_id).cloned();
        let Some(connection) = connection else { return Ok(JsValue::NULL) };
        let secrets = ConnectionSecrets::of(connection.state.try_borrow().map_err(|_| busy())?.details());
        Ok(to_js(&secrets)?.into())
    }

    /// Follow a Hyper link (`hyper::link`): the target of an endpoint and a token, the question to ask before the app
    /// uses it and the connection it binds to, the connection of the recent link of the tab first. Null unless the
    /// endpoint and the token are a target: an endpoint on this machine may speak http, any other one https.
    #[wasm_bindgen(js_name = bindHyperLink, unchecked_return_type = "HyperLinkView | null")]
    pub fn bind_hyper_link(
        &self,
        endpoint: &str,
        token: &str,
        recent_connection_id: Option<String>,
    ) -> Result<JsValue, JsError> {
        use dashql_core_runtime::hyper::link::{bind_hyper_link, parse_hyper_link_target};
        let Some(target) = parse_hyper_link_target(Some(endpoint), Some(token)) else { return Ok(JsValue::NULL) };
        let registry = self.connections.registry.try_borrow().map_err(|_| busy())?;
        let states = registry
            .connections()
            .map(|(_, connection)| connection.state.try_borrow())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| busy())?;
        let binding = bind_hyper_link(&target, states.iter().map(|state| &**state), recent_connection_id.as_deref());
        Ok(to_js(&connections::view::HyperLinkView::of(target, binding))?.into())
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

    /// The catalog of a connection, shared with the connection and the scripts that analyze with it. The handle reads
    /// only: the catalog changes through the runtime, which tells the scripts on it. None for an unknown connection.
    /// The identity of the catalog is `catalogId` of the view of the connection.
    pub fn catalog(&self, connection_id: &str) -> Option<Catalog> {
        let registry = self.connections.registry.try_borrow().ok()?;
        let connection = registry.get(connection_id)?;
        let catalog = connection.state.try_borrow().ok()?.catalog().clone();
        Some(Catalog::read_only(SharedCatalog(catalog)))
    }

    /// The identity of the catalog of a connection, `catalogId` of its view, without reading the view. None for an
    /// unknown connection and while a task holds it.
    #[wasm_bindgen(js_name = catalogId)]
    pub fn catalog_id(&self, connection_id: &str) -> Option<f64> {
        let registry = self.connections.registry.try_borrow().ok()?;
        let connection = registry.get(connection_id)?;
        let state = connection.state.try_borrow().ok()?;
        Some(self.connections.catalog_id(connection_id, state.catalog()) as f64)
    }

    /// The relations file of the catalog of a connection, the text of its `dashql-catalog-relations.sql`: the tables that
    /// the connection reported as `CREATE TABLE` statements. The tab writes it into the copies of an agent session. None
    /// for an unknown connection, while a task holds it, and after a reset of the catalog.
    #[wasm_bindgen(js_name = catalogRelationsFile)]
    pub fn catalog_relations_file(&self, connection_id: &str) -> Option<String> {
        let registry = self.connections.registry.try_borrow().ok()?;
        let connection = registry.get(connection_id)?;
        let state = connection.state.try_borrow().ok()?;
        let catalog = state.catalog().try_borrow().ok()?;
        relations_file_of_entry(&catalog, state.relation_entry_id())
    }

    /// Tests that stand in for the catalog loader: the catalog of a connection as a handle that writes. Its writes
    /// bypass the runtime, nothing is announced. None for an unknown connection.
    #[wasm_bindgen(js_name = testCatalog)]
    pub fn test_catalog(&self, connection_id: &str) -> Option<Catalog> {
        let registry = self.connections.registry.try_borrow().ok()?;
        let connection = registry.get(connection_id)?;
        let catalog = connection.state.try_borrow().ok()?.catalog().clone();
        Some(Catalog::read_write(SharedCatalog(catalog)))
    }

    /// The text of the script with the functions of a connection, none once it is deleted
    #[wasm_bindgen(js_name = functionScriptText)]
    pub fn function_script_text(&self, connection_id: &str) -> Result<Option<String>, JsError> {
        let registry = self.connections.registry.try_borrow().map_err(|_| busy())?;
        let Some(connection) = registry.get(connection_id) else { return Ok(None) };
        let state = connection.state.try_borrow().map_err(|_| busy())?;
        Ok(state.function_script().map(|script| script.to_text()))
    }

    /// The recording of the progress of a query as JSON, none without structured progress
    #[wasm_bindgen(js_name = queryProgressRecording)]
    pub fn query_progress_recording(&self, query_id: f64) -> Result<Option<String>, JsError> {
        let query_id = integer(query_id, "query id")?;
        let registry = self.connections.registry.try_borrow().map_err(|_| busy())?;
        let Some((_, history)) = registry.query_history(query_id) else { return Ok(None) };
        let history = history.try_borrow().map_err(|_| busy())?;
        Ok(progress_recording(&history, query_id))
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
            let registry = self.connections.registry.try_borrow().map_err(|_| busy())?;
            registry.query_history(query_id).map(|(_, history)| history)
        };
        match history {
            Some(history) => follower.follow(&*history.try_borrow().map_err(|_| busy())?, query_id, known),
            None => Ok(None),
        }
    }

    // The workbooks

    /// Apply an event of the editor of a script, a packed `EditorEvent`, and return the packed `EditorUpdate` for the
    /// editor with its key: the workbook takes the update, writes the text and publishes it. The event names the text
    /// version that the editor shows, an editor that missed a change of the text gets the status `STALE_TEXT_VERSION`
    /// and shows the text of the script again. `known` is the key of the update that the editor holds
    /// (`editorUpdateKey`), the update leaves out the analysis if the editor holds the one of the script. An edit of the
    /// user accepts a staged rewrite. Null for an event of a session that the script no longer holds (`sessionGeneration`
    /// of the view of the script).
    #[wasm_bindgen(js_name = applyEditorEvent)]
    pub fn apply_editor_event(
        &self,
        workbook_id: &str,
        script_key: u32,
        session_generation: f64,
        event: &[u8],
        known: Option<String>,
    ) -> Result<Option<Ts<EditorEventOutcome>>, JsError> {
        let generation = integer(session_generation, "session generation")?;
        let event = flatbuffers::root::<dashql_buffers::editor::EditorEvent>(event)
            .map_err(|_| JsError::new("invalid editor event"))?
            .unpack();
        let outcome = self
            .workbooks
            .apply_editor_event(workbook_id, script_key, generation, event, known.as_deref())
            .map_err(js_error)?;
        match outcome {
            Some((update, key)) => Ok(Some(to_js(&EditorEventOutcome { update: FlatBufferBytes(update), key })?)),
            None => {
                let key = script_key.to_string();
                let details = [("workbookId", workbook_id), ("scriptKey", key.as_str())];
                self.platform.log_on(
                    LogLevel::Warn,
                    "Dropping editor event of an unknown script or a stale session",
                    &details,
                    "workbook_scripts",
                );
                Ok(None)
            }
        }
    }

    /// The session of a script, shared with its workbook, as a handle that reads it. Every call returns a new handle.
    /// None for an unknown script.
    #[wasm_bindgen(js_name = scriptSession)]
    pub fn script_session(&self, script_key: u32) -> Option<WorkbookScriptSession> {
        let (_, workbook) = self.workbooks.of_script(script_key).value()?;
        let workbook = workbook.try_borrow().ok()?;
        let script = workbook.script(script_key)?;
        Some(WorkbookScriptSession::new(SharedCatalog(script.connection().catalog.clone()), script.session().clone()))
    }

    /// Tests of the seam: call a function while a part of the state is borrowed, as a task of the runtime would hold it.
    /// The function may take the changes and read the views. The parts: `workbook:<id>`, `connection:<id>` (its state),
    /// `queries:<connection id>` (its history), `registry`, `workbooks`, `scriptIndex`, `computations`, `runs`,
    /// `storage`.
    #[wasm_bindgen(js_name = testHold)]
    pub fn test_hold(&self, part: &str, f: &Function) -> Result<JsValue, JsError> {
        let call = || f.call0(&JsValue::NULL).map_err(|error| JsError::new(&crate::host::message_of(&error)));
        let busy = || JsError::new("the part is busy");
        let (name, id) = part.split_once(':').unwrap_or((part, ""));
        match name {
            "workbook" => {
                let workbook =
                    self.workbooks.get(id).ok_or_else(|| JsError::new("no workbook registered with the id"))?;
                let _held = workbook.try_borrow_mut().map_err(|_| busy())?;
                call()
            }
            "connection" => {
                let state = self
                    .connections
                    .registry
                    .try_borrow()
                    .map_err(|_| busy())?
                    .get(id)
                    .map(|connection| connection.state.clone());
                let state = state.ok_or_else(|| JsError::new("no connection registered with the id"))?;
                let _held = state.try_borrow_mut().map_err(|_| busy())?;
                call()
            }
            "queries" => {
                let history = self.connections.registry.try_borrow().map_err(|_| busy())?.history(id);
                let history = history.ok_or_else(|| JsError::new("no connection registered with the id"))?;
                let _held = history.try_borrow_mut().map_err(|_| busy())?;
                call()
            }
            "registry" => {
                let _held = self.connections.registry.try_borrow_mut().map_err(|_| busy())?;
                call()
            }
            "workbooks" => {
                let _held = self.workbooks.entries.try_borrow_mut().map_err(|_| busy())?;
                call()
            }
            "scriptIndex" => {
                let _held = self.workbooks.script_index.try_borrow_mut().map_err(|_| busy())?;
                call()
            }
            "computations" => self.computations.hold(call).ok_or_else(busy)?,
            "runs" => self.runs.hold(call).ok_or_else(busy)?,
            "storage" => self.storage.hold(call).ok_or_else(busy)?,
            _ => Err(JsError::new(&format!("no part {part} to hold"))),
        }
    }

    /// Is the analysis of a script outdated, also by a change that the workbook missed?
    #[wasm_bindgen(js_name = isAnalysisOutdated)]
    pub fn is_analysis_outdated(&self, script_key: u32) -> bool {
        let Some((_, workbook)) = self.workbooks.of_script(script_key).value() else { return false };
        workbook
            .try_borrow()
            .ok()
            .and_then(|workbook| workbook.script(script_key).map(|script| script.is_analysis_outdated()))
            .unwrap_or(false)
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
    pub fn matches_stored_scripts(
        &self,
        workbook_id: &str,
        scripts: Vec<Ts<StoredScriptView>>,
    ) -> Result<bool, JsError> {
        let Some(workbook) = self.workbooks.get(workbook_id) else { return Ok(false) };
        let scripts = scripts
            .iter()
            .map(|script| {
                let script = script.to_rust()?;
                Ok(StoredScriptRef {
                    name: script.name,
                    sql: script.sql,
                    connection_id: script.connection_id,
                    unresolved_connection_id: script.unresolved_connection_id,
                })
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
    pub fn restore(
        &self,
        #[wasm_bindgen(unchecked_param_type = "((progress: RestoreProgress) => void) | null")] progress: JsValue,
    ) -> Result<Promise, JsError> {
        let listener = if progress.is_undefined() || progress.is_null() {
            None
        } else {
            Some(
                progress
                    .dyn_into::<Function>()
                    .map_err(|_| JsError::new("the progress of a restore is no function"))?,
            )
        };
        self.storage.set_progress(listener);
        let restore = self.restorer().app_restore().map_err(|error| JsError::new(error.message()))?;
        let connections = self.connections.clone();
        let workbooks = self.workbooks.clone();
        let runs = self.runs.clone();
        let storage = self.storage.clone();
        Ok(future_to_promise(async move {
            let state = restore.restore().await;
            storage.set_progress(None);
            let invalid: Vec<RestoredInvalidWorkbook> =
                state.invalid_workbooks.iter().map(RestoredInvalidWorkbook::from).collect();
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
                // What the platform failed with keeps its identity, e.g. an `ExternalScriptChangeError`
                Err(error) => Err(error_value(&error)),
            }
        }))
    }

    /// Bring a storage root of the platform to the current storage version and every workbook folder that its workbook
    /// tree registers to the current workbook format, without a runtime: the app runs it at startup before it sets up
    /// its storage. A fresh storage gets a manifest with the current storage version, a storage of a newer version of
    /// the app is refused. The platform holds the lock of the storage meanwhile. The storage of a runtime migrates a
    /// workbook folder that it keeps elsewhere (`storage.workbookFolder`) when it reads an older workbook file.
    #[wasm_bindgen(js_name = migrateStorage, unchecked_return_type = "Promise<StorageMigrationOutcome>")]
    pub fn migrate_storage(
        #[wasm_bindgen(unchecked_param_type = "RuntimeStorageRoot")] root: JsValue,
        #[wasm_bindgen(
            unchecked_param_type = "((level: 'debug' | 'info' | 'warn' | 'error', message: string, details: [string, string][], target: string) => void) | null"
        )]
        log: JsValue,
    ) -> Promise {
        let log = log.dyn_into::<Function>().ok();
        future_to_promise(async move {
            match migrations::migrate(root, log).await {
                Ok(outcome) => Ok(to_js(&outcome).map_err(JsValue::from)?.into()),
                Err(error) => Err(storage::error_value(&error)),
            }
        })
    }

    /// The versions of the storage format of the module: the storage version of the manifest and the format version of
    /// workbook files
    #[wasm_bindgen(js_name = storageVersions, unchecked_return_type = "StorageVersions")]
    pub fn storage_versions() -> Result<JsValue, JsError> {
        Ok(to_js(&migrations::StorageVersions::current())?.into())
    }

    /// The workbook tables of the format with their columns, e.g. the schema of a cloud
    #[wasm_bindgen(js_name = workbookTables, unchecked_return_type = "WorkbookTableSchema[]")]
    pub fn workbook_tables() -> Result<JsValue, JsError> {
        views_to_js(&exports::workbook_table_schemas())
    }

    /// Connection params without their secrets, as a link or a file shares them: the identity stays, the login hint only
    /// `withLoginHint`, the raw form rows of a draft go. Params of an unknown connector stay as they are.
    #[wasm_bindgen(js_name = sanitizeConnectionParams, unchecked_return_type = "Record<string, unknown>")]
    pub fn sanitize_connection_params(
        #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] params: JsValue,
        with_login_hint: bool,
    ) -> Result<JsValue, JsError> {
        let sanitized = sanitize_connection_params_for_sharing(&JsonValue::of(&params).0, with_login_hint);
        JsonValue(sanitized).to_js().map_err(|error| JsError::new(&error.to_string()))
    }

    /// Do two connection params describe the same connection, ignoring everything that sharing strips? A shared
    /// workbook carries the params without secrets and login hints, they still describe the connection of the full
    /// params.
    #[wasm_bindgen(js_name = connectionParamsShareEqual)]
    pub fn connection_params_share_equal(
        #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] left: JsValue,
        #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] right: JsValue,
    ) -> bool {
        sharing::connection_params_share_equal(&JsonValue::of(&left).0, &JsonValue::of(&right).0)
    }

    /// The params of a new connection of a connector, e.g. `{"trino": {...}}`
    #[wasm_bindgen(js_name = defaultConnectionParams, unchecked_return_type = "Record<string, unknown>")]
    pub fn default_connection_params(connector: ConnectorType) -> Result<JsValue, JsError> {
        let params = ConnectionParams::default_for(connector.into()).to_object();
        JsonValue(serde_json::Value::Object(params)).to_js().map_err(|error| JsError::new(&error.to_string()))
    }

    /// Connection params without the raw form rows, they belong only to the local draft. Fails on params of an unknown
    /// connector.
    #[wasm_bindgen(js_name = connectionParamsWithoutDraftRows, unchecked_return_type = "Record<string, unknown>")]
    pub fn connection_params_without_draft_rows(
        #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] params: JsValue,
    ) -> Result<JsValue, JsError> {
        let serde_json::Value::Object(fields) = JsonValue::of(&params).0 else {
            return Err(JsError::new("connection params must be an object"));
        };
        let params = ConnectionParams::from_object(fields).map_err(js_error)?.without_draft_rows();
        JsonValue(params.to_value()).to_js().map_err(|error| JsError::new(&error.to_string()))
    }

    /// The login hint of connection params (the account username or login), null if there is none. Fails on params of
    /// an unknown connector.
    #[wasm_bindgen(js_name = connectionParamsLoginHint)]
    pub fn connection_params_login_hint(
        #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] params: JsValue,
    ) -> Result<Option<String>, JsError> {
        let serde_json::Value::Object(fields) = JsonValue::of(&params).0 else {
            return Err(JsError::new("connection params must be an object"));
        };
        let params = ConnectionParams::from_object(fields).map_err(js_error)?;
        Ok(params.connector.connector().login_hint(&params.params))
    }

    /// The database that the catalog of a Salesforce connection names its relations with, also the alias of the Hyper
    /// Cloud database of a Database.com connection
    #[wasm_bindgen(js_name = salesforceCatalogDatabase)]
    pub fn salesforce_catalog_database() -> String {
        dashql_core_runtime::connections::SALESFORCE_CATALOG_DATABASE.to_string()
    }

    /// The scripts that a reported run reports, by their file names in the order of the workbook, every script without
    /// names. A name is a path or a name with or without `.sql`, compared case-insensitively.
    #[wasm_bindgen(js_name = runScripts, unchecked_return_type = "RunScriptSelection")]
    pub fn run_scripts(files: Vec<String>, names: Vec<String>) -> Result<JsValue, JsError> {
        let selection: runs::view::RunScriptSelection =
            dashql_core_runtime::workbook_run::report::select_run_scripts(&files, &names).into();
        Ok(to_js(&selection)?.into())
    }

    /// What a connection is in the events of a reported run, e.g. `trino http://localhost:8080`. Fails on params of an
    /// unknown connector.
    #[wasm_bindgen(js_name = runConnectionLabel)]
    pub fn run_connection_label(
        #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] params: JsValue,
    ) -> Result<String, JsError> {
        let serde_json::Value::Object(fields) = JsonValue::of(&params).0 else {
            return Err(JsError::new("connection params must be an object"));
        };
        let params = ConnectionParams::from_object(fields).map_err(js_error)?;
        Ok(dashql_core_runtime::workbook_run::report::run_connection_label(&params))
    }

    /// The end of the report of a run: the error of the run, the scripts that didn't run, the counts and how it ended
    #[wasm_bindgen(js_name = finishRunReport, unchecked_return_type = "RunReportEnd")]
    pub fn finish_run_report(input: Ts<runs::view::RunReportInput>) -> Result<JsValue, JsError> {
        Ok(to_js(&runs::view::RunReportEnd::of(from_js(&input)?))?.into())
    }

    /// The params of a new local cloud: a connection of the embedded Hyper whose session attaches only the database of
    /// the local cloud, see docs/design/cloud.md
    #[wasm_bindgen(js_name = localCloudParams, unchecked_return_type = "Record<string, unknown>")]
    pub fn local_cloud_params() -> Result<JsValue, JsError> {
        let params = dashql_core_runtime::hyper::local_cloud::local_cloud_params();
        JsonValue(params.to_value()).to_js().map_err(|error| JsError::new(&error.to_string()))
    }

    /// Build the workbook tree of the directories of `workbooktree/` as the platform lists them (`{ name, folderFile,
    /// directories }`, null without the folder): the subfolders in the natural order of their names. A workbook that the
    /// tree registers twice is listed where it comes first, or every time for the tree as it is `stored`. Fails on a
    /// folder file that isn't one.
    #[wasm_bindgen(js_name = readWorkbookTree, unchecked_return_type = "Record<string, unknown>")]
    pub fn read_workbook_tree(
        #[wasm_bindgen(unchecked_param_type = "Record<string, unknown> | null")] directory: JsValue,
        stored: bool,
    ) -> Result<JsValue, JsError> {
        use dashql_core_storage::workbook_format::tree::{
            read_stored_workbook_tree, read_workbook_tree, TreeDirectory,
        };
        let directory = (!directory.is_null() && !directory.is_undefined())
            .then(|| TreeDirectory::from_json(&JsonValue::of(&directory).0));
        let tree =
            if stored { read_stored_workbook_tree(directory.as_ref()) } else { read_workbook_tree(directory.as_ref()) };
        JsonValue(tree.map_err(js_error)?.to_json()).to_js().map_err(|error| JsError::new(&error.to_string()))
    }

    /// Change the workbooks of the workbook tree as it is stored: insert or replace the entry of a workbook (`upsert`),
    /// remove it (`remove`) or move it to a position in a folder (`move`). Returns the tree after the change and the
    /// folder files to write in their order, the folders that gain workbooks first.
    #[wasm_bindgen(js_name = changeWorkbookTree, unchecked_return_type = "{ tree: Record<string, unknown>; writes: { path: string[]; text: string }[] }")]
    pub fn change_workbook_tree(
        #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] stored: JsValue,
        #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] change: JsValue,
    ) -> Result<JsValue, JsError> {
        use dashql_core_storage::workbook_format::tree::{
            change_workbook_tree, WorkbookEntry, WorkbookTreeChange, WorkbookTreeFolder,
        };
        let stored = WorkbookTreeFolder::from_json(&JsonValue::of(&stored).0);
        let change = JsonValue::of(&change).0;
        let path = |key: &str| -> Vec<String> {
            change
                .get(key)
                .and_then(serde_json::Value::as_array)
                .map(|names| names.iter().filter_map(serde_json::Value::as_str).map(str::to_string).collect())
                .unwrap_or_default()
        };
        let text = |key: &str| change.get(key).and_then(serde_json::Value::as_str).unwrap_or_default().to_string();
        let change = match change.get("kind").and_then(serde_json::Value::as_str) {
            Some("upsert") => WorkbookTreeChange::Upsert {
                entry: change
                    .get("entry")
                    .and_then(WorkbookEntry::from_json)
                    .ok_or_else(|| JsError::new("the change names no workbook"))?,
                folder_path: path("folderPath"),
            },
            Some("remove") => WorkbookTreeChange::Remove { workbook_id: text("workbookId") },
            Some("move") => WorkbookTreeChange::Move {
                workbook_id: text("workbookId"),
                folder_path: path("folderPath"),
                // A float casts saturating, an index past the end appends
                index: change
                    .get("index")
                    .and_then(serde_json::Value::as_f64)
                    .map_or(usize::MAX, |index| index as usize),
            },
            _ => return Err(JsError::new("unknown change of the workbook tree")),
        };
        let (tree, writes) = change_workbook_tree(&stored, change).map_err(js_error)?;
        let writes: Vec<serde_json::Value> =
            writes.into_iter().map(|write| serde_json::json!({ "path": write.path, "text": write.text })).collect();
        JsonValue(serde_json::json!({ "tree": tree.to_json(), "writes": writes }))
            .to_js()
            .map_err(|error| JsError::new(&error.to_string()))
    }

    /// Why a name can't name a new folder of the workbook tree next to its siblings, null if it can. The names compare
    /// without case.
    #[wasm_bindgen(js_name = folderNameError)]
    pub fn folder_name_error(name: &str, siblings: Vec<String>) -> Option<String> {
        dashql_core_storage::workbook_format::tree::folder_name_error(name, &siblings)
    }

    /// A free name for a new folder of the workbook tree next to its siblings: "New folder", "New folder 2", ...
    #[wasm_bindgen(js_name = freeFolderName)]
    pub fn free_folder_name(siblings: Vec<String>) -> String {
        dashql_core_storage::workbook_format::tree::free_folder_name(&siblings)
    }

    /// Check the name of an attachment: a plain file name of a Parquet file. Throws for any other name.
    #[wasm_bindgen(js_name = validateDataFileName)]
    pub fn validate_data_file_name(name: &str) -> Result<(), JsError> {
        dashql_core_storage::workbook_format::layout::validate_data_file_name(name).map_err(js_error)
    }

    /// Is a file name the name of an attachment, a Parquet file? Listings leave other files out.
    #[wasm_bindgen(js_name = isAttachmentFileName)]
    pub fn is_attachment_file_name(name: &str) -> bool {
        dashql_core_storage::workbook_format::layout::is_attachment_file_name(name)
    }

    /// A fresh name of a workbook table that holds the data of an attachment or a result, from the prefix of its kind
    /// and a UUID
    #[wasm_bindgen(js_name = newDataTableName)]
    pub fn new_data_table_name(prefix: &str, uuid: &str) -> String {
        dashql_core_storage::workbook_format::tables::new_data_table_name(prefix, uuid)
    }

    /// Is a name the name of a workbook table that holds the data of an attachment or a result?
    #[wasm_bindgen(js_name = isDataTableName)]
    pub fn is_data_table_name(name: &str) -> bool {
        dashql_core_storage::workbook_format::tables::is_data_table_name(name)
    }

    /// The Hyper Cloud database of a Database.com connection that names none
    #[wasm_bindgen(js_name = hyperCloudDefaultDatabaseName)]
    pub fn hyper_cloud_default_database_name() -> String {
        dashql_core_runtime::connections::HYPER_CLOUD_DEFAULT_DATABASE_NAME.to_string()
    }

    /// Check the folders of workbooks that the platform keeps in folders of their own for changes outside the app, e.g.
    /// when the window gets the focus. The checks run one at a time after the ones that are queued. A change of the
    /// scripts asks the question of the `storage` view (`externalChanges`), see `answerExternalChange`.
    #[wasm_bindgen(js_name = checkWorkbookFolders)]
    pub fn check_workbook_folders(&self, workbook_ids: Vec<String>) {
        self.external.check(workbook_ids);
    }

    /// Answer the question about a workbook that changed outside the app: `true` reloads it from disk, `false` keeps the
    /// version of the app and writes it over the disk, `null` gives no answer, e.g. when the question failed. The
    /// answer to an older question is ignored.
    #[wasm_bindgen(js_name = answerExternalChange)]
    pub fn answer_external_change(&self, workbook_id: &str, prompt: u32, reload: Option<bool>) {
        self.external.answer(workbook_id, prompt, reload);
    }

    /// Delete the files of a workbook that was refused a load and drop it from the list
    #[wasm_bindgen(js_name = deleteInvalidWorkbook, unchecked_return_type = "Promise<void>")]
    pub fn delete_invalid_workbook(&self, workbook_id: String) -> Promise {
        let deletion = self.workbooks.persistence.delete_workbook(&workbook_id);
        let workbooks = self.workbooks.clone();
        future_to_promise(async move {
            let deleted = deletion.await;
            if let Err(error) = &deleted {
                let details = [("workbookId", workbook_id.as_str()), ("error", error.message())];
                workbooks.platform.log_on(
                    LogLevel::Error,
                    "Failed to delete invalid workbook",
                    &details,
                    "workbook_scripts",
                );
            }
            workbooks.forget_invalid(&workbook_id);
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Delete a workbook with its files: its run stops, its attachments and results leave the compute database and the
    /// writes of results that run settle, then the storage deletes the files, then the workbook leaves the runtime like
    /// with the action `deleteWorkbook`, with the computations of the results of its queries. A write of a result that
    /// settled after the files went would create the folder of the results again. Rejects with what the storage failed
    /// with, the workbook stays then and mounts its results again when it uses them.
    #[wasm_bindgen(js_name = removeWorkbook, unchecked_return_type = "Promise<void>")]
    pub fn remove_workbook(&self, workbook_id: String) -> Promise {
        let unmounted = self.runs.forget_and_unmount(&workbook_id);
        let writes = self.connections.executor().map(|executor| executor.flush_result_writes());
        let workbooks = self.workbooks.clone();
        future_to_promise(async move {
            unmounted.await;
            if let Some(writes) = writes {
                writes.await;
            }
            let deletion = workbooks.persistence.delete_workbook(&workbook_id);
            deletion.await.map_err(|error| error_value(&error))?;
            workbooks.delete(&workbook_id);
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
    pub fn run_script(
        &self,
        workbook_id: &str,
        script_key: u32,
        options: Option<Ts<RunScriptOptions>>,
    ) -> Result<Promise, JsError> {
        let options = options.map(|options| from_js(&options)).transpose()?.unwrap_or_default();
        let run = self.runs.run_script(workbook_id, script_key, options);
        Ok(future_to_promise(async move { run_result(run.await) }))
    }

    /// Stop the run of a workbook, the running statements are cancelled
    #[wasm_bindgen(js_name = stopRun)]
    pub fn stop_run(&self, workbook_id: &str) {
        self.runs.stop(workbook_id);
    }

    /// Cancel what runs for a script: the run of its workbook while one plans, runs or stops, the latest query of the
    /// script otherwise. Resolves once a cancelled query ended, at once for a run (its view follows) and for a script
    /// that runs nothing.
    #[wasm_bindgen(js_name = cancelScript, unchecked_return_type = "Promise<void>")]
    pub fn cancel_script(&self, workbook_id: &str, script_key: u32) -> Promise {
        if self.runs.busy(workbook_id) {
            self.runs.stop(workbook_id);
            return Promise::resolve(&JsValue::UNDEFINED);
        }
        let latest = self.workbooks.get(workbook_id).and_then(|workbook| {
            let workbook = workbook.try_borrow().ok()?;
            workbook.script(script_key).and_then(|script| script.latest_query_id())
        });
        let Some(query_id) = latest else { return Promise::resolve(&JsValue::UNDEFINED) };
        let cancelled = self.connections.cancel(QueryId::from(query_id));
        future_to_promise(async move {
            cancelled.await;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// The reusable result keys of the scripts of a workbook in feed order, the keys that a run reuses the stored results
    /// with: of the targets with what they need, of every script without, the keys downstream of a script cover its
    /// stored file. Null for a script without one, e.g. one that can't be planned.
    #[wasm_bindgen(js_name = resultKeys, unchecked_return_type = "Promise<(string | null)[]>")]
    pub fn result_keys(&self, workbook_id: &str, targets: Option<Vec<u32>>) -> Result<Promise, JsError> {
        let keys = self.runs.result_keys(workbook_id, targets, None).map_err(|message| JsError::new(&message))?;
        Ok(future_to_promise(async move {
            let keys = keys.await;
            Ok(keys
                .into_iter()
                .map(|key| {
                    key.filter(|key| key.reusable).map(|key| JsValue::from_str(&key.key)).unwrap_or(JsValue::NULL)
                })
                .collect::<Array>()
                .into())
        }))
    }

    // The imports and exports of workbooks

    /// Export a workbook: a `.dashql` archive (a Blob of the handle table that the caller releases), a link, or the
    /// workbook tables, which go to `consume` and stay readable until it settled. The pending writes of the workbook
    /// are written first, the stored results are retained while the export reads them. Rejects with what the platform
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
    pub fn export_connection(
        &self,
        connection_id: String,
        options: Ts<exports::ConnectionLinkOptions>,
    ) -> Result<Promise, JsError> {
        let options = from_js(&options)?;
        let export = self.exports().export_connection(connection_id, options);
        Ok(future_to_promise(async move {
            export.await.map(|link| JsValue::from_str(&link)).map_err(|error| error_value(&error))
        }))
    }

    /// The stored results of the scripts of a workbook that an export would carry, counted without reading them
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

    /// Import a workbook that was read, with the answers to its questions: the connections are mapped, the workbook
    /// is written, the stored results go into its results folder and it is restored. The listener hears the steps.
    #[wasm_bindgen(js_name = commitImport, unchecked_return_type = "Promise<ImportOutcome>")]
    pub fn commit_import(
        &self,
        import_id: u32,
        answers: Ts<imports::ImportAnswers>,
        #[wasm_bindgen(unchecked_param_type = "((step: ImportStep, results: ImportedResults | null) => void) | null")]
        listener: JsValue,
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

    /// Run a command of the storage writer that waits for writes: flush it, flush a workbook, hand over to another tab.
    /// `flushWorkbook` resolves whether every write of the workbook reached the storage.
    #[wasm_bindgen(js_name = storage, unchecked_return_type = "Promise<unknown>")]
    pub fn storage_command(&self, command: Ts<StorageCommand>) -> Result<Promise, JsError> {
        let command = from_js(&command)?;
        let writer = self.workbooks.persistence.clone();
        Ok(match command {
            StorageCommand::Flush { closing } => {
                let flush = writer.flush();
                let recover = closing.then(|| writer.recover_held_scripts());
                future_to_promise(async move {
                    flush.await;
                    if let Some(recover) = recover {
                        recover.await;
                    }
                    Ok(JsValue::UNDEFINED)
                })
            }
            StorageCommand::FlushWorkbook { workbook_id } => {
                let flush = writer.flush_workbook(&workbook_id);
                future_to_promise(async move { Ok(JsValue::from_bool(flush.await)) })
            }
            StorageCommand::HandOver => {
                let handover = writer.hand_over();
                future_to_promise(async move {
                    handover.await;
                    Ok(JsValue::UNDEFINED)
                })
            }
        })
    }

    /// Hold the writes of the writer (no workbook) or of a workbook for a reason, e.g. `pause` while the app moves a
    /// workbook or `handover` when another tab takes over. Holds are counted, each is released on its own. A flush
    /// writes past a pause of the writer, never past another hold.
    #[wasm_bindgen(js_name = storageHold)]
    pub fn storage_hold(&self, reason: Ts<StorageHoldReason>, workbook_id: Option<String>) -> Result<(), JsError> {
        let reason: StorageHoldReason = from_js(&reason)?;
        self.workbooks.persistence.hold(workbook_id.as_deref(), reason.into());
        Ok(())
    }

    /// Release one hold of a reason. Once nothing holds them, the pending writes wait for their debounce again.
    #[wasm_bindgen(js_name = storageRelease)]
    pub fn storage_release(&self, reason: Ts<StorageHoldReason>, workbook_id: Option<String>) -> Result<(), JsError> {
        let reason: StorageHoldReason = from_js(&reason)?;
        self.workbooks.persistence.release(workbook_id.as_deref(), reason.into());
        Ok(())
    }

    /// Discard the writes of keys and their failures, e.g. a write that failed because its workbook folder is gone. The
    /// writes that waited for them run.
    #[wasm_bindgen(js_name = storageDiscardWrites)]
    pub fn storage_discard_writes(&self, keys: Vec<String>) {
        self.workbooks.persistence.cancel_pending_writes(&keys);
    }

    /// The statistics of the writes by key, of a workbook or of all keys, ordered by key. They change with every write
    /// and are no slice: a view of them reads them when it shows them.
    #[wasm_bindgen(js_name = storageStatistics, unchecked_return_type = "StorageKeyStatistics[]")]
    pub fn storage_statistics(&self, workbook_id: Option<String>) -> Result<JsValue, JsError> {
        use dashql_core_storage::storage::keys::{belongs_to_workbook, key_within_workbook};
        let statistics: Vec<StorageKeyStatistics> = self
            .workbooks
            .persistence
            .writer()
            .map(|writer| writer.statistics())
            .unwrap_or_default()
            .into_iter()
            .filter(|(key, _)| workbook_id.as_deref().is_none_or(|id| belongs_to_workbook(key, id)))
            .map(|(key, statistics)| StorageKeyStatistics {
                label: workbook_id.as_deref().map_or(key.as_str(), |id| key_within_workbook(&key, id)).to_string(),
                statistics: StorageWriteStatistics::from(&statistics),
                key,
            })
            .collect();
        views_to_js(&statistics)
    }

    /// Are the writes of a workbook held, by a hold of the writer or of the workbook, e.g. after one of its files
    /// changed outside the app?
    #[wasm_bindgen(js_name = isWorkbookHeld)]
    pub fn is_workbook_held(&self, workbook_id: &str) -> bool {
        self.workbooks.persistence.is_workbook_held(workbook_id)
    }

    /// Shut the runtime down, in this order: the runs stop, the catalog loader stops, the writes of the stored results
    /// and the pending writes of the storage finish, then the imports are dropped, the setups and the queries are
    /// cancelled and the computations go, their runs cancelled and their tables released with the next changes.
    /// Resolves once that is done; from then on the runtime calls the platform no more, a task that is still running
    /// fails at its next call. The host takes the last changes and frees the runtime with `free()`.
    #[wasm_bindgen(unchecked_return_type = "Promise<void>")]
    pub fn shutdown(&self) -> Promise {
        self.runs.stop_all();
        if let Some(loader) = self.connections.loader() {
            loader.stop();
        }
        let cache = self.connections.executor().map(|executor| executor.flush_result_writes());
        let storage = self.workbooks.persistence.flush();
        let stop = Shutdown {
            platform: self.platform.clone(),
            computations: self.computations.clone(),
            connections: self.connections.clone(),
            imports: self.imports.clone(),
            external: self.external.clone(),
        };
        future_to_promise(async move {
            if let Some(cache) = cache {
                cache.await;
            }
            storage.await;
            stop.stop();
            Ok(JsValue::UNDEFINED)
        })
    }
}

/// What a shutdown stops once the writes finished
struct Shutdown {
    platform: JsPlatform,
    computations: ComputeService<ComputeTracker>,
    connections: Rc<Connections>,
    imports: Rc<imports::Imports>,
    external: Rc<external::ExternalChanges>,
}

impl Shutdown {
    /// Drop the imports, cancel the setups and the queries, delete the computations, then fence the platform
    fn stop(self) {
        self.imports.drop_all();
        self.external.destroy();
        if let Some(loader) = self.connections.loader.borrow_mut().take() {
            loader.stop();
        }
        let setups: Vec<String> = self.connections.setups.borrow().iter().map(|setup| setup.id.clone()).collect();
        for setup_id in setups {
            self.connections.cancel_setup(&setup_id);
        }
        let running: Vec<QueryId> = self.connections.run_ids();
        for query_id in running {
            drop(self.connections.cancel(query_id));
        }
        self.connections.executor.borrow_mut().take();
        let ids: Vec<TableId> = self.computations.read(|state| state.computations().map(|(id, _)| id).collect());
        let mut changed = false;
        for id in ids {
            if let Ok(outcome) = self.computations.delete_computation(id) {
                self.platform.push_effects(&outcome.effects);
                changed = true;
            }
        }
        if changed {
            self.platform.mark(Slice::Computations);
        }
        self.platform.fence();
    }
}

/// Take what a restore restored: the connections and the workbooks join the runtime
fn adopt_restored(connections: &Rc<Connections>, workbooks: &Rc<Workbooks>, state: RestoredState) -> RestoreOutcome {
    let mut connection_ids = Vec::with_capacity(state.connections.len());
    for connection in state.connections {
        match connections.adopt(connection) {
            Ok(id) => connection_ids.push(id),
            Err(error) => {
                connections.log(LogLevel::Error, "Failed to take a restored connection", &[("error", error.what())])
            }
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

/// Read a query of the histories of the connections of a registry: gone if no history holds it, busy if none does but
/// one is borrowed
fn read_query<T>(
    registry: &ConnectionRegistry,
    query_id: QueryId,
    read: impl FnOnce(&str, &QueryExecutionState) -> T,
) -> Read<T> {
    let mut busy = false;
    for (connection_id, connection) in registry.connections() {
        let Ok(history) = connection.queries.try_borrow() else {
            busy = true;
            continue;
        };
        if let Some(query) = history.query(query_id) {
            return Read::Value(read(connection_id, query));
        }
    }
    if busy {
        Read::Busy
    } else {
        Read::Gone
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

/// The error of a read of a state that a task holds. The seam never panics on a borrow: a view of a busy slice reads as
/// `'busy'` and follows with the next changes, a read for a command fails with this error.
fn busy() -> JsError {
    JsError::new("the state is busy, a task of the runtime holds it")
}

/// The error of a task as a JS error
fn task_error(error: Error) -> JsValue {
    JsError::new(error.what()).into()
}
