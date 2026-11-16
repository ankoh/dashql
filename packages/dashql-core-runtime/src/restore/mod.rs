//! The restore of the stored state: the connections of the app manifest with their catalogs, the workbooks of the
//! workbook tree with their scripts and attachments, and the writes that bring the stored state in line with the
//! restored one. The runtime of the module runs it as its commands `restore` and `restoreWorkbook`.
//!
//! The restore is a service on a host (`RestoreHost`): it reads the manifest, the workbook files, the scripts, the
//! attachments and the files of the connections through the host and writes through the storage writer. The decisions
//! are the ones of `workbook_format::restore::RestorePlanner`. The result holds the connections and the workbooks as
//! Rust values, the module hands them to the registries of the app.
//!
//! The restore holds its state in the locals of one task, it borrows no `RefCell` across an await. A host call that
//! fails fails the workbook or the connection that made it, never the restore: an unreadable workbook is invalid, a
//! catalog that can't be read is refreshed on connect.

pub mod catalog;

use std::collections::HashMap;
use std::rc::Rc;

use dashql_buffers::editor::EditorOffsetUnit;
use dashql_buffers::formatting::FormattingDialect;
use dashql_core::catalog::Catalog;
use dashql_core::error::{Error, Result};
use serde_json::Value;

use crate::attachments::DataFile;
use crate::connections::import::decode_connection;
use crate::connections::label::is_hyper_wasm_connection;
use crate::connections::{ConnectionAction, ConnectionParams, ConnectionState, ConnectionStateOptions, ConnectorType};
use crate::host::{HostError, LogLevel};
use crate::storage::keys::{
    connection_entry_key, connection_file_key, workbook_connection_copy_key, workbook_file_key, workbook_script_list_key,
};
use crate::storage::{StorageHost, StorageWriter, TextSource, WriteError, WriteOutcome, WriteResult, WriteTask};
use crate::workbook::{CloudLink, ScriptConnection, Workbook};
use crate::workbook_format::data::{ConnectionEntry, WorkbookCloudLink, WorkbookConnection};
use crate::workbook_format::storage_migration::iso_timestamp;
use crate::workbook_format::restore::{not_restored_error, RestoreConnection, RestorePlanner, RestoredWorkbookPlan};
use crate::workbook_format::validation::{describe_invalid_workbook, is_valid_uuid, InvalidWorkbook, WorkbookValidationError};
use catalog::{apply_catalog_files, load_catalog_files, CatalogRestore};

/// What the restore asks of the platform on top of the storage operations of the writer: the workbook tree, the
/// scripts and attachments of a workbook, the connections of the app manifest and the files of a connection. Stored
/// files are untrusted, the restore reads them leniently.
#[allow(async_fn_in_trait)] // The futures hold values of the host and run on its thread, they are not Send
pub trait RestoreHost: StorageHost {
    /// Does the storage own the connections? A storage of a single workbook folder doesn't, it has no app manifest and
    /// no files of connections.
    fn owns_connections(&self) -> bool;
    /// The workbooks of the workbook tree in the order of the sidebar, as their ids
    async fn list_workbooks(&self) -> std::result::Result<Vec<String>, HostError>;
    /// The connection entries of the app manifest, none if the manifest has none
    async fn load_manifest_connections(&self) -> std::result::Result<Option<Vec<Value>>, HostError>;
    /// The script files of a workbook as (file name, text)
    async fn load_scripts(&self, workbook_id: &str) -> std::result::Result<Vec<(String, String)>, HostError>;
    /// The data files of a workbook
    async fn list_data_files(&self, workbook_id: &str) -> std::result::Result<Vec<DataFile>, HostError>;
    /// A file of a connection, none if it doesn't exist
    async fn load_connection_file(&self, connection_id: &str, file_name: &str) -> std::result::Result<Option<String>, HostError>;
    /// The progress of the restore changed
    fn restore_progress(&self, progress: &RestoreProgress);
}

