// The restore of the stored state on a fake host: an executor of a single thread and a storage in memory that serves
// the restore and the storage writer.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::future::Future;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Wake, Waker};

use dashql_buffers::editor::EditorOffsetUnit;
use dashql_core_runtime::settings::RuntimeSettings;
use dashql_core_runtime::attachments::DataFile;
use dashql_core_runtime::catalog_loader::tables::{catalog_tables_of_descriptor, read_catalog_descriptor};
use dashql_core_runtime::connections::{ConnectionState, RelationName};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_storage::restore::bundle::BundleHost;
use dashql_core_storage::workbook_format::bundle::{DataFileData, ScriptData, WorkbookBundle};
use dashql_core_storage::workbook_format::data::WorkbookData;
use dashql_core_storage::restore::{
    script_connection_of, AppRestore, LiveConnection, RestoreHost, RestoreOptions, RestoreProgress, RestoredState,
};
use dashql_core_storage::storage::{ConnectionsUpdate, Expect, FileStamp, FolderListing, NamedStamp, StorageHost, StorageWriter, WriteStatistics};
use dashql_core_storage::workbook_format::restore::RestoreConnection;
use dashql_core_storage::workbook_format::validation::WorkbookValidationError;
use serde_json::{json, Value};

const WORKBOOK: &str = "11111111-2222-4333-8444-555555555555";
const OTHER_WORKBOOK: &str = "22222222-3333-4444-8555-666666666666";
const CONNECTION: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_CONNECTION: &str = "33333333-4444-4555-8666-777777777777";
const REMOTE: &str = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";

// The executor

struct TaskWaker {
    id: u64,
    queue: Arc<Mutex<VecDeque<u64>>>,
}

impl Wake for TaskWaker {
    fn wake(self: Arc<Self>) {
        if let Ok(mut queue) = self.queue.lock() {
            queue.push_back(self.id);
        }
    }
}

#[derive(Default)]
struct Executor {
    tasks: RefCell<HashMap<u64, LocalTask>>,
    queue: Arc<Mutex<VecDeque<u64>>>,
    next_id: Cell<u64>,
}

impl Executor {
    fn spawn(&self, task: LocalTask) {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        self.tasks.borrow_mut().insert(id, task);
        self.queue.lock().unwrap().push_back(id);
    }

    fn run_until_stalled(&self) {
        loop {
            let Some(id) = self.queue.lock().unwrap().pop_front() else { return };
            let Some(mut task) = self.tasks.borrow_mut().remove(&id) else { continue };
            let waker = Waker::from(Arc::new(TaskWaker { id, queue: self.queue.clone() }));
            if task.as_mut().poll(&mut Context::from_waker(&waker)).is_pending() {
                self.tasks.borrow_mut().insert(id, task);
            }
        }
    }
}

// The storage

#[derive(Default)]
struct Store {
    /// The workbooks of the tree in order
    tree: Vec<String>,
    workbooks: BTreeMap<String, Value>,
    scripts: BTreeMap<String, Vec<(String, String)>>,
    data_files: BTreeMap<String, Vec<String>>,
    /// The connections of the app manifest, none for a storage without a registry
    connections: Option<Vec<Value>>,
    connection_files: BTreeMap<String, String>,
    owns_connections: bool,
    /// Workbooks whose files can't be read
    unreadable: Vec<String>,
    /// Workbooks whose scripts can't be read
    unreadable_scripts: Vec<String>,
    /// The storage calls that changed something, in order
    calls: Vec<String>,
    /// The stamps of the workbook folders that may change outside the app
    listings: BTreeMap<String, FolderListing>,
    /// The reads of the workbook folders, in order
    reads: Vec<String>,
    logs: Vec<(LogLevel, String, Vec<(String, String)>)>,
    progress: Vec<RestoreProgress>,
}

#[derive(Clone)]
struct FakeHost {
    executor: Rc<Executor>,
    store: Rc<RefCell<Store>>,
}

impl Host for FakeHost {
    fn now(&self) -> f64 {
        1_767_225_600_000.0
    }

    fn sleep(&self, _ms: f64) -> impl Future<Output = ()> + 'static {
        std::future::ready(())
    }

    fn spawn(&self, task: LocalTask) {
        self.executor.spawn(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let details = details.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        self.store.borrow_mut().logs.push((level, message.to_string(), details));
    }

    fn settings(&self) -> RuntimeSettings {
        RuntimeSettings::default()
    }
}

impl StorageHost for FakeHost {
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        self.store.borrow_mut().reads.push(format!("workbook:{workbook_id}"));
        let store = self.store.borrow();
        if store.unreadable.iter().any(|id| id == workbook_id) {
            return Err(HostError::new("missing files"));
        }
        store.workbooks.get(workbook_id).cloned().ok_or_else(|| HostError::new(format!("No workbook {workbook_id}")))
    }

    async fn save_workbook(&self, workbook_id: &str, workbook: &Value, _expect: Expect) -> Result<Option<FileStamp>, HostError> {
        let mut store = self.store.borrow_mut();
        store.calls.push(format!("manifest:{workbook_id}"));
        store.workbooks.insert(workbook_id.to_string(), workbook.clone());
        Ok(None)
    }

    async fn save_script(&self, _workbook_id: &str, _file_name: &str, _text: &str, _expect: Expect) -> Result<Option<FileStamp>, HostError> {
        Ok(None)
    }

    async fn delete_script(&self, _workbook_id: &str, _file_name: &str, _expect: Expect) -> Result<(), HostError> {
        Ok(())
    }

    async fn rename_script(&self, _workbook_id: &str, _from: &str, _to: &str, _expect_from: Expect, _expect_to: Expect) -> Result<(), HostError> {
        Ok(())
    }

    async fn list_attachments(&self, workbook_id: &str) -> Result<Vec<String>, HostError> {
        Ok(self.store.borrow().data_files.get(workbook_id).cloned().unwrap_or_default())
    }

    async fn update_connections(&self, mut update: ConnectionsUpdate) -> Result<(), HostError> {
        let current = self.store.borrow().connections.clone();
        if let Some(next) = update(current) {
            let mut store = self.store.borrow_mut();
            store.calls.push("connections".to_string());
            store.connections = Some(next);
        }
        Ok(())
    }

    async fn save_connection_file(&self, connection_id: &str, file_name: &str, text: &str) -> Result<(), HostError> {
        let mut store = self.store.borrow_mut();
        store.calls.push(format!("connection-file:{connection_id}/{file_name}"));
        store.connection_files.insert(format!("{connection_id}/{file_name}"), text.to_string());
        Ok(())
    }

    async fn delete_connection_files(&self, _connection_id: &str) -> Result<(), HostError> {
        Ok(())
    }

    async fn delete_workbook(&self, _workbook_id: &str) -> Result<(), HostError> {
        Ok(())
    }

    fn statistics_changed(&self, _key: &str, _statistics: &WriteStatistics) {}
}

