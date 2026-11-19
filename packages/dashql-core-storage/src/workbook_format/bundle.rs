//! Workbook bundles: the durable, portable content of a workbook (the workbook file, the scripts, the attachments, the
//! catalogs of its connections and, in exported workbooks, cached query results).
//!
//! The bytes of attachments and results are a type of the host, `B`: e.g. the bytes themselves in tests, or a handle
//! of a file or of a slice of an archive that stays with the host.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde_json::Value;

use dashql_core::error::{Error, Result};
use dashql_parser::parser::parse;
use dashql_parser::scanner::scan;

use crate::workbook_format::data::{WorkbookData, WORKBOOK_CATALOG_COPY_FORMAT_VERSION};
use crate::workbook_format::files::{
    file_name_key, is_script_file_name, reconcile_workbook_scripts, remap_workbook_scripts, sanitize_workbook_files, with_sanitized_files, workbook_attachments,
    workbook_connection_ids_of,
};
use crate::workbook_format::json::parse_object;
use crate::workbook_format::layout::{
    connection_file_path, validate_data_file_name, StorageType, LEGACY_SESSION_FILE, STORAGE_CATALOG_FUNCTIONS,
    STORAGE_CATALOG_RELATIONS, STORAGE_CONNECTIONS_FOLDER, STORAGE_WORKBOOK_FILE,
};
use crate::workbook_format::migration::{migrate_workbook_folder, migrate_workbook_folder_to, MigrationFolder, WorkbookMigrationResult, WORKBOOK_MIGRATION_STEPS};
use crate::workbook_format::validation::{is_valid_uuid, validate_workbook_data, validate_workbook_json, WorkbookValidationError};

/// A script file
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptData {
    /// The file name in `scripts/`
    pub name: String,
    /// The text
    pub sql: String,
}

impl ScriptData {
    /// A script file
    pub fn new(name: impl Into<String>, sql: impl Into<String>) -> Self {
        Self { name: name.into(), sql: sql.into() }
    }
}

/// An attachment with its bytes
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataFileData<B> {
    /// The file name in `attachments/`
    pub name: String,
    /// The bytes
    pub bytes: B,
}

/// A cached query result that an exported workbook carries
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbookBundleResult<B> {
    /// The cache key
    pub key: String,
    /// The Parquet file
    pub bytes: B,
    /// The CRC-32 that an archive stores for the file, an import checks it while it streams the file
    pub crc32: Option<u32>,
}

/// The catalog of a connection that a bundle carries
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbookBundleCatalog {
    /// The connection
    pub connection_id: String,
    /// The catalog relations
    pub relations: Option<String>,
    /// The catalog functions
    pub functions: Option<String>,
}

/// The durable, portable subset of a workbook
#[derive(Debug, Clone, PartialEq)]
pub struct WorkbookBundle<B> {
    /// The workbook file. Its script list names every script of `scripts` in feed order and its attachment list names
    /// every file of `data`.
    pub workbook: WorkbookData,
    /// The catalogs of the connections of the workbook
    pub catalogs: Vec<WorkbookBundleCatalog>,
    /// The script files
    pub scripts: Vec<ScriptData>,
    /// The attachments
    pub data: Vec<DataFileData<B>>,
    /// The cached query results of an exported workbook, never written to the workbook folder
    pub results: Vec<WorkbookBundleResult<B>>,
}

/// The workbook file and the catalogs of a bundle
#[derive(Debug, Clone, PartialEq)]
pub struct WorkbookBundleHead {
    /// The workbook file
    pub workbook: WorkbookData,
    /// The catalogs of the connections
    pub catalogs: Vec<WorkbookBundleCatalog>,
    /// False when unusable entries were removed from the file lists of the workbook file
    pub files_valid: bool,
}

/// The path of a catalog file of a connection in a bundle, e.g. `connections/<id>/dashql-catalog-relations.sql`
pub fn bundle_catalog_path(connection_id: &str, file_name: &str) -> String {
    connection_file_path(connection_id, file_name)
}