/// A counter of the progress of a step
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProgressCounter {
    pub started: u32,
    pub succeeded: u32,
    pub skipped: u32,
    pub failed: u32,
    /// None until the total is known
    pub total: Option<u32>,
}

/// The progress of a restore: the connections, the catalogs and the scripts of the workbooks
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RestoreProgress {
    pub connections: ProgressCounter,
    pub catalogs: ProgressCounter,
    pub workbook_scripts: ProgressCounter,
}

impl RestoreProgress {
    fn add_total(&mut self, total: u32) {
        for counter in [&mut self.connections, &mut self.catalogs, &mut self.workbook_scripts] {
            counter.total = Some(counter.total.unwrap_or(0).saturating_add(total));
        }
    }

    fn skip_workbook(&mut self) {
        self.connections.skipped += 1;
        self.catalogs.skipped += 1;
        self.workbook_scripts.skipped += 1;
    }

    fn fail_workbook(&mut self) {
        self.connections.failed += 1;
        self.catalogs.failed += 1;
        self.workbook_scripts.failed += 1;
    }
}

/// What a restore creates its objects with
pub struct RestoreOptions {
    /// The unit that the editors of the workbooks count offsets in
    pub offset_unit: EditorOffsetUnit,
    /// A new empty catalog of a connection, e.g. one that shares the entry ids of the other catalogs of the module
    pub new_catalog: Box<dyn Fn() -> Catalog>,
    /// Fresh UUIDs, for a new connection to the embedded database
    pub new_uuid: Box<dyn FnMut() -> Option<String>>,
}

/// A restored workbook
pub struct RestoredWorkbook {
    /// The workbook with its scripts
    pub workbook: Workbook,
    /// The metadata of the workbook file, without the ephemeral marker of a promoted workbook
    pub metadata: Value,
    /// The connections of the scripts and the pending connection
    pub connection_ids: Vec<String>,
}

/// What a restore restored
pub struct RestoredState {
    /// The connections in the order they were registered. A restore of a single workbook holds only the connections
    /// that the workbook registered.
    pub connections: Vec<ConnectionState>,
    /// The workbooks in the order of the workbook tree
    pub workbooks: Vec<RestoredWorkbook>,
    /// The workbooks that failed their validation or couldn't be restored, the workbench shows them and the user can
    /// delete them
    pub invalid_workbooks: Vec<InvalidWorkbook>,
    /// The final progress
    pub progress: RestoreProgress,
}

/// A connection that the app holds already, e.g. when an imported workbook is restored at runtime
pub struct LiveConnection {
    /// The connection as the restore resolves against it
    pub connection: RestoreConnection,
    /// The connection of the scripts that run on it, with its catalog
    pub script_connection: Rc<ScriptConnection>,
}

/// The connection of the scripts of a connection state
pub fn script_connection_of(state: &ConnectionState) -> Rc<ScriptConnection> {
    let defaults = state.details().catalog_name_defaults();
    Rc::new(ScriptConnection {
        connection_id: state.connection_id().to_string(),
        catalog: state.catalog().clone(),
        dialect: if state.connector_type() == ConnectorType::Trino { FormattingDialect::TRINO } else { FormattingDialect::HYPER },
        local: is_hyper_wasm_connection(state),
        params: Some(state.params().to_json()),
        default_database: defaults.database_name,
        default_schema: defaults.schema_name,
    })
}

/// The params of a connection state as a JSON value
fn params_value(state: &ConnectionState) -> Value {
    serde_json::from_str(&state.params().to_json()).unwrap_or(Value::Null)
}

