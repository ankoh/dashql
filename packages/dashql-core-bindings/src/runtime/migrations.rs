//! The migrations of the stored state over the platform (docs/design/storage_layout.md): the storage root of the app is
//! brought to the current storage version with the steps of the crate (`workbook_format::storage_migration`), and every
//! workbook folder to the current workbook format (`workbook_format::migration`).
//!
//! `JsStorageRoot` is the host of the steps over a storage root of the platform: the files and directories below the
//! root by path, and the native workbook folders that the platform claims. The migration of the storage root is a
//! static function of the module (`Runtime.migrateStorage`), the app runs it at startup before it creates its runtime.
//! `JsFolder` is a workbook folder of the platform, a folder of the root or an object with `readText`, `writeText` and
//! `remove`. The storage of a runtime migrates a workbook folder that it keeps elsewhere (`storage.workbookFolder` of
//! the platform) when it reads a workbook file of an older format.

use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::settings::RuntimeSettings;
use wasm_bindgen::JsCast;
use dashql_core_storage::storage::{FileStamp, FolderStamps};
use dashql_core_storage::workbook_format::data::{STORAGE_VERSION, WORKBOOK_FORMAT_VERSION};
use dashql_core_storage::workbook_format::migration::{migrate_stamped_folder, FolderHost, WorkbookMigrationResult};
use dashql_core_storage::workbook_format::storage_migration::{migrate_storage, DirEntry, StorageRootHost, StorageMigrationSummary};
use js_sys::{Array, Function, Promise, Reflect};
use serde::Serialize;
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use crate::host::{call_method, details_value, field, message_of, JsPlatform};
use crate::runtime::storage::stamp_of;

/// What a migration of the storage changed, with the versions it migrated to
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigrationOutcome {
    /// The storage steps that ran
    pub steps: u32,
    /// The workbook folders that were brought to the current workbook format
    pub workbooks: u32,
    /// The storage version of the app
    pub storage_version: i64,
    /// The workbook format version of the app
    pub format_version: i64,
}

impl From<StorageMigrationSummary> for StorageMigrationOutcome {
    fn from(summary: StorageMigrationSummary) -> Self {
        StorageMigrationOutcome {
            steps: summary.steps,
            workbooks: summary.workbooks,
            storage_version: STORAGE_VERSION,
            format_version: WORKBOOK_FORMAT_VERSION,
        }
    }
}

/// The versions of the storage format of the module: of the storage root and of workbook files
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct StorageVersions {
    /// The storage version of the app, `storageVersion` of the manifest
    pub storage_version: i64,
    /// The workbook format version of the app, `formatVersion` of a workbook file
    pub format_version: i64,
}

impl StorageVersions {
    /// The versions of this module
    pub fn current() -> Self {
        StorageVersions { storage_version: STORAGE_VERSION, format_version: WORKBOOK_FORMAT_VERSION }
    }
}

/// A text of JS
fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

/// A workbook folder of the platform
#[derive(Clone)]
pub(crate) enum JsFolder {
    /// A directory below the storage root, by its path
    Root { root: JsValue, path: String },
    /// An object of the platform with `readText`, `writeText` and `remove`, e.g. a native workbook folder
    Object(JsValue),
}

impl JsFolder {
    /// The object and the path of a file of the folder
    fn target(&self, name: &str) -> (JsValue, String) {
        match self {
            JsFolder::Root { root, path } => (root.clone(), format!("{path}/{name}")),
            JsFolder::Object(folder) => (folder.clone(), name.to_string()),
        }
    }
}

impl FolderHost for JsFolder {
    async fn read_text(&self, name: &str) -> Result<Option<String>, HostError> {
        let (object, path) = self.target(name);
        Ok(call_method(&object, "readText", &[text(&path)]).await?.as_string())
    }

    async fn write_text(&self, name: &str, content: &str) -> Result<Option<FileStamp>, HostError> {
        let (object, path) = self.target(name);
        Ok(stamp_of(&call_method(&object, "writeText", &[text(&path), text(content)]).await?))
    }

    async fn remove(&self, name: &str) -> Result<(), HostError> {
        let (object, path) = self.target(name);
        call_method(&object, "remove", &[text(&path)]).await.map(|_| ())
    }
}

/// A storage root of the platform as the steps of the migration see it, with the log of the platform. It needs no
/// runtime: the clock, the timers and the random ids are the ones of the global scope.
pub(crate) struct JsStorageRoot {
    root: JsValue,
    /// Logs a message: `(level, message, details, target)`
    log: Option<Function>,
}

impl JsStorageRoot {
    async fn call(&self, name: &str, args: &[JsValue]) -> Result<JsValue, HostError> {
        call_method(&self.root, name, args).await
    }
}

/// A member of the global scope, e.g. `crypto`
fn global(name: &str) -> Result<JsValue, HostError> {
    Reflect::get(&js_sys::global(), &JsValue::from_str(name)).map_err(|error| HostError::new(message_of(&error)))
}

