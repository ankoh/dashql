//! The import of a `.dashql` archive.
//!
//! The ZIP stays with the host: it lists the entries of the archive, `plan_archive` decides what each entry is and
//! what the host reads of it, and the host hands back what it read. An archive with `workbook.parquet` holds the
//! workbook tables (`docs/design/workbook_tables.md`), the host scans them with the embedded Hyper into Arrow IPC.
//! Archives of older versions hold the files of a workbook folder.

use std::collections::HashSet;

use dashql_core::error::{Error, Result};

use crate::workbook_format::bundle::{
    assemble_workbook_bundle, check_workbook_bundle, is_bundle_catalog_path, read_workbook_bundle_head, DataFileData, ScriptData, WorkbookBundle, WorkbookBundleResult,
};
use crate::workbook_format::layout::{validate_data_file_name, DRAFT_SCRIPT_FILE, STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER};
use crate::workbook_format::migration::MigrationFolder;
use dashql_core_runtime::natural::sort_naturally;
use crate::workbook_format::query_results::{workbook_result_key, WORKBOOK_RESULTS_FOLDER};
use crate::workbook_format::tables::{is_data_table_name, WorkbookTableName, WorkbookTables, RESULT_TABLE_PREFIX, TABLE_FILE_EXTENSION};

/// The error prefix of archives
pub const ARCHIVE_ERROR_PREFIX: &str = "Invalid ZIP";

/// An entry of an archive as the host lists it
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveEntry {
    /// The file name of the entry, a path
    pub filename: String,
    /// Is it a directory?
    pub directory: bool,
}

fn archive_error(message: impl std::fmt::Display) -> Error {
    Error::invalid_argument(format!("{ARCHIVE_ERROR_PREFIX}: {message}"))
}

