//! The storage writer: debounced writes of workbooks and connections.
//!
//! A write has a key (`keys`) and a task. A newer write of a pending key replaces the task and keeps the timer of the
//! first one, the caller of the replaced task learns that it was superseded. A timer runs a task after its debounce
//! duration, the tasks of a chain (`keys::chain_key`) run one after another. A paused writer or workbook keeps its
//! tasks pending until it resumes, a flush writes them anyway. A write that would overwrite a script that changed
//! outside the app pauses its workbook and stays pending until the host decides between the disk and the app.
//!
//! The writer decides, the host does the I/O. The state lives behind a `RefCell`: a task reads it, awaits the host
//! without holding a borrow, then applies the result. What the host is told (resolved writes, statistics, external
//! changes, the log) is collected while the state is borrowed and passed on after, so the host may call the writer
//! again from any of them.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::rc::{Rc, Weak};
use std::task::{Context, Poll};

use serde_json::{Map, Value};

use super::keys::{belongs_to_workbook, chain_key, connection_file_prefix};
use super::workbook_file::{
    items, iso_timestamp, manifest_equals, patch_workbook_connection, present, truthy, upsert_connection_entry,
    with_workbook_scripts,
};
use super::{StorageHost, CONNECTIONS_FOLDER, SCRIPTS_FOLDER, WORKBOOK_FILE};
use crate::host::signal::{cancellable, oneshot, CancelHandle, Receiver, Sender};
use crate::host::{HostError, LogLevel};

/// A text that is written, or how to read it when the write runs
pub enum TextSource {
    Text(String),
    /// Reads the latest text when the task runs, none if there is nothing to write anymore
    Read(Box<dyn Fn() -> Result<Option<String>, HostError>>),
}

impl TextSource {
    fn read(&self) -> Result<Option<String>, HostError> {
        match self {
            TextSource::Text(text) => Ok(Some(text.clone())),
            TextSource::Read(read) => read(),
        }
    }
}

/// What a write does
pub enum WriteTask {
    /// Write the workbook file with the given copies of connections. The scripts, the name and the attachments on disk
    /// stay, an ephemeral workbook is marked as one.
    WriteWorkbookManifest { workbook_id: String, connections: Vec<Value>, ephemeral: bool },
    /// Patch the properties that the user owns into the workbook file. A write without `ephemeral` promotes the
    /// workbook, one without `cloud` removes the link to the cloud.
    WriteWorkbookProperties { workbook_id: String, name: Option<String>, ephemeral: bool, cloud: Option<Value> },
    /// Write a workbook as a whole, its scripts first and its workbook file last. The script list on disk stays.
    ReplaceWorkbookScripts {
        workbook_id: String,
        name: Option<String>,
        scripts: Vec<(String, TextSource)>,
        /// The connection of a workbook that is not stored yet
        connection: Option<Value>,
        original_file_name: Option<String>,
    },
    /// Insert or replace a connection entry of the app manifest
    WriteConnectionEntry { entry: Value },
    /// Remove a connection entry of the app manifest and the files of the connection
    DeleteConnectionEntry { connection_id: String },
    /// Write a file of a connection
    WriteConnectionFile { connection_id: String, file_name: String, text: TextSource },
    /// Patch the copies of a connection into an existing workbook file, see `patch_workbook_connection`
    PatchWorkbookConnection { workbook_id: String, copy: Value, replaced: Vec<String> },
    WriteScript { workbook_id: String, file_name: String, text: String },
    DeleteScript { workbook_id: String, file_name: String },
    RenameScript { workbook_id: String, from: String, to: String },
    /// Patch the script list and the copies of the connections it uses into the workbook file
    WriteWorkbookScripts { workbook_id: String, scripts: Vec<Value>, connections: Vec<Value> },
    /// Patch the attachment list of the workbook file from the attachments on disk
    RefreshWorkbookAttachments { workbook_id: String },
}

/// Why a write failed
#[derive(Clone, Debug)]
pub enum WriteError {
    Host(HostError),
    /// The workbook file of a workbook is not available, e.g. its native folder was moved or deleted. A patch never
    /// creates a workbook file.
    WorkbookUnavailable { workbook_id: String, cause: HostError },
}

impl From<HostError> for WriteError {
    fn from(error: HostError) -> WriteError {
        WriteError::Host(error)
    }
}

impl WriteError {
    fn message(&self) -> String {
        match self {
            WriteError::Host(error) => error.message().to_string(),
            WriteError::WorkbookUnavailable { workbook_id, cause } => {
                format!("workbook {workbook_id} is not available: {}", cause.message())
            }
        }
    }
}

/// The outcome of a write
#[derive(Clone, Debug)]
pub enum WriteOutcome {
    /// The task ran (a task may still skip content that is persisted already)
    Written,
    /// A newer task with the same key replaced the task before it ran
    Superseded,
    /// The task was discarded before it ran
    Cancelled,
    /// The writer or the workbook is paused, the task stays pending and runs on resume
    Deferred,
    /// The task failed
    Failed(WriteError),
}

/// The outcome of a write, once it is known
pub struct WriteResult(Receiver<WriteOutcome>);

