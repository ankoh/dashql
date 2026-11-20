// The storage writer on a fake host: an executor of a single thread, a clock that only the test advances and a storage
// in memory that keeps stamps like a folder on disk.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::future::Future;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};

use dashql_core_runtime::host::signal::{oneshot, Receiver, Sender};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::HostBytes;
use dashql_core_runtime::settings::RuntimeSettings;
use dashql_core_storage::storage::keys::chain_key;
use dashql_core_storage::storage::{
    ConnectionsUpdate, Expect, FileStamp, FolderListing, HoldReason, NamedStamp, StorageHost, StorageWriter,
    TextSource, WriteError, WriteOutcome, WriteTask, WriterStatus,
};
use dashql_core_storage::workbook_format::data::{WorkbookCloudLink, WorkbookConnection, WorkbookScript};
use serde_json::{json, Value};

const WORKBOOK: &str = "11111111-2222-4333-8444-555555555555";
const OTHER: &str = "22222222-2222-4333-8444-555555555555";
const CONNECTION: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REMOTE: &str = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";
const FORMAT_VERSION: i64 = 11;

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

/// A script file with its stamp
#[derive(Clone)]
struct File {
    name: String,
    text: String,
    stamp: FileStamp,
}

#[derive(Default)]
struct Store {
    workbooks: BTreeMap<String, Value>,
    workbook_stamps: BTreeMap<String, FileStamp>,
    /// The script files by workbook and the key of their name
    scripts: BTreeMap<(String, String), File>,
    /// Names that differ only in their case denote the same file, like on macOS
    case_insensitive: bool,
    /// The modification time of the next write
    mtime: u64,
    connections: Option<Vec<Value>>,
    connection_files: BTreeMap<String, String>,
    /// The storage calls that changed something, in order
    calls: Vec<String>,
    /// Scripts changed outside the app, saving one fails until the change is resolved
    externally_changed: bool,
    /// Holds the next deletion of a script until the test releases it
    delete_gate: Option<Receiver<()>>,
    /// Holds the next write of a script until the test releases it
    write_gate: Option<Receiver<()>>,
    /// The deletions of scripts that started
    deleting: Vec<String>,
    /// The status the writer told last
    status: WriterStatus,
    /// Fail the writes, deletions and renames of workbook files and scripts with this error
    failing: Option<String>,
    /// The folders of the workbooks are gone
    unavailable: bool,
    /// Fail the deletion of a workbook
    deletion_fails: bool,
    logs: Vec<(LogLevel, String)>,
}

impl Store {
    fn key(&self, name: &str) -> String {
        if self.case_insensitive {
            name.to_lowercase()
        } else {
            name.to_string()
        }
    }

    fn stamp(&mut self, size: usize) -> FileStamp {
        self.mtime += 1;
        FileStamp { size: size as f64, mtime_ms: self.mtime as f64 }
    }

    fn script_stamp(&self, workbook_id: &str, name: &str) -> Option<FileStamp> {
        self.scripts.get(&(workbook_id.to_string(), self.key(name))).map(|file| file.stamp)
    }

    fn fail(&self) -> Result<(), HostError> {
        if self.unavailable {
            return Err(HostError::unavailable("the workbook folder is missing"));
        }
        match &self.failing {
            Some(error) => Err(HostError::new(error.clone())),
            None => Ok(()),
        }
    }
}

/// Does the stamp on disk match what a write expects?
fn matches(expect: Expect, actual: Option<FileStamp>) -> bool {
    match expect {
        Expect::Any => true,
        Expect::Absent => actual.is_none(),
        Expect::Stamp(stamp) => actual == Some(stamp),
    }
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

    fn settings(&self) -> RuntimeSettings {
        RuntimeSettings::default()
    }
}

impl StorageHost for FakeHost {
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        let workbook = self.store.borrow().workbooks.get(workbook_id).cloned();
        workbook.ok_or_else(|| HostError::new(format!("No workbook {workbook_id}")))
    }

    async fn save_workbook(
        &self,
        workbook_id: &str,
        workbook: &Value,
        expect: Expect,
    ) -> Result<Option<FileStamp>, HostError> {
        let mut store = self.store.borrow_mut();
        store.fail()?;
        if !matches(expect, store.workbook_stamps.get(workbook_id).copied()) {
            return Err(HostError::external_script_change(workbook_id, "dashql-workbook.json"));
        }
        store.calls.push(format!("manifest:{workbook_id}"));
        store.workbooks.insert(workbook_id.to_string(), workbook.clone());
        let stamp = store.stamp(workbook.to_string().len());
        store.workbook_stamps.insert(workbook_id.to_string(), stamp);
        Ok(Some(stamp))
    }

    async fn save_script(
        &self,
        workbook_id: &str,
        file_name: &str,
        text: &str,
        expect: Expect,
    ) -> Result<Option<FileStamp>, HostError> {
        let gate = self.store.borrow_mut().write_gate.take();
        if let Some(gate) = gate {
            gate.await;
        }
        let mut store = self.store.borrow_mut();
        if store.externally_changed {
            return Err(HostError::external_script_change(workbook_id, file_name));
        }
        store.fail()?;
        if !matches(expect, store.script_stamp(workbook_id, file_name)) {
            return Err(HostError::external_script_change(workbook_id, file_name));
        }
        store.calls.push(format!("write:{workbook_id}/{file_name}={text}"));
        let stamp = store.stamp(text.len());
        let key = (workbook_id.to_string(), store.key(file_name));
        store.scripts.insert(key, File { name: file_name.to_string(), text: text.to_string(), stamp });
        Ok(Some(stamp))
    }

    async fn delete_script(&self, workbook_id: &str, file_name: &str, expect: Expect) -> Result<(), HostError> {
        let gate = {
            let mut store = self.store.borrow_mut();
            store.deleting.push(format!("{workbook_id}/{file_name}"));
            store.delete_gate.take()
        };
        if let Some(gate) = gate {
            gate.await;
        }
        let mut store = self.store.borrow_mut();
        store.fail()?;
        if !matches(expect, store.script_stamp(workbook_id, file_name)) {
            return Err(HostError::external_script_change(workbook_id, file_name));
        }
        store.calls.push(format!("delete:{workbook_id}/{file_name}"));
        let key = (workbook_id.to_string(), store.key(file_name));
        store.scripts.remove(&key);
        Ok(())
    }

    async fn rename_script(
        &self,
        workbook_id: &str,
        from: &str,
        to: &str,
        expect_from: Expect,
        expect_to: Expect,
    ) -> Result<(), HostError> {
        let mut store = self.store.borrow_mut();
        store.fail()?;
        if !matches(expect_from, store.script_stamp(workbook_id, from)) {
            return Err(HostError::external_script_change(workbook_id, from));
        }
        if !matches(expect_to, store.script_stamp(workbook_id, to)) {
            return Err(HostError::external_script_change(workbook_id, to));
        }
        store.calls.push(format!("rename:{workbook_id}/{from}->{to}"));
        let from_key = (workbook_id.to_string(), store.key(from));
        if let Some(file) = store.scripts.remove(&from_key) {
            let to_key = (workbook_id.to_string(), store.key(to));
            store.scripts.insert(to_key, File { name: to.to_string(), ..file });
        }
        Ok(())
    }

    async fn list_attachments(&self, _workbook_id: &str) -> Result<Vec<String>, HostError> {
        Ok(Vec::new())
    }

    async fn save_data_file(&self, workbook_id: &str, file_name: &str, file: &HostBytes) -> Result<(), HostError> {
        let content = file.value().downcast_ref::<String>().cloned().unwrap_or_default();
        self.store.borrow_mut().calls.push(format!("data-file:{workbook_id}/{file_name}={content}"));
        Ok(())
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
        if store.deletion_fails {
            return Err(HostError::new("the folder is locked"));
        }
        store.calls.push(format!("delete-workbook:{workbook_id}"));
        store.workbooks.remove(workbook_id);
        Ok(())
    }

    fn status_changed(&self, status: &WriterStatus) {
        self.store.borrow_mut().status = status.clone();
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
        Harness { executor, clock, store, writer: StorageWriter::new(host, Rc::default()) }
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

    /// The name and the text of a script file
    fn script(&self, workbook_id: &str, name: &str) -> Option<(String, String)> {
        let store = self.store.borrow();
        store
            .scripts
            .get(&(workbook_id.to_string(), store.key(name)))
            .map(|file| (file.name.clone(), file.text.clone()))
    }

    /// The text of a script file
    fn text(&self, workbook_id: &str, name: &str) -> Option<String> {
        self.script(workbook_id, name).map(|(_, text)| text)
    }

    /// Edit a script outside the app
    fn edit_outside(&self, workbook_id: &str, name: &str, text: &str) {
        let mut store = self.store.borrow_mut();
        let stamp = store.stamp(text.len());
        let key = (workbook_id.to_string(), store.key(name));
        store.scripts.insert(key, File { name: name.to_string(), text: text.to_string(), stamp });
    }

    /// The stamps of the folder of a workbook as the host lists them
    fn listing(&self, workbook_id: &str) -> FolderListing {
        let store = self.store.borrow();
        FolderListing {
            scripts: store
                .scripts
                .iter()
                .filter(|((id, _), _)| id == workbook_id)
                .map(|(_, file)| NamedStamp { name: file.name.clone(), stamp: file.stamp })
                .collect(),
            attachments: Vec::new(),
            workbook: store.workbook_stamps.get(workbook_id).copied(),
        }
    }

    /// The workbook folder as the app shows it, e.g. after the restore read it
    fn acknowledge(&self, workbook_id: &str) {
        self.writer.stamps().acknowledge(workbook_id, &self.listing(workbook_id));
    }
}