impl RestoreHost for FakeHost {
    fn owns_connections(&self) -> bool {
        self.store.borrow().owns_connections
    }

    async fn list_workbooks(&self) -> Result<Vec<String>, HostError> {
        Ok(self.store.borrow().tree.clone())
    }

    async fn load_manifest_connections(&self) -> Result<Option<Vec<Value>>, HostError> {
        Ok(self.store.borrow().connections.clone())
    }

    async fn load_scripts(&self, workbook_id: &str) -> Result<Vec<(String, String)>, HostError> {
        self.store.borrow_mut().reads.push(format!("scripts:{workbook_id}"));
        let store = self.store.borrow();
        if store.unreadable_scripts.iter().any(|id| id == workbook_id) {
            return Err(HostError::new("unreadable scripts"));
        }
        Ok(store.scripts.get(workbook_id).cloned().unwrap_or_default())
    }

    async fn list_data_files(&self, workbook_id: &str) -> Result<Vec<DataFile>, HostError> {
        let names = self.store.borrow().data_files.get(workbook_id).cloned().unwrap_or_default();
        Ok(names.into_iter().map(|name| DataFile { name, size_bytes: 10, mtime_ms: 1 }).collect())
    }

    async fn load_connection_file(&self, connection_id: &str, file_name: &str) -> Result<Option<String>, HostError> {
        Ok(self.store.borrow().connection_files.get(&format!("{connection_id}/{file_name}")).cloned())
    }

    async fn stamp_folder(&self, workbook_id: &str) -> Result<Option<FolderListing>, HostError> {
        let mut store = self.store.borrow_mut();
        store.reads.push(format!("stamps:{workbook_id}"));
        Ok(store.listings.get(workbook_id).cloned())
    }

    fn restore_progress(&self, progress: &RestoreProgress) {
        self.store.borrow_mut().progress.push(progress.clone());
    }
}

// The harness

fn trino(endpoint: &str) -> Value {
    json!({ "trino": { "endpoint": endpoint } })
}

fn hyper_wasm() -> Value {
    json!({ "hyper": { "protocol": "WASM" } })
}

fn hyper_http() -> Value {
    json!({ "hyper": { "protocol": "V3_HTTP", "endpoint": "http://hyper.example" } })
}

/// A valid workbook file with copies of connections and a script list
fn workbook(workbook_id: &str, connections: Value, scripts: Value) -> Value {
    json!({
        "formatVersion": 11,
        "workbookId": workbook_id,
        "connections": connections,
        "scripts": scripts,
        "attachments": [],
        "metadata": { "createdAt": "2026-01-01T00:00:00.000Z" },
    })
}

struct Fixture {
    host: FakeHost,
}

impl Fixture {
    fn new() -> Self {
        let store = Store { owns_connections: true, connections: Some(Vec::new()), ..Store::default() };
        Fixture { host: FakeHost { executor: Rc::default(), store: Rc::new(RefCell::new(store)) } }
    }

    fn add_workbook(&self, workbook_id: &str, file: Value, scripts: &[(&str, &str)]) {
        let mut store = self.host.store.borrow_mut();
        store.tree.push(workbook_id.to_string());
        store.workbooks.insert(workbook_id.to_string(), file);
        store.scripts.insert(workbook_id.to_string(), scripts.iter().map(|(n, t)| (n.to_string(), t.to_string())).collect());
    }

    fn set_file(&self, connection_id: &str, file_name: &str, text: &str) {
        self.host.store.borrow_mut().connection_files.insert(format!("{connection_id}/{file_name}"), text.to_string());
    }

    fn file(&self, connection_id: &str, file_name: &str) -> Option<String> {
        self.host.store.borrow().connection_files.get(&format!("{connection_id}/{file_name}")).cloned()
    }

    fn stored(&self, workbook_id: &str) -> Value {
        self.host.store.borrow().workbooks.get(workbook_id).cloned().unwrap_or(Value::Null)
    }

    fn restore_with(&self, live: Vec<LiveConnection>) -> AppRestore<FakeHost, FakeHost> {
        let writer = StorageWriter::new(self.host.clone(), 11);
        let mut next = 0;
        let options = RestoreOptions {
            offset_unit: EditorOffsetUnit::UTF16_CODE_UNITS,
            new_uuid: Box::new(move || {
                next += 1;
                Some(format!("00000000-0000-4000-8000-{next:012}"))
            }),
        };
        let mut restore = AppRestore::new(self.host.clone(), writer, options);
        for live in live {
            restore.add_live_connection(live);
        }
        restore
    }