impl Future for WriteResult {
    type Output = WriteOutcome;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<WriteOutcome> {
        // A writer that is gone never runs the task
        Pin::new(&mut self.0).poll(cx).map(|outcome| outcome.unwrap_or(WriteOutcome::Cancelled))
    }
}

/// The statistics of a key: the scheduled writes of the key and the writes of its file
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WriteStatistics {
    pub scheduled_writes: u64,
    pub writes: u64,
    pub written_bytes: u64,
    pub write_time_ms: f64,
    /// The time of the last write in milliseconds since the epoch
    pub last_write_ms: Option<f64>,
}

struct PendingTask {
    /// The position in the order of the pending tasks
    seq: u64,
    task: WriteTask,
    /// Resolves the caller of the task, none once it was told
    resolver: Option<Sender<WriteOutcome>>,
    debounce_ms: f64,
    /// The armed timer
    timer: Option<u64>,
    /// The flush of a workbook that waits for the task
    flush_round: Option<u64>,
}

struct Execution {
    key: String,
    pending: PendingTask,
    /// Tells a flush that the task ran
    done: Sender<()>,
}

/// What the host is told once the state is released
enum Effect {
    Resolve(Sender<WriteOutcome>, WriteOutcome),
    Done(Sender<()>),
    ArmTimer { key: String, timer: u64, ms: f64 },
    CancelTimer(CancelHandle),
    RunChain(String),
    Statistics(String, WriteStatistics),
    ExternalChange(String),
    Log(LogLevel, String, Vec<(String, String)>),
}

#[derive(Default)]
struct State {
    pending: HashMap<String, PendingTask>,
    /// The keys of the pending tasks in the order they were scheduled
    order: BTreeMap<u64, String>,
    next_seq: u64,
    paused: bool,
    paused_workbooks: BTreeSet<String>,
    /// Writes of deleted workbooks are discarded until a workbook with the id is registered again
    deleted_workbooks: BTreeSet<String>,
    /// The armed timers, with their cancel handles once they run
    timers: HashMap<u64, Option<CancelHandle>>,
    next_timer: u64,
    /// The tasks of a chain that wait or run
    chains: HashMap<String, VecDeque<Execution>>,
    in_flight: usize,
    settle_waiters: Vec<Sender<()>>,
    /// The failed tasks of the flushes of workbooks
    flush_rounds: HashMap<u64, Vec<(String, PendingTask)>>,
    next_flush_round: u64,
    /// The latest generation of every key, every scheduled write advances it
    generations: HashMap<String, u64>,
    next_generation: u64,
    statistics: BTreeMap<String, WriteStatistics>,
    effects: Vec<Effect>,
}

impl State {
    fn is_paused_key(&self, key: &str) -> bool {
        self.paused || self.paused_workbooks.iter().any(|id| belongs_to_workbook(key, id))
    }

    fn is_workbook_paused(&self, workbook_id: &str) -> bool {
        self.paused || self.paused_workbooks.contains(workbook_id)
    }

    fn resolve(&mut self, resolver: Option<Sender<WriteOutcome>>, outcome: WriteOutcome) {
        if let Some(resolver) = resolver {
            self.effects.push(Effect::Resolve(resolver, outcome));
        }
    }

    fn log(&mut self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let details = details.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        self.effects.push(Effect::Log(level, message.to_string(), details));
    }

    /// The pending keys in the order they were scheduled
    fn pending_keys(&self) -> Vec<String> {
        self.order.values().cloned().collect()
    }

    fn insert_pending(&mut self, key: String, mut pending: PendingTask) {
        pending.seq = self.next_seq;
        self.next_seq += 1;
        self.order.insert(pending.seq, key.clone());
        self.pending.insert(key, pending);
    }

    fn remove_pending(&mut self, key: &str) -> Option<PendingTask> {
        let mut pending = self.pending.remove(key)?;
        self.order.remove(&pending.seq);
        self.clear_timer(&mut pending);
        Some(pending)
    }

    fn arm_timer(&mut self, key: &str) {
        let Some(pending) = self.pending.get_mut(key) else { return };
        let previous = pending.timer.take();
        let timer = self.next_timer;
        self.next_timer += 1;
        pending.timer = Some(timer);
        let ms = pending.debounce_ms;
        if let Some(previous) = previous {
            self.cancel_timer(previous);
        }
        self.timers.insert(timer, None);
        self.effects.push(Effect::ArmTimer { key: key.to_string(), timer, ms });
    }

    fn clear_timer(&mut self, pending: &mut PendingTask) {
        if let Some(timer) = pending.timer.take() {
            self.cancel_timer(timer);
        }
    }

    fn cancel_timer(&mut self, timer: u64) {
        if let Some(Some(handle)) = self.timers.remove(&timer) {
            self.effects.push(Effect::CancelTimer(handle));
        }
    }

    fn clear_timers_where(&mut self, select: impl Fn(&str) -> bool) {
        let timers: Vec<u64> = self
            .pending
            .iter_mut()
            .filter(|(key, _)| select(key))
            .filter_map(|(_, pending)| pending.timer.take())
            .collect();
        for timer in timers {
            self.cancel_timer(timer);
        }
    }

