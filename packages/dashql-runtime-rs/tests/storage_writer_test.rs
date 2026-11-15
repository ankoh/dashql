// The storage writer on a fake host: an executor of a single thread, a clock that only the test advances and a storage
// in memory. The semantics follow packages/dashql-runtime/src/storage/storage_writer.test.ts.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::future::Future;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};

use dashql_runtime::host::signal::{oneshot, Receiver, Sender};
use dashql_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_runtime::storage::keys::chain_key;
use dashql_runtime::storage::{
    ConnectionsUpdate, StorageHost, StorageWriter, TextSource, WriteError, WriteOutcome, WriteStatistics, WriteTask,
};
use serde_json::{json, Value};

const WORKBOOK: &str = "11111111-2222-4333-8444-555555555555";
const OTHER: &str = "22222222-2222-4333-8444-555555555555";
const CONNECTION: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REMOTE: &str = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";
const FORMAT_VERSION: u64 = 11;

// The executor

struct TaskWaker {
    id: u64,
    queue: Arc<Mutex<VecDeque<u64>>>,
}

impl Wake for TaskWaker {
    fn wake(self: Arc<Self>) {
        self.queue.lock().unwrap().push_back(self.id);
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

    /// Poll the tasks until none can make progress
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

// The clock

struct TimerSlot {
    fired: Cell<bool>,
    waker: RefCell<Option<Waker>>,
}

#[derive(Default)]
struct Clock {
    now: Cell<u64>,
    next_seq: Cell<u64>,
    timers: RefCell<BTreeMap<(u64, u64), Rc<TimerSlot>>>,
}

/// A sleep on the clock, dropping it clears its timer
struct Sleep {
    clock: Rc<Clock>,
    key: (u64, u64),
    slot: Rc<TimerSlot>,
}

impl Future for Sleep {
    type Output = ();

    fn poll(self: std::pin::Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.slot.fired.get() {
            return Poll::Ready(());
        }
        *self.slot.waker.borrow_mut() = Some(cx.waker().clone());
        Poll::Pending
    }
}

impl Drop for Sleep {
    fn drop(&mut self) {
        self.clock.timers.borrow_mut().remove(&self.key);
    }
}

// The storage

#[derive(Default)]
struct Store {
    workbooks: BTreeMap<String, Value>,
    scripts: BTreeMap<(String, String), String>,
    connections: Option<Vec<Value>>,
    connection_files: BTreeMap<String, String>,
    /// The storage calls that changed something, in order
    calls: Vec<String>,
    /// Scripts changed outside the app, saving one fails until the change is resolved
    externally_changed: bool,
    /// Holds the next deletion of a script until the test releases it
    delete_gate: Option<Receiver<()>>,
    /// The deletions of scripts that started
    deleting: Vec<String>,
    external_changes: Vec<String>,
    statistics: BTreeMap<String, WriteStatistics>,
    logs: Vec<(LogLevel, String)>,
}

struct FakeHost {
    executor: Rc<Executor>,
    clock: Rc<Clock>,
    store: Rc<RefCell<Store>>,
}

impl Host for FakeHost {
    fn now(&self) -> f64 {
        self.clock.now.get() as f64
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        let seq = self.clock.next_seq.get();
        self.clock.next_seq.set(seq + 1);
        let key = (self.clock.now.get() + ms.max(0.0).round() as u64, seq);
        let slot = Rc::new(TimerSlot { fired: Cell::new(false), waker: RefCell::new(None) });
        self.clock.timers.borrow_mut().insert(key, slot.clone());
        Sleep { clock: self.clock.clone(), key, slot }
    }

    fn spawn(&self, task: LocalTask) {
        self.executor.spawn(task);
    }

    fn log(&self, level: LogLevel, message: &str, _details: &[(&str, &str)]) {
        self.store.borrow_mut().logs.push((level, message.to_string()));
    }
}

impl StorageHost for FakeHost {
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        let workbook = self.store.borrow().workbooks.get(workbook_id).cloned();
        workbook.ok_or_else(|| HostError::new(format!("No workbook {workbook_id}")))
    }

    async fn save_workbook(&self, workbook_id: &str, workbook: &Value) -> Result<(), HostError> {
        let mut store = self.store.borrow_mut();
        store.calls.push(format!("manifest:{workbook_id}"));
        store.workbooks.insert(workbook_id.to_string(), workbook.clone());
        Ok(())
    }

    async fn save_script(&self, workbook_id: &str, file_name: &str, text: &str) -> Result<(), HostError> {
        let mut store = self.store.borrow_mut();
        if store.externally_changed {
            return Err(HostError::external_script_change(workbook_id, file_name));
        }
        store.calls.push(format!("write:{workbook_id}/{file_name}={text}"));
        store.scripts.insert((workbook_id.to_string(), file_name.to_string()), text.to_string());
        Ok(())
    }

    async fn delete_script(&self, workbook_id: &str, file_name: &str) -> Result<(), HostError> {
        let gate = {
            let mut store = self.store.borrow_mut();
            store.deleting.push(format!("{workbook_id}/{file_name}"));
            store.delete_gate.take()
        };
        if let Some(gate) = gate {
            gate.await;
        }
        let mut store = self.store.borrow_mut();
        store.calls.push(format!("delete:{workbook_id}/{file_name}"));
        store.scripts.remove(&(workbook_id.to_string(), file_name.to_string()));
        Ok(())
    }

    async fn rename_script(&self, workbook_id: &str, from: &str, to: &str) -> Result<(), HostError> {
        let mut store = self.store.borrow_mut();
        store.calls.push(format!("rename:{workbook_id}/{from}->{to}"));
        if let Some(text) = store.scripts.remove(&(workbook_id.to_string(), from.to_string())) {
            store.scripts.insert((workbook_id.to_string(), to.to_string()), text);
        }
        Ok(())
    }

    async fn list_attachments(&self, _workbook_id: &str) -> Result<Vec<String>, HostError> {
        Ok(Vec::new())
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

    async fn delete_connection_files(&self, connection_id: &str) -> Result<(), HostError> {
        let prefix = format!("{connection_id}/");
        self.store.borrow_mut().connection_files.retain(|key, _| !key.starts_with(&prefix));
        Ok(())
    }

    async fn delete_workbook(&self, workbook_id: &str) -> Result<(), HostError> {
        let mut store = self.store.borrow_mut();
        store.calls.push(format!("delete-workbook:{workbook_id}"));
        store.workbooks.remove(workbook_id);
        Ok(())
    }

    fn statistics_changed(&self, key: &str, statistics: &WriteStatistics) {
        self.store.borrow_mut().statistics.insert(key.to_string(), statistics.clone());
    }

    fn external_script_change(&self, workbook_id: &str) {
        self.store.borrow_mut().external_changes.push(workbook_id.to_string());
    }
}

// The harness

/// The result of a future that the executor runs
struct Started<T>(Rc<RefCell<Option<T>>>);

impl<T> Started<T> {
    fn done(&self) -> bool {
        self.0.borrow().is_some()
    }
    fn take(&self) -> T {
        self.0.borrow_mut().take().expect("the future completed")
    }
}

struct Harness {
    executor: Rc<Executor>,
    clock: Rc<Clock>,
    store: Rc<RefCell<Store>>,
    writer: StorageWriter<FakeHost>,
}

impl Harness {
    fn new() -> Harness {
        let executor = Rc::new(Executor::default());
        let clock = Rc::new(Clock::default());
        clock.now.set(1_767_225_600_000);
        let store = Rc::new(RefCell::new(Store::default()));
        let host = FakeHost { executor: executor.clone(), clock: clock.clone(), store: store.clone() };
        Harness { executor, clock, store, writer: StorageWriter::new(host, FORMAT_VERSION) }
    }

    fn start<T: 'static>(&self, future: impl Future<Output = T> + 'static) -> Started<T> {
        let result = Rc::new(RefCell::new(None));
        let slot = result.clone();
        self.executor.spawn(Box::pin(async move {
            *slot.borrow_mut() = Some(future.await);
        }));
        Started(result)
    }

    fn run(&self) {
        self.executor.run_until_stalled();
    }

    /// Advance the clock, firing the timers on the way in order
    fn advance(&self, ms: u64) {
        let target = self.clock.now.get() + ms;
        self.run();
        loop {
            let next = self.clock.timers.borrow().iter().next().map(|(key, slot)| (*key, slot.clone()));
            let Some((key, slot)) = next.filter(|(key, _)| key.0 <= target) else { break };
            self.clock.timers.borrow_mut().remove(&key);
            self.clock.now.set(key.0);
            slot.fired.set(true);
            if let Some(waker) = slot.waker.borrow_mut().take() {
                waker.wake();
            }
            self.run();
        }
        self.clock.now.set(target);
        self.run();
    }

    /// Run a future to its end, the timers fire when nothing else can make progress
    fn block_on<T: 'static>(&self, future: impl Future<Output = T> + 'static) -> T {
        let started = self.start(future);
        self.run();
        while !started.done() {
            let next = self.clock.timers.borrow().keys().next().copied();
            let Some((deadline, _)) = next else { break };
            self.advance(deadline.saturating_sub(self.clock.now.get()));
        }
        started.take()
    }

