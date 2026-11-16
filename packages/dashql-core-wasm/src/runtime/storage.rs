//! The storage of the runtime: the storage writer of the crate and the restore over `storage` of the platform
//! (docs/wip/runtime_api.md).
//!
//! `JsStorage` is the host of the writer and of the restore over the platform object: every storage operation is a call
//! of `storage` of the platform, the clock, the timers and the log are the ones of the platform. What the writer tells
//! its host is state of the runtime: the host reads the workbooks that a change outside the app holds as the `storage`
//! view, and the statistics of the keys when it shows them (`storageStatistics`), they change with every write. A rejected call fails the write with the value the platform rejected with, the
//! outcome of a write hands it back.

pub(crate) mod restore_view;
pub(crate) mod view;

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::rc::Rc;

use dashql_core_runtime::attachments::DataFile;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::restore::{RestoreHost, RestoreProgress};
use dashql_core_runtime::storage::{ConnectionsUpdate, StorageHost, StorageWriter, WriteOutcome, WriteStatistics};
use dashql_core_runtime::workbook::next_revision;
use js_sys::{Array, Function, Reflect};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tsify::Tsify;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use crate::host::{message_of, JsPlatform};
use crate::runtime::workbooks::view::WorkbookDataFile;
use crate::views::{to_js, JsonValue};
use restore_view::{RestoreProgress as ProgressView, RestoreScriptFile};
use view::{StorageWriteOutcome, StorageWriteStatistics};

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
    /// The statistics of the keys in the order they were first written
    statistics: RefCell<Vec<(String, StorageWriteStatistics)>>,
    /// The workbooks whose writes are held because a script changed outside the app, in the order of the changes
    held: RefCell<Vec<String>>,
    /// Changes with every change of the view
    revision: Cell<u64>,
    /// Hears the progress of the restore that runs
    progress: RefCell<Option<Function>>,
}

impl StorageState {
    /// The revision of the view
    pub fn revision(&self) -> u64 {
        self.revision.get()
    }

    /// The view of the storage
    pub fn view(&self) -> StorageView {
        StorageView { held_workbooks: self.held.borrow().clone() }
    }

    /// The statistics of the keys in the order they were first written
    pub fn statistics(&self) -> Vec<(String, StorageWriteStatistics)> {
        self.statistics.borrow().clone()
    }

    /// The writes of a workbook were resumed, it is no longer held
    pub fn release_held(&self, workbook_id: &str) {
        let mut held = self.held.borrow_mut();
        let before = held.len();
        held.retain(|id| id != workbook_id);
        if held.len() != before {
            self.revision.set(next_revision());
        }
    }

    /// Hear the progress of the restore that runs, none stops
    pub fn set_progress(&self, listener: Option<Function>) {
        *self.progress.borrow_mut() = listener;
    }
}

/// The storage of the runtime: the workbooks that a change outside the app holds
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StorageView {
    /// The workbooks whose writes are held because one of their scripts changed outside the app
    pub held_workbooks: Vec<String>,
}

/// A command of the storage writer
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum StorageCommand {
    /// Run every pending write right away and wait until all writes ended, also while paused
    Flush,
    /// Wait for the writes that started, without running the pending ones
    Settle,
    /// Write nothing until `resume` or `flush`, the writes stay pending
    Pause,
    /// Resume the writer, the pending writes wait for their debounce again
    Resume,
    /// Hold the writes of a workbook
    PauseWorkbook { workbook_id: String },
    /// Resume the writes of a workbook, e.g. after a change outside the app was answered
    ResumeWorkbook { workbook_id: String },
    /// Accept writes of a workbook id again after the workbook was deleted, e.g. an import of the same workbook
    ReviveWorkbook { workbook_id: String },
    /// Write the pending writes of a workbook and wait for them, resolves whether every write reached the storage
    FlushWorkbook { workbook_id: String },
    /// Delete a workbook from the storage, its pending writes are discarded. Rejects with what the storage failed with.
    DeleteWorkbook { workbook_id: String },
    /// Discard pending writes of a workbook, all of them without keys
    CancelPendingWrites {
        workbook_id: String,
        #[serde(default)]
        #[tsify(optional)]
        keys: Option<Vec<String>>,
    },
    /// Discard the pending writes of the files of a connection
    CancelPendingConnectionFileWrites { connection_id: String },
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

impl StorageHost for JsStorage {
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        let workbook = self.call("loadWorkbook", &[text(workbook_id)]).await?;
        if workbook.is_null() || workbook.is_undefined() {
            return Err(HostError::new(format!("the workbook file of {workbook_id} is missing")));
        }
        Ok(JsonValue::of(&workbook).0)
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

    fn statistics_changed(&self, key: &str, statistics: &WriteStatistics) {
        {
            let mut held = self.state.statistics.borrow_mut();
            let statistics = StorageWriteStatistics::from(statistics);
            match held.iter_mut().find(|(held, _)| held == key) {
                Some((_, entry)) => *entry = statistics,
                None => held.push((key.to_string(), statistics)),
            }
        }
    }

    fn external_script_change(&self, workbook_id: &str) {
        {
            let mut held = self.state.held.borrow_mut();
            if !held.iter().any(|id| id == workbook_id) {
                held.push(workbook_id.to_string());
            }
        }
        self.state.revision.set(next_revision());
        self.platform.signal(true);
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