    fn rearm_timers_where(&mut self, select: impl Fn(&str) -> bool) {
        for key in self.pending_keys() {
            if select(&key) {
                self.arm_timer(&key);
            }
        }
    }

    fn schedule(&mut self, key: &str, task: WriteTask, debounce_ms: f64) -> WriteResult {
        let (sender, receiver) = oneshot();
        // Writes that were queued while a workbook was deleted must not recreate its files
        if self.deleted_workbooks.iter().any(|id| belongs_to_workbook(key, id)) {
            self.resolve(Some(sender), WriteOutcome::Cancelled);
            return WriteResult(receiver);
        }
        let generation = self.next_generation + 1;
        self.next_generation = generation;
        self.generations.insert(key.to_string(), generation);
        let superseded = match self.pending.get_mut(key) {
            // The newer task keeps the place, the debounce duration and the timer of the first one
            Some(pending) => {
                let previous = pending.resolver.replace(sender);
                pending.task = task;
                pending.flush_round = None;
                Some(previous)
            }
            None => {
                let pending = PendingTask {
                    seq: 0,
                    task,
                    resolver: Some(sender),
                    debounce_ms: debounce_ms.max(0.0),
                    timer: None,
                    flush_round: None,
                };
                self.insert_pending(key.to_string(), pending);
                self.arm_timer(key);
                None
            }
        };
        if let Some(previous) = superseded {
            self.resolve(previous, WriteOutcome::Superseded);
        }
        self.register_scheduled_write(key);
        WriteResult(receiver)
    }

    /// Start the pending task of a key: it leaves the pending tasks and waits for the tasks of its chain. A held key
    /// stays pending unless forced. Returns what completes once the task ran.
    fn process(&mut self, key: &str, force: bool) -> Option<Receiver<()>> {
        if !self.pending.contains_key(key) || (!force && self.is_paused_key(key)) {
            return None;
        }
        let pending = self.remove_pending(key)?;
        let (done, ran) = oneshot();
        let chain = chain_key(key);
        let queue = self.chains.entry(chain.clone()).or_default();
        let idle = queue.is_empty();
        queue.push_back(Execution { key: key.to_string(), pending, done });
        self.in_flight += 1;
        if idle {
            self.effects.push(Effect::RunChain(chain));
        }
        Some(ran)
    }

    /// Apply the result of a task that ran
    fn finish(&mut self, execution: Execution, result: Result<(), WriteError>) {
        let Execution { key, mut pending, done } = execution;
        match result {
            Ok(()) => {
                let resolver = pending.resolver.take();
                self.resolve(resolver, WriteOutcome::Written);
            }
            Err(WriteError::Host(error)) if error.external_change().is_some() => {
                let workbook_id = error.external_change().map(|c| c.workbook_id.clone()).unwrap_or_default();
                let file = error.external_change().map(|c| c.file_name.clone()).unwrap_or_default();
                self.log(
                    LogLevel::Warn,
                    "script changed outside the app, holding the write",
                    &[("key", &key), ("workbookId", &workbook_id), ("file", &file)],
                );
                self.pause_workbook(&workbook_id);
                if self.pending.contains_key(&key) {
                    // A newer task with the same key was scheduled while this one ran
                    let resolver = pending.resolver.take();
                    self.resolve(resolver, WriteOutcome::Superseded);
                } else {
                    self.insert_pending(key, pending);
                }
                self.effects.push(Effect::ExternalChange(workbook_id));
            }
            Err(error) => {
                self.log(LogLevel::Error, "executing write task failed", &[("key", &key), ("error", &error.message())]);
                let resolver = pending.resolver.take();
                self.resolve(resolver, WriteOutcome::Failed(error));
                if let Some(round) = pending.flush_round.and_then(|round| self.flush_rounds.get_mut(&round)) {
                    round.push((key, pending));
                }
            }
        }
        self.effects.push(Effect::Done(done));
        self.in_flight = self.in_flight.saturating_sub(1);
        if self.in_flight == 0 {
            for waiter in std::mem::take(&mut self.settle_waiters) {
                self.effects.push(Effect::Done(waiter));
            }
        }
    }

    fn pause_workbook(&mut self, workbook_id: &str) {
        self.paused_workbooks.insert(workbook_id.to_string());
        self.clear_timers_where(|key| belongs_to_workbook(key, workbook_id));
    }

    fn cancel(&mut self, key: &str) {
        if let Some(mut pending) = self.remove_pending(key) {
            let resolver = pending.resolver.take();
            self.resolve(resolver, WriteOutcome::Cancelled);
        }
    }

    fn register_scheduled_write(&mut self, key: &str) {
        let stats = self.statistics.entry(key.to_string()).or_default();
        stats.scheduled_writes += 1;
        let stats = stats.clone();
        self.effects.push(Effect::Statistics(key.to_string(), stats));
    }

    fn register_write(&mut self, path: &str, bytes: usize, duration_ms: f64, now: f64) {
        let stats = self.statistics.entry(path.to_string()).or_insert_with(|| WriteStatistics {
            // A file that is written without a scheduled write of its own, e.g. the workbook file of a patch
            scheduled_writes: 1,
            ..WriteStatistics::default()
        });
        stats.writes += 1;
        stats.written_bytes += bytes as u64;
        stats.write_time_ms += duration_ms;
        stats.last_write_ms = Some(now);
        let stats = stats.clone();
        self.effects.push(Effect::Statistics(path.to_string(), stats));
    }
}

