//! The migrations of a workbook folder to the current format version. Ported from `storage/migration/`.
//!
//! A migration only touches the top-level files of a folder, a fixed set of names (`MIGRATION_FILES`). The host reads
//! the ones that exist into a `MigrationFolder`, the migration changes the folder in memory, and the host applies
//! `MigrationFolder::changes`: the writes first, then the removals. A folder that must stay untouched (an import) is
//! simply not written back. Steps are idempotent, an interrupted migration repeats its last step.
//!
//! `migrate_folder` runs the migration on a folder of the storage (`FolderHost`): it reads the files, migrates them in
//! memory and writes back what changed.

use serde_json::{json, Value};

use dashql_core::error::{Error, Result};

use crate::host::HostError;
use crate::workbook_format::data::WORKBOOK_FORMAT_VERSION;
use crate::workbook_format::json::{to_pretty_text, JsonObject};

/// The top-level files that the migrations read, every name they ever had
pub const MIGRATION_FILES: [&str; 10] = [
    "dashql-workbook.json",
    "dashql-session.json",
    "dashql-notebook.json",
    "dashql-notebook-index.json",
    "dashql-session-index.json",
    "dashql-relations.sql",
    "dashql-functions.sql",
    "dashql-catalog-relations.sql",
    "dashql-catalog-functions.sql",
    "dashql-catalog-changes.sql",
];

/// Every name the workbook metadata had, newest first
const WORKBOOK_METADATA_FILES: [&str; 3] = ["dashql-workbook.json", "dashql-session.json", "dashql-notebook.json"];

/// The oldest format version the steps migrate
const OLDEST_WORKBOOK_FORMAT_VERSION: i64 = 2;

/// A change of a folder that the host applies
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FolderChange {
    /// Write a file
    Write { name: String, text: String },
    /// Remove a file, a missing file is ignored
    Remove { name: String },
}

/// The top-level files of a folder in memory. It remembers the files as they were read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MigrationFolder {
    /// The files as they were read
    base: Vec<(String, String)>,
    /// The files now, in the order they were created
    files: Vec<(String, String)>,
}

impl MigrationFolder {
    /// A folder with files
    pub fn new<N: Into<String>, T: Into<String>>(files: impl IntoIterator<Item = (N, T)>) -> Self {
        let mut folder = Self::default();
        for (name, text) in files {
            folder.write(name.into(), text.into());
        }
        folder.base = folder.files.clone();
        folder
    }

    /// Does the folder hold a file?
    pub fn exists(&self, name: &str) -> bool {
        self.files.iter().any(|(n, _)| n == name)
    }

    /// The text of a file, None if the folder doesn't hold it
    pub fn read(&self, name: &str) -> Option<&str> {
        self.files.iter().find(|(n, _)| n == name).map(|(_, text)| text.as_str())
    }

    /// Write a file
    pub fn write(&mut self, name: impl Into<String>, text: impl Into<String>) {
        let name = name.into();
        let text = text.into();
        match self.files.iter_mut().find(|(n, _)| *n == name) {
            Some(file) => file.1 = text,
            None => self.files.push((name, text)),
        }
    }

    /// Remove a file, a missing file is ignored
    pub fn remove(&mut self, name: &str) {
        self.files.retain(|(n, _)| n != name);
    }

