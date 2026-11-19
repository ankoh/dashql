//! The migrations of the storage root to the current storage version.
//!
//! The storage version (`storageVersion` of the app manifest) describes the root: where the workbooks, the workbook
//! tree, the connections and the files of the shell live. `migrate_storage` brings an older root to the current version
//! with the steps below, then brings every workbook folder that the workbook tree registers to the current workbook
//! format (`migration::migrate_folder`). A step spells out every file, folder and field it touches instead of using the
//! constants of the layout: the constants describe the current layout, a step the layout of its version. Steps are
//! idempotent: the version is written after a step, an interrupted migration repeats the step.
//!
//! The host is the storage root (`StorageRootHost`): files and directories by their paths below the root and the
//! folders of native workbooks. The caller holds the lock of the manifest that the windows of the app share.

use serde_json::{json, Value};

use dashql_core_runtime::host::{Host, HostError, LogLevel};
use crate::workbook_format::data::{STORAGE_VERSION, WORKBOOK_FORMAT_VERSION};
use crate::workbook_format::json::{to_pretty_text, to_text, JsonObject};
use crate::workbook_format::layout::{StorageType, STORAGE_FOLDER_FILE, STORAGE_WORKBOOK_TREE_FOLDER};
use crate::workbook_format::migration::{migrate_folder, rename_sidb_connections, FolderHost, WorkbookMigrationResult};
use crate::workbook_format::tree::{read_workbook_tree, TreeDirectory};
use crate::workbook_format::validation::is_valid_uuid;

/// The manifest of the storage root, it holds the storage version
pub const MANIFEST_FILE: &str = "dashql-manifest.json";

/// An entry of a directory of the storage root
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntry {
    /// The name of the file or directory
    pub name: String,
    /// Is the entry a directory?
    pub directory: bool,
}

/// The storage root as the migrations see it: files and directories by their paths below the root, and the folders of
/// native workbooks
#[allow(async_fn_in_trait)] // The futures hold values of the host and run on its thread, they are not Send
pub trait StorageRootHost: Host {
    /// A workbook folder
    type Folder: FolderHost;
    /// A file below the root by its path, `/` separated, None if it doesn't exist
    async fn read_text(&self, path: &str) -> Result<Option<String>, HostError>;
    /// Write a file, its directories are created
    async fn write_text(&self, path: &str, text: &str) -> Result<(), HostError>;
    /// Create a directory and its parents
    async fn create_directory(&self, path: &str) -> Result<(), HostError>;
    /// Remove a file, or a directory with its content; a missing one is ignored
    async fn remove(&self, path: &str) -> Result<(), HostError>;
    /// The entries of a directory, None if it doesn't exist
    async fn list(&self, path: &str) -> Result<Option<Vec<DirEntry>>, HostError>;
    /// Copy the files and folders of a directory into another one, which is created. Existing files are replaced, or
    /// kept with `keep_existing`.
    async fn copy_directory(&self, from: &str, to: &str, keep_existing: bool) -> Result<(), HostError>;
    /// A workbook folder below the root
    fn folder(&self, path: &str) -> Self::Folder;
    /// The folder of a native workbook, claimed for the app; None if the platform has no native folders or the folder
    /// doesn't exist
    async fn native_folder(&self, native_path: &str) -> Result<Option<Self::Folder>, HostError>;
    /// A random UUID, a migration that needs one fails without it
    fn random_uuid(&self) -> Result<String, HostError>;
}

/// A step that brings the storage from the previous version to `version`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageMigrationStep {
    /// The storage version the step produces
    pub version: i64,
    /// What the step changes
    pub description: &'static str,
}

/// The steps in order. Steps are never removed, a storage may skip any number of app versions.
pub const STORAGE_MIGRATION_STEPS: [StorageMigrationStep; 8] = [
    StorageMigrationStep { version: 2, description: "Rename notebooks as sessions" },
    StorageMigrationStep { version: 3, description: "Move the connections of the sessions into the app manifest" },
    StorageMigrationStep { version: 4, description: "Seed the catalogs of the connections from the catalog copies of the sessions" },
    StorageMigrationStep { version: 5, description: "Move the files of the shell from dashql-shell to shell" },
    StorageMigrationStep { version: 6, description: "Drop the aliases of the connections of the app manifest" },
    StorageMigrationStep { version: 7, description: "Move the sessions of the app manifest into the session tree" },
    StorageMigrationStep { version: 8, description: "Rename the connection params of the SIDB connector to dbcom" },
    StorageMigrationStep { version: 9, description: "Rename sessions as workbooks" },
];

// The last step produces the current storage version
const _: () = assert!(matches!(STORAGE_MIGRATION_STEPS.last(), Some(step) if step.version == STORAGE_VERSION));

/// What a migration of the storage changed
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StorageMigrationSummary {
    /// The storage steps that ran
    pub steps: u32,
    /// The workbook folders that were brought to the current workbook format
    pub workbooks: u32,
}

/// The catalog files that a session copied from its connections, up to the session format version 6
const CATALOG_FILES: [&str; 3] = ["dashql-catalog-relations.sql", "dashql-catalog-functions.sql", "dashql-catalog-changes.sql"];