/// Is a path of a bundle the path of a catalog file of a connection?
pub fn is_bundle_catalog_path(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    matches!(parts.as_slice(), [folder, _, file] if *folder == STORAGE_CONNECTIONS_FOLDER && (*file == STORAGE_CATALOG_RELATIONS || *file == STORAGE_CATALOG_FUNCTIONS))
}

/// The first connection of a workbook, script files without an entry run on it when no script precedes them
fn first_connection_id(workbook: &WorkbookData) -> &str {
    workbook.connections.first().map(|connection| connection.connection_id.as_str()).unwrap_or("")
}

/// Complete a bundle from its workbook file and catalogs and its files. Scripts without a file are dropped from the
/// script list and script files without an entry are appended on the connection of the script before them.
pub fn assemble_workbook_bundle<B>(
    workbook: WorkbookData,
    catalogs: Vec<WorkbookBundleCatalog>,
    scripts: Vec<ScriptData>,
    data: Vec<DataFileData<B>>,
) -> WorkbookBundle<B> {
    let names: Vec<String> = scripts.iter().map(|script| script.name.clone()).collect();
    let reconciled = reconcile_workbook_scripts(&workbook.scripts, &names, first_connection_id(&workbook));
    let data_names: Vec<String> = data.iter().map(|file| file.name.clone()).collect();
    let workbook = WorkbookData { scripts: reconciled.scripts, attachments: workbook_attachments(&data_names), ..workbook };
    WorkbookBundle { workbook, catalogs, scripts, data, results: Vec::new() }
}

/// The bundle of a stored workbook: its workbook file with sanitized file lists, its scripts, the catalogs of its
/// connections (when an export asks for them) and its attachments
pub fn read_workbook_bundle<B>(
    stored: &WorkbookData,
    scripts: Vec<ScriptData>,
    catalogs: Vec<WorkbookBundleCatalog>,
    data: Vec<DataFileData<B>>,
) -> WorkbookBundle<B> {
    let (workbook, _) = with_sanitized_files(stored);
    assemble_workbook_bundle(workbook, catalogs, scripts, data)
}

/// Check the names of the files of a bundle before any of them reaches a storage. Every reader of a source (workbook
/// tables, archives, workbook folders) and the write of a bundle check them: a script is a `.sql` file directly in
/// `scripts/` and not the draft script, an attachment is a Parquet file directly in `attachments/`, a catalog belongs to
/// a connection with a UUID, and no two scripts or attachments denote the same file on a case-insensitive file system.
/// A name that could escape its folder never reaches the host. Errors start with `error_prefix`.
pub fn check_workbook_bundle<B>(bundle: &WorkbookBundle<B>, error_prefix: &str) -> Result<()> {
    let invalid = |message: String| Err(Error::invalid_argument(format!("{error_prefix}: {message}")));
    let mut keys = HashSet::new();
    for script in &bundle.scripts {
        if !is_script_file_name(&script.name) {
            return invalid(format!("invalid script name {}", script.name));
        }
        if !keys.insert(file_name_key(&script.name)) {
            return invalid(format!("duplicate script {}", script.name));
        }
    }
    let mut keys = HashSet::new();
    for file in &bundle.data {
        if let Err(error) = validate_data_file_name(&file.name) {
            return invalid(error.message);
        }
        if !keys.insert(file_name_key(&file.name)) {
            return invalid(format!("duplicate attachment {}", file.name));
        }
    }
    for catalog in &bundle.catalogs {
        if !is_valid_uuid(&catalog.connection_id) {
            return invalid(format!("invalid connection id of a catalog {}", catalog.connection_id));
        }
    }
    Ok(())
}

/// The catalog of a connection from its files, None if it has neither
pub fn catalog_of_files(connection_id: &str, relations: Option<String>, functions: Option<String>) -> Option<WorkbookBundleCatalog> {
    (relations.is_some() || functions.is_some()).then(|| WorkbookBundleCatalog { connection_id: connection_id.to_string(), relations, functions })
}