    /// Rename a file, an existing target is replaced
    pub fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        let Some(text) = self.read(from).map(str::to_string) else {
            return Err(Error::invalid_argument(format!("Cannot rename missing file {from}")));
        };
        self.remove(from);
        self.remove(to);
        self.files.push((to.to_string(), text));
        Ok(())
    }

    /// Rename a file while it exists and the target does not. Returns whether the file was renamed.
    pub fn rename_if_present(&mut self, from: &str, to: &str) -> Result<bool> {
        if !self.exists(from) || self.exists(to) {
            return Ok(false);
        }
        self.rename(from, to)?;
        Ok(true)
    }

    /// The names of the files, in the order they were created
    pub fn names(&self) -> Vec<&str> {
        self.files.iter().map(|(name, _)| name.as_str()).collect()
    }

    /// The files
    pub fn files(&self) -> &[(String, String)] {
        &self.files
    }

    /// What changed since the files were read: the writes, then the removals
    pub fn changes(&self) -> Vec<FolderChange> {
        let mut changes: Vec<FolderChange> = self
            .files
            .iter()
            .filter(|(name, text)| !self.base.iter().any(|(n, t)| n == name && t == text))
            .map(|(name, text)| FolderChange::Write { name: name.clone(), text: text.clone() })
            .collect();
        changes.extend(
            self.base
                .iter()
                .filter(|(name, _)| !self.exists(name))
                .map(|(name, _)| FolderChange::Remove { name: name.clone() }),
        );
        changes
    }
}

/// A step that brings a folder from the previous format version to `version`
#[derive(Clone, Copy)]
pub struct WorkbookMigrationStep {
    /// The format version the step produces
    pub version: i64,
    /// What the step changes
    pub description: &'static str,
    /// Migrate the folder
    pub migrate: fn(&mut MigrationFolder) -> Result<()>,
}

/// The steps in order. Steps are never removed, a workbook may skip any number of app versions.
pub const WORKBOOK_MIGRATION_STEPS: [WorkbookMigrationStep; 9] = [
    WorkbookMigrationStep { version: 3, description: "Prefix the catalog files with dashql-catalog", migrate: catalog_file_prefix },
    WorkbookMigrationStep { version: 4, description: "Rename notebooks as sessions", migrate: notebooks_to_sessions },
    WorkbookMigrationStep {
        version: 5,
        description: "List the scripts with their databases in the session metadata",
        migrate: scripts_in_session_file,
    },
    WorkbookMigrationStep {
        version: 6,
        description: "List the databases of the session as connections with a default connection",
        migrate: session_connections,
    },
    WorkbookMigrationStep { version: 7, description: "Remove the catalog copies of the session", migrate: catalogs_of_connections },
    WorkbookMigrationStep {
        version: 8,
        description: "Hold the connections of the scripts without a default connection",
        migrate: connections_of_scripts,
    },
    WorkbookMigrationStep {
        version: 9,
        description: "Remove the settings of the session, connections decide whether query results are cached",
        migrate: drop_session_settings,
    },
    WorkbookMigrationStep { version: 10, description: "Rename the connection params of the SIDB connector to dbcom", migrate: dbcom_connector },
    WorkbookMigrationStep { version: 11, description: "Rename sessions as workbooks", migrate: sessions_to_workbooks },
];

/// The outcome of a migration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkbookMigrationResult {
    /// The workbook was at the target version already
    Current,
    /// Steps were applied
    Migrated,
    /// The folder has no workbook metadata
    Missing,
    /// The metadata is unreadable or older than the oldest supported version, the folder stays untouched
    Unsupported,
    /// The workbook was written by a newer version of the app, the folder stays untouched
    Newer,
}

impl WorkbookMigrationResult {
    /// The name of the outcome, e.g. for the log
    pub fn as_str(self) -> &'static str {
        match self {
            WorkbookMigrationResult::Current => "current",
            WorkbookMigrationResult::Migrated => "migrated",
            WorkbookMigrationResult::Missing => "missing",
            WorkbookMigrationResult::Unsupported => "unsupported",
            WorkbookMigrationResult::Newer => "newer",
        }
    }
}

/// The metadata of a folder under its newest name, with its object if it is one
fn read_metadata(folder: &MigrationFolder) -> Option<(&'static str, Option<JsonObject>)> {
    WORKBOOK_METADATA_FILES.iter().find_map(|name| {
        let text = folder.read(name)?;
        Some((*name, match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(object)) => Some(object),
            _ => None,
        }))
    })
}

