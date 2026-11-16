//! The exports of workbooks: a `.dashql` file, a link that carries the archive, the workbook tables of a cloud, and the
//! link of a connection (docs/design/dashql_core.md, docs/design/workbook_tables.md).
//!
//! The runtime reads the workbook from the storage of the platform, the cached results of its scripts from the query
//! result cache (retained while the export reads them) and the live params and names of its connections from its
//! registry. The format of the crate sanitizes the bundle for sharing and turns it into the workbook tables. The
//! platform writes the tables as Parquet and the archive as a ZIP (`archives`), the attachments and results go into it
//! by handle.

use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;

use dashql_core_runtime::host::{HostError, LogLevel};
use dashql_core_runtime::workbook_format::bundle::{WorkbookBundle, WorkbookBundleResult};
use dashql_core_runtime::workbook_format::catalog::CoreCatalogSql;
use dashql_core_runtime::workbook_format::export::{
    connection_link_workbook, exported_bundle, shared_export_head, shared_workbook_tables, workbook_archive_entries, workbook_link,
    ArchiveEntrySource, EntryCompression, SharedWorkbookExportOptions,
};
use dashql_core_runtime::workbook_format::tables::{ColumnType, WorkbookTableName, WorkbookTables};
use js_sys::{Function, Promise, Uint8Array};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tsify::Tsify;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use super::archives::{bytes_value, list, object, table_rows, HostFile, HostFiles};
use super::connections::Connections;
use super::runs::Runs;
use super::workbooks::Workbooks;
use crate::host::{host_error, JsPlatform};
use crate::views::JsonValue;

/// What an export writes
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    /// A `.dashql` archive, a Blob of the handle table
    #[default]
    Archive,
    /// A link that carries the archive inline, without the cached results
    Link,
    /// The workbook tables, e.g. for a cloud: the rows and the Parquet files of the attachments and results by handle
    Tables,
}

/// The options of an export of a workbook
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    /// What the export writes
    #[serde(default)]
    #[tsify(optional)]
    pub format: ExportFormat,
    /// Carry the cached query results of the scripts, a link never does
    #[serde(default)]
    #[tsify(optional)]
    pub results: Option<bool>,
    /// Carry the catalogs of the connections, true for files and tables and false for links if absent
    #[serde(default)]
    #[tsify(optional)]
    pub with_catalog: Option<bool>,
    /// Carry the login hint of the sharer in the params, true if absent
    #[serde(default)]
    #[tsify(optional)]
    pub with_login_hint: Option<bool>,
    /// Keep the workbook and connection ids instead of fresh ones
    #[serde(default)]
    #[tsify(optional)]
    pub preserve_uuids: Option<bool>,
    /// The URL of the app that opens a link
    #[serde(default)]
    #[tsify(optional)]
    pub link_base: Option<String>,
}

/// The options of the link of a connection
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionLinkOptions {
    /// Carry the login hint of the sharer in the params, true if absent
    #[serde(default)]
    #[tsify(optional)]
    pub with_login_hint: Option<bool>,
    /// The URL of the app that opens the link
    pub link_base: String,
}

/// The cached results of the scripts of a workbook
#[derive(Clone, Debug, Default, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ExportedResults {
    /// The scripts with a cached result
    pub cached_scripts: u32,
    /// The scripts
    pub total_scripts: u32,
    /// The files of the results, one per key
    pub files: u32,
    /// The bytes of the files. An archive stores them as they are, it grows by about as much.
    pub bytes: f64,
}

/// What an export wrote
#[derive(Clone, Debug, Default, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ExportOutcome {
    /// The archive, a Blob of the handle table that the caller releases
    pub archive: Option<u32>,
    /// The link
    pub link: Option<String>,
    /// The cached results that the export carries
    pub results: ExportedResults,
}

/// The services that an export reads
#[derive(Clone)]
pub(crate) struct Exports {
    pub platform: JsPlatform,
    pub connections: Rc<Connections>,
    pub workbooks: Rc<Workbooks>,
    pub runs: Rc<Runs>,
}

/// A cached result that an export keeps until it ends
struct RetainedResults {
    platform: JsPlatform,
    ids: Vec<u64>,
}

impl RetainedResults {
    /// Let go of the files, the cache may evict them again
    async fn release(self) {
        for id in self.ids {
            self.platform.cache_release(id).await;
        }
    }
}

/// An error of the format as an error of the host
fn format_error(error: dashql_core::error::Error) -> HostError {
    HostError::new(error.what())
}