    /// Run a future on the executor to its end
    fn run<T: 'static>(&self, future: impl Future<Output = T> + 'static) -> T {
        let out: Rc<RefCell<Option<T>>> = Rc::default();
        let slot = out.clone();
        self.host.executor.spawn(Box::pin(async move {
            *slot.borrow_mut() = Some(future.await);
        }));
        self.host.executor.run_until_stalled();
        let value = out.borrow_mut().take();
        value.expect("the future completed")
    }

    fn restore(&self) -> RestoredState {
        let restore = self.restore_with(Vec::new());
        self.run(restore.restore())
    }

    fn logged(&self, message: &str) -> Vec<Vec<(String, String)>> {
        self.host.store.borrow().logs.iter().filter(|(_, m, _)| m == message).map(|(_, _, d)| d.clone()).collect()
    }
}

fn connection<'a>(state: &'a RestoredState, connection_id: &str) -> &'a ConnectionState {
    state.connections.iter().find(|c| c.connection_id() == connection_id).expect("the connection was restored")
}

fn connection_ids(state: &RestoredState) -> Vec<&str> {
    state.connections.iter().map(|c| c.connection_id()).collect()
}

fn script_names(state: &RestoredState, workbook_id: &str) -> Vec<String> {
    let workbook = state.workbooks.iter().find(|w| w.workbook.id() == workbook_id).expect("the workbook was restored");
    workbook.workbook.scripts().iter().map(|s| s.file_name().to_string()).collect()
}

fn relation_tables(state: &ConnectionState) -> usize {
    let catalog = state.catalog().borrow();
    let Some(bytes) = catalog.descriptor_bytes(state.relation_entry_id()) else { return 0 };
    catalog_tables_of_descriptor(Some(&read_catalog_descriptor(bytes).unwrap())).len()
}

// The tests

#[test]
fn acknowledges_the_stamps_of_a_folder_that_it_reads_before_the_reads() {
    let fixture = Fixture::new();
    let copies = json!([{ "connectionId": CONNECTION, "params": hyper_wasm() }]);
    fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, copies, json!([])), &[]);
    let stamp = |size: f64| FileStamp { size, mtime_ms: 1.0 };
    // The scripts folder is missing while the restore reads it
    let at_restore = FolderListing { workbook: Some(stamp(10.0)), ..FolderListing::default() };
    fixture.host.store.borrow_mut().listings.insert(WORKBOOK.to_string(), at_restore.clone());
    let writer = StorageWriter::new(fixture.host.clone(), 11);
    let options = RestoreOptions { offset_unit: EditorOffsetUnit::UTF16_CODE_UNITS, new_uuid: Box::new(|| None) };
    let restore = AppRestore::new(fixture.host.clone(), writer.clone(), options);
    let restored = fixture.run(restore.restore());
    assert_eq!(restored.workbooks.len(), 1);
    let reads = fixture.host.store.borrow().reads.clone();
    assert_eq!(reads.get(..3), Some(&[format!("stamps:{WORKBOOK}"), format!("workbook:{WORKBOOK}"), format!("scripts:{WORKBOOK}")][..]));
    assert!(writer.stamps().changes(WORKBOOK, &at_restore, "dashql-workbook.json").is_empty());
    // The folder comes back before the first check, its scripts are new to the app
    let back = FolderListing { scripts: vec![NamedStamp { name: "a.sql".to_string(), stamp: stamp(3.0) }], ..at_restore };
    assert_eq!(writer.stamps().changes(WORKBOOK, &back, "dashql-workbook.json"), ["a.sql"]);
    // A workbook of the storage root has no stamps
    assert!(!writer.stamps().is_acknowledged(OTHER_WORKBOOK));
}

#[test]
fn restores_unlisted_scripts_in_natural_order_and_writes_the_list() {
    let fixture = Fixture::new();
    let copies = json!([{ "connectionId": CONNECTION, "params": hyper_wasm() }]);
    fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, copies, json!([])), &[("10_last.sql", "SELECT 10"), ("2_first.sql", "SELECT 2")]);
    let restored = fixture.restore();

    assert_eq!(connection_ids(&restored), vec![CONNECTION]);
    assert_eq!(script_names(&restored, WORKBOOK), vec!["2_first.sql", "10_last.sql"]);
    let first = &restored.workbooks[0].workbook.scripts()[0];
    assert_eq!(first.session().borrow().text(), "SELECT 2");
    assert_eq!(restored.workbooks[0].connection_ids, vec![CONNECTION]);
    assert_eq!(
        fixture.stored(WORKBOOK)["scripts"],
        json!([{ "name": "2_first.sql", "connectionId": CONNECTION }, { "name": "10_last.sql", "connectionId": CONNECTION }])
    );
    // The connection only a workbook knew is in the app manifest
    let connections = fixture.host.store.borrow().connections.clone().unwrap_or_default();
    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0]["id"], json!(CONNECTION));
    assert_eq!(connections[0]["createdAt"], json!("2026-01-01T00:00:00.000Z"));
    let progress = &restored.progress;
    assert_eq!((progress.workbook_scripts.total, progress.workbook_scripts.succeeded), (Some(1), 1));
}

#[test]
fn restores_a_workbook_into_memory_without_writing() {
    let fixture = Fixture::new();
    let copies = json!([{ "connectionId": CONNECTION, "params": hyper_wasm() }]);
    let file = workbook(WORKBOOK, copies, json!([]));
    fixture.add_workbook(WORKBOOK, file.clone(), &[("10_last.sql", "SELECT 10"), ("2_first.sql", "SELECT 2")]);
    let options = RestoreOptions { offset_unit: EditorOffsetUnit::UTF16_CODE_UNITS, new_uuid: Box::new(|| None) };
    let restore: AppRestore<FakeHost, FakeHost> = AppRestore::in_memory(fixture.host.clone(), options);
    let restored = fixture.run(restore.restore_workbook(WORKBOOK)).unwrap();
    assert_eq!(script_names(&restored, WORKBOOK), vec!["2_first.sql", "10_last.sql"]);
    assert_eq!(connection_ids(&restored), vec![CONNECTION]);
    // The list that a restore from storage writes stays unwritten, so does the app manifest
    assert_eq!(fixture.stored(WORKBOOK), file);
    assert!(fixture.host.store.borrow().connections.clone().unwrap_or_default().is_empty());
}

