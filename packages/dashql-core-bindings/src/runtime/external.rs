//! The workbook folders that change outside the app (docs/design/native_file_sync.md): a native workbook folder is
//! checked when the app asks (`checkWorkbookFolders`, e.g. when the window gets the focus) and when the storage writer
//! holds a write because a script changed on disk.
//!
//! A check holds the writes of the workbook (`HoldReason::Reload`), compares the stamps of the scripts and of the
//! workbook file (size and modification time) with what the app wrote or acknowledged (`FolderStamps`, the restore
//! acknowledged what it read), reads the files only when a stamp differs and resolves the scripts of the folder against
//! the connections of the runtime. A check that settled the disk releases the hold of a write that found a changed file
//! (`HoldReason::ExternalChange`).
//! A workbook file that changed outside the app is asked about like a script when its scripts or its name differ from
//! what the app shows; the app never overwrites it unasked. A connection that only the workbook file names joins the
//! runtime from its copy and leaves it again unless the reload is applied. When the scripts differ from what the app
//! shows, the `storage` view asks the question (`externalChanges`), the app shows it and answers with
//! `answerExternalChange`: a reload replaces the scripts of the workbook, a refusal writes the scripts of the app over
//! the disk. The checks run one at a time, a check of a workbook that is queued already is dropped.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;

use dashql_core::error::Result;
use dashql_core_runtime::connections::label::is_hyper_wasm_connection;
use dashql_core_runtime::connections::ConnectionAction;
use dashql_core_runtime::host::signal::{oneshot, Sender};
use dashql_core_runtime::host::{Host, HostError, LogLevel};
use dashql_core_runtime::workbook::WorkbookAction;
use dashql_core_storage::restore::connection_state;
use dashql_core_storage::storage::keys::is_reloaded_key;
use dashql_core_storage::storage::{FolderListing, HoldReason, WriteTask};
use dashql_core_storage::workbook_format::data::{WorkbookConnection, WorkbookData};
use dashql_core_storage::workbook_format::files::nfc;
use dashql_core_storage::workbook_format::restore::RestoreConnection;
use dashql_core_storage::workbook_format::script_connections::{
    resolve_workbook_scripts, workbook_scripts_resolution_changed, ConnectionResolver, ResolvedConnection,
};
use dashql_core_storage::workbook_format::validation::is_local_hyper_wasm_params;
use serde_json::Value;
use wasm_bindgen::prelude::*;

use super::attachments::reconcile_attachments;
use super::changes::Slice;
use super::connections::Connections;
use super::runs::Runs;
use super::storage::restore_view::RestoreScriptFile;
use super::storage::{listing_of, load_workbook, JsStorage, StorageState};
use super::workbooks::{StoredScriptRef, Workbooks};
use crate::host::{call_method, JsPlatform};

/// The target of the log of the checks
const LOG_TARGET: &str = "native_workbook_sync";
/// How long a write of a reloaded workbook waits for the next change
const DEBOUNCE_MS: f64 = 100.0;
/// How long a check waits before it checks a workbook again that another task holds
const BUSY_RETRY_MS: f64 = 100.0;

/// The attachments of a listing of a folder as a comparable text: name, size and modification time, sorted
fn attachment_listing(listing: &FolderListing) -> String {
    let mut files: Vec<(&str, f64, f64)> =
        listing.attachments.iter().map(|file| (file.name.as_str(), file.stamp.size, file.stamp.mtime_ms)).collect();
    files.sort_by(|a, b| a.0.cmp(b.0).then(a.1.total_cmp(&b.1)).then(a.2.total_cmp(&b.2)));
    files.iter().map(|(name, size, mtime)| format!("{name}\u{0}{size}\u{0}{mtime}")).collect::<Vec<_>>().join("\u{1}")
}

/// The scripts of a folder resolved against the connections of the runtime
struct StoredScripts {
    /// The scripts in feed order, as `replaceFromStorage` takes them
    scripts: Vec<StoredScriptRef>,
    /// The workbook file that describes the resolved scripts
    workbook: WorkbookData,
}

