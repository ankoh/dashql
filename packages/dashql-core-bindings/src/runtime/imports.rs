//! The imports of workbooks: `.dashql` archives (files, drops and `?zip=` links), workbook folders (native folders,
//! folders of the browser, hosted workbooks) and the workbook tables of a cloud (docs/design/dashql_core.md,
//! docs/design/workbook_tables.md).
//!
//! An import has two steps. `read` reads the source into a pending import of the runtime: the bundle with its
//! attachments and results by handle, the catalogs that parse, the registered workbook with the same id and the
//! questions about the connections, which map to the connections of the runtime. `commit` takes the answers: it
//! rewrites the connection references, adds the results to the query result cache of the platform, writes the workbook
//! (a fresh workbook, a replacement through a staged copy, or a native folder registered in place), verifies the write
//! and restores the workbook into the runtime.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use dashql_core_runtime::connections::label::{connection_params_label_of_value, is_hyper_wasm_connection};
use dashql_core_runtime::connections::sharing::descriptor_of_params;
use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::{HostError, LogLevel};
use dashql_core_storage::storage::{HoldReason, WriteError, WriteOutcome, WriteTask};
use dashql_core_storage::workbook_format::bundle::{
    assemble_workbook_bundle, bundle_catalog_path, catalog_seed_files, check_workbook_bundle,
    describe_workbook_bundle_difference, filter_invalid_workbook_catalogs, prepare_workbook_bundle_write,
    read_workbook_bundle, read_workbook_bundle_head, reconcile_stored_workbook_files, rename_bundle_catalogs,
    DataFileData, ScriptData, WorkbookBundle, WorkbookBundleResult, WorkbookBundleWriteOptions,
};
use dashql_core_storage::workbook_format::connection_import::{
    apply_connection_import_plan, connection_refs_changed, plan_connection_import, ConnectionImportChoice,
    ConnectionImportDecision, ConnectionImportPlanItem,
};
use dashql_core_storage::workbook_format::data::{
    ConnectionEntry, WorkbookData, WorkbookMetadata, WORKBOOK_FORMAT_VERSION,
};
use dashql_core_storage::workbook_format::files::nfc;
use dashql_core_storage::workbook_format::import::{
    plan_archive, read_folder_archive, read_table_archive, ArchiveEntry, ArchivePlan, FolderArchiveEntry,
    FolderArchiveFiles, TableArchiveEntry,
};
use dashql_core_storage::workbook_format::layout::{
    StorageType, STORAGE_CATALOG_FUNCTIONS, STORAGE_CATALOG_RELATIONS, STORAGE_WORKBOOK_FILE,
};
use dashql_core_storage::workbook_format::migration::{MigrationFolder, MIGRATION_FILES};
use dashql_core_storage::workbook_format::query_results::{
    plan_result_import, CacheCapacity, ImportedWorkbookQueryResults,
};
use dashql_core_storage::workbook_format::tables::{
    workbook_tables_to_bundle, DataTableFile, WorkbookTableName, WorkbookTables,
};
use dashql_core_storage::workbook_format::validation::validate_workbook_data;
use js_sys::{Function, Uint8Array};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tsify::Tsify;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use super::archives::{items, HostFile, HostFiles};
use super::connections::Connections;
use super::storage::restore_view::RestoreScriptFile;
use super::storage::{entry_path, find_workbook, load_workbook, RuntimeWriter};
use super::workbooks::view::WorkbookDataFile;
use super::Restorer;
use crate::host::{call_method, field, JsPlatform};
use crate::views::JsonValue;

/// The error prefix of workbook folders without one of their own
const FOLDER_ERROR_PREFIX: &str = "Invalid workbook folder";
/// The error prefix of workbook tables without one of their own
const TABLES_ERROR_PREFIX: &str = "Invalid workbook tables";

/// The workbook with the same id that the storage registered
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ImportConflict {
    /// The id of the registered workbook, as the registry spells it
    pub workbook_id: String,
    /// The entry of the workbook tree, `{ path, storageType, nativePath }`
    pub entry: JsonValue,
}

/// A connection of the app that an imported connection may use
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ImportCandidate {
    pub id: String,
    pub params: JsonValue,
    pub name: Option<String>,
    /// The label of the params, the connector and the location of its database, e.g. `Trino / http://localhost:8080`
    pub params_label: String,
}

/// A question about a connection of an imported workbook: connections of the app may describe the same database
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ImportQuestion {
    /// The id of the connection in the workbook
    pub connection_id: String,
    /// The params in the workbook, shared workbooks carry them without secrets
    pub params: JsonValue,
    /// The name the connection had in the exporting app
    pub name: Option<String>,
    /// The label of the params, the connector and the location of its database, e.g. `Trino / http://localhost:8080`
    pub params_label: String,
    /// The connections of the app that describe the same database, the first is the default
    pub candidates: Vec<ImportCandidate>,
}

/// The cached query results that an imported workbook carries
#[derive(Clone, Debug, Default, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ImportResultFiles {
    pub count: u32,
    pub bytes: f64,
}

/// What an import read, before anything is written
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ImportPreview {
    /// The pending import, `commitImport` and `dropImport` name it
    pub import_id: u32,
    /// The workbook file, migrated and with the file lists of its files
    pub workbook: JsonValue,
    /// The script files
    pub script_count: u32,
    /// The attachments
    pub attachment_count: u32,
    /// The cached query results
    pub results: ImportResultFiles,
    /// The registered workbook with the same id, null if there is none
    pub conflict: Option<ImportConflict>,
    /// The connections that the user decides on
    pub questions: Vec<ImportQuestion>,
    /// The catalog files that didn't parse and were left out
    pub invalid_catalogs: Vec<String>,
    /// False when unusable entries were removed from the file lists of the workbook file
    pub files_valid: bool,
    /// The folder of a native workbook that is registered in place, null for a copy
    pub native_path: Option<String>,
}

/// What the user chose for a connection that may use an existing one
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ImportChoice {
    /// Use an existing connection
    Link { connection_id: String },
    /// Keep the connection of the workbook as a connection of its own
    Separate,
}

/// What an import does with a registered workbook of the same id
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum ImportConflictChoice {
    /// Replace the registered workbook
    Replace,
    /// Import the workbook as a new one with a fresh id and " (copy)" after its name
    CreateNew,
}

/// The answers of an import
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnswers {
    /// The choices of the questions by the id of the imported connection, an unanswered question keeps its connection
    /// separate
    #[serde(default)]
    #[tsify(optional, type = "Record<string, ImportChoice>")]
    pub connections: HashMap<String, ImportChoice>,
    /// Answer every question with its first candidate, e.g. a preview of a published workbook
    #[serde(default)]
    #[tsify(optional)]
    pub preview: Option<bool>,
    /// What to do with a registered workbook of the same id, an import fails on one without
    #[serde(default)]
    #[tsify(optional)]
    pub conflict: Option<ImportConflictChoice>,
    /// The id of the written workbook, the id of the source if absent
    #[serde(default)]
    #[tsify(optional)]
    pub workbook_id: Option<String>,
    /// The metadata of the written workbook, the metadata of the source if absent
    #[serde(default)]
    #[tsify(optional, type = "unknown")]
    pub metadata: Option<Value>,
    /// Add the cached query results to the cache, true if absent. A link never does.
    #[serde(default)]
    #[tsify(optional)]
    pub results: Option<bool>,
    /// Restore a written copy into the runtime, true if absent. Without, the caller reloads the app.
    #[serde(default)]
    #[tsify(optional)]
    pub restore: Option<bool>,
}