#[test]
fn restores_a_bundle_into_memory_without_reading_storage() {
    // An archive opens into memory: the restore reads the bundle through the bundle host, never the storage of the host
    let fixture = Fixture::new();
    let copies = json!([{ "connectionId": CONNECTION, "params": hyper_wasm() }]);
    let mut file = workbook(WORKBOOK, copies, json!([]));
    file["attachments"] = json!([{ "name": "orders.parquet" }]);
    let bundle = WorkbookBundle {
        workbook: WorkbookData::from_json(&file),
        catalogs: Vec::new(),
        scripts: vec![ScriptData::new("10_last.sql", "SELECT 10"), ScriptData::new("2_first.sql", "SELECT 2")],
        data: vec![DataFileData { name: "orders.parquet".to_string(), bytes: vec![0_u8; 5] }],
        results: Vec::new(),
    };
    let host = BundleHost { host: fixture.host.clone(), bundle };
    let options = RestoreOptions { offset_unit: EditorOffsetUnit::UTF16_CODE_UNITS, new_uuid: Box::new(|| None) };
    let restore: AppRestore<BundleHost<FakeHost, Vec<u8>>, BundleHost<FakeHost, Vec<u8>>> = AppRestore::in_memory(host, options);
    let restored = fixture.run(restore.restore_workbook(WORKBOOK)).unwrap();
    assert_eq!(script_names(&restored, WORKBOOK), vec!["2_first.sql", "10_last.sql"]);
    assert_eq!(connection_ids(&restored), vec![CONNECTION]);
    let attachments = restored.workbooks[0].workbook.attachments().unwrap_or_default();
    assert_eq!(attachments.iter().map(|a| (a.file_name.as_str(), a.size_bytes)).collect::<Vec<_>>(), vec![("orders.parquet", 5)]);
    assert!(fixture.host.store.borrow().reads.is_empty());
    assert!(fixture.host.store.borrow().calls.is_empty());
}

#[test]
fn keeps_the_script_list_while_the_script_files_are_gone() {
    // A checkout or a sync removed the script files for a while, the workbook file still lists them
    let fixture = Fixture::new();
    let copies = json!([{ "connectionId": CONNECTION, "params": hyper_wasm() }, { "connectionId": REMOTE, "params": hyper_http() }]);
    let scripts = json!([{ "name": "b.sql", "connectionId": REMOTE }, { "name": "a.sql", "connectionId": CONNECTION }]);
    let file = workbook(WORKBOOK, copies, scripts);
    fixture.add_workbook(WORKBOOK, file.clone(), &[]);
    let restored = fixture.restore();
    assert!(script_names(&restored, WORKBOOK).is_empty());
    // Nothing writes the emptied list, the files keep their connections when they come back
    assert_eq!(fixture.stored(WORKBOOK), file);
    assert!(!fixture.host.store.borrow().calls.iter().any(|call| call == &format!("manifest:{WORKBOOK}")));
    let missing = fixture.logged("The script files of the workbook are missing, keeping its script list");
    assert_eq!(missing.len(), 1);
    assert!(missing[0].contains(&("scripts".to_string(), "b.sql, a.sql".to_string())));

    // The files are back: the scripts run on the connections of the list again
    fixture.host.store.borrow_mut().scripts.insert(WORKBOOK.to_string(), vec![("a.sql".into(), "SELECT 1".into()), ("b.sql".into(), "SELECT 2".into())]);
    let restored = fixture.restore();
    assert_eq!(script_names(&restored, WORKBOOK), vec!["b.sql", "a.sql"]);
    let script_connections: Vec<String> =
        restored.workbooks[0].workbook.scripts().iter().map(|script| script.connection().connection_id.clone()).collect();
    assert_eq!(script_connections, vec![REMOTE.to_string(), CONNECTION.to_string()]);
    assert_eq!(fixture.stored(WORKBOOK)["scripts"], file["scripts"]);
}

#[test]
fn keeps_the_order_of_the_workbook_file_and_runs_unknown_connections_on_the_embedded_database() {
    let fixture = Fixture::new();
    let copies = json!([
        { "connectionId": CONNECTION, "params": hyper_wasm() },
        { "connectionId": REMOTE, "params": trino("https://trino.example") },
    ]);
    let scripts = json!([
        { "name": "10_last.sql", "connectionId": REMOTE },
        { "name": "2_first.sql", "connectionId": "99999999-9999-4999-8999-999999999999" },
    ]);
    fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, copies, scripts), &[("10_last.sql", "SELECT 10"), ("2_first.sql", "SELECT 2")]);
    let restored = fixture.restore();

    assert_eq!(script_names(&restored, WORKBOOK), vec!["10_last.sql", "2_first.sql"]);
    let scripts = restored.workbooks[0].workbook.scripts();
    assert_eq!(scripts[0].connection().connection_id, REMOTE);
    assert_eq!(scripts[1].connection().connection_id, CONNECTION);
    assert_eq!(scripts[1].unresolved_connection_id(), Some("99999999-9999-4999-8999-999999999999"));
    assert_eq!(restored.workbooks[0].connection_ids, vec![REMOTE, CONNECTION]);
    // The script shares the catalog of its connection
    assert!(Rc::ptr_eq(&scripts[0].connection().catalog, connection(&restored, REMOTE).catalog()));
    assert_eq!(fixture.logged("Script references an unknown connection, using the embedded database").len(), 1);
}