/// Create the state of a stored connection. A restored connection is active. A draft that can't be read is dropped,
/// the saved params stay. The runtime creates the connections of a workbook folder that changed outside the app with it.
pub fn connection_state<H: RestoreHost>(host: &H, connection: &RestoreConnection, catalog: Catalog) -> Result<ConnectionState> {
    let now = host.now();
    let (_, details) = decode_connection(&connection.params, &connection.connection_id)?;
    let params_draft = match &connection.params_draft {
        Some(draft) => match ConnectionParams::from_json(&draft.to_string()) {
            Ok(draft) => Some(draft),
            Err(error) => {
                let id = connection.connection_id.as_str();
                host.log(LogLevel::Warn, "Dropping the unreadable draft of a connection", &[("connectionId", id), ("error", &error.message)]);
                None
            }
        },
        None => None,
    };
    let options = ConnectionStateOptions { active: true, params: None, params_draft };
    let mut state = ConnectionState::with_catalog(&connection.connection_id, details, options, now, catalog);
    if let Some(name) = &connection.name {
        state.apply(ConnectionAction::Rename(name.clone()), now)?;
    }
    if let Some(caching) = connection.cache_query_results {
        state.apply(ConnectionAction::SetQueryResultCaching(caching), now)?;
    }
    Ok(state)
}

/// A pending write of the restore and what it writes, for the log
struct PendingWrite {
    result: WriteResult,
    what: String,
}

/// Await writes, returns whether all of them were written or deferred
async fn await_writes<H: RestoreHost>(host: &H, writes: Vec<PendingWrite>, message: &str) -> bool {
    let mut all = true;
    for write in writes {
        match write.result.await {
            WriteOutcome::Written | WriteOutcome::Deferred | WriteOutcome::Superseded => {}
            WriteOutcome::Cancelled => all = false,
            WriteOutcome::Failed(error) => {
                all = false;
                let error = match &error {
                    WriteError::Host(error) => error.message().to_string(),
                    WriteError::WorkbookUnavailable { cause, .. } => cause.message().to_string(),
                };
                host.log(LogLevel::Warn, message, &[("write", &write.what), ("error", &error)]);
            }
        }
    }
    all
}

/// How the restore of a workbook ended
enum WorkbookOutcome {
    Restored(RestoredWorkbook),
    /// The workbook failed its validation, nothing was attempted
    Skipped(InvalidWorkbook),
    /// Its connections failed, so did the rest
    Failed(InvalidWorkbook),
    /// Its scripts failed, the progress counted it already
    ScriptsFailed(InvalidWorkbook),
}

/// A promoted workbook with the name and the cloud link that its file holds
struct Promotion {
    workbook_id: String,
    name: Option<String>,
    cloud: Option<WorkbookCloudLink>,
}

/// The state of one restore
struct Run<'a, H: RestoreHost, W: StorageHost> {
    host: &'a H,
    writer: &'a StorageWriter<W>,
    offset_unit: EditorOffsetUnit,
    new_catalog: Box<dyn Fn() -> Catalog>,
    planner: RestorePlanner,
    /// The connections that the restore created, in order
    states: Vec<ConnectionState>,
    /// The connections of the scripts by connection id, of the created and the live connections
    script_connections: HashMap<String, Rc<ScriptConnection>>,
    /// The files of connections to write: (connection id, file name, text)
    connection_files: Vec<(String, String, String)>,
    /// The workbooks whose promotion is written
    promotions: Vec<Promotion>,
    progress: RestoreProgress,
}

impl<'a, H: RestoreHost, W: StorageHost> Run<'a, H, W> {
    fn new(host: &'a H, writer: &'a StorageWriter<W>, options: RestoreOptions, live: Vec<LiveConnection>) -> Self {
        let RestoreOptions { offset_unit, new_catalog, new_uuid } = options;
        let mut run = Self {
            host,
            writer,
            offset_unit,
            new_catalog,
            planner: RestorePlanner::new(iso_timestamp(host.now()), new_uuid),
            states: Vec::new(),
            script_connections: HashMap::new(),
            connection_files: Vec::new(),
            promotions: Vec::new(),
            progress: RestoreProgress::default(),
        };
        for live in live {
            run.script_connections.insert(live.connection.connection_id.clone(), live.script_connection);
            run.planner.add_live_connection(live.connection);
        }
        run
    }