    fn flush(&self) {
        let flush = self.writer.flush();
        self.block_on(flush);
    }

    fn timers(&self) -> usize {
        self.clock.timers.borrow().len()
    }

    fn calls(&self) -> Vec<String> {
        self.store.borrow().calls.clone()
    }

    fn clear_calls(&self) {
        self.store.borrow_mut().calls.clear();
    }

    fn workbook(&self, workbook_id: &str) -> Value {
        self.store.borrow().workbooks.get(workbook_id).cloned().unwrap_or(Value::Null)
    }

    fn set_workbook(&self, workbook_id: &str, workbook: Value) {
        self.store.borrow_mut().workbooks.insert(workbook_id.to_string(), workbook);
    }
}

fn written(outcome: &WriteOutcome) -> bool {
    matches!(outcome, WriteOutcome::Written)
}

fn connection(id: &str, endpoint: &str) -> Value {
    json!({ "connectionId": id, "params": { "trino": { "endpoint": endpoint } } })
}

fn test_workbook() -> Value {
    json!({
        "formatVersion": FORMAT_VERSION,
        "workbookId": WORKBOOK,
        "connections": [{ "connectionId": CONNECTION, "params": { "hyper": {} } }],
        "scripts": [],
        "attachments": [],
        "metadata": { "createdAt": "2026-01-01T00:00:00.000Z" },
    })
}