/// The outcome of the import of the query results of a workbook
#[derive(Clone, Debug, Default, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ImportedResults {
    /// The results of the workbook
    pub total: u32,
    /// The results that became files of the cache
    pub added: u32,
    /// The results whose keys were cached already, the results of the app win
    pub kept: u32,
    /// The results that couldn't be added
    pub failed: u32,
    /// The results left out because the workbook holds more than the cache keeps
    pub dropped: u32,
    /// The bytes of the results that were added
    pub bytes: f64,
    /// Why the first result that failed couldn't be added, or why none was
    pub error: Option<String>,
}

impl From<&ImportedWorkbookQueryResults> for ImportedResults {
    fn from(outcome: &ImportedWorkbookQueryResults) -> Self {
        let count = |n: u64| u32::try_from(n).unwrap_or(u32::MAX);
        ImportedResults {
            total: count(outcome.total),
            added: count(outcome.added),
            kept: count(outcome.kept),
            failed: count(outcome.failed),
            dropped: count(outcome.dropped),
            bytes: outcome.bytes as f64,
            error: outcome.error.clone(),
        }
    }
}

/// What an import wrote
#[derive(Clone, Debug, Default, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ImportOutcome {
    /// The id of the written workbook
    pub workbook_id: String,
    /// The outcome of the query results, null for a workbook without results
    pub results: Option<ImportedResults>,
    /// The connections that the import registered, the app didn't have them
    pub registered: Vec<String>,
    /// Did a connection use an existing one that the user would have been asked about?
    pub unasked: bool,
    /// Was the workbook restored into the runtime? A replacement or a native folder is not, the app reloads.
    pub restored: bool,
}

/// An import that was read and waits for its answers
struct PendingImport {
    /// The bundle, its attachments and results by handle
    bundle: WorkbookBundle<HostFile>,
    /// The files of the bundle, released with the import
    _files: HostFiles,
    /// The folder of a native workbook that is registered in place
    native_path: Option<String>,
    /// How the connections map to the connections of the app, none if the storage owns no connections
    plan: Option<(Vec<ConnectionImportPlanItem>, Vec<ConnectionEntry>)>,
    /// Does a commit run? A commit that failed leaves the import for another try.
    committing: Cell<bool>,
}

/// The imports of the runtime
pub(crate) struct Imports {
    platform: JsPlatform,
    connections: Rc<Connections>,
    pending: RefCell<Vec<(u32, Rc<PendingImport>)>>,
    next_id: Cell<u32>,
}

/// A source of an import as the host hands it over
enum Source {
    /// A `.dashql` archive, a Blob of the handle table
    Archive(Handle),
    /// A workbook folder that the platform reads (`RuntimeImportFolder`)
    Folder(JsValue),
    /// The workbook tables, e.g. of a cloud: `{ rows, data, errorPrefix }`
    Tables(JsValue),
}

fn source_of(value: &JsValue) -> Result<Source, HostError> {
    if let Some(archive) = field(value, "archive") {
        let handle = archive.as_f64().filter(|h| *h > 0.0 && h.fract() == 0.0 && *h <= Handle::MAX as f64);
        return handle
            .map(|h| Source::Archive(h as Handle))
            .ok_or_else(|| HostError::new("the archive of an import is no handle"));
    }
    if let Some(folder) = field(value, "folder") {
        return Ok(Source::Folder(folder));
    }
    if let Some(tables) = field(value, "tables") {
        return Ok(Source::Tables(tables));
    }
    Err(HostError::new("an import reads an archive, a folder or workbook tables"))
}

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

fn format_error(error: dashql_core::error::Error) -> HostError {
    HostError::new(error.what())
}

/// A string field of an object
fn string_field(value: &JsValue, name: &str) -> Option<String> {
    field(value, name).and_then(|value| value.as_string())
}

/// The bytes of a `Uint8Array`
fn bytes_of(value: &JsValue, what: &str) -> Result<Vec<u8>, HostError> {
    if !value.is_object() {
        return Err(HostError::new(format!("{what} has no bytes")));
    }
    Ok(Uint8Array::new(value).to_vec())
}

/// Hears the steps of a commit
struct Steps(Option<Function>);

impl Steps {
    fn report(&self, step: &str, results: Option<&ImportedResults>) {
        let Some(listener) = &self.0 else { return };
        let results =
            results.and_then(|results| crate::views::to_js(results).ok()).map(JsValue::from).unwrap_or(JsValue::NULL);
        let _ = listener.call2(&JsValue::NULL, &text(step), &results);
    }
}