fn written(outcome: &WriteOutcome) -> bool {
    matches!(outcome, WriteOutcome::Written)
}

fn connection(id: &str, endpoint: &str) -> Value {
    json!({ "connectionId": id, "params": { "trino": { "endpoint": endpoint } } })
}

fn copy_of(value: &Value) -> WorkbookConnection {
    WorkbookConnection::from_json(value).expect("a copy of a connection")
}

fn copy(id: &str, endpoint: &str) -> WorkbookConnection {
    copy_of(&connection(id, endpoint))
}

fn scripts_of(value: &Value) -> Vec<WorkbookScript> {
    value
        .as_array()
        .map(|list| {
            list.iter()
                .map(|s| {
                    WorkbookScript::new(
                        s["name"].as_str().unwrap_or_default(),
                        s["connectionId"].as_str().unwrap_or_default(),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
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
    WriteTask::WriteWorkbookProperties {
        workbook_id: WORKBOOK.to_string(),
        name: Some(name.to_string()),
        ephemeral: false,
        cloud: None,
    }
}

fn creation(workbook_id: &str, ephemeral: bool) -> WriteTask {
    WriteTask::CreateWorkbook {
        workbook_id: workbook_id.to_string(),
        name: None,
        connection: Some(copy_of(&test_workbook()["connections"][0])),
        ephemeral,
        original_file_name: Some(String::new()),
    }
}

fn patch(workbook_id: &str, endpoint: &str) -> WriteTask {
    WriteTask::PatchWorkbookConnection {
        workbook_id: workbook_id.to_string(),
        copy: copy(CONNECTION, endpoint),
        replaced: Vec::new(),
    }
}

fn write_script(workbook_id: &str, file_name: &str, text: &str) -> WriteTask {
    WriteTask::WriteScript {
        workbook_id: workbook_id.to_string(),
        file_name: file_name.to_string(),
        text: text.to_string(),
    }
}

fn delete_script(file_name: &str) -> WriteTask {
    WriteTask::DeleteScript { workbook_id: WORKBOOK.to_string(), file_name: file_name.to_string() }
}

fn rename_script(from: &str, to: &str) -> WriteTask {
    WriteTask::RenameScript { workbook_id: WORKBOOK.to_string(), from: from.to_string(), to: to.to_string() }
}

fn script_list(names: &[&str], connections: Vec<WorkbookConnection>) -> WriteTask {
    WriteTask::WriteWorkbookScripts {
        workbook_id: WORKBOOK.to_string(),
        scripts: names.iter().map(|name| WorkbookScript::new(*name, CONNECTION)).collect(),
        connections,
    }
}

/// Schedule a task under its own key
fn schedule(h: &Harness, task: WriteTask, debounce_ms: f64) -> Started<WriteOutcome> {
    h.start(h.writer.write(task, debounce_ms))
}

// Debouncing

#[test]
fn debounces_writes_and_keeps_the_timer_of_the_first_one() {
    let h = Harness::new();
    let first = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "1"), 100.0));
    h.advance(60);
    let second = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "2"), 100.0));
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
    let result = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "1"), 100.0));
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
    h.writer.hold(Some(WORKBOOK), HoldReason::Pause);
    let held = h.start(h.writer.write(write_script(WORKBOOK, "b.sql", "1"), 10.0));
    let other = h.start(h.writer.write(write_script(OTHER, "c.sql", "1"), 10.0));
    h.advance(100);
    assert!(!held.done());
    assert!(written(&other.take()));
    assert!(h.writer.is_workbook_held(WORKBOOK));
    h.writer.release(Some(WORKBOOK), HoldReason::Pause);
    assert!(!h.writer.is_workbook_held(WORKBOOK));
    h.advance(10);
    assert!(written(&held.take()));
}

#[test]
fn a_handover_writes_the_pending_writes_and_then_nothing() {
    let h = Harness::new();
    let pending = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "1"), 100.0));
    h.block_on(h.writer.hand_over());
    assert!(written(&pending.take()));
    assert_eq!(h.calls(), [format!("write:{WORKBOOK}/a.sql=1")]);
    // The tab that handed over writes nothing, not even when it flushes
    let later = h.start(h.writer.write(write_script(WORKBOOK, "b.sql", "1"), 10.0));
    h.advance(1000);
    h.flush();
    assert!(!later.done());
    assert!(h.writer.is_workbook_held(WORKBOOK));
    // The pause of the handover is released, only the handover holds the writer
    h.writer.release(None, HoldReason::Handover);
    h.advance(10);
    assert!(written(&later.take()));
}