fn manifest_key(workbook_id: &str) -> String {
    format!("{workbook_id}/dashql-workbook.json")
}

fn connection_copy_key(workbook_id: &str, connection_id: &str) -> String {
    format!("{workbook_id}/dashql-workbook.json:connection/{connection_id}")
}

fn script_list_key(workbook_id: &str) -> String {
    format!("{workbook_id}/dashql-workbook.json:scripts")
}

fn script_key(workbook_id: &str, file_name: &str) -> String {
    format!("{workbook_id}/scripts/{file_name}")
}

fn properties(name: &str) -> WriteTask {
    WriteTask::WriteWorkbookProperties { workbook_id: WORKBOOK.to_string(), name: Some(name.to_string()), ephemeral: false, cloud: None }
}

fn patch(workbook_id: &str, endpoint: &str) -> WriteTask {
    WriteTask::PatchWorkbookConnection {
        workbook_id: workbook_id.to_string(),
        copy: connection(CONNECTION, endpoint),
        replaced: Vec::new(),
    }
}

fn write_script(workbook_id: &str, file_name: &str, text: &str) -> WriteTask {
    WriteTask::WriteScript { workbook_id: workbook_id.to_string(), file_name: file_name.to_string(), text: text.to_string() }
}

fn script_list(names: &[&str], connections: Vec<Value>) -> WriteTask {
    WriteTask::WriteWorkbookScripts {
        workbook_id: WORKBOOK.to_string(),
        scripts: names.iter().map(|name| json!({ "name": name, "connectionId": CONNECTION })).collect(),
        connections,
    }
}

// Debouncing

#[test]
fn debounces_writes_and_keeps_the_timer_of_the_first_one() {
    let h = Harness::new();
    let first = h.start(h.writer.write(&script_key(WORKBOOK, "a.sql"), write_script(WORKBOOK, "a.sql", "1"), 100.0));
    h.advance(60);
    let second = h.start(h.writer.write(&script_key(WORKBOOK, "a.sql"), write_script(WORKBOOK, "a.sql", "2"), 100.0));
    h.run();
    assert!(matches!(first.take(), WriteOutcome::Superseded));
    h.advance(39);
    assert!(h.calls().is_empty());
    // The newer task runs when the timer of the first one fires
    h.advance(1);
    assert!(written(&second.take()));
    assert_eq!(h.calls(), [format!("write:{WORKBOOK}/a.sql=2")]);
    assert_eq!(h.timers(), 0);
}

#[test]
fn pausing_clears_the_timers_and_resuming_waits_for_the_debounce_again() {
    let h = Harness::new();
    let result = h.start(h.writer.write(&script_key(WORKBOOK, "a.sql"), write_script(WORKBOOK, "a.sql", "1"), 100.0));
    h.advance(50);
    h.writer.pause();
    h.run();
    assert_eq!(h.timers(), 0, "the paused writer cleared the timer");
    h.advance(1000);
    assert!(h.calls().is_empty());
    h.writer.resume();
    h.advance(99);
    assert!(h.calls().is_empty());
    h.advance(1);
    assert!(written(&result.take()));

    // A paused workbook holds its writes, the other workbooks keep writing
    h.writer.pause_workbook(WORKBOOK);
    let held = h.start(h.writer.write(&script_key(WORKBOOK, "b.sql"), write_script(WORKBOOK, "b.sql", "1"), 10.0));
    let other = h.start(h.writer.write(&script_key(OTHER, "c.sql"), write_script(OTHER, "c.sql", "1"), 10.0));
    h.advance(100);
    assert!(!held.done());
    assert!(written(&other.take()));
    assert!(h.writer.is_workbook_paused(WORKBOOK));
    h.writer.resume_workbook(WORKBOOK);
    assert!(!h.writer.is_workbook_paused(WORKBOOK));
    h.advance(10);
    assert!(written(&held.take()));
}

// Coalescing and ordering

