//! The views of the storage writer: the tasks that the host hands over, the outcomes of the writes and the statistics
//! of a key, as JS objects (`serde-wasm-bindgen`) with TypeScript declarations in the generated `.d.ts` (`tsify`). See
//! docs/design/dashql_core.md.
//!
//! Workbook files, connection entries and connections are opaque JSON (`JsonValue`). A text of a task is a string or a
//! function that reads it when the write runs, it crosses as the JS value. A failed write hands back the value that the
//! host failed with.

use dashql_core_runtime::storage::{FailedWrite, HoldReason, TextSource, WriteError, WriteHold, WriteOutcome, WriteStatistics, WriteTask};
use dashql_core_runtime::workbook_format::data::{WorkbookCloudLink, WorkbookConnection, WorkbookScript};
use js_sys::{Function, Reflect};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use super::{error_value, host_error};
use crate::views::JsonValue;

/// A text that is written, or a function that reads it when the write runs, null if there is nothing to write anymore
#[derive(Debug, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "string | (() => string | null)")]
pub struct StorageWriteText(#[serde(deserialize_with = "serde_wasm_bindgen::preserve::deserialize")] JsValue);

impl TryFrom<StorageWriteText> for TextSource {
    type Error = JsError;

    fn try_from(text: StorageWriteText) -> Result<TextSource, JsError> {
        if let Some(text) = text.0.as_string() {
            return Ok(TextSource::Text(text));
        }
        let read = (text.0.dyn_into::<Function>()).map_err(|_| invalid("a text is neither a string nor a function".into()))?;
        let read = move || read.call0(&JsValue::NULL).map(|text| text.as_string()).map_err(host_error);
        Ok(TextSource::Read(Box::new(read)))
    }
}

/// Write the workbook file with the given copies of connections, the scripts, the name and the attachments on disk stay
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WriteWorkbookManifestTask {
    pub workbook_id: String,
    pub connections: Vec<JsonValue>,
    pub ephemeral: bool,
}

/// Patch the properties of the user into the workbook file, a write without `ephemeral` promotes the workbook and one
/// without `cloud` removes the link to the cloud
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WriteWorkbookPropertiesTask {
    pub workbook_id: String,
    pub name: Option<String>,
    pub ephemeral: bool,
    pub cloud: Option<JsonValue>,
}

/// A script of a workbook that is written as a whole
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ReplacedScript {
    pub file_name: String,
    pub text: StorageWriteText,
}

/// Write a workbook as a whole, its scripts first and its workbook file last
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ReplaceWorkbookScriptsTask {
    pub workbook_id: String,
    pub name: Option<String>,
    pub scripts: Vec<ReplacedScript>,
    /// The connection of a workbook that is not stored yet
    pub connection: Option<JsonValue>,
    pub original_file_name: Option<String>,
}

/// Insert or replace a connection entry of the app manifest
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WriteConnectionEntryTask {
    pub entry: JsonValue,
}

/// Remove a connection entry of the app manifest and the files of the connection
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct DeleteConnectionEntryTask {
    pub connection_id: String,
}

/// Write a file of a connection
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WriteConnectionFileTask {
    pub connection_id: String,
    pub file_name: String,
    pub text: StorageWriteText,
}

/// Patch the copies of a connection into an existing workbook file, the connections it replaced move to it
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct PatchWorkbookConnectionTask {
    pub workbook_id: String,
    pub copy: JsonValue,
    pub replaced: Vec<String>,
}

#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WriteScriptTask {
    pub workbook_id: String,
    pub file_name: String,
    pub text: String,
}

#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct DeleteScriptTask {
    pub workbook_id: String,
    pub file_name: String,
}

#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RenameScriptTask {
    pub workbook_id: String,
    pub from: String,
    pub to: String,
}

/// Patch the script list and the copies of the connections it uses into the workbook file
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WriteWorkbookScriptsTask {
    pub workbook_id: String,
    pub scripts: Vec<JsonValue>,
    pub connections: Vec<JsonValue>,
}

/// Patch the attachment list of the workbook file from the attachments on disk
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RefreshWorkbookAttachmentsTask {
    pub workbook_id: String,
}

/// What a write does. The variants are read one by one: a text function passes through only where serde reads a
/// struct field by field, not through the buffer of an internally tagged enum.
#[derive(Debug, Tsify)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StorageWriteTask {
    WriteWorkbookManifest(WriteWorkbookManifestTask),
    WriteWorkbookProperties(WriteWorkbookPropertiesTask),
    ReplaceWorkbookScripts(ReplaceWorkbookScriptsTask),
    WriteConnectionEntry(WriteConnectionEntryTask),
    DeleteConnectionEntry(DeleteConnectionEntryTask),
    WriteConnectionFile(WriteConnectionFileTask),
    PatchWorkbookConnection(PatchWorkbookConnectionTask),
    WriteScript(WriteScriptTask),
    DeleteScript(DeleteScriptTask),
    RenameScript(RenameScriptTask),
    WriteWorkbookScripts(WriteWorkbookScriptsTask),
    RefreshWorkbookAttachments(RefreshWorkbookAttachmentsTask),
}