    fn report(&self) {
        self.host.restore_progress(&self.progress);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.host.log(level, message, details);
    }

    fn state(&self, connection_id: &str) -> Option<&ConnectionState> {
        self.states.iter().find(|state| state.connection_id() == connection_id)
    }

    /// Create the states of the connections that the planner registered since the last call
    fn create_registered_connections(&mut self) -> Result<()> {
        let missing: Vec<RestoreConnection> = self
            .planner
            .connections()
            .iter()
            .filter(|connection| !self.script_connections.contains_key(&connection.connection_id))
            .cloned()
            .collect();
        for connection in missing {
            let state = connection_state(self.host, &connection, (self.new_catalog)())?;
            self.script_connections.insert(connection.connection_id.clone(), script_connection_of(&state));
            self.states.push(state);
        }
        Ok(())
    }

    /// Restore a connection of the app manifest with its catalog
    async fn restore_manifest_connection(&mut self, entry: &Value) {
        let Some(entry) = ConnectionEntry::from_json(entry) else {
            self.log(LogLevel::Warn, "Failed to restore connection", &[("error", "the connection entry can't be read")]);
            return;
        };
        let connection = RestoreConnection::of_entry(&entry);
        // Workbooks that reference a connection that fails register it again from their copies
        let created = connection_state(self.host, &connection, (self.new_catalog)())
            .and_then(|state| self.planner.restore_manifest_connection(&entry).map(|_| state));
        match created {
            Ok(state) => {
                self.script_connections.insert(entry.id.clone(), script_connection_of(&state));
                self.states.push(state);
                self.restore_catalog(&entry.id, &[("connectionId", &entry.id)]).await;
            }
            Err(error) => {
                self.log(LogLevel::Warn, "Failed to restore connection", &[("connectionId", &entry.id), ("error", &error.message)]);
            }
        }
    }

    /// Restore the catalog of a connection from its files, returns false if it failed
    async fn restore_catalog(&mut self, connection_id: &str, log_context: &[(&str, &str)]) -> bool {
        let files = load_catalog_files(self.host, connection_id).await;
        let Some(state) = self.states.iter_mut().find(|state| state.connection_id() == connection_id) else {
            return false;
        };
        let restored = match files {
            Ok(files) => apply_catalog_files(state, &files),
            Err(error) => CatalogRestore { succeeded: false, files: Vec::new(), error: Some(error.message().to_string()) },
        };
        for (file_name, text) in restored.files {
            self.connection_files.push((connection_id.to_string(), file_name, text));
        }
        if let Some(error) = &restored.error {
            let mut details = log_context.to_vec();
            details.push(("error", error));
            self.log(LogLevel::Warn, "Failed to restore connection catalog, will refresh on connect", &details);
        }
        restored.succeeded
    }