#[test]
fn retains_rename_and_connection_copy_in_separate_debounced_tasks() {
    for name_first in [true, false] {
        let h = Harness::new();
        h.set_workbook(WORKBOOK, json!({ "formatVersion": FORMAT_VERSION, "workbookId": WORKBOOK, "connections": [connection(CONNECTION, "committed")], "scripts": [], "attachments": [], "metadata": {} }));
        for endpoint in ["saved", "saved again"] {
            let name = format!("renamed before {endpoint}");
            let rename = || h.start(h.writer.write(&manifest_key(WORKBOOK), properties(&name), 10_000.0));
            let copy = || h.start(h.writer.write(&connection_copy_key(WORKBOOK, CONNECTION), patch(WORKBOOK, endpoint), 10_000.0));
            let tasks = if name_first { [rename(), copy()] } else { [copy(), rename()] };
            assert_eq!(h.writer.pending_keys_for_workbook(WORKBOOK).len(), 2);
            h.flush();
            assert!(tasks.iter().all(|task| written(&task.take())));
            let workbook = h.workbook(WORKBOOK);
            assert_eq!(workbook["name"], json!(name));
            assert_eq!(workbook["connections"], json!([connection(CONNECTION, endpoint)]));
        }
    }
}

#[test]
fn keeps_rename_write_and_delete_in_distinct_ordered_keyspaces() {
    let h = Harness::new();
    let rename = h.start(h.writer.write(
        &format!("{WORKBOOK}/scripts/01_old.sql:rename"),
        WriteTask::RenameScript { workbook_id: WORKBOOK.to_string(), from: "01_old.sql".to_string(), to: "01_new.sql".to_string() },
        10_000.0,
    ));
    let write = h.start(h.writer.write(&script_key(WORKBOOK, "01_new.sql"), write_script(WORKBOOK, "01_new.sql", "new"), 10_000.0));
    let delete = h.start(h.writer.write(
        &format!("{WORKBOOK}/scripts/02_unused.sql:delete"),
        WriteTask::DeleteScript { workbook_id: WORKBOOK.to_string(), file_name: "02_unused.sql".to_string() },
        10_000.0,
    ));
    h.flush();
    assert!([rename, write, delete].iter().all(|task| written(&task.take())));
    assert_eq!(
        h.calls(),
        [
            format!("rename:{WORKBOOK}/01_old.sql->01_new.sql"),
            format!("write:{WORKBOOK}/01_new.sql=new"),
            format!("delete:{WORKBOOK}/02_unused.sql"),
        ]
    );
}

#[test]
fn does_not_overlap_mutations_of_the_same_workbook() {
    let h = Harness::new();
    let (release, gate): (Sender<()>, Receiver<()>) = oneshot();
    h.store.borrow_mut().delete_gate = Some(gate);
    let deletion = h.start(h.writer.write(
        &format!("{WORKBOOK}/scripts/02_old.sql:delete"),
        WriteTask::DeleteScript { workbook_id: WORKBOOK.to_string(), file_name: "02_old.sql".to_string() },
        0.0,
    ));
    h.advance(0);
    assert_eq!(h.store.borrow().deleting.len(), 1);
    let write = h.start(h.writer.write(&script_key(WORKBOOK, "03_new.sql"), write_script(WORKBOOK, "03_new.sql", "SELECT 3"), 10_000.0));
    let flush = h.start(h.writer.flush());
    h.run();
    // The flush started the write, it waits for the deletion
    assert!(h.calls().is_empty());
    assert!(!flush.done());
    release.send(());
    h.run();
    assert!(written(&deletion.take()) && written(&write.take()));
    assert!(flush.done());
    assert_eq!(h.calls(), [format!("delete:{WORKBOOK}/02_old.sql"), format!("write:{WORKBOOK}/03_new.sql=SELECT 3")]);
}

#[test]
fn chains_global_keys_per_entity_and_workbook_keys_per_workbook() {
    assert_eq!(chain_key(&script_key(WORKBOOK, "01.sql")), WORKBOOK);
    assert_eq!(chain_key(&connection_copy_key(WORKBOOK, CONNECTION)), WORKBOOK);
    assert_eq!(chain_key(&format!("@manifest/connections/{CONNECTION}")), "@manifest");
    assert_eq!(chain_key(&format!("@connections/{CONNECTION}/dashql-catalog-relations.sql")), format!("@connections/{CONNECTION}"));
}

// The workbook file

