//! The workbooks of the runtime (docs/design/dashql_core.md): the scripts of every workbook with their sessions, the
//! index of the workbooks that use a connection, the promotion of the ephemeral workbook and the writes of their
//! changes.
//!
//! A workbook is a workbook of the crate (`dashql_core_runtime::workbook`) that the runtime shares with the runs of it.
//! An action changes a workbook in place, its effects go to the storage writer of the runtime right away, an ephemeral
//! workbook that got a script is promoted, and the connections learn which workbooks use them. A new catalog of a
//! connection outdates the analyses of the scripts on it. The scripts take the connections of the runtime with their
//! catalogs, an action names a connection by its id.

pub(crate) mod view;

use std::cell::{Cell, RefCell};
use std::collections::{BTreeSet, HashMap};
use std::rc::{Rc, Weak};

use dashql_buffers::editor::{EditorEventT, EditorOffsetUnit};
use dashql_core::error::{Error, Result};
use dashql_core_runtime::host::{Host, LogLevel};
use dashql_core_storage::restore::script_connection_of;
use dashql_core_runtime::names::free_workbook_name;
use dashql_core_storage::storage::keys::workbook_connection_copy_key;
use dashql_core_storage::storage::{WriteResult, WriteTask};
use dashql_core_runtime::visible_scripts::{ScriptAnalyses, VisibleScripts};
use dashql_core_storage::workbook_format::data::{WorkbookCloudLink as StoredCloudLink, WorkbookConnection, WorkbookScript};
use dashql_core_runtime::workbook::{
    next_revision, EditorUpdateId, ScriptConnection, StoredScript, Workbook, WorkbookAction, WorkbookEffect, WorkbookOutcome,
    WorkbookScript as Script,
};
use serde_json::{json, Map, Value};

use super::changes::{Read, Slice};
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

impl ScriptAnalyses for Workbooks {
    fn outdated(&self, key: u32) -> bool {
        let Some((_, workbook)) = self.of_script(key).value() else { return false };
        let Ok(workbook) = workbook.try_borrow() else { return false };
        workbook.script(key).is_some_and(Script::is_analysis_outdated)
    }

    fn analyze(&self, key: u32) {
        let Some((workbook_id, _)) = self.of_script(key).value() else { return };
        if let Err(error) = self.apply(&workbook_id, WorkbookAction::AnalyzeOutdatedScript { key }) {
            self.log(LogLevel::Warn, "Failed to analyze an outdated script", &[("workbookId", &workbook_id), ("error", error.what())]);
        }
    }
}

/// The key of the editor update of a script: the generation of its session and the serial of the update. The serial
/// is unique across the scripts of the runtime, a script that moved to another session never shows a key of the one it
/// replaced. None without an update.
pub(crate) fn editor_update_key(script: &Script) -> Option<String> {
    script.editor_update().map(|_| format!("{}:{}", script.session_generation(), script.editor_update_serial()))
}

/// The update that a key of `editor_update_key` names, none for a malformed key
fn editor_update_id(key: &str) -> Option<EditorUpdateId> {
    let (generation, serial) = key.split_once(':')?;
    Some(EditorUpdateId { session_generation: generation.parse().ok()?, serial: serial.parse().ok()? })
}

/// What a change of a workbook changed: the script of an editor event or other scripts, with what the workbook derives
/// if `derives`, or the workbook as a whole, its scripts, its names and its connections
#[derive(Clone, Copy, PartialEq, Eq)]
enum Changed {
    Editor { derives: bool },
    Scripts { derives: bool },
    Workbook,
}

