//! The storage of the runtime: the storage writer of the crate and the restore over `storage` of the platform
//! (docs/design/dashql_core.md).
//!
//! `JsStorage` is the host of the writer and of the restore over the platform object: every storage operation is a call
//! of `storage` of the platform, the clock, the timers and the log are the ones of the platform. What the writer tells
//! its host is state of the runtime: the holds and the failed writes are the `storage` view, the statistics of the keys
//! are read from the writer when the app shows them (`storageStatistics`), they change with every write. A rejected
//! call fails the write with the value the platform rejected with, the outcome of a write hands it back.
//!
//! The stamps of the folders that change outside the app are state of the runtime as well (`FolderStamps`): the writes
//! of scripts and of workbook files pass what they expect on disk to the platform and record the stamps it returns.

pub(crate) mod restore_view;
pub(crate) mod view;

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::rc::Rc;

use dashql_core_runtime::attachments::DataFile;
use dashql_core_runtime::host::{HostError, LogLevel, OnHost};
use dashql_core_runtime::http::HostBytes;
use dashql_core_runtime::workbook::next_revision;
use dashql_core_storage::restore::{RestoreHost, RestoreProgress};
use dashql_core_storage::storage::{
    ConnectionsUpdate, Expect, FileStamp, FolderListing, FolderStamps, NamedStamp, StorageHost, StorageWriter,
    WriterStatus,
};
use dashql_core_storage::workbook_format::data::WORKBOOK_FORMAT_VERSION;
use dashql_core_storage::workbook_format::files::{is_script_file_name, nfc};
use dashql_core_storage::workbook_format::layout::is_attachment_file_name;
use js_sys::{Array, Function, Object, Reflect};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tsify::Tsify;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use crate::host::{call_method, field, message_of, JsPlatform};
use crate::runtime::changes::Read;
use crate::runtime::migrations::migrate_workbook_folder;
use crate::runtime::workbooks::view::WorkbookDataFile;
use crate::views::{to_js, JsonValue};
use restore_view::{RestoreProgress as ProgressView, RestoreScriptFile};
use view::{FailedStorageWriteView, StorageHoldView};

/// The storage writer of the runtime
pub(crate) type RuntimeWriter = StorageWriter<JsStorage>;

/// A string field of a JS value
fn string_field(value: &JsValue, name: &str) -> Option<String> {
    if !value.is_object() {
        return None;
    }
    Reflect::get(value, &JsValue::from_str(name)).ok().and_then(|v| v.as_string())
}