#[test]
fn writes_the_marker_of_an_ephemeral_workbook_and_removes_it_on_promotion() {
    let h = Harness::new();
    let copy = test_workbook()["connections"][0].clone();
    let write = |task: WriteTask| {
        h.start(h.writer.write(&manifest_key(WORKBOOK), task, 0.0));
        h.flush();
        h.workbook(WORKBOOK)
    };
    let manifest = |ephemeral| WriteTask::WriteWorkbookManifest { workbook_id: WORKBOOK.to_string(), connections: vec![copy.clone()], ephemeral };
    let created = write(manifest(true));
    assert_eq!(created["metadata"]["ephemeral"], json!(true));
    assert_eq!(created["metadata"]["createdAt"], json!("2026-01-01T00:00:00.000Z"));
    assert_eq!(created["formatVersion"], json!(FORMAT_VERSION));
    let keys: Vec<&String> = created.as_object().map(|o| o.keys().collect()).unwrap_or_default();
    assert_eq!(keys, ["formatVersion", "workbookId", "connections", "scripts", "attachments", "metadata"]);

    // A connection change rewrites the manifest and a whole workbook may be written while it is ephemeral
    assert_eq!(write(manifest(false))["metadata"]["ephemeral"], json!(true));
    let replaced = write(WriteTask::ReplaceWorkbookScripts {
        workbook_id: WORKBOOK.to_string(),
        name: Some("New Workbook".to_string()),
        scripts: Vec::new(),
        connection: Some(copy.clone()),
        original_file_name: Some(String::new()),
    });
    assert_eq!(replaced["metadata"]["ephemeral"], json!(true));
    assert_eq!(replaced["name"], json!("New Workbook"));

    // The properties keep it while the workbook stays ephemeral
    let kept = write(WriteTask::WriteWorkbookProperties {
        workbook_id: WORKBOOK.to_string(),
        name: Some("New Workbook".to_string()),
        ephemeral: true,
        cloud: None,
    });
    assert_eq!(kept["metadata"]["ephemeral"], json!(true));
    let promoted = write(properties("Untitled"));
    assert_eq!(promoted["name"], json!("Untitled"));
    assert!(promoted["metadata"].get("ephemeral").is_none());
}

#[test]
fn writes_and_removes_the_link_to_the_cloud_with_the_properties() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    let cloud = json!({ "workbookId": "c0ffee00-0000-4000-8000-000000000001", "versionId": "c0ffee00-0000-4000-8000-000000000002", "connectionId": "cloud" });
    let write = |cloud: Option<Value>| {
        let task = WriteTask::WriteWorkbookProperties { workbook_id: WORKBOOK.to_string(), name: Some("Published".to_string()), ephemeral: false, cloud };
        h.start(h.writer.write(&manifest_key(WORKBOOK), task, 0.0));
        h.flush();
        h.workbook(WORKBOOK)
    };
    assert_eq!(write(Some(cloud.clone()))["metadata"]["cloud"], cloud);
    let unlinked = write(None);
    assert!(unlinked["metadata"].get("cloud").is_none());
    assert_eq!(unlinked["metadata"]["createdAt"], json!("2026-01-01T00:00:00.000Z"));
}

#[test]
fn patches_the_script_list_without_losing_pending_property_writes() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    let remote = connection(REMOTE, "remote");
    let scripts = json!([{ "name": "b.sql", "connectionId": REMOTE }, { "name": "a.sql", "connectionId": CONNECTION }]);
    let rename = h.start(h.writer.write(&manifest_key(WORKBOOK), properties("renamed"), 10_000.0));
    let list = h.start(h.writer.write(
        &script_list_key(WORKBOOK),
        WriteTask::WriteWorkbookScripts {
            workbook_id: WORKBOOK.to_string(),
            scripts: scripts.as_array().cloned().unwrap_or_default(),
            connections: vec![remote.clone()],
        },
        10_000.0,
    ));
    h.flush();
    assert!(written(&rename.take()) && written(&list.take()));
    let local = test_workbook()["connections"][0].clone();
    let workbook = h.workbook(WORKBOOK);
    assert_eq!(workbook["name"], json!("renamed"));
    // The connections follow the scripts in the order the scripts use them
    assert_eq!(workbook["connections"], json!([remote, local]));
    assert_eq!(workbook["scripts"], scripts);

    // A manifest rewrite keeps the script list and the connections of its scripts
    h.start(h.writer.write(
        &manifest_key(WORKBOOK),
        WriteTask::WriteWorkbookManifest { workbook_id: WORKBOOK.to_string(), connections: vec![local.clone()], ephemeral: false },
        0.0,
    ));
    h.flush();
    assert_eq!(h.workbook(WORKBOOK)["scripts"], scripts);
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([remote, local]));

    // Once no script uses the remote connection, the workbook drops its copy
    h.start(h.writer.write(&script_list_key(WORKBOOK), script_list(&["a.sql"], Vec::new()), 0.0));
    h.flush();
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([local]));
}