/// Normalize the path of an entry: slashes, no empty or `.` parts. Absolute paths, `..` and NUL fail.
pub fn normalize_bundle_path(input: &str) -> Result<String> {
    if input.contains('\0') {
        return Err(archive_error(format!("NUL in path {input}")));
    }
    let path = input.replace('\\', "/");
    if path.starts_with('/') {
        return Err(archive_error(format!("absolute path {input}")));
    }
    let mut parts = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(archive_error(format!("path traversal {input}")));
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

/// The key under which two paths denote the same destination
pub fn destination_key(path: &str) -> String {
    path.to_lowercase()
}

/// Is a key the key of a top-level file of a workbook folder? Older versions name the files differently.
fn is_top_level_file(key: &str) -> bool {
    !key.contains('/') && key.starts_with("dashql-")
}

/// Is a path a file of a workbook folder that an import reads?
fn is_bundle_file(path: &str) -> bool {
    let key = destination_key(path);
    is_top_level_file(&key)
        || is_bundle_catalog_path(path)
        || key.starts_with(&format!("{STORAGE_ATTACHMENTS_FOLDER}/"))
        || key.starts_with(&format!("{WORKBOOK_RESULTS_FOLDER}/"))
        || (key.starts_with(&format!("{STORAGE_SCRIPTS_FOLDER}/")) && key.ends_with(".sql"))
}

/// Check the path of an attachment: directly inside `attachments/`, a valid attachment name
fn validate_data_path(path: &str) -> Result<()> {
    let prefix = format!("{STORAGE_ATTACHMENTS_FOLDER}/");
    if !path.replace('\\', "/").to_lowercase().starts_with(&prefix) || path.to_lowercase() == prefix {
        return Ok(());
    }
    let parts: Vec<&str> = path.split('/').collect();
    match parts.as_slice() {
        [folder, name] if folder.to_lowercase() == STORAGE_ATTACHMENTS_FOLDER => validate_data_file_name(name),
        _ => Err(archive_error(format!("attachments must be directly inside attachments/: {path}"))),
    }
}

/// What an entry of a table archive is
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TableArchiveEntry {
    /// A workbook table, the host scans its Parquet file into Arrow IPC (`WorkbookTables::decode_table`)
    Table(WorkbookTableName),
    /// The Parquet file of an attachment or a result table. The host keeps a result stored as a slice of the archive
    /// (`stored_slice`) with the CRC-32 of the entry, and reads every other file with its CRC-32 checked.
    Data { table_name: String, stored_slice: bool },
}

/// What an entry of an archive of a workbook folder is
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FolderArchiveEntry {
    /// A top-level file or a catalog file, read as text into the migration folder under the path
    Text { path: String },
    /// A script, read as text
    Script { name: String },
    /// An attachment, read as bytes
    Attachment { name: String },
    /// A cached query result, a slice of the archive if it is stored, else inflated with its CRC-32 checked
    Result { key: String },
}

/// What the host reads of an archive
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArchivePlan {
    /// An archive of workbook tables, the entries by their index in the listing. Reading it needs the embedded Hyper.
    Tables(Vec<(usize, TableArchiveEntry)>),
    /// An archive of a workbook folder of an older version, the entries by their index in the listing: the texts,
    /// the scripts and the attachments in natural order, then the results
    Folder(FolderArchivePlan),
}

/// The entries of an archive of a workbook folder
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FolderArchivePlan {
    /// The entries to read, by their index in the listing
    pub entries: Vec<(usize, FolderArchiveEntry)>,
    /// An error of the scripts, raised after the workbook file was read like the app does
    pub script_error: Option<String>,
}

/// The file name of the workbook table, it marks an archive of workbook tables
fn workbook_table_file() -> String {
    WorkbookTableName::Workbook.file_name()
}

/// Decide what the entries of an archive are. Fails on paths that escape, duplicates and misplaced files.
pub fn plan_archive(entries: &[ArchiveEntry]) -> Result<ArchivePlan> {
    let marker = workbook_table_file();
    if entries.iter().any(|entry| !entry.directory && destination_key(&entry.filename) == marker) {
        plan_table_archive(entries).map(ArchivePlan::Tables)
    } else {
        plan_folder_archive(entries).map(ArchivePlan::Folder)
    }
}

fn plan_table_archive(entries: &[ArchiveEntry]) -> Result<Vec<(usize, TableArchiveEntry)>> {
    let mut plan = Vec::new();
    let mut seen = HashSet::new();
    for (index, entry) in entries.iter().enumerate() {
        let path = normalize_bundle_path(&entry.filename)?;
        if entry.directory || path.contains('/') || !destination_key(&path).ends_with(TABLE_FILE_EXTENSION) {
            continue;
        }
        let Some(table_name) = path.len().checked_sub(TABLE_FILE_EXTENSION.len()).and_then(|end| path.get(..end)) else {
            continue;
        };
        if !seen.insert(destination_key(table_name)) {
            return Err(archive_error(format!("duplicate table {path}")));
        }
        if let Some(table) = WorkbookTableName::parse(table_name) {
            plan.push((index, TableArchiveEntry::Table(table)));
        } else if is_data_table_name(table_name) {
            plan.push((index, TableArchiveEntry::Data { table_name: table_name.to_string(), stored_slice: table_name.starts_with(RESULT_TABLE_PREFIX) }));
        }
    }
    Ok(plan)
}

fn plan_folder_archive(entries: &[ArchiveEntry]) -> Result<FolderArchivePlan> {
    let mut destinations: Vec<(String, String, usize)> = Vec::new();
    let mut keys = HashSet::new();
    for (index, entry) in entries.iter().enumerate() {
        validate_data_path(&entry.filename)?;
        let path = normalize_bundle_path(&entry.filename)?;
        validate_data_path(&path)?;
        if entry.directory || !is_bundle_file(&path) {
            continue;
        }
        let key = destination_key(&path);
        if !keys.insert(key.clone()) {
            return Err(archive_error(format!("duplicate destination {path}")));
        }
        destinations.push((key, path, index));
    }
    let mut plan = FolderArchivePlan::default();
    // The top-level files are migrated in memory, the scripts and attachments are read as they are
    for (key, path, index) in &destinations {
        if is_top_level_file(key) || is_bundle_catalog_path(path) {
            let path = if is_bundle_catalog_path(path) { path.clone() } else { key.clone() };
            plan.entries.push((*index, FolderArchiveEntry::Text { path }));
        }
    }
    let scripts_prefix = format!("{STORAGE_SCRIPTS_FOLDER}/");
    let mut scripts: Vec<(usize, String)> = Vec::new();
    for (key, path, index) in &destinations {
        if !key.starts_with(&scripts_prefix) || !key.ends_with(".sql") {
            continue;
        }
        let parts: Vec<&str> = path.split('/').collect();
        let [_, name] = parts.as_slice() else {
            plan.script_error.get_or_insert_with(|| format!("{ARCHIVE_ERROR_PREFIX}: SQL scripts must be directly inside scripts/: {path}"));
            continue;
        };
        if destination_key(name) == DRAFT_SCRIPT_FILE {
            plan.script_error.get_or_insert_with(|| format!("{ARCHIVE_ERROR_PREFIX}: draft scripts are not supported: {path}"));
            continue;
        }
        scripts.push((*index, name.to_string()));
    }
    sort_naturally(&mut scripts, |(_, name)| name.as_str());
    plan.entries.extend(scripts.into_iter().map(|(index, name)| (index, FolderArchiveEntry::Script { name })));
    let attachments_prefix = format!("{STORAGE_ATTACHMENTS_FOLDER}/");
    let mut attachments: Vec<(usize, &str)> =
        destinations.iter().filter(|(key, _, _)| key.starts_with(&attachments_prefix)).map(|(_, path, index)| (*index, path.as_str())).collect();
    sort_naturally(&mut attachments, |(_, path)| *path);
    for (index, path) in attachments {
        let name = path.split('/').nth(1).unwrap_or("").to_string();
        plan.entries.push((index, FolderArchiveEntry::Attachment { name }));
    }
    // The cached query results, named after their keys. Other files of the folder are ignored.
    for (_, path, index) in &destinations {
        let parts: Vec<&str> = path.split('/').collect();
        if let [folder, file] = parts.as_slice() {
            if *folder == WORKBOOK_RESULTS_FOLDER {
                if let Some(key) = workbook_result_key(file) {
                    plan.entries.push((*index, FolderArchiveEntry::Result { key: key.to_string() }));
                }
            }
        }
    }
    Ok(plan)
}

/// What the host read of an archive of a workbook folder
#[derive(Debug, Clone, PartialEq)]
pub struct FolderArchiveFiles<B> {
    /// The texts of the top-level files and the catalog files, by their path in the plan
    pub texts: Vec<(String, String)>,
    /// The scripts in the order of the plan
    pub scripts: Vec<ScriptData>,
    /// The attachments in the order of the plan
    pub data: Vec<DataFileData<B>>,
    /// The results in the order of the plan
    pub results: Vec<WorkbookBundleResult<B>>,
}

/// The bundle of an archive of a workbook folder: the top-level files are migrated in memory, the file lists are
/// reconciled with the scripts and attachments
pub fn read_folder_archive<B>(plan: &FolderArchivePlan, files: FolderArchiveFiles<B>) -> Result<WorkbookBundle<B>> {
    let mut folder = MigrationFolder::new(files.texts);
    let head = read_workbook_bundle_head(&mut folder, ARCHIVE_ERROR_PREFIX)?;
    if let Some(error) = &plan.script_error {
        return Err(Error::invalid_argument(error.clone()));
    }
    let mut bundle = assemble_workbook_bundle(head.workbook, head.catalogs, files.scripts, files.data);
    bundle.results = files.results;
    check_workbook_bundle(&bundle, ARCHIVE_ERROR_PREFIX)?;
    Ok(bundle)
}

/// The bundle of an archive of workbook tables that the host read
pub fn read_table_archive<B: Clone>(tables: &WorkbookTables<B>) -> Result<WorkbookBundle<B>> {
    crate::workbook_format::tables::workbook_tables_to_bundle(tables, ARCHIVE_ERROR_PREFIX)
}