    /// Restore a workbook of the workbook tree
    async fn restore_workbook(&mut self, workbook_id: &str) -> WorkbookOutcome {
        // The id is the key the storage routes on, a workbook with an invalid one can't be loaded
        if !is_valid_uuid(workbook_id) {
            let invalid = describe_invalid_workbook(workbook_id, WorkbookValidationError::InvalidWorkbookId, None);
            self.log(LogLevel::Warn, "Refusing to load workbook with an invalid id", &[("workbookId", workbook_id), ("reason", invalid.error.code())]);
            return WorkbookOutcome::Skipped(invalid);
        }

        // Resolve the connections
        self.log(LogLevel::Info, "Restoring connection", &[("workbookId", workbook_id)]);
        self.progress.connections.started += 1;
        self.report();
        let stored = match self.host.load_workbook(workbook_id).await {
            Ok(stored) => Some(stored),
            Err(error) => {
                // The tree registers the workbook, but its files may be gone, e.g. a native folder that was moved
                self.log(LogLevel::Warn, "Refusing to load workbook with unreadable files", &[("workbookId", workbook_id), ("error", error.message())]);
                None
            }
        };
        let restore = match self.planner.begin_workbook_json(workbook_id, stored.as_ref()) {
            Ok(restore) => restore,
            Err(invalid) if invalid.error == WorkbookValidationError::WorkbookNotRestored => {
                self.log(LogLevel::Warn, "Failed to restore workbook", &[("workbookId", workbook_id), ("error", "a connection can't be restored")]);
                return WorkbookOutcome::Failed(invalid);
            }
            Err(invalid) => {
                if stored.is_some() {
                    self.log(LogLevel::Warn, "Refusing to load invalid workbook", &[("workbookId", workbook_id), ("reason", invalid.error.code())]);
                }
                return WorkbookOutcome::Skipped(invalid);
            }
        };
        if let Err(error) = self.create_registered_connections() {
            self.log(LogLevel::Warn, "Failed to restore workbook", &[("workbookId", workbook_id), ("error", &error.message)]);
            return WorkbookOutcome::Failed(describe_invalid_workbook(workbook_id, WorkbookValidationError::WorkbookNotRestored, None));
        }
        self.progress.connections.succeeded += 1;

        // Restore the catalogs of the connections that the workbook registered, the connections of the app manifest
        // restored theirs already
        self.log(LogLevel::Info, "Restoring catalog", &[("workbookId", workbook_id)]);
        self.progress.catalogs.started += 1;
        self.report();
        let mut catalogs_restored = true;
        if self.host.owns_connections() {
            for connection_id in restore.catalogs_to_restore.clone() {
                let context = [("workbookId", workbook_id), ("connectionId", connection_id.as_str())];
                catalogs_restored = self.restore_catalog(&connection_id, &context).await && catalogs_restored;
            }
        }
        if catalogs_restored {
            self.progress.catalogs.succeeded += 1;
        } else {
            self.progress.catalogs.failed += 1;
        }

        // Restore the scripts
        self.log(LogLevel::Info, "Restoring workbook scripts", &[("workbookId", workbook_id)]);
        self.progress.workbook_scripts.started += 1;
        self.report();
        let metadata = stored.as_ref().and_then(|stored| stored.get("metadata")).cloned().unwrap_or(Value::Null);
        let stored_name = stored.as_ref().and_then(|stored| stored.get("name")).and_then(Value::as_str).map(str::to_string);
        let data = restore.data.clone();
        let scripts = match self.host.load_scripts(workbook_id).await {
            Ok(scripts) => Some(scripts),
            Err(error) => {
                self.log(LogLevel::Warn, "Failed to restore workbook scripts", &[("workbookId", workbook_id), ("error", error.message())]);
                None
            }
        };
        let names: Option<Vec<String>> = scripts.as_ref().map(|scripts| scripts.iter().map(|(name, _)| name.clone()).collect());
        let plan = match self.planner.finish_workbook(restore, names.as_deref()) {
            Ok(plan) => plan,
            Err(invalid) => {
                self.progress.workbook_scripts.failed += 1;
                self.report();
                return WorkbookOutcome::ScriptsFailed(invalid);
            }
        };
        if !plan.missing_scripts.is_empty() {
            let missing = plan.missing_scripts.join(", ");
            self.log(LogLevel::Warn, "The script files of the workbook are missing, keeping its script list", &[("workbookId", workbook_id), ("scripts", &missing)]);
        }
        for script in &plan.scripts {
            if let Some(unresolved) = &script.unresolved_connection_id {
                let details = [("workbookId", workbook_id), ("connectionId", unresolved.as_str())];
                self.log(LogLevel::Warn, "Script references an unknown connection, using the embedded database", &details);
            }
        }
        // The attachments of the workbook, a Parquet attachment is a table parameter of the scripts
        let data_files = match self.host.list_data_files(workbook_id).await {
            Ok(files) => files,
            Err(error) => {
                self.log(LogLevel::Warn, "Listing the attachments failed", &[("workbookId", workbook_id), ("error", error.message())]);
                Vec::new()
            }
        };
        let texts: HashMap<String, String> = scripts.unwrap_or_default().into_iter().collect();
        let promoted = plan.promoted;
        let created = match self.create_registered_connections() {
            Ok(()) => self.create_workbook(plan, metadata, &texts, &data_files),
            Err(error) => Err(error),
        };
        match created {
            Ok(restored) => {
                if promoted {
                    let cloud = restored.metadata.get("cloud").and_then(WorkbookCloudLink::from_json);
                    self.promotions.push(Promotion { workbook_id: workbook_id.to_string(), name: stored_name, cloud });
                }
                let count = restored.workbook.scripts().len().to_string();
                self.log(LogLevel::Info, "Workbook scripts restored", &[("workbookId", workbook_id), ("scriptCount", &count)]);
                self.progress.workbook_scripts.succeeded += 1;
                self.report();
                WorkbookOutcome::Restored(restored)
            }
            Err(error) => {
                self.log(LogLevel::Warn, "Failed to restore workbook scripts", &[("workbookId", workbook_id), ("error", &error.message)]);
                self.progress.workbook_scripts.failed += 1;
                self.report();
                let invalid = describe_invalid_workbook(workbook_id, WorkbookValidationError::WorkbookNotRestored, Some(&data));
                WorkbookOutcome::ScriptsFailed(invalid)
            }
        }
    }