#[test]
fn keeps_the_latest_script_list_when_the_workbook_file_is_rewritten_in_between() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    let read_count = Rc::new(Cell::new(0));
    let reads = read_count.clone();
    let tasks = [
        h.start(h.writer.write(&script_list_key(WORKBOOK), script_list(&["a.sql"], Vec::new()), 10_000.0)),
        h.start(h.writer.write(
            &format!("{WORKBOOK}/scripts"),
            WriteTask::ReplaceWorkbookScripts {
                workbook_id: WORKBOOK.to_string(),
                name: None,
                scripts: vec![(
                    "a.sql".to_string(),
                    TextSource::Read(Box::new(move || {
                        reads.set(reads.get() + 1);
                        Ok(Some("SELECT 1".to_string()))
                    })),
                )],
                connection: None,
                original_file_name: None,
            },
            10_000.0,
        )),
        h.start(h.writer.write(&script_list_key(WORKBOOK), script_list(&["b.sql", "a.sql"], Vec::new()), 10_000.0)),
    ];
    // The text is read when the write runs
    assert_eq!(read_count.get(), 0);
    h.flush();
    assert!(matches!(tasks[0].take(), WriteOutcome::Superseded));
    assert!(written(&tasks[1].take()) && written(&tasks[2].take()));
    assert_eq!(read_count.get(), 1);
    assert_eq!(h.workbook(WORKBOOK)["scripts"], json!([{ "name": "b.sql", "connectionId": CONNECTION }, { "name": "a.sql", "connectionId": CONNECTION }]));
    assert_eq!(h.store.borrow().scripts.get(&(WORKBOOK.to_string(), "a.sql".to_string())).cloned(), Some("SELECT 1".to_string()));
}

#[test]
fn keeps_the_connections_of_the_scripts_when_the_manifest_is_written() {
    let h = Harness::new();
    let mut workbook = test_workbook();
    workbook["scripts"] = json!([{ "name": "local.sql", "connectionId": CONNECTION }]);
    h.set_workbook(WORKBOOK, workbook);
    let task = WriteTask::WriteWorkbookManifest {
        workbook_id: WORKBOOK.to_string(),
        connections: vec![json!({ "connectionId": CONNECTION, "params": { "hyper": { "protocol": "WASM" } } }), connection(REMOTE, "https://trino.example")],
        ephemeral: false,
    };
    h.block_on(h.writer.write(WORKBOOK, task, 0.0));
    // A connection that no script uses is left out, the given copy of the used one wins
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([{ "connectionId": CONNECTION, "params": { "hyper": { "protocol": "WASM" } } }]));
    // An unchanged manifest is not written again
    h.clear_calls();
    let task = WriteTask::WriteWorkbookManifest { workbook_id: WORKBOOK.to_string(), connections: Vec::new(), ephemeral: false };
    assert!(written(&h.block_on(h.writer.write(WORKBOOK, task, 0.0))));
    assert!(h.calls().is_empty());
}

#[test]
fn patches_the_copies_of_a_connection_and_rewrites_the_connections_it_replaced() {
    let h = Harness::new();
    let mut workbook = test_workbook();
    workbook["connections"] = json!([connection(CONNECTION, "old"), connection(REMOTE, "old")]);
    workbook["scripts"] = json!([{ "name": "a.sql", "connectionId": REMOTE }]);
    h.set_workbook(WORKBOOK, workbook);
    let task = WriteTask::PatchWorkbookConnection {
        workbook_id: WORKBOOK.to_string(),
        copy: connection(CONNECTION, "new"),
        replaced: vec![REMOTE.to_string()],
    };
    assert!(written(&h.block_on(h.writer.write_durable(&connection_copy_key(WORKBOOK, CONNECTION), task))));
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([connection(CONNECTION, "new")]));
    assert_eq!(h.workbook(WORKBOOK)["scripts"], json!([{ "name": "a.sql", "connectionId": CONNECTION }]));
    // An up-to-date copy is not written again
    h.block_on(h.writer.write_durable(&connection_copy_key(WORKBOOK, CONNECTION), patch(WORKBOOK, "new")));
    assert_eq!(h.calls(), [format!("manifest:{WORKBOOK}")]);
}

#[test]
fn reports_failed_writes_and_never_recreates_a_missing_workbook() {
    let h = Harness::new();
    let outcome = h.block_on(h.writer.write_durable(&connection_copy_key(WORKBOOK, CONNECTION), patch(WORKBOOK, "x")));
    match outcome {
        WriteOutcome::Failed(WriteError::WorkbookUnavailable { workbook_id, .. }) => assert_eq!(workbook_id, WORKBOOK),
        other => panic!("unexpected outcome {other:?}"),
    }
    assert!(h.store.borrow().workbooks.is_empty());
    assert!(h.store.borrow().logs.iter().any(|(level, message)| *level == LogLevel::Error && message == "executing write task failed"));
}

// Connections

#[test]
fn writes_connection_entries_durably_and_defers_while_paused() {
    let h = Harness::new();
    let key = format!("@manifest/connections/{CONNECTION}");
    let entry = |endpoint: &str| WriteTask::WriteConnectionEntry { entry: json!({ "id": CONNECTION, "params": { "trino": { "endpoint": endpoint } } }) };
    let debounced = h.start(h.writer.write(&key, entry("draft"), 10_000.0));
    assert!(written(&h.block_on(h.writer.write_durable(&key, entry("saved")))));
    assert!(matches!(debounced.take(), WriteOutcome::Superseded));
    assert_eq!(h.store.borrow().connections, Some(vec![json!({ "id": CONNECTION, "params": { "trino": { "endpoint": "saved" } } })]));

    h.writer.pause();
    assert!(matches!(h.block_on(h.writer.write_durable(&key, entry("paused"))), WriteOutcome::Deferred));
    assert_eq!(h.store.borrow().connections, Some(vec![json!({ "id": CONNECTION, "params": { "trino": { "endpoint": "saved" } } })]));
    h.writer.resume();
    h.flush();
    assert_eq!(h.store.borrow().connections, Some(vec![json!({ "id": CONNECTION, "params": { "trino": { "endpoint": "paused" } } })]));
}

