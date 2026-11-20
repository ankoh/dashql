//! The files of the imports and exports of workbooks on the platform (docs/design/dashql_core.md).
//!
//! The attachments, the cached query results and the entries of `.dashql` archives stay with the host: the module names
//! them by a handle of the handle table and knows their sizes, result data never enters it. The module reads and writes
//! the texts of a workbook, its workbook file and the rows of the workbook tables (as Arrow IPC, the platform writes and
//! scans their Parquet files with the embedded Hyper). The ZIP container stays with the platform as well (`archives`).

use std::cell::RefCell;

use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::{HostError, LogLevel, OnHost};

use dashql_core_storage::restore::bundle::BundleFile;
use dashql_core_storage::storage::FolderStamps;
use dashql_core_storage::workbook_format::bundle::{
    catalog_of_files, read_workbook_bundle, DataFileData, ScriptData, WorkbookBundle,
};
use dashql_core_storage::workbook_format::data::WorkbookData;
use dashql_core_storage::workbook_format::layout::{STORAGE_CATALOG_FUNCTIONS, STORAGE_CATALOG_RELATIONS};
use dashql_core_storage::workbook_format::tables::{Cell, WorkbookTableName, WorkbookTableRow, WorkbookTables};
use js_sys::{Array, Object, Reflect, Uint8Array};
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};
use wasm_bindgen::prelude::*;

use crate::host::{field, JsPlatform};
use crate::runtime::storage::restore_view::RestoreScriptFile;
use crate::runtime::workbooks::view::WorkbookDataFile;

/// A file of the host by handle: an attachment, a cached query result or an entry of an archive
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HostFile {
    /// The handle of the Blob or the bytes
    pub handle: Handle,
    /// The size in bytes
    pub size: u64,
}

/// The handles of the files that an import or an export keeps, released when it ends
pub(crate) struct HostFiles {
    platform: JsPlatform,
    handles: RefCell<Vec<Handle>>,
}

impl HostFiles {
    /// No files yet
    pub fn new(platform: JsPlatform) -> Self {
        Self { platform, handles: RefCell::new(Vec::new()) }
    }

    /// Keep a file of the host, a Blob or bytes, in the handle table until the files are released
    pub fn keep(&self, file: &JsValue) -> Result<HostFile, HostError> {
        if !file.is_object() {
            return Err(HostError::new("the platform returned no file"));
        }
        let size = field(file, "size")
            .or_else(|| field(file, "byteLength"))
            .and_then(|size| size.as_f64())
            .unwrap_or_default();
        let handle = self.platform.register(file)?;
        self.handles.borrow_mut().push(handle);
        Ok(HostFile { handle, size: size.max(0.0) as u64 })
    }

    /// Release every file
    pub fn release(&self) {
        let handles = std::mem::take(&mut *self.handles.borrow_mut());
        for handle in handles {
            self.platform.release_handle(handle);
        }
    }
}

impl Drop for HostFiles {
    fn drop(&mut self) {
        self.release();
    }
}

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

/// The items of a list that the platform handed over
pub(crate) fn items<T: DeserializeOwned>(value: JsValue, what: &str) -> Result<Vec<T>, HostError> {
    serde_wasm_bindgen::from_value(value).map_err(|e| HostError::new(format!("{what} can't be read: {e}")))
}