// Coalescing and ordering

#[test]
fn retains_rename_and_connection_copy_in_separate_debounced_tasks() {
    for name_first in [true, false] {
        let h = Harness::new();
        h.set_workbook(WORKBOOK, json!({ "formatVersion": FORMAT_VERSION, "workbookId": WORKBOOK, "connections": [connection(CONNECTION, "committed")], "scripts": [], "attachments": [], "metadata": {} }));
        for endpoint in ["saved", "saved again"] {
            let name = format!("renamed before {endpoint}");
            let rename = || h.start(h.writer.write(properties(&name), 10_000.0));
            let copy = || h.start(h.writer.write(patch(WORKBOOK, endpoint), 10_000.0));
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
    let rename = schedule(&h, rename_script("01_old.sql", "01_new.sql"), 10_000.0);
    let write = schedule(&h, write_script(WORKBOOK, "01_new.sql", "new"), 10_000.0);
    let delete = schedule(&h, delete_script("02_unused.sql"), 10_000.0);
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
fn writes_a_script_after_a_delete_and_a_rename_onto_its_file() {
    let h = Harness::new();
    h.edit_outside(WORKBOOK, "r.sql", "renamed");
    // Within the debounce duration: type in q.sql, delete it, rename r.sql to q.sql, type in the renamed q.sql
    let first = schedule(&h, write_script(WORKBOOK, "q.sql", "typed"), 100.0);
    h.advance(10);
    let delete = schedule(&h, delete_script("q.sql"), 100.0);
    h.advance(10);
    let rename = schedule(&h, rename_script("r.sql", "q.sql"), 100.0);
    h.advance(10);
    let last = schedule(&h, write_script(WORKBOOK, "q.sql", "renamed and typed"), 100.0);
    h.advance(200);
    // The first write keeps its place before the tasks of its file, the newer one queues behind them
    assert!([first, delete, rename, last].iter().all(|task| written(&task.take())));
    assert_eq!(
        h.calls(),
        [
            format!("write:{WORKBOOK}/q.sql=typed"),
            format!("delete:{WORKBOOK}/q.sql"),
            format!("rename:{WORKBOOK}/r.sql->q.sql"),
            format!("write:{WORKBOOK}/q.sql=renamed and typed"),
        ]
    );
    assert_eq!(h.text(WORKBOOK, "q.sql").as_deref(), Some("renamed and typed"));
    // Without a task in between the newer write keeps the timer of the first one
    let h = Harness::new();
    schedule(&h, write_script(WORKBOOK, "q.sql", "1"), 100.0);
    h.start(h.writer.write(script_list(&["q.sql"], Vec::new()), 100.0));
    h.advance(60);
    schedule(&h, write_script(WORKBOOK, "q.sql", "2"), 100.0);
    h.advance(40);
    assert!(h.calls().first().is_some_and(|call| *call == format!("write:{WORKBOOK}/q.sql=2")));
}

#[test]
fn keeps_the_text_of_a_script_that_was_renamed_before_its_first_write() {
    let h = Harness::new();
    // A new script a.sql is renamed to b.sql, then a new a.sql is created, all within the debounce duration
    schedule(&h, write_script(WORKBOOK, "a.sql", "first"), 100.0);
    schedule(&h, rename_script("a.sql", "b.sql"), 100.0);
    schedule(&h, write_script(WORKBOOK, "a.sql", "second"), 100.0);
    h.advance(200);
    assert_eq!(h.text(WORKBOOK, "b.sql").as_deref(), Some("first"));
    assert_eq!(h.text(WORKBOOK, "a.sql").as_deref(), Some("second"));
}

#[test]
fn does_not_overlap_mutations_of_the_same_workbook() {
    let h = Harness::new();
    let (release, gate): (Sender<()>, Receiver<()>) = oneshot();
    h.store.borrow_mut().delete_gate = Some(gate);
    let deletion = schedule(&h, delete_script("02_old.sql"), 0.0);
    h.advance(0);
    assert_eq!(h.store.borrow().deleting.len(), 1);
    let write = h.start(h.writer.write(write_script(WORKBOOK, "03_new.sql", "SELECT 3"), 10_000.0));
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
    assert_eq!(
        chain_key(&format!("@connections/{CONNECTION}/dashql-catalog-relations.sql")),
        format!("@connections/{CONNECTION}")
    );
}

// The order of the tasks of a file when a task fails

#[test]
fn a_retried_deletion_never_removes_a_newer_script_of_the_same_name() {
    let h = Harness::new();
    h.edit_outside(WORKBOOK, "a.sql", "old");
    h.store.borrow_mut().failing = Some("locked".to_string());
    schedule(&h, delete_script("a.sql"), 0.0);
    h.advance(0);
    assert_eq!(h.store.borrow().status.failed.len(), 1);
    // A new script takes the name, its write waits for the deletion
    let write = schedule(&h, write_script(WORKBOOK, "a.sql", "new"), 100.0);
    h.store.borrow_mut().failing = None;
    h.advance(200);
    assert!(!write.done(), "the write waits for the retry of the deletion");
    h.advance(1000);
    assert!(written(&write.take()));
    assert_eq!(h.calls(), [format!("delete:{WORKBOOK}/a.sql"), format!("write:{WORKBOOK}/a.sql=new")]);
    assert_eq!(h.text(WORKBOOK, "a.sql").as_deref(), Some("new"));
    assert!(h.store.borrow().status.failed.is_empty());
}

#[test]
fn a_retried_rename_never_overwrites_a_newer_write_of_its_target() {
    let h = Harness::new();
    h.edit_outside(WORKBOOK, "a.sql", "renamed");
    h.store.borrow_mut().failing = Some("locked".to_string());
    schedule(&h, rename_script("a.sql", "b.sql"), 0.0);
    h.advance(0);
    // The renamed script is edited
    schedule(&h, write_script(WORKBOOK, "b.sql", "edited"), 100.0);
    h.store.borrow_mut().failing = None;
    h.advance(2000);
    assert_eq!(h.calls(), [format!("rename:{WORKBOOK}/a.sql->b.sql"), format!("write:{WORKBOOK}/b.sql=edited")]);
    assert_eq!(h.text(WORKBOOK, "b.sql").as_deref(), Some("edited"));
    assert_eq!(h.text(WORKBOOK, "a.sql"), None);
}

#[test]
fn a_retried_write_never_brings_back_a_deleted_script() {
    let h = Harness::new();
    h.store.borrow_mut().failing = Some("disk full".to_string());
    schedule(&h, write_script(WORKBOOK, "a.sql", "x"), 0.0);
    h.advance(0);
    let deletion = schedule(&h, delete_script("a.sql"), 100.0);
    h.store.borrow_mut().failing = None;
    h.advance(2000);
    assert!(written(&deletion.take()));
    assert_eq!(h.calls(), [format!("write:{WORKBOOK}/a.sql=x"), format!("delete:{WORKBOOK}/a.sql")]);
    assert_eq!(h.text(WORKBOOK, "a.sql"), None);
}

#[test]
fn a_task_that_joined_its_chain_waits_for_an_earlier_task_of_its_file_that_failed() {
    let h = Harness::new();
    let (release, gate): (Sender<()>, Receiver<()>) = oneshot();
    h.store.borrow_mut().write_gate = Some(gate);
    schedule(&h, write_script(WORKBOOK, "a.sql", "x"), 0.0);
    h.advance(0);
    // The deletion joins the chain while the write runs, then the write fails
    let deletion = schedule(&h, delete_script("a.sql"), 0.0);
    h.advance(0);
    h.store.borrow_mut().failing = Some("disk full".to_string());
    release.send(());
    h.run();
    assert!(!deletion.done());
    assert!(h.calls().is_empty());
    h.store.borrow_mut().failing = None;
    h.advance(1000);
    assert!(written(&deletion.take()));
    assert_eq!(h.calls(), [format!("write:{WORKBOOK}/a.sql=x"), format!("delete:{WORKBOOK}/a.sql")]);
}

// The workbook file

#[test]
fn writes_the_marker_of_an_ephemeral_workbook_and_removes_it_on_promotion() {
    let h = Harness::new();
    let write = |task: WriteTask| {
        schedule(&h, task, 0.0);
        h.flush();
        h.workbook(WORKBOOK)
    };
    let created = write(creation(WORKBOOK, true));
    assert_eq!(created["metadata"]["ephemeral"], json!(true));
    assert_eq!(created["metadata"]["createdAt"], json!("2026-01-01T00:00:00.000Z"));
    assert_eq!(created["formatVersion"], json!(FORMAT_VERSION));
    let keys: Vec<&String> = created.as_object().map(|o| o.keys().collect()).unwrap_or_default();
    assert_eq!(keys, ["formatVersion", "workbookId", "connections", "scripts", "attachments", "metadata"]);

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
fn a_rename_in_the_same_turn_as_the_creation_never_replaces_it() {
    for paused in [false, true] {
        let h = Harness::new();
        if paused {
            h.writer.pause();
        }
        // The creation runs right away, the rename of the same turn is debounced
        let created = schedule(&h, creation(WORKBOOK, true), 0.0);
        let renamed = h.start(h.writer.write(
            WriteTask::WriteWorkbookProperties {
                workbook_id: WORKBOOK.to_string(),
                name: Some("Named".to_string()),
                ephemeral: true,
                cloud: None,
            },
            100.0,
        ));
        if paused {
            h.writer.resume();
        }
        h.advance(200);
        assert!(written(&created.take()) && written(&renamed.take()));
        let workbook = h.workbook(WORKBOOK);
        assert_eq!(workbook["name"], json!("Named"));
        assert_eq!(workbook["metadata"]["ephemeral"], json!(true));
        assert_eq!(workbook["connections"], test_workbook()["connections"]);
    }
}

#[test]
fn writes_and_removes_the_link_to_the_cloud_with_the_properties() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    let cloud = json!({ "workbookId": "c0ffee00-0000-4000-8000-000000000001", "versionId": "c0ffee00-0000-4000-8000-000000000002", "connectionId": "cloud" });
    let write = |cloud: Option<WorkbookCloudLink>| {
        let task = WriteTask::WriteWorkbookProperties {
            workbook_id: WORKBOOK.to_string(),
            name: Some("Published".to_string()),
            ephemeral: false,
            cloud,
        };
        h.start(h.writer.write(task, 0.0));
        h.flush();
        h.workbook(WORKBOOK)
    };
    assert_eq!(write(WorkbookCloudLink::from_json(&cloud))["metadata"]["cloud"], cloud);
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
    let rename = h.start(h.writer.write(properties("renamed"), 10_000.0));
    let list = h.start(h.writer.write(
        WriteTask::WriteWorkbookScripts {
            workbook_id: WORKBOOK.to_string(),
            scripts: scripts_of(&scripts),
            connections: vec![copy_of(&remote)],
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

    // A creation over an existing file keeps the script list and the connections of its scripts, it writes nothing new
    h.clear_calls();
    let created = WriteTask::CreateWorkbook {
        workbook_id: WORKBOOK.to_string(),
        name: None,
        connection: None,
        ephemeral: false,
        original_file_name: None,
    };
    schedule(&h, created, 0.0);
    h.flush();
    assert_eq!(h.workbook(WORKBOOK)["scripts"], scripts);
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([remote, local]));
    assert!(h.calls().is_empty());

    // Once no script uses the remote connection, the workbook drops its copy
    h.start(h.writer.write(script_list(&["a.sql"], Vec::new()), 0.0));
    h.flush();
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([local]));
}

#[test]
fn runs_the_creation_and_the_patches_of_a_workbook_file_in_order() {
    let h = Harness::new();
    // The patches wait for the creation, though they are due first
    let tasks = [
        schedule(&h, creation(WORKBOOK, false), 100.0),
        h.start(h.writer.write(script_list(&["a.sql"], Vec::new()), 0.0)),
        h.start(h.writer.write(properties("renamed"), 0.0)),
        h.start(h.writer.write(script_list(&["b.sql", "a.sql"], Vec::new()), 0.0)),
    ];
    h.advance(0);
    assert!(h.calls().is_empty());
    h.advance(100);
    // The second list queues behind the rename instead of taking the place of the first one
    assert!(tasks.iter().all(|task| written(&task.take())));
    assert_eq!(h.calls().len(), 4);
    let workbook = h.workbook(WORKBOOK);
    assert_eq!(
        workbook["scripts"],
        json!([{ "name": "b.sql", "connectionId": CONNECTION }, { "name": "a.sql", "connectionId": CONNECTION }])
    );
    assert_eq!(workbook["name"], json!("renamed"));
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
        copy: copy(CONNECTION, "new"),
        replaced: vec![REMOTE.to_string()],
    };
    assert!(written(&h.block_on(h.writer.write_durable(task))));
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([connection(CONNECTION, "new")]));
    assert_eq!(h.workbook(WORKBOOK)["scripts"], json!([{ "name": "a.sql", "connectionId": CONNECTION }]));
    // An up-to-date copy is not written again
    h.block_on(h.writer.write_durable(patch(WORKBOOK, "new")));
    assert_eq!(h.calls(), [format!("manifest:{WORKBOOK}")]);
}

// Failed writes

#[test]
fn stops_retrying_a_write_whose_workbook_is_unavailable_and_never_recreates_it() {
    let h = Harness::new();
    let key = connection_copy_key(WORKBOOK, CONNECTION);
    let outcome = h.block_on(h.writer.write_durable(patch(WORKBOOK, "x")));
    match outcome {
        WriteOutcome::Failed(WriteError::WorkbookUnavailable { workbook_id, .. }) => assert_eq!(workbook_id, WORKBOOK),
        other => panic!("unexpected outcome {other:?}"),
    }
    assert!(h.store.borrow().workbooks.is_empty());
    // The write stops: no retry, an error in the log once, a permanent failure in the status
    assert_eq!(h.timers(), 0);
    let status = h.store.borrow().status.clone();
    assert_eq!((status.failed.len(), status.failed[0].permanent), (1, true));
    h.advance(120_000);
    assert_eq!(h.store.borrow().status.failed[0].attempts, 1);
    let errors = h.store.borrow().logs.iter().filter(|(level, _)| *level == LogLevel::Error).count();
    assert_eq!(errors, 1);
    // A flush leaves it alone, the workbook can't be flushed while it fails
    h.flush();
    assert!(!h.block_on(h.writer.flush_workbook(WORKBOOK)));
    assert_eq!(h.store.borrow().status.failed[0].attempts, 1);

    // The host discards it
    h.writer.cancel_pending_writes(&[key]);
    assert!(h.store.borrow().status.failed.is_empty());
    assert!(h.writer.pending_keys().is_empty());
    assert!(h.block_on(h.writer.flush_workbook(WORKBOOK)));
}

#[test]
fn a_newer_write_retries_a_stopped_one() {
    let h = Harness::new();
    h.store.borrow_mut().unavailable = true;
    schedule(&h, write_script(WORKBOOK, "a.sql", "1"), 0.0);
    h.advance(0);
    let status = h.store.borrow().status.clone();
    assert!(status.failed[0].permanent);
    assert_eq!(h.timers(), 0);
    // The folder is back, the next edit writes
    h.store.borrow_mut().unavailable = false;
    let newer = schedule(&h, write_script(WORKBOOK, "a.sql", "2"), 100.0);
    h.advance(100);
    assert!(written(&newer.take()));
    assert_eq!(h.text(WORKBOOK, "a.sql").as_deref(), Some("2"));
    assert!(h.store.borrow().status.failed.is_empty());
}

#[test]
fn keeps_a_failed_write_pending_and_retries_it_with_a_backoff() {
    let h = Harness::new();
    h.store.borrow_mut().failing = Some("disk full".to_string());
    let key = script_key(WORKBOOK, "a.sql");
    let first = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "1"), 0.0));
    h.advance(0);
    assert!(matches!(first.take(), WriteOutcome::Failed(_)));
    let status = h.store.borrow().status.clone();
    assert_eq!(status.failed.len(), 1);
    assert_eq!(
        (status.failed[0].key.as_str(), status.failed[0].workbook_id.as_deref(), status.failed[0].attempts),
        (key.as_str(), Some(WORKBOOK), 1)
    );
    assert_eq!(status.failed[0].error, "disk full");
    assert!(!status.failed[0].permanent);
    assert_eq!(h.writer.pending_keys(), [key.clone()]);
    // The next attempt runs after a second, the one after it two seconds later
    h.advance(999);
    assert_eq!(h.store.borrow().status.failed[0].attempts, 1);
    h.advance(1);
    assert_eq!(h.store.borrow().status.failed[0].attempts, 2);
    h.store.borrow_mut().failing = None;
    h.advance(1999);
    assert!(h.calls().is_empty());
    h.advance(1);
    assert_eq!(h.calls(), [format!("write:{WORKBOOK}/a.sql=1")]);
    assert!(h.store.borrow().status.failed.is_empty());
    assert!(h.writer.pending_keys().is_empty());
    assert_eq!(h.timers(), 0);
    // A failure that passes is a warning
    assert!(!h.store.borrow().logs.iter().any(|(level, _)| *level == LogLevel::Error));
}

