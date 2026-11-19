//! The attachments of the workbooks: Parquet files in the `attachments` folder of a workbook, the table parameters of
//! its scripts (`packages/dashql-core-runtime/src/attachments.rs`).
//!
//! The runtime names a new attachment, writes it through its storage writer, so a hold of the workbook (an import, a
//! change outside the app) defers it like a script, and reconciles the view of the workbook with what the storage
//! lists. The view of the workbook is the one list of its attachments.

use std::rc::Rc;

use dashql_core_runtime::attachments::{attachment_parameter_name, unique_attachment_file_name, DataFile, WorkbookAttachment};
use dashql_core_runtime::host::HostError;
use dashql_core_runtime::http::HostBytes;
use dashql_core_runtime::names::script_display_name;
use dashql_core_storage::storage::keys::{attachment_key, workbook_attachment_list_key};
use dashql_core_storage::storage::{WriteError, WriteOutcome, WriteTask};
use dashql_core_runtime::workbook::WorkbookAction;
use js_sys::{Array, Promise};
use serde::Serialize;
use tsify::Tsify;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use super::archives::items;
use super::runs::Runs;
use super::storage::error_value;
use super::workbooks::view::WorkbookDataFile;
use super::workbooks::Workbooks;
use super::Runtime;
use crate::host::{field, JsPlatform};
use crate::views::to_js;

#[wasm_bindgen(typescript_custom_section)]
const ATTACHED_FILE: &str = r#"
/** A file to attach to a workbook, with the name it was dropped with */
export interface AttachedFile {
    name: string;
    file: Blob | Uint8Array;
}
"#;

/// A file that was attached, with the name it got
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct AttachedFileName {
    /// The name the file was dropped with
    pub name: String,
    /// The file name of the attachment, its table parameter takes no name of a script or another attachment
    pub file_name: String,
}

/// What an attach did
#[derive(Clone, Debug, Default, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct AttachFilesOutcome {
    /// The attachments that were written or wait for a hold of the workbook, in the order of the files
    pub attached: Vec<AttachedFileName>,
    /// The files that are no attachments (Parquet files only), by their names
    pub refused: Vec<String>,
}

/// List the attachments of a workbook again and make them the attachments of its view: the mount of the attachments
/// looks them up again, the columns of new ones are read, and the workbook file lists them. An attachment whose write
/// waits for a hold of the workbook is attached as well: its size is the one of `deferred`, else the one the view
/// shows.
pub(crate) async fn reconcile_attachments(
    platform: &JsPlatform,
    workbooks: &Rc<Workbooks>,
    runs: &Rc<Runs>,
    workbook_id: &str,
    deferred: &[(String, usize)],
) -> Result<(), HostError> {
    let mut files: Vec<DataFile> =
        items::<WorkbookDataFile>(platform.storage_await("listDataFiles", &[JsValue::from_str(workbook_id)]).await?, "the data files")?.into_iter().map(Into::into).collect();
    let pending: Vec<DataFile> = pending_attachments(workbooks, workbook_id, deferred).into_iter().filter(|file| !files.iter().any(|listed| listed.name == file.name)).collect();
    files.extend(pending);
    let action = WorkbookAction::SetWorkbookAttachments { files };
    workbooks.apply(workbook_id, action).map_err(|error| HostError::new(error.what()))?;
    // A storage without mounts has nothing to look up again
    let _ = platform.storage_call("attachmentsChanged", &[JsValue::from_str(workbook_id)]);
    runs.describe_attachments();
    // The write runs once the workbook is not held
    let key = workbook_attachment_list_key(workbook_id);
    drop(workbooks.writer.write(&key, WriteTask::RefreshWorkbookAttachments { workbook_id: workbook_id.to_string() }, 0.0));
    Ok(())
}

/// The attachments of a workbook whose writes wait in the storage writer, e.g. for a hold of the workbook
fn pending_attachments(workbooks: &Rc<Workbooks>, workbook_id: &str, deferred: &[(String, usize)]) -> Vec<DataFile> {
    let pending = workbooks.writer.pending_keys_for_workbook(workbook_id);
    let shown: Vec<WorkbookAttachment> = workbooks
        .get(workbook_id)
        .and_then(|workbook| workbook.try_borrow().ok().map(|workbook| workbook.attachments().map(<[_]>::to_vec).unwrap_or_default()))
        .unwrap_or_default();
    let mut files = Vec::new();
    for key in pending {
        let Some(name) = key.strip_prefix(&attachment_key(workbook_id, "")) else { continue };
        if name.is_empty() || name.contains('/') || name.contains(':') {
            continue;
        }
        let size = deferred
            .iter()
            .find(|(file_name, _)| file_name == name)
            .map(|(_, size)| *size as u64)
            .or_else(|| shown.iter().find(|attachment| attachment.file_name == name).map(|attachment| attachment.size_bytes))
            .unwrap_or_default();
        files.push(DataFile { name: name.to_string(), size_bytes: size, mtime_ms: 0 });
    }
    files
}

/// The size of a file of the host, a Blob or bytes
fn file_size(file: &JsValue) -> usize {
    field(file, "size").or_else(|| field(file, "byteLength")).and_then(|size| size.as_f64()).unwrap_or_default().max(0.0) as usize
}

