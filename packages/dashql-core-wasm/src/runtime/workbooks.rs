//! The workbooks of the runtime (docs/wip/runtime_api.md): the scripts of every workbook with their sessions, the index
//! of the workbooks that use a connection, the promotion of the ephemeral workbook and the writes of their changes.
//!
//! A workbook is a workbook of the crate (`dashql_core_runtime::workbook`) that the runtime shares with the runs of it.
//! An action changes a workbook in place, its effects go to the storage writer of the runtime right away, an ephemeral
//! workbook that got a script is promoted, and the connections learn which workbooks use them. A new catalog of a
//! connection outdates the analyses of the scripts on it. The scripts take the connections of the runtime with their
//! catalogs, an action names a connection by its id.

pub(crate) mod view;

use std::cell::{Cell, RefCell};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use dashql_buffers::editor::EditorOffsetUnit;
use dashql_core::error::{Error, Result};
use dashql_core_runtime::host::LogLevel;
use dashql_core_runtime::restore::script_connection_of;
use dashql_core_runtime::storage::keys::{workbook_connection_copy_key, workbook_file_key, workbook_scripts_key};
use dashql_core_runtime::storage::{TextSource, WriteTask};
use dashql_core_runtime::workbook_format::data::{WorkbookCloudLink as StoredCloudLink, WorkbookConnection, WorkbookScript};
use dashql_core_runtime::workbook::{
    next_revision, CloudLink, ScriptConnection, StoredScript, Workbook, WorkbookAction, WorkbookEffect, WorkbookOutcome,
};
use serde_json::{json, Map, Value};

use super::connections::Connections;
use super::storage::RuntimeWriter;
use crate::host::JsPlatform;
use crate::runtime::storage::restore_view::RestoredInvalidWorkbook;
use crate::views::JsonValue;
use view::{WorkbookAttachmentView, WorkbookCloudLink, WorkbookListEntry, WorkbookListView, WorkbookView};

/// How long the writes of a workbook wait for the next change
const DEBOUNCE_MS: f64 = 100.0;

/// The target of the log messages of the workbooks
const LOG_TARGET: &str = "workbook_scripts";

/// The key of an editor update: its versions, its status and whether it holds an analysis
pub(crate) fn editor_update_key(update: &dashql_buffers::editor::EditorUpdateT) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        update.text_version, update.state_revision, update.catalog_revision, update.status.0, update.analysis_available
    )
}

/// A workbook of the runtime
pub(crate) struct WorkbookEntry {
    pub id: String,
    /// The workbook, shared with its runs
    pub workbook: Rc<RefCell<Workbook>>,
    /// The metadata of the workbook file that the workbook doesn't keep: its origin and the whole link to a cloud
    pub metadata: Value,
    /// Changes with the metadata
    pub metadata_revision: u64,
}

/// A new workbook
pub(crate) struct NewWorkbook {
    pub workbook_id: Option<String>,
    /// The connection of its first script
    pub connection_id: String,
    pub name: Option<String>,
    pub ephemeral: bool,
    /// The file name the workbook is created from, e.g. the short name of its connector
    pub original_file_name: Option<String>,
}

/// A script as storage holds it, by the id of its connection
#[derive(Clone)]
pub(crate) struct StoredScriptRef {
    pub name: String,
    pub sql: String,
    pub connection_id: String,
    pub unresolved_connection_id: Option<String>,
}

/// The workbooks of a runtime
pub(crate) struct Workbooks {
    pub platform: JsPlatform,
    pub connections: Rc<Connections>,
    pub writer: RuntimeWriter,
    /// The workbooks in the order they were registered
    pub entries: RefCell<Vec<WorkbookEntry>>,
    /// The workbooks that were refused a load, they can only be deleted
    pub invalid: RefCell<Vec<RestoredInvalidWorkbook>>,
    /// Changes with the list of the invalid workbooks
    pub invalid_revision: Cell<u64>,
}

