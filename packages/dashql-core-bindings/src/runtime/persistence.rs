//! Where the runtime keeps its workbooks: the storage writer over the storage of the platform, or memory.
//!
//! A runtime on a platform without storage, e.g. an embed in a frame without the origin private file system or the
//! shell, keeps its workbooks in memory: the effects of their actions are dropped, the commands of the storage resolve at
//! once, and a workbook enters the runtime by an import into memory. Memory keeps one thing that the state of a workbook
//! doesn't hold, the files of its attachments, by handle until the workbook goes; the embedded Hyper mounts them from
//! there (`Persistence::attachments`). The workbooks name their effects here, the storage writer and its tasks stay
//! behind this module; the services that are about the storage itself (the restore, the imports into storage, the
//! changes of native folders) ask for the writer and do nothing without one.

use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

use dashql_core_runtime::connections::ConnectionParams;
use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::HostError;
use dashql_core_runtime::workbook::WorkbookEffect;
use dashql_core_storage::storage::{FailedWrite, HoldReason, WriteResult, WriteTask};
use dashql_core_storage::workbook_format::data::{
    WorkbookCloudLink as StoredCloudLink, WorkbookConnection, WorkbookScript,
};
use js_sys::{Array, Object, Reflect};
use serde_json::Value;
use wasm_bindgen::JsValue;

use super::archives::HostFile;
use super::storage::RuntimeWriter;
use crate::host::JsPlatform;

/// The debounce of the writes of the workbooks
const DEBOUNCE_MS: f64 = 100.0;

/// A future of the persistence
pub(crate) type PersistenceFuture<T> = Pin<Box<dyn Future<Output = T>>>;

/// Where the runtime keeps its workbooks
#[derive(Clone)]
pub(crate) enum Persistence {
    /// The storage writer over the storage of the platform
    Writer(RuntimeWriter),
    /// Memory, the platform has no storage
    Memory(Rc<MemoryFiles>),
}

/// A file of an attachment in memory: its file name and the handle of its Blob or bytes
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MemoryFile {
    pub file_name: String,
    pub handle: Handle,
    pub size: u64,
}

/// The attachments of a workbook as the mounts of the platform take them (`RuntimeMounts.attachments`): null for the
/// folder of the workbook in the storage, else the files in memory as `{ fileName, file }` with the handle of each file
pub(crate) fn attachments_value(files: Option<Vec<MemoryFile>>) -> JsValue {
    let Some(files) = files else { return JsValue::NULL };
    let list = Array::new();
    for file in files {
        let entry = Object::new();
        let _ = Reflect::set(&entry, &JsValue::from_str("fileName"), &JsValue::from_str(&file.file_name));
        let _ = Reflect::set(&entry, &JsValue::from_str("file"), &JsValue::from_f64(file.handle as f64));
        list.push(&entry);
    }
    list.into()
}

/// The files of the attachments of the workbooks in memory, by handle. A workbook keeps its own handles of the files,
/// released when the workbook goes or is replaced.
pub(crate) struct MemoryFiles {
    platform: JsPlatform,
    workbooks: RefCell<Vec<(String, Vec<MemoryFile>)>>,
}

impl MemoryFiles {
    pub fn new(platform: JsPlatform) -> Self {
        Self { platform, workbooks: RefCell::new(Vec::new()) }
    }

    /// Keep the files of a workbook, in place of those it had: every file gets a handle of its own
    pub fn keep(&self, workbook_id: &str, files: &[(String, HostFile)]) -> Result<(), HostError> {
        let mut kept: Vec<MemoryFile> = Vec::with_capacity(files.len());
        for (file_name, file) in files {
            match self.platform.duplicate(file.handle) {
                Ok(handle) => kept.push(MemoryFile { file_name: file_name.clone(), handle, size: file.size }),
                Err(error) => {
                    self.release(kept);
                    return Err(error);
                }
            }
        }
        self.forget(workbook_id);
        self.workbooks.borrow_mut().push((workbook_id.to_string(), kept));
        Ok(())
    }

    /// The files of a workbook, none for a workbook that has none in memory
    pub fn files(&self, workbook_id: &str) -> Option<Vec<MemoryFile>> {
        self.workbooks.borrow().iter().find(|(id, _)| id == workbook_id).map(|(_, files)| files.clone())
    }

    /// A file of a workbook was renamed
    pub fn rename(&self, workbook_id: &str, from: &str, to: &str) {
        let mut workbooks = self.workbooks.borrow_mut();
        let Some((_, files)) = workbooks.iter_mut().find(|(id, _)| id == workbook_id) else { return };
        if let Some(file) = files.iter_mut().find(|file| file.file_name == from) {
            file.file_name = to.to_string();
        }
    }