impl Imports {
    pub fn new(platform: JsPlatform, connections: Rc<Connections>) -> Rc<Self> {
        Rc::new(Imports { platform, connections, pending: RefCell::new(Vec::new()), next_id: Cell::new(0) })
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, "workbook_import");
    }

    /// A fresh UUID of the platform, the import fails without one
    fn new_uuid(&self) -> Result<String, HostError> {
        self.platform.random_uuid()
    }

    /// Drop a pending import, its files are released
    pub fn drop_import(&self, import_id: u32) {
        let dropped: Vec<(u32, Rc<PendingImport>)> = {
            let mut pending = self.pending.borrow_mut();
            let (dropped, kept) = std::mem::take(&mut *pending).into_iter().partition(|(id, _)| *id == import_id);
            *pending = kept;
            dropped
        };
        // The files are released outside of the borrow
        drop(dropped);
    }

    /// Drop every pending import
    pub fn drop_all(&self) {
        let dropped = std::mem::take(&mut *self.pending.borrow_mut());
        drop(dropped);
    }

    /// Read a source into a pending import
    pub async fn read(self: Rc<Self>, source: JsValue) -> Result<ImportPreview, HostError> {
        let source = source_of(&source)?;
        let files = HostFiles::new(self.platform.clone());
        let (bundle, files_valid, native_path) = match &source {
            Source::Archive(archive) => {
                let read = self.read_archive(*archive, &files).await;
                let _ = self.platform.archives_call("close", &[JsValue::from_f64(*archive as f64)]).await;
                (read?, true, None)
            }
            Source::Folder(folder) => self.read_folder(folder, &files).await?,
            Source::Tables(tables) => (self.read_tables(tables, &files).await?, true, None),
        };
        // Malformed catalog files never reach the storage. They aren't analyzed, they may reference what only their
        // connection knows.
        let (catalogs, invalid_catalogs) = filter_invalid_workbook_catalogs(&bundle.catalogs);
        let bundle = WorkbookBundle { catalogs, ..bundle };
        if !invalid_catalogs.is_empty() {
            let joined = invalid_catalogs.join(", ");
            self.log(
                LogLevel::Warn,
                "Ignored malformed workbook catalog files",
                &[("workbookId", &bundle.workbook.workbook_id), ("files", &joined)],
            );
        }
        let conflict = self.find_workbook(&bundle.workbook.workbook_id).await?;
        let plan = match self.connection_entries().await? {
            Some(entries) => Some((plan_connection_import(&bundle.workbook, &entries), entries)),
            None => None,
        };
        let questions = plan.as_ref().map(|(plan, _)| questions_of(plan)).unwrap_or_default();
        let id = self.next_id.get() + 1;
        self.next_id.set(id);
        let preview = ImportPreview {
            import_id: id,
            workbook: JsonValue(bundle.workbook.to_json()),
            script_count: bundle.scripts.len() as u32,
            attachment_count: bundle.data.len() as u32,
            results: ImportResultFiles {
                count: bundle.results.len() as u32,
                bytes: bundle.results.iter().map(|result| result.bytes.size as f64).sum(),
            },
            conflict,
            questions,
            invalid_catalogs,
            files_valid,
            native_path: native_path.clone(),
        };
        let details = [
            ("workbookId", bundle.workbook.workbook_id.clone()),
            ("scripts", bundle.scripts.len().to_string()),
            ("connections", bundle.workbook.connections.len().to_string()),
            ("results", bundle.results.len().to_string()),
        ];
        let details: Vec<(&str, &str)> = details.iter().map(|(key, value)| (*key, value.as_str())).collect();
        self.log(LogLevel::Info, "Read a workbook to import", &details);
        self.pending.borrow_mut().push((
            id,
            Rc::new(PendingImport { bundle, _files: files, native_path, plan, committing: Cell::new(false) }),
        ));
        Ok(preview)
    }

    /// Read a `.dashql` archive: the core decides what each entry is, the platform lists and reads the entries
    async fn read_archive(&self, archive: Handle, files: &HostFiles) -> Result<WorkbookBundle<HostFile>, HostError> {
        let handle = JsValue::from_f64(archive as f64);
        #[derive(Deserialize)]
        struct Entry {
            filename: String,
            directory: bool,
        }
        let entries: Vec<Entry> = items(
            self.platform.archives_call("entries", std::slice::from_ref(&handle)).await?,
            "the entries of the archive",
        )?;
        // The names of the entries in NFC, a ZIP of another platform may decompose them
        let entries: Vec<ArchiveEntry> = entries
            .into_iter()
            .map(|entry| ArchiveEntry { filename: nfc(&entry.filename), directory: entry.directory })
            .collect();
        let index = |index: usize| JsValue::from_f64(index as f64);
        match plan_archive(&entries).map_err(format_error)? {
            ArchivePlan::Tables(plan) => {
                let mut tables: WorkbookTables<HostFile> = WorkbookTables::default();
                for (i, entry) in plan {
                    match entry {
                        TableArchiveEntry::Table(table) => {
                            let ipc = self.platform.archives_call("readTable", &[handle.clone(), index(i)]).await?;
                            tables.decode_table(table, &bytes_of(&ipc, "a workbook table")?).map_err(format_error)?;
                        }
                        TableArchiveEntry::Data { table_name, stored_slice } => {
                            let (file, crc32) = self.read_entry_file(&handle, i, stored_slice, files).await?;
                            tables.data.push((table_name, DataTableFile { bytes: file, crc32 }));
                        }
                    }
                }
                read_table_archive(&tables).map_err(format_error)
            }
            ArchivePlan::Folder(plan) => {
                let mut read = FolderArchiveFiles {
                    texts: Vec::new(),
                    scripts: Vec::new(),
                    data: Vec::new(),
                    results: Vec::new(),
                };
                for (i, entry) in &plan.entries {
                    match entry {
                        FolderArchiveEntry::Text { path } => {
                            let value = self.platform.archives_call("readText", &[handle.clone(), index(*i)]).await?;
                            read.texts.push((path.clone(), value.as_string().unwrap_or_default()));
                        }
                        FolderArchiveEntry::Script { name } => {
                            let value = self.platform.archives_call("readText", &[handle.clone(), index(*i)]).await?;
                            read.scripts.push(ScriptData::new(name.clone(), value.as_string().unwrap_or_default()));
                        }
                        FolderArchiveEntry::Attachment { name } => {
                            let (file, _) = self.read_entry_file(&handle, *i, false, files).await?;
                            read.data.push(DataFileData { name: name.clone(), bytes: file });
                        }
                        FolderArchiveEntry::Result { key } => {
                            // An export stores the results without compression, they stay slices of the archive
                            let (file, crc32) = self.read_entry_file(&handle, *i, true, files).await?;
                            read.results.push(WorkbookBundleResult { key: key.clone(), bytes: file, crc32 });
                        }
                    }
                }
                read_folder_archive(&plan, read).map_err(format_error)
            }
        }
    }

    /// Read a file entry of an archive: a slice of the archive if it is stored and `slice` is set, with the CRC-32 that
    /// the import of a result checks, else its bytes checked against the CRC-32
    async fn read_entry_file(
        &self,
        archive: &JsValue,
        index: usize,
        slice: bool,
        files: &HostFiles,
    ) -> Result<(HostFile, Option<u32>), HostError> {
        let read = self
            .platform
            .archives_call("readFile", &[archive.clone(), JsValue::from_f64(index as f64), JsValue::from_bool(slice)])
            .await?;
        let file = field(&read, "file").ok_or_else(|| HostError::new("the archive returned no file"))?;
        let crc32 = field(&read, "crc32")
            .and_then(|crc| crc.as_f64())
            .filter(|crc| *crc >= 0.0 && *crc <= u32::MAX as f64)
            .map(|crc| crc as u32);
        Ok((files.keep(&file)?, crc32))
    }

    /// Read a workbook folder: the top-level files are migrated in memory, the catalogs of the connections, the scripts
    /// and the attachments are read as they are
    async fn read_folder(
        &self,
        folder: &JsValue,
        files: &HostFiles,
    ) -> Result<(WorkbookBundle<HostFile>, bool, Option<String>), HostError> {
        let prefix = string_field(folder, "errorPrefix").unwrap_or_else(|| FOLDER_ERROR_PREFIX.to_string());
        let read_text = |path: &str| call_method(folder, "readText", &[text(path)]);
        // A current folder needs its workbook file only
        let mut texts: Vec<(String, String)> = Vec::new();
        let current = read_text(STORAGE_WORKBOOK_FILE).await?.as_string();
        let is_current = current
            .as_deref()
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .and_then(|value| value.get("formatVersion").and_then(Value::as_i64))
            == Some(WORKBOOK_FORMAT_VERSION);
        match current {
            Some(current) if is_current => texts.push((STORAGE_WORKBOOK_FILE.to_string(), current)),
            _ => {
                for name in MIGRATION_FILES {
                    if let Some(content) = read_text(name).await?.as_string() {
                        texts.push((name.to_string(), content));
                    }
                }
            }
        }
        let mut head =
            read_workbook_bundle_head(&mut MigrationFolder::new(texts.clone()), &prefix).map_err(format_error)?;
        // The catalogs of the connections, the core names the connections once it migrated the workbook file
        let mut catalogs = Vec::new();
        for connection in &head.workbook.connections {
            for file_name in [STORAGE_CATALOG_RELATIONS, STORAGE_CATALOG_FUNCTIONS] {
                let path = bundle_catalog_path(&connection.connection_id, file_name);
                if let Some(content) = read_text(&path).await?.as_string() {
                    catalogs.push((path, content));
                }
            }
        }
        if !catalogs.is_empty() {
            texts.extend(catalogs);
            head = read_workbook_bundle_head(&mut MigrationFolder::new(texts), &prefix).map_err(format_error)?;
        }
        let listed = |names: Vec<String>| names.into_iter().map(JsValue::from).collect::<js_sys::Array>().into();
        let script_names: JsValue = listed(head.workbook.scripts.iter().map(|script| script.name.clone()).collect());
        let scripts: Vec<RestoreScriptFile> =
            items(call_method(folder, "scripts", &[script_names]).await?, "the scripts")?;
        let scripts = scripts.into_iter().map(|script| ScriptData::new(script.name, script.sql)).collect();
        let attachment_names: JsValue =
            listed(head.workbook.attachments.iter().map(|file| file.name.clone()).collect());
        let attachments = call_method(folder, "attachments", &[attachment_names]).await?;
        let mut data = Vec::new();
        for attachment in js_sys::Array::from(&attachments).iter() {
            let name = string_field(&attachment, "name")
                .ok_or_else(|| HostError::new("an attachment of the folder has no name"))?;
            let file = field(&attachment, "file")
                .ok_or_else(|| HostError::new(format!("the attachment {name} has no file")))?;
            data.push(DataFileData { name, bytes: files.keep(&file)? });
        }
        let mut bundle = assemble_workbook_bundle(head.workbook, head.catalogs, scripts, data);
        // The metadata of the source, e.g. the URL of a hosted workbook
        if let Some(metadata) = field(folder, "metadata") {
            let mut merged = bundle.workbook.metadata.to_json();
            if let (Some(merged), Value::Object(extra)) = (merged.as_object_mut(), JsonValue::of(&metadata).0) {
                merged.extend(extra);
            }
            bundle.workbook.metadata = WorkbookMetadata::from_json(&merged);
        }
        check_workbook_bundle(&bundle, &prefix).map_err(format_error)?;
        Ok((bundle, head.files_valid, string_field(folder, "nativePath")))
    }

    /// Read the workbook tables of a source: the rows of the tables as Arrow IPC, the Parquet files of the data tables
    async fn read_tables(&self, source: &JsValue, files: &HostFiles) -> Result<WorkbookBundle<HostFile>, HostError> {
        let prefix = string_field(source, "errorPrefix").unwrap_or_else(|| TABLES_ERROR_PREFIX.to_string());
        let mut tables: WorkbookTables<HostFile> = WorkbookTables::default();
        if let Some(rows) = field(source, "rows") {
            for table in WorkbookTableName::ALL {
                if let Some(ipc) = field(&rows, table.name()) {
                    tables.decode_table(table, &bytes_of(&ipc, table.name())?).map_err(format_error)?;
                }
            }
        }
        if let Some(data) = field(source, "data") {
            for entry in js_sys::Array::from(&data).iter() {
                let table_name =
                    string_field(&entry, "tableName").ok_or_else(|| HostError::new("a data table has no name"))?;
                let file = field(&entry, "file")
                    .ok_or_else(|| HostError::new(format!("the data table {table_name} has no file")))?;
                let crc32 = field(&entry, "crc32").and_then(|crc| crc.as_f64()).map(|crc| crc as u32);
                tables.data.push((table_name, DataTableFile { bytes: files.keep(&file)?, crc32 }));
            }
        }
        workbook_tables_to_bundle(&tables, &prefix).map_err(format_error)
    }

    /// The registered workbook with an id, ignoring the case of the id. A runtime without storage registers none, an
    /// import into memory replaces a workbook with the same id.
    async fn find_workbook(&self, workbook_id: &str) -> Result<Option<ImportConflict>, HostError> {
        if !self.platform.has_storage() {
            return Ok(None);
        }
        let entry = find_workbook(&self.platform, workbook_id).await?;
        Ok(entry.and_then(|entry| {
            Some(ImportConflict { workbook_id: entry_path(&entry)?.to_string(), entry: JsonValue(entry) })
        }))
    }

    /// The connections of the app that an import maps to: the stored ones with their live params and the connections
    /// of the runtime that workbooks use, and the embedded database. None if the storage owns no connections.
    async fn connection_entries(&self) -> Result<Option<Vec<ConnectionEntry>>, HostError> {
        if !self.platform.storage_call("ownsConnections", &[]).is_ok_and(|owns| owns.is_truthy()) {
            return Ok(None);
        }
        let manifest = JsonValue::of(&self.platform.storage_await("loadManifestConnections", &[]).await?).0;
        let registry =
            self.connections.registry.try_borrow().map_err(|_| HostError::new("the connections are busy"))?;
        let live_params = |id: &str| -> Option<Value> {
            let connection = registry.get(id)?;
            let state = connection.state.try_borrow().ok()?;
            Some(Value::Object(state.params().to_object()))
        };
        let mut entries: Vec<ConnectionEntry> = Vec::new();
        // Logged once the registry is no longer borrowed, the logger is JS
        let mut ignored: Vec<String> = Vec::new();
        for value in manifest.as_array().into_iter().flatten() {
            let Some(mut entry) = ConnectionEntry::from_json(value) else { continue };
            // The live connections may be ahead of the manifest while writes are debounced
            if let Some(params) = live_params(&entry.id) {
                entry.params = params;
            }
            // The restore skips a connection of an unknown connector, the import leaves it out as well
            if descriptor_of_params(&entry.params).is_none() {
                ignored.push(entry.id);
                continue;
            }
            entries.push(entry);
        }
        // The embedded database always takes the embedded databases of the imported workbook
        for (id, connection) in registry.connections() {
            if entries.iter().any(|entry| entry.id == id) {
                continue;
            }
            let Ok(state) = connection.state.try_borrow() else { continue };
            if !registry.workbooks_of(id).is_empty() || is_hyper_wasm_connection(&state) {
                let mut entry = ConnectionEntry::new(id, Value::Object(state.params().to_object()));
                entry.name = state.name().map(str::to_string);
                entries.push(entry);
            }
        }
        drop(registry);
        for id in &ignored {
            self.log(LogLevel::Warn, "Ignored a stored connection of an unknown connector", &[("connectionId", id)]);
        }
        Ok(Some(entries))
    }

    /// A pending import that no commit runs on
    fn pending(&self, import_id: u32) -> Result<Rc<PendingImport>, HostError> {
        let pending = self.pending.borrow();
        let import = pending.iter().find(|(id, _)| *id == import_id).map(|(_, import)| import.clone());
        let import = import.ok_or_else(|| HostError::new(format!("no pending import {import_id}")))?;
        if import.committing.replace(true) {
            return Err(HostError::new(format!("the import {import_id} is committed already")));
        }
        Ok(import)
    }

    /// Commit a pending import, it goes once it was written. A commit that failed leaves it for another try, e.g.
    /// after the user chose again.
    pub async fn commit(
        self: Rc<Self>,
        import_id: u32,
        answers: ImportAnswers,
        listener: Option<Function>,
        restorer: Restorer,
    ) -> Result<ImportOutcome, HostError> {
        let pending = self.pending(import_id)?;
        let outcome = self.clone().commit_pending(&pending, answers, listener, restorer).await;
        pending.committing.set(false);
        if outcome.is_ok() {
            self.drop_import(import_id);
        }
        outcome
    }

    /// Commit a pending import with its answers. The listener hears the steps: `results` with the outcome of the
    /// results, `workbook`, `scripts`, `attachments` and `open`.
    async fn commit_pending(
        self: Rc<Self>,
        pending: &PendingImport,
        answers: ImportAnswers,
        listener: Option<Function>,
        restorer: Restorer,
    ) -> Result<ImportOutcome, HostError> {
        let steps = Steps(listener);
        let mut bundle = pending.bundle.clone();
        let original = bundle.workbook.clone();
        let mut outcome = ImportOutcome::default();
        // The connections
        if let Some((plan, entries)) = &pending.plan {
            let preview = answers.preview.unwrap_or(false);
            let mut choices: HashMap<String, ConnectionImportChoice> = HashMap::new();
            for item in plan {
                let ConnectionImportDecision::Ask { candidates } = &item.decision else { continue };
                let choice = if preview {
                    candidates
                        .first()
                        .map(|candidate| ConnectionImportChoice::Link { connection_id: candidate.id.clone() })
                } else {
                    answers.connections.get(&item.reference.connection_id).map(|choice| match choice {
                        ImportChoice::Link { connection_id } => {
                            ConnectionImportChoice::Link { connection_id: connection_id.clone() }
                        }
                        ImportChoice::Separate => ConnectionImportChoice::Separate,
                    })
                };
                if let Some(choice) = choice {
                    choices.insert(item.reference.connection_id.clone(), choice);
                }
                outcome.unasked |= preview;
            }
            // A failed UUID fails the import, the plan of an empty id is never applied
            let mut failed = None;
            let applied = apply_connection_import_plan(&bundle.workbook, plan, &choices, entries, &mut || {
                self.new_uuid().unwrap_or_else(|error| {
                    failed.get_or_insert(error);
                    String::new()
                })
            });
            if let Some(error) = failed {
                return Err(error);
            }
            bundle.catalogs =
                rename_bundle_catalogs(&bundle.catalogs, &applied.connection_ids.iter().cloned().collect());
            bundle.workbook = applied.workbook;
            outcome.registered = bundle
                .workbook
                .connections
                .iter()
                .map(|connection| connection.connection_id.clone())
                .filter(|id| !entries.iter().any(|entry| entry.id == *id))
                .collect();
            let kinds: Vec<&str> = plan
                .iter()
                .map(|item| match item.decision {
                    ConnectionImportDecision::Register => "register",
                    ConnectionImportDecision::Link { .. } => "link",
                    ConnectionImportDecision::Ask { .. } => "ask",
                })
                .collect();
            self.log(
                LogLevel::Info,
                "Resolved the connections of an imported workbook",
                &[("workbookId", &original.workbook_id), ("connections", &kinds.join(","))],
            );
        }
        if let Some(metadata) = &answers.metadata {
            bundle.workbook.metadata = WorkbookMetadata::from_json(metadata);
        }
        if let Some(workbook_id) = &answers.workbook_id {
            bundle.workbook.workbook_id = workbook_id.clone();
        }
        // The query results are no part of the workbook, a failure leaves the import alone
        let results = std::mem::take(&mut bundle.results);
        if !results.is_empty() {
            if answers.results.unwrap_or(true) {
                let imported = self.import_results(&bundle.workbook.workbook_id, &results, &steps).await;
                outcome.results = Some(ImportedResults::from(&imported));
            } else {
                self.log(
                    LogLevel::Warn,
                    "Ignored the query results of an import",
                    &[("results", &results.len().to_string())],
                );
            }
        }
        steps.report("workbook", None);
        // A runtime without storage opens the workbook into memory
        let Some(storage) = restorer.workbooks.persistence.writer().cloned() else {
            if !answers.restore.unwrap_or(true) {
                return Err(HostError::new("a runtime without storage keeps an import only in memory, it restores it"));
            }
            outcome.workbook_id = bundle.workbook.workbook_id.clone();
            steps.report("open", None);
            restorer.restore_bundle(bundle).await?;
            outcome.restored = true;
            return Ok(outcome);
        };
        let writer = Writer { platform: self.platform.clone(), steps: &steps, storage };
        let conflict = self.find_workbook(&bundle.workbook.workbook_id).await?;
        match &pending.native_path {
            Some(dir) => {
                outcome.workbook_id = match (conflict, answers.conflict) {
                    (None, _) => {
                        let workbook_id = bundle.workbook.workbook_id.clone();
                        writer.register_native(&bundle, dir, &workbook_id).await?;
                        if connection_refs_changed(&original, &bundle.workbook) {
                            writer.write_connection_refs(&workbook_id, &bundle.workbook).await?;
                        }
                        workbook_id
                    }
                    (Some(_), Some(ImportConflictChoice::CreateNew)) => {
                        let workbook_id = self.new_uuid()?;
                        writer.write_fresh(&with_fresh_identity(&bundle, &workbook_id), &workbook_id).await?;
                        self.restore_fresh(&writer, &restorer, &answers, &steps, &workbook_id, &mut outcome).await?;
                        workbook_id
                    }
                    (Some(conflict), Some(ImportConflictChoice::Replace)) => {
                        let storage = &writer.storage;
                        let refs_changed = connection_refs_changed(&original, &bundle.workbook);
                        let replace = async {
                            writer.replace_with_native(&bundle, dir, &conflict).await?;
                            if refs_changed {
                                writer.write_connection_refs(&conflict.workbook_id, &bundle.workbook).await?;
                            }
                            Ok(())
                        };
                        held_replacement(storage, &conflict.workbook_id, replace).await?;
                        conflict.workbook_id
                    }
                    (Some(conflict), None) => {
                        return Err(HostError::new(format!("Workbook {} is already registered", conflict.workbook_id)))
                    }
                };
            }
            None => {
                outcome.workbook_id = match (conflict, answers.conflict) {
                    (None, _) => {
                        let workbook_id = bundle.workbook.workbook_id.clone();
                        writer.write_fresh(&bundle, &workbook_id).await?;
                        self.restore_fresh(&writer, &restorer, &answers, &steps, &workbook_id, &mut outcome).await?;
                        workbook_id
                    }
                    (Some(_), Some(ImportConflictChoice::CreateNew)) => {
                        let workbook_id = self.new_uuid()?;
                        writer.write_fresh(&with_fresh_identity(&bundle, &workbook_id), &workbook_id).await?;
                        self.restore_fresh(&writer, &restorer, &answers, &steps, &workbook_id, &mut outcome).await?;
                        workbook_id
                    }
                    (Some(conflict), Some(ImportConflictChoice::Replace)) => {
                        let storage = &writer.storage;
                        let staging = self.new_uuid()?;
                        let backup = self.new_uuid()?;
                        held_replacement(
                            storage,
                            &conflict.workbook_id,
                            writer.replace_with_bundle(&bundle, &conflict, staging, backup),
                        )
                        .await?;
                        conflict.workbook_id
                    }
                    (Some(_), None) => {
                        return Err(HostError::new(format!(
                            "A workbook with the id {} was added meanwhile",
                            bundle.workbook.workbook_id
                        )));
                    }
                };
            }
        }
        self.log(
            LogLevel::Info,
            "Imported a workbook",
            &[("workbookId", &outcome.workbook_id), ("restored", if outcome.restored { "true" } else { "false" })],
        );
        Ok(outcome)
    }

    /// Restore a fresh copy into the runtime unless the caller reloads the app. A copy that can't be restored is
    /// deleted again.
    async fn restore_fresh(
        &self,
        writer: &Writer<'_>,
        restorer: &Restorer,
        answers: &ImportAnswers,
        steps: &Steps,
        workbook_id: &str,
        outcome: &mut ImportOutcome,
    ) -> Result<(), HostError> {
        if !answers.restore.unwrap_or(true) {
            return Ok(());
        }
        // The same workbook may have been imported and deleted before
        writer.storage.revive_workbook(workbook_id);
        steps.report("open", None);
        match restorer.clone().restore_workbook(workbook_id.to_string()).await {
            Ok(_) => {
                outcome.restored = true;
                Ok(())
            }
            Err(error) => {
                let _ = writer.platform.storage_await("deleteWorkbook", &[text(workbook_id)]).await;
                Err(error)
            }
        }
    }

    /// Add the cached query results of an imported workbook to the cache of the platform, the results of the app win.
    /// The results beyond the limits of the cache are left out, they would evict each other.
    async fn import_results(
        &self,
        workbook_id: &str,
        results: &[WorkbookBundleResult<HostFile>],
        steps: &Steps,
    ) -> ImportedWorkbookQueryResults {
        let total = results.len() as u64;
        let bytes: u64 = results.iter().map(|result| result.bytes.size).sum();
        steps.report("results", None);
        let fields =
            [("workbookId", workbook_id.to_string()), ("results", total.to_string()), ("bytes", bytes.to_string())];
        let fields: Vec<(&str, &str)> = fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
        let capacity = match self.cache_capacity().await {
            Ok(capacity) => capacity,
            Err(error) => {
                self.log(
                    LogLevel::Warn,
                    "Ignored the query results of an imported workbook, results are not cached",
                    &fields,
                );
                let outcome = ImportedWorkbookQueryResults::failed_all(total, error.message());
                steps.report("results", Some(&ImportedResults::from(&outcome)));
                return outcome;
            }
        };
        self.log(LogLevel::Info, "Importing the query results of a workbook", &fields);
        let mut outcome = ImportedWorkbookQueryResults::default();
        let sizes: Vec<u64> = results.iter().map(|result| result.bytes.size).collect();
        let plan = plan_result_import(&sizes, capacity, &mut outcome);
        for (result, add) in results.iter().zip(plan) {
            let size = result.bytes.size.to_string();
            let details = [("key", result.key.as_str()), ("bytes", size.as_str())];
            if !add {
                self.log(LogLevel::Warn, "Left out an imported query result, the cache is full", &details);
                continue;
            }
            let crc32 = result.crc32.map(|crc| JsValue::from_f64(crc as f64)).unwrap_or(JsValue::NULL);
            let args = [text(&result.key), JsValue::from_f64(result.bytes.handle as f64), crc32];
            match self.platform.cache_call("import", &args).await {
                Ok(added) if added.is_truthy() => {
                    outcome.added(result.bytes.size);
                    // The cache keeps its limits after every file of a key
                    self.platform.evict_cache().await;
                }
                Ok(_) => outcome.kept(),
                Err(error) => {
                    self.log(
                        LogLevel::Warn,
                        "Adding an imported query result to the cache failed",
                        &[("key", &result.key), ("error", error.message())],
                    );
                    outcome.failed(error.message());
                }
            }
        }
        let level = if outcome.failed > 0 || outcome.dropped > 0 { LogLevel::Warn } else { LogLevel::Info };
        let counts = [
            ("added", outcome.added),
            ("kept", outcome.kept),
            ("failed", outcome.failed),
            ("dropped", outcome.dropped),
        ]
        .map(|(key, n)| (key, n.to_string()));
        let counts: Vec<(&str, &str)> = counts.iter().map(|(key, value)| (*key, value.as_str())).collect();
        self.log(level, "Imported the query results of a workbook", &counts);
        steps.report("results", Some(&ImportedResults::from(&outcome)));
        outcome
    }

    /// The limits of the query result cache of the platform
    async fn cache_capacity(&self) -> Result<CacheCapacity, HostError> {
        let capacity = self.platform.cache_call("capacity", &[]).await?;
        Ok(crate::host::cache_capacity(&capacity))
    }
}