/// A stored workbook file reconciled with the stored files
#[derive(Debug, Clone, PartialEq)]
pub struct ReconciledStoredWorkbook {
    /// The workbook file with the scripts and attachments of the files
    pub workbook: WorkbookData,
    /// Must the workbook file be written? Only when the lists changed.
    pub write: bool,
}

/// Reconcile the file lists of a stored workbook file with the stored script files and attachments
pub fn reconcile_stored_workbook_files(stored: &WorkbookData, script_names: &[String], data_file_names: &[String]) -> ReconciledStoredWorkbook {
    let files = sanitize_workbook_files(stored);
    let reconciled = reconcile_workbook_scripts(&files.scripts, script_names, first_connection_id(stored));
    let attachments = workbook_attachments(data_file_names);
    let write = !files.valid || reconciled.changed || stored.attachments != attachments;
    ReconciledStoredWorkbook {
        workbook: WorkbookData { scripts: reconciled.scripts, attachments, malformed_lists: false, ..stored.clone() },
        write,
    }
}

/// Read a top-level field of the workbook file under its current or its older name
fn read_workbook_field(folder: &MigrationFolder, field: &str) -> Option<Value> {
    let text = folder.read(STORAGE_WORKBOOK_FILE).or_else(|| folder.read(LEGACY_SESSION_FILE))?;
    parse_object(text)?.get(field).cloned()
}

/// Migrate the top-level files of a workbook folder in memory to the current format and read them with the catalogs
/// of the connections in `connections/<id>/`. Errors start with `error_prefix`, e.g. "Invalid ZIP".
pub fn read_workbook_bundle_head(folder: &mut MigrationFolder, error_prefix: &str) -> Result<WorkbookBundleHead> {
    // Older workbooks copied the catalog of their default connection into the top level of the folder. It is read
    // before the migration removes the copy and the default connection.
    let migration = migrate_workbook_folder_to(folder, WORKBOOK_CATALOG_COPY_FORMAT_VERSION, &WORKBOOK_MIGRATION_STEPS)?;
    let has_catalog_copy = migration != WorkbookMigrationResult::Missing
        && read_workbook_field(folder, "formatVersion").and_then(|v| v.as_f64()) == Some(WORKBOOK_CATALOG_COPY_FORMAT_VERSION as f64);
    let (legacy_relations, legacy_functions, legacy_connection_id) = if has_catalog_copy {
        (
            folder.read(STORAGE_CATALOG_RELATIONS).map(str::to_string),
            folder.read(STORAGE_CATALOG_FUNCTIONS).map(str::to_string),
            read_workbook_field(folder, "defaultConnectionId").and_then(|v| v.as_str().map(str::to_string)),
        )
    } else {
        (None, None, None)
    };
    migrate_workbook_folder(folder)?;
    if migration == WorkbookMigrationResult::Missing {
        return Err(Error::invalid_argument(format!("{error_prefix}: missing {STORAGE_WORKBOOK_FILE}")));
    }
    let Some(text) = folder.read(STORAGE_WORKBOOK_FILE) else {
        // Metadata of an unsupported version under an older name
        return Err(Error::invalid_argument(format!(
            "{error_prefix}: invalid {STORAGE_WORKBOOK_FILE}: {}",
            WorkbookValidationError::UnsupportedFormatVersion.describe()
        )));
    };
    let Some(parsed) = parse_object(text) else {
        return Err(Error::invalid_argument(format!("{error_prefix}: invalid {STORAGE_WORKBOOK_FILE}")));
    };
    let parsed = Value::Object(parsed);
    if let Err(error) = validate_workbook_json(&parsed) {
        return Err(Error::invalid_argument(format!("{error_prefix}: invalid {STORAGE_WORKBOOK_FILE}: {}", error.describe())));
    }
    let (workbook, files_valid) = with_sanitized_files(&WorkbookData::from_json(&parsed));
    let first = first_connection_id(&workbook).to_string();
    let legacy_owner = legacy_connection_id.unwrap_or(first);
    let mut catalogs = Vec::new();
    for connection in &workbook.connections {
        let connection_id = &connection.connection_id;
        let relations = folder.read(&bundle_catalog_path(connection_id, STORAGE_CATALOG_RELATIONS)).map(str::to_string);
        let functions = folder.read(&bundle_catalog_path(connection_id, STORAGE_CATALOG_FUNCTIONS)).map(str::to_string);
        if let Some(catalog) = catalog_of_files(connection_id, relations, functions) {
            catalogs.push(catalog);
        } else if *connection_id == legacy_owner && (legacy_relations.is_some() || legacy_functions.is_some()) {
            catalogs.push(WorkbookBundleCatalog {
                connection_id: connection_id.clone(),
                relations: legacy_relations.clone(),
                functions: legacy_functions.clone(),
            });
        }
    }
    Ok(WorkbookBundleHead { workbook, catalogs, files_valid })
}