#[test]
fn lets_the_app_manifest_win_over_stale_copies() {
    let fixture = Fixture::new();
    fixture.host.store.borrow_mut().connections = Some(vec![json!({ "id": CONNECTION, "params": trino("https://saved"), "name": "Mine" })]);
    let stale = json!([{ "connectionId": CONNECTION, "params": trino("https://stale") }]);
    fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, stale.clone(), json!([])), &[]);
    fixture.add_workbook(OTHER_WORKBOOK, workbook(OTHER_WORKBOOK, stale, json!([])), &[]);
    let restored = fixture.restore();

    assert_eq!(connection_ids(&restored), vec![CONNECTION]);
    assert_eq!(connection(&restored, CONNECTION).name(), Some("Mine"));
    for workbook_id in [WORKBOOK, OTHER_WORKBOOK] {
        assert_eq!(fixture.stored(workbook_id)["connections"], json!([{ "connectionId": CONNECTION, "params": trino("https://saved") }]));
    }
}

#[test]
fn registers_connections_that_only_a_workbook_knows_with_their_names_and_catalogs() {
    let fixture = Fixture::new();
    fixture.host.store.borrow_mut().connections = Some(vec![json!({ "id": OTHER_CONNECTION, "params": trino("https://known"), "name": "Mine" })]);
    let copies = json!([
        { "connectionId": CONNECTION, "params": trino("https://unknown"), "name": "Production" },
        { "connectionId": OTHER_CONNECTION, "params": trino("https://known"), "name": "Theirs" },
    ]);
    let scripts = json!([{ "name": "01_new.sql", "connectionId": CONNECTION }, { "name": "02_known.sql", "connectionId": OTHER_CONNECTION }]);
    fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, copies, scripts), &[("01_new.sql", "SELECT 1"), ("02_known.sql", "SELECT 2")]);
    // E.g. an imported workbook seeded the catalog of the connection
    fixture.set_file(CONNECTION, "dashql-catalog-relations.sql", "CREATE TABLE db.public.seeded(id integer);");
    let restored = fixture.restore();

    assert_eq!(connection_ids(&restored), vec![OTHER_CONNECTION, CONNECTION]);
    let registered = connection(&restored, CONNECTION);
    assert_eq!(registered.name(), Some("Production"));
    assert_eq!(connection(&restored, OTHER_CONNECTION).name(), Some("Mine"));
    assert_eq!(relation_tables(registered), 1);
    assert!(registered.catalog_updates().described);
    let connections = fixture.host.store.borrow().connections.clone().unwrap_or_default();
    let names: Vec<&Value> = connections.iter().map(|c| &c["name"]).collect();
    assert_eq!(names, vec![&json!("Mine"), &json!("Production")]);
    // The copies of the workbook drop the names
    let copies = fixture.stored(WORKBOOK)["connections"].clone();
    assert!(copies.as_array().unwrap().iter().all(|copy| copy.get("name").is_none()));
}

#[test]
fn refuses_invalid_and_unreadable_workbooks_before_anything_is_created() {
    let fixture = Fixture::new();
    let copies = json!([{ "connectionId": CONNECTION, "params": hyper_wasm() }]);
    let mut v1 = workbook(WORKBOOK, copies.clone(), json!([]));
    v1["formatVersion"] = json!(1);
    fixture.add_workbook(WORKBOOK, v1, &[]);
    fixture.add_workbook(OTHER_WORKBOOK, workbook(OTHER_WORKBOOK, copies, json!([])), &[]);
    fixture.host.store.borrow_mut().unreadable.push(OTHER_WORKBOOK.to_string());
    fixture.host.store.borrow_mut().tree.push("not-a-uuid".to_string());
    let restored = fixture.restore();

    let errors: Vec<(String, WorkbookValidationError)> = restored.invalid_workbooks.iter().map(|i| (i.workbook_id.clone(), i.error)).collect();
    assert_eq!(
        errors,
        vec![
            (WORKBOOK.to_string(), WorkbookValidationError::UnsupportedFormatVersion),
            (OTHER_WORKBOOK.to_string(), WorkbookValidationError::WorkbookUnreadable),
            ("not-a-uuid".to_string(), WorkbookValidationError::InvalidWorkbookId),
        ]
    );
    assert!(restored.connections.is_empty());
    assert!(restored.workbooks.is_empty());
    assert_eq!(restored.progress.connections.skipped, 3);
    assert!(fixture.host.store.borrow().calls.is_empty());
}

#[test]
fn surfaces_a_workbook_whose_scripts_fail_to_load_and_restores_the_next() {
    let fixture = Fixture::new();
    let copies = json!([{ "connectionId": CONNECTION, "params": hyper_wasm() }]);
    fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, copies.clone(), json!([])), &[("1.sql", "SELECT 1")]);
    fixture.add_workbook(OTHER_WORKBOOK, workbook(OTHER_WORKBOOK, copies, json!([])), &[("1.sql", "SELECT 1")]);
    fixture.host.store.borrow_mut().unreadable_scripts.push(WORKBOOK.to_string());
    let restored = fixture.restore();

    assert_eq!(restored.invalid_workbooks.len(), 1);
    assert_eq!(restored.invalid_workbooks[0].error, WorkbookValidationError::WorkbookNotRestored);
    assert_eq!(restored.workbooks.len(), 1);
    assert_eq!(restored.workbooks[0].workbook.id(), OTHER_WORKBOOK);
    assert_eq!(restored.progress.workbook_scripts.failed, 1);
    assert_eq!(restored.progress.connections.succeeded, 2);
}

#[test]
fn keeps_an_empty_ephemeral_workbook_and_promotes_one_that_holds_scripts() {
    let fixture = Fixture::new();
    let copies = json!([{ "connectionId": CONNECTION, "params": hyper_wasm() }]);
    let mut ephemeral = workbook(WORKBOOK, copies.clone(), json!([]));
    ephemeral["metadata"]["ephemeral"] = json!(true);
    fixture.add_workbook(WORKBOOK, ephemeral.clone(), &[]);
    let mut crashed = workbook(OTHER_WORKBOOK, copies, json!([{ "name": "1.sql", "connectionId": CONNECTION }]));
    crashed["metadata"]["ephemeral"] = json!(true);
    crashed["name"] = json!("Kept");
    fixture.add_workbook(OTHER_WORKBOOK, crashed, &[("1.sql", "SELECT 1")]);
    let restored = fixture.restore();

    let empty = &restored.workbooks[0];
    assert!(empty.workbook.ephemeral());
    assert_eq!(empty.metadata["ephemeral"], json!(true));
    assert_eq!(fixture.stored(WORKBOOK)["metadata"]["ephemeral"], json!(true));
    // The app stopped after the script was written, before the promotion was
    let promoted = &restored.workbooks[1];
    assert!(!promoted.workbook.ephemeral());
    assert!(promoted.metadata.get("ephemeral").is_none());
    let stored = fixture.stored(OTHER_WORKBOOK);
    assert!(stored["metadata"].get("ephemeral").is_none());
    assert_eq!(stored["name"], json!("Kept"));
}

