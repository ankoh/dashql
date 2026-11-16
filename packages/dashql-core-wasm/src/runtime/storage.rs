//! The storage of the runtime: the storage writer of the crate and the restore over `storage` of the platform
//! (docs/wip/runtime_api.md).
//!
//! `JsStorage` is the host of the writer and of the restore over the platform object: every storage operation is a call
//! of `storage` of the platform, the clock, the timers and the log are the ones of the platform. What the writer tells
//! its host is state of the runtime: the holds and the failed writes are the `storage` view, the statistics of the keys
//! are read from the writer when the app shows them (`storageStatistics`), they change with every write. A rejected
//! call fails the write with the value the platform rejected with, the outcome of a write hands it back.

pub(crate) mod restore_view;
pub(crate) mod view;

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::rc::Rc;

use dashql_core_runtime::attachments::DataFile;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::HostBytes;
use dashql_core_runtime::restore::{RestoreHost, RestoreProgress};
use dashql_core_runtime::storage::{ConnectionsUpdate, StorageHost, StorageWriter, WriteOutcome, WriterStatus};
use dashql_core_runtime::workbook::next_revision;
use dashql_core_runtime::workbook_format::data::WORKBOOK_FORMAT_VERSION;
use js_sys::{Array, Function, Reflect};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tsify::Tsify;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use crate::host::{message_of, JsPlatform};
use crate::runtime::migrations::migrate_workbook_folder;
use crate::runtime::workbooks::view::WorkbookDataFile;
use crate::views::{to_js, JsonValue};
use restore_view::{RestoreProgress as ProgressView, RestoreScriptFile};
use view::{FailedStorageWriteView, StorageHoldView, StorageWriteOutcome};

/// The storage writer of the runtime
pub(crate) type RuntimeWriter = StorageWriter<JsStorage>;

/// A string field of a JS value
fn string_field(value: &JsValue, name: &str) -> Option<String> {
    if !value.is_object() {
        return None;
    }
    Reflect::get(value, &JsValue::from_str(name)).ok().and_then(|v| v.as_string())
}

/// A host error that keeps what the storage failed with. A script that changed outside the app is named by the error.
pub(crate) fn host_error(value: JsValue) -> HostError {
    let error = if string_field(&value, "name").as_deref() == Some("ExternalScriptChangeError") {
        let workbook_id = string_field(&value, "workbookId").unwrap_or_default();
        let file_name = string_field(&value, "fileName").unwrap_or_default();
        HostError::external_script_change(workbook_id, file_name)
    } else {
        HostError::new(message_of(&value))
    };
    error.with_value(Rc::new(value))
}

/// What a host error hands back to JS: the value the host failed with, or an error with its message
pub(crate) fn error_value(error: &HostError) -> JsValue {
    error
        .value()
        .and_then(|value| value.downcast_ref::<JsValue>())
        .cloned()
        .unwrap_or_else(|| JsError::new(error.message()).into())
}

/// The outcome of a write for JS
pub(crate) fn outcome_value(outcome: WriteOutcome) -> Result<JsValue, JsValue> {
    to_js(&StorageWriteOutcome::from(outcome)).map(JsValue::from).map_err(JsValue::from)
}

/// What the writer told its host, the `storage` view
#[derive(Default)]
pub(crate) struct StorageState {
    /// The holds and the failed writes, as the writer told them last
    status: RefCell<WriterStatus>,
    /// Changes with every change of the view
    revision: Cell<u64>,
    /// Hears the progress of the restore that runs
    progress: RefCell<Option<Function>>,
    /// The workbooks that changed outside the app and wait for the answer of the user, in the order they were asked
    questions: RefCell<Vec<ExternalChangeView>>,
}

impl StorageState {
    /// The revision of the view
    pub fn revision(&self) -> u64 {
        self.revision.get()
    }

    /// The view of the storage
    pub fn view(&self) -> StorageView {
        let status = self.status.borrow();
        StorageView {
            held_workbooks: status.externally_changed().map(str::to_string).collect(),
            holds: status.holds.iter().map(StorageHoldView::from).collect(),
            failed_writes: status.failed.iter().map(FailedStorageWriteView::from).collect(),
            external_changes: self.questions.borrow().clone(),
        }
    }

    /// Ask about a workbook that changed outside the app, a question about it replaces the one before
    pub fn ask(&self, workbook_id: &str, prompt: u32, pending_writes: bool) {
        let mut questions = self.questions.borrow_mut();
        questions.retain(|question| question.workbook_id != workbook_id);
        questions.push(ExternalChangeView { workbook_id: workbook_id.to_string(), prompt, pending_writes });
        self.revision.set(next_revision());
    }

    /// The question about a workbook was answered
    pub fn answered(&self, workbook_id: &str) {
        let mut questions = self.questions.borrow_mut();
        let before = questions.len();
        questions.retain(|question| question.workbook_id != workbook_id);
        if questions.len() != before {
            self.revision.set(next_revision());
        }
    }