/// Give the connections of a workbook fresh ids, the scripts and the catalogs follow them
pub fn regenerate_connection_ids(
    workbook: &WorkbookData,
    catalogs: &[WorkbookBundleCatalog],
    new_uuid: &mut dyn FnMut() -> String,
) -> (WorkbookData, Vec<WorkbookBundleCatalog>) {
    let mut ids: HashMap<String, String> = HashMap::new();
    for connection in &workbook.connections {
        let fresh = new_uuid();
        ids.insert(connection.connection_id.clone(), fresh);
    }
    let connections = workbook
        .connections
        .iter()
        .map(|connection| {
            let mut next = connection.clone();
            if let Some(id) = ids.get(&connection.connection_id) {
                next.connection_id = id.clone();
            }
            next
        })
        .collect();
    let next = WorkbookData { connections, scripts: remap_workbook_scripts(&workbook.scripts, &ids), ..workbook.clone() };
    (next, rename_bundle_catalogs(catalogs, &ids))
}

/// Keep only the connections of a workbook that its scripts use, in the order the scripts first use them, and their
/// catalogs. A workbook without scripts keeps the connection its first script will run on.
pub fn prune_bundle_connections(workbook: &WorkbookData, catalogs: &[WorkbookBundleCatalog]) -> (WorkbookData, Vec<WorkbookBundleCatalog>) {
    let used = workbook_connection_ids_of(&workbook.scripts, workbook.connections.first().map(|c| c.connection_id.as_str()));
    let connections = used
        .iter()
        .filter_map(|id| workbook.connections.iter().find(|connection| connection.connection_id == *id).cloned())
        .collect();
    let catalogs = catalogs.iter().filter(|catalog| used.contains(&catalog.connection_id)).cloned().collect();
    (WorkbookData { connections, ..workbook.clone() }, catalogs)
}

/// Rename the connections of catalogs, connections that become one keep the first catalog
pub fn rename_bundle_catalogs(catalogs: &[WorkbookBundleCatalog], ids: &HashMap<String, String>) -> Vec<WorkbookBundleCatalog> {
    let mut renamed: Vec<WorkbookBundleCatalog> = Vec::new();
    for catalog in catalogs {
        let connection_id = ids.get(&catalog.connection_id).cloned().unwrap_or_else(|| catalog.connection_id.clone());
        if !renamed.iter().any(|c| c.connection_id == connection_id) {
            renamed.push(WorkbookBundleCatalog { connection_id, ..catalog.clone() });
        }
    }
    renamed
}

/// Does a text scan and parse without errors?
pub fn parses_without_errors(sql: &str) -> bool {
    let parsed = parse(Arc::new(scan(sql, 0, 0)));
    parsed.scanned.errors.is_empty() && parsed.errors.is_empty()
}