fn invalid(message: String) -> JsError {
    JsError::new(&format!("invalid write task: {message}"))
}

fn variant<T: DeserializeOwned>(task: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(task).map_err(|e| invalid(e.to_string()))
}

impl StorageWriteTask {
    /// The task that the host handed over
    pub fn read(task: tsify::Ts<StorageWriteTask>) -> Result<StorageWriteTask, JsError> {
        let task = JsValue::from(task);
        let kind = Reflect::get(&task, &JsValue::from_str("type")).ok().and_then(|kind| kind.as_string());
        let kind = kind.unwrap_or_default();
        Ok(match kind.as_str() {
            "writeWorkbookManifest" => Self::WriteWorkbookManifest(variant(task)?),
            "writeWorkbookProperties" => Self::WriteWorkbookProperties(variant(task)?),
            "replaceWorkbookScripts" => Self::ReplaceWorkbookScripts(variant(task)?),
            "writeConnectionEntry" => Self::WriteConnectionEntry(variant(task)?),
            "deleteConnectionEntry" => Self::DeleteConnectionEntry(variant(task)?),
            "writeConnectionFile" => Self::WriteConnectionFile(variant(task)?),
            "patchWorkbookConnection" => Self::PatchWorkbookConnection(variant(task)?),
            "writeScript" => Self::WriteScript(variant(task)?),
            "deleteScript" => Self::DeleteScript(variant(task)?),
            "renameScript" => Self::RenameScript(variant(task)?),
            "writeWorkbookScripts" => Self::WriteWorkbookScripts(variant(task)?),
            "refreshWorkbookAttachments" => Self::RefreshWorkbookAttachments(variant(task)?),
            other => return Err(invalid(format!("unknown type {other:?}"))),
        })
    }
}

/// The copies of connections of a task, each needs its `connectionId`
fn copies(values: Vec<JsonValue>) -> Result<Vec<WorkbookConnection>, JsError> {
    values.into_iter().map(|value| copy(value.0)).collect()
}

fn copy(value: serde_json::Value) -> Result<WorkbookConnection, JsError> {
    WorkbookConnection::from_json(&value).ok_or_else(|| invalid("a copy of a connection has no connectionId".into()))
}

/// The scripts of a script list, each needs its `name` and `connectionId`
fn scripts(values: Vec<JsonValue>) -> Result<Vec<WorkbookScript>, JsError> {
    values
        .into_iter()
        .map(|value| {
            let field = |key: &str| value.0.get(key).and_then(serde_json::Value::as_str).map(str::to_string);
            match (field("name"), field("connectionId")) {
                (Some(name), Some(connection_id)) => Ok(WorkbookScript::new(name, connection_id)),
                _ => Err(invalid("a script needs its name and connectionId".into())),
            }
        })
        .collect()
}

impl TryFrom<StorageWriteTask> for WriteTask {
    type Error = JsError;

    fn try_from(task: StorageWriteTask) -> Result<WriteTask, JsError> {
        type T = StorageWriteTask;
        Ok(match task {
            T::WriteWorkbookManifest(t) => WriteTask::WriteWorkbookManifest {
                workbook_id: t.workbook_id,
                connections: copies(t.connections)?,
                ephemeral: t.ephemeral,
            },
            T::WriteWorkbookProperties(t) => WriteTask::WriteWorkbookProperties {
                workbook_id: t.workbook_id,
                name: t.name,
                ephemeral: t.ephemeral,
                cloud: t.cloud.and_then(|cloud| WorkbookCloudLink::from_json(&cloud.0)),
            },
            T::ReplaceWorkbookScripts(t) => WriteTask::ReplaceWorkbookScripts {
                workbook_id: t.workbook_id,
                name: t.name,
                scripts: (t.scripts.into_iter())
                    .map(|s| Ok((s.file_name, s.text.try_into()?)))
                    .collect::<Result<_, JsError>>()?,
                connection: t.connection.map(|connection| connection.0).filter(|connection| !connection.is_null()).map(copy).transpose()?,
                original_file_name: t.original_file_name,
            },
            T::WriteConnectionEntry(t) => WriteTask::WriteConnectionEntry { entry: t.entry.0 },
            T::DeleteConnectionEntry(t) => WriteTask::DeleteConnectionEntry { connection_id: t.connection_id },
            T::WriteConnectionFile(t) => WriteTask::WriteConnectionFile {
                connection_id: t.connection_id,
                file_name: t.file_name,
                text: t.text.try_into()?,
            },
            T::PatchWorkbookConnection(t) => {
                WriteTask::PatchWorkbookConnection { workbook_id: t.workbook_id, copy: copy(t.copy.0)?, replaced: t.replaced }
            }
            T::WriteScript(t) => {
                WriteTask::WriteScript { workbook_id: t.workbook_id, file_name: t.file_name, text: t.text }
            }
            T::DeleteScript(t) => WriteTask::DeleteScript { workbook_id: t.workbook_id, file_name: t.file_name },
            T::RenameScript(t) => WriteTask::RenameScript { workbook_id: t.workbook_id, from: t.from, to: t.to },
            T::WriteWorkbookScripts(t) => WriteTask::WriteWorkbookScripts {
                workbook_id: t.workbook_id,
                scripts: scripts(t.scripts)?,
                connections: copies(t.connections)?,
            },
            T::RefreshWorkbookAttachments(t) => WriteTask::RefreshWorkbookAttachments { workbook_id: t.workbook_id },
        })
    }
}