    /// The connection of the scripts of a connection
    fn script_connection(&self, connection_id: &str) -> Result<Rc<ScriptConnection>> {
        self.script_connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| Error::invalid_argument(format!("the restore names an unknown connection: {connection_id}")))
    }

    /// Create a workbook with its scripts. The scripts stay outdated until their first use.
    fn create_workbook(
        &self,
        plan: RestoredWorkbookPlan,
        mut metadata: Value,
        texts: &HashMap<String, String>,
        data_files: &[DataFile],
    ) -> Result<RestoredWorkbook> {
        let mut workbook = Workbook::new(&plan.workbook_id, plan.name.clone(), None, self.offset_unit);
        let mut connection_ids: Vec<String> = Vec::new();
        if plan.metadata.is_ephemeral() {
            workbook.set_ephemeral(true);
        }
        // The link to a cloud as the file holds it
        if let Some(cloud) = metadata.get("cloud").and_then(Value::as_object) {
            let text = |key: &str| cloud.get(key).and_then(Value::as_str).map(str::to_string);
            if let (Some(workbook_id), Some(version_id)) = (text("workbookId"), text("versionId")) {
                let preview = cloud.get("preview").and_then(Value::as_bool) == Some(true);
                workbook.set_stored_cloud_link(Some(CloudLink { workbook_id, version_id, preview }));
            }
        }
        for script in &plan.scripts {
            let connection = self.script_connection(&script.connection.connection_id)?;
            let text = texts.get(&script.name).map(String::as_str).unwrap_or("");
            workbook.add_stored_script(&script.name, text, connection, script.unresolved_connection_id.clone())?;
            if !connection_ids.contains(&script.connection.connection_id) {
                connection_ids.push(script.connection.connection_id.clone());
            }
        }
        if let Some(pending) = &plan.pending_connection {
            workbook.set_stored_pending_connection(Some(self.script_connection(&pending.connection_id)?));
            if !connection_ids.contains(&pending.connection_id) {
                connection_ids.push(pending.connection_id.clone());
            }
        }
        workbook.set_stored_attachments(data_files);
        if plan.promoted {
            if let Some(fields) = metadata.as_object_mut() {
                fields.shift_remove("ephemeral");
            }
        }
        Ok(RestoredWorkbook { workbook, metadata, connection_ids })
    }

    /// Write what brings the stored state in line with the restored one, through the storage writer. Failures are
    /// logged, the next restore attempts them again.
    async fn flush_writes(&mut self) {
        let pending = self.planner.pending().clone();
        // The app manifest is the source of truth, the copies of the workbooks follow it once it is written
        let mut copies = false;
        if self.host.owns_connections() {
            let mut writes = Vec::new();
            for entry in &pending.connection_entries {
                let mut json = entry.to_json();
                if let (Some(state), Some(fields)) = (self.state(&entry.id), json.as_object_mut()) {
                    fields.insert("params".to_string(), params_value(state));
                }
                let task = WriteTask::WriteConnectionEntry { entry: json };
                writes.push(PendingWrite { result: self.writer.write_durable(&connection_entry_key(&entry.id), task), what: entry.id.clone() });
            }
            for (connection_id, file_name, text) in std::mem::take(&mut self.connection_files) {
                let key = connection_file_key(&connection_id, &file_name);
                let what = format!("{connection_id}/{file_name}");
                let task = WriteTask::WriteConnectionFile { connection_id, file_name, text: TextSource::Text(text) };
                writes.push(PendingWrite { result: self.writer.write_durable(&key, task), what });
            }
            copies = await_writes(self.host, writes, "Failed to persist restored connections").await;
        }
        let mut writes = Vec::new();
        if copies {
            for (workbook_id, connection_id) in &pending.workbook_copies {
                let Some(state) = self.state(connection_id) else { continue };
                let copy = WorkbookConnection::new(connection_id.clone(), params_value(state));
                let task = WriteTask::PatchWorkbookConnection { workbook_id: workbook_id.clone(), copy, replaced: Vec::new() };
                let key = workbook_connection_copy_key(workbook_id, connection_id);
                writes.push(PendingWrite { result: self.writer.write_durable(&key, task), what: format!("{workbook_id}:{connection_id}") });
            }
        }
        for list in &pending.workbook_script_lists {
            let task = WriteTask::WriteWorkbookScripts {
                workbook_id: list.workbook_id.clone(),
                scripts: list.scripts.clone(),
                connections: list.connections.clone(),
            };
            let key = workbook_script_list_key(&list.workbook_id);
            writes.push(PendingWrite { result: self.writer.write_durable(&key, task), what: list.workbook_id.clone() });
        }
        for promotion in std::mem::take(&mut self.promotions) {
            // The properties as the file holds them, without the ephemeral marker
            let key = workbook_file_key(&promotion.workbook_id);
            let task = WriteTask::WriteWorkbookProperties {
                workbook_id: promotion.workbook_id.clone(),
                name: promotion.name,
                ephemeral: false,
                cloud: promotion.cloud,
            };
            writes.push(PendingWrite { result: self.writer.write_durable(&key, task), what: promotion.workbook_id });
        }
        await_writes(self.host, writes, "Failed to update a restored workbook").await;
    }
}