impl Exports {
    /// Fresh ids of the platform. An id that the platform fails to make marks `failed`, the export fails then
    /// instead of writing an empty id.
    fn new_uuid<'a>(&'a self, failed: &'a Cell<bool>) -> impl FnMut() -> String + 'a {
        move || {
            self.platform.random_uuid().unwrap_or_else(|_| {
                failed.set(true);
                String::new()
            })
        }
    }

    /// The live params and the names of the connections of the runtime
    fn live_connections(&self, ids: impl Iterator<Item = String>) -> (HashMap<String, Value>, HashMap<String, String>) {
        let registry = self.connections.registry.borrow();
        let mut params = HashMap::new();
        let mut names = HashMap::new();
        for id in ids {
            let Some(connection) = registry.get(&id) else { continue };
            let Ok(state) = connection.state.try_borrow() else { continue };
            params.insert(id.clone(), Value::Object(state.params().to_object()));
            if let Some(name) = state.name() {
                names.insert(id, name.to_string());
            }
        }
        (params, names)
    }

    /// The reusable result keys of the scripts of a workbook
    async fn result_keys(&self, workbook_id: &str) -> Result<Vec<Option<String>>, HostError> {
        Ok(self.runs.result_keys(workbook_id, None).map_err(HostError::new)?.await)
    }

    /// Count the cached results of the scripts of a workbook without reading them
    pub async fn result_counts(&self, workbook_id: &str) -> Result<ExportedResults, HostError> {
        let keys = self.result_keys(workbook_id).await?;
        let mut sizes: Vec<(String, Option<f64>)> = Vec::new();
        let mut counts = ExportedResults { total_scripts: keys.len() as u32, ..ExportedResults::default() };
        for key in keys.into_iter().flatten() {
            let size = match sizes.iter().find(|(known, _)| *known == key) {
                Some((_, size)) => *size,
                None => {
                    let entry = self.platform.cache_lookup(&key).await?;
                    let size = crate::host::field(&entry, "size").and_then(|size| size.as_f64()).or_else(|| entry.is_object().then_some(0.0));
                    if let Some(size) = size {
                        counts.files += 1;
                        counts.bytes += size;
                    }
                    sizes.push((key, size));
                    size
                }
            };
            if size.is_some() {
                counts.cached_scripts += 1;
            }
        }
        Ok(counts)
    }

    /// Retain the cached results of the scripts of a workbook under the keys that a run of the workbook reads
    async fn retain_results(&self, workbook_id: &str, files: &HostFiles, retained: &mut RetainedResults) -> Result<(Vec<WorkbookBundleResult<HostFile>>, ExportedResults), HostError> {
        let keys = self.result_keys(workbook_id).await?;
        let mut counts = ExportedResults { total_scripts: keys.len() as u32, ..ExportedResults::default() };
        let mut results: Vec<WorkbookBundleResult<HostFile>> = Vec::new();
        let mut missing: Vec<String> = Vec::new();
        for key in keys.into_iter().flatten() {
            if results.iter().any(|result| result.key == key) {
                counts.cached_scripts += 1;
                continue;
            }
            if missing.contains(&key) {
                continue;
            }
            let Some((id, name)) = self.platform.cache_retain(&key).await? else {
                missing.push(key);
                continue;
            };
            retained.ids.push(id);
            let file = files.keep(&self.platform.cache_call("file", &[JsValue::from_str(&name)]).await?)?;
            counts.files += 1;
            counts.bytes += file.size as f64;
            counts.cached_scripts += 1;
            results.push(WorkbookBundleResult { key, bytes: file, crc32: None });
        }
        Ok((results, counts))
    }