#[test]
fn keeps_the_creation_time_of_connection_entries_and_deletes_them() {
    let h = Harness::new();
    h.store.borrow_mut().connections = Some(vec![json!({ "id": CONNECTION, "params": { "a": 1 }, "createdAt": "2026-01-01T00:00:00.000Z" })]);
    h.store.borrow_mut().connection_files.insert(format!("{CONNECTION}/catalog.sql"), "x".to_string());
    let key = format!("@manifest/connections/{CONNECTION}");
    h.block_on(h.writer.write_durable(&key, WriteTask::WriteConnectionEntry { entry: json!({ "id": CONNECTION, "params": { "a": 2 } }) }));
    assert_eq!(h.store.borrow().connections, Some(vec![json!({ "id": CONNECTION, "params": { "a": 2 }, "createdAt": "2026-01-01T00:00:00.000Z" })]));
    h.block_on(h.writer.write_durable(&key, WriteTask::DeleteConnectionEntry { connection_id: CONNECTION.to_string() }));
    assert_eq!(h.store.borrow().connections, Some(Vec::new()));
    assert!(h.store.borrow().connection_files.is_empty());
}

#[test]
fn reads_connection_files_when_they_are_written_and_cancels_them_with_the_connection() {
    let h = Harness::new();
    let key = format!("@connections/{CONNECTION}/catalog.sql");
    let file = |text: Option<&'static str>| WriteTask::WriteConnectionFile {
        connection_id: CONNECTION.to_string(),
        file_name: "catalog.sql".to_string(),
        text: TextSource::Read(Box::new(move || Ok(text.map(str::to_string)))),
    };
    // Nothing to write anymore
    assert!(written(&h.block_on(h.writer.write(&key, file(None), 0.0))));
    assert!(h.calls().is_empty());
    let cancelled = h.start(h.writer.write(&key, file(Some("select 1")), 1000.0));
    h.writer.cancel_pending_connection_file_writes(CONNECTION);
    h.flush();
    assert!(matches!(cancelled.take(), WriteOutcome::Cancelled));
    assert!(written(&h.block_on(h.writer.write(&key, file(Some("select 2")), 0.0))));
    assert_eq!(h.store.borrow().connection_files.get(&format!("{CONNECTION}/catalog.sql")).cloned(), Some("select 2".to_string()));
}

// Deleted workbooks

#[test]
fn drops_pending_and_later_writes_of_a_deleted_workbook_until_it_is_revived() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    let pending = h.start(h.writer.write(&script_key(WORKBOOK, "a.sql"), write_script(WORKBOOK, "a.sql", "select 1"), 1000.0));
    assert!(h.block_on(h.writer.delete_workbook(WORKBOOK)).is_ok());
    assert!(matches!(pending.take(), WriteOutcome::Cancelled));
    let later = h.block_on(h.writer.write(&script_key(WORKBOOK, "b.sql"), write_script(WORKBOOK, "b.sql", "select 2"), 0.0));
    assert!(matches!(later, WriteOutcome::Cancelled));
    h.flush();
    assert!(h.store.borrow().workbooks.is_empty());
    assert!(!h.calls().iter().any(|call| call.starts_with("write:")));

    // An import of the same bundle registers the id again
    h.writer.revive_workbook(WORKBOOK);
    assert!(written(&h.block_on(h.writer.write(&script_key(WORKBOOK, "a.sql"), write_script(WORKBOOK, "a.sql", "select 1"), 0.0))));
    assert!(h.calls().contains(&format!("write:{WORKBOOK}/a.sql=select 1")));
}

// Flushing a workbook

#[test]
fn flushes_the_pending_tasks_of_a_workbook_and_leaves_the_others_pending() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    h.set_workbook(OTHER, test_workbook());
    let flushed = h.start(h.writer.write(&connection_copy_key(WORKBOOK, CONNECTION), patch(WORKBOOK, "flushed"), 10_000.0));
    h.start(h.writer.write(&connection_copy_key(OTHER, CONNECTION), patch(OTHER, "pending"), 10_000.0));
    let flush = h.writer.flush_workbook(WORKBOOK);
    let result = h.start(flush);
    h.run();
    assert!(result.take());
    assert!(written(&flushed.take()));
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([connection(CONNECTION, "flushed")]));
    assert_eq!(h.writer.pending_keys_for_workbook(OTHER).len(), 1);
    // A workbook without pending writes is written
    assert!(h.block_on(h.writer.flush_workbook(WORKBOOK)));
}