/// The questions of a plan
fn questions_of(plan: &[ConnectionImportPlanItem]) -> Vec<ImportQuestion> {
    plan.iter()
        .filter_map(|item| {
            let ConnectionImportDecision::Ask { candidates } = &item.decision else { return None };
            Some(ImportQuestion {
                connection_id: item.reference.connection_id.clone(),
                params: JsonValue(item.reference.params.clone()),
                name: item.reference.name.clone(),
                params_label: connection_params_label_of_value(&item.reference.params),
                candidates: candidates
                    .iter()
                    .map(|entry| ImportCandidate {
                        id: entry.id.clone(),
                        params: JsonValue(entry.params.clone()),
                        name: entry.name.clone(),
                        params_label: connection_params_label_of_value(&entry.params),
                    })
                    .collect(),
            })
        })
        .collect()
}

/// A bundle with a new identity: the id and " (copy)" after a nonblank name. The connections keep their ids.
fn with_fresh_identity(bundle: &WorkbookBundle<HostFile>, workbook_id: &str) -> WorkbookBundle<HostFile> {
    let mut copy = bundle.clone();
    copy.workbook.workbook_id = workbook_id.to_string();
    if let Some(name) = copy.workbook.name.as_deref().map(str::trim).filter(|name| !name.is_empty()) {
        copy.workbook.name = Some(format!("{name} (copy)"));
    }
    copy
}