#[test]
fn restores_the_relations_and_functions_of_a_connection() {
    let fixture = Fixture::new();
    fixture.host.store.borrow_mut().connections = Some(vec![json!({ "id": CONNECTION, "params": trino("https://trino.example") })]);
    fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, json!([{ "connectionId": CONNECTION, "params": trino("https://trino.example") }]), json!([])), &[]);
    let functions = "CREATE FUNCTION db.public.restored_function(first integer) RETURNS bigint;";
    fixture.set_file(CONNECTION, "dashql-catalog-relations.sql", "CREATE TABLE db.public.restored_items(id integer, name text);");
    fixture.set_file(CONNECTION, "dashql-catalog-functions.sql", functions);
    let restored = fixture.restore();

    let main = connection(&restored, CONNECTION);
    assert_eq!(relation_tables(main), 1);
    assert_eq!(main.function_script().map(|script| script.to_text()), Some(functions.to_string()));
    assert!(main.catalog_updates().described);
}

#[test]
fn leaves_a_catalog_that_does_not_read_to_a_refresh() {
    let fixture = Fixture::new();
    fixture.host.store.borrow_mut().connections = Some(vec![json!({ "id": CONNECTION, "params": trino("https://trino.example") })]);
    fixture.set_file(CONNECTION, "dashql-catalog-relations.sql", "CREATE TABLE broken(");
    let restored = fixture.restore();

    let main = connection(&restored, CONNECTION);
    assert_eq!(relation_tables(main), 0);
    assert!(!main.catalog_updates().described);
    assert_eq!(fixture.logged("Failed to restore connection catalog, will refresh on connect").len(), 1);
}