#[test]
fn keeps_a_failed_write_pending_for_the_next_flush() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    h.store.borrow_mut().failing = Some("disk full".to_string());
    let key = connection_copy_key(WORKBOOK, CONNECTION);
    let failed = h.start(h.writer.write(patch(WORKBOOK, "retried"), 10_000.0));
    let result = h.start(h.writer.flush_workbook(WORKBOOK));
    h.run();
    assert!(!result.take());
    assert!(matches!(failed.take(), WriteOutcome::Failed(_)));
    assert_eq!(h.writer.pending_keys_for_workbook(WORKBOOK), [key.clone()]);
    // The retry waits for its backoff
    assert_eq!(h.timers(), 1);

    h.store.borrow_mut().failing = None;
    let result = h.start(h.writer.flush_workbook(WORKBOOK));
    h.run();
    assert!(result.take());
    assert!(h.writer.pending_keys_for_workbook(WORKBOOK).is_empty());
    assert_eq!(h.workbook(WORKBOOK)["connections"], json!([connection(CONNECTION, "retried")]));
    assert_eq!(h.timers(), 0, "the flush cleared the timer of the retry");
}

#[test]
fn a_newer_write_replaces_a_failed_one_and_a_cancelled_one_no_longer_fails() {
    let h = Harness::new();
    h.store.borrow_mut().failing = Some("offline".to_string());
    h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "1"), 0.0));
    h.advance(0);
    h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "2"), 0.0));
    let flushed = h.start(h.writer.flush_workbook(WORKBOOK));
    h.run();
    assert!(!flushed.take(), "a workbook with a failed write is not flushed");
    h.store.borrow_mut().failing = None;
    let flushed = h.start(h.writer.flush_workbook(WORKBOOK));
    h.run();
    assert!(flushed.take());
    assert_eq!(h.calls(), [format!("write:{WORKBOOK}/a.sql=2")]);

    h.store.borrow_mut().failing = Some("offline".to_string());
    h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "3"), 0.0));
    h.advance(0);
    assert_eq!(h.store.borrow().status.failed.len(), 1);
    h.writer.cancel_pending_writes_for_workbook(WORKBOOK);
    h.run();
    assert!(h.store.borrow().status.failed.is_empty());
    assert_eq!(h.timers(), 0);
}

