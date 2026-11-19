// The migrations of the storage root and of workbook folders on a fake storage in memory: the files and directories of
// the root, and native folders that the platform claims.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};

use dashql_core_runtime::settings::RuntimeSettings;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_storage::workbook_format::data::{STORAGE_VERSION, WORKBOOK_FORMAT_VERSION};
use dashql_core_storage::storage::{Expect, FileStamp, FolderListing, FolderStamps};
use dashql_core_storage::workbook_format::migration::{migrate_folder, migrate_stamped_folder, FolderHost, WorkbookMigrationResult};
use dashql_core_storage::workbook_format::storage_migration::{
    migrate_storage, plan_connection_migration, run_storage_migration_step, DirEntry, MigratingSession, StorageMigrationSummary,
    StorageRootHost, STORAGE_MIGRATION_STEPS,
};
use serde_json::{json, Value};

const SESSION_A: &str = "11111111-0000-4000-8000-00000000000a";
const SESSION_B: &str = "11111111-0000-4000-8000-00000000000b";
const SESSION_C: &str = "11111111-0000-4000-8000-00000000000c";
const DB_A: &str = "aaaaaaaa-0000-4000-8000-00000000000a";
const DB_B: &str = "aaaaaaaa-0000-4000-8000-00000000000b";
const DB_C: &str = "aaaaaaaa-0000-4000-8000-00000000000c";
const NATIVE_DIR: &str = "/home/user/session";

// The executor: the fake resolves every call right away

struct NoopWaker;

impl Wake for NoopWaker {
    fn wake(self: Arc<Self>) {}
}

fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(NoopWaker));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        if let Poll::Ready(output) = future.as_mut().poll(&mut context) {
            return output;
        }
    }
}

// The storage

#[derive(Default)]
struct Fs {
    /// The files of the root by path
    files: BTreeMap<String, String>,
    /// The directories of the root by path
    dirs: BTreeSet<String>,
    /// The files of native folders by absolute path
    native_files: BTreeMap<String, String>,
    /// The native folders that exist
    native_dirs: BTreeSet<String>,
    /// Does the platform have native folders?
    has_native: bool,
    /// The native folders that were claimed, in order
    claims: Vec<String>,
    logs: Vec<(LogLevel, String)>,
    /// The operations that changed something or tried to, in order
    ops: u32,
    /// The operation that fails, by its number, e.g. to interrupt a migration
    fail_at: Option<u32>,
    /// Does the platform fail to give a UUID?
    no_uuids: bool,
}

impl Fs {
    /// Create a directory of the root and its parents
    fn create_dirs(&mut self, path: &str) {
        let mut current = String::new();
        for part in path.split('/').filter(|part| !part.is_empty()) {
            if !current.is_empty() {
                current.push('/');
            }
            current.push_str(part);
            self.dirs.insert(current.clone());
        }
    }

    fn exists(&self, path: &str) -> bool {
        path.is_empty() || self.dirs.contains(path)
    }

    /// Count an operation that changes the storage, the one to fail fails before it changes anything
    fn change(&mut self) -> Result<(), HostError> {
        let op = self.ops;
        self.ops += 1;
        if self.fail_at == Some(op) {
            return Err(HostError::new(format!("injected failure of operation {op}")));
        }
        Ok(())
    }
}

/// The parent directory of a path, empty for the root
fn parent(path: &str) -> &str {
    path.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("")
}

/// A path below a directory
fn below(dir: &str, path: &str) -> Option<String> {
    if dir.is_empty() {
        return Some(path.to_string());
    }
    path.strip_prefix(dir).and_then(|rest| rest.strip_prefix('/')).map(str::to_string)
}

#[derive(Clone, Default)]
struct FakeRoot {
    fs: Rc<RefCell<Fs>>,
    next_uuid: Rc<Cell<u32>>,
}

#[derive(Clone)]
struct FakeFolder {
    fs: Rc<RefCell<Fs>>,
    native: bool,
    dir: String,
}

impl FolderHost for FakeFolder {
    async fn read_text(&self, name: &str) -> Result<Option<String>, HostError> {
        let fs = self.fs.borrow();
        let path = format!("{}/{name}", self.dir);
        Ok(if self.native { fs.native_files.get(&path).cloned() } else { fs.files.get(&path).cloned() })
    }

    async fn write_text(&self, name: &str, text: &str) -> Result<Option<FileStamp>, HostError> {
        let mut fs = self.fs.borrow_mut();
        fs.change()?;
        let path = format!("{}/{name}", self.dir);
        if self.native {
            fs.native_files.insert(path, text.to_string());
        } else {
            fs.files.insert(path, text.to_string());
        }
        Ok(None)
    }

    async fn remove(&self, name: &str) -> Result<(), HostError> {
        let mut fs = self.fs.borrow_mut();
        fs.change()?;
        let path = format!("{}/{name}", self.dir);
        if self.native {
            fs.native_files.remove(&path);
        } else {
            fs.files.remove(&path);
        }
        Ok(())
    }
}

impl Host for FakeRoot {
    fn now(&self) -> f64 {
        1_767_225_600_000.0
    }

    fn sleep(&self, _ms: f64) -> impl Future<Output = ()> + 'static {
        std::future::ready(())
    }

    fn spawn(&self, _task: LocalTask) {}

    fn log(&self, level: LogLevel, message: &str, _details: &[(&str, &str)]) {
        self.fs.borrow_mut().logs.push((level, message.to_string()));
    }

    fn settings(&self) -> RuntimeSettings {
        RuntimeSettings::default()
    }
}

impl StorageRootHost for FakeRoot {
    type Folder = FakeFolder;

    async fn read_text(&self, path: &str) -> Result<Option<String>, HostError> {
        Ok(self.fs.borrow().files.get(path).cloned())
    }

    async fn write_text(&self, path: &str, text: &str) -> Result<(), HostError> {
        let mut fs = self.fs.borrow_mut();
        fs.change()?;
        fs.create_dirs(parent(path));
        fs.files.insert(path.to_string(), text.to_string());
        Ok(())
    }

    async fn create_directory(&self, path: &str) -> Result<(), HostError> {
        let mut fs = self.fs.borrow_mut();
        fs.change()?;
        fs.create_dirs(path);
        Ok(())
    }