#[test]
fn clears_the_catalog_changes_of_older_versions_and_asks_about_their_relations() {
    let fixture = Fixture::new();
    fixture.host.store.borrow_mut().connections = Some(vec![json!({ "id": CONNECTION, "params": hyper_http() })]);
    fixture.set_file(CONNECTION, "dashql-catalog-relations.sql", r#"CREATE TABLE "hyper"."public"."kept"(id integer);"#);
    fixture.set_file(CONNECTION, "dashql-catalog-changes.sql", "-- Catalog changes of executed statements\n\nDROP TABLE \"hyper\".\"public\".\"kept\";\n");
    let restored = fixture.restore();

    let main = connection(&restored, CONNECTION);
    assert_eq!(relation_tables(main), 1);
    assert!(main.catalog_updates().described);
    assert_eq!(main.catalog_updates().touched_relations, vec![RelationName::new("hyper", "public", "kept")]);
    assert_eq!(fixture.file(CONNECTION, "dashql-catalog-changes.sql").as_deref(), Some(""));
    let state: Value = serde_json::from_str(&fixture.file(CONNECTION, "dashql-catalog-state.json").unwrap_or_default()).unwrap();
    assert_eq!(state["pending"], json!([{ "databaseName": "hyper", "schemaName": "public", "tableName": "kept" }]));
}

#[test]
fn restores_the_relations_it_has_to_ask_about_and_those_that_are_gone() {
    let fixture = Fixture::new();
    fixture.host.store.borrow_mut().connections = Some(vec![json!({ "id": CONNECTION, "params": hyper_http() })]);
    fixture.set_file(CONNECTION, "dashql-catalog-relations.sql", r#"CREATE TABLE "hyper"."public"."kept"(id integer);"#);
    let state = json!({
        "pending": [{ "databaseName": "hyper", "schemaName": "", "tableName": "asked" }],
        "gone": [{ "databaseName": "hyper", "schemaName": "public", "tableName": "dropped" }],
    });
    fixture.set_file(CONNECTION, "dashql-catalog-state.json", &state.to_string());
    let restored = fixture.restore();

    let main = connection(&restored, CONNECTION);
    assert_eq!(main.catalog_updates().touched_relations, vec![RelationName::new("hyper", "", "asked")]);
    let gone: Vec<String> = main.catalog().borrow().absent_relations().iter().map(|key| key.2.to_string()).collect();
    assert_eq!(gone, vec!["dropped"]);
    assert_eq!(relation_tables(main), 1);
}

#[test]
fn asks_a_salesforce_connection_about_nothing() {
    let fixture = Fixture::new();
    let params = json!({ "salesforce": { "instanceUrl": "https://example.my.salesforce.com" } });
    fixture.host.store.borrow_mut().connections = Some(vec![json!({ "id": CONNECTION, "params": params })]);
    fixture.set_file(CONNECTION, "dashql-catalog-changes.sql", r#"CREATE TABLE "c"."s"."kept"(id integer);"#);
    fixture.set_file(CONNECTION, "dashql-catalog-state.json", r#"{"pending":[{"databaseName":"c","schemaName":"s","tableName":"kept"}],"gone":[]}"#);
    let restored = fixture.restore();
    assert!(connection(&restored, CONNECTION).catalog_updates().touched_relations.is_empty());
}

#[test]
fn drops_the_persisted_relations_of_an_embedded_connection() {
    let fixture = Fixture::new();
    fixture.host.store.borrow_mut().connections = Some(vec![json!({ "id": CONNECTION, "params": hyper_wasm() })]);
    let functions = r#"CREATE FUNCTION "hyper"."public"."kept_function"(value integer) RETURNS bigint;"#;
    fixture.set_file(CONNECTION, "dashql-catalog-relations.sql", r#"CREATE TABLE "hyper"."public"."gone"(id integer);"#);
    fixture.set_file(CONNECTION, "dashql-catalog-changes.sql", "CREATE TABLE \"hyper\".\"public\".\"created\" (\"a\" integer);\n");
    fixture.set_file(CONNECTION, "dashql-catalog-functions.sql", functions);
    let restored = fixture.restore();

    let main = connection(&restored, CONNECTION);
    assert_eq!(relation_tables(main), 0);
    assert_eq!(main.function_script().map(|script| script.to_text()), Some(functions.to_string()));
    assert!(!main.catalog_updates().described);
    assert_eq!(fixture.file(CONNECTION, "dashql-catalog-relations.sql").as_deref(), Some(""));
    assert_eq!(fixture.file(CONNECTION, "dashql-catalog-changes.sql").as_deref(), Some(""));
    assert_eq!(fixture.file(CONNECTION, "dashql-catalog-functions.sql").as_deref(), Some(functions));
}

#[test]
fn a_storage_without_connections_writes_no_connections() {
    let fixture = Fixture::new();
    {
        let mut store = fixture.host.store.borrow_mut();
        store.owns_connections = false;
        store.connections = None;
    }
    let copies = json!([{ "connectionId": CONNECTION, "params": trino("https://trino.example"), "name": "Production" }]);
    fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, copies, json!([])), &[("1.sql", "SELECT 1")]);
    fixture.set_file(CONNECTION, "dashql-catalog-relations.sql", "CREATE TABLE db.public.seeded(id integer);");
    let restored = fixture.restore();

    assert_eq!(connection_ids(&restored), vec![CONNECTION]);
    assert_eq!(relation_tables(connection(&restored, CONNECTION)), 0);
    assert!(fixture.host.store.borrow().connections.is_none());
    // The copy keeps its name, the script list is written
    assert_eq!(fixture.stored(WORKBOOK)["connections"][0]["name"], json!("Production"));
    assert_eq!(fixture.stored(WORKBOOK)["scripts"], json!([{ "name": "1.sql", "connectionId": CONNECTION }]));
}

#[test]
fn restores_an_imported_workbook_against_the_live_connections() {
    let fixture = Fixture::new();
    fixture.host.store.borrow_mut().connections = Some(vec![json!({ "id": OTHER_CONNECTION, "params": trino("https://known") })]);
    let live_state = fixture.restore().connections.into_iter().next().expect("the live connection");
    let live = LiveConnection {
        connection: RestoreConnection {
            connection_id: OTHER_CONNECTION.to_string(),
            params: trino("https://known"),
            params_draft: None,
            name: None,
            cache_query_results: None,
        },
        script_connection: script_connection_of(&live_state),
    };
    let copies = json!([
        { "connectionId": OTHER_CONNECTION, "params": trino("https://known") },
        { "connectionId": CONNECTION, "params": trino("https://new") },
    ]);
    let scripts = json!([{ "name": "01_known.sql", "connectionId": OTHER_CONNECTION }, { "name": "02_new.sql", "connectionId": CONNECTION }]);
    fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, copies, scripts), &[("01_known.sql", "SELECT 1"), ("02_new.sql", "SELECT 2")]);

    let restore = fixture.restore_with(vec![live]);
    let restored = fixture.run(async move { restore.restore_workbook(WORKBOOK).await }).expect("the workbook was restored");
    assert_eq!(connection_ids(&restored), vec![CONNECTION]);
    assert_eq!(restored.workbooks[0].connection_ids, vec![OTHER_CONNECTION, CONNECTION]);
    let scripts = restored.workbooks[0].workbook.scripts();
    assert!(Rc::ptr_eq(&scripts[0].connection().catalog, live_state.catalog()));

    let missing = fixture.restore_with(Vec::new());
    let result = fixture.run(async move { missing.restore_workbook(OTHER_WORKBOOK).await });
    assert!(result.is_err());
}

// The persistence of connections

mod persistence {
    use super::*;
    use dashql_core_storage::connection_persistence::{
        connection_writes, save_connection, saved_entry, saved_params, schedule_connection_writes, ConnectionChange,
        ConnectionWrites, PersistedConnection, CONNECTION_DRAFT_WRITE_DEBOUNCE_MS,
    };
    use dashql_core_runtime::connections::{
        CatalogUpdateTaskStatus, ConnectionAction, ConnectionDetails, ConnectionParams, ConnectionStateOptions,
    };
    use dashql_core_storage::restore::catalog::{apply_catalog_files, CatalogFiles};
    use dashql_core_storage::storage::{WriteOutcome, WriteTask};

    fn state(params: &Value, active: bool) -> ConnectionState {
        let params = ConnectionParams::from_json(&params.to_string()).unwrap();
        let options = ConnectionStateOptions { active, params: Some(params.clone()), params_draft: None };
        ConnectionState::new(CONNECTION, ConnectionDetails::new(&params), options, 0.0)
    }

    fn keys(writes: &ConnectionWrites) -> Vec<(String, f64)> {
        writes.writes.iter().map(|write| (write.key.clone(), write.debounce_ms)).collect()
    }

    fn names(writes: &ConnectionWrites) -> Vec<String> {
        keys(writes).into_iter().map(|(key, _)| key).collect()
    }

    fn file(name: &str) -> String {
        format!("@connections/{CONNECTION}/{name}")
    }

    fn workbooks() -> Vec<String> {
        vec![WORKBOOK.to_string()]
    }

    #[test]
    fn writes_drafts_to_the_manifest_and_saved_params_everywhere() {
        let mut next = state(&trino("https://a"), true);
        let prev = PersistedConnection::of_state(&next);
        let draft = ConnectionParams::from_json(&trino("https://b").to_string()).unwrap();
        next.apply(ConnectionAction::SetDraft(draft), 1.0).unwrap();
        let writes = connection_writes(CONNECTION, &prev, &next, &ConnectionChange::Other, &workbooks());
        let entry = format!("@manifest/connections/{CONNECTION}");
        assert_eq!(keys(&writes), vec![(entry.clone(), CONNECTION_DRAFT_WRITE_DEBOUNCE_MS)]);

        let prev = PersistedConnection { params: trino("https://old"), ..PersistedConnection::of_state(&next) };
        let writes = connection_writes(CONNECTION, &prev, &next, &ConnectionChange::Other, &workbooks());
        let copy = format!("{WORKBOOK}/dashql-workbook.json:connection/{CONNECTION}");
        assert_eq!(keys(&writes), vec![(entry, 100.0), (copy, 100.0)]);
        // Saving writes the committed params by itself
        assert!(connection_writes(CONNECTION, &prev, &next, &ConnectionChange::ParamsCommitted, &workbooks()).writes.is_empty());
        // A connection that no workbook references and that was never active stays out of storage
        let inactive = state(&trino("https://a"), false);
        assert!(connection_writes(CONNECTION, &prev, &inactive, &ConnectionChange::Other, &[]).writes.is_empty());
    }

    #[test]
    fn writes_the_catalog_files_of_a_durable_connection() {
        let fixture = Fixture::new();
        let mut next = state(&trino("https://a"), true);
        let files = CatalogFiles { relations: Some("CREATE TABLE db.public.t(id integer);".into()), ..CatalogFiles::default() };
        assert!(apply_catalog_files(&mut next, &files).succeeded);
        let prev = PersistedConnection::of_state(&next);
        let refresh = ConnectionChange::CatalogUpdateFinished { status: CatalogUpdateTaskStatus::Succeeded, refreshed: true, changed: None };
        let writes = connection_writes(CONNECTION, &prev, &next, &refresh, &workbooks());
        assert_eq!(names(&writes), vec![file("dashql-catalog-relations.sql"), file("dashql-catalog-functions.sql"), file("dashql-catalog-state.json")]);
        let writer = StorageWriter::new(fixture.host.clone(), 11);
        schedule_connection_writes(&writer, writes, CONNECTION);
        fixture.run(writer.flush());
        let relations = fixture.file(CONNECTION, "dashql-catalog-relations.sql").unwrap_or_default();
        assert!(relations.contains("CREATE TABLE"), "{relations}");
        assert_eq!(fixture.file(CONNECTION, "dashql-catalog-state.json").as_deref(), Some(r#"{"pending":[],"gone":[]}"#));

        // A lookup that changed nothing only saves what it answered
        let lookup = ConnectionChange::CatalogUpdateFinished { status: CatalogUpdateTaskStatus::Succeeded, refreshed: false, changed: Some(false) };
        assert_eq!(names(&connection_writes(CONNECTION, &prev, &next, &lookup, &workbooks())), vec![file("dashql-catalog-state.json")]);
        // The embedded Hyper keeps no relations, a refresh writes its functions
        let embedded = state(&hyper_wasm(), true);
        let prev = PersistedConnection::of_state(&embedded);
        assert_eq!(names(&connection_writes(CONNECTION, &prev, &embedded, &refresh, &[])), vec![file("dashql-catalog-functions.sql")]);
    }

    #[test]
    fn deletes_an_active_connection() {
        let next = state(&trino("https://a"), true);
        let prev = PersistedConnection::of_state(&next);
        let writes = connection_writes(CONNECTION, &prev, &next, &ConnectionChange::Deleted, &[]);
        assert!(writes.cancel_file_writes);
        assert!(matches!(writes.writes.as_slice(), [write] if matches!(write.task, WriteTask::DeleteConnectionEntry { .. })));
        let inactive = PersistedConnection { active: false, ..prev };
        assert!(connection_writes(CONNECTION, &inactive, &next, &ConnectionChange::Deleted, &[]).writes.is_empty());
    }

    #[test]
    fn saves_the_manifest_before_the_copies() {
        let fixture = Fixture::new();
        let copies = json!([{ "connectionId": CONNECTION, "params": trino("https://old") }]);
        fixture.add_workbook(WORKBOOK, workbook(WORKBOOK, copies, json!([])), &[]);
        let mut connection = state(&trino("https://a"), true);
        let draft = ConnectionParams::from_json(&trino("https://saved").to_string()).unwrap();
        connection.apply(ConnectionAction::SetDraft(draft), 1.0).unwrap();
        let params = saved_params(&connection, None);
        let entry = saved_entry(CONNECTION, &connection, &params);
        assert!(entry.get("paramsDraft").is_none());
        let params = serde_json::from_str::<Value>(&params.to_json()).unwrap();
        let writer = StorageWriter::new(fixture.host.clone(), 11);
        let committed = Rc::new(Cell::new(false));
        let commit = committed.clone();
        let host = fixture.host.clone();
        let outcome = fixture.run(async move {
            let workbooks = vec![WORKBOOK.to_string(), OTHER_WORKBOOK.to_string()];
            save_connection(&writer, CONNECTION, entry, &params, &workbooks, move || {
                // The manifest is written when the params are committed
                assert_eq!(host.store.borrow().connections.as_ref().map(Vec::len), Some(1));
                commit.set(true);
            })
            .await
        });
        assert!(committed.get());
        assert!(matches!(outcome.manifest, WriteOutcome::Written));
        let results: Vec<(&str, bool)> =
            outcome.workbooks.iter().map(|(id, result)| (id.as_str(), matches!(result, WriteOutcome::Written))).collect();
        // The copy of a workbook that isn't stored fails, the next restore heals it
        assert_eq!(results, vec![(WORKBOOK, true), (OTHER_WORKBOOK, false)]);
        assert_eq!(fixture.stored(WORKBOOK)["connections"], json!([{ "connectionId": CONNECTION, "params": trino("https://saved") }]));
    }
}