// Attachments

#[test]
fn writes_an_attachment_once_its_workbook_is_released() {
    let h = Harness::new();
    let file = |content: &str| WriteTask::SaveDataFile {
        workbook_id: WORKBOOK.to_string(),
        file_name: "sales.parquet".to_string(),
        file: HostBytes::new(Rc::new(content.to_string()), content.len()),
    };
    let task = file("rows");
    let key = task.key();
    assert_eq!(key, format!("{WORKBOOK}/attachments/sales.parquet"));
    // An import holds the workbook, the attachment waits for it like the scripts do
    h.writer.hold(Some(WORKBOOK), HoldReason::Import);
    assert!(matches!(h.block_on(h.writer.write_durable(task)), WriteOutcome::Deferred));
    assert!(!h.store.borrow().calls.iter().any(|call| call.starts_with("data-file:")));
    h.writer.release(Some(WORKBOOK), HoldReason::Import);
    h.flush();
    assert!(written(&h.block_on(h.writer.write_durable(file("more rows")))));
    let calls: Vec<String> =
        h.store.borrow().calls.iter().filter(|call| call.starts_with("data-file:")).cloned().collect();
    assert_eq!(
        calls,
        [format!("data-file:{WORKBOOK}/sales.parquet=rows"), format!("data-file:{WORKBOOK}/sales.parquet=more rows")]
    );
}

#[test]
fn a_write_past_the_hold_of_its_caller_runs_while_the_others_wait() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    h.writer.hold(Some(WORKBOOK), HoldReason::Import);
    let held = h.start(h.writer.write(properties("stale"), 0.0));
    let list = script_list(&["a.sql"], Vec::new());
    assert!(written(&h.block_on(h.writer.write_past(list, HoldReason::Import))));
    assert_eq!(h.workbook(WORKBOOK)["scripts"], json!([{ "name": "a.sql", "connectionId": CONNECTION }]));
    h.advance(1000);
    assert!(!held.done());
    // Another hold keeps it as well
    h.writer.hold(Some(WORKBOOK), HoldReason::Reload);
    let list = script_list(&["b.sql"], Vec::new());
    assert!(matches!(h.block_on(h.writer.write_past(list, HoldReason::Import)), WriteOutcome::Deferred));
}