    async fn remove(&self, path: &str) -> Result<(), HostError> {
        let mut fs = self.fs.borrow_mut();
        fs.change()?;
        fs.files.retain(|file, _| file != path && below(path, file).is_none());
        fs.dirs.retain(|dir| dir != path && below(path, dir).is_none());
        Ok(())
    }

    async fn list(&self, path: &str) -> Result<Option<Vec<DirEntry>>, HostError> {
        let fs = self.fs.borrow();
        if !fs.exists(path) {
            return Ok(None);
        }
        let mut entries: Vec<DirEntry> = fs
            .dirs
            .iter()
            .filter(|dir| parent(dir) == path && dir.as_str() != path)
            .map(|dir| DirEntry { name: dir.rsplit('/').next().unwrap_or_default().to_string(), directory: true })
            .collect();
        entries.extend(
            fs.files
                .keys()
                .filter(|file| parent(file) == path)
                .map(|file| DirEntry { name: file.rsplit('/').next().unwrap_or_default().to_string(), directory: false }),
        );
        Ok(Some(entries))
    }

    async fn copy_directory(&self, from: &str, to: &str, keep_existing: bool) -> Result<(), HostError> {
        let mut fs = self.fs.borrow_mut();
        fs.change()?;
        fs.create_dirs(to);
        let dirs: Vec<String> = fs.dirs.iter().filter_map(|dir| below(from, dir)).collect();
        for dir in dirs {
            fs.create_dirs(&format!("{to}/{dir}"));
        }
        let files: Vec<(String, String)> = fs.files.iter().filter_map(|(file, text)| Some((below(from, file)?, text.clone()))).collect();
        for (file, text) in files {
            let target = format!("{to}/{file}");
            if keep_existing && fs.files.contains_key(&target) {
                continue;
            }
            fs.files.insert(target, text);
        }
        Ok(())
    }

    fn folder(&self, path: &str) -> FakeFolder {
        FakeFolder { fs: self.fs.clone(), native: false, dir: path.to_string() }
    }

    async fn native_folder(&self, native_path: &str) -> Result<Option<FakeFolder>, HostError> {
        let mut fs = self.fs.borrow_mut();
        if !fs.has_native {
            return Ok(None);
        }
        fs.claims.push(native_path.to_string());
        Ok(fs.native_dirs.contains(native_path).then(|| FakeFolder { fs: self.fs.clone(), native: true, dir: native_path.to_string() }))
    }

    fn random_uuid(&self) -> Result<String, HostError> {
        if self.fs.borrow().no_uuids {
            return Err(HostError::new("no UUID"));
        }
        self.next_uuid.set(self.next_uuid.get() + 1);
        Ok(format!("00000000-0000-4000-8000-{:012}", self.next_uuid.get()))
    }
}

/// A storage with native folders, like the desktop app
fn storage() -> FakeRoot {
    let root = FakeRoot::default();
    root.fs.borrow_mut().has_native = true;
    root
}

impl FakeRoot {
    fn set(&self, path: &str, text: impl Into<String>) {
        self.fs.borrow_mut().files.insert(path.to_string(), text.into());
    }
    fn dir(&self, path: &str) {
        self.fs.borrow_mut().dirs.insert(path.to_string());
    }
    fn text(&self, path: &str) -> Option<String> {
        self.fs.borrow().files.get(path).cloned()
    }
    fn json(&self, path: &str) -> Value {
        serde_json::from_str(&self.text(path).unwrap_or_else(|| panic!("missing {path}"))).unwrap()
    }
    fn native(&self, path: &str, text: impl Into<String>) {
        let mut fs = self.fs.borrow_mut();
        fs.native_dirs.insert(parent(path).to_string());
        fs.native_files.insert(path.to_string(), text.into());
    }
    fn native_json(&self, path: &str) -> Value {
        serde_json::from_str(&self.fs.borrow().native_files[path]).unwrap()
    }
    fn files_starting_with(&self, prefix: &str) -> Vec<String> {
        self.fs.borrow().files.keys().filter(|file| file.starts_with(prefix)).cloned().collect()
    }
    fn dirs_starting_with(&self, prefix: &str) -> Vec<String> {
        self.fs.borrow().dirs.iter().filter(|dir| dir.starts_with(prefix)).cloned().collect()
    }
    fn migrate(&self) -> Result<StorageMigrationSummary, HostError> {
        block_on(migrate_storage(self))
    }
}

fn wasm() -> Value {
    json!({ "hyper": { "protocol": "WASM" } })
}

/// The metadata of a notebook of format version 2
fn notebook(notebook_id: &str, database_id: &str) -> String {
    json!({
        "formatVersion": 2,
        "notebookId": notebook_id,
        "mainDatabase": { "databaseId": database_id, "params": wasm() },
        "attachedDatabases": [],
        "metadata": {},
    })
    .to_string()
}

fn summary(steps: u32, workbooks: u32) -> StorageMigrationSummary {
    StorageMigrationSummary { steps, workbooks }
}

// The storage migration

#[test]
fn ends_with_the_current_storage_version() {
    let versions: Vec<i64> = STORAGE_MIGRATION_STEPS.iter().map(|step| step.version).collect();
    assert_eq!(versions, (2..=STORAGE_VERSION).collect::<Vec<_>>());
}

#[test]
fn stamps_a_fresh_storage_with_the_current_version() {
    let root = storage();
    assert_eq!(root.migrate().unwrap(), summary(0, 0));
    assert_eq!(root.json("dashql-manifest.json"), json!({ "storageVersion": STORAGE_VERSION }));
    assert!(root.fs.borrow().dirs.is_empty());
    // The next start finds a current storage
    assert_eq!(root.migrate().unwrap(), summary(0, 0));
    assert_eq!(root.fs.borrow().files.len(), 1);
}

