//! The connections of the runtime with the histories of their queries, the query executor that runs the queries, the
//! setups, the catalog loader and the saves of the connections (docs/wip/runtime_api.md).
//!
//! `Connections` is shared by the runtime and the hosts of the executor (`queries.rs`), the setups (`setups.rs`) and the
//! catalog loader (`catalog.rs`): the registry of the crate holds the connections and the histories, the executor
//! reports what happens to a query into its history right away, a change of the registry lets the catalog loader
//! follow it at the end of the task. A
//! change of a connection schedules its writes through the storage writer of the runtime; a save writes the app
//! manifest, commits the params and writes the copies of the workbooks that use the connection. The workbooks of the
//! runtime tell the registry which workbooks use a connection.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};

use dashql_core::error::{Error, Result};
use dashql_core_runtime::catalog_loader::CatalogLoaderService;
use dashql_core_runtime::compute::service::ComputeService;
use dashql_core_runtime::compute::types::TableId;
use dashql_core_runtime::compute::ComputationOutcome;
use dashql_core_runtime::connection_persistence::{
    connection_entry, connection_writes, save_connection, saved_entry, saved_params, schedule_connection_writes, write_workbook_copies,
    ConnectionChange, PersistedConnection,
};
use dashql_core_runtime::connections::registry::{ConnectionRegistry, QueryOwner, RegistryOutcome};
use dashql_core_runtime::connections::{
    CatalogUpdateTaskStatus, CatalogUpdateVariant, ConnectionAction, ConnectionDetails, ConnectionParams, ConnectionState, ConnectionStateOptions,
    ConnectorType, JsonObject,
};
use dashql_core_runtime::executor::QueryExecutor;
use dashql_core_runtime::host::{Host, LogLevel};
use dashql_core_runtime::query::{QueryExecutionAction, QueryId};
use dashql_core_runtime::storage::keys::connection_entry_key;
use dashql_core_runtime::storage::{StorageWriter as RuntimeStorageWriter, WriteTask};
use dashql_core_runtime::workbook::{next_revision, CatalogHandle};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use super::catalog::{CatalogLoader, LoaderHost};
use super::compute_tracking::ComputeTracker;
use super::changes::{Read, Slice};
use crate::connection::view::ConnectionView;
use super::queries::{QueryHost, QueryRun};
use dashql_core_runtime::connections::open_setup::OpenSetups;
use super::setups::RunningSetup;
use crate::connection::view::ConnectionSaveView;
use crate::connection_persistence::view::{copies, ConnectionSaveOutcome};
use crate::host::JsPlatform;
use crate::runtime::storage::view::StorageWriteOutcome;
use crate::runtime::storage::JsStorage;
use crate::views::JsonValue;

/// The target of the log messages of the connections
const LOG_TARGET: &str = "connection_registry";

/// The storage writer of the runtime that the connections write through
pub(crate) type StorageWriter = RuntimeStorageWriter<JsStorage>;

/// What a connection was saved with last
pub(crate) struct SaveState {
    pub saving: bool,
    pub outcome: Option<ConnectionSaveOutcome>,
}

/// A new connection
pub(crate) struct NewConnection {
    pub connection_id: Option<String>,
    pub connector: ConnectorType,
    /// The params of the connector that the details of the setup start with
    pub setup_params: Option<JsonObject>,
    pub active: bool,
    pub params: Option<ConnectionParams>,
    pub params_draft: Option<ConnectionParams>,
    pub name: Option<String>,
    pub cache_query_results: Option<bool>,
}

/// The connections, the histories and the executor of a runtime
pub(crate) struct Connections {
    pub platform: JsPlatform,
    pub registry: RefCell<ConnectionRegistry>,
    pub computations: ComputeService<ComputeTracker>,
    /// The writer of the storage of the runtime
    pub writer: RefCell<Option<StorageWriter>>,
    /// The saves of the connections by id. The connections are few, it is a list.
    pub saves: RefCell<Vec<(String, SaveState)>>,
    /// The queries that the runtime runs by id, held by the commands that run them and by their follow-ups
    pub runs: RefCell<HashMap<QueryId, Weak<QueryRun>>>,
    /// The executor, its host holds the connections weakly
    pub executor: RefCell<Option<QueryExecutor<QueryHost>>>,
    /// The setups that run, few
    pub setups: RefCell<Vec<RunningSetup>>,
    /// The number of the last setup
    pub setup_numbers: Cell<u64>,
    /// The connections that the openings of workbooks considered for a setup
    pub open_setups: RefCell<OpenSetups>,
    /// The catalog loader, its host holds the connections weakly
    pub loader: RefCell<Option<CatalogLoader>>,
    /// Is the catalog loader asked to follow the registry at the end of the task?
    pub follow_requested: Cell<bool>,
    /// The number of the announcements of a new catalog by connection
    pub catalog_versions: RefCell<Vec<(String, u64)>>,
    /// The identities of the catalogs of the connections, see `catalog_id`
    pub catalog_ids: RefCell<Vec<(String, u64, Weak<RefCell<dashql_core::catalog::Catalog>>)>>,
    /// Hears the announcements of a new catalog of a connection, the workbooks analyze the scripts on it again
    pub catalog_listener: RefCell<Option<Rc<dyn Fn(&str)>>>,
    /// Hears the changes of the registry at the end of their task, the runs follow the connections
    pub follow_listener: RefCell<Option<Rc<dyn Fn()>>>,
}