/// A connection of the runtime as the resolution sees it
struct KnownConnection {
    connection_id: String,
    params: Value,
}

/// Resolves the connections of a workbook file against the connections of the runtime, a connection that only the
/// workbook file names joins the runtime from its copy
struct RuntimeResolver<'a> {
    known: Vec<KnownConnection>,
    embedded: ResolvedConnection,
    sync: &'a ExternalChanges,
    created: &'a mut Vec<String>,
}

impl ConnectionResolver for RuntimeResolver<'_> {
    fn resolve(
        &mut self,
        connection_id: &str,
        copy: Option<&WorkbookConnection>,
    ) -> Result<Option<ResolvedConnection>> {
        if let Some(known) = self.known.iter().find(|known| known.connection_id == connection_id) {
            return Ok(Some(ResolvedConnection {
                connection_id: known.connection_id.clone(),
                params: known.params.clone(),
            }));
        }
        let Some(copy) = copy else {
            return Ok(None);
        };
        // A copy of the embedded Hyper names the embedded Hyper of the app
        if is_local_hyper_wasm_params(&copy.params) {
            return Ok(Some(self.embedded.clone()));
        }
        let connection = self.sync.create_connection(connection_id, copy)?;
        self.created.push(connection.connection_id.clone());
        self.known.push(KnownConnection {
            connection_id: connection.connection_id.clone(),
            params: connection.params.clone(),
        });
        Ok(Some(connection))
    }

    fn fallback(&mut self) -> Result<ResolvedConnection> {
        Ok(self.embedded.clone())
    }
}

/// How a check of a folder ended
enum Checked {
    /// The disk and the app agree, or the user decided between them
    Settled,
    /// Nothing is decided yet, e.g. the scripts changed while the question was open or the scripts folder is gone for
    /// the moment; a later check decides
    Pending,
    /// Another task holds the workbook, the check runs again in a moment
    Busy,
}

/// An answer that a question waits for
struct Waiting {
    prompt: u32,
    answer: Sender<Option<bool>>,
}

/// The checks of the workbook folders that change outside the app
pub(crate) struct ExternalChanges {
    platform: JsPlatform,
    storage: Rc<StorageState>,
    connections: Rc<Connections>,
    workbooks: Rc<Workbooks>,
    runs: Rc<Runs>,
    /// The workbooks to check, in order
    queue: RefCell<VecDeque<String>>,
    /// Does a task check the queue?
    running: Cell<bool>,
    /// The attachments of a workbook at its last check
    attachments: RefCell<BTreeMap<String, String>>,
    /// The questions that wait for their answers, by workbook
    waiting: RefCell<BTreeMap<String, Waiting>>,
    /// The number of the last question
    prompts: Cell<u32>,
    destroyed: Cell<bool>,
}