#[test]
fn brings_a_notebook_storage_to_the_current_version() {
    let root = storage();
    root.set(
        "dashql-manifest.json",
        json!({
            "notebooks": [{ "path": SESSION_A }, { "path": SESSION_B, "storageType": "native", "nativePath": NATIVE_DIR }],
            "appSettings": { "keywordCase": "upper" },
        })
        .to_string(),
    );
    root.dir("notebooks");
    root.dir(&format!("notebooks/{SESSION_A}"));
    root.dir(&format!("notebooks/{SESSION_A}/scripts"));
    root.set(&format!("notebooks/{SESSION_A}/dashql-notebook.json"), notebook(SESSION_A, DB_A));
    root.set(&format!("notebooks/{SESSION_A}/dashql-relations.sql"), "CREATE TABLE a(id int);");
    root.set(&format!("notebooks/{SESSION_A}/scripts/1_a.sql"), "SELECT 1");
    root.native(&format!("{NATIVE_DIR}/dashql-notebook.json"), notebook(SESSION_B, DB_B));

    let migrated = root.migrate().unwrap();
    assert_eq!(migrated.steps as usize, STORAGE_MIGRATION_STEPS.len());
    assert!(migrated.workbooks > 0);
    // The native session folder is claimed before it is read
    let claims: BTreeSet<String> = root.fs.borrow().claims.iter().cloned().collect();
    assert_eq!(claims, BTreeSet::from([NATIVE_DIR.to_string()]));

    // The session tree lists the sessions and the manifest the consolidated connections
    assert_eq!(
        root.json("workbooktree/My Sessions/dashql-folder.json")["workbooks"],
        json!([{ "path": SESSION_A }, { "path": SESSION_B, "storageType": "native", "nativePath": NATIVE_DIR }])
    );
    assert_eq!(root.json("workbooktree/dashql-folder.json")["workbooks"], json!([]));
    let manifest = root.json("dashql-manifest.json");
    assert!(manifest.get("sessions").is_none());
    assert!(manifest.get("notebooks").is_none());
    assert_eq!(manifest["appSettings"], json!({ "keywordCase": "upper" }));
    assert_eq!(manifest["storageVersion"], json!(STORAGE_VERSION));
    let ids: Vec<&str> = manifest["connections"].as_array().unwrap().iter().map(|entry| entry["id"].as_str().unwrap()).collect();
    assert_eq!(ids, [DB_A]);
    assert_eq!(manifest["connections"][0]["createdAt"], json!("2026-01-01T00:00:00.000Z"));
    assert_eq!(root.text(&format!("connections/{DB_A}/dashql-catalog-relations.sql")).as_deref(), Some("CREATE TABLE a(id int);"));

    // The OPFS session moved and is at the current format
    assert!(root.dirs_starting_with("notebooks").is_empty());
    assert!(root.files_starting_with("notebooks").is_empty());
    let session_a = root.json(&format!("workbooks/{SESSION_A}/dashql-workbook.json"));
    assert_eq!(session_a["formatVersion"], json!(WORKBOOK_FORMAT_VERSION));
    assert_eq!(session_a["workbookId"], json!(SESSION_A));
    assert_eq!(root.text(&format!("workbooks/{SESSION_A}/dashql-catalog-relations.sql")), None);
    assert_eq!(root.text(&format!("workbooks/{SESSION_A}/scripts/1_a.sql")).as_deref(), Some("SELECT 1"));
    assert!(root.dirs_starting_with("sessions").is_empty());

    // The native session references the consolidated connection
    assert!(!root.fs.borrow().native_files.contains_key(&format!("{NATIVE_DIR}/dashql-notebook.json")));
    let session_b = root.native_json(&format!("{NATIVE_DIR}/dashql-workbook.json"));
    assert_eq!(session_b["formatVersion"], json!(WORKBOOK_FORMAT_VERSION));
    assert_eq!(session_b["workbookId"], json!(SESSION_B));
    let connections: Vec<&str> = session_b["connections"].as_array().unwrap().iter().map(|c| c["connectionId"].as_str().unwrap()).collect();
    assert_eq!(connections, [DB_A]);

    // A migrated storage stays as it is
    let before = root.text("dashql-manifest.json");
    let before_tree = root.text("workbooktree/My Sessions/dashql-folder.json");
    root.migrate().unwrap();
    assert_eq!(root.text("dashql-manifest.json"), before);
    assert_eq!(root.text("workbooktree/My Sessions/dashql-folder.json"), before_tree);
}

#[test]
fn keeps_the_connections_of_a_storage_that_has_them_already() {
    let root = storage();
    let connections = json!([{ "id": DB_B, "params": wasm(), "createdAt": "2026-10-22T00:00:00.000Z" }]);
    root.set("dashql-manifest.json", json!({ "notebooks": [{ "path": SESSION_A }], "connections": connections }).to_string());
    root.dir("notebooks");
    root.dir(&format!("notebooks/{SESSION_A}"));
    root.set(&format!("notebooks/{SESSION_A}/dashql-notebook.json"), notebook(SESSION_A, DB_B));

    root.migrate().unwrap();
    assert_eq!(root.json("dashql-manifest.json")["connections"], connections);
    assert_eq!(root.json(&format!("workbooks/{SESSION_A}/dashql-workbook.json"))["workbookId"], json!(SESSION_A));
}

#[test]
fn migrates_the_workbooks_of_a_current_storage() {
    let root = storage();
    root.set("dashql-manifest.json", json!({ "connections": [], "storageVersion": STORAGE_VERSION }).to_string());
    root.dir("workbooktree");
    root.dir("workbooktree/clients");
    root.set("workbooktree/clients/dashql-folder.json", json!({ "workbooks": [{ "path": SESSION_A }] }).to_string());
    root.dir("workbooks");
    root.dir(&format!("workbooks/{SESSION_A}"));
    root.set(&format!("workbooks/{SESSION_A}/dashql-notebook.json"), notebook(SESSION_A, DB_A));

    assert_eq!(root.migrate().unwrap(), summary(0, 1));
    assert_eq!(root.json(&format!("workbooks/{SESSION_A}/dashql-workbook.json"))["formatVersion"], json!(WORKBOOK_FORMAT_VERSION));
    // A current storage has nothing left to migrate
    assert_eq!(root.migrate().unwrap(), summary(0, 0));
}