/// The time of an epoch timestamp in milliseconds as `Date.prototype.toISOString` writes it, e.g.
/// `2026-10-22T00:00:00.000Z`
pub fn iso_timestamp(ms: f64) -> String {
    let ms = if ms.is_finite() { ms.floor() as i64 } else { 0 };
    let days = ms.div_euclid(86_400_000);
    let in_day = ms.rem_euclid(86_400_000);
    // The civil date of days since 1970-01-01 (Howard Hinnant, civil_from_days)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let (hours, minutes, seconds, millis) = (in_day / 3_600_000, in_day / 60_000 % 60, in_day / 1000 % 60, in_day % 1000);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("+{year:06}")
    };
    format!("{year}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{millis:03}Z")
}

/// The message of a failed step for the log
fn message(error: &HostError) -> &str {
    error.message()
}

/// Read the manifest, None if the storage has none
async fn read_manifest<H: StorageRootHost>(host: &H) -> Result<Option<JsonObject>, HostError> {
    let Some(text) = host.read_text(MANIFEST_FILE).await? else {
        return Ok(None);
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(manifest)) => Ok(Some(manifest)),
        Ok(_) => Err(HostError::new(format!("Invalid {MANIFEST_FILE}: not a JSON object"))),
        Err(error) => Err(HostError::new(format!("Invalid {MANIFEST_FILE}: {error}"))),
    }
}

/// Write the manifest
async fn write_manifest<H: StorageRootHost>(host: &H, manifest: &JsonObject) -> Result<(), HostError> {
    host.write_text(MANIFEST_FILE, &to_pretty_text(&Value::Object(manifest.clone()))).await
}