/// The top-level files of a workbook folder in storage, as the migrations read and write them
#[allow(async_fn_in_trait)] // The futures hold values of the host and run on its thread, they are not Send
pub trait FolderHost {
    /// The text of a file, None if the folder doesn't hold it
    async fn read_text(&self, name: &str) -> std::result::Result<Option<String>, HostError>;
    /// Write a file
    async fn write_text(&self, name: &str, text: &str) -> std::result::Result<(), HostError>;
    /// Remove a file, a missing file is ignored
    async fn remove(&self, name: &str) -> std::result::Result<(), HostError>;
}

/// The text of the workbook file of a folder at the current format version, None if the folder needs the migrations.
/// The migrations read nothing else of a current folder.
pub async fn read_current_workbook_file<F: FolderHost>(folder: &F) -> std::result::Result<Option<String>, HostError> {
    let Some(text) = folder.read_text(WORKBOOK_METADATA_FILES[0]).await? else {
        return Ok(None);
    };
    let version = serde_json::from_str::<Value>(&text).ok().and_then(|data| data.get("formatVersion").and_then(Value::as_f64));
    Ok((version == Some(WORKBOOK_FORMAT_VERSION as f64)).then_some(text))
}

/// Bring a workbook folder of the storage to a format version: read its top-level files, migrate them in memory and
/// write back what changed, the writes first, then the removals. A folder whose workbook file is at the current version
/// is only read.
pub async fn migrate_folder<F: FolderHost>(folder: &F, target_version: i64) -> std::result::Result<WorkbookMigrationResult, HostError> {
    if target_version == WORKBOOK_FORMAT_VERSION && read_current_workbook_file(folder).await?.is_some() {
        return Ok(WorkbookMigrationResult::Current);
    }
    let mut files = Vec::new();
    for name in MIGRATION_FILES {
        if let Some(text) = folder.read_text(name).await? {
            files.push((name.to_string(), text));
        }
    }
    let mut memory = MigrationFolder::new(files);
    let result = migrate_workbook_folder_to(&mut memory, target_version, &WORKBOOK_MIGRATION_STEPS).map_err(|error| HostError::new(error.message))?;
    for change in memory.changes() {
        match change {
            FolderChange::Write { name, text } => folder.write_text(&name, &text).await?,
            FolderChange::Remove { name } => folder.remove(&name).await?,
        }
    }
    Ok(result)
}

/// Bring a folder to the current format version
pub fn migrate_workbook_folder(folder: &mut MigrationFolder) -> Result<WorkbookMigrationResult> {
    migrate_workbook_folder_to(folder, WORKBOOK_FORMAT_VERSION, &WORKBOOK_MIGRATION_STEPS)
}

/// Bring a folder to a format version with steps
pub fn migrate_workbook_folder_to(
    folder: &mut MigrationFolder,
    target_version: i64,
    steps: &[WorkbookMigrationStep],
) -> Result<WorkbookMigrationResult> {
    let Some((_, data)) = read_metadata(folder) else {
        return Ok(WorkbookMigrationResult::Missing);
    };
    let version = data.as_ref().and_then(|data| data.get("formatVersion")).and_then(Value::as_f64);
    let Some(version) = version.filter(|v| v.fract() == 0.0 && *v >= OLDEST_WORKBOOK_FORMAT_VERSION as f64).map(|v| v as i64) else {
        return Ok(WorkbookMigrationResult::Unsupported);
    };
    let latest = steps.iter().map(|step| step.version).fold(OLDEST_WORKBOOK_FORMAT_VERSION, i64::max);
    if version > latest {
        return Ok(WorkbookMigrationResult::Newer);
    }
    let mut current = version;
    for step in steps {
        if step.version <= current || step.version > target_version {
            continue;
        }
        (step.migrate)(folder)?;
        let Some((name, Some(mut data))) = read_metadata(folder) else {
            return Err(Error::invalid_argument(format!(
                "Workbook migration to format version {} lost the workbook metadata",
                step.version
            )));
        };
        data.insert("formatVersion".into(), json!(step.version));
        folder.write(name, to_pretty_text(&Value::Object(data)));
        current = step.version;
    }
    Ok(if current == version { WorkbookMigrationResult::Current } else { WorkbookMigrationResult::Migrated })
}