#[test]
fn moves_the_sessions_of_the_manifest_into_the_folder_my_sessions_of_the_session_tree() {
    let root = storage();
    root.set(
        "dashql-manifest.json",
        json!({
            "sessions": [{ "path": SESSION_A, "storageType": "opfs" }, { "path": SESSION_B, "storageType": "native", "nativePath": NATIVE_DIR }],
            "connections": [],
            "appSettings": { "keywordCase": "upper" },
            "storageVersion": 6,
        })
        .to_string(),
    );
    // An interrupted run registered a session in a folder already
    root.dir("sessiontree");
    root.dir("sessiontree/clients");
    root.set(
        "sessiontree/clients/dashql-folder.json",
        json!({ "sessions": [{ "path": SESSION_B, "storageType": "native", "nativePath": NATIVE_DIR }] }).to_string(),
    );

    assert_eq!(i64::from(root.migrate().unwrap().steps), STORAGE_VERSION - 6);
    assert_eq!(root.json("workbooktree/My Sessions/dashql-folder.json"), json!({ "workbooks": [{ "path": SESSION_A, "storageType": "opfs" }] }));
    assert_eq!(
        root.json("workbooktree/clients/dashql-folder.json")["workbooks"],
        json!([{ "path": SESSION_B, "storageType": "native", "nativePath": NATIVE_DIR }])
    );
    assert_eq!(root.json("workbooktree/dashql-folder.json"), json!({ "workbooks": [] }));
    assert_eq!(
        root.json("dashql-manifest.json"),
        json!({ "connections": [], "appSettings": { "keywordCase": "upper" }, "storageVersion": STORAGE_VERSION })
    );

    // The step is idempotent
    block_on(run_storage_migration_step(&root, 9)).unwrap();
    assert_eq!(root.json("workbooktree/My Sessions/dashql-folder.json"), json!({ "workbooks": [{ "path": SESSION_A, "storageType": "opfs" }] }));
}

#[test]
fn seeds_connections_without_a_catalog_from_the_catalog_copies_of_the_sessions() {
    // A session of format version 6 on a connection
    let session = |session_id: &str, connection_id: &str| {
        json!({
            "formatVersion": 6, "sessionId": session_id, "defaultConnectionId": connection_id,
            "connections": [{ "connectionId": connection_id, "params": wasm() }], "scripts": [], "attachments": [], "metadata": {},
        })
        .to_string()
    };
    let root = storage();
    root.set(
        "dashql-manifest.json",
        json!({
            "sessions": [{ "path": SESSION_A }, { "path": SESSION_B, "storageType": "native", "nativePath": NATIVE_DIR }],
            "connections": [{ "id": DB_A, "params": wasm() }, { "id": DB_B, "params": wasm() }],
            "storageVersion": 3,
        })
        .to_string(),
    );
    // The connection of the OPFS session has no catalog
    root.dir("sessions");
    root.dir(&format!("sessions/{SESSION_A}"));
    root.set(&format!("sessions/{SESSION_A}/dashql-session.json"), session(SESSION_A, DB_A));
    root.set(&format!("sessions/{SESSION_A}/dashql-catalog-relations.sql"), "CREATE TABLE a(id int);");
    root.set(&format!("sessions/{SESSION_A}/dashql-catalog-changes.sql"), "DROP TABLE a;");
    // The connection of the native session has a catalog already
    root.dir("connections");
    root.dir(&format!("connections/{DB_B}"));
    root.set(&format!("connections/{DB_B}/dashql-catalog-functions.sql"), "CREATE FUNCTION kept() RETURNS int;");
    root.native(&format!("{NATIVE_DIR}/dashql-session.json"), session(SESSION_B, DB_B));
    root.native(&format!("{NATIVE_DIR}/dashql-catalog-relations.sql"), "CREATE TABLE b(id int);");

    root.migrate().unwrap();

    assert_eq!(root.json("dashql-manifest.json")["storageVersion"], json!(STORAGE_VERSION));
    assert_eq!(root.text(&format!("connections/{DB_A}/dashql-catalog-relations.sql")).as_deref(), Some("CREATE TABLE a(id int);"));
    assert_eq!(root.text(&format!("connections/{DB_A}/dashql-catalog-changes.sql")).as_deref(), Some("DROP TABLE a;"));
    assert_eq!(root.text(&format!("connections/{DB_B}/dashql-catalog-relations.sql")), None);
    assert_eq!(
        root.text(&format!("connections/{DB_B}/dashql-catalog-functions.sql")).as_deref(),
        Some("CREATE FUNCTION kept() RETURNS int;")
    );
    // The copies are removed from every session
    assert_eq!(root.files_starting_with("workbooks/"), [format!("workbooks/{SESSION_A}/dashql-workbook.json")]);
    let native: Vec<String> = root.fs.borrow().native_files.keys().filter(|file| file.starts_with(NATIVE_DIR)).cloned().collect();
    assert_eq!(native, [format!("{NATIVE_DIR}/dashql-workbook.json")]);
    assert_eq!(root.json(&format!("workbooks/{SESSION_A}/dashql-workbook.json"))["formatVersion"], json!(WORKBOOK_FORMAT_VERSION));
}

