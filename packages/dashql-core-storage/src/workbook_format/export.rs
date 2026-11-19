//! The export of a workbook as a `.dashql` archive or a link.
//!
//! The host reads the bundle of the workbook, writes the workbook tables as Parquet with the embedded Hyper (from the
//! Arrow IPC of `WorkbookTables::encode_table`) and adds the entries of `workbook_archive_entries` to a ZIP.

use std::collections::HashMap;

use base64::Engine;
use serde_json::Value;

use dashql_core::error::Result;

use crate::workbook_format::bundle::{prune_bundle_connections, regenerate_connection_ids, WorkbookBundle, WorkbookBundleCatalog, WorkbookBundleResult};
use crate::workbook_format::catalog::CatalogSql;
use crate::workbook_format::data::{WorkbookConnection, WorkbookData, WorkbookMetadata, WORKBOOK_FORMAT_VERSION};
use crate::workbook_format::layout::{validate_data_file_name, DRAFT_SCRIPT_FILE};
use dashql_core_runtime::connections::sharing::sanitize_connection_params_for_sharing;
use crate::workbook_format::tables::{workbook_bundle_to_tables, workbook_table_file_name, WorkbookTableName, WorkbookTables, RESULT_TABLE_PREFIX};

/// The parameter of a link that carries a `.dashql` archive inline, base64url-encoded
pub const ZIP_QUERY_PARAMETER: &str = "zip";
/// The base of a link that the desktop app opens
pub const DESKTOP_APP_LINK_BASE: &str = "dashql://localhost";

/// The workbook tables of a bundle that leaves the app, in a `.dashql` file or in a cloud: the connection params are
/// sanitized for sharing, drafts and the names the schema doesn't know stay behind, and so do the draft script and the
/// link to a published workbook of a cloud.
pub fn shared_workbook_tables<B: Clone>(
    bundle: &WorkbookBundle<B>,
    catalog_sql: &dyn CatalogSql,
    new_uuid: &mut dyn FnMut() -> String,
) -> Result<WorkbookTables<B>> {
    let mut sanitized = bundle.clone();
    sanitized.workbook.metadata = WorkbookMetadata { cloud: None, ..bundle.workbook.metadata.clone() };
    sanitized.workbook.connections = bundle
        .workbook
        .connections
        .iter()
        .map(|connection| WorkbookConnection {
            name: connection.name.clone(),
            ..WorkbookConnection::new(connection.connection_id.clone(), sanitize_connection_params_for_sharing(&connection.params, true))
        })
        .collect();
    sanitized.scripts.retain(|script| script.name.to_lowercase() != DRAFT_SCRIPT_FILE);
    for file in &sanitized.data {
        validate_data_file_name(&file.name)?;
    }
    workbook_bundle_to_tables(&sanitized, catalog_sql, new_uuid)
}

/// How the host compresses an entry of an archive
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryCompression {
    /// Deflated, the workbook tables and the attachments
    Deflate,
    /// Stored as it is, a query result that an import reads in place as a slice of the archive
    Stored,
}

/// Where the bytes of an entry come from
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArchiveEntrySource {
    /// A workbook table, the host writes the Arrow IPC of its rows as Parquet
    Table(WorkbookTableName),
    /// The Parquet file of an attachment or a result table of `WorkbookTables::data`
    Data(String),
}

/// An entry of a `.dashql` archive, in the order the host adds them
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveWriteEntry {
    /// The file name of the entry
    pub file_name: String,
    /// The bytes
    pub source: ArchiveEntrySource,
    /// The compression
    pub compression: EntryCompression,
}

/// The entries of the archive of workbook tables: the tables with rows, the workbook first, then the data tables.
/// Empty tables are left out, an import reads a missing table as one without rows.
pub fn workbook_archive_entries<B>(tables: &WorkbookTables<B>) -> Vec<ArchiveWriteEntry> {
    let mut entries: Vec<ArchiveWriteEntry> = WorkbookTableName::ALL
        .into_iter()
        .filter(|table| tables.row_count(*table) > 0)
        .map(|table| ArchiveWriteEntry { file_name: table.file_name(), source: ArchiveEntrySource::Table(table), compression: EntryCompression::Deflate })
        .collect();
    entries.extend(tables.data.iter().map(|(table_name, _)| ArchiveWriteEntry {
        file_name: workbook_table_file_name(table_name),
        source: ArchiveEntrySource::Data(table_name.clone()),
        compression: if table_name.starts_with(RESULT_TABLE_PREFIX) { EntryCompression::Stored } else { EntryCompression::Deflate },
    }));
    entries
}