// Connections

#[test]
fn writes_connection_entries_durably_and_defers_while_paused() {
    let h = Harness::new();
    let entry = |endpoint: &str| WriteTask::WriteConnectionEntry {
        entry: json!({ "id": CONNECTION, "params": { "trino": { "endpoint": endpoint } } }),
    };
    let debounced = h.start(h.writer.write(entry("draft"), 10_000.0));
    assert!(written(&h.block_on(h.writer.write_durable(entry("saved")))));
    assert!(matches!(debounced.take(), WriteOutcome::Superseded));
    assert_eq!(
        h.store.borrow().connections,
        Some(vec![json!({ "id": CONNECTION, "params": { "trino": { "endpoint": "saved" } } })])
    );

    h.writer.pause();
    assert!(matches!(h.block_on(h.writer.write_durable(entry("paused"))), WriteOutcome::Deferred));
    assert_eq!(
        h.store.borrow().connections,
        Some(vec![json!({ "id": CONNECTION, "params": { "trino": { "endpoint": "saved" } } })])
    );
    h.writer.resume();
    h.flush();
    assert_eq!(
        h.store.borrow().connections,
        Some(vec![json!({ "id": CONNECTION, "params": { "trino": { "endpoint": "paused" } } })])
    );
}

#[test]
fn keeps_the_creation_time_of_connection_entries_and_deletes_them() {
    let h = Harness::new();
    h.store.borrow_mut().connections =
        Some(vec![json!({ "id": CONNECTION, "params": { "a": 1 }, "createdAt": "2026-01-01T00:00:00.000Z" })]);
    h.store.borrow_mut().connection_files.insert(format!("{CONNECTION}/catalog.sql"), "x".to_string());
    h.block_on(
        h.writer.write_durable(WriteTask::WriteConnectionEntry {
            entry: json!({ "id": CONNECTION, "params": { "a": 2 } }),
        }),
    );
    assert_eq!(
        h.store.borrow().connections,
        Some(vec![json!({ "id": CONNECTION, "params": { "a": 2 }, "createdAt": "2026-01-01T00:00:00.000Z" })])
    );
    h.block_on(h.writer.write_durable(WriteTask::DeleteConnectionEntry { connection_id: CONNECTION.to_string() }));
    assert_eq!(h.store.borrow().connections, Some(Vec::new()));
    assert!(h.store.borrow().connection_files.is_empty());
}

#[test]
fn reads_connection_files_when_they_are_written_and_cancels_them_with_the_connection() {
    let h = Harness::new();
    let reads = Rc::new(Cell::new(0));
    let file = |text: Option<&'static str>| {
        let reads = reads.clone();
        WriteTask::WriteConnectionFile {
            connection_id: CONNECTION.to_string(),
            file_name: "catalog.sql".to_string(),
            text: TextSource::Read(Box::new(move || {
                reads.set(reads.get() + 1);
                Ok(text.map(str::to_string))
            })),
        }
    };
    // Nothing to write anymore
    assert!(written(&h.block_on(h.writer.write(file(None), 0.0))));
    assert!(h.calls().is_empty());
    let cancelled = h.start(h.writer.write(file(Some("select 1")), 1000.0));
    h.writer.cancel_pending_connection_file_writes(CONNECTION);
    h.flush();
    assert!(matches!(cancelled.take(), WriteOutcome::Cancelled));
    // The text is read when the write runs
    assert_eq!(reads.get(), 1);
    assert!(written(&h.block_on(h.writer.write(file(Some("select 2")), 0.0))));
    assert_eq!(
        h.store.borrow().connection_files.get(&format!("{CONNECTION}/catalog.sql")).cloned(),
        Some("select 2".to_string())
    );
}

// Deleted workbooks

#[test]
fn drops_pending_and_later_writes_of_a_deleted_workbook_until_it_is_revived() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    let pending = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "select 1"), 1000.0));
    assert!(h.block_on(h.writer.delete_workbook(WORKBOOK)).is_ok());
    assert!(matches!(pending.take(), WriteOutcome::Cancelled));
    let later = h.block_on(h.writer.write(write_script(WORKBOOK, "b.sql", "select 2"), 0.0));
    assert!(matches!(later, WriteOutcome::Cancelled));
    h.flush();
    assert!(h.store.borrow().workbooks.is_empty());
    assert!(!h.calls().iter().any(|call| call.starts_with("write:")));

    // An import of the same bundle registers the id again
    h.writer.revive_workbook(WORKBOOK);
    assert!(written(&h.block_on(h.writer.write(write_script(WORKBOOK, "a.sql", "select 1"), 0.0))));
    assert!(h.calls().contains(&format!("write:{WORKBOOK}/a.sql=select 1")));
}

#[test]
fn a_write_that_runs_while_its_workbook_is_deleted_neither_holds_nor_returns() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    let (release, gate): (Sender<()>, Receiver<()>) = oneshot();
    h.store.borrow_mut().write_gate = Some(gate);
    let running = schedule(&h, write_script(WORKBOOK, "a.sql", "x"), 0.0);
    h.advance(0);
    let deletion = h.start(h.writer.delete_workbook(WORKBOOK));
    h.run();
    // The write finds a change outside the app after the deletion started
    h.store.borrow_mut().externally_changed = true;
    release.send(());
    h.run();
    assert!(matches!(running.take(), WriteOutcome::Cancelled));
    assert!(deletion.take().is_ok());
    assert!(h.store.borrow().status.holds.is_empty());
    assert!(h.writer.pending_keys().is_empty());
}

#[test]
fn a_failed_deletion_of_a_workbook_leaves_no_failed_write_behind() {
    let h = Harness::new();
    h.store.borrow_mut().deletion_fails = true;
    let (release, gate): (Sender<()>, Receiver<()>) = oneshot();
    h.store.borrow_mut().write_gate = Some(gate);
    schedule(&h, write_script(WORKBOOK, "a.sql", "x"), 0.0);
    h.advance(0);
    let deletion = h.start(h.writer.delete_workbook(WORKBOOK));
    h.run();
    h.store.borrow_mut().failing = Some("disk full".to_string());
    release.send(());
    h.run();
    assert!(deletion.take().is_err());
    assert!(h.store.borrow().status.failed.is_empty());
    h.store.borrow_mut().failing = None;
    assert!(h.block_on(h.writer.flush_workbook(WORKBOOK)));
}