/// The restore of the stored state, see the module
pub struct AppRestore<H: RestoreHost, W: StorageHost> {
    host: H,
    writer: StorageWriter<W>,
    options: RestoreOptions,
    live: Vec<LiveConnection>,
}

impl<H: RestoreHost, W: StorageHost> AppRestore<H, W> {
    /// A restore that reads through a host and writes through a storage writer
    pub fn new(host: H, writer: StorageWriter<W>, options: RestoreOptions) -> Self {
        Self { host, writer, options, live: Vec::new() }
    }

    /// A connection that the app holds already, a restored workbook resolves against it
    pub fn add_live_connection(&mut self, live: LiveConnection) {
        self.live.push(live);
    }

    /// Restore the connections of the app manifest and the workbooks of the workbook tree. The restore never fails: a
    /// manifest that can't be read restores nothing, a workbook that fails is invalid.
    pub async fn restore(self) -> RestoredState {
        let AppRestore { host, writer, options, live } = self;
        let host = &host;
        host.log(LogLevel::Info, "Starting app state restoration", &[]);
        let start = host.now();
        let mut run = Run::new(host, &writer, options, live);
        let mut workbooks = Vec::new();
        let mut invalid_workbooks = Vec::new();

        let listed = match host.list_workbooks().await {
            Ok(entries) if host.owns_connections() => {
                host.load_manifest_connections().await.map(|connections| (entries, connections.unwrap_or_default()))
            }
            Ok(entries) => Ok((entries, Vec::new())),
            Err(error) => Err(error),
        };
        match listed {
            Ok((entries, connections)) => {
                let count = entries.len().to_string();
                let connection_count = connections.len().to_string();
                host.log(LogLevel::Info, "Loaded app manifest", &[("workbookCount", &count), ("connectionCount", &connection_count)]);
                // The connections before the workbooks that reference them
                for entry in &connections {
                    run.restore_manifest_connection(entry).await;
                }
                run.progress.add_total(u32::try_from(entries.len()).unwrap_or(u32::MAX));
                run.report();
                for (index, workbook_id) in entries.iter().enumerate() {
                    let position = format!("{}/{}", index + 1, entries.len());
                    host.log(LogLevel::Info, "Restoring workbook", &[("index", &position), ("workbookId", workbook_id)]);
                    match run.restore_workbook(workbook_id).await {
                        WorkbookOutcome::Restored(workbook) => {
                            host.log(LogLevel::Info, "Workbook restored", &[("index", &position), ("workbookId", workbook_id)]);
                            workbooks.push(workbook);
                        }
                        WorkbookOutcome::Skipped(invalid) => {
                            run.progress.skip_workbook();
                            run.report();
                            invalid_workbooks.push(invalid);
                        }
                        WorkbookOutcome::Failed(invalid) => {
                            run.progress.fail_workbook();
                            run.report();
                            invalid_workbooks.push(invalid);
                        }
                        // The workbook stays visible as invalid, the user can delete it
                        WorkbookOutcome::ScriptsFailed(invalid) => invalid_workbooks.push(invalid),
                    }
                }
            }
            Err(error) => {
                host.log(LogLevel::Warn, "Failed to load manifest, starting with empty state", &[("error", error.message())]);
            }
        }

        run.flush_writes().await;
        run.report();
        let duration = format!("{:.2}", host.now() - start);
        let connection_count = run.states.len().to_string();
        let workbook_count = workbooks.len().to_string();
        let invalid_count = invalid_workbooks.len().to_string();
        let details = [
            ("connections", connection_count.as_str()),
            ("workbookScripts", workbook_count.as_str()),
            ("invalidWorkbooks", invalid_count.as_str()),
            ("totalDurationMs", duration.as_str()),
        ];
        host.log(LogLevel::Info, "Finished loading app state", &details);
        RestoredState { connections: run.states, workbooks, invalid_workbooks, progress: run.progress }
    }

    /// Restore a single workbook that was written at runtime, e.g. an imported one, against the live connections. The
    /// result holds the workbook and the connections it registered. Fails if the workbook can't be restored.
    pub async fn restore_workbook(self, workbook_id: &str) -> Result<RestoredState> {
        let AppRestore { host, writer, options, live } = self;
        let mut run = Run::new(&host, &writer, options, live);
        let workbook = match run.restore_workbook(workbook_id).await {
            WorkbookOutcome::Restored(workbook) => workbook,
            WorkbookOutcome::Skipped(invalid) => {
                return Err(Error::invalid_argument(format!("invalid workbook {workbook_id}: {}", invalid.error.code())));
            }
            WorkbookOutcome::Failed(_) | WorkbookOutcome::ScriptsFailed(_) => return Err(not_restored_error(workbook_id)),
        };
        run.flush_writes().await;
        let progress = run.progress.clone();
        Ok(RestoredState { connections: run.states, workbooks: vec![workbook], invalid_workbooks: Vec::new(), progress })
    }
}