/// Read a metadata file of a step as an object
fn read_object(folder: &MigrationFolder, name: &str) -> Result<Option<JsonObject>> {
    let Some(text) = folder.read(name) else {
        return Ok(None);
    };
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(object)) => Ok(Some(object)),
        _ => Err(Error::invalid_argument(format!("Invalid {name}"))),
    }
}

fn write_object(folder: &mut MigrationFolder, name: &str, object: JsonObject) {
    folder.write(name, to_pretty_text(&Value::Object(object)));
}

/// Rename the fields of an object, the renamed fields keep their place
fn rename_fields(data: &JsonObject, renames: &[(&str, &str)]) -> Option<JsonObject> {
    if !data.keys().any(|key| renames.iter().any(|(from, _)| from == key)) {
        return None;
    }
    let mut renamed = JsonObject::new();
    for (key, value) in data {
        let key = renames.iter().find(|(from, _)| from == key).map(|(_, to)| to.to_string()).unwrap_or_else(|| key.clone());
        renamed.insert(key, value.clone());
    }
    Some(renamed)
}

/// Version 3: the catalog files share the dashql-catalog prefix
fn catalog_file_prefix(folder: &mut MigrationFolder) -> Result<()> {
    folder.rename_if_present("dashql-relations.sql", "dashql-catalog-relations.sql")?;
    folder.rename_if_present("dashql-functions.sql", "dashql-catalog-functions.sql")?;
    Ok(())
}

/// Version 4: notebooks are called sessions, the files and the identity of the metadata follow
fn notebooks_to_sessions(folder: &mut MigrationFolder) -> Result<()> {
    folder.rename_if_present("dashql-notebook.json", "dashql-session.json")?;
    folder.rename_if_present("dashql-notebook-index.json", "dashql-session-index.json")?;
    let Some(data) = read_object(folder, "dashql-session.json")? else {
        return Ok(());
    };
    if let Some(renamed) = rename_fields(&data, &[("notebookId", "sessionId"), ("notebookPath", "sessionPath")]) {
        write_object(folder, "dashql-session.json", renamed);
    }
    Ok(())
}