    /// Hear the progress of the restore that runs, none stops
    pub fn set_progress(&self, listener: Option<Function>) {
        *self.progress.borrow_mut() = listener;
    }
}

/// The storage of the runtime: what holds the writes, the writes that failed, and the questions about workbook folders
/// that changed outside the app
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StorageView {
    /// The workbooks whose writes are held because one of their files changed outside the app
    pub held_workbooks: Vec<String>,
    /// The holds of the writer (no workbook) and of the workbooks, with their reasons
    pub holds: Vec<StorageHoldView>,
    /// The writes that failed and run again after a backoff, with their last errors
    pub failed_writes: Vec<FailedStorageWriteView>,
    /// The workbooks whose scripts changed on disk, the app asks the user whether to reload them
    /// (`answerExternalChange`)
    pub external_changes: Vec<ExternalChangeView>,
}

/// A question about a workbook folder whose scripts changed outside the app
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ExternalChangeView {
    pub workbook_id: String,
    /// The number of the question, the answer names it. A second question about the same change has a new number.
    pub prompt: u32,
    /// Does the app hold writes of the scripts that a reload discards?
    pub pending_writes: bool,
}

/// A command of the storage writer that waits for writes. The commands that change the writer right away are methods
/// of the runtime (`storageHold`, `storageRelease`, `storageReviveWorkbook`, `storageCancelPendingWrites`).
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum StorageCommand {
    /// Run every pending write right away and wait until all writes ended. Writes past a hold of the writer, never
    /// past a hold of a workbook.
    Flush,
    /// Wait for the writes that started, without running the pending ones
    Settle,
    /// Write the pending writes of a workbook and wait for them, resolves whether every write reached the storage
    FlushWorkbook { workbook_id: String },
    /// Delete a workbook from the storage, its pending writes are discarded. Rejects with what the storage failed with.
    DeleteWorkbook { workbook_id: String },
}

/// The host of the writer and the restore over `storage` of the platform
#[derive(Clone)]
pub(crate) struct JsStorage {
    pub platform: JsPlatform,
    pub state: Rc<StorageState>,
}

impl JsStorage {
    /// Call a member of the storage and await it
    fn call(&self, name: &str, args: &[JsValue]) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        let call = self.platform.storage_call(name, args);
        async move {
            let value = call?;
            wasm_bindgen_futures::JsFuture::from(js_sys::Promise::resolve(&value)).await.map_err(host_error)
        }
    }

}

impl Host for JsStorage {
    fn now(&self) -> f64 {
        self.platform.now()
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        self.platform.sleep(ms)
    }

    fn spawn(&self, task: LocalTask) {
        self.platform.spawn(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, "storage_writer");
    }
}

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

impl JsStorage {
    /// The workbook file of a workbook as the storage holds it
    async fn load_workbook_file(&self, workbook_id: &str) -> Result<Value, HostError> {
        let workbook = self.call("loadWorkbook", &[text(workbook_id)]).await?;
        if workbook.is_null() || workbook.is_undefined() {
            return Err(HostError::new(format!("the workbook file of {workbook_id} is missing")));
        }
        Ok(JsonValue::of(&workbook).0)
    }
}