/// The outcome of a write. A failed write carries what the host failed with, a patch of a workbook file that is not
/// available names the workbook.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum StorageWriteOutcome {
    Written,
    Superseded,
    Cancelled,
    Deferred,
    Failed {
        #[serde(serialize_with = "serde_wasm_bindgen::preserve::serialize")]
        #[tsify(type = "unknown")]
        error: JsValue,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        unavailable_workbook: Option<String>,
    },
}

impl From<WriteOutcome> for StorageWriteOutcome {
    fn from(outcome: WriteOutcome) -> Self {
        match outcome {
            WriteOutcome::Written => Self::Written,
            WriteOutcome::Superseded => Self::Superseded,
            WriteOutcome::Cancelled => Self::Cancelled,
            WriteOutcome::Deferred => Self::Deferred,
            WriteOutcome::Failed(WriteError::Host(error)) => {
                Self::Failed { error: error_value(&error), unavailable_workbook: None }
            }
            WriteOutcome::Failed(WriteError::WorkbookUnavailable { workbook_id, cause }) => {
                Self::Failed { error: error_value(&cause), unavailable_workbook: Some(workbook_id) }
            }
        }
    }
}

/// The statistics of a key: the scheduled writes of the key and the writes of its file
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StorageWriteStatistics {
    pub scheduled_writes: u64,
    pub writes: u64,
    pub written_bytes: u64,
    pub write_time_ms: f64,
    /// The time of the last write in milliseconds since the epoch
    pub last_write_ms: Option<f64>,
}

impl From<&WriteStatistics> for StorageWriteStatistics {
    fn from(statistics: &WriteStatistics) -> Self {
        StorageWriteStatistics {
            scheduled_writes: statistics.scheduled_writes,
            writes: statistics.writes,
            written_bytes: statistics.written_bytes,
            write_time_ms: statistics.write_time_ms,
            last_write_ms: statistics.last_write_ms,
        }
    }
}

/// The statistics of the writes of a key, with the key within its workbook for display
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StorageKeyStatistics {
    pub key: String,
    /// The key without the prefix of its workbook, e.g. `scripts/a.sql:delete`
    pub label: String,
    pub statistics: StorageWriteStatistics,
}

/// Why the writes of the writer or of a workbook are held
#[derive(Clone, Copy, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]

pub enum StorageHoldReason {
    /// A file changed outside the app, the app asks the user
    ExternalChange,
    /// A check of a folder or a reload from disk
    Reload,
    /// An import replaces the workbook
    Import,
    /// Another tab took over the app
    Handover,
    /// The app paused the writes, e.g. while it moves a workbook
    Pause,
}

impl From<StorageHoldReason> for HoldReason {
    fn from(reason: StorageHoldReason) -> Self {
        match reason {
            StorageHoldReason::ExternalChange => HoldReason::ExternalChange,
            StorageHoldReason::Reload => HoldReason::Reload,
            StorageHoldReason::Import => HoldReason::Import,
            StorageHoldReason::Handover => HoldReason::Handover,
            StorageHoldReason::Pause => HoldReason::Pause,
        }
    }
}

impl From<HoldReason> for StorageHoldReason {
    fn from(reason: HoldReason) -> Self {
        match reason {
            HoldReason::ExternalChange => StorageHoldReason::ExternalChange,
            HoldReason::Reload => StorageHoldReason::Reload,
            HoldReason::Import => StorageHoldReason::Import,
            HoldReason::Handover => StorageHoldReason::Handover,
            HoldReason::Pause => StorageHoldReason::Pause,
        }
    }
}

/// A hold of the writer (no workbook) or of a workbook
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StorageHoldView {
    pub workbook_id: Option<String>,
    pub reason: StorageHoldReason,
    pub count: u32,
}

impl From<&WriteHold> for StorageHoldView {
    fn from(hold: &WriteHold) -> Self {
        StorageHoldView { workbook_id: hold.workbook_id.clone(), reason: hold.reason.into(), count: hold.count }
    }
}

/// A write that failed and runs again after a backoff
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct FailedStorageWriteView {
    pub key: String,
    /// The workbook of the key, null for the files of the app
    pub workbook_id: Option<String>,
    /// The last error
    pub error: String,
    /// The failed attempts in a row
    pub attempts: u32,
}

impl From<&FailedWrite> for FailedStorageWriteView {
    fn from(write: &FailedWrite) -> Self {
        FailedStorageWriteView { key: write.key.clone(), workbook_id: write.workbook_id.clone(), error: write.error.clone(), attempts: write.attempts }
    }
}

/// The latest generation of every key of a workbook, `[key, generation]`
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(transparent)]
pub struct StorageWriteGenerations(pub Vec<(String, u64)>);