/// Replace a registered workbook while an import holds its writes (`HoldReason::Import`): the pending writes of the
/// workbook reach the storage first, a rollback keeps them; the hold keeps later writes off the files that the
/// replacement writes. A replacement that succeeded discards them and keeps the hold: the workbook of the runtime is the
/// replaced version until the app reloads, nothing of it is written any more, not even by a flush when the page hides.
async fn held_replacement(
    storage: &RuntimeWriter,
    workbook_id: &str,
    replace: impl std::future::Future<Output = Result<(), HostError>>,
) -> Result<(), HostError> {
    if !storage.flush_workbook(workbook_id).await && !storage.failed_writes_for_workbook(workbook_id).is_empty() {
        return Err(HostError::new(format!(
            "the changes of workbook {workbook_id} can't be saved, it is not replaced"
        )));
    }
    storage.hold(Some(workbook_id), HoldReason::Import);
    storage.settle().await;
    let replaced = replace.await;
    match replaced {
        Ok(()) => storage.cancel_pending_writes_for_workbook(workbook_id),
        Err(_) => storage.release(Some(workbook_id), HoldReason::Import),
    }
    replaced
}

/// The outcome of a write of an import, which waits for it
fn write_result(outcome: WriteOutcome, what: &str) -> Result<(), HostError> {
    match outcome {
        WriteOutcome::Written => Ok(()),
        WriteOutcome::Failed(WriteError::Host(error) | WriteError::WorkbookUnavailable { cause: error, .. }) => {
            Err(error)
        }
        _ => Err(HostError::new(format!("the write of {what} did not run"))),
    }
}