/// The workbooks whose derived view waits until the typing pauses
struct PendingDerives {
    platform: JsPlatform,
    workbooks: BTreeSet<String>,
    /// Counts the restarts of the pause, a timer of an earlier one does nothing
    generation: u64,
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
    /// The workbook of a script by its key. A lookup checks the entry and searches the workbooks when it is gone.
    pub script_index: RefCell<HashMap<u32, String>>,
    /// The workbooks that were refused a load, they can only be deleted
    pub invalid: RefCell<Vec<RestoredInvalidWorkbook>>,
    /// Changes with the list of the invalid workbooks
    pub invalid_revision: Cell<u64>,
    /// Hears that what the cached results of a workbook depend on may have changed, the runs look them up again
    pub changed_listener: RefCell<Option<Rc<dyn Fn(&str)>>>,
    /// Hears that a workbook was deleted or replaced, the runs forget its run
    pub removed_listener: RefCell<Option<Rc<dyn Fn(&str)>>>,
    /// The scripts that the editors show, their outdated analyses run on their own
    pub visible: VisibleScripts<JsPlatform>,
    /// The workbooks whose derived view follows the typing once it paused
    pending_derives: Rc<RefCell<PendingDerives>>,
}

impl Workbooks {
    pub fn new(platform: JsPlatform, connections: Rc<Connections>, writer: RuntimeWriter) -> Rc<Self> {
        let workbooks = Rc::new(Workbooks {
            visible: VisibleScripts::new(platform.clone(), platform.settings().background_analysis_delay_ms),
            pending_derives: Rc::new(RefCell::new(PendingDerives { platform: platform.clone(), workbooks: BTreeSet::new(), generation: 0 })),
            platform,
            connections: connections.clone(),
            writer,
            entries: RefCell::new(Vec::new()),
            script_index: RefCell::new(HashMap::new()),
            invalid: RefCell::new(Vec::new()),
            invalid_revision: Cell::new(0),
            changed_listener: RefCell::new(None),
            removed_listener: RefCell::new(None),
        });
        let scripts: std::rc::Weak<dyn ScriptAnalyses> = Rc::downgrade(&(workbooks.clone() as Rc<dyn ScriptAnalyses>));
        workbooks.visible.set_scripts(scripts);
        // A new catalog of a connection outdates the analyses of the scripts on it
        let weak = Rc::downgrade(&workbooks);
        *connections.catalog_listener.borrow_mut() = Some(Rc::new(move |connection_id: &str| {
            if let Some(workbooks) = weak.upgrade() {
                workbooks.catalog_did_update(connection_id);
            }
        }));
        // A new profile of a connection compiles the visualizations of the scripts on it again
        let weak = Rc::downgrade(&workbooks);
        *connections.profile_listener.borrow_mut() = Some(Rc::new(move |connection_id: &str| {
            if let Some(workbooks) = weak.upgrade() {
                workbooks.connection_profile_changed(connection_id);
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

    /// A workbook by id, busy while the workbooks are borrowed
    pub fn try_get(&self, workbook_id: &str) -> Read<Rc<RefCell<Workbook>>> {
        let Ok(entries) = self.entries.try_borrow() else { return Read::Busy };
        entries.iter().find(|entry| entry.id == workbook_id).map_or(Read::Gone, |entry| Read::Value(entry.workbook.clone()))
    }

    /// The workbook that holds a script, by the index of the scripts. Busy if no free workbook holds it but one is
    /// borrowed.
    pub fn of_script(&self, key: u32) -> Read<(String, Rc<RefCell<Workbook>>)> {
        let Ok(entries) = self.entries.try_borrow() else { return Read::Busy };
        let holds = |entry: &WorkbookEntry| entry.workbook.try_borrow().is_ok_and(|workbook| workbook.script(key).is_some());
        let indexed = self.script_index.try_borrow().ok().and_then(|index| index.get(&key).cloned());
        if let Some(entry) = indexed.and_then(|id| entries.iter().find(|entry| entry.id == id)).filter(|entry| holds(entry)) {
            return Read::Value((entry.id.clone(), entry.workbook.clone()));
        }
        let Some(entry) = entries.iter().find(|entry| holds(entry)) else {
            // A script of a busy workbook is found once the workbook is free
            let busy = entries.iter().any(|entry| entry.workbook.try_borrow().is_err());
            return if busy { Read::Busy } else { Read::Gone };
        };
        if let Ok(mut index) = self.script_index.try_borrow_mut() {
            index.insert(key, entry.id.clone());
        }
        Read::Value((entry.id.clone(), entry.workbook.clone()))
    }

    /// Index the scripts of a workbook by their keys. The index is a cache, a busy one stays as it is.
    pub fn index_scripts(&self, workbook_id: &str, workbook: &Workbook) {
        let Ok(mut index) = self.script_index.try_borrow_mut() else { return };
        for script in workbook.scripts() {
            if index.get(&script.key()).is_none_or(|held| held != workbook_id) {
                index.insert(script.key(), workbook_id.to_string());
            }
        }
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
        let changed = self.connections.registry.borrow_mut().set_references(references);
        for connection_id in &changed {
            self.platform.mark(Slice::Connection(connection_id));
        }
        if !changed.is_empty() {
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
    /// connections learn the workbooks that use them. A failed action leaves the workbook as it was, but for the
    /// scripts that analyzed on the way, e.g. before a rewrite of references, which show their analyses.
    pub fn apply(&self, workbook_id: &str, action: WorkbookAction) -> Result<bool> {
        let workbook = self.get(workbook_id).ok_or_else(|| Error::invalid_argument(format!("no workbook registered with id {workbook_id}")))?;
        let changed = match action {
            // Fields of the scripts that the workbook derives nothing from
            WorkbookAction::SetCachedResult { .. }
            | WorkbookAction::RegisterQuery { .. }
            | WorkbookAction::RegisterScriptResult { .. }
            | WorkbookAction::SetExecutionVisualization { .. } => Changed::Scripts { derives: false },
            // The analyses of the scripts
            WorkbookAction::AnalyzeOutdatedScript { .. } | WorkbookAction::CatalogDidUpdate { .. } => Changed::Scripts { derives: true },
            _ => Changed::Workbook,
        };
        let outcome = workbook.try_borrow_mut().map_err(|_| Error::invalid_argument("the workbook is busy"))?.apply(action);
        match outcome {
            Ok(outcome) => Ok(self.settle(workbook_id, &workbook, outcome, changed)),
            Err(error) => {
                self.platform.mark(Slice::Scripts(workbook_id));
                self.mark_published(workbook_id, &workbook);
                Err(error)
            }
        }
    }

    /// Apply an event of the editor of a script of a session generation and return the packed update for the editor
    /// with its key: the update of the outcome, or the one that the script holds now. `known` is the key of the update
    /// that the editor holds. None for a script that holds another session.
    pub fn apply_editor_event(&self, workbook_id: &str, key: u32, generation: u64, event: EditorEventT, known: Option<&str>) -> Result<Option<(Vec<u8>, String)>> {
        let workbook = self.get(workbook_id).ok_or_else(|| Error::invalid_argument(format!("no workbook registered with id {workbook_id}")))?;
        let (outcome, update, update_key, derives) = {
            let mut held = workbook.try_borrow_mut().map_err(|_| Error::invalid_argument("the workbook is busy"))?;
            if held.script(key).is_none_or(|script| script.session_generation() != generation) {
                return Ok(None);
            }
            let before = analysis_key(&held, key);
            let known = known.and_then(editor_update_id);
            let outcome = held.apply(WorkbookAction::ApplyEditorEvent { key, event, known })?;
            let script = held.script(key);
            let update = match &outcome.editor_update {
                Some(update) => finish!(update),
                None => script.and_then(|script| script.editor_update()).map(|update| finish!(update)).unwrap_or_default(),
            };
            // The update of the outcome is the state of the script, the one that it holds or an equal one
            let update_key = script.and_then(editor_update_key).unwrap_or_default();
            // A move of the cursor leaves the text and the analysis, the workbook derives nothing new
            let derives = before.is_none() || before != analysis_key(&held, key);
            (outcome, update, update_key, derives)
        };
        self.settle(workbook_id, &workbook, outcome, Changed::Editor { derives });
        Ok(Some((update, update_key)))
    }

    /// A run changed a workbook: the effects are written and its scripts changed, with what the workbook derives if the
    /// run analyzed scripts
    pub fn settle_run(&self, workbook_id: &str, effects: Vec<WorkbookEffect>, analyzed: bool) {
        let Some(workbook) = self.get(workbook_id) else { return };
        let outcome = WorkbookOutcome { changed: true, effects, editor_update: None };
        self.settle(workbook_id, &workbook, outcome, Changed::Scripts { derives: analyzed });
    }

    /// Write the effects of an outcome, mark what changed and tell the host. A change of scripts marks them and what the
    /// workbook derives if it `derives`, an editor event marks what the workbook derives once the typing paused; a
    /// change of the workbook marks it as a whole, promotes it and tells the connections which workbooks use them. The scripts of the other workbooks on a catalog that the scripts changed
    /// are outdated, the runs look up the cached results of the workbook again, and the outdated scripts that the
    /// editors show analyze.
    fn settle(&self, workbook_id: &str, workbook: &Rc<RefCell<Workbook>>, outcome: WorkbookOutcome, changed: Changed) -> bool {
        let mut moved = outcome.changed;
        self.write_effects(workbook_id, outcome.effects);
        match changed {
            Changed::Editor { derives } => {
                self.platform.mark(Slice::Scripts(workbook_id));
                if derives {
                    self.derive_after_pause(workbook_id);
                }
            }
            Changed::Scripts { derives } => {
                self.platform.mark(Slice::Scripts(workbook_id));
                if derives {
                    self.pending_derives.borrow_mut().workbooks.remove(workbook_id);
                    self.platform.mark(Slice::Derived(workbook_id));
                }
            }
            Changed::Workbook => {
                self.pending_derives.borrow_mut().workbooks.remove(workbook_id);
                self.platform.mark(Slice::Workbook(workbook_id));
                let taken = self.taken_names(workbook_id);
                let promoted = workbook.try_borrow_mut().ok().and_then(|mut workbook| workbook.promote(taken.iter().map(String::as_str)));
                if let Some(effect) = promoted {
                    moved = true;
                    self.write_effects(workbook_id, vec![effect]);
                }
                self.sync_references();
            }
        }
        self.mark_published(workbook_id, workbook);
        if moved {
            self.platform.signal(true);
            // A move of the cursor changes nothing that a cached result depends on
            if changed != (Changed::Editor { derives: false }) {
                let listener = self.changed_listener.borrow().clone();
                if let Some(listener) = listener {
                    listener(workbook_id);
                }
            }
            // The outdated scripts that the editors show analyze again
            self.visible.changed();
        }
        moved
    }

    /// Mark what a workbook derives once the typing paused for a while. The planner runs over every script of the
    /// workbook, a keystroke leaves it to the pause and costs the same with any number of scripts. Every keystroke
    /// restarts the pause.
    fn derive_after_pause(&self, workbook_id: &str) {
        let generation = {
            let mut pending = self.pending_derives.borrow_mut();
            pending.workbooks.insert(workbook_id.to_string());
            pending.generation += 1;
            pending.generation
        };
        let sleep = self.platform.sleep(self.platform.settings().background_analysis_delay_ms);
        let pending: Weak<RefCell<PendingDerives>> = Rc::downgrade(&self.pending_derives);
        self.platform.spawn(Box::pin(async move {
            sleep.await;
            let Some(pending) = pending.upgrade() else { return };
            let (platform, workbooks) = {
                let Ok(mut pending) = pending.try_borrow_mut() else { return };
                if pending.generation != generation {
                    return;
                }
                (pending.platform.clone(), std::mem::take(&mut pending.workbooks))
            };
            for workbook_id in &workbooks {
                platform.mark(Slice::Derived(workbook_id));
            }
            if !workbooks.is_empty() {
                platform.signal(false);
            }
        }));
    }

    /// Outdate the analyses of the scripts of the other workbooks on the connections whose catalogs the scripts of a
    /// workbook changed: all workbooks on a connection share its catalog
    fn mark_published(&self, workbook_id: &str, workbook: &Rc<RefCell<Workbook>>) {
        let published = workbook.try_borrow_mut().map(|mut workbook| workbook.take_published()).unwrap_or_default();
        for connection_id in published {
            let others: Vec<String> =
                self.connections.registry.borrow().workbooks_of(&connection_id).iter().filter(|id| id.as_str() != workbook_id).cloned().collect();
            for other in others {
                if let Err(error) = self.apply(&other, WorkbookAction::CatalogDidUpdate { connection_id: connection_id.clone() }) {
                    self.log(LogLevel::Warn, "Failed to outdate the scripts of a workbook on a changed catalog", &[("workbookId", &other), ("error", error.what())]);
                }
            }
        }
    }

    /// The profile of a connection changed: the visualizations of the scripts on it compile again and their workbooks
    /// derive again
    pub fn connection_profile_changed(&self, connection_id: &str) {
        let ids: Vec<String> = self.connections.registry.borrow().workbooks_of(connection_id).to_vec();
        for workbook_id in ids {
            let action = WorkbookAction::ConnectionProfileChanged { connection_id: connection_id.to_string() };
            if let Err(error) = self.apply(&workbook_id, action) {
                self.log(LogLevel::Warn, "Failed to follow the profile of a connection", &[("connectionId", connection_id), ("workbookId", &workbook_id), ("error", error.what())]);
            }
        }
    }

    /// Rename an attachment of a workbook (`WorkbookAction::RenameAttachment`) and write the rename of its file at once.
    /// Returns the new file name with the write of the rename, none if the name is unchanged or no plain file name. A
    /// refused rename changes nothing and writes nothing.
    pub fn rename_attachment(&self, workbook_id: &str, file_name: &str, name: &str) -> Result<Option<(String, WriteResult)>> {
        let workbook = self.get(workbook_id).ok_or_else(|| Error::invalid_argument(format!("no workbook registered with id {workbook_id}")))?;
        let action = WorkbookAction::RenameAttachment { file_name: file_name.to_string(), name: name.to_string() };
        let outcome = workbook.try_borrow_mut().map_err(|_| Error::invalid_argument("the workbook is busy"))?.apply(action);
        let mut outcome = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                self.platform.mark(Slice::Scripts(workbook_id));
                self.mark_published(workbook_id, &workbook);
                return Err(error);
            }
        };
        let rename = outcome.effects.iter().position(|effect| matches!(effect, WorkbookEffect::RenameDataFile { .. })).map(|index| outcome.effects.remove(index));
        let write = match rename {
            Some(WorkbookEffect::RenameDataFile { from, to }) => {
                let task = WriteTask::RenameDataFile { workbook_id: workbook_id.to_string(), from, to: to.clone() };
                Some((to, self.writer.write_durable(&task.key(), task)))
            }
            _ => None,
        };
        self.settle(workbook_id, &workbook, outcome, Changed::Workbook);
        Ok(write)
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
                WorkbookEffect::RenameDataFile { from, to } => {
                    let task = WriteTask::RenameDataFile { workbook_id: workbook_id.to_string(), from, to };
                    drop(self.writer.write_durable(&task.key(), task));
                    continue;
                }
                WorkbookEffect::WriteScriptList(list) => WriteTask::WriteWorkbookScripts {
                    workbook_id: workbook_id.to_string(),
                    scripts: list.scripts.iter().map(|s| WorkbookScript::new(s.name.clone(), s.connection_id.clone())).collect(),
                    connections: list.connections.iter().map(|c| connection_copy(&c.connection_id, Some(&c.params))).collect(),
                },
                WorkbookEffect::WriteProperties { name, ephemeral, origin } => {
                    // The workbook file holds the whole link to the cloud as the metadata of the workbook keeps it
                    let link = self.metadata(workbook_id).get("cloud").and_then(StoredCloudLink::from_json);
                    WriteTask::WriteWorkbookProperties { workbook_id: workbook_id.to_string(), name, ephemeral, cloud: origin.and(link) }
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
        let copy = connection_copy(&connection.connection_id, connection.params().as_deref());
        let list = workbook.script_list();
        self.entries.borrow_mut().push(WorkbookEntry {
            id: workbook_id.clone(),
            workbook: Rc::new(RefCell::new(workbook)),
            metadata: Value::Object(metadata),
            metadata_revision: next_revision(),
        });

        // The workbook file right away, then its script list. The later writes of the workbook file wait for it.
        let created = WriteTask::CreateWorkbook {
            workbook_id: workbook_id.clone(),
            name: new.name,
            connection: Some(copy),
            ephemeral: new.ephemeral,
            original_file_name: new.original_file_name,
        };
        drop(self.writer.write(&created.key(), created, 0.0));
        self.write_effects(&workbook_id, vec![WorkbookEffect::WriteScriptList(list)]);
        self.sync_references();
        self.platform.changed(Slice::Workbook(&workbook_id), true);
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
        let replaced = replaced.map(drop).is_some();
        self.platform.changed(Slice::Workbook(&id), true);
        if replaced {
            self.removed(&id);
        }
    }

    /// A workbook was deleted or replaced: the services that keep state of it forget it, e.g. its run
    fn removed(&self, workbook_id: &str) {
        let listener = self.removed_listener.borrow().clone();
        if let Some(listener) = listener {
            listener(workbook_id);
        }
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
            if let Ok(mut index) = self.script_index.try_borrow_mut() {
                index.retain(|_, held| held != workbook_id);
            }
            self.sync_references();
            self.platform.changed(Slice::Workbook(workbook_id), true);
            self.removed(workbook_id);
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
            drop(invalid);
            self.platform.changed(Slice::WorkbookList, true);
        }
    }

    /// Set the invalid workbooks of a restore
    pub fn set_invalid(&self, invalid: Vec<RestoredInvalidWorkbook>) {
        *self.invalid.borrow_mut() = invalid;
        self.invalid_revision.set(next_revision());
        self.platform.changed(Slice::WorkbookList, true);
    }

    /// Link a workbook to a published workbook, the whole link goes into the workbook file, none removes it. A failed
    /// link leaves the workbook and its metadata as they were.
    pub fn set_cloud_link(&self, workbook_id: &str, link: Option<Value>) -> Result<bool> {
        let ids = match &link {
            Some(link) => Some(WorkbookCloudLink::origin(link).ok_or_else(|| Error::invalid_argument("the link to a cloud misses its ids"))?),
            None => None,
        };
        let workbook = self.get(workbook_id).ok_or_else(|| Error::invalid_argument(format!("no workbook registered with id {workbook_id}")))?;
        let outcome = workbook.try_borrow_mut().map_err(|_| Error::invalid_argument("the workbook is busy"))?.apply(WorkbookAction::SetOrigin { origin: ids })?;
        // The metadata changes with the workbook, before its effects write the link into the workbook file
        {
            let mut entries = self.entries.borrow_mut();
            let entry = entries.iter_mut().find(|entry| entry.id == workbook_id);
            let Some(entry) = entry else {
                // The link of the workbook changed
                drop(entries);
                self.platform.changed(Slice::Workbook(workbook_id), true);
                return Err(Error::invalid_argument(format!("no workbook registered with id {workbook_id}")));
            };
            if let Value::Object(metadata) = &mut entry.metadata {
                match link {
                    Some(link) => metadata.insert("cloud".into(), link),
                    None => metadata.remove("cloud"),
                };
            }
            entry.metadata_revision = next_revision();
        }
        Ok(self.settle(workbook_id, &workbook, outcome, Changed::Workbook))
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
        let replaced = workbook.try_borrow_mut().map_err(|_| Error::invalid_argument("the workbook is busy"))?.replace_from_storage(stored);
        // A failure is reported once the workbook is whole again, it may have changed the workbook. Nothing is written
        // back.
        if replaced.as_ref().map_or(true, |changed| *changed) {
            self.settle(workbook_id, &workbook, WorkbookOutcome { changed: true, effects: Vec::new(), editor_update: None }, Changed::Workbook);
        }
        replaced
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

    /// The view of a workbook, busy while the workbook is borrowed
    pub fn view(&self, workbook_id: &str) -> Read<WorkbookView> {
        let Ok(entries) = self.entries.try_borrow() else { return Read::Busy };
        let Some(entry) = entries.iter().find(|entry| entry.id == workbook_id) else { return Read::Gone };
        let Ok(workbook) = entry.workbook.try_borrow() else { return Read::Busy };
        Read::Value(workbook_view(entry, &workbook))
    }

    /// The view of the list of the workbooks, busy while a workbook is borrowed
    pub fn list_view(&self) -> Read<WorkbookListView> {
        let Ok(entries) = self.entries.try_borrow() else { return Read::Busy };
        let mut workbooks = Vec::with_capacity(entries.len());
        let mut names = Vec::new();
        for entry in entries.iter() {
            let Ok(workbook) = entry.workbook.try_borrow() else { return Read::Busy };
            if !workbook.ephemeral() {
                names.extend(workbook.name().map(str::to_string));
            }
            workbooks.push(WorkbookListEntry {
                workbook_id: entry.id.clone(),
                name: workbook.name().map(str::to_string),
                ephemeral: workbook.ephemeral(),
                cloud_preview: workbook.is_read_only(),
            });
        }
        let Ok(invalid) = self.invalid.try_borrow() else { return Read::Busy };
        let next_workbook_name = free_workbook_name(names.iter().map(String::as_str));
        Read::Value(WorkbookListView { workbooks, invalid_workbooks: invalid.clone(), next_workbook_name })
    }
}

/// What the derived view of a workbook reads of a script: the version of its text and the analysis that it holds. None
/// for a script that is gone or a session that is busy.
fn analysis_key(workbook: &Workbook, key: u32) -> Option<(u64, u64)> {
    let script = workbook.script(key)?;
    let text_version = script.session().try_borrow().ok()?.text_version();
    Some((text_version, script.analysis_serial()))
}

/// The copy of a connection in a workbook file
fn connection_copy(connection_id: &str, params: Option<&str>) -> WorkbookConnection {
    let params = params.and_then(|params| serde_json::from_str::<Value>(params).ok()).unwrap_or(Value::Null);
    WorkbookConnection::new(connection_id, params)
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
    if workbook.origin().is_none() {
        metadata.remove("cloud");
    }
    let scripts = workbook.scripts();
    WorkbookView {
        workbook_id: entry.id.clone(),
        name: workbook.name().map(str::to_string),
        workbook_metadata: JsonValue(Value::Object(metadata)),
        ephemeral: workbook.ephemeral(),
        pending_connection_id: workbook.pending_connection().map(|c| c.connection_id.clone()),
        cloud: workbook.origin().and_then(WorkbookCloudLink::of),
        attachments: workbook.attachments().map(|attachments| attachments.iter().map(WorkbookAttachmentView::from).collect()),
        script_list: workbook.script_list().into(),
        script_keys: scripts.iter().map(|script| script.key()).collect(),
        script_order: scripts.iter().map(|script| script.file_name().to_string()).collect(),
        script_connections: scripts.iter().map(|script| script.connection().connection_id.clone()).collect(),
        connection_ids: Workbooks::connection_ids(workbook),
        next_script_connection_id: workbook.new_script_connection(None).map(|connection| connection.connection_id.clone()),
    }
}