impl Host for JsStorageRoot {
    fn now(&self) -> f64 {
        js_sys::Date::now()
    }

    fn sleep(&self, ms: f64) -> impl std::future::Future<Output = ()> + 'static {
        let set_timeout = global("setTimeout").ok().and_then(|f| f.dyn_into::<Function>().ok());
        let promise = Promise::new(&mut |resolve, _| {
            match &set_timeout {
                Some(set_timeout) => {
                    let _ = set_timeout.call2(&JsValue::NULL, &resolve, &JsValue::from_f64(ms));
                }
                None => {
                    let _ = resolve.call0(&JsValue::NULL);
                }
            }
        });
        async move {
            let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
        }
    }

    fn spawn(&self, task: LocalTask) {
        wasm_bindgen_futures::spawn_local(task);
    }

    fn settings(&self) -> RuntimeSettings {
        RuntimeSettings::default()
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        if let Some(log) = &self.log {
            let args: Array = [JsValue::from_str(level.name()), JsValue::from_str(message), details_value(details).into(), JsValue::from_str("storage_migration")]
                .into_iter()
                .collect();
            let _ = log.apply(&JsValue::NULL, &args);
        }
    }
}

impl StorageRootHost for JsStorageRoot {
    type Folder = JsFolder;

    async fn read_text(&self, path: &str) -> Result<Option<String>, HostError> {
        Ok(self.call("readText", &[text(path)]).await?.as_string())
    }

    async fn write_text(&self, path: &str, content: &str) -> Result<(), HostError> {
        self.call("writeText", &[text(path), text(content)]).await.map(|_| ())
    }

    async fn create_directory(&self, path: &str) -> Result<(), HostError> {
        self.call("createDirectory", &[text(path)]).await.map(|_| ())
    }

    async fn remove(&self, path: &str) -> Result<(), HostError> {
        self.call("remove", &[text(path)]).await.map(|_| ())
    }

    async fn list(&self, path: &str) -> Result<Option<Vec<DirEntry>>, HostError> {
        let entries = self.call("list", &[text(path)]).await?;
        if entries.is_null() || entries.is_undefined() {
            return Ok(None);
        }
        if !Array::is_array(&entries) {
            return Err(HostError::new(format!("the entries of {path} are not a list")));
        }
        Ok(Some(
            Array::from(&entries)
                .iter()
                .filter_map(|entry| {
                    let name = field(&entry, "name")?.as_string()?;
                    Some(DirEntry { name, directory: field(&entry, "directory").is_some_and(|d| d.is_truthy()) })
                })
                .collect(),
        ))
    }

    async fn copy_directory(&self, from: &str, to: &str, keep_existing: bool) -> Result<(), HostError> {
        self.call("copyDirectory", &[text(from), text(to), JsValue::from_bool(keep_existing)]).await.map(|_| ())
    }

    fn folder(&self, path: &str) -> JsFolder {
        JsFolder::Root { root: self.root.clone(), path: path.to_string() }
    }

    async fn native_folder(&self, native_path: &str) -> Result<Option<JsFolder>, HostError> {
        let folder = self.call("nativeFolder", &[text(native_path)]).await?;
        Ok(folder.is_object().then_some(JsFolder::Object(folder)))
    }

    fn random_uuid(&self) -> Result<String, HostError> {
        let crypto = global("crypto")?;
        let random_uuid = Reflect::get(&crypto, &JsValue::from_str("randomUUID"))
            .ok()
            .and_then(|f| f.dyn_into::<Function>().ok())
            .ok_or_else(|| HostError::new("the platform gives no random UUIDs"))?;
        random_uuid
            .call0(&crypto)
            .map_err(|error| HostError::new(message_of(&error)))?
            .as_string()
            .ok_or_else(|| HostError::new("the platform returned no UUID"))
    }
}

/// Bring a storage root of the platform to the current storage version and its workbook folders to the current
/// workbook format, logging through a function of the platform
pub(crate) async fn migrate(root: JsValue, log: Option<Function>) -> Result<StorageMigrationOutcome, HostError> {
    if !root.is_object() {
        return Err(HostError::new("the platform has no storage root to migrate"));
    }
    let root = JsStorageRoot { root, log };
    Ok(migrate_storage(&root).await?.into())
}

/// Bring the folder of a workbook of the storage to the current workbook format, if the platform keeps it in a folder of
/// its own, e.g. a native workbook folder that was registered. The workbook file it writes is the app's own (`stamps`).
/// Returns the outcome, none for a workbook of the storage root.
pub(crate) async fn migrate_workbook_folder(
    platform: &JsPlatform,
    stamps: &FolderStamps,
    workbook_id: &str,
) -> Result<Option<WorkbookMigrationResult>, HostError> {
    match platform.workbook_folder(workbook_id) {
        Some(folder) => Ok(Some(migrate_stamped_folder(&JsFolder::Object(folder), workbook_id, stamps).await?)),
        None => Ok(None),
    }
}