impl Workbooks {
    pub fn new(platform: JsPlatform, connections: Rc<Connections>, writer: RuntimeWriter) -> Rc<Self> {
        let workbooks = Rc::new(Workbooks {
            platform,
            connections: connections.clone(),
            writer,
            entries: RefCell::new(Vec::new()),
            invalid: RefCell::new(Vec::new()),
            invalid_revision: Cell::new(0),
        });
        // A new catalog of a connection outdates the analyses of the scripts on it
        let weak = Rc::downgrade(&workbooks);
        *connections.catalog_listener.borrow_mut() = Some(Rc::new(move |connection_id: &str| {
            if let Some(workbooks) = weak.upgrade() {
                workbooks.catalog_did_update(connection_id);
            }
        }));
        workbooks
    }

    /// The offset unit of the editors of the workbooks
    pub fn offset_unit() -> EditorOffsetUnit {
        EditorOffsetUnit::UTF16_CODE_UNITS
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, LOG_TARGET);
    }

    /// A workbook by id
    pub fn get(&self, workbook_id: &str) -> Option<Rc<RefCell<Workbook>>> {
        self.entries.borrow().iter().find(|entry| entry.id == workbook_id).map(|entry| entry.workbook.clone())
    }

    /// The workbook that holds a script
    pub fn of_script(&self, key: u32) -> Option<(String, Rc<RefCell<Workbook>>)> {
        let entries = self.entries.borrow();
        entries
            .iter()
            .find(|entry| entry.workbook.try_borrow().is_ok_and(|workbook| workbook.script(key).is_some()))
            .map(|entry| (entry.id.clone(), entry.workbook.clone()))
    }

    /// The connection of the scripts on a connection of the runtime, with its catalog
    pub fn script_connection(&self, connection_id: &str) -> Result<Rc<ScriptConnection>> {
        let registry = self.connections.registry.borrow();
        let connection =
            registry.get(connection_id).ok_or_else(|| Error::invalid_argument(format!("no connection registered with id {connection_id}")))?;
        let state = connection.state.borrow();
        Ok(script_connection_of(&state))
    }

    /// The ids of the connections that a workbook uses: of its scripts in feed order, then its pending connection
    pub fn connection_ids(workbook: &Workbook) -> Vec<String> {
        let mut ids: Vec<String> = Vec::new();
        for script in workbook.scripts() {
            let id = &script.connection().connection_id;
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
        if let Some(pending) = workbook.pending_connection() {
            if !ids.contains(&pending.connection_id) {
                ids.push(pending.connection_id.clone());
            }
        }
        ids
    }

    /// Tell the connections which workbooks use them, e.g. a connection that a workbook uses is never deleted
    pub fn sync_references(&self) {
        let mut references: Vec<(String, Vec<String>)> = Vec::new();
        for entry in self.entries.borrow().iter() {
            let Ok(workbook) = entry.workbook.try_borrow() else { continue };
            for connection_id in Self::connection_ids(&workbook) {
                match references.iter_mut().find(|(id, _)| *id == connection_id) {
                    Some((_, workbooks)) => workbooks.push(entry.id.clone()),
                    None => references.push((connection_id, vec![entry.id.clone()])),
                }
            }
        }
        if self.connections.registry.borrow_mut().set_references(references) {
            self.platform.signal(true);
        }
    }

    /// The names that a new workbook can't take, the ephemeral workbook gives up its name
    fn taken_names(&self, except: &str) -> Vec<String> {
        self.entries
            .borrow()
            .iter()
            .filter(|entry| entry.id != except)
            .filter_map(|entry| entry.workbook.try_borrow().ok().filter(|w| !w.ephemeral()).and_then(|w| w.name().map(str::to_string)))
            .collect()
    }

    /// Apply an action to a workbook: its effects are written, an ephemeral workbook with scripts is promoted and the
    /// connections learn the workbooks that use them. A failed action leaves the workbook as it was.
    pub fn apply(&self, workbook_id: &str, action: WorkbookAction) -> Result<bool> {
        let workbook = self.get(workbook_id).ok_or_else(|| Error::invalid_argument(format!("no workbook registered with id {workbook_id}")))?;
        // An editor update changes neither the connections nor the scripts of the workbook
        let editor_only = matches!(action, WorkbookAction::ReportEditorUpdate { .. });
        let outcome = {
            let mut workbook = workbook.try_borrow_mut().map_err(|_| Error::invalid_argument("the workbook is busy"))?;
            workbook.apply(action)?
        };
        let changed = self.settle(workbook_id, &workbook, outcome, editor_only);
        Ok(changed)
    }

    /// Write the effects of an outcome, promote the workbook and tell the host
    fn settle(&self, workbook_id: &str, workbook: &Rc<RefCell<Workbook>>, outcome: WorkbookOutcome, editor_only: bool) -> bool {
        let mut changed = outcome.changed;
        self.write_effects(workbook_id, outcome.effects);
        if !editor_only {
            let taken = self.taken_names(workbook_id);
            let promoted = workbook.try_borrow_mut().ok().and_then(|mut workbook| workbook.promote(taken.iter().map(String::as_str)));
            if let Some(effect) = promoted {
                changed = true;
                self.write_effects(workbook_id, vec![effect]);
            }
            self.sync_references();
        }
        if changed {
            self.platform.signal(true);
        }
        changed
    }

    /// The metadata of a workbook
    fn metadata(&self, workbook_id: &str) -> Value {
        self.entries.borrow().iter().find(|entry| entry.id == workbook_id).map(|entry| entry.metadata.clone()).unwrap_or(Value::Null)
    }

    /// Schedule the writes of the effects of an action, in order
    pub fn write_effects(&self, workbook_id: &str, effects: Vec<WorkbookEffect>) {
        for effect in effects {
            // A task names its key (`storage::keys`)
            let task = match effect {
                WorkbookEffect::WriteScript { file_name, text } => WriteTask::WriteScript { workbook_id: workbook_id.to_string(), file_name, text },
                WorkbookEffect::DeleteScript { file_name } => WriteTask::DeleteScript { workbook_id: workbook_id.to_string(), file_name },
                WorkbookEffect::RenameScript { from, to } => WriteTask::RenameScript { workbook_id: workbook_id.to_string(), from, to },
                WorkbookEffect::WriteScriptList(list) => WriteTask::WriteWorkbookScripts {
                    workbook_id: workbook_id.to_string(),
                    scripts: list.scripts.iter().map(|s| WorkbookScript::new(s.name.clone(), s.connection_id.clone())).collect(),
                    connections: list.connections.iter().map(|c| connection_copy(&c.connection_id, Some(&c.params))).collect(),
                },
                WorkbookEffect::WriteProperties { name, ephemeral, cloud } => {
                    // The workbook file holds the whole link to the cloud, the workbook only its ids
                    let link = self.metadata(workbook_id).get("cloud").and_then(StoredCloudLink::from_json);
                    WriteTask::WriteWorkbookProperties { workbook_id: workbook_id.to_string(), name, ephemeral, cloud: cloud.and(link) }
                }
                WorkbookEffect::PatchConnection { connection_id, params, replaces } => {
                    for from in replaces {
                        let task = WriteTask::PatchWorkbookConnection {
                            workbook_id: workbook_id.to_string(),
                            copy: connection_copy(&connection_id, params.as_deref()),
                            replaced: vec![from.clone()],
                        };
                        drop(self.writer.write(&workbook_connection_copy_key(workbook_id, &from), task, DEBOUNCE_MS));
                    }
                    continue;
                }
            };
            drop(self.writer.write(&task.key(), task, DEBOUNCE_MS));
        }
    }

    /// Create a workbook without scripts on a connection and write it, returns its id
    pub fn create(&self, new: NewWorkbook) -> Result<String> {
        let workbook_id = match new.workbook_id {
            Some(id) => id,
            None => self.platform.random_uuid().map_err(|e| Error::invalid_argument(e.message().to_string()))?,
        };
        if self.get(&workbook_id).is_some() {
            return Err(Error::invalid_argument(format!("a workbook with id {workbook_id} exists already")));
        }
        let connection = self.script_connection(&new.connection_id)?;
        let mut workbook = Workbook::new(&workbook_id, new.name.clone(), Some(connection.clone()), Self::offset_unit());
        workbook.set_ephemeral(new.ephemeral);
        let mut metadata = Map::new();
        metadata.insert("originType".into(), json!("LOCAL"));
        metadata.insert("originalFileName".into(), json!(new.original_file_name.clone().unwrap_or_default()));
        metadata.insert("originalHttpUrl".into(), json!(""));
        let copy = connection_copy(&connection.connection_id, connection.params.as_deref());
        let list = workbook.script_list();
        self.entries.borrow_mut().push(WorkbookEntry {
            id: workbook_id.clone(),
            workbook: Rc::new(RefCell::new(workbook)),
            metadata: Value::Object(metadata),
            metadata_revision: next_revision(),
        });

        // The workbook as a whole, then its script list, then its first manifest
        let replace = WriteTask::ReplaceWorkbookScripts {
            workbook_id: workbook_id.clone(),
            name: new.name,
            scripts: Vec::<(String, TextSource)>::new(),
            connection: list.connections.first().map(|c| connection_copy(&c.connection_id, Some(&c.params))),
            original_file_name: new.original_file_name,
        };
        drop(self.writer.write(&workbook_scripts_key(&workbook_id), replace, DEBOUNCE_MS));
        self.write_effects(&workbook_id, vec![WorkbookEffect::WriteScriptList(list)]);
        let manifest = WriteTask::WriteWorkbookManifest { workbook_id: workbook_id.clone(), connections: vec![copy], ephemeral: new.ephemeral };
        drop(self.writer.write(&workbook_file_key(&workbook_id), manifest, 0.0));
        self.sync_references();
        self.platform.signal(true);
        Ok(workbook_id)
    }

    /// Take a workbook that the restore created. A workbook with the same id is replaced.
    pub fn adopt(&self, workbook: Workbook, metadata: Value) {
        let id = workbook.id().to_string();
        let entry = WorkbookEntry { id: id.clone(), workbook: Rc::new(RefCell::new(workbook)), metadata, metadata_revision: next_revision() };
        let replaced = {
            let mut entries = self.entries.borrow_mut();
            match entries.iter_mut().find(|held| held.id == id) {
                Some(held) => Some(std::mem::replace(held, entry)),
                None => {
                    entries.push(entry);
                    None
                }
            }
        };
        // The scripts of a replaced workbook leave the catalogs of their connections
        drop(replaced);
        self.platform.signal(true);
    }

    /// Drop a workbook, its scripts leave the catalogs of their connections. Its files stay.
    pub fn delete(&self, workbook_id: &str) -> bool {
        let removed = {
            let mut entries = self.entries.borrow_mut();
            let position = entries.iter().position(|entry| entry.id == workbook_id);
            position.map(|position| entries.remove(position))
        };
        let deleted = removed.is_some();
        drop(removed);
        if deleted {
            self.sync_references();
            self.platform.signal(true);
        }
        deleted
    }

    /// Forget an invalid workbook, e.g. once its files were deleted
    pub fn forget_invalid(&self, workbook_id: &str) {
        let mut invalid = self.invalid.borrow_mut();
        let before = invalid.len();
        invalid.retain(|workbook| workbook.workbook_id != workbook_id);
        if invalid.len() != before {
            self.invalid_revision.set(next_revision());
            self.platform.signal(true);
        }
    }

    /// Set the invalid workbooks of a restore
    pub fn set_invalid(&self, invalid: Vec<RestoredInvalidWorkbook>) {
        *self.invalid.borrow_mut() = invalid;
        self.invalid_revision.set(next_revision());
        self.platform.signal(true);
    }

    /// Link a workbook to a published workbook, the whole link goes into the workbook file, none removes it
    pub fn set_cloud_link(&self, workbook_id: &str, link: Option<Value>) -> Result<bool> {
        let ids = match &link {
            Some(link) => Some(cloud_link_of(link).ok_or_else(|| Error::invalid_argument("the link to a cloud misses its ids"))?),
            None => None,
        };
        {
            let mut entries = self.entries.borrow_mut();
            let entry = entries.iter_mut().find(|entry| entry.id == workbook_id);
            let Some(entry) = entry else { return Err(Error::invalid_argument(format!("no workbook registered with id {workbook_id}"))) };
            if let Value::Object(metadata) = &mut entry.metadata {
                match link {
                    Some(link) => metadata.insert("cloud".into(), link),
                    None => metadata.remove("cloud"),
                };
            }
            entry.metadata_revision = next_revision();
        }
        self.apply(workbook_id, WorkbookAction::SetCloudLink { link: ids })
    }

    /// The scripts that storage holds, with the connections of the runtime
    pub fn stored_scripts(&self, scripts: Vec<StoredScriptRef>) -> Result<Vec<StoredScript>> {
        scripts
            .into_iter()
            .map(|script| {
                Ok(StoredScript {
                    connection: self.script_connection(&script.connection_id)?,
                    name: script.name,
                    sql: script.sql,
                    unresolved_connection_id: script.unresolved_connection_id,
                })
            })
            .collect()
    }

    /// Replace the scripts of a workbook with the ones that storage holds, e.g. after the files changed outside the app.
    /// Writes nothing back. Returns whether anything changed.
    pub fn replace_from_storage(&self, workbook_id: &str, scripts: Vec<StoredScriptRef>) -> Result<bool> {
        let workbook = self.get(workbook_id).ok_or_else(|| Error::invalid_argument(format!("no workbook registered with id {workbook_id}")))?;
        let stored = self.stored_scripts(scripts)?;
        let changed = workbook.try_borrow_mut().map_err(|_| Error::invalid_argument("the workbook is busy"))?.replace_from_storage(stored)?;
        if changed {
            self.sync_references();
            self.platform.signal(true);
        }
        Ok(changed)
    }

    /// A new catalog of a connection: the scripts on it analyze again
    pub fn catalog_did_update(&self, connection_id: &str) {
        let ids: Vec<String> = self.connections.registry.borrow().workbooks_of(connection_id).to_vec();
        for workbook_id in ids {
            if let Err(error) = self.apply(&workbook_id, WorkbookAction::CatalogDidUpdate { connection_id: connection_id.to_string() }) {
                self.log(LogLevel::Error, "Connection script action failed", &[("connectionId", connection_id), ("workbookId", &workbook_id), ("error", error.what())]);
            }
        }
    }

    /// The view of a workbook
    pub fn view(&self, workbook_id: &str) -> Option<WorkbookView> {
        let entries = self.entries.borrow();
        let entry = entries.iter().find(|entry| entry.id == workbook_id)?;
        let workbook = entry.workbook.try_borrow().ok()?;
        Some(workbook_view(entry, &workbook))
    }

    /// What the view of the list of the workbooks shows, as a hash
    pub fn list_key(entries: &[WorkbookEntry], invalid_revision: u64) -> u64 {
        let mut hasher = DefaultHasher::new();
        invalid_revision.hash(&mut hasher);
        for entry in entries {
            entry.id.hash(&mut hasher);
            if let Ok(workbook) = entry.workbook.try_borrow() {
                (workbook.name(), workbook.ephemeral(), workbook.is_cloud_preview()).hash(&mut hasher);
            }
        }
        hasher.finish()
    }

    /// The view of the list of the workbooks
    pub fn list_view(&self) -> WorkbookListView {
        let workbooks = self
            .entries
            .borrow()
            .iter()
            .filter_map(|entry| {
                let workbook = entry.workbook.try_borrow().ok()?;
                Some(WorkbookListEntry {
                    workbook_id: entry.id.clone(),
                    name: workbook.name().map(str::to_string),
                    ephemeral: workbook.ephemeral(),
                    cloud_preview: workbook.is_cloud_preview(),
                })
            })
            .collect();
        WorkbookListView { workbooks, invalid_workbooks: self.invalid.borrow().clone() }
    }
}