/// The session entries of a manifest of storage version 2 to 6, later versions register the sessions in the session tree
fn manifest_session_entries(manifest: &JsonObject) -> Vec<Value> {
    manifest.get("sessions").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// A registered workbook folder: an id and where its files live
struct FolderEntry {
    /// The workbook id, the path of the entry
    path: String,
    /// Where the files of the workbook live
    location: FolderLocation,
}

/// Where the files of a registered workbook live
enum FolderLocation {
    /// The folder of the workbook below the folder of the workbooks of the root
    Root,
    /// A native folder, None if the entry names none
    Native(Option<String>),
}

impl FolderEntry {
    /// An entry of a manifest or a folder file, None without a non-empty string `path`
    fn of_json(entry: &Value) -> Option<Self> {
        let path = entry.get("path").and_then(Value::as_str).filter(|path| !path.is_empty())?;
        let location = if entry.get("storageType").and_then(Value::as_str) == Some("native") {
            FolderLocation::Native(entry.get("nativePath").and_then(Value::as_str).map(str::to_string))
        } else {
            FolderLocation::Root
        };
        Some(FolderEntry { path: path.to_string(), location })
    }
}

/// The workbook folders of entries that can be reached: OPFS workbooks live in `<opfs_folder>/<id>`, `sessions/<id>` up
/// to storage version 8 and `workbooks/<id>` after it, native workbooks in their own directory, which may be missing or
/// unavailable outside of the native app
async fn list_workbook_folders<H: StorageRootHost>(host: &H, entries: &[FolderEntry], opfs_folder: &str) -> Result<Vec<(String, H::Folder)>, HostError> {
    let mut folders = Vec::new();
    for entry in entries {
        match &entry.location {
            // A native entry without a folder can't be reached
            FolderLocation::Native(None) => continue,
            FolderLocation::Native(Some(native_path)) => {
                if let Some(folder) = host.native_folder(native_path).await? {
                    folders.push((entry.path.clone(), folder));
                }
                continue;
            }
            FolderLocation::Root => {}
        }
        let path = format!("{opfs_folder}/{}", entry.path);
        if host.list(&path).await?.is_some() {
            folders.push((entry.path.clone(), host.folder(&path)));
        }
    }
    Ok(folders)
}

/// The entries of the workbook folders of a manifest of storage version 2 to 6
fn manifest_folder_entries(manifest: &JsonObject) -> Vec<FolderEntry> {
    manifest_session_entries(manifest).iter().filter_map(FolderEntry::of_json).collect()
}

/// Read a directory of the workbook tree with its subdirectories
async fn read_tree_directory<H: StorageRootHost>(host: &H, path: &str, name: &str) -> Result<TreeDirectory, HostError> {
    let mut directory = TreeDirectory { name: name.to_string(), folder_file: None, directories: Vec::new() };
    for entry in host.list(path).await?.unwrap_or_default() {
        let child = format!("{path}/{}", entry.name);
        if entry.directory {
            directory.directories.push(Box::pin(read_tree_directory(host, &child, &entry.name)).await?);
        } else if entry.name == STORAGE_FOLDER_FILE {
            directory.folder_file = host.read_text(&child).await?;
        }
    }
    Ok(directory)
}

/// Bring the storage to the current version.
///
/// The storage steps bring the root to the current version, then every workbook folder that the workbook tree registers
/// is brought to the current workbook format. Folders that become reachable later are migrated when they are read. A
/// fresh storage without a manifest gets one with the current version, the only place that stamps the version: the
/// storage of the app keeps the version of the manifest it writes. A storage of a newer version of the app is refused.
/// Returns what the migration changed.
pub async fn migrate_storage<H: StorageRootHost>(host: &H) -> Result<StorageMigrationSummary, HostError> {
    let mut summary = StorageMigrationSummary::default();
    let Some(manifest) = read_manifest(host).await? else {
        let mut manifest = JsonObject::new();
        manifest.insert("storageVersion".into(), json!(STORAGE_VERSION));
        write_manifest(host, &manifest).await?;
        return Ok(summary);
    };
    let version = match manifest.get("storageVersion") {
        None | Some(Value::Null) => json!(1),
        Some(version) => version.clone(),
    };
    let version = match version.as_f64() {
        Some(number) if number.fract() == 0.0 && number >= 1.0 => number as i64,
        _ => return Err(HostError::new(format!("Invalid storage version: {}", to_text(&version)))),
    };
    let latest = STORAGE_MIGRATION_STEPS.iter().map(|step| step.version).fold(1, i64::max);
    if version > latest {
        return Err(HostError::new(format!(
            "The storage was written by a newer version of DashQL (storage version {version}, this version supports {latest})"
        )));
    }

    for step in STORAGE_MIGRATION_STEPS {
        if step.version <= version {
            continue;
        }
        let step_version = step.version.to_string();
        host.log(LogLevel::Info, "Migrating the storage", &[("version", &step_version), ("step", step.description)]);
        run_storage_migration_step(host, step.version).await?;
        let mut manifest = read_manifest(host).await?.unwrap_or_default();
        manifest.insert("storageVersion".into(), json!(step.version));
        write_manifest(host, &manifest).await?;
        summary.steps += 1;
    }

    // The storage is current, the workbook tree registers the workbooks
    let tree = match host.list(STORAGE_WORKBOOK_TREE_FOLDER).await? {
        Some(_) => Some(read_tree_directory(host, STORAGE_WORKBOOK_TREE_FOLDER, "").await?),
        None => None,
    };
    let tree = read_workbook_tree(tree.as_ref()).map_err(|error| HostError::new(error.message))?;
    let entries: Vec<FolderEntry> = tree
        .flatten()
        .into_iter()
        .map(|entry| FolderEntry {
            path: entry.path.clone(),
            location: if entry.storage_type == Some(StorageType::Native) {
                FolderLocation::Native(entry.native_path.clone())
            } else {
                FolderLocation::Root
            },
        })
        .collect();
    for (workbook_id, folder) in list_workbook_folders(host, &entries, "workbooks").await? {
        match migrate_folder(&folder, WORKBOOK_FORMAT_VERSION).await {
            Ok(WorkbookMigrationResult::Migrated) => {
                host.log(LogLevel::Info, "Migrated a session", &[("workbookId", &workbook_id)]);
                summary.workbooks += 1;
            }
            Ok(WorkbookMigrationResult::Current) => {}
            Ok(result) => host.log(LogLevel::Warn, "Session cannot be migrated", &[("workbookId", &workbook_id), ("result", result.as_str())]),
            // The workbook is surfaced as invalid when it is restored
            Err(error) => host.log(LogLevel::Warn, "Failed to migrate a session", &[("workbookId", &workbook_id), ("error", message(&error))]),
        }
    }
    Ok(summary)
}

/// Run the step that produces a storage version, e.g. again to check that it is idempotent
pub async fn run_storage_migration_step<H: StorageRootHost>(host: &H, version: i64) -> Result<(), HostError> {
    match version {
        2 => notebooks_to_sessions(host).await,
        3 => global_connections(host).await,
        4 => session_catalogs_to_connections(host).await,
        5 => shell_folder(host).await,
        6 => drop_connection_aliases(host).await,
        7 => session_tree(host).await,
        8 => dbcom_connector(host).await,
        9 => sessions_to_workbooks(host).await,
        _ => Err(HostError::new(format!("Unknown storage migration step {version}"))),
    }
}

/// Notebooks are called sessions: the session folders move from `notebooks/<uuid>` to `sessions/<uuid>` and the manifest
/// lists them as `sessions` instead of `notebooks`. The files inside the folders are renamed by the workbook migration.
///
/// A notebook folder is removed only after it was copied completely, the manifest is rewritten last.
async fn notebooks_to_sessions<H: StorageRootHost>(host: &H) -> Result<(), HostError> {
    if let Some(entries) = host.list("notebooks").await? {
        host.create_directory("sessions").await?;
        for entry in entries.iter().filter(|entry| entry.directory) {
            let from = format!("notebooks/{}", entry.name);
            host.copy_directory(&from, &format!("sessions/{}", entry.name), false).await?;
            host.remove(&from).await?;
        }
        host.remove("notebooks").await?;
    }
    let Some(mut manifest) = read_manifest(host).await? else {
        return Ok(());
    };
    let notebooks = manifest.get("notebooks").filter(|value| value.is_array()).cloned();
    let sessions_listed = manifest.get("sessions").is_some_and(Value::is_array);
    if let (Some(notebooks), false) = (notebooks, sessions_listed) {
        // `{ sessions, ...rest }` of the entries of the notebooks, a field `sessions` of the rest wins
        manifest.shift_remove("notebooks");
        let sessions = manifest.shift_remove("sessions").unwrap_or(notebooks);
        manifest.shift_insert(0, "sessions".into(), sessions);
        write_manifest(host, &manifest).await?;
    }
    Ok(())
}

/// A database that the session metadata of format version 4 references
fn is_database(value: &Value) -> bool {
    value.as_object().is_some_and(|database| {
        database.get("databaseId").is_some_and(Value::is_string) && database.get("params").is_some_and(|params| params.is_object() || params.is_array())
    })
}

/// Does the metadata of format version 4 hold the databases that the plan reads?
fn has_databases(data: &JsonObject) -> bool {
    data.get("formatVersion").and_then(Value::as_f64) == Some(4.0)
        && data.get("mainDatabase").is_some_and(is_database)
        && data.get("attachedDatabases").and_then(Value::as_array).is_some_and(|attached| attached.iter().all(is_database))
}

/// A session that takes part in the migration of the connections
#[derive(Debug, Clone, PartialEq)]
pub struct MigratingSession {
    /// The session id
    pub session_id: String,
    /// The session metadata of format version 4 as it is stored, with `mainDatabase` and `attachedDatabases`
    pub data: JsonObject,
}

/// The plan to make the connections of sessions global
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ConnectionMigrationPlan {
    /// The connections of the app manifest
    pub entries: Vec<Value>,
    /// The sessions whose files change, with their new metadata, in the order of the sessions
    pub rewrites: Vec<(String, JsonObject)>,
    /// The session whose catalog files seed the catalog of a connection, `(connection id, session id)`
    pub catalog_sources: Vec<(String, String)>,
}

/// How a session referenced a database before connections were global
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DatabaseRole {
    Main,
    Attached,
}

/// A reference of a session to a database
#[derive(Debug, Clone)]
struct DatabaseRef {
    session_id: String,
    role: DatabaseRole,
    database_id: String,
    params: Value,
    /// The stored draft, None for none or null
    params_draft: Option<Value>,
}

impl DatabaseRef {
    fn of(session_id: &str, role: DatabaseRole, database: &Value) -> Self {
        DatabaseRef {
            session_id: session_id.to_string(),
            role,
            database_id: database.get("databaseId").and_then(Value::as_str).unwrap_or_default().to_string(),
            params: database.get("params").cloned().unwrap_or(Value::Null),
            params_draft: database.get("paramsDraft").filter(|draft| !draft.is_null()).cloned(),
        }
    }
}

/// A connection that the migration creates
struct PlannedConnection {
    id: String,
    params: Value,
    params_draft: Option<Value>,
    refs: Vec<DatabaseRef>,
}

/// Connection params without the form rows of drafts, which the forms of Hyper and Trino keep
fn params_without_draft_rows(params: &Value) -> Value {
    let mut params = params.clone();
    if let Some(object) = params.as_object_mut() {
        for connector in ["hyper", "trino"] {
            if let Some(Value::Object(inner)) = object.get_mut(connector) {
                inner.shift_remove("draftRows");
            }
        }
    }
    params
}

/// Plan the migration of per-session databases to global connections.
///
/// Databases with equal params (ignoring the form rows of drafts) become one connection. The full params are compared,
/// so databases that differ in a secret stay separate. A connection keeps the id of its first reference in the order of
/// the sessions, the references of the other ids are rewritten; an id that is taken already gets a new one of `new_id`.
///
/// Drafts must not get lost: references with the same draft (or none) share a connection, every further distinct draft
/// keeps a connection of its own under the id of its first holder.
pub fn plan_connection_migration(sessions: &[MigratingSession], created_at: &str, new_id: &mut dyn FnMut() -> String) -> ConnectionMigrationPlan {
    // Collect the references in the order of the sessions and group them by their params
    let mut groups: Vec<(Value, Vec<DatabaseRef>)> = Vec::new();
    for session in sessions {
        let mut refs = Vec::new();
        if let Some(main) = session.data.get("mainDatabase") {
            refs.push(DatabaseRef::of(&session.session_id, DatabaseRole::Main, main));
        }
        for attached in session.data.get("attachedDatabases").and_then(Value::as_array).into_iter().flatten() {
            refs.push(DatabaseRef::of(&session.session_id, DatabaseRole::Attached, attached));
        }
        for reference in refs {
            let key = params_without_draft_rows(&reference.params);
            match groups.iter_mut().find(|(group, _)| *group == key) {
                Some((_, group)) => group.push(reference),
                None => groups.push((key, vec![reference])),
            }
        }
    }

    // Split the groups by their drafts
    let mut used_ids: Vec<String> = Vec::new();
    let mut connections: Vec<PlannedConnection> = Vec::new();
    for (_, refs) in groups {
        let Some(first) = refs.first() else { continue };
        let params = params_without_draft_rows(&first.params);
        let mut by_draft: Vec<PlannedConnection> = Vec::new();
        for reference in refs {
            // References without a draft join the first connection of the group
            let target = match &reference.params_draft {
                None => by_draft.first_mut(),
                Some(draft) => by_draft.iter_mut().find(|c| c.params_draft.as_ref().is_none_or(|own| own == draft)),
            };
            match target {
                Some(target) => {
                    if target.params_draft.is_none() && reference.params_draft.is_some() {
                        target.params_draft = reference.params_draft.clone();
                    }
                    target.refs.push(reference);
                }
                None => by_draft.push(PlannedConnection { id: String::new(), params: params.clone(), params_draft: reference.params_draft.clone(), refs: vec![reference] }),
            }
        }
        for mut connection in by_draft {
            let preferred = connection.refs.first().map(|r| r.database_id.clone()).unwrap_or_default();
            let id = if used_ids.contains(&preferred) { new_id() } else { preferred };
            used_ids.push(id.clone());
            connection.id = id;
            connections.push(connection);
        }
    }

    // Build the manifest entries and the catalog sources
    let mut plan = ConnectionMigrationPlan::default();
    let mut resolve: Vec<((String, String), String)> = Vec::new();
    for connection in &connections {
        let mut entry = JsonObject::new();
        entry.insert("id".into(), json!(connection.id));
        entry.insert("params".into(), connection.params.clone());
        if let Some(draft) = &connection.params_draft {
            entry.insert("paramsDraft".into(), draft.clone());
        }
        entry.insert("createdAt".into(), json!(created_at));
        plan.entries.push(Value::Object(entry));
        if let Some(source) = connection.refs.iter().find(|r| r.role == DatabaseRole::Main) {
            plan.catalog_sources.push((connection.id.clone(), source.session_id.clone()));
        }
        for reference in &connection.refs {
            let key = (reference.session_id.clone(), reference.database_id.clone());
            match resolve.iter_mut().find(|(k, _)| *k == key) {
                Some((_, id)) => *id = connection.id.clone(),
                None => resolve.push((key, connection.id.clone())),
            }
        }
    }

    // Rewrite the references of the sessions
    let params_of = |id: &str| connections.iter().find(|c| c.id == id).map(|c| c.params.clone()).unwrap_or(Value::Null);
    for session in sessions {
        let rewrite = |database: &Value| -> Value {
            let database_id = database.get("databaseId").and_then(Value::as_str).unwrap_or_default();
            let key = (session.session_id.clone(), database_id.to_string());
            let id = resolve.iter().find(|(k, _)| *k == key).map(|(_, id)| id.clone()).unwrap_or_default();
            let params = params_of(&id);
            json!({ "databaseId": id, "params": params })
        };
        let main = session.data.get("mainDatabase").map(rewrite).unwrap_or(Value::Null);
        let main_id = main.get("databaseId").and_then(Value::as_str).unwrap_or_default().to_string();
        // Drop attached databases that reference the main database or an earlier attached database
        let mut seen = vec![main_id];
        let mut attached = Vec::new();
        for database in session.data.get("attachedDatabases").and_then(Value::as_array).into_iter().flatten().map(rewrite) {
            let id = database.get("databaseId").and_then(Value::as_str).unwrap_or_default().to_string();
            if !seen.contains(&id) {
                seen.push(id);
                attached.push(database);
            }
        }
        let mut next = session.data.clone();
        next.insert("mainDatabase".into(), main);
        next.insert("attachedDatabases".into(), Value::Array(attached));
        if to_text(&Value::Object(next.clone())) != to_text(&Value::Object(session.data.clone())) {
            match plan.rewrites.iter_mut().find(|(id, _)| *id == session.session_id) {
                Some((_, data)) => *data = next,
                None => plan.rewrites.push((session.session_id.clone(), next)),
            }
        }
    }
    plan
}

/// Sessions own their connections up to storage version 2. The step moves the connections into the app manifest and
/// consolidates connections with equal params, see `plan_connection_migration`.
///
/// The catalogs are copied first, writing the connections into the manifest is the commit point. A repeated step
/// removes the catalogs that an interrupted one copied under ids it doesn't plan again. The sessions are rewritten last
/// and best effort. Sessions that cannot be read register their connections when they become readable
/// again.
async fn global_connections<H: StorageRootHost>(host: &H) -> Result<(), HostError> {
    let Some(mut manifest) = read_manifest(host).await? else {
        return Ok(());
    };
    if manifest.contains_key("connections") {
        return Ok(());
    }
    let mut sessions = Vec::new();
    let mut folders: Vec<(String, H::Folder)> = Vec::new();
    for (session_id, folder) in list_workbook_folders(host, &manifest_folder_entries(&manifest), "sessions").await? {
        if !is_valid_uuid(&session_id) {
            continue;
        }
        let read = async {
            migrate_folder(&folder, 4).await?;
            let Some(text) = folder.read_text("dashql-session.json").await? else {
                return Ok::<Option<JsonObject>, HostError>(None);
            };
            match serde_json::from_str::<Value>(&text) {
                Ok(Value::Object(data)) => Ok(has_databases(&data).then_some(data)),
                Ok(Value::Null) => Err(HostError::new("Cannot read properties of null (reading 'formatVersion')")),
                Ok(_) => Ok(None),
                Err(error) => Err(HostError::new(error.to_string())),
            }
        };
        match read.await {
            Ok(Some(data)) => {
                sessions.push(MigratingSession { session_id: session_id.clone(), data });
                folders.push((session_id, folder));
            }
            Ok(None) => {}
            Err(error) => {
                host.log(LogLevel::Warn, "Skipping the connections of an unreadable session", &[("sessionId", &session_id), ("error", message(&error))]);
            }
        }
    }
    let created_at = iso_timestamp(host.now());
    let mut failed = None;
    let plan = plan_connection_migration(&sessions, &created_at, &mut || {
        host.random_uuid().unwrap_or_else(|error| {
            failed.get_or_insert(error);
            String::new()
        })
    });
    // A connection without an id is never written, the step fails and runs again
    if let Some(error) = failed {
        return Err(error);
    }
    let folder_of = |session_id: &str| folders.iter().find(|(id, _)| id == session_id).map(|(_, folder)| folder);

    // The step introduces the connections, so nothing references a folder of a connection yet. An interrupted step
    // copied catalogs already, also under fresh ids that this run doesn't plan again: they are removed.
    for entry in host.list("connections").await?.unwrap_or_default() {
        if entry.directory && !plan.entries.iter().any(|planned| planned.get("id").and_then(Value::as_str) == Some(entry.name.as_str())) {
            host.log(LogLevel::Info, "Removing the files of a connection of an interrupted migration", &[("connectionId", &entry.name)]);
            host.remove(&format!("connections/{}", entry.name)).await?;
        }
    }

    for (connection_id, session_id) in &plan.catalog_sources {
        let copy = async {
            let dir = format!("connections/{connection_id}");
            host.create_directory(&dir).await?;
            let Some(folder) = folder_of(session_id) else { return Ok(()) };
            for name in CATALOG_FILES {
                if let Some(text) = folder.read_text(name).await? {
                    host.write_text(&format!("{dir}/{name}"), &text).await?;
                }
            }
            Ok::<(), HostError>(())
        };
        if let Err(error) = copy.await {
            // The catalog is a cache, the next refresh describes the relations anyway
            let details = [("connectionId", connection_id.as_str()), ("sessionId", session_id.as_str()), ("error", message(&error))];
            host.log(LogLevel::Warn, "Failed to copy the catalog of a connection", &details);
        }
    }

    manifest.insert("connections".into(), Value::Array(plan.entries.clone()));
    write_manifest(host, &manifest).await?;
    let (connections, rewritten) = (plan.entries.len().to_string(), plan.rewrites.len().to_string());
    host.log(LogLevel::Info, "Migrated connections", &[("connections", &connections), ("sessions", &rewritten)]);

    for (session_id, data) in &plan.rewrites {
        let Some(folder) = folder_of(session_id) else { continue };
        if let Err(error) = folder.write_text("dashql-session.json", &to_pretty_text(&Value::Object(data.clone()))).await {
            host.log(LogLevel::Warn, "Failed to rewrite the connections of a session", &[("sessionId", session_id), ("error", message(&error))]);
        }
    }
    Ok(())
}

/// Sessions keep a copy of the catalog of their default connection up to storage version 3. The step seeds a connection
/// that has no catalog from the copy of the first session that uses it.
///
/// A connection that has a catalog keeps it, the copies are removed by the session format version 7. The catalog is a
/// cache: a native session folder that isn't reachable now loses its copy, the connection describes its catalog when it
/// comes online.
async fn session_catalogs_to_connections<H: StorageRootHost>(host: &H) -> Result<(), HostError> {
    let Some(manifest) = read_manifest(host).await? else {
        return Ok(());
    };
    let mut seeded = 0usize;
    for (session_id, folder) in list_workbook_folders(host, &manifest_folder_entries(&manifest), "sessions").await? {
        let seed = async {
            migrate_folder(&folder, 6).await?;
            let Some(text) = folder.read_text("dashql-session.json").await? else {
                return Ok(false);
            };
            let data: Value = serde_json::from_str(&text).map_err(|error| HostError::new(error.to_string()))?;
            let default_connection_id = match data.get("formatVersion").and_then(Value::as_f64) {
                Some(6.0) => data.get("defaultConnectionId").and_then(Value::as_str),
                _ => None,
            };
            let Some(connection_id) = default_connection_id else {
                return Ok(false);
            };
            let mut copies = Vec::new();
            for name in CATALOG_FILES {
                if let Some(copy) = folder.read_text(name).await? {
                    copies.push((name, copy));
                }
            }
            if copies.is_empty() {
                return Ok(false);
            }
            let dir = format!("connections/{connection_id}");
            host.create_directory(&dir).await?;
            for name in CATALOG_FILES {
                if host.read_text(&format!("{dir}/{name}")).await?.is_some() {
                    return Ok(false);
                }
            }
            for (name, copy) in copies {
                host.write_text(&format!("{dir}/{name}"), &copy).await?;
            }
            Ok::<bool, HostError>(true)
        };
        match seed.await {
            Ok(true) => seeded += 1,
            Ok(false) => {}
            // The catalog is a cache, the next refresh describes the relations anyway
            Err(error) => host.log(LogLevel::Warn, "Failed to seed the catalog of a connection", &[("sessionId", &session_id), ("error", message(&error))]),
        }
    }
    host.log(LogLevel::Info, "Seeded the catalogs of connections", &[("connections", &seeded.to_string())]);
    Ok(())
}

/// The shell keeps its files in `dashql-shell` up to storage version 4, the step moves them to `shell`. The step copies
/// the files, keeping the files that `shell` has already, and then removes the old folder.
async fn shell_folder<H: StorageRootHost>(host: &H) -> Result<(), HostError> {
    if host.list("dashql-shell").await?.is_none() {
        return Ok(());
    }
    host.copy_directory("dashql-shell", "shell", true).await?;
    host.remove("dashql-shell").await
}

/// The connections of the app manifest list the ids of consolidated connections as `aliases` up to storage version 5.
/// The load rewrote the references of every session it restored, the step drops the aliases. Sessions that still name
/// an alias keep an unresolved connection.
async fn drop_connection_aliases<H: StorageRootHost>(host: &H) -> Result<(), HostError> {
    let Some(mut manifest) = read_manifest(host).await? else {
        return Ok(());
    };
    let Some(connections) = manifest.get("connections").and_then(Value::as_array) else {
        return Ok(());
    };
    let connections: Vec<Value> = connections
        .iter()
        .map(|entry| match entry {
            Value::Object(object) if object.contains_key("aliases") => {
                let mut rest = object.clone();
                rest.shift_remove("aliases");
                Value::Object(rest)
            }
            entry => entry.clone(),
        })
        .collect();
    manifest.insert("connections".into(), Value::Array(connections));
    write_manifest(host, &manifest).await
}

/// The sessions of the folder file of a directory of the session tree, empty without one
async fn read_folder_sessions<H: StorageRootHost>(host: &H, dir: &str) -> Result<Vec<Value>, HostError> {
    let path = format!("{dir}/{STORAGE_FOLDER_FILE}");
    let Some(text) = host.read_text(&path).await? else {
        return Ok(Vec::new());
    };
    let data: Value = serde_json::from_str(&text).map_err(|error| HostError::new(format!("Invalid {path}: {error}")))?;
    Ok(data.get("sessions").and_then(Value::as_array).cloned().unwrap_or_default())
}

/// Write the folder file of a directory of the session tree
async fn write_folder_sessions<H: StorageRootHost>(host: &H, dir: &str, sessions: Vec<Value>) -> Result<(), HostError> {
    host.write_text(&format!("{dir}/{STORAGE_FOLDER_FILE}"), &to_pretty_text(&json!({ "sessions": sessions }))).await
}

/// Collect the ids of the sessions that a directory of the tree and its subdirectories register
async fn collect_session_ids<H: StorageRootHost>(host: &H, dir: &str, ids: &mut Vec<String>) -> Result<(), HostError> {
    for entry in read_folder_sessions(host, dir).await? {
        if let Some(path) = entry.get("path").and_then(Value::as_str) {
            if !ids.iter().any(|id| id == path) {
                ids.push(path.to_string());
            }
        }
    }
    for entry in host.list(dir).await?.unwrap_or_default() {
        if entry.directory {
            Box::pin(collect_session_ids(host, &format!("{dir}/{}", entry.name), ids)).await?;
        }
    }
    Ok(())
}

/// The app manifest registers the sessions as `sessions` up to storage version 6, in the order of the sidebar. Version 7
/// registers them in the session tree: the directories of `sessiontree/` are the folders of the sidebar and each one
/// holds a `dashql-folder.json` with its sessions. The step moves the sessions of the manifest into the folder
/// `My Sessions`, in their order, and drops `sessions`.
async fn session_tree<H: StorageRootHost>(host: &H) -> Result<(), HostError> {
    let Some(mut manifest) = read_manifest(host).await? else {
        return Ok(());
    };
    if !manifest.contains_key("sessions") {
        return Ok(());
    }
    let tree = "sessiontree";
    let folder = "sessiontree/My Sessions";
    host.create_directory(tree).await?;
    host.create_directory(folder).await?;
    // An interrupted step may have written the tree already, the sessions it registers stay where they are
    let mut registered = Vec::new();
    collect_session_ids(host, tree, &mut registered).await?;
    let mut sessions = read_folder_sessions(host, folder).await?;
    for entry in manifest_session_entries(&manifest) {
        let Some(path) = entry.get("path").and_then(Value::as_str).filter(|path| !path.is_empty()) else { continue };
        if registered.iter().any(|id| id == path) {
            continue;
        }
        registered.push(path.to_string());
        let mut session = JsonObject::new();
        session.insert("path".into(), json!(path));
        if let Some(storage_type) = entry.get("storageType").and_then(Value::as_str).filter(|t| *t == "opfs" || *t == "native") {
            session.insert("storageType".into(), json!(storage_type));
        }
        if let Some(native_path) = entry.get("nativePath").and_then(Value::as_str) {
            session.insert("nativePath".into(), json!(native_path));
        }
        sessions.push(Value::Object(session));
    }
    let root_sessions = read_folder_sessions(host, tree).await?;
    write_folder_sessions(host, tree, root_sessions).await?;
    write_folder_sessions(host, folder, sessions).await?;
    manifest.shift_remove("sessions");
    write_manifest(host, &manifest).await
}

/// The Database.com connector was called SIDB. Up to storage version 7 the connections of the app manifest keep its
/// params under the key `sidb`, the step moves them to the key `dbcom`. The workbook format version 10 does the same
/// for the connections of the workbooks.
async fn dbcom_connector<H: StorageRootHost>(host: &H) -> Result<(), HostError> {
    let Some(mut manifest) = read_manifest(host).await? else {
        return Ok(());
    };
    let Some(connections) = manifest.get("connections").and_then(Value::as_array) else {
        return Ok(());
    };
    let renamed = rename_sidb_connections(connections);
    manifest.insert("connections".into(), Value::Array(renamed));
    write_manifest(host, &manifest).await
}

/// Move a directory of the root to another name, the content is copied and the source removed after it. A target of
/// an interrupted migration is completed.
async fn move_directory<H: StorageRootHost>(host: &H, from: &str, to: &str) -> Result<(), HostError> {
    if host.list(from).await?.is_none() {
        return Ok(());
    }
    host.copy_directory(from, to, false).await?;
    host.remove(from).await
}

/// Rename the entry list of the folder files of a tree, `sessions` becomes `workbooks`
async fn rename_folder_entries<H: StorageRootHost>(host: &H, dir: &str) -> Result<(), HostError> {
    for entry in host.list(dir).await?.unwrap_or_default() {
        let path = format!("{dir}/{}", entry.name);
        if entry.directory {
            Box::pin(rename_folder_entries(host, &path)).await?;
            continue;
        }
        if entry.name != STORAGE_FOLDER_FILE {
            continue;
        }
        let Some(text) = host.read_text(&path).await? else { continue };
        let Ok(Value::Object(mut data)) = serde_json::from_str::<Value>(&text) else { continue };
        if !data.contains_key("sessions") || data.contains_key("workbooks") {
            continue;
        }
        let workbooks = data.shift_remove("sessions").unwrap_or(Value::Null);
        data.shift_insert(0, "workbooks".into(), workbooks);
        host.write_text(&path, &to_pretty_text(&Value::Object(data))).await?;
    }
    Ok(())
}

/// Sessions are called workbooks: the folders move from `sessions/<uuid>` to `workbooks/<uuid>`, the tree from
/// `sessiontree/` to `workbooktree/` and its folder files list `workbooks` instead of `sessions`. The setting of the
/// sessions that agents may access becomes `agentWorkbooks`. The files inside the folders are renamed by the workbook
/// migration.
///
/// A directory is removed only after it was copied completely, the manifest is rewritten last.
async fn sessions_to_workbooks<H: StorageRootHost>(host: &H) -> Result<(), HostError> {
    move_directory(host, "sessions", "workbooks").await?;
    move_directory(host, "sessiontree", STORAGE_WORKBOOK_TREE_FOLDER).await?;
    if host.list(STORAGE_WORKBOOK_TREE_FOLDER).await?.is_some() {
        rename_folder_entries(host, STORAGE_WORKBOOK_TREE_FOLDER).await?;
    }
    let Some(mut manifest) = read_manifest(host).await? else {
        return Ok(());
    };
    let Some(Value::Object(settings)) = manifest.get("appSettings") else {
        return Ok(());
    };
    if !settings.contains_key("agentSessions") {
        return Ok(());
    }
    let mut settings = settings.clone();
    let agent_workbooks = settings.shift_remove("agentSessions").unwrap_or(Value::Null);
    settings.insert("agentWorkbooks".into(), agent_workbooks);
    manifest.insert("appSettings".into(), Value::Object(settings));
    write_manifest(host, &manifest).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_timestamps_like_to_iso_string() {
        assert_eq!(iso_timestamp(0.0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_timestamp(1_767_225_600_000.0), "2026-01-01T00:00:00.000Z");
        assert_eq!(iso_timestamp(1_761_091_200_123.0), "2025-10-22T00:00:00.123Z");
        assert_eq!(iso_timestamp(951_782_400_000.0 + 3_723_004.0), "2000-02-29T01:02:03.004Z");
        assert_eq!(iso_timestamp(-1.0), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn ends_with_the_current_storage_version() {
        let versions: Vec<i64> = STORAGE_MIGRATION_STEPS.iter().map(|step| step.version).collect();
        assert_eq!(versions, (2..=STORAGE_VERSION).collect::<Vec<_>>());
    }
}