/// A host error that keeps what the storage failed with. A file that changed outside the app is named by the error, a
/// missing workbook folder makes the call unavailable.
pub(crate) fn host_error(value: JsValue) -> HostError {
    let error = match string_field(&value, "name").as_deref() {
        Some("ExternalScriptChangeError") => {
            let workbook_id = string_field(&value, "workbookId").unwrap_or_default();
            let file_name = string_field(&value, "fileName").unwrap_or_default();
            HostError::external_script_change(workbook_id, file_name)
        }
        Some("WorkbookFolderMissingError") => HostError::unavailable(message_of(&value)),
        _ => HostError::new(message_of(&value)),
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

/// A stamp of the platform, `{ size, mtimeMs }`, none for anything else
pub(crate) fn stamp_of(value: &JsValue) -> Option<FileStamp> {
    let size = field(value, "size")?.as_f64()?;
    let mtime_ms = field(value, "mtimeMs")?.as_f64()?;
    Some(FileStamp { size, mtime_ms })
}

/// What a write expects on disk for the platform: undefined for any file, null for none, else the stamp
fn expect_value(expect: Expect) -> JsValue {
    match expect {
        Expect::Any => JsValue::UNDEFINED,
        Expect::Absent => JsValue::NULL,
        Expect::Stamp(stamp) => {
            let object = Object::new();
            let _ = Reflect::set(&object, &JsValue::from_str("size"), &JsValue::from_f64(stamp.size));
            let _ = Reflect::set(&object, &JsValue::from_str("mtimeMs"), &JsValue::from_f64(stamp.mtime_ms));
            object.into()
        }
    }
}

/// The files of a listing of the platform with their stamps, the names in NFC
fn named_stamps(value: Option<JsValue>, keep: impl Fn(&str) -> bool) -> Vec<NamedStamp> {
    let Some(value) = value.filter(Array::is_array) else { return Vec::new() };
    Array::from(&value)
        .iter()
        .filter_map(|file| Some(NamedStamp { name: nfc(&field(&file, "name")?.as_string()?), stamp: stamp_of(&file)? }))
        .filter(|file| keep(&file.name))
        .collect()
}

/// The stamps of a workbook folder as the platform lists them (`stampFolder`)
pub(crate) fn listing_of(value: &JsValue) -> FolderListing {
    FolderListing {
        scripts: named_stamps(field(value, "scripts"), is_script_file_name),
        attachments: named_stamps(field(value, "attachments"), is_attachment_file_name),
        workbook: field(value, "workbook").and_then(|workbook| stamp_of(&workbook)),
    }
}

/// The stamps of the folder of a workbook that may change outside the app, none for the workbooks of the storage root
pub(crate) async fn stamp_folder(platform: &JsPlatform, workbook_id: &str) -> Result<Option<FolderListing>, HostError> {
    let Some(folder) = platform.workbook_folder(workbook_id) else { return Ok(None) };
    Ok(Some(listing_of(&call_method(&folder, "stampFolder", &[]).await?)))
}

/// The workbook file of a workbook, the one way the runtime reads it. A workbook in a folder of its own that an older
/// version of the app wrote, e.g. a native folder after a checkout of an older commit, is brought to the current
/// workbook format first; the migration records its own writes in the stamps. The format version of the file decides
/// on every load, a current file is read once. The folders of the storage root were migrated with the storage.
pub(crate) async fn load_workbook(
    platform: &JsPlatform,
    stamps: &FolderStamps,
    workbook_id: &str,
) -> Result<Value, HostError> {
    let loaded = load_workbook_file(platform, workbook_id).await;
    let current = loaded.as_ref().is_ok_and(|workbook| {
        workbook.get("formatVersion").and_then(Value::as_i64).is_some_and(|version| version >= WORKBOOK_FORMAT_VERSION)
    });
    if current || platform.workbook_folder(workbook_id).is_none() {
        return loaded;
    }
    migrate_workbook_folder(platform, stamps, workbook_id).await?;
    load_workbook_file(platform, workbook_id).await
}

/// The workbook file of a workbook as the storage holds it
async fn load_workbook_file(platform: &JsPlatform, workbook_id: &str) -> Result<Value, HostError> {
    let workbook = platform.storage_await("loadWorkbook", &[text(workbook_id)]).await?;
    if !workbook.is_object() {
        return Err(HostError::new(format!("the workbook file of {workbook_id} is missing")));
    }
    Ok(JsonValue::of(&workbook).0)
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
    /// The stamps of the folders that may change outside the app, shared by the writer, the restore and the checks
    pub stamps: Rc<FolderStamps>,
}

impl StorageState {
    /// The revision of the view
    pub fn revision(&self) -> u64 {
        self.revision.get()
    }

    /// The view of the storage, busy while a task holds it
    pub fn view(&self) -> Read<StorageView> {
        let (Ok(status), Ok(questions)) = (self.status.try_borrow(), self.questions.try_borrow()) else {
            return Read::Busy;
        };
        Read::Value(StorageView {
            holds: status.holds.iter().map(StorageHoldView::from).collect(),
            failed_writes: status.failed.iter().map(FailedStorageWriteView::from).collect(),
            external_changes: questions.clone(),
        })
    }

    /// Tests of the seam: call a function while the storage view is borrowed. None if it is held.
    pub fn hold<R>(&self, f: impl FnOnce() -> R) -> Option<R> {
        let _held = self.status.try_borrow_mut().ok()?;
        Some(f())
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
/// that changed outside the app. The workbooks whose writes a change outside the app holds are the holds with the
/// reason `externalChange`.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StorageView {
    /// The holds of the writer (no workbook) and of the workbooks, with their reasons
    pub holds: Vec<StorageHoldView>,
    /// The writes that failed, with their last errors
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
/// of the runtime (`storageHold`, `storageRelease`, `storageDiscardWrites`).
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum StorageCommand {
    /// Run every pending write right away and wait until all writes ended. Writes past a pause of the writer, never
    /// past another hold. A flush while the window closes also keeps the scripts that a change outside the app holds as
    /// recovery copies next to them.
    Flush {
        #[serde(default)]
        #[tsify(optional)]
        closing: bool,
    },
    /// Write the pending writes of a workbook and wait for them, resolves whether every write reached the storage
    FlushWorkbook { workbook_id: String },
    /// Another tab takes over the app: the pending writes are written, then nothing is written any more, not even by a
    /// flush when the page hides
    HandOver,
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

impl OnHost for JsStorage {
    type Inner = JsPlatform;

    fn inner_host(&self) -> &JsPlatform {
        &self.platform
    }

    fn log_on_host(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, "storage_writer");
    }
}

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

impl StorageHost for JsStorage {
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        load_workbook(&self.platform, &self.state.stamps, workbook_id).await
    }

    async fn save_workbook(
        &self,
        workbook_id: &str,
        workbook: &Value,
        expect: Expect,
    ) -> Result<Option<FileStamp>, HostError> {
        let workbook = JsonValue(workbook.clone()).to_js().map_err(|e| HostError::new(e.to_string()))?;
        Ok(stamp_of(&self.call("saveWorkbook", &[text(workbook_id), workbook, expect_value(expect)]).await?))
    }

    async fn save_script(
        &self,
        workbook_id: &str,
        file_name: &str,
        script: &str,
        expect: Expect,
    ) -> Result<Option<FileStamp>, HostError> {
        Ok(stamp_of(
            &self.call("saveScript", &[text(workbook_id), text(file_name), text(script), expect_value(expect)]).await?,
        ))
    }

    async fn delete_script(&self, workbook_id: &str, file_name: &str, expect: Expect) -> Result<(), HostError> {
        self.call("deleteScript", &[text(workbook_id), text(file_name), expect_value(expect)]).await.map(|_| ())
    }

    async fn rename_script(
        &self,
        workbook_id: &str,
        from: &str,
        to: &str,
        expect_from: Expect,
        expect_to: Expect,
    ) -> Result<(), HostError> {
        let args = [text(workbook_id), text(from), text(to), expect_value(expect_from), expect_value(expect_to)];
        self.call("renameScript", &args).await.map(|_| ())
    }

    async fn load_gitignore(&self, workbook_id: &str) -> Result<Option<String>, HostError> {
        Ok(self.call("loadGitignore", &[text(workbook_id)]).await?.as_string())
    }

    async fn save_gitignore(&self, workbook_id: &str, gitignore: &str) -> Result<(), HostError> {
        self.call("saveGitignore", &[text(workbook_id), text(gitignore)]).await.map(|_| ())
    }

    async fn list_attachments(&self, workbook_id: &str) -> Result<Vec<String>, HostError> {
        let names = self.call("listAttachments", &[text(workbook_id)]).await?;
        if !Array::is_array(&names) {
            return Err(HostError::new(format!("the attachments of {workbook_id} are not a list")));
        }
        // The attachments in NFC and in natural order
        let names: Vec<String> =
            Array::from(&names).iter().filter_map(|name| name.as_string()).map(|name| nfc(&name)).collect();
        Ok(dashql_core_storage::workbook_format::files::workbook_attachments(&names)
            .into_iter()
            .map(|attachment| attachment.name)
            .collect())
    }

    async fn save_data_file(&self, workbook_id: &str, file_name: &str, file: &HostBytes) -> Result<(), HostError> {
        let file = file
            .value()
            .downcast_ref::<JsValue>()
            .cloned()
            .ok_or_else(|| HostError::new(format!("the attachment {file_name} is no file of the host")))?;
        self.call("saveDataFile", &[text(workbook_id), text(file_name), file]).await.map(|_| ())
    }

    async fn rename_data_file(&self, workbook_id: &str, from: &str, to: &str) -> Result<(), HostError> {
        self.call("renameDataFile", &[text(workbook_id), text(from), text(to)]).await.map(|_| ())
    }

    async fn delete_data_file(&self, workbook_id: &str, file_name: &str) -> Result<(), HostError> {
        self.call("deleteDataFile", &[text(workbook_id), text(file_name)]).await.map(|_| ())
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

/// The entries of the workbook tree of the storage in the order of the sidebar
async fn workbook_entries(platform: &JsPlatform) -> Result<Vec<Value>, HostError> {
    match JsonValue::of(&platform.storage_await("listWorkbooks", &[]).await?).0 {
        Value::Array(entries) => Ok(entries),
        _ => Err(HostError::new("the workbooks are not a list")),
    }
}

/// The id of a workbook in an entry of the workbook tree
pub(crate) fn entry_path(entry: &Value) -> Option<&str> {
    entry.get("path").and_then(Value::as_str)
}

/// The entry of the workbook tree with an id, none if there is none. The tree is authoritative, also for entries whose
/// files are invalid. Ids compare without their case, the entry keeps the spelling of the tree.
pub(crate) async fn find_workbook(platform: &JsPlatform, workbook_id: &str) -> Result<Option<Value>, HostError> {
    let id = workbook_id.to_lowercase();
    Ok(workbook_entries(platform)
        .await?
        .into_iter()
        .find(|entry| entry_path(entry).is_some_and(|path| path.to_lowercase() == id)))
}

impl RestoreHost for JsStorage {
    fn owns_connections(&self) -> bool {
        self.platform.storage_call("ownsConnections", &[]).is_ok_and(|owns| owns.is_truthy())
    }

    async fn list_workbooks(&self) -> Result<Vec<String>, HostError> {
        Ok(workbook_entries(&self.platform).await?.iter().filter_map(entry_path).map(str::to_string).collect())
    }

    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        load_workbook(&self.platform, &self.state.stamps, workbook_id).await
    }

    async fn load_manifest_connections(&self) -> Result<Option<Vec<Value>>, HostError> {
        match JsonValue::of(&self.call("loadManifestConnections", &[]).await?).0 {
            Value::Array(entries) => Ok(Some(entries)),
            _ => Ok(None),
        }
    }

    async fn load_scripts(&self, workbook_id: &str) -> Result<Vec<(String, String)>, HostError> {
        let scripts: Vec<RestoreScriptFile> =
            items(self.call("loadScripts", &[text(workbook_id)]).await?, "the scripts")?;
        Ok(scripts.into_iter().map(|script| (script.name, script.sql)).collect())
    }

    async fn list_data_files(&self, workbook_id: &str) -> Result<Vec<DataFile>, HostError> {
        let files: Vec<WorkbookDataFile> =
            items(self.call("listDataFiles", &[text(workbook_id)]).await?, "the data files")?;
        Ok(files.into_iter().map(DataFile::from).collect())
    }

    async fn load_connection_file(&self, connection_id: &str, file_name: &str) -> Result<Option<String>, HostError> {
        Ok(self.call("loadConnectionFile", &[text(connection_id), text(file_name)]).await?.as_string())
    }

    async fn stamp_folder(&self, workbook_id: &str) -> Result<Option<FolderListing>, HostError> {
        stamp_folder(&self.platform, workbook_id).await
    }

    fn restore_progress(&self, progress: &RestoreProgress) {
        let listener = self.state.progress.borrow().clone();
        if let (Some(listener), Ok(progress)) = (listener, to_js(&ProgressView::from(progress))) {
            let _ = listener.call1(&JsValue::NULL, &progress.into());
        }
    }
}