/// The copy of a connection in a workbook file
fn connection_copy(connection_id: &str, params: Option<&str>) -> WorkbookConnection {
    let params = params.and_then(|params| serde_json::from_str::<Value>(params).ok()).unwrap_or(Value::Null);
    WorkbookConnection::new(connection_id, params)
}

/// The ids of a link to a cloud that the workbook keeps
fn cloud_link_of(link: &Value) -> Option<CloudLink> {
    let workbook_id = link.get("workbookId")?.as_str()?.to_string();
    let version_id = link.get("versionId")?.as_str()?.to_string();
    let preview = link.get("preview").and_then(Value::as_bool).unwrap_or(false);
    Some(CloudLink { workbook_id, version_id, preview })
}

/// What the view of a workbook shows, as a hash: everything but the texts and analyses of its scripts. A change of a
/// script changes the slice of the script, the workbook keeps its slice while its key doesn't move.
pub(crate) fn workbook_key(entry: &WorkbookEntry, workbook: &Workbook) -> u64 {
    let mut hasher = DefaultHasher::new();
    entry.metadata_revision.hash(&mut hasher);
    workbook.name().hash(&mut hasher);
    workbook.ephemeral().hash(&mut hasher);
    workbook.pending_connection().map(|connection| (&connection.connection_id, &connection.params)).hash(&mut hasher);
    workbook.cloud().map(|link| (&link.workbook_id, &link.version_id, link.preview)).hash(&mut hasher);
    workbook.attachments().map(|attachments| attachments.len()).hash(&mut hasher);
    for attachment in workbook.attachments().unwrap_or_default() {
        (&attachment.file_name, attachment.size_bytes, attachment.mtime_ms, &attachment.columns).hash(&mut hasher);
    }
    for script in workbook.scripts() {
        let connection = script.connection();
        (script.key(), script.file_name(), &connection.connection_id, &connection.params, script.unresolved_connection_id()).hash(&mut hasher);
    }
    hasher.finish()
}