/// The writes of an import through the storage of the platform. The writes of a registered workbook file go through the
/// storage writer, they keep their order with the other writes of the workbook.
struct Writer<'a> {
    platform: JsPlatform,
    steps: &'a Steps,
    storage: RuntimeWriter,
}

impl Writer<'_> {
    fn storage(
        &self,
        name: &str,
        args: &[JsValue],
    ) -> impl std::future::Future<Output = Result<JsValue, HostError>> + 'static {
        self.platform.storage_await(name, args)
    }

    /// The workbook file of a workbook, migrated like every read of the runtime
    async fn load_workbook(&self, workbook_id: &str) -> Result<WorkbookData, HostError> {
        Ok(WorkbookData::from_json(&load_workbook(&self.platform, self.storage.stamps(), workbook_id).await?))
    }

    /// Patch a registered workbook file through the writer, past the hold of an import that replaces the workbook
    async fn patch(&self, task: WriteTask, what: &str) -> Result<(), HostError> {
        write_result(self.storage.write_past(task, HoldReason::Import).await, what)
    }

    /// Copy the files of a workbook of the storage as they are: the workbook file, of any format, the scripts and the
    /// attachments
    async fn copy_workbook_files(&self, from: &str, to: &str) -> Result<(), HostError> {
        let workbook = self.storage("loadWorkbook", &[text(from)]).await?;
        if !workbook.is_object() {
            return Err(HostError::new(format!("the workbook file of {from} is missing")));
        }
        self.storage("saveWorkbook", &[text(to), workbook]).await?;
        let scripts: Vec<RestoreScriptFile> = items(self.storage("loadScripts", &[text(from)]).await?, "the scripts")?;
        for script in &scripts {
            self.storage("saveScript", &[text(to), text(&script.name), text(&script.sql)]).await?;
        }
        let listed: Vec<WorkbookDataFile> =
            items(self.storage("listDataFiles", &[text(from)]).await?, "the data files")?;
        for file in &listed {
            let content = self.storage("loadDataFile", &[text(from), text(&file.name)]).await?;
            self.storage("saveDataFile", &[text(to), text(&file.name), content]).await?;
        }
        Ok(())
    }

    /// Write a bundle as workbook `target`: the workbook file, the scripts, the attachments. A write of a fresh target
    /// deletes the target when it fails.
    async fn write_bundle(
        &self,
        bundle: &WorkbookBundle<HostFile>,
        target: &str,
        fresh: bool,
        report: bool,
    ) -> Result<(), HostError> {
        let options = WorkbookBundleWriteOptions {
            target_workbook_id: Some(target.to_string()),
            suffix_name_with_copy: false,
            target_is_fresh: fresh,
        };
        let write = prepare_workbook_bundle_write(bundle, StorageType::Opfs, &options).map_err(format_error)?;
        let written = async {
            let workbook = JsonValue(write.workbook.to_json()).to_js().map_err(|e| HostError::new(e.to_string()))?;
            self.storage("saveWorkbook", &[text(&write.workbook_id), workbook]).await?;
            if report {
                self.steps.report("scripts", None);
            }
            for script in &bundle.scripts {
                self.storage("saveScript", &[text(&write.workbook_id), text(&script.name), text(&script.sql)]).await?;
            }
            if report {
                self.steps.report("attachments", None);
            }
            for file in &bundle.data {
                let content = self.platform.handle(file.bytes.handle);
                self.storage("saveDataFile", &[text(&write.workbook_id), text(&file.name), content]).await?;
            }
            Ok::<(), HostError>(())
        }
        .await;
        if written.is_err() && write.rollback_on_failure {
            // The error of the write is kept when the rollback fails as well
            let _ = self.storage("deleteWorkbook", &[text(&write.workbook_id)]).await;
        }
        written
    }

    /// Verify that the storage holds the scripts, the attachments (by their sizes) and the workbook file of a bundle
    async fn verify(&self, source: &WorkbookBundle<HostFile>, target: &str) -> Result<(), HostError> {
        let by_name = |a: &str, b: &str| a.cmp(b);
        let sized = |data: &[DataFileData<HostFile>]| -> Vec<DataFileData<u64>> {
            let mut data: Vec<DataFileData<u64>> =
                data.iter().map(|file| DataFileData { name: file.name.clone(), bytes: file.bytes.size }).collect();
            data.sort_by(|a, b| by_name(&a.name, &b.name));
            data
        };
        let sorted = |scripts: &[ScriptData]| -> Vec<ScriptData> {
            let mut scripts = scripts.to_vec();
            scripts.sort_by(|a, b| by_name(&a.name, &b.name));
            scripts
        };
        // The written workbook lists exactly the written scripts and attachments, the catalogs belong to the connections
        let mut workbook = WorkbookData {
            workbook_id: target.to_string(),
            workbook_path: None,
            storage_type: None,
            native_path: None,
            ..source.workbook.clone()
        };
        workbook = assemble_workbook_bundle(workbook, Vec::new(), source.scripts.clone(), sized(&source.data)).workbook;
        let expected = assemble_workbook_bundle(workbook, Vec::new(), sorted(&source.scripts), sized(&source.data));
        let stored = self.load_workbook(target).await?;
        let scripts: Vec<RestoreScriptFile> =
            items(self.storage("loadScripts", &[text(target)]).await?, "the scripts")?;
        let scripts: Vec<ScriptData> =
            scripts.into_iter().map(|script| ScriptData::new(script.name, script.sql)).collect();
        let listed: Vec<WorkbookDataFile> =
            items(self.storage("listDataFiles", &[text(target)]).await?, "the data files")?;
        let mut data: Vec<DataFileData<u64>> = listed
            .into_iter()
            .map(|file| DataFileData { name: file.name, bytes: file.size_bytes.max(0.0) as u64 })
            .collect();
        data.sort_by(|a, b| by_name(&a.name, &b.name));
        let actual = read_workbook_bundle(&stored, sorted(&scripts), Vec::new(), data);
        match describe_workbook_bundle_difference(&expected, &actual) {
            Some(difference) => {
                Err(HostError::new(format!("Workbook import verification failed for {target}: {difference}")))
            }
            None => Ok(()),
        }
    }

    /// Seed the catalogs of the connections from a bundle. A connection that has a catalog keeps it, the catalog of a
    /// bundle only describes a connection that is new to the app. The catalogs are a cache of the connections: a
    /// failure is logged, the import stands.
    async fn seed_catalogs(&self, bundle: &WorkbookBundle<HostFile>) {
        if let Err(error) = self.seed_catalog_files(bundle).await {
            let details = [("workbookId", bundle.workbook.workbook_id.as_str()), ("error", error.message())];
            self.platform.log_on(
                LogLevel::Warn,
                "Failed to seed the catalogs of an imported workbook",
                &details,
                "workbook_import",
            );
        }
    }

    async fn seed_catalog_files(&self, bundle: &WorkbookBundle<HostFile>) -> Result<(), HostError> {
        if !self.platform.storage_call("ownsConnections", &[]).is_ok_and(|owns| owns.is_truthy()) {
            return Ok(());
        }
        for catalog in &bundle.catalogs {
            let id = &catalog.connection_id;
            let relations = self.storage("loadConnectionFile", &[text(id), text(STORAGE_CATALOG_RELATIONS)]).await?;
            let functions = self.storage("loadConnectionFile", &[text(id), text(STORAGE_CATALOG_FUNCTIONS)]).await?;
            let has_catalog = relations.as_string().is_some() || functions.as_string().is_some();
            for (file_name, content) in catalog_seed_files(catalog, has_catalog) {
                self.storage("saveConnectionFile", &[text(id), text(file_name), text(&content)]).await?;
            }
        }
        Ok(())
    }

    /// Write a new workbook under an id that no workbook has, verify it and seed the catalogs. A failure deletes it.
    async fn write_fresh(&self, bundle: &WorkbookBundle<HostFile>, target: &str) -> Result<(), HostError> {
        if let Some(found) = find_workbook(&self.platform, target).await? {
            return Err(HostError::new(format!(
                "Workbook {} is already registered",
                entry_path(&found).unwrap_or(target)
            )));
        }
        let written = async {
            self.write_bundle(bundle, target, true, true).await?;
            self.verify(bundle, target).await
        }
        .await;
        if written.is_err() {
            // The error of the import is kept when the cleanup fails as well
            let _ = self.storage("deleteWorkbook", &[text(target)]).await;
            return written;
        }
        self.seed_catalogs(bundle).await;
        Ok(())
    }

    /// Replace a registered workbook with a bundle, staged and swapped: the bundle is written and verified as a staged
    /// copy, the files of the target are copied aside as they are, then the target is written and verified. A failure
    /// after the target changed writes the files that were copied aside back, whatever their format: a replacement is
    /// also the recovery of a workbook that the format can no longer read. The copy aside is deleted only once the
    /// replacement or the rollback succeeded: when both fail, it stays and the error names its folder.
    async fn replace_with_bundle(
        &self,
        bundle: &WorkbookBundle<HostFile>,
        conflict: &ImportConflict,
        staging: String,
        backup: String,
    ) -> Result<(), HostError> {
        let target = conflict.workbook_id.as_str();
        if bundle.workbook.workbook_id.to_lowercase() != target.to_lowercase() {
            return Err(HostError::new(format!(
                "Source workbook {} does not match replacement {target}",
                bundle.workbook.workbook_id
            )));
        }
        let old_entry = JsonValue(conflict.entry.0.clone()).to_js().map_err(|e| HostError::new(e.to_string()))?;
        // A native folder of the user is never changed, the files of the target in the origin private file system are
        // only its mirror
        let old_native = conflict.entry.0.get("storageType").and_then(Value::as_str) == Some("native");
        for id in [&staging, &backup] {
            if find_workbook(&self.platform, id).await?.is_some() {
                return Err(HostError::new(format!("Staging workbook {id} is already registered")));
            }
        }
        let mut copied = false;
        let mut swapped = false;
        let replaced = async {
            self.write_bundle(bundle, &staging, true, false).await?;
            self.verify(bundle, &staging).await?;
            if !old_native {
                copied = true;
                self.copy_workbook_files(target, &backup).await?;
            }
            // The entry first keeps the place of the workbook and routes it to the origin private file system
            let entry = crate::runtime::archives::object(&[("path", text(target)), ("storageType", text("opfs"))]);
            self.storage("upsertWorkbookEntry", &[entry]).await?;
            swapped = true;
            self.storage("deleteWorkbookFiles", &[text(target)]).await?;
            self.write_bundle(bundle, target, false, false).await?;
            self.verify(bundle, target).await
        }
        .await;
        // Every step of the rollback runs, the first failure is kept
        let mut rollback: Result<(), HostError> = Ok(());
        if replaced.is_err() && swapped {
            let deleted = self.storage("deleteWorkbookFiles", &[text(target)]).await.map(|_| ());
            let restored = if old_native { Ok(()) } else { self.copy_workbook_files(&backup, target).await };
            let entry = self.storage("upsertWorkbookEntry", &[old_entry]).await.map(|_| ());
            rollback = deleted.and(restored).and(entry);
        }
        let cleanup = self.storage("deleteWorkbook", &[text(&staging)]).await;
        match (&replaced, rollback) {
            // The files that were copied aside are the only full copy of the workbook when the rollback failed, they stay
            (Err(error), Err(rollback)) if copied => {
                let details = [
                    ("workbookId", target),
                    ("backupId", backup.as_str()),
                    ("error", error.message()),
                    ("rollbackError", rollback.message()),
                ];
                self.platform.log_on(
                    LogLevel::Error,
                    "Failed to restore a workbook after a failed replacement, its files are kept aside",
                    &details,
                    "workbook_import",
                );
                return Err(HostError::new(format!(
                    "{}; restoring the workbook failed as well ({}), its files are kept in the workbook folder {backup}",
                    error.message(),
                    rollback.message()
                )));
            }
            _ if copied => {
                let _ = self.storage("deleteWorkbook", &[text(&backup)]).await;
            }
            _ => {}
        }
        replaced?;
        self.seed_catalogs(bundle).await;
        cleanup.map(|_| ())
    }

    /// Register a native folder in place: the catalogs of the folder seed the connections that are new to the app, the
    /// platform adds the folder to the workbook tree and the runtime migrates it when it reads it
    async fn register_native(
        &self,
        bundle: &WorkbookBundle<HostFile>,
        dir: &str,
        workbook_id: &str,
    ) -> Result<(), HostError> {
        if let Err(error) = validate_workbook_data(&bundle.workbook) {
            return Err(HostError::new(format!("Workbook in {dir} is invalid: {}", error.describe())));
        }
        self.seed_catalogs(bundle).await;
        self.storage("registerNativeWorkbook", &[text(dir), text(workbook_id)]).await?;
        // The same workbook may have been deleted before
        self.storage.revive_workbook(workbook_id);
        // The file lists of the workbook file follow the files of the folder, the workbook file is written only when
        // they changed
        let stored = self.load_workbook(workbook_id).await?;
        let scripts: Vec<RestoreScriptFile> =
            items(self.storage("loadScripts", &[text(workbook_id)]).await?, "the scripts")?;
        let scripts: Vec<String> = scripts.into_iter().map(|script| script.name).collect();
        let listed: Vec<WorkbookDataFile> =
            items(self.storage("listDataFiles", &[text(workbook_id)]).await?, "the data files")?;
        let data: Vec<String> = listed.into_iter().map(|file| file.name).collect();
        let reconciled = reconcile_stored_workbook_files(&stored, &scripts, &data);
        if reconciled.write {
            let workbook = reconciled.workbook;
            let task = WriteTask::WriteWorkbookScripts {
                workbook_id: workbook_id.to_string(),
                scripts: workbook.scripts,
                connections: workbook.connections,
            };
            self.patch(task, "the script list").await?;
            self.patch(
                WriteTask::RefreshWorkbookAttachments { workbook_id: workbook_id.to_string() },
                "the attachment list",
            )
            .await?;
        }
        Ok(())
    }

    /// Replace a registered workbook with a native folder. The folder of the user is never changed, the files of an
    /// old workbook of the origin private file system go once the folder is registered.
    async fn replace_with_native(
        &self,
        bundle: &WorkbookBundle<HostFile>,
        dir: &str,
        conflict: &ImportConflict,
    ) -> Result<(), HostError> {
        let target = conflict.workbook_id.as_str();
        if bundle.workbook.workbook_id.to_lowercase() != target.to_lowercase() {
            return Err(HostError::new(format!(
                "Source workbook {} does not match replacement {target}",
                bundle.workbook.workbook_id
            )));
        }
        let storage_type = conflict.entry.0.get("storageType").and_then(Value::as_str);
        if storage_type == Some("native") && conflict.entry.0.get("nativePath").and_then(Value::as_str) == Some(dir) {
            return Ok(());
        }
        // The storage deletes the files of an old workbook of the origin private file system once the folder is
        // registered under its id
        self.register_native(bundle, dir, target).await
    }

    /// Write the resolved connection references into a registered workbook: its script list with the copies of the
    /// connections it uses
    async fn write_connection_refs(&self, workbook_id: &str, resolved: &WorkbookData) -> Result<(), HostError> {
        let task = WriteTask::WriteWorkbookScripts {
            workbook_id: workbook_id.to_string(),
            scripts: resolved.scripts.clone(),
            connections: resolved.connections.clone(),
        };
        self.patch(task, "the connection references").await
    }
}

/// Is a value a function?
pub(crate) fn function_of(value: JsValue, what: &str) -> Result<Option<Function>, JsError> {
    if value.is_undefined() || value.is_null() {
        return Ok(None);
    }
    value.dyn_into::<Function>().map(Some).map_err(|_| JsError::new(&format!("the {what} is no function")))
}