impl StorageHost for JsStorage {
    /// A workbook in a folder of its own that an older version of the app wrote, e.g. a native folder after a checkout
    /// of an older commit, is brought to the current workbook format before its workbook file is read. The format
    /// version of the file decides on every load, a current file is read once. The folders of the storage root were
    /// migrated with the storage.
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        let loaded = self.load_workbook_file(workbook_id).await;
        let current = loaded.as_ref().is_ok_and(|workbook| workbook.get("formatVersion").and_then(Value::as_i64).is_some_and(|version| version >= WORKBOOK_FORMAT_VERSION));
        if current || self.platform.workbook_folder(workbook_id).is_none() {
            return loaded;
        }
        migrate_workbook_folder(&self.platform, workbook_id).await?;
        self.load_workbook_file(workbook_id).await
    }

    async fn save_workbook(&self, workbook_id: &str, workbook: &Value) -> Result<(), HostError> {
        let workbook = JsonValue(workbook.clone()).to_js().map_err(|e| HostError::new(e.to_string()))?;
        self.call("saveWorkbook", &[text(workbook_id), workbook]).await.map(|_| ())
    }

    async fn save_script(&self, workbook_id: &str, file_name: &str, script: &str) -> Result<(), HostError> {
        self.call("saveScript", &[text(workbook_id), text(file_name), text(script)]).await.map(|_| ())
    }

    async fn delete_script(&self, workbook_id: &str, file_name: &str) -> Result<(), HostError> {
        self.call("deleteScript", &[text(workbook_id), text(file_name)]).await.map(|_| ())
    }

    async fn rename_script(&self, workbook_id: &str, from: &str, to: &str) -> Result<(), HostError> {
        self.call("renameScript", &[text(workbook_id), text(from), text(to)]).await.map(|_| ())
    }

    async fn list_attachments(&self, workbook_id: &str) -> Result<Vec<String>, HostError> {
        let names = self.call("listAttachments", &[text(workbook_id)]).await?;
        if !Array::is_array(&names) {
            return Err(HostError::new(format!("the attachments of {workbook_id} are not a list")));
        }
        // The attachments in natural order
        let names: Vec<String> = Array::from(&names).iter().filter_map(|name| name.as_string()).collect();
        Ok(dashql_core_runtime::workbook_format::files::workbook_attachments(&names).into_iter().map(|attachment| attachment.name).collect())
    }

    async fn save_data_file(&self, workbook_id: &str, file_name: &str, file: &HostBytes) -> Result<(), HostError> {
        let file = file.value().downcast_ref::<JsValue>().cloned().ok_or_else(|| HostError::new(format!("the attachment {file_name} is no file of the host")))?;
        self.call("saveDataFile", &[text(workbook_id), text(file_name), file]).await.map(|_| ())
    }

    async fn update_connections(&self, mut update: ConnectionsUpdate) -> Result<(), HostError> {
        let closure = Closure::<dyn FnMut(JsValue) -> JsValue>::new(move |connections: JsValue| {
            let current = match JsonValue::of(&connections).0 {
                Value::Array(entries) => Some(entries),
                Value::Null => None,
                // Entries that the writer can't read stay as they are
                _ => return JsValue::NULL,
            };
            update(current).and_then(|next| JsonValue(Value::Array(next)).to_js().ok()).unwrap_or(JsValue::NULL)
        });
        let function: &Function = closure.as_ref().unchecked_ref();
        let result = self.call("updateConnections", &[function.clone().into()]).await;
        // The storage called the update before its promise settled
        drop(closure);
        result.map(|_| ())
    }

    async fn save_connection_file(&self, connection_id: &str, file_name: &str, content: &str) -> Result<(), HostError> {
        self.call("saveConnectionFile", &[text(connection_id), text(file_name), text(content)]).await.map(|_| ())
    }

    async fn delete_connection_files(&self, connection_id: &str) -> Result<(), HostError> {
        self.call("deleteConnectionFiles", &[text(connection_id)]).await.map(|_| ())
    }

    async fn delete_workbook(&self, workbook_id: &str) -> Result<(), HostError> {
        self.call("deleteWorkbook", &[text(workbook_id)]).await.map(|_| ())
    }

    fn status_changed(&self, status: &WriterStatus) {
        *self.state.status.borrow_mut() = status.clone();
        self.state.revision.set(next_revision());
        self.platform.changed(crate::runtime::changes::Slice::Storage, true);
    }
}

/// The views of a list that the storage handed over
fn items<T: serde::de::DeserializeOwned>(value: JsValue, what: &str) -> Result<Vec<T>, HostError> {
    serde_wasm_bindgen::from_value(value).map_err(|e| HostError::new(format!("{what} can't be read: {e}")))
}

impl RestoreHost for JsStorage {
    fn owns_connections(&self) -> bool {
        self.platform.storage_call("ownsConnections", &[]).is_ok_and(|owns| owns.is_truthy())
    }

    async fn list_workbooks(&self) -> Result<Vec<String>, HostError> {
        items(self.call("listWorkbooks", &[]).await?, "the workbooks")
    }

    async fn load_manifest_connections(&self) -> Result<Option<Vec<Value>>, HostError> {
        match JsonValue::of(&self.call("loadManifestConnections", &[]).await?).0 {
            Value::Array(entries) => Ok(Some(entries)),
            _ => Ok(None),
        }
    }

    async fn load_scripts(&self, workbook_id: &str) -> Result<Vec<(String, String)>, HostError> {
        let scripts: Vec<RestoreScriptFile> = items(self.call("loadScripts", &[text(workbook_id)]).await?, "the scripts")?;
        Ok(scripts.into_iter().map(|script| (script.name, script.sql)).collect())
    }

    async fn list_data_files(&self, workbook_id: &str) -> Result<Vec<DataFile>, HostError> {
        let files: Vec<WorkbookDataFile> = items(self.call("listDataFiles", &[text(workbook_id)]).await?, "the data files")?;
        Ok(files.into_iter().map(DataFile::from).collect())
    }

    async fn load_connection_file(&self, connection_id: &str, file_name: &str) -> Result<Option<String>, HostError> {
        Ok(self.call("loadConnectionFile", &[text(connection_id), text(file_name)]).await?.as_string())
    }

    fn restore_progress(&self, progress: &RestoreProgress) {
        let listener = self.state.progress.borrow().clone();
        if let (Some(listener), Ok(progress)) = (listener, to_js(&ProgressView::from(progress))) {
            let _ = listener.call1(&JsValue::NULL, &progress.into());
        }
    }
}