    /// A workbook went or is replaced, its files are released
    pub fn forget(&self, workbook_id: &str) {
        let removed = {
            let mut workbooks = self.workbooks.borrow_mut();
            let position = workbooks.iter().position(|(id, _)| id == workbook_id);
            position.map(|position| workbooks.remove(position).1)
        };
        if let Some(files) = removed {
            self.release(files);
        }
    }

    fn release(&self, files: Vec<MemoryFile>) {
        for file in files {
            self.platform.release_handle(file.handle);
        }
    }
}

impl Drop for MemoryFiles {
    fn drop(&mut self) {
        let workbooks = std::mem::take(&mut *self.workbooks.borrow_mut());
        for (_, files) in workbooks {
            self.release(files);
        }
    }
}

/// The copy of a connection in a workbook file, null params for a connection without
pub(crate) fn connection_copy(connection_id: &str, params: Option<&ConnectionParams>) -> WorkbookConnection {
    WorkbookConnection::new(connection_id, params.map_or(Value::Null, ConnectionParams::to_value))
}

/// A workbook to write, `Persistence::create_workbook`
pub(crate) struct CreatedWorkbook {
    pub workbook_id: String,
    pub name: Option<String>,
    /// The connection of its first script, its id and its params
    pub connection: (String, Option<ConnectionParams>),
    pub ephemeral: bool,
    pub original_file_name: Option<String>,
}

impl Persistence {
    /// The storage writer, none without storage
    pub fn writer(&self) -> Option<&RuntimeWriter> {
        match self {
            Persistence::Writer(writer) => Some(writer),
            Persistence::Memory(_) => None,
        }
    }

    /// The files in memory, none with storage
    pub fn memory(&self) -> Option<&Rc<MemoryFiles>> {
        match self {
            Persistence::Writer(_) => None,
            Persistence::Memory(files) => Some(files),
        }
    }

    /// Where the embedded Hyper finds the attachments of a workbook: none for the folder of the workbook in the
    /// storage, else the files in memory
    pub fn attachments(&self, workbook_id: &str) -> Option<Vec<MemoryFile>> {
        self.memory().map(|memory| memory.files(workbook_id).unwrap_or_default())
    }

    /// A workbook went or is replaced, what memory keeps of it goes
    pub fn forget_workbook(&self, workbook_id: &str) {
        if let Some(memory) = self.memory() {
            memory.forget(workbook_id);
        }
    }

    /// Does the runtime keep its workbooks?
    pub fn keeps(&self) -> bool {
        self.writer().is_some()
    }

    /// Schedule a write of the storage, nothing without storage
    pub fn write(&self, task: WriteTask, debounce_ms: f64) {
        if let Some(writer) = self.writer() {
            drop(writer.write(task, debounce_ms));
        }
    }

    /// Write at once and tell the outcome, none without storage
    pub fn write_durable(&self, task: WriteTask) -> Option<WriteResult> {
        self.writer().map(|writer| writer.write_durable(task))
    }

    /// Write a new workbook: the workbook file right away, the later writes of the file wait for it
    pub fn create_workbook(&self, created: CreatedWorkbook) {
        let (connection_id, params) = created.connection;
        let task = WriteTask::CreateWorkbook {
            workbook_id: created.workbook_id,
            name: created.name,
            connection: Some(connection_copy(&connection_id, params.as_ref())),
            ephemeral: created.ephemeral,
            original_file_name: created.original_file_name,
        };
        self.write(task, 0.0);
    }

    /// Rename the file of an attachment at once and tell the outcome. In memory the file is renamed and there is no
    /// write.
    pub fn rename_data_file(&self, workbook_id: &str, from: String, to: String) -> Option<WriteResult> {
        if let Some(memory) = self.memory() {
            memory.rename(workbook_id, &from, &to);
            return None;
        }
        let task = WriteTask::RenameDataFile { workbook_id: workbook_id.to_string(), from, to };
        self.write_durable(task)
    }