impl Connections {
    pub fn new(platform: JsPlatform, computations: ComputeService<ComputeTracker>) -> Rc<Self> {
        let connections = Rc::new(Connections {
            platform: platform.clone(),
            registry: RefCell::new(ConnectionRegistry::new()),
            computations,
            writer: RefCell::new(None),
            saves: RefCell::new(Vec::new()),
            runs: RefCell::new(HashMap::new()),
            executor: RefCell::new(None),
            setups: RefCell::new(Vec::new()),
            setup_numbers: Cell::new(0),
            open_setups: RefCell::new(OpenSetups::new()),
            loader: RefCell::new(None),
            follow_requested: Cell::new(false),
            catalog_versions: RefCell::new(Vec::new()),
            catalog_ids: RefCell::new(Vec::new()),
            catalog_listener: RefCell::new(None),
            follow_listener: RefCell::new(None),
        });
        let host = QueryHost::new(Rc::downgrade(&connections), platform.clone());
        let executor = QueryExecutor::new(Rc::new(host));
        *connections.executor.borrow_mut() = Some(executor);
        // The loader schedules from the start, the host may stop it
        let loader = CatalogLoaderService::new(Rc::new(LoaderHost::new(Rc::downgrade(&connections), platform)));
        loader.start();
        *connections.loader.borrow_mut() = Some(loader);
        connections
    }

    /// The executor, none once the runtime is destroyed
    pub fn executor(&self) -> Option<QueryExecutor<QueryHost>> {
        self.executor.borrow().clone()
    }

    pub fn now(&self) -> f64 {
        self.platform.now()
    }

    /// Hand the effects of the registry to the host and to the services: the effects on handles, the cancelled setups
    /// and catalog updates, the queries that stop and the computations of the results that a later result of their
    /// owner superseded. The change marks the slices of the owner, the connection or the history. A change that is
    /// urgent lets the catalog loader follow the registry, e.g. a query that started or finished.
    pub fn settle(self: &Rc<Self>, owner: &QueryOwner, outcome: &RegistryOutcome, urgent: bool) {
        let connection_id = match owner {
            QueryOwner::Connection(id) => Some(id.as_str()),
            QueryOwner::History(_) => None,
        };
        if outcome.changed || !outcome.effects.is_empty() {
            self.platform.mark(match owner {
                QueryOwner::Connection(id) => Slice::Connection(id),
                QueryOwner::History(name) => Slice::History(name),
            });
        }
        let follow_up = self.platform.push_registry_effects(&outcome.effects);
        for query_id in &outcome.stopped {
            // The cancel happens in the call, the query ends on its own
            self.cancel_now(*query_id);
        }
        // The history decides which result of an owner is the latest, the others keep no computation
        for query_id in &outcome.superseded {
            self.delete_computation_of(*query_id);
        }
        if let (true, Some(connection_id)) = (follow_up.cancel_setup, connection_id) {
            self.cancel_setup(connection_id);
        }
        if let Some(loader) = self.loader() {
            for (task_id, reason) in follow_up.cancel_catalog_updates {
                loader.cancel(task_id, reason);
            }
        }
        if outcome.changed || !outcome.effects.is_empty() {
            self.platform.signal(urgent);
            if urgent || outcome.deleted {
                self.follow_later();
            }
        }
    }

    /// Hand the effects of the computations to the host
    pub fn settle_computations(&self, outcome: Result<ComputationOutcome>) {
        if let Ok(outcome) = outcome {
            self.platform.push_effects(&outcome.effects);
            if outcome.changed || !outcome.effects.is_empty() {
                self.platform.changed(Slice::Computations, true);
            }
        }
    }

