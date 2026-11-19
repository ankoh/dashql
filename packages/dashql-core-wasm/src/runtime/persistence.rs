//! Where the runtime keeps its workbooks: the storage writer over the storage of the platform, or nothing.
//!
//! A runtime on a platform without storage, e.g. an embed in a frame without the origin private file system or the
//! shell, keeps nothing: the effects of the actions of the workbooks are dropped, the commands of the storage resolve at
//! once, and a workbook enters the runtime by an import into memory. The workbooks name their effects here, the storage
//! writer and its tasks stay behind this module; the services that are about the storage itself (the restore, the
//! imports into storage, the changes of native folders) ask for the writer and do nothing without one.

use std::future::Future;
use std::pin::Pin;

use dashql_core_runtime::host::HostError;
use dashql_core_runtime::workbook::WorkbookEffect;
use dashql_core_storage::storage::keys::workbook_connection_copy_key;
use dashql_core_storage::storage::{FailedWrite, HoldReason, WriteResult, WriteTask};
use dashql_core_storage::workbook_format::data::{WorkbookCloudLink as StoredCloudLink, WorkbookConnection, WorkbookScript};
use serde_json::Value;

use super::storage::RuntimeWriter;

/// The debounce of the writes of the workbooks
const DEBOUNCE_MS: f64 = 100.0;

/// A future of the persistence
pub(crate) type PersistenceFuture<T> = Pin<Box<dyn Future<Output = T>>>;

/// Where the runtime keeps its workbooks
#[derive(Clone)]
pub(crate) enum Persistence {
    /// The storage writer over the storage of the platform
    Writer(RuntimeWriter),
    /// Nothing is kept, the platform has no storage
    None,
}

/// The copy of a connection in a workbook file, its params as JSON text
pub(crate) fn connection_copy(connection_id: &str, params: Option<&str>) -> WorkbookConnection {
    let params = params.and_then(|params| serde_json::from_str::<Value>(params).ok()).unwrap_or(Value::Null);
    WorkbookConnection::new(connection_id, params)
}

/// A workbook to write, `Persistence::create_workbook`
pub(crate) struct CreatedWorkbook {
    pub workbook_id: String,
    pub name: Option<String>,
    /// The connection of its first script, its id and its params as JSON text
    pub connection: (String, Option<String>),
    pub ephemeral: bool,
    pub original_file_name: Option<String>,
}

impl Persistence {
    /// The storage writer, none without storage
    pub fn writer(&self) -> Option<&RuntimeWriter> {
        match self {
            Persistence::Writer(writer) => Some(writer),
            Persistence::None => None,
        }
    }

    /// Does the runtime keep its workbooks?
    pub fn keeps(&self) -> bool {
        self.writer().is_some()
    }

    /// Schedule a write of the storage, nothing without storage
    pub fn write(&self, key: &str, task: WriteTask, debounce_ms: f64) {
        if let Some(writer) = self.writer() {
            drop(writer.write(key, task, debounce_ms));
        }
    }

    /// Write at once and tell the outcome, none without storage
    pub fn write_durable(&self, key: &str, task: WriteTask) -> Option<WriteResult> {
        self.writer().map(|writer| writer.write_durable(key, task))
    }

    /// Write a new workbook: the workbook file right away, the later writes of the file wait for it
    pub fn create_workbook(&self, created: CreatedWorkbook) {
        let (connection_id, params) = created.connection;
        let task = WriteTask::CreateWorkbook {
            workbook_id: created.workbook_id,
            name: created.name,
            connection: Some(connection_copy(&connection_id, params.as_deref())),
            ephemeral: created.ephemeral,
            original_file_name: created.original_file_name,
        };
        self.write(&task.key(), task, 0.0);
    }

    /// Rename the file of an attachment at once and tell the outcome, none without storage
    pub fn rename_data_file(&self, workbook_id: &str, from: String, to: String) -> Option<WriteResult> {
        let task = WriteTask::RenameDataFile { workbook_id: workbook_id.to_string(), from, to };
        self.write_durable(&task.key(), task)
    }

    /// Schedule the writes of the effects of an action of a workbook, in order. `cloud` is the whole link to a cloud
    /// that the metadata of the workbook keeps, the workbook file holds it while the workbook has an origin.
    pub fn workbook_effects(&self, workbook_id: &str, effects: Vec<WorkbookEffect>, cloud: Option<&Value>) {
        if !self.keeps() {
            return;
        }
        for effect in effects {
            // A task names its key (`storage::keys`)
            let task = match effect {
                WorkbookEffect::WriteScript { file_name, text } => WriteTask::WriteScript { workbook_id: workbook_id.to_string(), file_name, text },
                WorkbookEffect::DeleteScript { file_name } => WriteTask::DeleteScript { workbook_id: workbook_id.to_string(), file_name },
                WorkbookEffect::RenameScript { from, to } => WriteTask::RenameScript { workbook_id: workbook_id.to_string(), from, to },
                WorkbookEffect::RenameDataFile { from, to } => {
                    drop(self.rename_data_file(workbook_id, from, to));
                    continue;
                }
                WorkbookEffect::WriteScriptList(list) => WriteTask::WriteWorkbookScripts {
                    workbook_id: workbook_id.to_string(),
                    scripts: list.scripts.iter().map(|s| WorkbookScript::new(s.name.clone(), s.connection_id.clone())).collect(),
                    connections: list.connections.iter().map(|c| connection_copy(&c.connection_id, Some(&c.params))).collect(),
                },
                WorkbookEffect::WriteProperties { name, ephemeral, origin } => {
                    let link = cloud.and_then(StoredCloudLink::from_json);
                    WriteTask::WriteWorkbookProperties { workbook_id: workbook_id.to_string(), name, ephemeral, cloud: origin.and(link) }
                }
                WorkbookEffect::PatchConnection { connection_id, params, replaces } => {
                    for from in replaces {
                        let task = WriteTask::PatchWorkbookConnection {
                            workbook_id: workbook_id.to_string(),
                            copy: connection_copy(&connection_id, params.as_deref()),
                            replaced: vec![from.clone()],
                        };
                        self.write(&workbook_connection_copy_key(workbook_id, &from), task, DEBOUNCE_MS);
                    }
                    continue;
                }
            };
            self.write(&task.key(), task, DEBOUNCE_MS);
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

    /// Delete the files of a workbook, nothing to delete without storage
    pub fn delete_workbook(&self, workbook_id: &str) -> PersistenceFuture<Result<(), HostError>> {
        match self.writer() {
            Some(writer) => Box::pin(writer.delete_workbook(workbook_id)),
            None => Box::pin(std::future::ready(Ok(()))),
        }
    }
}