struct Shared<H: StorageHost> {
    host: H,
    /// The format version of workbook files that the writer writes
    format_version: u64,
    state: RefCell<State>,
}

/// Change the state, then tell the host what changed
fn update<H: StorageHost, R>(shared: &Rc<Shared<H>>, change: impl FnOnce(&mut State) -> R) -> R {
    let (result, effects) = {
        let mut state = shared.state.borrow_mut();
        let result = change(&mut state);
        (result, std::mem::take(&mut state.effects))
    };
    apply(shared, effects);
    result
}

fn apply<H: StorageHost>(shared: &Rc<Shared<H>>, effects: Vec<Effect>) {
    for effect in effects {
        match effect {
            Effect::Resolve(sender, outcome) => sender.send(outcome),
            Effect::Done(sender) => sender.send(()),
            Effect::CancelTimer(handle) => handle.cancel(),
            Effect::ArmTimer { key, timer, ms } => arm(shared, key, timer, ms),
            Effect::RunChain(chain) => {
                let task = run_chain(shared.clone(), chain);
                shared.host.spawn(Box::pin(task));
            }
            Effect::Statistics(key, statistics) => shared.host.statistics_changed(&key, &statistics),
            Effect::ExternalChange(workbook_id) => shared.host.external_script_change(&workbook_id),
            Effect::Log(level, message, details) => {
                let details: Vec<(&str, &str)> = details.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
                shared.host.log(level, &message, &details);
            }
        }
    }
}

/// Start the timer of a pending task. A timer that was cleared in the meantime is not started.
fn arm<H: StorageHost>(shared: &Rc<Shared<H>>, key: String, timer: u64, ms: f64) {
    if !shared.state.borrow().timers.contains_key(&timer) {
        return;
    }
    let (sleep, handle) = cancellable(shared.host.sleep(ms));
    if let Some(slot) = shared.state.borrow_mut().timers.get_mut(&timer) {
        *slot = Some(handle);
    }
    // The timer doesn't keep the writer alive
    let writer: Weak<Shared<H>> = Rc::downgrade(shared);
    shared.host.spawn(Box::pin(async move {
        if sleep.await.is_none() {
            return;
        }
        let Some(shared) = writer.upgrade() else { return };
        update(&shared, |state| {
            if state.timers.remove(&timer).is_none() {
                return;
            }
            match state.pending.get_mut(&key) {
                Some(pending) if pending.timer == Some(timer) => pending.timer = None,
                _ => return,
            }
            state.process(&key, false);
        });
    }));
}

/// Run the tasks of a chain one after another until none waits
async fn run_chain<H: StorageHost>(shared: Rc<Shared<H>>, chain: String) {
    loop {
        // The task stays in the queue while it runs, a task that joins the chain meanwhile waits behind it
        let next = {
            let mut state = shared.state.borrow_mut();
            state
                .chains
                .get_mut(&chain)
                .and_then(VecDeque::front_mut)
                .map(|execution| (execution.key.clone(), std::mem::replace(&mut execution.pending.task, placeholder())))
        };
        let Some((key, task)) = next else {
            update(&shared, |state| {
                state.chains.remove(&chain);
            });
            return;
        };
        let result = execute(&shared, &key, &task).await;
        update(&shared, |state| {
            let execution = state.chains.get_mut(&chain).and_then(VecDeque::pop_front);
            if let Some(mut execution) = execution {
                execution.pending.task = task;
                state.finish(execution, result);
            }
            if state.chains.get(&chain).is_some_and(VecDeque::is_empty) {
                state.chains.remove(&chain);
            }
        });
        if !shared.state.borrow().chains.contains_key(&chain) {
            return;
        }
    }
}

/// Stands in for a task while it runs outside the state
fn placeholder() -> WriteTask {
    WriteTask::RefreshWorkbookAttachments { workbook_id: String::new() }
}

/// Write a file and record the write with its size and duration
async fn timed_write<H: StorageHost>(
    shared: &Rc<Shared<H>>,
    path: &str,
    bytes: usize,
    write: impl Future<Output = Result<(), HostError>>,
) -> Result<(), HostError> {
    let before = shared.host.now();
    write.await?;
    let now = shared.host.now();
    update(shared, |state| state.register_write(path, bytes, now - before, now));
    Ok(())
}

fn log<H: StorageHost>(shared: &Rc<Shared<H>>, level: LogLevel, message: &str, details: &[(&str, &str)]) {
    shared.host.log(level, message, details);
}

/// Save the workbook file of a workbook and record the write
async fn save_workbook_file<H: StorageHost>(shared: &Rc<Shared<H>>, workbook_id: &str, workbook: &Value) -> Result<(), HostError> {
    let bytes = serde_json::to_string_pretty(workbook).map(|text| text.len()).unwrap_or_default();
    let path = format!("{workbook_id}/{WORKBOOK_FILE}");
    timed_write(shared, &path, bytes, shared.host.save_workbook(workbook_id, workbook)).await
}