    /// Log a message of the connections
    pub fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, LOG_TARGET);
    }

    /// Create a connection with an empty catalog, returns its id. An active connection is written into the app
    /// manifest right away.
    pub fn create(self: &Rc<Self>, connection: NewConnection) -> Result<String> {
        let connection_id = match connection.connection_id {
            Some(id) => id,
            None => self.platform.random_uuid().map_err(|e| Error::invalid_argument(e.message().to_string()))?,
        };
        let mut details = ConnectionDetails::default_for(connection.connector);
        details.setup_params = connection.setup_params;
        let options = ConnectionStateOptions { active: connection.active, params: connection.params, params_draft: connection.params_draft };
        let now = self.now();
        let mut state = ConnectionState::new(&connection_id, details, options, now);
        if let Some(name) = connection.name {
            state.apply(ConnectionAction::Rename(name), now)?;
        }
        if let Some(caching) = connection.cache_query_results {
            state.apply(ConnectionAction::SetQueryResultCaching(caching), now)?;
        }
        let entry = state.active().then(|| connection_entry(&connection_id, &state));
        self.registry.borrow_mut().insert(state)?;
        if let Some(mut entry) = entry {
            if let Some(fields) = entry.as_object_mut() {
                fields.insert("createdAt".into(), json!(iso_now(now)));
            }
            self.write(&connection_entry_key(&connection_id), WriteTask::WriteConnectionEntry { entry }, 0.0);
        }
        self.platform.changed(Slice::Connection(&connection_id), true);
        self.follow_later();
        Ok(connection_id)
    }

    /// Adopt a connection that a service created, e.g. the restore
    pub fn adopt(self: &Rc<Self>, state: ConnectionState) -> Result<String> {
        let connection_id = state.connection_id().to_string();
        self.registry.borrow_mut().insert(state)?;
        self.platform.changed(Slice::Connection(&connection_id), true);
        self.follow_later();
        Ok(connection_id)
    }

    /// The identity of the catalog of a connection, a new one for a new catalog under the same id
    pub fn catalog_id(&self, connection_id: &str, catalog: &CatalogHandle) -> u64 {
        let mut ids = self.catalog_ids.borrow_mut();
        let held = ids.iter().find(|(id, _, _)| id == connection_id);
        if let Some((_, id, held)) = held {
            if held.upgrade().is_some_and(|held| Rc::ptr_eq(&held, catalog)) {
                return *id;
            }
        }
        let id = next_revision();
        ids.retain(|(held, _, _)| held != connection_id);
        ids.push((connection_id.to_string(), id, Rc::downgrade(catalog)));
        id
    }

    /// The view of a connection, busy if the connection or its history is borrowed
    pub fn view(&self, registry: &ConnectionRegistry, connection_id: &str) -> Read<ConnectionView> {
        let Some(connection) = registry.get(connection_id) else { return Read::Gone };
        let (Ok(state), Ok(queries)) = (connection.state.try_borrow(), connection.queries.try_borrow()) else { return Read::Busy };
        let (Ok(_), Ok(_)) = (self.saves.try_borrow(), self.setups.try_borrow()) else { return Read::Busy };
        let mut view = ConnectionView::of(&state, &queries, registry.workbooks_of(connection_id), self.save_view(connection_id));
        view.catalog_version = self.catalog_version(connection_id);
        view.setup_running = self.setup_running(connection_id);
        view.catalog_id = self.catalog_id(connection_id, state.catalog());
        Read::Value(view)
    }

    /// Schedule a write if the runtime has a writer
    fn write(&self, key: &str, task: WriteTask, debounce_ms: f64) {
        let writer = self.writer.borrow().clone();
        match writer {
            Some(writer) => drop(writer.write(key, task, debounce_ms)),
            None => self.log(LogLevel::Warn, "The runtime has no storage writer, a change of a connection is not saved", &[("key", key)]),
        }
    }

    /// Apply an action to a connection and schedule what storage keeps of the change. A finished catalog update tells
    /// whether it changed the catalog.
    pub fn apply(self: &Rc<Self>, connection_id: &str, action: ConnectionAction, catalog_changed: Option<bool>) -> Result<RegistryOutcome> {
        let connection = self.registry.borrow().get(connection_id).cloned();
        let prev = connection.as_ref().map(|connection| PersistedConnection::of_state(&connection.state.borrow()));
        let finished_task = match &action {
            ConnectionAction::CatalogUpdateSucceeded { task_id } => Some((*task_id, CatalogUpdateTaskStatus::Succeeded)),
            ConnectionAction::CatalogUpdatePartiallySucceeded { task_id, .. } => Some((*task_id, CatalogUpdateTaskStatus::PartiallySucceeded)),
            ConnectionAction::CatalogUpdateFailed { task_id, .. } => Some((*task_id, CatalogUpdateTaskStatus::Failed)),
            ConnectionAction::CatalogUpdateCancelled { task_id, .. } => Some((*task_id, CatalogUpdateTaskStatus::Cancelled)),
            _ => None,
        };
        let change = match &action {
            ConnectionAction::Delete => ConnectionChange::Deleted,
            ConnectionAction::CommitParams(_) => ConnectionChange::ParamsCommitted,
            ConnectionAction::RelationsTouched(_) => ConnectionChange::RelationsTouched,
            _ => ConnectionChange::Other,
        };
        let now = self.now();
        // The workbooks that use the connection show its params and derive with its catalog
        let workbooks = self.registry.borrow().workbooks_of(connection_id).to_vec();
        let outcome = self.registry.borrow_mut().apply(connection_id, action, now)?;
        if outcome.changed {
            for workbook_id in &workbooks {
                self.platform.mark(Slice::Workbook(workbook_id));
            }
        }
        self.settle(&QueryOwner::Connection(connection_id.to_string()), &outcome, true);
        if outcome.deleted {
            self.saves.borrow_mut().retain(|(id, _)| id != connection_id);
            self.catalog_versions.borrow_mut().retain(|(id, _)| id != connection_id);
            self.catalog_ids.borrow_mut().retain(|(id, _, _)| id != connection_id);
        }
        let (Some(connection), Some(prev)) = (connection, prev) else { return Ok(outcome) };
        // The decisions of the persistence on the connection after the change
        let writes = {
            let state = connection.state.borrow();
            let change = match finished_task {
                Some((task_id, status)) => {
                    let task = state.catalog_updates().tasks_finished.get(&task_id);
                    let refreshed = task.is_none_or(|task| task.variant != CatalogUpdateVariant::RelationRefresh);
                    ConnectionChange::CatalogUpdateFinished { status, refreshed, changed: catalog_changed }
                }
                None => change,
            };
            let workbooks = self.registry.borrow().workbooks_of(connection_id).to_vec();
            connection_writes(connection_id, &prev, &state, &change, &workbooks)
        };
        if writes.writes.is_empty() && !writes.cancel_file_writes {
            return Ok(outcome);
        }
        let writer = self.writer.borrow().clone();
        match writer {
            Some(writer) => schedule_connection_writes(&writer, writes, connection_id),
            // A runtime without storage keeps nothing, e.g. the one of the shell
            None => self.log(LogLevel::Debug, "The runtime has no storage writer, a change of a connection is not saved", &[("connection", connection_id)]),
        }
        Ok(outcome)
    }

    /// Apply an action to a query of a history
    pub fn apply_query(self: &Rc<Self>, owner: &QueryOwner, action: QueryExecutionAction, urgent: bool) -> Result<RegistryOutcome> {
        let outcome = self.registry.borrow_mut().apply_query(owner, action)?;
        self.settle(owner, &outcome, urgent);
        Ok(outcome)
    }

    /// Delete the computation of a result
    pub fn delete_computation(&self, table_id: TableId) {
        let deleted = self.computations.delete_computation(table_id);
        self.settle_computations(deleted);
    }

    /// Mark a save of a connection and tell the host
    fn set_save(&self, connection_id: &str, saving: bool, outcome: Option<ConnectionSaveOutcome>) {
        let save = SaveState { saving, outcome };
        let mut saves = self.saves.borrow_mut();
        match saves.iter_mut().find(|(id, _)| id == connection_id) {
            Some((_, held)) => *held = save,
            None => saves.push((connection_id.to_string(), save)),
        }
        drop(saves);
        self.platform.changed(Slice::Connection(connection_id), true);
    }

    /// The view of the save of a connection
    pub fn save_view(&self, connection_id: &str) -> ConnectionSaveView {
        let saves = self.saves.borrow();
        let save = saves.iter().find(|(id, _)| id == connection_id).map(|(_, save)| save);
        ConnectionSaveView { saving: save.is_some_and(|save| save.saving), outcome: save.and_then(|save| save.outcome.clone()) }
    }

    /// Save a connection: the given params, else its draft, else its params. The app manifest first, then the params
    /// are committed and the copies of the workbooks that use the connection are written. Resolves with the outcome.
    pub fn save(self: &Rc<Self>, connection_id: String, given: Option<ConnectionParams>) -> impl std::future::Future<Output = Result<ConnectionSaveOutcome>> {
        let prepared = (|| -> Result<(StorageWriter, Value, Value, Vec<String>)> {
            let registry = self.registry.borrow();
            let connection =
                registry.get(&connection_id).ok_or_else(|| Error::invalid_argument(format!("no connection registered with id {connection_id}")))?;
            let state = connection.state.borrow();
            let params = saved_params(&state, given.as_ref());
            let entry = saved_entry(&connection_id, &state, &params);
            let params = Value::Object(params.to_object());
            let workbooks = registry.workbooks_of(&connection_id).to_vec();
            let writer = self.writer.borrow().clone().ok_or_else(|| Error::invalid_argument("the runtime has no storage writer"))?;
            Ok((writer, entry, params, workbooks))
        })();
        let connections = self.clone();
        async move {
            let (writer, entry, params, workbooks) = match prepared {
                Ok(prepared) => prepared,
                Err(error) => {
                    // The draft that would have been saved, with the error of the manifest
                    let draft = connections
                        .registry
                        .borrow()
                        .get(&connection_id)
                        .map(|connection| {
                            let state = connection.state.borrow();
                            Value::Object(state.params_draft().unwrap_or(state.params()).to_object())
                        })
                        .unwrap_or(Value::Null);
                    let error = JsValue::from(JsError::new(error.what()));
                    let outcome = ConnectionSaveOutcome {
                        params: JsonValue(draft),
                        manifest: StorageWriteOutcome::Failed { error, unavailable_workbook: None },
                        workbooks: Vec::new(),
                    };
                    if connections.registry.borrow().get(&connection_id).is_some() {
                        connections.set_save(&connection_id, false, Some(outcome.clone()));
                    }
                    return Ok(outcome);
                }
            };
            connections.set_save(&connection_id, true, None);
            let committed = params.clone();
            let commit = {
                let connections = Rc::downgrade(&connections);
                let connection_id = connection_id.clone();
                move || {
                    let Some(connections) = connections.upgrade() else { return };
                    // A commit that fails leaves the copies as they are, the next restore heals them
                    if let Ok(params) = ConnectionParams::from_object(committed.as_object().cloned().unwrap_or_default()) {
                        let _ = connections.apply(&connection_id, ConnectionAction::CommitParams(params), None);
                    }
                }
            };
            let saved = save_connection(&writer, &connection_id, entry, &params, &workbooks, commit).await;
            let outcome = ConnectionSaveOutcome { params: JsonValue(params), manifest: saved.manifest.into(), workbooks: copies(saved.workbooks) };
            if connections.registry.borrow().get(&connection_id).is_some() {
                connections.set_save(&connection_id, false, Some(outcome.clone()));
            }
            Ok(outcome)
        }
    }

    /// Write the copies of the saved params of the last save of a connection into workbooks again, none without a save
    /// that wrote the app manifest
    pub fn retry_save(self: &Rc<Self>, connection_id: String, workbook_ids: Vec<String>) -> impl std::future::Future<Output = Option<ConnectionSaveOutcome>> {
        let last = self.saves.borrow().iter().find(|(id, _)| *id == connection_id).and_then(|(_, save)| save.outcome.clone());
        let last = last.filter(|last| matches!(last.manifest, StorageWriteOutcome::Written));
        let writer = self.writer.borrow().clone();
        let connections = self.clone();
        async move {
            let (Some(last), Some(writer)) = (last, writer) else { return None };
            connections.set_save(&connection_id, true, Some(last.clone()));
            let retried = copies(write_workbook_copies(&writer, &connection_id, &last.params.0, &workbook_ids).await);
            let mut outcome = last;
            for copy in &mut outcome.workbooks {
                if let Some(retried) = retried.iter().find(|retried| retried.workbook_id == copy.workbook_id) {
                    copy.result = retried.result.clone();
                }
            }
            connections.set_save(&connection_id, false, Some(outcome.clone()));
            Some(outcome)
        }
    }
}

/// A point in time in ISO 8601, e.g. the creation of a connection
fn iso_now(ms: f64) -> String {
    js_sys::Date::new(&JsValue::from_f64(ms)).to_iso_string().as_string().unwrap_or_default()
}