impl ExternalChanges {
    pub fn new(
        platform: JsPlatform,
        storage: Rc<StorageState>,
        connections: Rc<Connections>,
        workbooks: Rc<Workbooks>,
        runs: Rc<Runs>,
    ) -> Rc<Self> {
        Rc::new(ExternalChanges {
            platform,
            storage,
            connections,
            workbooks,
            runs,
            queue: RefCell::new(VecDeque::new()),
            running: Cell::new(false),
            attachments: RefCell::new(BTreeMap::new()),
            waiting: RefCell::new(BTreeMap::new()),
            prompts: Cell::new(0),
            destroyed: Cell::new(false),
        })
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, LOG_TARGET);
    }

    /// Check the folders of workbooks, in order after the checks that are queued
    pub fn check(self: &Rc<Self>, workbook_ids: Vec<String>) {
        if self.destroyed.get() {
            return;
        }
        {
            let mut queue = self.queue.borrow_mut();
            for workbook_id in workbook_ids {
                if !queue.contains(&workbook_id) {
                    queue.push_back(workbook_id);
                }
            }
        }
        if self.running.replace(true) {
            return;
        }
        let sync = self.clone();
        self.platform.spawn(Box::pin(async move {
            loop {
                let next = sync.queue.borrow_mut().pop_front();
                let Some(workbook_id) = next else { break };
                if sync.destroyed.get() {
                    break;
                }
                sync.check_workbook(workbook_id).await;
            }
            sync.running.set(false);
        }));
    }

    /// Answer the question about a workbook: reload it from disk, keep the version of the app, or no answer, e.g. when
    /// the question failed. An answer to an older question is ignored.
    pub fn answer(&self, workbook_id: &str, prompt: u32, reload: Option<bool>) {
        let waiting = {
            let mut waiting = self.waiting.borrow_mut();
            match waiting.get(workbook_id) {
                Some(question) if question.prompt == prompt => waiting.remove(workbook_id),
                _ => None,
            }
        };
        if let Some(waiting) = waiting {
            waiting.answer.send(reload);
        }
    }

    /// Stop checking, the questions that wait end without an answer
    pub fn destroy(&self) {
        self.destroyed.set(true);
        self.queue.borrow_mut().clear();
        let waiting = std::mem::take(&mut *self.waiting.borrow_mut());
        drop(waiting);
    }

    /// Ask the app about a workbook that changed on disk and wait for the answer, none without one
    async fn ask(&self, workbook_id: &str, pending_writes: bool) -> Option<bool> {
        let prompt = self.prompts.get() + 1;
        self.prompts.set(prompt);
        let (answer, receiver) = oneshot();
        self.waiting.borrow_mut().insert(workbook_id.to_string(), Waiting { prompt, answer });
        self.storage.ask(workbook_id, prompt, pending_writes);
        self.platform.changed(Slice::Storage, true);
        let answer = receiver.await.flatten();
        self.storage.answered(workbook_id);
        self.platform.changed(Slice::Storage, true);
        answer
    }

    /// The keys of the pending writes that a reload replaces
    fn reloaded_pending(&self, workbook_id: &str) -> Vec<String> {
        self.workbooks
            .persistence
            .pending_keys_for_workbook(workbook_id)
            .into_iter()
            .filter(|key| is_reloaded_key(key, workbook_id))
            .collect()
    }

    /// The latest generation of the writes that a reload replaces
    fn reloaded_generation(&self, workbook_id: &str) -> u64 {
        let Some(writer) = self.workbooks.persistence.writer() else { return 0 };
        writer
            .write_generations_for_workbook(workbook_id)
            .into_iter()
            .filter(|(key, _)| is_reloaded_key(key, workbook_id))
            .map(|(_, generation)| generation)
            .max()
            .unwrap_or(0)
    }

    /// Check the folder of a workbook, its writes are held meanwhile. A workbook of the storage root is left alone.
    async fn check_workbook(self: &Rc<Self>, workbook_id: String) {
        let Some(folder) = self.platform.workbook_folder(&workbook_id) else {
            return;
        };
        let Some(writer) = self.workbooks.persistence.writer().cloned() else { return };
        writer.hold(Some(&workbook_id), HoldReason::Reload);
        let mut created = Vec::new();
        let mut registered = false;
        let checked = self.check_folder(&workbook_id, &folder, &mut created, &mut registered).await;
        match &checked {
            // The disk and the app agree again, a write that found a changed file may run
            Ok(Checked::Settled) => writer.release_all(Some(&workbook_id), HoldReason::ExternalChange),
            Ok(Checked::Busy) => {
                // Another task holds the workbook, the check runs again in a moment instead of asking
                let sync = self.clone();
                let sleep = self.platform.sleep(BUSY_RETRY_MS);
                let retried = workbook_id.clone();
                self.platform.spawn(Box::pin(async move {
                    sleep.await;
                    sync.check(vec![retried]);
                }));
            }
            // A later check decides, it releases the hold then
            Ok(Checked::Pending) => {}
            Err(error) => {
                self.log(
                    LogLevel::Warn,
                    "failed to check the workbook folder",
                    &[("workbookId", workbook_id.as_str()), ("error", error.message())],
                );
            }
        }
        if !registered {
            // The connections of a reload that didn't happen leave the runtime again
            for connection_id in created {
                let _ = self.connections.apply(&connection_id, ConnectionAction::Delete, None);
            }
        }
        writer.release(Some(&workbook_id), HoldReason::Reload);
        self.platform.changed(Slice::Storage, true);
    }

    async fn check_folder(
        self: &Rc<Self>,
        workbook_id: &str,
        folder: &JsValue,
        created: &mut Vec<String>,
        registered: &mut bool,
    ) -> std::result::Result<Checked, HostError> {
        let Some(writer) = self.workbooks.persistence.writer().cloned() else { return Ok(Checked::Settled) };
        let stamps = writer.stamps().clone();
        // A write that started before the check must finish before the stable disk read
        writer.settle().await;
        let listing = listing_of(&call_method(folder, "stampFolder", &[]).await?);

        // Loading the workbook file mirrors the attachments of the folder for the embedded Hyper. The restore loaded it
        // already, later checks load it when the attachments changed.
        let mut workbook_file: Option<Value> = None;
        let attachments = attachment_listing(&listing);
        let previous = self.attachments.borrow().get(workbook_id).cloned();
        if previous.as_ref().is_some_and(|previous| *previous != attachments) {
            workbook_file = Some(self.load_workbook(workbook_id).await?);
            // The scripts read the mirrored attachments, the mount looks them up again and the workbook file lists them
            self.list_attachments(workbook_id);
        }
        // A change is remembered once it was handled, a failed read is retried by the next check
        self.attachments.borrow_mut().insert(workbook_id.to_string(), attachments);

        // The restore acknowledged the folder as it read it, the stamps of the app's own writes are recorded since. A
        // folder that was never acknowledged differs in every file and is compared with what the app shows.
        if stamps.changes(workbook_id, &listing).is_empty() {
            return Ok(Checked::Settled);
        }

        // A stamp differs, the scripts are read. A file that changes after its stamp was taken has a newer stamp than
        // the acknowledged one and is checked again.
        let scripts: Vec<RestoreScriptFile> = super::archives::items(
            self.platform.storage_await("loadScripts", &[JsValue::from_str(workbook_id)]).await?,
            "the scripts",
        )?;
        let workbook_file = match workbook_file {
            Some(file) => file,
            None => self.load_workbook(workbook_id).await?,
        };
        let stored_file = WorkbookData::from_json(&workbook_file);
        if scripts.is_empty() && !stored_file.scripts.is_empty() {
            // The scripts folder is gone or empty while the workbook file lists scripts, e.g. in the middle of a git
            // checkout or with files that a sync client keeps online. The check decides nothing now, a later one
            // reads the folder again: a reload would empty the workbook and write an empty script list.
            self.log(
                LogLevel::Warn,
                "the scripts of a workbook folder are missing, checking again later",
                &[("workbookId", workbook_id)],
            );
            return Ok(Checked::Pending);
        }
        let Some(stored) = self.resolve(&stored_file, &scripts, created)? else {
            return Ok(Checked::Settled);
        };
        let Some(workbook) = self.workbooks.get(workbook_id) else {
            return Ok(Checked::Settled);
        };
        let stored_name = stored_file.display_name().map(str::to_string);
        let stored_view = stored_file.default_view;
        let matches = {
            let stored =
                self.workbooks.stored_scripts(stored.scripts.clone()).map_err(|error| HostError::new(error.what()))?;
            match workbook.try_borrow() {
                Ok(workbook) => {
                    workbook.matches_stored_scripts(&stored)
                        && workbook.name() == stored_name.as_deref()
                        && workbook.default_view() == stored_view
                }
                // A workbook that another task holds is checked again, it is not taken as changed
                Err(_) => return Ok(Checked::Busy),
            }
        };
        if matches {
            // Only the stamps changed, or the disk changed to what the app shows
            stamps.acknowledge(workbook_id, &listing);
            return Ok(Checked::Settled);
        }

        let generation = self.reloaded_generation(workbook_id);
        let pending = !self.reloaded_pending(workbook_id).is_empty();
        let Some(mut reload) = self.ask(workbook_id, pending).await else {
            return Err(HostError::new("the change on disk was not answered"));
        };
        let mut discard = reload && pending;
        // The editor stays interactive while the question is open. A local edit during a question without pending
        // writes needs the question about discarding it as well.
        if reload && !pending && !self.reloaded_pending(workbook_id).is_empty() {
            let Some(answer) = self.ask(workbook_id, true).await else {
                return Err(HostError::new("the change on disk was not answered"));
            };
            reload = answer;
            discard = answer;
        }
        if !reload {
            // The version of the app wins, it replaces the version on disk
            stamps.acknowledge(workbook_id, &listing);
            self.write_kept_scripts(workbook_id, &scripts);
            return Ok(Checked::Settled);
        }
        if self.reloaded_generation(workbook_id) != generation {
            // The scripts changed while the question was open, the check starts over with a fresh read of the disk
            self.queue.borrow_mut().push_back(workbook_id.to_string());
            return Ok(Checked::Pending);
        }
        if discard {
            writer.cancel_pending_writes(&self.reloaded_pending(workbook_id));
        }
        stamps.acknowledge(workbook_id, &listing);

        // The connections that the workbook file brought along joined the runtime, the scripts use them now. Their
        // entries join the app manifest.
        *registered = true;
        for connection_id in created.iter() {
            let save = self.connections.save(connection_id.clone(), None);
            let sync = self.clone();
            let connection_id = connection_id.clone();
            self.platform.spawn(Box::pin(async move {
                if let Err(error) = save.await {
                    sync.log(
                        LogLevel::Warn,
                        "failed to save a connection of the workbook file",
                        &[("connectionId", connection_id.as_str()), ("error", error.what())],
                    );
                }
            }));
        }
        // Files that were added or removed outside the app change the script list
        if workbook_scripts_resolution_changed(&stored_file, &stored.workbook) {
            let task = WriteTask::WriteWorkbookScripts {
                workbook_id: workbook_id.to_string(),
                scripts: stored.workbook.scripts.clone(),
                connections: stored.workbook.connections.clone(),
            };
            drop(writer.write(task, DEBOUNCE_MS));
        }
        // A workbook that was removed while the question was open stays removed
        if self.workbooks.get(workbook_id).is_some() {
            self.workbooks
                .replace_from_storage(workbook_id, stored.scripts)
                .map_err(|error| HostError::new(error.what()))?;
            // The name and the default view on disk win as well
            self.workbooks
                .apply(workbook_id, WorkbookAction::RenameWorkbook { name: stored_name })
                .map_err(|error| HostError::new(error.what()))?;
            self.workbooks
                .apply(workbook_id, WorkbookAction::SetDefaultView { view: stored_view })
                .map_err(|error| HostError::new(error.what()))?;
            self.runs.describe_attachments();
        }
        self.log(LogLevel::Info, "reloaded externally changed workbook", &[("workbookId", workbook_id)]);
        Ok(Checked::Settled)
    }

    /// The workbook file of a workbook, migrated like every read of the runtime
    async fn load_workbook(&self, workbook_id: &str) -> std::result::Result<Value, HostError> {
        load_workbook(&self.platform, &self.storage.stamps, workbook_id).await
    }

    /// List the attachments of a workbook again, e.g. after files changed on disk
    fn list_attachments(self: &Rc<Self>, workbook_id: &str) {
        let sync = self.clone();
        let workbook_id = workbook_id.to_string();
        self.platform.spawn(Box::pin(async move {
            if let Err(error) =
                reconcile_attachments(&sync.platform, &sync.workbooks, &sync.runs, &workbook_id, &[]).await
            {
                sync.log(
                    LogLevel::Warn,
                    "Listing the attachments failed",
                    &[("workbookId", workbook_id.as_str()), ("error", error.message())],
                );
            }
        }));
    }

    /// Resolve the scripts of a folder like the restore does, against the connections of the runtime. Scripts on
    /// unknown connections run on the embedded Hyper, none without one.
    fn resolve(
        &self,
        workbook: &WorkbookData,
        scripts: &[RestoreScriptFile],
        created: &mut Vec<String>,
    ) -> std::result::Result<Option<StoredScripts>, HostError> {
        let (known, embedded) = {
            let registry = self.connections.registry.borrow();
            let mut known = Vec::new();
            let mut embedded = None;
            for (connection_id, connection) in registry.connections() {
                let Ok(state) = connection.state.try_borrow() else { continue };
                let params = state.params().to_value();
                if embedded.is_none() && is_hyper_wasm_connection(&state) {
                    embedded =
                        Some(ResolvedConnection { connection_id: connection_id.to_string(), params: params.clone() });
                }
                known.push(KnownConnection { connection_id: connection_id.to_string(), params });
            }
            (known, embedded)
        };
        let Some(embedded) = embedded else {
            return Ok(None);
        };
        let names: Vec<String> = scripts.iter().map(|script| nfc(&script.name)).collect();
        let sql_by_name: BTreeMap<String, &str> =
            names.iter().cloned().zip(scripts.iter().map(|script| script.sql.as_str())).collect();
        let mut resolver = RuntimeResolver { known, embedded, sync: self, created };
        let resolved =
            resolve_workbook_scripts(workbook, &names, &mut resolver).map_err(|error| HostError::new(error.what()))?;
        let scripts = resolved
            .scripts
            .into_iter()
            .map(|script| StoredScriptRef {
                sql: sql_by_name.get(&script.name).map(|sql| sql.to_string()).unwrap_or_default(),
                name: script.name,
                connection_id: script.connection.connection_id,
                unresolved_connection_id: script.unresolved_connection_id,
            })
            .collect();
        Ok(Some(StoredScripts { scripts, workbook: resolved.workbook }))
    }

    /// A connection of the runtime from the copy of a workbook file, active with the params of the copy
    fn create_connection(&self, connection_id: &str, copy: &WorkbookConnection) -> Result<ResolvedConnection> {
        let stored = RestoreConnection {
            connection_id: connection_id.to_string(),
            params: copy.params.clone(),
            params_draft: copy.params_draft.clone(),
            name: copy.name.clone(),
        };
        let host = JsStorage { platform: self.platform.clone(), state: self.storage.clone() };
        let catalog = dashql_core_runtime::workbook::new_catalog();
        let state = connection_state(&host, &stored, catalog)?;
        let params = state.params().to_value();
        let connection_id = self.connections.adopt(state)?;
        Ok(ResolvedConnection { connection_id, params })
    }

    /// Keep the scripts of the app over the disk: the scripts that differ on disk are written again. Files that only
    /// exist on disk are left alone.
    fn write_kept_scripts(&self, workbook_id: &str, disk: &[RestoreScriptFile]) {
        let Some(workbook) = self.workbooks.get(workbook_id) else { return };
        let scripts: Vec<(String, String)> = match workbook.try_borrow() {
            Ok(workbook) => {
                workbook.scripts().iter().map(|script| (script.file_name().to_string(), script.text())).collect()
            }
            Err(_) => return,
        };
        for (file_name, text) in scripts {
            if disk.iter().any(|script| script.name == file_name && script.sql == text) {
                continue;
            }
            let task = WriteTask::WriteScript { workbook_id: workbook_id.to_string(), file_name, text };
            self.workbooks.persistence.write(task, DEBOUNCE_MS);
        }
    }
}