/// Patch an existing workbook file, the write is skipped when nothing changed. A missing workbook file is not
/// created, a moved native folder would otherwise come back as a new one.
async fn patch_workbook_file<H: StorageHost>(
    shared: &Rc<Shared<H>>,
    key: &str,
    workbook_id: &str,
    patch: impl FnOnce(&Value) -> Value,
) -> Result<(), WriteError> {
    let existing = shared
        .host
        .load_workbook(workbook_id)
        .await
        .map_err(|cause| WriteError::WorkbookUnavailable { workbook_id: workbook_id.to_string(), cause })?;
    let next = patch(&existing);
    if manifest_equals(&existing, &next) {
        return Ok(());
    }
    log(shared, LogLevel::Info, "Patching workbook", &[("key", key), ("workbookId", workbook_id)]);
    save_workbook_file(shared, workbook_id, &next).await?;
    Ok(())
}

fn object_at(value: Option<&Value>, key: &str) -> Option<Map<String, Value>> {
    value.and_then(|v| v.get(key)).and_then(Value::as_object).cloned()
}

async fn execute<H: StorageHost>(shared: &Rc<Shared<H>>, key: &str, task: &WriteTask) -> Result<(), WriteError> {
    let host = &shared.host;
    match task {
        WriteTask::WriteWorkbookManifest { workbook_id, connections, ephemeral } => {
            log(shared, LogLevel::Info, "Writing workbook", &[("key", key), ("workbookId", workbook_id)]);
            // What is on disk keeps its creation time, and the write is skipped when nothing changed
            let existing = host.load_workbook(workbook_id).await.ok();
            let existing = existing.as_ref();
            let mut metadata = object_at(existing, "metadata").unwrap_or_default();
            let created_at = metadata
                .get("createdAt")
                .filter(|v| !v.is_null())
                .cloned()
                .unwrap_or_else(|| Value::String(iso_timestamp(host.now())));
            metadata.insert("createdAt".to_string(), created_at);
            if *ephemeral {
                metadata.insert("ephemeral".to_string(), Value::Bool(true));
            }
            let mut workbook = Map::new();
            workbook.insert("formatVersion".to_string(), Value::from(shared.format_version));
            workbook.insert("workbookId".to_string(), Value::String(workbook_id.clone()));
            if let Some(name) = existing.and_then(|e| e.get("name")).filter(|name| truthy(name)) {
                workbook.insert("name".to_string(), name.clone());
            }
            workbook.insert("connections".to_string(), Value::Array(Vec::new()));
            workbook.insert("scripts".to_string(), Value::Array(Vec::new()));
            let attachments = existing.and_then(|e| present(e, "attachments")).cloned().unwrap_or(Value::Array(Vec::new()));
            workbook.insert("attachments".to_string(), attachments);
            workbook.insert("metadata".to_string(), Value::Object(metadata));
            // The given connections replace the copies on disk, the scripts keep theirs
            let scripts = existing.map(|e| items(e, "scripts")).unwrap_or_default();
            let mut copies = connections.clone();
            copies.extend(existing.map(|e| items(e, "connections")).unwrap_or_default());
            let next = with_workbook_scripts(&Value::Object(workbook), scripts, &copies);
            if let Some(existing) = existing {
                if manifest_equals(existing, &next) {
                    log(shared, LogLevel::Debug, "Skipping workbook write: manifest unchanged", &[("workbookId", workbook_id)]);
                    return Ok(());
                }
            }
            save_workbook_file(shared, workbook_id, &next).await?;
        }
        WriteTask::WriteWorkbookProperties { workbook_id, name, ephemeral, cloud } => {
            patch_workbook_file(shared, key, workbook_id, |existing| {
                let mut next = existing.as_object().cloned().unwrap_or_default();
                match name.as_ref().filter(|name| !name.is_empty()) {
                    Some(name) => {
                        next.insert("name".to_string(), Value::String(name.clone()));
                    }
                    None => {
                        next.shift_remove("name");
                    }
                }
                let mut metadata = next.get("metadata").and_then(Value::as_object).cloned();
                if !*ephemeral {
                    if let Some(metadata) = metadata.as_mut().filter(|m| m.get("ephemeral").is_some_and(|v| !v.is_null())) {
                        metadata.shift_remove("ephemeral");
                    }
                }
                match cloud {
                    Some(cloud) => {
                        let mut fields = metadata.unwrap_or_default();
                        fields.insert("cloud".to_string(), cloud.clone());
                        metadata = Some(fields);
                    }
                    None => {
                        if let Some(metadata) = metadata.as_mut().filter(|m| m.get("cloud").is_some_and(|v| !v.is_null())) {
                            metadata.shift_remove("cloud");
                        }
                    }
                }
                if let Some(metadata) = metadata {
                    next.insert("metadata".to_string(), Value::Object(metadata));
                }
                Value::Object(next)
            })
            .await?;
        }
        WriteTask::ReplaceWorkbookScripts { workbook_id, name, scripts, connection, original_file_name } => {
            log(shared, LogLevel::Info, "Creating workbook", &[("key", key), ("workbookId", workbook_id)]);
            for (file_name, source) in scripts {
                let Some(text) = source.read()? else { continue };
                let path = format!("{workbook_id}/{SCRIPTS_FOLDER}/{file_name}");
                timed_write(shared, &path, text.len(), host.save_script(workbook_id, file_name, &text)).await?;
            }
            // The workbook file comes last so it never names a script that doesn't exist yet. It keeps the name, the
            // creation time, the attachments and the script list on disk.
            let existing = host.load_workbook(workbook_id).await.ok();
            let now = || Value::String(iso_timestamp(host.now()));
            let (scripts_on_disk, connections, created_at) = match existing.as_ref() {
                Some(existing) => (
                    items(existing, "scripts"),
                    items(existing, "connections"),
                    existing.get("metadata").and_then(|m| present(m, "createdAt")).cloned().unwrap_or_else(now),
                ),
                None => (Vec::new(), connection.iter().cloned().collect(), now()),
            };
            let mut metadata = object_at(existing.as_ref(), "metadata").unwrap_or_default();
            match original_file_name {
                Some(file_name) => {
                    metadata.insert("originalFileName".to_string(), Value::String(file_name.clone()));
                }
                None => {
                    metadata.shift_remove("originalFileName");
                }
            }
            metadata.insert("createdAt".to_string(), created_at);
            let mut workbook = Map::new();
            workbook.insert("formatVersion".to_string(), Value::from(shared.format_version));
            workbook.insert("workbookId".to_string(), Value::String(workbook_id.clone()));
            let existing_name = existing.as_ref().and_then(|e| e.get("name")).filter(|name| truthy(name)).cloned();
            match name.as_ref().filter(|name| !name.is_empty()) {
                Some(name) => {
                    workbook.insert("name".to_string(), Value::String(name.clone()));
                }
                None => {
                    if let Some(name) = existing_name {
                        workbook.insert("name".to_string(), name);
                    }
                }
            }
            workbook.insert("connections".to_string(), Value::Array(connections));
            workbook.insert("scripts".to_string(), Value::Array(Vec::new()));
            let attachments = existing.as_ref().and_then(|e| present(e, "attachments")).cloned().unwrap_or(Value::Array(Vec::new()));
            workbook.insert("attachments".to_string(), attachments);
            workbook.insert("metadata".to_string(), Value::Object(metadata));
            let next = with_workbook_scripts(&Value::Object(workbook), scripts_on_disk, &[]);
            save_workbook_file(shared, workbook_id, &next).await?;
        }
        WriteTask::WriteWorkbookScripts { workbook_id, scripts, connections } => {
            patch_workbook_file(shared, key, workbook_id, |existing| {
                with_workbook_scripts(existing, scripts.clone(), connections)
            })
            .await?;
        }
        WriteTask::RefreshWorkbookAttachments { workbook_id } => {
            let names = host.list_attachments(workbook_id).await?;
            let attachments: Vec<Value> = names.into_iter().map(|name| serde_json::json!({ "name": name })).collect();
            patch_workbook_file(shared, key, workbook_id, |existing| {
                let mut next = existing.as_object().cloned().unwrap_or_default();
                next.insert("attachments".to_string(), Value::Array(attachments));
                Value::Object(next)
            })
            .await?;
        }
        WriteTask::WriteConnectionEntry { entry } => {
            let bytes = serde_json::to_string(entry).map(|text| text.len()).unwrap_or_default();
            let upserted = entry.clone();
            let update = Box::new(move |connections: Option<Vec<Value>>| upsert_connection_entry(connections.as_deref(), &upserted));
            timed_write(shared, key, bytes, host.update_connections(update)).await?;
        }
        WriteTask::DeleteConnectionEntry { connection_id } => {
            log(shared, LogLevel::Info, "Deleting connection", &[("key", key), ("connectionId", connection_id)]);
            let id = connection_id.clone();
            let update = Box::new(move |connections: Option<Vec<Value>>| {
                let connections = connections?;
                let is_entry = |e: &Value| e.get("id").and_then(Value::as_str) == Some(id.as_str());
                if !connections.iter().any(is_entry) {
                    return None;
                }
                Some(connections.into_iter().filter(|e| !is_entry(e)).collect())
            });
            host.update_connections(update).await?;
            host.delete_connection_files(connection_id).await?;
        }
        WriteTask::WriteConnectionFile { connection_id, file_name, text } => {
            let Some(text) = text.read()? else { return Ok(()) };
            let path = format!("@{CONNECTIONS_FOLDER}/{connection_id}/{file_name}");
            timed_write(shared, &path, text.len(), host.save_connection_file(connection_id, file_name, &text)).await?;
        }
        WriteTask::PatchWorkbookConnection { workbook_id, copy, replaced } => {
            // Only an existing workbook file is patched
            patch_workbook_file(shared, key, workbook_id, |existing| {
                patch_workbook_connection(existing, copy, replaced).unwrap_or_else(|| existing.clone())
            })
            .await?;
        }
        WriteTask::WriteScript { workbook_id, file_name, text } => {
            log(shared, LogLevel::Info, "Writing workbook script", &[("key", key), ("workbookId", workbook_id), ("file", file_name)]);
            let path = format!("{workbook_id}/{SCRIPTS_FOLDER}/{file_name}");
            timed_write(shared, &path, text.len(), host.save_script(workbook_id, file_name, text)).await?;
        }
        WriteTask::DeleteScript { workbook_id, file_name } => {
            log(shared, LogLevel::Info, "Deleting workbook script", &[("key", key), ("workbookId", workbook_id), ("file", file_name)]);
            host.delete_script(workbook_id, file_name).await?;
        }
        WriteTask::RenameScript { workbook_id, from, to } => {
            log(shared, LogLevel::Info, "Renaming workbook script", &[("key", key), ("workbookId", workbook_id), ("from", from), ("to", to)]);
            host.rename_script(workbook_id, from, to).await?;
        }
    }
    Ok(())
}