#[test]
fn forgets_the_keys_holds_and_stamps_of_a_deleted_workbook() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    h.block_on(h.writer.write(write_script(WORKBOOK, "a.sql", "1"), 0.0));
    h.block_on(h.writer.write(write_script(OTHER, "a.sql", "1"), 0.0));
    h.acknowledge(WORKBOOK);
    h.writer.hold(Some(WORKBOOK), HoldReason::ExternalChange);
    assert_eq!(h.writer.statistics().len(), 2);
    assert!(h.block_on(h.writer.delete_workbook(WORKBOOK)).is_ok());
    assert_eq!(
        h.writer.statistics().iter().map(|(key, _)| key.clone()).collect::<Vec<_>>(),
        [script_key(OTHER, "a.sql")]
    );
    assert!(h.writer.write_generations_for_workbook(WORKBOOK).is_empty());
    assert!(h.writer.workbook_holds(WORKBOOK).is_empty());
    assert!(!h.writer.stamps().is_acknowledged(WORKBOOK));
}

// Flushing a workbook

#[test]
fn flushes_the_pending_tasks_of_a_workbook_and_leaves_the_others_pending() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    h.set_workbook(OTHER, test_workbook());
    let flushed = h.start(h.writer.write(patch(WORKBOOK, "flushed"), 10_000.0));
    h.start(h.writer.write(patch(OTHER, "pending"), 10_000.0));
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
    h.start(h.writer.write(patch(WORKBOOK, "held"), 10_000.0));
    h.writer.hold(Some(WORKBOOK), HoldReason::Reload);
    assert!(!h.block_on(h.writer.flush_workbook(WORKBOOK)));
    assert_eq!(h.writer.pending_keys_for_workbook(WORKBOOK).len(), 1);
    assert_eq!(h.workbook(WORKBOOK), test_workbook());
    h.writer.release(Some(WORKBOOK), HoldReason::Reload);
    assert!(h.block_on(h.writer.flush_workbook(WORKBOOK)));
}

// External changes and stamps

#[test]
fn holds_a_write_that_would_overwrite_an_external_change_until_the_workbook_resumes() {
    let h = Harness::new();
    h.set_workbook(OTHER, test_workbook());
    h.store.borrow_mut().externally_changed = true;
    let key = script_key(WORKBOOK, "a.sql");
    let pending = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "select 1"), 0.0));
    h.advance(10);
    h.block_on(h.writer.settle());
    assert_eq!(h.store.borrow().status.externally_changed().collect::<Vec<_>>(), [WORKBOOK]);
    assert!(!pending.done());
    assert_eq!(h.writer.pending_keys_for_workbook(WORKBOOK), [key]);
    assert!(h.writer.is_workbook_held(WORKBOOK));

    // Other workbooks keep writing while the workbook is held
    let other = WriteTask::WriteWorkbookProperties {
        workbook_id: OTHER.to_string(),
        name: Some("x".to_string()),
        ephemeral: false,
        cloud: None,
    };
    assert!(written(&h.block_on(h.writer.write_durable(other))));

    h.store.borrow_mut().externally_changed = false;
    h.writer.release_all(Some(WORKBOOK), HoldReason::ExternalChange);
    assert!(h.store.borrow().status.holds.is_empty());
    h.advance(0);
    assert!(written(&pending.take()));
    assert_eq!(h.text(WORKBOOK, "a.sql").as_deref(), Some("select 1"));
}

#[test]
fn lets_a_newer_write_of_the_same_script_supersede_a_held_one() {
    let h = Harness::new();
    h.store.borrow_mut().externally_changed = true;
    let held = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "select 1"), 0.0));
    h.advance(10);
    let newer = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "select 2"), 0.0));
    h.run();
    assert!(matches!(held.take(), WriteOutcome::Superseded));
    h.writer.cancel_pending_writes_for_workbook(WORKBOOK);
    h.run();
    assert!(matches!(newer.take(), WriteOutcome::Cancelled));
    assert!(!h.calls().iter().any(|call| call.starts_with("write:")));
}

#[test]
fn checks_the_writes_of_an_acknowledged_folder_against_its_stamps() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    h.edit_outside(WORKBOOK, "a.sql", "on disk");
    // Before the folder is acknowledged, a write is not checked
    h.block_on(h.writer.write_durable(write_script(WORKBOOK, "a.sql", "app")));
    h.acknowledge(WORKBOOK);
    // The writes of the app are no changes outside the app
    h.block_on(h.writer.write_durable(write_script(WORKBOOK, "a.sql", "app 2")));
    h.block_on(h.writer.write_durable(properties("renamed")));
    assert!(h.writer.stamps().changes(WORKBOOK, &h.listing(WORKBOOK), "dashql-workbook.json").is_empty());
    // An edit outside the app holds the next write of the script, a new file is no script of the app
    h.edit_outside(WORKBOOK, "a.sql", "edited outside");
    h.edit_outside(WORKBOOK, "b.sql", "added outside");
    assert_eq!(h.writer.stamps().changes(WORKBOOK, &h.listing(WORKBOOK), "dashql-workbook.json"), ["a.sql", "b.sql"]);
    schedule(&h, write_script(WORKBOOK, "a.sql", "app 3"), 0.0);
    schedule(&h, write_script(WORKBOOK, "b.sql", "app b"), 0.0);
    h.advance(0);
    assert_eq!(h.writer.workbook_holds(WORKBOOK), [HoldReason::ExternalChange]);
    assert_eq!(h.text(WORKBOOK, "a.sql").as_deref(), Some("edited outside"));
    assert_eq!(h.text(WORKBOOK, "b.sql").as_deref(), Some("added outside"));
    // Keeping the app version acknowledges the disk, the held writes run
    h.acknowledge(WORKBOOK);
    h.writer.release_all(Some(WORKBOOK), HoldReason::ExternalChange);
    h.advance(200);
    assert_eq!(h.text(WORKBOOK, "a.sql").as_deref(), Some("app 3"));
    assert_eq!(h.text(WORKBOOK, "b.sql").as_deref(), Some("app b"));
}

#[test]
fn renames_a_script_to_another_case_of_its_name_on_a_case_insensitive_folder() {
    let h = Harness::new();
    h.store.borrow_mut().case_insensitive = true;
    h.edit_outside(WORKBOOK, "Query.sql", "select 1");
    h.acknowledge(WORKBOOK);
    let renamed = h.block_on(h.writer.write_durable(rename_script("Query.sql", "query.sql")));
    assert!(written(&renamed));
    assert!(h.store.borrow().status.holds.is_empty());
    assert_eq!(h.script(WORKBOOK, "query.sql"), Some(("query.sql".to_string(), "select 1".to_string())));
    // The renamed file keeps its stamp, it is no change outside the app
    assert!(h.writer.stamps().changes(WORKBOOK, &h.listing(WORKBOOK), "dashql-workbook.json").is_empty());
    assert!(written(&h.block_on(h.writer.write_durable(write_script(WORKBOOK, "query.sql", "select 2")))));
}

