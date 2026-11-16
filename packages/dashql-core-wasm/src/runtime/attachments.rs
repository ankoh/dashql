//! The attachments of the workbooks: Parquet files in the `attachments` folder of a workbook, the table parameters of
//! its scripts (`packages/dashql-core-runtime/src/attachments.rs`).
//!
//! The runtime names a new attachment, writes it through its storage writer, so a hold of the workbook (an import, a
//! change outside the app) defers it like a script, and reconciles the view of the workbook with what the storage
//! lists. The view of the workbook is the one list of its attachments.

use std::rc::Rc;

use dashql_core_runtime::attachments::{attachment_parameter_name, unique_attachment_file_name, WorkbookAttachment};
use dashql_core_runtime::host::HostError;
use dashql_core_runtime::http::HostBytes;
use dashql_core_runtime::names::script_display_name;
use dashql_core_runtime::storage::keys::workbook_attachment_list_key;
use dashql_core_runtime::storage::{WriteError, WriteOutcome, WriteTask};
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
/// looks them up again, the columns of new ones are read, and the workbook file lists them
pub(crate) async fn reconcile_attachments(platform: &JsPlatform, workbooks: &Rc<Workbooks>, runs: &Rc<Runs>, workbook_id: &str) -> Result<(), HostError> {
    let files: Vec<WorkbookDataFile> = items(platform.storage_await("listDataFiles", &[JsValue::from_str(workbook_id)]).await?, "the data files")?;
    let action = WorkbookAction::SetWorkbookAttachments { files: files.into_iter().map(Into::into).collect() };
    workbooks.apply(workbook_id, action).map_err(|error| HostError::new(error.what()))?;
    // A storage without mounts has nothing to look up again
    let _ = platform.storage_call("attachmentsChanged", &[JsValue::from_str(workbook_id)]);
    runs.describe_attachments();
    // The write runs once the workbook is not held
    let key = workbook_attachment_list_key(workbook_id);
    drop(workbooks.writer.write(&key, WriteTask::RefreshWorkbookAttachments { workbook_id: workbook_id.to_string() }, 0.0));
    Ok(())
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
            outcome.attached.push(AttachedFileName { name, file_name });
        }
        let (platform, workbooks, runs) = (self.platform.clone(), self.workbooks.clone(), self.runs.clone());
        Ok(future_to_promise(async move {
            let mut failed = None;
            for write in writes {
                match write.await {
                    WriteOutcome::Failed(WriteError::Host(error)) | WriteOutcome::Failed(WriteError::WorkbookUnavailable { cause: error, .. }) => {
                        failed.get_or_insert(error);
                    }
                    _ => {}
                }
            }
            // The view lists what the storage holds, also after a failed write
            let reconciled = if outcome.attached.is_empty() { Ok(()) } else { reconcile_attachments(&platform, &workbooks, &runs, &workbook_id).await };
            if let Some(error) = failed {
                return Err(error_value(&error));
            }
            reconciled.map_err(|error| error_value(&error))?;
            Ok(to_js(&outcome)?.into())
        }))
    }

    /// List the attachments of a workbook again, e.g. after one was removed or renamed in the storage. Resolves once
    /// the view of the workbook lists them, rejects with what the storage failed with.
    #[wasm_bindgen(js_name = refreshAttachments, unchecked_return_type = "Promise<void>")]
    pub fn refresh_attachments(&self, workbook_id: String) -> Promise {
        let (platform, workbooks, runs) = (self.platform.clone(), self.workbooks.clone(), self.runs.clone());
        future_to_promise(async move {
            reconcile_attachments(&platform, &workbooks, &runs, &workbook_id).await.map_err(|error| error_value(&error))?;
            Ok(JsValue::UNDEFINED)
        })
    }
}