/// The storage writer, see the module. A clone is a handle of the same writer, e.g. for a service that writes through
/// it after an await.
pub struct StorageWriter<H: StorageHost> {
    shared: Rc<Shared<H>>,
}

impl<H: StorageHost> Clone for StorageWriter<H> {
    fn clone(&self) -> Self {
        StorageWriter { shared: self.shared.clone() }
    }
}

impl<H: StorageHost> StorageWriter<H> {
    /// A writer that writes workbook files of a format version
    pub fn new(host: H, format_version: u64) -> StorageWriter<H> {
        StorageWriter { shared: Rc::new(Shared { host, format_version, state: RefCell::new(State::default()) }) }
    }

    pub fn host(&self) -> &H {
        &self.shared.host
    }

    /// Schedule a debounced write. A newer write with the same key replaces a pending task and supersedes its caller.
    pub fn write(&self, key: &str, task: WriteTask, debounce_ms: f64) -> WriteResult {
        update(&self.shared, |state| state.schedule(key, task, debounce_ms))
    }

    /// Write without debouncing. The task replaces a pending task with the same key and runs right away, after the
    /// running tasks of its chain. A paused writer or workbook defers it, it stays pending and runs on resume.
    pub fn write_durable(&self, key: &str, task: WriteTask) -> WriteResult {
        update(&self.shared, |state| {
            let result = state.schedule(key, task, 0.0);
            if state.is_paused_key(key) {
                if let Some((timer, resolver)) = state.pending.get_mut(key).map(|p| (p.timer.take(), p.resolver.take())) {
                    if let Some(timer) = timer {
                        state.cancel_timer(timer);
                    }
                    state.resolve(resolver, WriteOutcome::Deferred);
                }
            } else {
                state.process(key, false);
            }
            result
        })
    }