/// The file names of an index of version 4, an unreadable index lists nothing
fn parse_index(text: Option<&str>) -> (Vec<String>, Vec<String>) {
    let names = |entries: Option<&Value>| -> Vec<String> {
        entries
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(|entry| entry.get("name")?.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    match text.and_then(|text| serde_json::from_str::<Value>(text).ok()) {
        Some(index) => (names(index.get("scripts")), names(index.get("data"))),
        None => (Vec::new(), Vec::new()),
    }
}

/// Version 5: the order of the scripts and the database of each script live in the session metadata
fn scripts_in_session_file(folder: &mut MigrationFolder) -> Result<()> {
    let Some(mut data) = read_object(folder, "dashql-session.json")? else {
        return Ok(());
    };
    if !data.get("scripts").is_some_and(Value::is_array) {
        let database_id = data.get("mainDatabase").and_then(|db| db.get("databaseId")).and_then(Value::as_str).map(str::to_string);
        let (scripts, files) = parse_index(folder.read("dashql-session-index.json"));
        let scripts: Vec<Value> = match database_id {
            Some(database_id) => scripts.into_iter().map(|name| json!({ "name": name, "databaseId": database_id })).collect(),
            None => Vec::new(),
        };
        data.insert("scripts".into(), Value::Array(scripts));
        data.insert("attachments".into(), Value::Array(files.into_iter().map(|name| json!({ "name": name })).collect()));
        write_object(folder, "dashql-session.json", data);
    }
    folder.remove("dashql-session-index.json");
    Ok(())
}

/// Version 6: the databases of a session become one list of connections with a default connection
fn session_connections(folder: &mut MigrationFolder) -> Result<()> {
    let Some(data) = read_object(folder, "dashql-session.json")? else {
        return Ok(());
    };
    if data.get("connections").is_some_and(Value::is_array) {
        return Ok(());
    }
    let main_database = data.get("mainDatabase");
    let attached: Vec<Value> = data.get("attachedDatabases").and_then(Value::as_array).cloned().unwrap_or_default();
    let connections: Vec<Value> = main_database
        .into_iter()
        .chain(attached.iter())
        .filter_map(|database| {
            let database = database.as_object()?;
            let mut connection = JsonObject::new();
            if let Some(id) = database.get("databaseId") {
                connection.insert("connectionId".into(), id.clone());
            }
            for (key, value) in database {
                if key != "databaseId" {
                    connection.insert(key.clone(), value.clone());
                }
            }
            Some(Value::Object(connection))
        })
        .collect();
    let default_connection_id = main_database.and_then(|db| db.get("databaseId")).filter(|id| id.is_string()).cloned().unwrap_or(Value::Null);
    let insert_fields = |migrated: &mut JsonObject| {
        migrated.insert("defaultConnectionId".into(), default_connection_id.clone());
        migrated.insert("connections".into(), Value::Array(connections.clone()));
    };
    // The connections take the place of the main database in the metadata
    let mut migrated = JsonObject::new();
    for (key, value) in &data {
        match key.as_str() {
            "mainDatabase" => insert_fields(&mut migrated),
            "attachedDatabases" => {}
            "scripts" if value.is_array() => {
                let scripts = value
                    .as_array()
                    .map(|list| {
                        list.iter()
                            .map(|script| match script.as_object() {
                                Some(object) => {
                                    let mut next = JsonObject::new();
                                    for (k, v) in object {
                                        if k != "databaseId" {
                                            next.insert(k.clone(), v.clone());
                                        }
                                    }
                                    // An undefined id is left out, like JSON.stringify does
                                    if let Some(id) = object.get("databaseId") {
                                        next.insert("connectionId".into(), id.clone());
                                    }
                                    Value::Object(next)
                                }
                                None => script.clone(),
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                migrated.insert("scripts".into(), Value::Array(scripts));
            }
            _ => {
                migrated.insert(key.clone(), value.clone());
            }
        }
    }
    if !data.contains_key("mainDatabase") {
        insert_fields(&mut migrated);
    }
    write_object(folder, "dashql-session.json", migrated);
    Ok(())
}

/// Version 7: sessions no longer copy the catalog of their connection
fn catalogs_of_connections(folder: &mut MigrationFolder) -> Result<()> {
    folder.remove("dashql-catalog-relations.sql");
    folder.remove("dashql-catalog-functions.sql");
    folder.remove("dashql-catalog-changes.sql");
    Ok(())
}

/// Version 8: sessions hold the connections their scripts use, without a default connection
fn connections_of_scripts(folder: &mut MigrationFolder) -> Result<()> {
    let Some(data) = read_object(folder, "dashql-session.json")? else {
        return Ok(());
    };
    let empty: Vec<Value> = Vec::new();
    let scripts = data.get("scripts").and_then(Value::as_array).unwrap_or(&empty);
    let connections = data.get("connections").and_then(Value::as_array).unwrap_or(&empty);
    let script_connection_ids: Vec<&str> = scripts.iter().filter_map(|script| script.get("connectionId")?.as_str()).collect();
    let mut by_id: Vec<(&str, &Value)> = Vec::new();
    for connection in connections {
        if let Some(id) = connection.get("connectionId").and_then(Value::as_str) {
            if !by_id.iter().any(|(known, _)| *known == id) {
                by_id.push((id, connection));
            }
        }
    }
    let lookup = |id: &str| by_id.iter().find(|(known, _)| *known == id).map(|(_, connection)| (*connection).clone());
    let empty_connection_id = data
        .get("defaultConnectionId")
        .and_then(Value::as_str)
        .filter(|id| lookup(*id).is_some())
        .or_else(|| by_id.first().map(|(id, _)| *id));
    let used: Vec<&str> = if !script_connection_ids.is_empty() { script_connection_ids } else { empty_connection_id.into_iter().collect() };
    let mut unique: Vec<&str> = Vec::new();
    for id in used {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    // A session holds at least one connection, scripts on unknown connections run on it
    let mut kept: Vec<Value> = unique.into_iter().filter_map(lookup).collect();
    if kept.is_empty() {
        if let Some(connection) = empty_connection_id.and_then(lookup) {
            kept.push(connection);
        }
    }
    let mut migrated = JsonObject::new();
    for (key, value) in &data {
        match key.as_str() {
            "defaultConnectionId" => {}
            "connections" => {
                migrated.insert(key.clone(), Value::Array(kept.clone()));
            }
            _ => {
                migrated.insert(key.clone(), value.clone());
            }
        }
    }
    write_object(folder, "dashql-session.json", migrated);
    Ok(())
}

/// Version 9: connections decide whether query results are cached, sessions have no settings
fn drop_session_settings(folder: &mut MigrationFolder) -> Result<()> {
    let Some(mut data) = read_object(folder, "dashql-session.json")? else {
        return Ok(());
    };
    if data.shift_remove("settings").is_some() {
        write_object(folder, "dashql-session.json", data);
    }
    Ok(())
}

/// Rename the `sidb` key of the `params` and the `paramsDraft` of stored connections to `dbcom`. Sessions and the app
/// manifest share the shape.
pub fn rename_sidb_connections(connections: &[Value]) -> Vec<Value> {
    let renamed = |params: &Value| -> Value {
        let Some(object) = params.as_object().filter(|object| object.contains_key("sidb")) else {
            return params.clone();
        };
        let mut next = JsonObject::new();
        for (key, value) in object {
            if key != "sidb" {
                next.insert(key.clone(), value.clone());
            }
        }
        next.insert("dbcom".into(), object.get("sidb").cloned().unwrap_or(Value::Null));
        Value::Object(next)
    };
    connections
        .iter()
        .map(|connection| {
            let Some(entry) = connection.as_object() else {
                return connection.clone();
            };
            let mut next = entry.clone();
            if let Some(params) = entry.get("params") {
                next.insert("params".into(), renamed(params));
            }
            if let Some(draft) = entry.get("paramsDraft") {
                next.insert("paramsDraft".into(), renamed(draft));
            }
            Value::Object(next)
        })
        .collect()
}

/// Version 10: the Database.com connector was called SIDB
fn dbcom_connector(folder: &mut MigrationFolder) -> Result<()> {
    let Some(mut data) = read_object(folder, "dashql-session.json")? else {
        return Ok(());
    };
    let Some(connections) = data.get("connections").and_then(Value::as_array) else {
        return Ok(());
    };
    let renamed = rename_sidb_connections(connections);
    data.insert("connections".into(), Value::Array(renamed));
    write_object(folder, "dashql-session.json", data);
    Ok(())
}

/// Version 11: sessions are called workbooks, the metadata file and the identity of the metadata follow
fn sessions_to_workbooks(folder: &mut MigrationFolder) -> Result<()> {
    folder.rename_if_present("dashql-session.json", "dashql-workbook.json")?;
    let Some(data) = read_object(folder, "dashql-workbook.json")? else {
        return Ok(());
    };
    if let Some(renamed) = rename_fields(&data, &[("sessionId", "workbookId"), ("sessionPath", "workbookPath")]) {
        write_object(folder, "dashql-workbook.json", renamed);
    }
    Ok(())
}