/// Drop the catalog files that don't parse before they can reach storage, returns the catalogs and the paths of the
/// dropped files. The catalogs aren't analyzed, they may reference what only their connection knows.
pub fn filter_invalid_workbook_catalogs(catalogs: &[WorkbookBundleCatalog]) -> (Vec<WorkbookBundleCatalog>, Vec<String>) {
    let mut invalid = Vec::new();
    let filtered = catalogs
        .iter()
        .map(|catalog| {
            let mut validate = |sql: &Option<String>, file_name: &str| match sql {
                Some(text) if !parses_without_errors(text) => {
                    invalid.push(bundle_catalog_path(&catalog.connection_id, file_name));
                    None
                }
                other => other.clone(),
            };
            let relations = validate(&catalog.relations, STORAGE_CATALOG_RELATIONS);
            let functions = validate(&catalog.functions, STORAGE_CATALOG_FUNCTIONS);
            WorkbookBundleCatalog { connection_id: catalog.connection_id.clone(), relations, functions }
        })
        .collect();
    (filtered, invalid)
}

/// The options of a write of a bundle
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkbookBundleWriteOptions {
    /// The id of the written workbook, the id of the bundle without one
    pub target_workbook_id: Option<String>,
    /// Add " (copy)" to a nonblank name, for an explicit Create-new
    pub suffix_name_with_copy: bool,
    /// The target didn't exist before the write, a failed write may remove it
    pub target_is_fresh: bool,
}

/// What the host writes for a bundle, in order: the workbook file, the scripts of the bundle, its attachments. If a
/// write fails and `rollback_on_failure` is set, the host deletes the workbook and keeps the error of the write.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkbookBundleWrite {
    /// The id of the written workbook
    pub workbook_id: String,
    /// The workbook file
    pub workbook: WorkbookData,
    /// Delete the workbook when a write fails
    pub rollback_on_failure: bool,
}

/// Check a bundle and prepare its write. Nothing is written for a bundle that fails.
pub fn prepare_workbook_bundle_write<B>(
    bundle: &WorkbookBundle<B>,
    backend: StorageType,
    options: &WorkbookBundleWriteOptions,
) -> Result<WorkbookBundleWrite> {
    if let Err(error) = validate_workbook_data(&bundle.workbook) {
        return Err(Error::invalid_argument(format!("Invalid source workbook: {}", error.describe())));
    }
    let workbook_id = options.target_workbook_id.clone().unwrap_or_else(|| bundle.workbook.workbook_id.clone());
    if !is_valid_uuid(&workbook_id) {
        return Err(Error::invalid_argument(format!("Invalid target workbook id: {workbook_id}")));
    }
    if options.target_is_fresh && options.target_workbook_id.is_none() {
        return Err(Error::invalid_argument("targetIsFresh requires an explicit targetWorkbookId"));
    }
    check_workbook_bundle(bundle, "Invalid source workbook")?;
    let names: Vec<String> = bundle.scripts.iter().map(|script| script.name.clone()).collect();
    let data_names: Vec<String> = bundle.data.iter().map(|file| file.name.clone()).collect();
    let mut workbook = WorkbookData {
        workbook_id: workbook_id.clone(),
        scripts: reconcile_workbook_scripts(&bundle.workbook.scripts, &names, first_connection_id(&bundle.workbook)).scripts,
        attachments: workbook_attachments(&data_names),
        malformed_lists: false,
        ..bundle.workbook.clone()
    };
    if backend == StorageType::Opfs {
        workbook.workbook_path = None;
        workbook.storage_type = None;
        workbook.native_path = None;
    }
    if options.suffix_name_with_copy {
        if let Some(name) = workbook.name.as_deref().map(str::trim).filter(|name| !name.is_empty()) {
            workbook.name = Some(format!("{name} (copy)"));
        }
    }
    Ok(WorkbookBundleWrite { workbook_id, workbook, rollback_on_failure: options.target_is_fresh })
}