    /// Pause the writer. Nothing is written until it resumes or flushes, writes scheduled meanwhile stay pending.
    pub fn pause(&self) {
        update(&self.shared, |state| {
            state.paused = true;
            state.clear_timers_where(|_| true);
        });
    }

    /// Resume the writer, the pending tasks of workbooks that are not paused wait for their debounce duration again
    pub fn resume(&self) {
        update(&self.shared, |state| {
            if !state.paused {
                return;
            }
            state.paused = false;
            let paused_workbooks = state.paused_workbooks.clone();
            state.rearm_timers_where(|key| !paused_workbooks.iter().any(|id| belongs_to_workbook(key, id)));
        });
    }

    /// Hold the writes of a workbook, e.g. while the app reloads it from disk
    pub fn pause_workbook(&self, workbook_id: &str) {
        update(&self.shared, |state| state.pause_workbook(workbook_id));
    }

    /// Resume the writes of a workbook, its pending tasks wait for their debounce duration again
    pub fn resume_workbook(&self, workbook_id: &str) {
        update(&self.shared, |state| {
            if !state.paused_workbooks.remove(workbook_id) || state.paused {
                return;
            }
            state.rearm_timers_where(|key| belongs_to_workbook(key, workbook_id));
        });
    }

    /// Is a workbook held, by a paused writer or a paused workbook?
    pub fn is_workbook_paused(&self, workbook_id: &str) -> bool {
        self.shared.state.borrow().is_workbook_paused(workbook_id)
    }

    /// The pending keys in the order they were scheduled
    pub fn pending_keys(&self) -> Vec<String> {
        self.shared.state.borrow().pending_keys()
    }

    /// The pending keys of a workbook in the order they were scheduled
    pub fn pending_keys_for_workbook(&self, workbook_id: &str) -> Vec<String> {
        let state = self.shared.state.borrow();
        state.order.values().filter(|key| belongs_to_workbook(key, workbook_id)).cloned().collect()
    }

    /// Discard pending writes, their callers learn that they were cancelled. Tasks that run already finish.
    pub fn cancel_pending_writes(&self, keys: &[String]) {
        update(&self.shared, |state| {
            for key in keys {
                state.cancel(key);
            }
        });
    }

    /// Discard the pending writes of a workbook
    pub fn cancel_pending_writes_for_workbook(&self, workbook_id: &str) {
        let keys = self.pending_keys_for_workbook(workbook_id);
        self.cancel_pending_writes(&keys);
    }

    /// Discard the pending writes of the files of a connection that is deleted, they would create its folder again
    pub fn cancel_pending_connection_file_writes(&self, connection_id: &str) {
        let prefix = connection_file_prefix(connection_id);
        let keys: Vec<String> = self.shared.state.borrow().order.values().filter(|key| key.starts_with(&prefix)).cloned().collect();
        self.cancel_pending_writes(&keys);
    }