#[test]
fn keeps_a_held_script_as_a_recovery_copy_next_to_it() {
    let h = Harness::new();
    h.edit_outside(WORKBOOK, "a.sql", "on disk");
    h.acknowledge(WORKBOOK);
    h.edit_outside(WORKBOOK, "a.sql", "edited outside");
    h.edit_outside(WORKBOOK, "a (recovered).sql", "an older copy");
    schedule(&h, write_script(WORKBOOK, "a.sql", "edited in the app"), 0.0);
    h.advance(0);
    assert_eq!(h.writer.workbook_holds(WORKBOOK), [HoldReason::ExternalChange]);
    // The window closes while the question is open
    h.flush();
    h.block_on(h.writer.recover_held_scripts());
    assert_eq!(h.text(WORKBOOK, "a.sql").as_deref(), Some("edited outside"));
    assert_eq!(h.text(WORKBOOK, "a (recovered).sql").as_deref(), Some("an older copy"));
    assert_eq!(h.text(WORKBOOK, "a (recovered 2).sql").as_deref(), Some("edited in the app"));
    assert_eq!(h.writer.pending_keys_for_workbook(WORKBOOK), [script_key(WORKBOOK, "a.sql")]);
}

// Statistics and generations

#[test]
fn counts_scheduled_and_performed_writes() {
    let h = Harness::new();
    let key = script_key(WORKBOOK, "a.sql");
    h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "1"), 100.0));
    h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "12"), 100.0));
    h.advance(10);
    h.advance(100);
    let statistics = h.writer.statistics();
    assert_eq!(statistics.len(), 1);
    let (written, stats) = &statistics[0];
    assert_eq!(written, &key);
    assert_eq!((stats.scheduled_writes, stats.writes, stats.written_bytes), (2, 1, 2));
    assert_eq!(stats.last_write_ms, Some(1_767_225_600_100.0));
    let generations = h.writer.write_generations_for_workbook(WORKBOOK);
    assert_eq!(generations, [(key, 2)]);
}

// Holds with reasons

#[test]
fn a_forced_flush_writes_past_the_pause_of_the_writer_but_never_past_a_held_workbook() {
    let h = Harness::new();
    h.set_workbook(WORKBOOK, test_workbook());
    h.set_workbook(OTHER, test_workbook());
    // A question about a change outside the app is open, then the writer pauses
    h.writer.hold(Some(WORKBOOK), HoldReason::ExternalChange);
    h.writer.pause();
    let held = h.start(h.writer.write(properties("overwrites the disk"), 10_000.0));
    let other = h.start(h.writer.write(write_script(OTHER, "a.sql", "1"), 10_000.0));
    // The page hides
    h.flush();
    assert!(written(&other.take()));
    assert!(!held.done());
    assert_eq!(
        h.workbook(WORKBOOK),
        test_workbook(),
        "the workbook file that changed outside the app is not overwritten"
    );
    assert_eq!(h.writer.pending_keys(), [manifest_key(WORKBOOK)]);
    // The pause of the writer stays after the flush
    let later = h.start(h.writer.write(write_script(OTHER, "b.sql", "2"), 10.0));
    h.advance(100);
    assert!(!later.done());
    h.writer.resume();
    h.advance(10);
    assert!(written(&later.take()));
    assert!(!held.done());
}

#[test]
fn a_flush_never_writes_past_the_handover_to_another_tab() {
    let h = Harness::new();
    let pending = schedule(&h, write_script(OTHER, "a.sql", "stale"), 10_000.0);
    // Another tab took over, then the page hides
    h.writer.hold(None, HoldReason::Handover);
    h.flush();
    assert!(!pending.done());
    assert!(h.calls().is_empty());
}

#[test]
fn counts_nested_holds_and_releases_them_one_by_one() {
    let h = Harness::new();
    h.writer.hold(Some(WORKBOOK), HoldReason::Reload);
    h.writer.hold(Some(WORKBOOK), HoldReason::Reload);
    h.writer.hold(Some(WORKBOOK), HoldReason::Import);
    let pending = h.start(h.writer.write(write_script(WORKBOOK, "a.sql", "1"), 10.0));
    h.writer.release(Some(WORKBOOK), HoldReason::Reload);
    h.advance(100);
    assert!(!pending.done());
    assert_eq!(h.writer.workbook_holds(WORKBOOK), [HoldReason::Reload, HoldReason::Import]);
    h.writer.release(Some(WORKBOOK), HoldReason::Reload);
    // A release of a hold that the workbook doesn't have changes nothing, e.g. a check that didn't take one
    h.writer.release(Some(WORKBOOK), HoldReason::ExternalChange);
    h.advance(100);
    assert!(!pending.done());
    assert_eq!(h.store.borrow().status.holds.len(), 1);
    h.writer.release(Some(WORKBOOK), HoldReason::Import);
    assert!(h.store.borrow().status.holds.is_empty());
    h.advance(9);
    assert!(!pending.done(), "the released task waits for its debounce duration again");
    h.advance(1);
    assert!(written(&pending.take()));
}

#[test]
fn holds_a_workbook_once_for_a_change_outside_the_app_and_keeps_the_other_holds() {
    let h = Harness::new();
    // A check holds the workbook while it reads the disk
    h.writer.hold(Some(WORKBOOK), HoldReason::Reload);
    h.writer.hold(Some(WORKBOOK), HoldReason::ExternalChange);
    h.writer.hold(Some(WORKBOOK), HoldReason::ExternalChange);
    h.writer.release_all(Some(WORKBOOK), HoldReason::ExternalChange);
    assert_eq!(h.writer.workbook_holds(WORKBOOK), [HoldReason::Reload]);
    h.writer.release(Some(WORKBOOK), HoldReason::Reload);
    assert!(!h.writer.is_workbook_held(WORKBOOK));
}

#[test]
fn names_the_key_and_the_files_of_a_task() {
    assert_eq!(write_script(WORKBOOK, "a.sql", "x").key(), script_key(WORKBOOK, "a.sql"));
    assert_eq!(script_list(&[], Vec::new()).key(), script_list_key(WORKBOOK));
    assert_eq!(patch(WORKBOOK, "x").key(), connection_copy_key(WORKBOOK, CONNECTION));
    assert_eq!(
        WriteTask::RefreshWorkbookAttachments { workbook_id: WORKBOOK.to_string() }.key(),
        format!("{WORKBOOK}/dashql-workbook.json:attachments")
    );
    assert_eq!(delete_script("a.sql").key(), format!("{WORKBOOK}/scripts/a.sql:delete"));
    assert_eq!(creation(WORKBOOK, false).key(), format!("{WORKBOOK}/dashql-workbook.json:create"));
    // A write, a deletion and a rename of a file share it, whatever the case of its name
    assert_eq!(delete_script("A.sql").files(), write_script(WORKBOOK, "a.sql", "x").files());
    assert_eq!(rename_script("A.sql", "b.sql").files(), [script_key(WORKBOOK, "a.sql"), script_key(WORKBOOK, "b.sql")]);
    assert_eq!(rename_script("A.sql", "a.sql").files(), [script_key(WORKBOOK, "a.sql")]);
    assert_eq!(creation(WORKBOOK, false).files(), properties("x").files());
    // A rename of an attachment keeps its order with the saves of both names
    let renamed = WriteTask::RenameDataFile {
        workbook_id: WORKBOOK.to_string(),
        from: "A.parquet".to_string(),
        to: "b.parquet".to_string(),
    };
    assert_eq!(
        renamed.files(),
        [format!("{WORKBOOK}/attachments/a.parquet"), format!("{WORKBOOK}/attachments/b.parquet")]
    );
}