/// The view of a workbook of an entry
pub(crate) fn workbook_view(entry: &WorkbookEntry, workbook: &Workbook) -> WorkbookView {
    let mut metadata = match &entry.metadata {
        Value::Object(metadata) => metadata.clone(),
        _ => Map::new(),
    };
    metadata.remove("ephemeral");
    if workbook.ephemeral() {
        metadata.insert("ephemeral".into(), Value::Bool(true));
    }
    if workbook.cloud().is_none() {
        metadata.remove("cloud");
    }
    let scripts = workbook.scripts();
    WorkbookView {
        workbook_id: entry.id.clone(),
        name: workbook.name().map(str::to_string),
        workbook_metadata: JsonValue(Value::Object(metadata)),
        ephemeral: workbook.ephemeral(),
        pending_connection_id: workbook.pending_connection().map(|c| c.connection_id.clone()),
        cloud: workbook.cloud().map(WorkbookCloudLink::from),
        attachments: workbook.attachments().map(|attachments| attachments.iter().map(WorkbookAttachmentView::from).collect()),
        script_list: workbook.script_list().into(),
        script_keys: scripts.iter().map(|script| script.key()).collect(),
        script_order: scripts.iter().map(|script| script.file_name().to_string()).collect(),
        script_connections: scripts.iter().map(|script| script.connection().connection_id.clone()).collect(),
        connection_ids: Workbooks::connection_ids(workbook),
    }
}