/// Read the bundle of a stored workbook through the storage of the platform: its workbook file with sanitized file
/// lists, its scripts, its attachments by handle and, if asked for, the catalogs of its connections
pub(crate) async fn read_stored_bundle(
    platform: &JsPlatform,
    stamps: &FolderStamps,
    files: &HostFiles,
    workbook_id: &str,
    with_catalog: bool,
) -> Result<WorkbookBundle<HostFile>, HostError> {
    let stored = WorkbookData::from_json(&super::storage::load_workbook(platform, stamps, workbook_id).await?);
    let scripts: Vec<RestoreScriptFile> =
        items(platform.storage_await("loadScripts", &[text(workbook_id)]).await?, "the scripts")?;
    let scripts = scripts.into_iter().map(|script| ScriptData::new(script.name, script.sql)).collect();
    let listed: Vec<WorkbookDataFile> =
        items(platform.storage_await("listDataFiles", &[text(workbook_id)]).await?, "the data files")?;
    let mut data = Vec::with_capacity(listed.len());
    for file in listed {
        let bytes = platform.storage_await("loadDataFile", &[text(workbook_id), text(&file.name)]).await?;
        data.push(DataFileData { name: file.name, bytes: files.keep(&bytes)? });
    }
    let owns_connections = platform.storage_call("ownsConnections", &[]).is_ok_and(|owns| owns.is_truthy());
    let mut catalogs = Vec::new();
    if with_catalog && owns_connections {
        for connection in &stored.connections {
            let id = &connection.connection_id;
            let relations = platform
                .storage_await("loadConnectionFile", &[text(id), text(STORAGE_CATALOG_RELATIONS)])
                .await?
                .as_string();
            let functions = platform
                .storage_await("loadConnectionFile", &[text(id), text(STORAGE_CATALOG_FUNCTIONS)])
                .await?
                .as_string();
            catalogs.extend(catalog_of_files(id, relations, functions));
        }
    }
    Ok(read_workbook_bundle(&stored, scripts, catalogs, data))
}

/// The rows of a workbook table as JS objects with the column names as keys
fn rows_value<R: WorkbookTableRow>(rows: &[R]) -> Value {
    let columns = R::TABLE.columns();
    Value::Array(
        rows.iter()
            .map(|row| {
                let mut object = Map::new();
                for (column, cell) in columns.iter().zip(row.cells()) {
                    let value = match cell {
                        Cell::Text(text) => json!(text),
                        Cell::Integer(value) => json!(value),
                        Cell::Boolean(value) => json!(value),
                    };
                    object.insert(column.name.to_string(), value);
                }
                Value::Object(object)
            })
            .collect(),
    )
}

/// The rows of a workbook table as JS objects
pub(crate) fn table_rows<B>(tables: &WorkbookTables<B>, table: WorkbookTableName) -> Value {
    match table {
        WorkbookTableName::Workbook => rows_value(&tables.workbook),
        WorkbookTableName::Connections => rows_value(&tables.connections),
        WorkbookTableName::Scripts => rows_value(&tables.scripts),
        WorkbookTableName::CatalogTables => rows_value(&tables.catalog_tables),
        WorkbookTableName::CatalogColumns => rows_value(&tables.catalog_columns),
        WorkbookTableName::CatalogFunctions => rows_value(&tables.catalog_functions),
        WorkbookTableName::CatalogFunctionParams => rows_value(&tables.catalog_function_params),
        WorkbookTableName::Attachments => rows_value(&tables.attachments),
        WorkbookTableName::Results => rows_value(&tables.results),
    }
}

/// An object with fields
pub(crate) fn object(fields: &[(&str, JsValue)]) -> JsValue {
    let object = Object::new();
    for (name, value) in fields {
        let _ = Reflect::set(&object, &JsValue::from_str(name), value);
    }
    object.into()
}

/// Bytes as a `Uint8Array` of the host
pub(crate) fn bytes_value(bytes: &[u8]) -> JsValue {
    Uint8Array::from(bytes).into()
}

/// A list of values
pub(crate) fn list(values: impl IntoIterator<Item = JsValue>) -> JsValue {
    values.into_iter().collect::<Array>().into()
}

impl BundleFile for HostFile {
    fn size_bytes(&self) -> u64 {
        self.size
    }
}

/// The platform as the host of the restore of a workbook that opens into memory (`BundleHost`): it logs on the target
/// of the imports
pub(crate) struct ImportHost(pub JsPlatform);

impl OnHost for ImportHost {
    type Inner = JsPlatform;

    fn inner_host(&self) -> &JsPlatform {
        &self.0
    }

    fn log_on_host(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.0.log_on(level, message, details, "workbook_import");
    }
}