    /// Export a workbook. A table export hands the tables to `consume` and resolves once it settled, the files of the
    /// tables stay readable until then.
    pub async fn export_workbook(self, workbook_id: String, options: ExportOptions, consume: Option<Function>) -> Result<ExportOutcome, HostError> {
        // The export reads the workbook from the storage, with the changes that are pending. A workbook whose changes
        // didn't reach the storage, or that a change outside the app holds, isn't exported: the export would miss
        // what the app shows.
        if !self.workbooks.writer.flush_workbook(&workbook_id).await {
            let writer = &self.workbooks.writer;
            let reason = match writer.failed_writes_for_workbook(&workbook_id).first() {
                Some(failed) => format!("saving {} failed: {}", failed.key, failed.error),
                None if writer.is_workbook_held(&workbook_id) => "its writes are held, e.g. a file changed outside the app".to_string(),
                None => "its changes are not saved yet".to_string(),
            };
            let message = format!("The workbook can't be exported, {reason}");
            self.platform.log_on(LogLevel::Warn, &message, &[("workbookId", workbook_id.as_str())], "workbook_export");
            return Err(HostError::new(message));
        }
        let files = HostFiles::new(self.platform.clone());
        let mut retained = RetainedResults { platform: self.platform.clone(), ids: Vec::new() };
        let outcome = self.export_retained(&workbook_id, &options, consume, &files, &mut retained).await;
        retained.release().await;
        files.release();
        if let Err(error) = &outcome {
            let details = [("workbookId", workbook_id.as_str()), ("error", error.message())];
            self.platform.log_on(LogLevel::Warn, "Exporting a workbook failed", &details, "workbook_export");
        }
        outcome
    }

    async fn export_retained(
        &self,
        workbook_id: &str,
        options: &ExportOptions,
        consume: Option<Function>,
        files: &HostFiles,
        retained: &mut RetainedResults,
    ) -> Result<ExportOutcome, HostError> {
        let link = options.format == ExportFormat::Link;
        let mut shared = SharedWorkbookExportOptions {
            with_login_hint: options.with_login_hint,
            with_catalog: options.with_catalog,
            preserve_uuids: options.preserve_uuids.unwrap_or(false),
            connection_names: HashMap::new(),
        };
        let bundle = super::archives::read_stored_bundle(&self.platform, files, workbook_id, shared.with_catalog(link)).await?;
        let (results, counts) = if !link && options.results.unwrap_or(false) {
            self.retain_results(workbook_id, files, retained).await?
        } else {
            (Vec::new(), ExportedResults::default())
        };
        let mut bundle = exported_bundle(bundle, results);
        let (params, names) = self.live_connections(bundle.workbook.connections.iter().map(|connection| connection.connection_id.clone()));
        shared.connection_names = names;
        let failed = Cell::new(false);
        let (workbook, catalogs) = shared_export_head(&bundle.workbook, &bundle.catalogs, &params, &shared, &mut self.new_uuid(&failed));
        bundle.workbook = workbook;
        bundle.catalogs = catalogs;
        let tables = shared_workbook_tables(&bundle, &CoreCatalogSql, &mut self.new_uuid(&failed)).map_err(format_error)?;
        if failed.get() {
            return Err(HostError::new("the platform made no fresh id for the export"));
        }
        let mut outcome = ExportOutcome { results: counts, ..ExportOutcome::default() };
        match options.format {
            ExportFormat::Archive => {
                let archive = write_archive(&self.platform, &tables).await?;
                outcome.archive = Some(self.platform.register(&archive)?);
            }
            ExportFormat::Link => {
                let base = options.link_base.as_deref().ok_or_else(|| HostError::new("a link needs the URL of the app"))?;
                outcome.link = Some(archive_link(&self.platform, files, &tables, base).await?);
            }
            ExportFormat::Tables => {
                let consume = consume.ok_or_else(|| HostError::new("an export of the workbook tables needs a consumer"))?;
                let value = tables_value(&tables)?;
                let promise = consume.call1(&JsValue::NULL, &value).map_err(host_error)?;
                JsFuture::from(Promise::resolve(&promise)).await.map_err(host_error)?;
            }
        }
        Ok(outcome)
    }

    /// The link of a connection: an empty workbook that holds only the connection, with fresh ids and the params
    /// sanitized for sharing
    pub async fn export_connection(self, connection_id: String, options: ConnectionLinkOptions) -> Result<String, HostError> {
        let (params, names) = self.live_connections(std::iter::once(connection_id.clone()));
        let params = params.get(&connection_id).cloned().ok_or_else(|| HostError::new(format!("no connection registered with id {connection_id}")))?;
        let created_at = js_sys::Date::new_0().to_iso_string().as_string().unwrap_or_default();
        let name = names.get(&connection_id).map(String::as_str);
        let failed = Cell::new(false);
        let workbook = connection_link_workbook(&params, name, options.with_login_hint.unwrap_or(true), &created_at, &mut self.new_uuid(&failed));
        let bundle: WorkbookBundle<HostFile> = WorkbookBundle { workbook, catalogs: Vec::new(), scripts: Vec::new(), data: Vec::new(), results: Vec::new() };
        let tables = shared_workbook_tables(&bundle, &CoreCatalogSql, &mut self.new_uuid(&failed)).map_err(format_error)?;
        if failed.get() {
            return Err(HostError::new("the platform made no fresh id for the link"));
        }
        let files = HostFiles::new(self.platform.clone());
        archive_link(&self.platform, &files, &tables, &options.link_base).await
    }
}