#[test]
fn never_forces_the_writes_of_a_held_workbook() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    h.start(h.writer.write(&connection_copy_key(WORKBOOK, CONNECTION), patch(WORKBOOK, "held"), 10_000.0));
    h.writer.pause_workbook(WORKBOOK);
    assert!(!h.block_on(h.writer.flush_workbook(WORKBOOK)));
    assert_eq!(h.writer.pending_keys_for_workbook(WORKBOOK).len(), 1);
    assert_eq!(h.workbook(WORKBOOK), test_workbook());
    h.writer.resume_workbook(WORKBOOK);
    assert!(h.block_on(h.writer.flush_workbook(WORKBOOK)));
}

#[test]
fn keeps_a_failed_write_pending_for_the_next_flush() {
    let h = Harness::new();
    let key = connection_copy_key(WORKBOOK, CONNECTION);
    // The workbook file is missing, the patch fails
    let failed = h.start(h.writer.write(&key, patch(WORKBOOK, "retried"), 10_000.0));
    let flush = h.writer.flush_workbook(WORKBOOK);
    let result = h.start(flush);
    h.run();
    assert!(!result.take());
    assert!(matches!(failed.take(), WriteOutcome::Failed(_)));
    assert_eq!(h.writer.pending_keys_for_workbook(WORKBOOK), [key.clone()]);
    // The retry waits for its debounce duration again
    assert_eq!(h.timers(), 1);

    h.set_workbook(WORKBOOK, test_workbook());
    let flush = h.writer.flush_workbook(WORKBOOK);
    let result = h.start(flush);
    h.run();
    assert!(result.take());
    assert!(h.writer.pending_keys_for_workbook(WORKBOOK).is_empty());
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([connection(CONNECTION, "retried")]));
    assert_eq!(h.timers(), 0, "the flush cleared the timer of the retry");
}

// External changes

#[test]
fn holds_a_write_that_would_overwrite_an_external_change_until_the_workbook_resumes() {
    let h = Harness::new();
    h.store.borrow_mut().externally_changed = true;
    let key = script_key(WORKBOOK, "a.sql");
    let pending = h.start(h.writer.write(&key, write_script(WORKBOOK, "a.sql", "select 1"), 0.0));
    h.advance(10);
    h.block_on(h.writer.settle());
    assert_eq!(h.store.borrow().external_changes, [WORKBOOK]);
    assert!(!pending.done());
    assert_eq!(h.writer.pending_keys_for_workbook(WORKBOOK), [key]);
    assert!(h.writer.is_workbook_paused(WORKBOOK));

    // Other workbooks keep writing while the workbook is held
    let other = WriteTask::WriteWorkbookManifest { workbook_id: OTHER.to_string(), connections: vec![connection(CONNECTION, "x")], ephemeral: false };
    assert!(written(&h.block_on(h.writer.write_durable(&manifest_key(OTHER), other))));

    h.store.borrow_mut().externally_changed = false;
    h.writer.resume_workbook(WORKBOOK);
    h.advance(0);
    assert!(written(&pending.take()));
    assert_eq!(h.store.borrow().scripts.get(&(WORKBOOK.to_string(), "a.sql".to_string())).cloned(), Some("select 1".to_string()));
}

#[test]
fn lets_a_newer_write_of_the_same_script_supersede_a_held_one() {
    let h = Harness::new();
    h.store.borrow_mut().externally_changed = true;
    let key = script_key(WORKBOOK, "a.sql");
    let held = h.start(h.writer.write(&key, write_script(WORKBOOK, "a.sql", "select 1"), 0.0));
    h.advance(10);
    let newer = h.start(h.writer.write(&key, write_script(WORKBOOK, "a.sql", "select 2"), 0.0));
    h.run();
    assert!(matches!(held.take(), WriteOutcome::Superseded));
    h.writer.cancel_pending_writes_for_workbook(WORKBOOK);
    h.run();
    assert!(matches!(newer.take(), WriteOutcome::Cancelled));
    assert!(!h.calls().iter().any(|call| call.starts_with("write:")));
}

// Statistics and generations

#[test]
fn counts_scheduled_and_performed_writes() {
    let h = Harness::new();
    let key = script_key(WORKBOOK, "a.sql");
    h.start(h.writer.write(&key, write_script(WORKBOOK, "a.sql", "1"), 100.0));
    h.start(h.writer.write(&key, write_script(WORKBOOK, "a.sql", "12"), 100.0));
    h.advance(10);
    h.advance(100);
    let stats = h.store.borrow().statistics.get(&key).cloned().unwrap_or_default();
    assert_eq!((stats.scheduled_writes, stats.writes, stats.written_bytes), (2, 1, 2));
    assert_eq!(stats.last_write_ms, Some(1_767_225_600_100.0));
    assert_eq!(h.writer.statistics().len(), 1);
    let generations = h.writer.write_generations_for_workbook(WORKBOOK);
    assert_eq!(generations, [(key, 2)]);
}