    /// Schedule the writes of the effects of an action of a workbook, in order. `cloud` is the whole link to a cloud
    /// that the metadata of the workbook keeps, the workbook file holds it while the workbook has an origin.
    pub fn workbook_effects(&self, workbook_id: &str, effects: Vec<WorkbookEffect>, cloud: Option<&Value>) {
        // Memory keeps the files of the attachments, the rest is the state of the workbook
        if let Some(memory) = self.memory() {
            for effect in effects {
                if let WorkbookEffect::RenameDataFile { from, to } = effect {
                    memory.rename(workbook_id, &from, &to);
                }
            }
            return;
        }
        for effect in effects {
            // A task names its key (`storage::keys`)
            let task = match effect {
                WorkbookEffect::WriteScript { file_name, text } => {
                    WriteTask::WriteScript { workbook_id: workbook_id.to_string(), file_name, text }
                }
                WorkbookEffect::DeleteScript { file_name } => {
                    WriteTask::DeleteScript { workbook_id: workbook_id.to_string(), file_name }
                }
                WorkbookEffect::RenameScript { from, to } => {
                    WriteTask::RenameScript { workbook_id: workbook_id.to_string(), from, to }
                }
                WorkbookEffect::RenameDataFile { from, to } => {
                    drop(self.rename_data_file(workbook_id, from, to));
                    continue;
                }
                WorkbookEffect::WriteScriptList(list) => WriteTask::WriteWorkbookScripts {
                    workbook_id: workbook_id.to_string(),
                    scripts: list
                        .scripts
                        .iter()
                        .map(|s| WorkbookScript::new(s.name.clone(), s.connection_id.clone()))
                        .collect(),
                    connections: list
                        .connections
                        .iter()
                        .map(|c| connection_copy(&c.connection_id, Some(&c.params)))
                        .collect(),
                },
                WorkbookEffect::WriteProperties { name, default_view, ephemeral, origin } => {
                    let link = cloud.and_then(StoredCloudLink::from_json);
                    WriteTask::WriteWorkbookProperties {
                        workbook_id: workbook_id.to_string(),
                        name,
                        default_view,
                        ephemeral,
                        cloud: origin.and(link),
                    }
                }
                WorkbookEffect::PatchConnection { connection_id, params, replaces } => {
                    for from in replaces {
                        let task = WriteTask::PatchWorkbookConnection {
                            workbook_id: workbook_id.to_string(),
                            copy: connection_copy(&connection_id, params.as_ref()),
                            replaced: vec![from.clone()],
                        };
                        self.write(task, DEBOUNCE_MS);
                    }
                    continue;
                }
            };
            self.write(task, DEBOUNCE_MS);
        }
    }

    /// Hold the writes of the writer or of a workbook for a reason
    pub fn hold(&self, workbook_id: Option<&str>, reason: HoldReason) {
        if let Some(writer) = self.writer() {
            writer.hold(workbook_id, reason);
        }
    }

    /// Release one hold of a reason
    pub fn release(&self, workbook_id: Option<&str>, reason: HoldReason) {
        if let Some(writer) = self.writer() {
            writer.release(workbook_id, reason);
        }
    }

    /// Discard the pending writes of keys and their failures
    pub fn cancel_pending_writes(&self, keys: &[String]) {
        if let Some(writer) = self.writer() {
            writer.cancel_pending_writes(keys);
        }
    }

    /// Are the writes of a workbook held? Never without storage.
    pub fn is_workbook_held(&self, workbook_id: &str) -> bool {
        self.writer().is_some_and(|writer| writer.is_workbook_held(workbook_id))
    }

    /// The writes of a workbook that failed
    pub fn failed_writes_for_workbook(&self, workbook_id: &str) -> Vec<FailedWrite> {
        self.writer().map(|writer| writer.failed_writes_for_workbook(workbook_id)).unwrap_or_default()
    }

    /// The keys of the pending writes of a workbook
    pub fn pending_keys_for_workbook(&self, workbook_id: &str) -> Vec<String> {
        self.writer().map(|writer| writer.pending_keys_for_workbook(workbook_id)).unwrap_or_default()
    }

    /// Write what is pending, at once without storage
    pub fn flush(&self) -> PersistenceFuture<()> {
        match self.writer() {
            Some(writer) => Box::pin(writer.flush()),
            None => Box::pin(std::future::ready(())),
        }
    }

    /// Wait until no write runs, at once without storage
    pub fn settle(&self) -> PersistenceFuture<()> {
        match self.writer() {
            Some(writer) => Box::pin(writer.settle()),
            None => Box::pin(std::future::ready(())),
        }
    }

    /// Write the scripts that a hold keeps, e.g. while the window closes
    pub fn recover_held_scripts(&self) -> PersistenceFuture<()> {
        match self.writer() {
            Some(writer) => Box::pin(writer.recover_held_scripts()),
            None => Box::pin(std::future::ready(())),
        }
    }

    /// Write what is pending and write nothing more, another tab takes over
    pub fn hand_over(&self) -> PersistenceFuture<()> {
        match self.writer() {
            Some(writer) => Box::pin(writer.hand_over()),
            None => Box::pin(std::future::ready(())),
        }
    }

    /// Write what is pending of a workbook, resolves whether every write reached the storage. Without storage nothing
    /// is pending.
    pub fn flush_workbook(&self, workbook_id: &str) -> PersistenceFuture<bool> {
        match self.writer() {
            Some(writer) => Box::pin(writer.flush_workbook(workbook_id)),
            None => Box::pin(std::future::ready(true)),
        }
    }

    /// Delete the files of a workbook, in memory they go with the workbook
    pub fn delete_workbook(&self, workbook_id: &str) -> PersistenceFuture<Result<(), HostError>> {
        match self.writer() {
            Some(writer) => Box::pin(writer.delete_workbook(workbook_id)),
            None => {
                self.forget_workbook(workbook_id);
                Box::pin(std::future::ready(Ok(())))
            }
        }
    }
}