/// The options of the export of a shared workbook
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SharedWorkbookExportOptions {
    /// Carry the login hint of the sharer, true if absent
    pub with_login_hint: Option<bool>,
    /// Include the catalogs of the connections, true for files and false for links if absent
    pub with_catalog: Option<bool>,
    /// Keep the workbook and connection ids instead of fresh ones
    pub preserve_uuids: bool,
    /// The names the user gave the connections, an import names new connections after them
    pub connection_names: HashMap<String, String>,
}

impl SharedWorkbookExportOptions {
    /// Does the export read the catalogs of the connections? Links leave them out by default.
    pub fn with_catalog(&self, link: bool) -> bool {
        self.with_catalog.unwrap_or(!link)
    }
}

/// The bundle of a workbook that is exported: only the connections that the scripts use, with the query results of a
/// file export (never those of a link)
pub fn exported_bundle<B>(mut bundle: WorkbookBundle<B>, results: Vec<WorkbookBundleResult<B>>) -> WorkbookBundle<B> {
    let (workbook, catalogs) = prune_bundle_connections(&bundle.workbook, &bundle.catalogs);
    bundle.workbook = workbook;
    bundle.catalogs = catalogs;
    bundle.results = results;
    bundle
}

/// The workbook file and catalogs of a shared export: the live params of the connections, sanitized, with the names
/// the user gave them. Unless the ids are preserved, the workbook and its connections get fresh ids and the catalogs
/// follow their connections.
pub fn shared_export_head(
    workbook: &WorkbookData,
    catalogs: &[WorkbookBundleCatalog],
    live_params: &HashMap<String, Value>,
    options: &SharedWorkbookExportOptions,
    new_uuid: &mut dyn FnMut() -> String,
) -> (WorkbookData, Vec<WorkbookBundleCatalog>) {
    let with_login_hint = options.with_login_hint.unwrap_or(true);
    let connections = workbook
        .connections
        .iter()
        .map(|connection| {
            let params = live_params.get(&connection.connection_id).unwrap_or(&connection.params);
            let mut next = connection.clone();
            next.params = sanitize_connection_params_for_sharing(params, with_login_hint);
            if let Some(name) = options.connection_names.get(&connection.connection_id) {
                next.name = Some(name.clone());
            }
            next
        })
        .collect();
    let sanitized = WorkbookData { connections, ..workbook.clone() };
    if options.preserve_uuids {
        return (sanitized, catalogs.to_vec());
    }
    let fresh = WorkbookData { workbook_id: new_uuid(), ..sanitized };
    regenerate_connection_ids(&fresh, catalogs, new_uuid)
}

/// The workbook of a shared connection: a workbook without scripts that holds only the connection, with fresh ids
pub fn connection_link_workbook(
    params: &Value,
    name: Option<&str>,
    with_login_hint: bool,
    created_at: &str,
    new_uuid: &mut dyn FnMut() -> String,
) -> WorkbookData {
    let workbook_id = new_uuid();
    let connection = WorkbookConnection {
        name: name.map(str::to_string),
        ..WorkbookConnection::new(new_uuid(), sanitize_connection_params_for_sharing(params, with_login_hint))
    };
    WorkbookData {
        format_version: WORKBOOK_FORMAT_VERSION,
        workbook_id,
        connections: vec![connection],
        metadata: WorkbookMetadata { created_at: Some(created_at.to_string()), ..WorkbookMetadata::default() },
        ..WorkbookData::default()
    }
}

/// A link that carries an archive inline, base64url-encoded once in the `zip` parameter. The URL of an http(s) app
/// without a path gets the path `/`, like `new URL` writes it.
pub fn workbook_link(archive: &[u8], link_base: &str) -> String {
    let zip = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(archive);
    let mut base = link_base.to_string();
    if let Some(authority) = base.strip_prefix("https://").or_else(|| base.strip_prefix("http://")) {
        if !authority.contains('/') {
            base.push('/');
        }
    }
    format!("{base}?{ZIP_QUERY_PARAMETER}={zip}")
}