    /// A workbook with the id of a deleted workbook was registered again, its writes are accepted again
    pub fn revive_workbook(&self, workbook_id: &str) {
        update(&self.shared, |state| {
            state.deleted_workbooks.remove(workbook_id);
        });
    }

    /// The latest generation of every key of a workbook that was ever written, a scheduled write advances it
    pub fn write_generations_for_workbook(&self, workbook_id: &str) -> Vec<(String, u64)> {
        let state = self.shared.state.borrow();
        let mut generations: Vec<(String, u64)> = state
            .generations
            .iter()
            .filter(|(key, _)| belongs_to_workbook(key, workbook_id))
            .map(|(key, generation)| (key.clone(), *generation))
            .collect();
        generations.sort_by_key(|(_, generation)| *generation);
        generations
    }

    /// The statistics of every key
    pub fn statistics(&self) -> Vec<(String, WriteStatistics)> {
        self.shared.state.borrow().statistics.iter().map(|(key, stats)| (key.clone(), stats.clone())).collect()
    }

    /// Wait for the tasks that run or wait for their chain, without starting pending ones
    pub fn settle(&self) -> impl Future<Output = ()> + 'static {
        settle(self.shared.clone())
    }

    /// Run every pending task right away and wait until all tasks ran. A paused writer or workbook is flushed as
    /// well and stays paused.
    pub fn flush(&self) -> impl Future<Output = ()> + 'static {
        let shared = self.shared.clone();
        async move {
            let (was_paused, keys) = update(&shared, |state| {
                let was_paused = state.paused;
                state.paused = false;
                (was_paused, state.pending_keys())
            });
            for key in keys {
                let ran = update(&shared, |state| state.process(&key, true));
                if let Some(ran) = ran {
                    ran.await;
                }
            }
            update(&shared, |state| state.paused = was_paused);
            settle(shared).await;
        }
    }

    /// Write the pending tasks of a workbook right away and wait until they ran.
    ///
    /// True when every pending write of the workbook reached the storage. A held writer or workbook keeps its writes
    /// pending and gives false: unlike a flush, it never forces them, they would overwrite an external change. A
    /// failed write stays pending as well unless a newer one replaced it, the next flush writes it again.
    pub fn flush_workbook(&self, workbook_id: &str) -> impl Future<Output = bool> + 'static {
        let shared = self.shared.clone();
        let workbook_id = workbook_id.to_string();
        async move {
            let round = update(&shared, |state| {
                if state.is_workbook_paused(&workbook_id) {
                    return None;
                }
                let round = state.next_flush_round;
                state.next_flush_round += 1;
                state.flush_rounds.insert(round, Vec::new());
                let keys: Vec<String> = state.pending_keys().into_iter().filter(|key| belongs_to_workbook(key, &workbook_id)).collect();
                for key in keys {
                    if let Some(pending) = state.pending.get_mut(&key) {
                        pending.flush_round = Some(round);
                    }
                    state.process(&key, false);
                }
                Some(round)
            });
            let Some(round) = round else { return false };
            settle(shared.clone()).await;
            update(&shared, |state| {
                let failed = state.flush_rounds.remove(&round).unwrap_or_default();
                let all_written = failed.is_empty();
                for (key, mut pending) in failed {
                    if state.pending.contains_key(&key) {
                        continue;
                    }
                    pending.resolver = None;
                    pending.flush_round = None;
                    state.insert_pending(key.clone(), pending);
                    state.arm_timer(&key);
                }
                // A write that would overwrite an external change pauses the workbook and stays pending
                all_written && !state.is_workbook_paused(&workbook_id)
            })
        }
    }

    /// Delete a workbook. Its pending writes are discarded, the writes that run already finish first, and no write
    /// creates files of the workbook afterwards. A failed deletion accepts writes of the workbook again.
    pub fn delete_workbook(&self, workbook_id: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let shared = self.shared.clone();
        let workbook_id = workbook_id.to_string();
        async move {
            update(&shared, |state| {
                state.deleted_workbooks.insert(workbook_id.clone());
                let keys: Vec<String> = state.pending_keys().into_iter().filter(|key| belongs_to_workbook(key, &workbook_id)).collect();
                for key in keys {
                    state.cancel(&key);
                }
            });
            settle(shared.clone()).await;
            if let Err(error) = shared.host.delete_workbook(&workbook_id).await {
                update(&shared, |state| {
                    state.deleted_workbooks.remove(&workbook_id);
                });
                return Err(error);
            }
            log(&shared, LogLevel::Info, "Deleted workbook", &[("workbookId", &workbook_id)]);
            Ok(())
        }
    }
}

/// Wait until no task runs or waits for its chain
async fn settle<H: StorageHost>(shared: Rc<Shared<H>>) {
    loop {
        let waiter = update(&shared, |state| {
            if state.in_flight == 0 {
                return None;
            }
            let (sender, receiver) = oneshot();
            state.settle_waiters.push(sender);
            Some(receiver)
        });
        match waiter {
            Some(waiter) => {
                waiter.await;
            }
            None => return,
        }
    }
}