/// Write the archive of workbook tables with the platform: the tables with rows as Parquet, the workbook first, then
/// the Parquet files of the attachments and results as they are. Returns the Blob of the archive.
pub(crate) async fn write_archive(platform: &JsPlatform, tables: &WorkbookTables<HostFile>) -> Result<JsValue, HostError> {
    let mut entries = Vec::new();
    for entry in workbook_archive_entries(tables) {
        // A query result stays stored, an import reads it in place as a slice of the archive
        let stored = JsValue::from_bool(entry.compression == EntryCompression::Stored);
        let (table, file) = match &entry.source {
            ArchiveEntrySource::Table(table) => (bytes_value(&tables.encode_table(*table).map_err(format_error)?), JsValue::NULL),
            ArchiveEntrySource::Data(table_name) => {
                let file = tables
                    .data
                    .iter()
                    .find(|(name, _)| name == table_name)
                    .map(|(_, file)| file.bytes.handle)
                    .ok_or_else(|| HostError::new(format!("Missing data table: {table_name}")))?;
                (JsValue::NULL, JsValue::from_f64(file as f64))
            }
        };
        entries.push(object(&[("fileName", JsValue::from_str(&entry.file_name)), ("stored", stored), ("table", table), ("file", file)]));
    }
    platform.archives_call("write", &[list(entries)]).await
}

/// Write the archive of workbook tables and encode it as a link
async fn archive_link(platform: &JsPlatform, files: &HostFiles, tables: &WorkbookTables<HostFile>, link_base: &str) -> Result<String, HostError> {
    let archive = files.keep(&write_archive(platform, tables).await?)?;
    let bytes = platform.archives_call("bytes", &[JsValue::from_f64(archive.handle as f64)]).await?;
    if !bytes.is_object() {
        return Err(HostError::new("the archive has no bytes"));
    }
    Ok(workbook_link(&Uint8Array::new(&bytes).to_vec(), link_base))
}

/// The workbook tables as a JS object: the rows of each table by its name, and the Parquet files of the attachment
/// and result tables by handle
fn tables_value(tables: &WorkbookTables<HostFile>) -> Result<JsValue, HostError> {
    let rows = js_sys::Object::new();
    for table in WorkbookTableName::ALL {
        let value = JsonValue(table_rows(tables, table)).to_js().map_err(|e| HostError::new(e.to_string()))?;
        let _ = js_sys::Reflect::set(&rows, &JsValue::from_str(table.name()), &value);
    }
    let data = tables.data.iter().map(|(table_name, file)| {
        let crc32 = file.crc32.map(|crc| JsValue::from_f64(crc as f64)).unwrap_or(JsValue::NULL);
        object(&[
            ("tableName", JsValue::from_str(table_name)),
            ("file", JsValue::from_f64(file.bytes.handle as f64)),
            ("size", JsValue::from_f64(file.bytes.size as f64)),
            ("crc32", crc32),
        ])
    });
    Ok(object(&[("rows", rows.into()), ("data", list(data))]))
}

/// The type of a column of a workbook table
#[derive(Clone, Copy, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum WorkbookTableColumnType {
    Text,
    Integer,
    Boolean,
}

/// A column of a workbook table
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookTableColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub column_type: WorkbookTableColumnType,
    pub nullable: bool,
}

/// A workbook table of the format with its columns
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookTableSchema {
    pub name: String,
    pub columns: Vec<WorkbookTableColumn>,
}

/// The workbook tables of the format with their columns, the schema of a cloud
pub(crate) fn workbook_table_schemas() -> Vec<WorkbookTableSchema> {
    WorkbookTableName::ALL
        .iter()
        .map(|table| WorkbookTableSchema {
            name: table.name().to_string(),
            columns: table
                .columns()
                .iter()
                .map(|column| WorkbookTableColumn {
                    name: column.name.to_string(),
                    column_type: match column.column_type {
                        ColumnType::Text => WorkbookTableColumnType::Text,
                        ColumnType::Integer => WorkbookTableColumnType::Integer,
                        ColumnType::Boolean => WorkbookTableColumnType::Boolean,
                    },
                    nullable: column.nullable,
                })
                .collect(),
        })
        .collect()
}
