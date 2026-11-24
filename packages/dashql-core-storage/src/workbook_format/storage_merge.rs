//! The merge of another storage root into the storage root of the app.
//!
//! The desktop app kept its storage in user data folders named after its npm package until it pinned the folder
//! `DashQL` (docs/design/electron.md). The platform copies the storage of each earlier folder into a directory below the
//! storage root (`legacy-profiles/<name>`) and `merge_storage` merges it: the staged root is brought to the current
//! storage version where it lies, then its workbooks, connections, settings and the files of the shell and the clouds
//! join the root, and the staged directory goes. What the root holds already wins: a workbook or a connection keeps its
//! files and entry, a setting its value, a file of the shell or a cloud its content. The ephemeral workbook of the
//! staged root stays behind, the root has its own.
//!
//! Every write keeps what exists, so a merge that is interrupted is run again from the start and ends the same. The
//! files of a workbook are copied before the workbook tree registers it, the files of a connection before the manifest
//! lists it. The staged directory is removed last.

use serde_json::Value;

use crate::workbook_format::data::{WorkbookData, STORAGE_VERSION};
use crate::workbook_format::json::JsonObject;
use crate::workbook_format::layout::{
    StorageType, HYPER_CLOUDS_DIRECTORY, STORAGE_CONNECTIONS_FOLDER, STORAGE_FOLDER_FILE, STORAGE_WORKBOOK_FILE,
    STORAGE_WORKBOOK_TREE_FOLDER,
};
use crate::workbook_format::storage_migration::{
    migrate_storage, read_manifest, read_tree_directory, write_manifest, DirEntry, StorageMigrationSummary,
    StorageRootHost,
};
use crate::workbook_format::tree::{
    change_workbook_tree, folder_name_error, read_stored_workbook_tree, read_workbook_tree, WorkbookTreeChange,
    WorkbookTreeFolder,
};
use dashql_core_runtime::host::{HostError, LogLevel};

/// The directory below the storage root where the platform stages the storage roots that merge into it, one
/// directory per earlier profile
pub const STORAGE_STAGED_PROFILES_FOLDER: &str = "legacy-profiles";

/// The directory below the storage root where the platform stages the storage root of an earlier profile, e.g.
/// `legacy-profiles/ankoh-dashql-native`. The name is a single directory name.
pub fn staged_profile_folder(name: &str) -> Result<String, HostError> {
    match folder_name_error(name, &[]) {
        Some(error) => Err(HostError::new(format!("Invalid profile name: {error}"))),
        None => Ok(format!("{STORAGE_STAGED_PROFILES_FOLDER}/{name}")),
    }
}

/// The folder of the OPFS workbooks below a storage root
const WORKBOOKS_FOLDER: &str = "workbooks";
/// The folder of the files of the shell below a storage root
const SHELL_FOLDER: &str = "shell";

/// What a merge of a storage root changed
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StorageMergeSummary {
    /// What the migration of the staged root changed
    pub migration: StorageMigrationSummary,
    /// The workbooks that the root registers now
    pub workbooks: u32,
    /// The connections that the manifest of the root lists now
    pub connections: u32,
}

/// A directory below a storage root as a storage root of its own, e.g. to migrate a staged root where it lies. The
/// native workbook folders are the ones of the host.
struct Below<'a, H> {
    host: &'a H,
    dir: &'a str,
}

impl<H> Below<'_, H> {
    fn path(&self, path: &str) -> String {
        if path.is_empty() {
            self.dir.to_string()
        } else {
            format!("{}/{path}", self.dir)
        }
    }
}

impl<H: StorageRootHost> StorageRootHost for Below<'_, H> {
    type Folder = H::Folder;

    fn now(&self) -> f64 {
        self.host.now()
    }
    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let mut all = details.to_vec();
        all.push(("stagedRoot", self.dir));
        self.host.log(level, message, &all);
    }
    async fn read_text(&self, path: &str) -> Result<Option<String>, HostError> {
        self.host.read_text(&self.path(path)).await
    }
    async fn write_text(&self, path: &str, text: &str) -> Result<(), HostError> {
        self.host.write_text(&self.path(path), text).await
    }
    async fn create_directory(&self, path: &str) -> Result<(), HostError> {
        self.host.create_directory(&self.path(path)).await
    }
    async fn remove(&self, path: &str) -> Result<(), HostError> {
        self.host.remove(&self.path(path)).await
    }
    async fn list(&self, path: &str) -> Result<Option<Vec<DirEntry>>, HostError> {
        self.host.list(&self.path(path)).await
    }
    async fn copy_directory(&self, from: &str, to: &str, keep_existing: bool) -> Result<(), HostError> {
        self.host.copy_directory(&self.path(from), &self.path(to), keep_existing).await
    }
    fn folder(&self, path: &str) -> Self::Folder {
        self.host.folder(&self.path(path))
    }
    async fn native_folder(&self, native_path: &str) -> Result<Option<Self::Folder>, HostError> {
        self.host.native_folder(native_path).await
    }
    fn random_uuid(&self) -> Result<String, HostError> {
        self.host.random_uuid()
    }
}