/// The catalog files that seed a connection from a bundle, as (file name, text). A connection that has a catalog
/// (`has_catalog`: either file exists) keeps it, the catalog of a bundle only describes a connection new to the app.
pub fn catalog_seed_files(catalog: &WorkbookBundleCatalog, has_catalog: bool) -> Vec<(&'static str, String)> {
    if has_catalog {
        return Vec::new();
    }
    [(STORAGE_CATALOG_RELATIONS, &catalog.relations), (STORAGE_CATALOG_FUNCTIONS, &catalog.functions)]
        .into_iter()
        .filter_map(|(file, text)| text.clone().map(|text| (file, text)))
        .collect()
}

/// What differs between an expected and an actual bundle, None if nothing. Names the field or file and never a value,
/// a value can be a secret of a connection.
pub fn describe_workbook_bundle_difference<B: PartialEq>(expected: &WorkbookBundle<B>, actual: &WorkbookBundle<B>) -> Option<String> {
    let names = |names: Vec<&str>| names.join(", ");
    let expected_scripts = names(expected.scripts.iter().map(|s| s.name.as_str()).collect());
    let actual_scripts = names(actual.scripts.iter().map(|s| s.name.as_str()).collect());
    if expected_scripts != actual_scripts {
        return Some(format!("the scripts differ: expected [{expected_scripts}], found [{actual_scripts}]"));
    }
    if let Some(script) = expected.scripts.iter().zip(actual.scripts.iter()).find(|(e, a)| e.sql != a.sql).map(|(e, _)| e) {
        return Some(format!("the text of the script {} differs", script.name));
    }
    let expected_data = names(expected.data.iter().map(|f| f.name.as_str()).collect());
    let actual_data = names(actual.data.iter().map(|f| f.name.as_str()).collect());
    if expected_data != actual_data {
        return Some(format!("the attachments differ: expected [{expected_data}], found [{actual_data}]"));
    }
    if let Some(file) = expected.data.iter().zip(actual.data.iter()).find(|(e, a)| e.bytes != a.bytes).map(|(e, _)| e) {
        return Some(format!("the bytes of the attachment {} differ", file.name));
    }
    if let Some(field) = first_different_field(&expected.workbook.to_json(), &actual.workbook.to_json(), "workbook") {
        return Some(format!("{field} differs"));
    }
    if expected.catalogs != actual.catalogs {
        return Some("the catalogs differ".into());
    }
    (!workbook_bundles_equal(expected, actual)).then(|| "the bundles differ".into())
}

/// The path of the first field that differs, None if none
fn first_different_field(expected: &Value, actual: &Value, path: &str) -> Option<String> {
    if expected == actual {
        return None;
    }
    match (expected, actual) {
        (Value::Object(a), Value::Object(b)) => {
            let keys = a.keys().chain(b.keys().filter(|key| !a.contains_key(*key)));
            for key in keys {
                let difference = first_different_field(a.get(key).unwrap_or(&Value::Null), b.get(key).unwrap_or(&Value::Null), &format!("{path}.{key}"));
                if difference.is_some() {
                    return difference;
                }
            }
            Some(path.to_string())
        }
        (Value::Array(a), Value::Array(b)) => {
            for index in 0..a.len().max(b.len()) {
                let difference = first_different_field(a.get(index).unwrap_or(&Value::Null), b.get(index).unwrap_or(&Value::Null), &format!("{path}[{index}]"));
                if difference.is_some() {
                    return difference;
                }
            }
            Some(path.to_string())
        }
        _ => Some(path.to_string()),
    }
}

/// Is all portable content of two bundles the same? Used to verify a staged replacement.
pub fn workbook_bundles_equal<B: PartialEq>(a: &WorkbookBundle<B>, b: &WorkbookBundle<B>) -> bool {
    a.workbook.to_json() == b.workbook.to_json()
        && a.catalogs == b.catalogs
        && a.scripts == b.scripts
        && a.data == b.data
        && a.results.len() == b.results.len()
        && a.results.iter().zip(b.results.iter()).all(|(x, y)| x.key == y.key && x.bytes == y.bytes && x.crc32 == y.crc32)
}