#[wasm_bindgen]
impl Runtime {
    /// Attach files to a workbook: every Parquet file gets a name whose table parameter takes no name of a script or
    /// another attachment (`sales.parquet` becomes `sales-2.parquet`, a file with the name of an attachment replaces
    /// it), is written through the storage writer and the view of the workbook lists it once the storage does. Resolves
    /// with the names the files got and the refused files, rejects with what the storage failed with.
    #[wasm_bindgen(js_name = attachFiles, unchecked_return_type = "Promise<AttachFilesOutcome>")]
    pub fn attach_files(&self, workbook_id: String, #[wasm_bindgen(unchecked_param_type = "AttachedFile[]")] files: JsValue) -> Result<Promise, JsError> {
        let workbook = self.workbooks.get(&workbook_id).ok_or_else(|| JsError::new(&format!("no workbook registered with id {workbook_id}")))?;
        let (script_names, mut taken): (Vec<String>, Vec<WorkbookAttachment>) = {
            let workbook = workbook.try_borrow().map_err(|_| JsError::new("the workbook is busy"))?;
            let names = workbook.scripts().iter().map(|script| script_display_name(script.file_name()).to_string()).collect();
            (names, workbook.attachments().map(<[_]>::to_vec).unwrap_or_default())
        };
        let mut outcome = AttachFilesOutcome::default();
        let mut writes = Vec::new();
        let mut sizes = Vec::new();
        for file in Array::from(&files).iter() {
            let name = field(&file, "name").and_then(|name| name.as_string()).unwrap_or_default();
            let content = field(&file, "file");
            let file_name = content.as_ref().and_then(|_| unique_attachment_file_name(&name, script_names.iter().map(String::as_str), &taken));
            let (Some(content), Some(file_name)) = (content, file_name) else {
                outcome.refused.push(name);
                continue;
            };
            // A later file of the same name replaces this one, others name themselves past it
            if !taken.iter().any(|attachment| attachment.file_name == file_name) {
                let parameter = attachment_parameter_name(&file_name).unwrap_or_default().to_string();
                taken.push(WorkbookAttachment { file_name: file_name.clone(), name: parameter, size_bytes: 0, mtime_ms: 0, columns: None });
            }
            let size = file_size(&content);
            let task = WriteTask::SaveDataFile { workbook_id: workbook_id.clone(), file_name: file_name.clone(), file: HostBytes::new(Rc::new(content), size) };
            writes.push(self.workbooks.writer.write_durable(&task.key(), task));
            sizes.push((file_name.clone(), size));
            outcome.attached.push(AttachedFileName { name, file_name });
        }
        let (platform, workbooks, runs) = (self.platform.clone(), self.workbooks.clone(), self.runs.clone());
        Ok(future_to_promise(async move {
            let mut failed = None;
            // A hold of the workbook defers a write, the file is attached all the same
            let mut deferred = Vec::new();
            for (write, size) in writes.into_iter().zip(sizes) {
                match write.await {
                    WriteOutcome::Failed(WriteError::Host(error)) | WriteOutcome::Failed(WriteError::WorkbookUnavailable { cause: error, .. }) => {
                        failed.get_or_insert(error);
                    }
                    WriteOutcome::Deferred => deferred.push(size),
                    _ => {}
                }
            }
            // The view lists what the storage holds and what waits for it, also after a failed write
            let reconciled = if outcome.attached.is_empty() { Ok(()) } else { reconcile_attachments(&platform, &workbooks, &runs, &workbook_id, &deferred).await };
            if let Some(error) = failed {
                return Err(error_value(&error));
            }
            reconciled.map_err(|error| error_value(&error))?;
            Ok(to_js(&outcome)?.into())
        }))
    }

    /// Rename an attachment of a workbook like a script: the name is a display name, `.parquet` is added unless it has
    /// it, and the name takes no name of a script or another attachment, `sales` becomes `sales-2` then. The scripts
    /// that read the attachment read the new name at once and its file is renamed through the storage writer. A refused
    /// rename, e.g. of a cloud preview or one whose rewrite of the references fails, rejects before anything changed.
    /// Resolves with the new file name once the file has it and the view lists it, null for a name that is unchanged or
    /// no plain file name. Rejects with what the storage failed with, the writer tries the rename again.
    #[wasm_bindgen(js_name = renameAttachment, unchecked_return_type = "Promise<string | null>")]
    pub fn rename_attachment(&self, workbook_id: String, file_name: String, name: String) -> Result<Promise, JsError> {
        let rename = self.workbooks.rename_attachment(&workbook_id, &file_name, &name).map_err(crate::js_error)?;
        let (platform, workbooks, runs) = (self.platform.clone(), self.workbooks.clone(), self.runs.clone());
        Ok(future_to_promise(async move {
            let Some((new_file_name, write)) = rename else { return Ok(JsValue::NULL) };
            if let WriteOutcome::Failed(WriteError::Host(error)) | WriteOutcome::Failed(WriteError::WorkbookUnavailable { cause: error, .. }) = write.await {
                return Err(error_value(&error));
            }
            // The mount of the attachments and the attachment list of the workbook file follow the file
            reconcile_attachments(&platform, &workbooks, &runs, &workbook_id, &[]).await.map_err(|error| error_value(&error))?;
            Ok(JsValue::from_str(&new_file_name))
        }))
    }

    /// List the attachments of a workbook again, e.g. after one was removed or renamed in the storage. Resolves once
    /// the view of the workbook lists them, rejects with what the storage failed with.
    #[wasm_bindgen(js_name = refreshAttachments, unchecked_return_type = "Promise<void>")]
    pub fn refresh_attachments(&self, workbook_id: String) -> Promise {
        let (platform, workbooks, runs) = (self.platform.clone(), self.workbooks.clone(), self.runs.clone());
        future_to_promise(async move {
            reconcile_attachments(&platform, &workbooks, &runs, &workbook_id, &[]).await.map_err(|error| error_value(&error))?;
            Ok(JsValue::UNDEFINED)
        })
    }
}