#[test]
fn drops_the_aliases_of_the_connections() {
    let created_at = "2026-10-22T00:00:00.000Z";
    let root = storage();
    root.set(
        "dashql-manifest.json",
        json!({
            "sessions": [],
            "connections": [{ "id": DB_A, "params": wasm(), "aliases": [DB_B], "createdAt": created_at }, { "id": DB_B, "params": wasm() }],
            "storageVersion": 5,
        })
        .to_string(),
    );

    root.migrate().unwrap();

    let manifest = root.json("dashql-manifest.json");
    assert_eq!(manifest["storageVersion"], json!(STORAGE_VERSION));
    assert_eq!(manifest["connections"], json!([{ "id": DB_A, "params": wasm(), "createdAt": created_at }, { "id": DB_B, "params": wasm() }]));
    // The fields keep their order
    assert_eq!(serde_json::to_string(&manifest["connections"][0]).unwrap(), format!(r#"{{"id":"{DB_A}","params":{{"hyper":{{"protocol":"WASM"}}}},"createdAt":"{created_at}"}}"#));
}

#[test]
fn moves_the_params_of_sidb_connections_to_the_key_dbcom() {
    let params = json!({ "instanceUrl": "https://example.my.salesforce.com", "databaseName": "sales" });
    let root = storage();
    root.set(
        "dashql-manifest.json",
        json!({
            "connections": [{ "id": DB_A, "params": { "sidb": params }, "paramsDraft": { "sidb": params } }, { "id": DB_B, "params": wasm() }],
            "storageVersion": 7,
        })
        .to_string(),
    );

    root.migrate().unwrap();

    let manifest = root.json("dashql-manifest.json");
    assert_eq!(manifest["storageVersion"], json!(STORAGE_VERSION));
    assert_eq!(
        manifest["connections"],
        json!([{ "id": DB_A, "params": { "dbcom": params }, "paramsDraft": { "dbcom": params } }, { "id": DB_B, "params": wasm() }])
    );
}

#[test]
fn moves_the_files_of_the_shell_to_the_shell_folder() {
    let root = storage();
    root.set("dashql-manifest.json", json!({ "sessions": [], "connections": [], "storageVersion": 4 }).to_string());
    root.dir("dashql-shell");
    root.dir("dashql-shell/nested");
    root.set("dashql-shell/salesforce-login-history.json", r#"{"version":1,"entries":[]}"#);
    root.set("dashql-shell/nested/notes.txt", "nested");
    // A file that the shell folder has already is kept
    root.dir("shell");
    root.set("shell/kept.txt", "kept");
    root.set("dashql-shell/kept.txt", "replaced");

    root.migrate().unwrap();

    assert_eq!(root.json("dashql-manifest.json")["storageVersion"], json!(STORAGE_VERSION));
    assert_eq!(root.text("shell/salesforce-login-history.json").as_deref(), Some(r#"{"version":1,"entries":[]}"#));
    assert_eq!(root.text("shell/nested/notes.txt").as_deref(), Some("nested"));
    assert_eq!(root.text("shell/kept.txt").as_deref(), Some("kept"));
    assert!(root.files_starting_with("dashql-shell").is_empty());
    assert!(root.dirs_starting_with("dashql-shell").is_empty());
}

#[test]
fn refuses_a_storage_of_a_newer_version() {
    let root = storage();
    let manifest = json!({ "sessions": [], "storageVersion": STORAGE_VERSION + 1 }).to_string();
    root.set("dashql-manifest.json", manifest.clone());
    let error = root.migrate().unwrap_err();
    assert!(error.message().contains("newer version of DashQL"), "{}", error.message());
    assert_eq!(root.text("dashql-manifest.json"), Some(manifest));
}

#[test]
fn refuses_an_invalid_storage_version() {
    let root = storage();
    root.set("dashql-manifest.json", json!({ "storageVersion": "3" }).to_string());
    assert_eq!(root.migrate().unwrap_err().message(), r#"Invalid storage version: "3""#);
    root.set("dashql-manifest.json", "[]");
    assert_eq!(root.migrate().unwrap_err().message(), "Invalid dashql-manifest.json: not a JSON object");
}

#[test]
fn renames_the_sessions_as_workbooks() {
    let root = storage();
    root.set(
        "dashql-manifest.json",
        json!({ "connections": [], "appSettings": { "agentSessions": [SESSION_A], "keywordCase": "upper" }, "storageVersion": 8 }).to_string(),
    );
    root.dir("sessiontree");
    root.dir("sessiontree/clients");
    root.set("sessiontree/dashql-folder.json", json!({ "sessions": [] }).to_string());
    root.set("sessiontree/clients/dashql-folder.json", json!({ "sessions": [{ "path": SESSION_A }] }).to_string());
    root.dir("sessions");
    root.dir(&format!("sessions/{SESSION_A}"));
    root.dir(&format!("sessions/{SESSION_A}/scripts"));
    root.set(
        &format!("sessions/{SESSION_A}/dashql-session.json"),
        json!({
            "formatVersion": 10, "sessionId": SESSION_A, "connections": [{ "connectionId": DB_A, "params": wasm() }],
            "scripts": [], "attachments": [], "metadata": {},
        })
        .to_string(),
    );
    root.set(&format!("sessions/{SESSION_A}/scripts/1_a.sql"), "SELECT 1");

    assert_eq!(root.migrate().unwrap(), summary(1, 1));

    assert!(root.dirs_starting_with("sessions").is_empty());
    assert!(root.dirs_starting_with("sessiontree").is_empty());
    assert_eq!(root.json("workbooktree/dashql-folder.json"), json!({ "workbooks": [] }));
    assert_eq!(root.json("workbooktree/clients/dashql-folder.json"), json!({ "workbooks": [{ "path": SESSION_A }] }));
    let workbook = root.json(&format!("workbooks/{SESSION_A}/dashql-workbook.json"));
    assert_eq!(workbook["formatVersion"], json!(WORKBOOK_FORMAT_VERSION));
    assert_eq!(workbook["workbookId"], json!(SESSION_A));
    assert_eq!(root.text(&format!("workbooks/{SESSION_A}/dashql-session.json")), None);
    assert_eq!(root.text(&format!("workbooks/{SESSION_A}/scripts/1_a.sql")).as_deref(), Some("SELECT 1"));
    let settings = &root.json("dashql-manifest.json")["appSettings"];
    assert_eq!(serde_json::to_string(settings).unwrap(), format!(r#"{{"keywordCase":"upper","agentWorkbooks":["{SESSION_A}"]}}"#));
}

#[test]
fn skips_native_folders_without_a_platform_that_has_them() {
    let root = FakeRoot::default();
    root.set("dashql-manifest.json", json!({ "connections": [], "storageVersion": STORAGE_VERSION }).to_string());
    root.set(
        "workbooktree/dashql-folder.json",
        json!({ "workbooks": [{ "path": SESSION_A, "storageType": "native", "nativePath": NATIVE_DIR }] }).to_string(),
    );
    root.dir("workbooktree");
    root.native(&format!("{NATIVE_DIR}/dashql-notebook.json"), notebook(SESSION_A, DB_A));
    assert_eq!(root.migrate().unwrap(), summary(0, 0));
    assert!(root.fs.borrow().claims.is_empty());
}

// Interrupted migrations

/// The metadata of a notebook of format version 2 on a database with params
fn notebook_on(notebook_id: &str, database_id: &str, params: Value) -> String {
    json!({
        "formatVersion": 2,
        "notebookId": notebook_id,
        "mainDatabase": { "databaseId": database_id, "params": params },
        "attachedDatabases": [],
        "metadata": {},
    })
    .to_string()
}

/// A storage of the first version with something for every step: notebooks in the root and in a native folder, a
/// database whose id an earlier database took (it gets a fresh id), catalog copies, the files of the shell and the
/// sessions that agents may access
fn old_storage() -> FakeRoot {
    let root = storage();
    root.set(
        "dashql-manifest.json",
        json!({
            "notebooks": [{ "path": SESSION_A }, { "path": SESSION_B, "storageType": "native", "nativePath": NATIVE_DIR }, { "path": SESSION_C }],
            "appSettings": { "agentSessions": [SESSION_A] },
        })
        .to_string(),
    );
    root.dir("notebooks");
    for (session_id, database_id, params, relations) in
        [(SESSION_A, DB_A, wasm(), "CREATE TABLE a(id int);"), (SESSION_C, DB_A, trino("https://trino", ""), "CREATE TABLE c(id int);")]
    {
        root.dir(&format!("notebooks/{session_id}"));
        root.dir(&format!("notebooks/{session_id}/scripts"));
        root.set(&format!("notebooks/{session_id}/dashql-notebook.json"), notebook_on(session_id, database_id, params));
        root.set(&format!("notebooks/{session_id}/dashql-relations.sql"), relations);
        root.set(&format!("notebooks/{session_id}/scripts/1_a.sql"), "SELECT 1");
    }
    root.native(&format!("{NATIVE_DIR}/dashql-notebook.json"), notebook(SESSION_B, DB_B));
    root.dir("dashql-shell");
    root.set("dashql-shell/salesforce-login-history.json", "[]");
    root
}

type Snapshot = (BTreeMap<String, String>, BTreeSet<String>, BTreeMap<String, String>);

/// The files and directories of the root and the files of the native folders
fn snapshot(root: &FakeRoot) -> Snapshot {
    let fs = root.fs.borrow();
    (fs.files.clone(), fs.dirs.clone(), fs.native_files.clone())
}

/// What differs between two snapshots, for the message of a failed test
fn diff(actual: &Snapshot, expected: &Snapshot) -> Vec<String> {
    let mut out = Vec::new();
    for (path, text) in actual.0.iter().chain(actual.2.iter()) {
        if expected.0.get(path).or(expected.2.get(path)) != Some(text) {
            out.push(format!("+ {path}: {text}"));
        }
    }
    for (path, text) in expected.0.iter().chain(expected.2.iter()) {
        if actual.0.get(path).or(actual.2.get(path)) != Some(text) {
            out.push(format!("- {path}: {text}"));
        }
    }
    out.extend(actual.1.symmetric_difference(&expected.1).map(|dir| format!("~ dir {dir}")));
    out
}

/// The ids of the connections of the manifest
fn manifest_connection_ids(root: &FakeRoot) -> Vec<String> {
    let manifest = root.json("dashql-manifest.json");
    manifest["connections"].as_array().map(|entries| entries.iter().filter_map(|e| e["id"].as_str().map(str::to_string)).collect()).unwrap_or_default()
}

/// The folders of connections that the manifest doesn't list
fn orphans(root: &FakeRoot) -> Vec<String> {
    let ids = manifest_connection_ids(root);
    root.dirs_starting_with("connections/")
        .into_iter()
        .filter_map(|dir| dir.strip_prefix("connections/").map(str::to_string))
        .filter(|id| !id.contains('/') && !ids.contains(id))
        .collect()
}

/// The storage version of the manifest, 1 without one
fn storage_version(root: &FakeRoot) -> i64 {
    root.json("dashql-manifest.json")["storageVersion"].as_i64().unwrap_or(1)
}

const FRESH_ID: &str = "00000000-0000-4000-8000-000000000001";

#[test]
fn repeats_a_migration_that_failed_at_any_operation_to_the_same_storage() {
    let reference = old_storage();
    assert_eq!(reference.migrate().unwrap().steps as usize, STORAGE_MIGRATION_STEPS.len());
    let expected = snapshot(&reference);
    assert_eq!(manifest_connection_ids(&reference), [DB_A, FRESH_ID]);
    assert!(orphans(&reference).is_empty());
    assert_eq!(reference.text(&format!("connections/{FRESH_ID}/dashql-catalog-relations.sql")).as_deref(), Some("CREATE TABLE c(id int);"));
    let total = reference.fs.borrow().ops;

    let mut interrupted_at_versions = BTreeSet::new();
    for op in 0..total {
        let root = old_storage();
        root.fs.borrow_mut().fail_at = Some(op);
        let first = root.migrate();
        let failed_at_version = storage_version(&root);
        // The next start of the app runs the migration again, its fresh ids count from the start
        root.fs.borrow_mut().fail_at = None;
        root.next_uuid.set(0);
        root.migrate().unwrap_or_else(|error| panic!("operation {op}: {}", error.message()));
        assert_eq!(storage_version(&root), STORAGE_VERSION, "operation {op}");
        assert!(orphans(&root).is_empty(), "operation {op}: {:?}", orphans(&root));
        // A failure that stopped the migration leaves nothing behind. A failure that a step passed over loses a cache
        // or a best effort, e.g. a catalog copy.
        if first.is_err() {
            interrupted_at_versions.insert(failed_at_version);
            let actual = snapshot(&root);
            assert!(actual == expected, "operation {op}: {:#?}", diff(&actual, &expected));
        }
    }
    // Every step was interrupted
    assert_eq!(interrupted_at_versions, (1..STORAGE_VERSION).collect::<BTreeSet<_>>());
}

#[test]
fn removes_the_catalogs_that_an_interrupted_step_copied_under_fresh_ids() {
    // Fail the operations one by one until the step of the global connections stops after it copied the catalog of
    // the fresh id and before the manifest lists the connections
    let fresh = format!("connections/{FRESH_ID}/dashql-catalog-relations.sql");
    let root = (0..200)
        .map(|op| {
            let root = old_storage();
            root.fs.borrow_mut().fail_at = Some(op);
            let failed = root.migrate().is_err();
            (root, failed)
        })
        .find(|(root, failed)| *failed && root.text(&fresh).is_some() && root.json("dashql-manifest.json").get("connections").is_none())
        .map(|(root, _)| root)
        .expect("an interruption after the catalog copy");
    assert_eq!(storage_version(&root), 2);

    // The next run plans another fresh id, the catalog of the first one goes
    root.fs.borrow_mut().fail_at = None;
    root.migrate().unwrap();
    let second = "00000000-0000-4000-8000-000000000002";
    assert_eq!(manifest_connection_ids(&root), [DB_A, second]);
    assert_eq!(root.text(&fresh), None);
    assert!(root.dirs_starting_with(&format!("connections/{FRESH_ID}")).is_empty());
    assert_eq!(root.text(&format!("connections/{second}/dashql-catalog-relations.sql")).as_deref(), Some("CREATE TABLE c(id int);"));
    assert!(orphans(&root).is_empty());
}

#[test]
fn fails_the_step_without_a_uuid_and_repeats_it_later() {
    let root = old_storage();
    root.fs.borrow_mut().no_uuids = true;
    assert!(root.migrate().unwrap_err().message().contains("no UUID"));
    // The step before is done, the step of the global connections wrote nothing
    assert_eq!(storage_version(&root), 2);
    assert!(root.json("dashql-manifest.json").get("connections").is_none());
    assert!(root.dirs_starting_with("connections").is_empty());
    root.fs.borrow_mut().no_uuids = false;
    root.migrate().unwrap();
    assert_eq!(manifest_connection_ids(&root), [DB_A, FRESH_ID]);
}

// The plan of the global connections

/// Session metadata of format version 4, the format the step reads
fn v4_session(session_id: &str, main: Value, attached: Value) -> MigratingSession {
    let data = json!({
        "formatVersion": 4, "name": "V2 Session", "attachedDatabases": attached, "metadata": {},
        "sessionId": session_id, "mainDatabase": main,
    });
    MigratingSession { session_id: session_id.to_string(), data: data.as_object().unwrap().clone() }
}

fn trino(endpoint: &str, secret: &str) -> Value {
    json!({ "trino": { "endpoint": endpoint, "auth": { "authType": "AUTH_BASIC", "basic": { "username": "user", "secret": secret } } } })
}

fn session(session_id: &str, database_id: &str, params: Value, draft: Option<Value>) -> MigratingSession {
    let mut main = json!({ "databaseId": database_id, "params": params });
    if let Some(draft) = draft {
        main["paramsDraft"] = draft;
    }
    v4_session(session_id, main, json!([]))
}

fn plan(sessions: &[MigratingSession]) -> dashql_core_storage::workbook_format::storage_migration::ConnectionMigrationPlan {
    plan_connection_migration(sessions, "2026-10-22T00:00:00.000Z", &mut || "00000000-0000-4000-8000-000000000000".to_string())
}

fn entry_ids(entries: &[Value]) -> Vec<&str> {
    entries.iter().map(|entry| entry["id"].as_str().unwrap()).collect()
}

#[test]
fn consolidates_databases_with_equal_params_under_the_first_id() {
    let plan = plan(&[
        session(SESSION_A, DB_A, wasm(), None),
        session(SESSION_B, DB_B, wasm(), None),
        session(SESSION_C, DB_C, trino("https://trino", ""), None),
    ]);
    assert_eq!(entry_ids(&plan.entries), [DB_A, DB_C]);
    // Only the session that referenced the other id changes
    let rewritten: Vec<&str> = plan.rewrites.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(rewritten, [SESSION_B]);
    assert_eq!(plan.rewrites[0].1["mainDatabase"], json!({ "databaseId": DB_A, "params": wasm() }));
    assert_eq!(
        plan.catalog_sources,
        [(DB_A.to_string(), SESSION_A.to_string()), (DB_C.to_string(), SESSION_C.to_string())]
    );
}

#[test]
fn keeps_databases_that_differ_in_a_secret_separate() {
    let plan = plan(&[session(SESSION_A, DB_A, trino("https://trino", "one"), None), session(SESSION_B, DB_B, trino("https://trino", "two"), None)]);
    assert_eq!(entry_ids(&plan.entries), [DB_A, DB_B]);
    assert!(plan.rewrites.is_empty());
}

#[test]
fn consolidates_params_that_differ_in_the_draft_rows_of_a_form() {
    let mut with_rows = trino("https://trino", "");
    with_rows["trino"]["draftRows"] = json!([{ "key": "a" }]);
    let plan = plan(&[session(SESSION_A, DB_A, with_rows, None), session(SESSION_B, DB_B, trino("https://trino", ""), None)]);
    assert_eq!(entry_ids(&plan.entries), [DB_A]);
    assert_eq!(plan.entries[0]["params"], trino("https://trino", ""));
}

#[test]
fn moves_drafts_into_the_app_manifest_and_keeps_conflicting_drafts_in_connections_of_their_own() {
    let draft_one = trino("https://draft-one", "");
    let draft_two = trino("https://draft-two", "");
    let plan = plan(&[
        session(SESSION_A, DB_A, trino("https://trino", ""), None),
        session(SESSION_B, DB_B, trino("https://trino", ""), Some(draft_one.clone())),
        session(SESSION_C, DB_C, trino("https://trino", ""), Some(draft_two.clone())),
    ]);
    let drafts: Vec<(&str, &Value)> = plan.entries.iter().map(|entry| (entry["id"].as_str().unwrap(), &entry["paramsDraft"])).collect();
    assert_eq!(drafts, [(DB_A, &draft_one), (DB_C, &draft_two)]);
    // Every session drops its draft
    for (_, rewrite) in &plan.rewrites {
        assert!(rewrite["mainDatabase"].get("paramsDraft").is_none());
    }
    let rewrite = |session_id: &str| plan.rewrites.iter().find(|(id, _)| id == session_id).map(|(_, data)| data["mainDatabase"]["databaseId"].clone());
    assert_eq!(rewrite(SESSION_B), Some(json!(DB_A)));
    assert_eq!(rewrite(SESSION_C), Some(json!(DB_C)));
}

#[test]
fn dedupes_references_that_consolidate_within_a_session() {
    let plan = plan(&[v4_session(
        SESSION_A,
        json!({ "databaseId": DB_A, "params": wasm() }),
        json!([{ "databaseId": DB_B, "params": wasm() }, { "databaseId": DB_C, "params": trino("https://trino", "") }]),
    )]);
    assert_eq!(plan.rewrites[0].1["attachedDatabases"], json!([{ "databaseId": DB_C, "params": trino("https://trino", "") }]));
}

#[test]
fn gives_a_new_id_to_a_draft_whose_id_is_taken() {
    let draft = trino("https://draft", "");
    // Both drafts conflict and the second database reuses the id of the first
    let plan = plan(&[
        session(SESSION_A, DB_A, wasm(), Some(trino("https://draft-a", ""))),
        session(SESSION_B, DB_A, wasm(), Some(draft)),
    ]);
    assert_eq!(entry_ids(&plan.entries), [DB_A, "00000000-0000-4000-8000-000000000000"]);
}

// The migration of a workbook folder

/// A folder in memory, the files in the order they were created
#[derive(Clone, Default)]
struct MemoryFolder {
    files: Rc<RefCell<Vec<(String, String)>>>,
}

impl MemoryFolder {
    fn with(files: &[(&str, String)]) -> Self {
        let folder = MemoryFolder::default();
        folder.files.borrow_mut().extend(files.iter().map(|(name, text)| (name.to_string(), text.clone())));
        folder
    }
    fn names(&self) -> Vec<String> {
        self.files.borrow().iter().map(|(name, _)| name.clone()).collect()
    }
    fn json(&self, name: &str) -> Value {
        let files = self.files.borrow();
        serde_json::from_str(&files.iter().find(|(n, _)| n == name).unwrap().1).unwrap()
    }
}

impl FolderHost for MemoryFolder {
    async fn read_text(&self, name: &str) -> Result<Option<String>, HostError> {
        Ok(self.files.borrow().iter().find(|(n, _)| n == name).map(|(_, text)| text.clone()))
    }

    async fn write_text(&self, name: &str, text: &str) -> Result<Option<FileStamp>, HostError> {
        let mut files = self.files.borrow_mut();
        match files.iter_mut().find(|(n, _)| n == name) {
            Some(file) => file.1 = text.to_string(),
            None => files.push((name.to_string(), text.to_string())),
        }
        Ok(Some(FileStamp { size: text.len() as f64, mtime_ms: 2.0 }))
    }

    async fn remove(&self, name: &str) -> Result<(), HostError> {
        self.files.borrow_mut().retain(|(n, _)| n != name);
        Ok(())
    }
}

#[test]
fn records_the_stamp_of_the_workbook_file_that_a_migration_of_an_acknowledged_folder_writes() {
    let old = json!({ "formatVersion": 10, "sessionId": SESSION_A, "sessionPath": "opfs://sessions/x", "name": "n" }).to_string();
    let folder = MemoryFolder::with(&[("dashql-session.json", old)]);
    let stamps = FolderStamps::default();
    let before = FileStamp { size: 1.0, mtime_ms: 1.0 };
    stamps.acknowledge(SESSION_A, &FolderListing { workbook: Some(before), ..FolderListing::default() });
    assert_eq!(block_on(migrate_stamped_folder(&folder, SESSION_A, &stamps)).unwrap(), WorkbookMigrationResult::Migrated);
    // The migration wrote the workbook file, the app's own write is no change outside the app
    let written = folder.files.borrow().iter().find(|(name, _)| name == "dashql-workbook.json").map(|(_, text)| text.len() as f64);
    let stamp = FileStamp { size: written.unwrap(), mtime_ms: 2.0 };
    assert_eq!(stamps.expect_workbook(SESSION_A), Expect::Stamp(stamp));
    let listing = FolderListing { workbook: Some(stamp), ..FolderListing::default() };
    assert!(stamps.changes(SESSION_A, &listing, "dashql-workbook.json").is_empty());
}

#[test]
fn brings_a_notebook_folder_to_the_current_format_the_writes_first_and_then_the_removals() {
    let folder = MemoryFolder::with(&[
        ("dashql-notebook.json", json!({ "formatVersion": 2, "notebookId": SESSION_A, "notebookPath": "opfs://notebooks/x", "name": "n" }).to_string()),
        ("dashql-notebook-index.json", r#"{"scripts":[]}"#.to_string()),
        ("dashql-relations.sql", "relations".to_string()),
    ]);
    assert_eq!(block_on(migrate_folder(&folder, WORKBOOK_FORMAT_VERSION)).unwrap(), WorkbookMigrationResult::Migrated);
    assert_eq!(folder.names(), ["dashql-workbook.json"]);
    assert_eq!(
        folder.json("dashql-workbook.json"),
        json!({
            "formatVersion": WORKBOOK_FORMAT_VERSION, "workbookId": SESSION_A, "workbookPath": "opfs://notebooks/x", "name": "n",
            "scripts": [], "attachments": [], "connections": [],
        })
    );
    let before = folder.files.borrow().clone();
    assert_eq!(block_on(migrate_folder(&folder, WORKBOOK_FORMAT_VERSION)).unwrap(), WorkbookMigrationResult::Current);
    assert_eq!(*folder.files.borrow(), before);
}

#[test]
fn stops_at_a_target_version_and_leaves_unusable_folders_untouched() {
    let folder = MemoryFolder::with(&[
        ("dashql-notebook.json", json!({ "formatVersion": 2, "notebookId": SESSION_A }).to_string()),
        ("dashql-relations.sql", "relations".to_string()),
    ]);
    assert_eq!(block_on(migrate_folder(&folder, 3)).unwrap(), WorkbookMigrationResult::Migrated);
    assert_eq!(folder.json("dashql-notebook.json")["formatVersion"], json!(3));
    assert!(folder.names().iter().any(|name| name == "dashql-catalog-relations.sql"));

    let newer = MemoryFolder::with(&[("dashql-session.json", format!(r#"{{"formatVersion":{}}}"#, WORKBOOK_FORMAT_VERSION + 1))]);
    assert_eq!(block_on(migrate_folder(&newer, WORKBOOK_FORMAT_VERSION)).unwrap(), WorkbookMigrationResult::Newer);
    assert_eq!(block_on(migrate_folder(&MemoryFolder::default(), WORKBOOK_FORMAT_VERSION)).unwrap(), WorkbookMigrationResult::Missing);
}