/// The id of a connection entry of a manifest
fn connection_id(entry: &Value) -> Option<&str> {
    entry.get("id").and_then(Value::as_str).filter(|id| !id.is_empty())
}

/// The connection entries of a manifest
fn connections(manifest: &JsonObject) -> Vec<Value> {
    manifest.get("connections").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// The workbook tree below a directory of a storage root, as it is stored
async fn read_tree<H: StorageRootHost>(host: &H, tree_dir: &str) -> Result<WorkbookTreeFolder, HostError> {
    let directory = match host.list(tree_dir).await? {
        Some(_) => Some(read_tree_directory(host, tree_dir, "").await?),
        None => None,
    };
    read_stored_workbook_tree(directory.as_ref()).map_err(|error| HostError::new(error.message))
}

/// The path in the tree of the root that a folder of the staged tree merges into: the folders of the root whose names
/// equal the names of the path without their case, then the names of the staged path
fn merged_folder_path(tree: &WorkbookTreeFolder, path: &[String]) -> Vec<String> {
    let mut merged = Vec::with_capacity(path.len());
    let mut current = Some(tree);
    for name in path {
        let lower = name.to_lowercase();
        let found = current.and_then(|folder| folder.folders.iter().find(|child| child.name.to_lowercase() == lower));
        merged.push(found.map_or_else(|| name.clone(), |folder| folder.name.clone()));
        current = found;
    }
    merged
}

/// The directory of a folder of the workbook tree of the root
fn tree_directory(path: &[String]) -> String {
    std::iter::once(STORAGE_WORKBOOK_TREE_FOLDER).chain(path.iter().map(String::as_str)).collect::<Vec<_>>().join("/")
}

/// The ephemeral workbook of the greeter: its file says so and it has no scripts. A marked workbook with scripts waits
/// for its promotion, the restore finishes it.
async fn is_greeter_workbook<H: StorageRootHost>(host: &H, folder: &str) -> Result<bool, HostError> {
    let Some(text) = host.read_text(&format!("{folder}/{STORAGE_WORKBOOK_FILE}")).await? else {
        return Ok(false);
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return Ok(false);
    };
    let data = WorkbookData::from_json(&value);
    Ok(data.metadata.is_ephemeral() && data.scripts.is_empty())
}

/// Remove the directory of a staged root once it holds no other staged root
async fn remove_empty_parent<H: StorageRootHost>(host: &H, source: &str) -> Result<(), HostError> {
    if let Some((parent, _)) = source.rsplit_once('/') {
        if host.list(parent).await?.is_some_and(|entries| entries.is_empty()) {
            host.remove(parent).await?;
        }
    }
    Ok(())
}

/// Merge the storage root that the platform staged in a directory below the root into the root. The root is at the
/// current storage version, the caller migrated it and holds the locks of its manifest and its workbook tree. A missing
/// directory merges nothing. Returns what the merge changed.
pub async fn merge_storage<H: StorageRootHost>(host: &H, source: &str) -> Result<StorageMergeSummary, HostError> {
    let mut summary = StorageMergeSummary::default();
    if source.is_empty() {
        return Ok(summary);
    }
    if host.list(source).await?.is_none() {
        // A merge that was interrupted after it removed the staged root
        remove_empty_parent(host, source).await?;
        return Ok(summary);
    }
    host.log(LogLevel::Info, "Merging a storage", &[("source", source)]);
    summary.migration = migrate_storage(&Below { host, dir: source }).await?;

    // The connections and the settings, the manifest of the root lists a connection after its files were copied
    let mut manifest = read_manifest(host).await?.unwrap_or_default();
    let staged = read_manifest(&Below { host, dir: source }).await?.unwrap_or_default();
    let mut listed = connections(&manifest);
    let mut changed = false;
    for entry in connections(&staged) {
        let Some(id) = connection_id(&entry) else { continue };
        if listed.iter().any(|existing| connection_id(existing) == Some(id)) {
            continue;
        }
        let from = format!("{source}/{STORAGE_CONNECTIONS_FOLDER}/{id}");
        if host.list(&from).await?.is_some() {
            host.copy_directory(&from, &format!("{STORAGE_CONNECTIONS_FOLDER}/{id}"), true).await?;
        }
        listed.push(entry);
        summary.connections += 1;
        changed = true;
    }
    if changed {
        manifest.insert("connections".into(), Value::Array(listed));
    }
    if let Some(Value::Object(staged_settings)) = staged.get("appSettings") {
        let mut settings = match manifest.get("appSettings") {
            Some(Value::Object(settings)) => settings.clone(),
            _ => JsonObject::new(),
        };
        let before = settings.len();
        for (key, value) in staged_settings {
            if !settings.contains_key(key) {
                settings.insert(key.clone(), value.clone());
            }
        }
        if settings.len() != before || !manifest.contains_key("appSettings") {
            manifest.insert("appSettings".into(), Value::Object(settings));
            changed = true;
        }
    }
    if changed {
        if !manifest.contains_key("storageVersion") {
            manifest.insert("storageVersion".into(), STORAGE_VERSION.into());
        }
        write_manifest(host, &manifest).await?;
    }

    // The workbooks, in the folders of the staged tree. A folder of the root with the same name takes them, the other
    // folders are created, also the empty ones.
    // A staged root without a tree registers no workbooks, and the root keeps the tree it starts with.
    let staged_tree_dir = format!("{source}/{STORAGE_WORKBOOK_TREE_FOLDER}");
    let staged_directory = match host.list(&staged_tree_dir).await? {
        Some(_) => Some(read_tree_directory(host, &staged_tree_dir, "").await?),
        None => None,
    };
    let staged_tree = read_workbook_tree(staged_directory.as_ref()).map_err(|error| HostError::new(error.message))?;
    let mut tree = read_tree(host, STORAGE_WORKBOOK_TREE_FOLDER).await?;
    let mut created_folder = false;
    let root_has_tree = host.list(STORAGE_WORKBOOK_TREE_FOLDER).await?.is_some();
    for folder in staged_directory.iter().flat_map(|_| staged_tree.list_folders()) {
        let path = merged_folder_path(&tree, &folder.path);
        if tree.folder_at(&path).is_none() || (path.is_empty() && !root_has_tree) {
            host.create_directory(&tree_directory(&path)).await?;
            created_folder = true;
        }
    }
    if created_folder {
        tree = read_tree(host, STORAGE_WORKBOOK_TREE_FOLDER).await?;
    }
    for folder in staged_tree.list_folders() {
        let path = merged_folder_path(&tree, &folder.path);
        for entry in &folder.workbooks {
            let id = entry.path.to_lowercase();
            if tree.flatten().iter().any(|registered| registered.path.to_lowercase() == id) {
                continue;
            }
            if entry.storage_type != Some(StorageType::Native) {
                let from = format!("{source}/{WORKBOOKS_FOLDER}/{}", entry.path);
                if host.list(&from).await?.is_none() {
                    host.log(LogLevel::Warn, "Skipping a workbook without files", &[("workbookId", &entry.path)]);
                    continue;
                }
                if is_greeter_workbook(host, &from).await? {
                    continue;
                }
                host.copy_directory(&from, &format!("{WORKBOOKS_FOLDER}/{}", entry.path), true).await?;
            }
            let change = WorkbookTreeChange::Upsert { entry: entry.clone(), folder_path: path.clone() };
            let (next, writes) = change_workbook_tree(&tree, change).map_err(|error| HostError::new(error.message))?;
            for write in writes {
                host.write_text(&format!("{}/{STORAGE_FOLDER_FILE}", tree_directory(&write.path)), &write.text).await?;
            }
            tree = next;
            summary.workbooks += 1;
        }
    }

    // The files of the shell and the databases of the clouds, the files of the root win
    if host.list(&format!("{source}/{SHELL_FOLDER}")).await?.is_some() {
        host.copy_directory(&format!("{source}/{SHELL_FOLDER}"), SHELL_FOLDER, true).await?;
    }
    if let Some(staged_clouds) = host.list(&format!("{source}/{HYPER_CLOUDS_DIRECTORY}")).await? {
        let clouds = host.list(HYPER_CLOUDS_DIRECTORY).await?.unwrap_or_default();
        for entry in staged_clouds.iter().filter(|entry| clouds.iter().any(|kept| kept.name == entry.name)) {
            host.log(LogLevel::Warn, "Keeping the database of a cloud of the storage", &[("file", &entry.name)]);
        }
        host.copy_directory(&format!("{source}/{HYPER_CLOUDS_DIRECTORY}"), HYPER_CLOUDS_DIRECTORY, true).await?;
    }

    host.remove(source).await?;
    remove_empty_parent(host, source).await?;
    let (workbooks, connections) = (summary.workbooks.to_string(), summary.connections.to_string());
    host.log(
        LogLevel::Info,
        "Merged a storage",
        &[("source", source), ("workbooks", &workbooks), ("connections", &connections)],
    );
    Ok(summary)
}
