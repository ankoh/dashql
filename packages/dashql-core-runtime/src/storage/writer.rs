//! The storage writer: debounced writes of workbooks and connections.
//!
//! A write has a key (`keys`) and a task. A newer write of a pending key replaces the task and keeps the timer of the
//! first one, the caller of the replaced task learns that it was superseded. A timer runs a task after its debounce
//! duration, the tasks of a chain (`keys::chain_key`) run one after another.
//!
//! Holds keep tasks pending. A hold has a reason (`HoldReason`) and is counted: every hold is released on its own, a
//! check of a folder releases the hold it took and not the one of an open question. A hold of the writer (`pause`, a
//! handover to another tab) keeps every task pending, a forced flush (`flush`, e.g. when the page hides) writes past
//! it. A hold of a workbook is never forced: a write that would overwrite a script or a workbook file that changed
//! outside the app holds its workbook (`HoldReason::ExternalChange`) until the host decides between the disk and the
//! app, a reload or an import holds the workbook it replaces.
//!
//! A failed task stays pending and runs again after a backoff, its key and its last error are part of the status of
//! the writer (`WriterStatus`) until a write of the key succeeds or the task is cancelled.
//!
//! The writer decides, the host does the I/O. The state lives behind a `RefCell`: a task reads it, awaits the host
//! without holding a borrow, then applies the result. What the host is told (resolved writes, statistics, external
//! changes, the log) is collected while the state is borrowed and passed on after, so the host may call the writer
//! again from any of them.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::rc::{Rc, Weak};
use std::task::{Context, Poll};

use serde_json::Value;

use super::keys::{
    attachment_key, belongs_to_workbook, chain_key, connection_entry_key, connection_file_key, connection_file_prefix, script_deletion_key,
    script_key, script_rename_key, workbook_attachment_list_key, workbook_connection_copy_key, workbook_file_key,
    workbook_script_list_key, workbook_scripts_key,
};
use super::workbook_file::{attachments_patch, manifest_file, properties_patch, replaced_workbook_file, same_file, upsert_connection_entry};
use super::StorageHost;
use crate::host::signal::{cancellable, oneshot, CancelHandle, Receiver, Sender};
use crate::host::{HostError, LogLevel};
use crate::http::HostBytes;
use crate::workbook_format::data::{WorkbookCloudLink, WorkbookConnection, WorkbookData, WorkbookScript};
use crate::workbook_format::files::{patch_workbook_connection, with_workbook_scripts};
use crate::workbook_format::storage_migration::iso_timestamp;

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
    WriteWorkbookManifest { workbook_id: String, connections: Vec<WorkbookConnection>, ephemeral: bool },
    /// Patch the properties that the user owns into the workbook file. A write without `ephemeral` promotes the
    /// workbook, one without `cloud` removes the link to the cloud.
    WriteWorkbookProperties { workbook_id: String, name: Option<String>, ephemeral: bool, cloud: Option<WorkbookCloudLink> },
    /// Write a workbook as a whole, its scripts first and its workbook file last. The script list on disk stays.
    ReplaceWorkbookScripts {
        workbook_id: String,
        name: Option<String>,
        scripts: Vec<(String, TextSource)>,
        /// The connection of a workbook that is not stored yet
        connection: Option<WorkbookConnection>,
        original_file_name: Option<String>,
    },
    /// Insert or replace a connection entry of the app manifest
    WriteConnectionEntry { entry: Value },
    /// Remove a connection entry of the app manifest and the files of the connection
    DeleteConnectionEntry { connection_id: String },
    /// Write a file of a connection
    WriteConnectionFile { connection_id: String, file_name: String, text: TextSource },
    /// Patch the copies of a connection into an existing workbook file, see `files::patch_workbook_connection`
    PatchWorkbookConnection { workbook_id: String, copy: WorkbookConnection, replaced: Vec<String> },
    WriteScript { workbook_id: String, file_name: String, text: String },
    DeleteScript { workbook_id: String, file_name: String },
    RenameScript { workbook_id: String, from: String, to: String },
    /// Patch the script list and the copies of the connections it uses into the workbook file
    WriteWorkbookScripts { workbook_id: String, scripts: Vec<WorkbookScript>, connections: Vec<WorkbookConnection> },
    /// Patch the attachment list of the workbook file from the attachments on disk
    RefreshWorkbookAttachments { workbook_id: String },
    /// Save an attachment of a workbook, a file that stays with the host
    SaveDataFile { workbook_id: String, file_name: String, file: HostBytes },
}

impl WriteTask {
    /// The key that the runtime writes the task under (`keys`), e.g. for a write that the host schedules. A connection
    /// copy is keyed by the connection it replaces, or its own.
    pub fn key(&self) -> String {
        match self {
            WriteTask::WriteWorkbookManifest { workbook_id, .. } | WriteTask::WriteWorkbookProperties { workbook_id, .. } => {
                workbook_file_key(workbook_id)
            }
            WriteTask::ReplaceWorkbookScripts { workbook_id, .. } => workbook_scripts_key(workbook_id),
            WriteTask::WriteConnectionEntry { entry } => connection_entry_key(entry.get("id").and_then(Value::as_str).unwrap_or_default()),
            WriteTask::DeleteConnectionEntry { connection_id } => connection_entry_key(connection_id),
            WriteTask::WriteConnectionFile { connection_id, file_name, .. } => connection_file_key(connection_id, file_name),
            WriteTask::PatchWorkbookConnection { workbook_id, copy, replaced } => {
                workbook_connection_copy_key(workbook_id, replaced.first().unwrap_or(&copy.connection_id))
            }
            WriteTask::WriteScript { workbook_id, file_name, .. } => script_key(workbook_id, file_name),
            WriteTask::DeleteScript { workbook_id, file_name } => script_deletion_key(workbook_id, file_name),
            WriteTask::RenameScript { workbook_id, from, .. } => script_rename_key(workbook_id, from),
            WriteTask::WriteWorkbookScripts { workbook_id, .. } => workbook_script_list_key(workbook_id),
            WriteTask::RefreshWorkbookAttachments { workbook_id } => workbook_attachment_list_key(workbook_id),
            WriteTask::SaveDataFile { workbook_id, file_name, .. } => attachment_key(workbook_id, file_name),
        }
    }
}

/// Why writes are held. Holds are counted per reason, each is released on its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum HoldReason {
    /// A write would overwrite a file that changed outside the app, the host asks the user. Taken by the writer, held
    /// once per workbook, one release ends it.
    ExternalChange,
    /// A check of a folder that changed outside the app, or a reload of a workbook from disk
    Reload,
    /// An import replaces the workbook
    Import,
    /// Another tab took over the app
    Handover,
    /// The host paused the writes, e.g. while it moves a workbook
    Pause,
}

/// A hold of the writer (no workbook) or of a workbook
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteHold {
    pub workbook_id: Option<String>,
    pub reason: HoldReason,
    pub count: u32,
}

/// A task that failed and waits for its next attempt
#[derive(Clone, Debug, PartialEq)]
pub struct FailedWrite {
    pub key: String,
    /// The workbook of the key, none for a key of the app storage
    pub workbook_id: Option<String>,
    /// The last error
    pub error: String,
    /// The failed attempts in a row
    pub attempts: u32,
}

/// What the writer holds and what failed, the host shows it
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WriterStatus {
    /// The holds of the writer, then those of the workbooks by id
    pub holds: Vec<WriteHold>,
    /// The failed keys in the order they were scheduled
    pub failed: Vec<FailedWrite>,
}

impl WriterStatus {
    /// The workbooks that a change outside the app holds
    pub fn externally_changed(&self) -> impl Iterator<Item = &str> {
        self.holds.iter().filter(|hold| hold.reason == HoldReason::ExternalChange).filter_map(|hold| hold.workbook_id.as_deref())
    }
}

/// The delay before the next attempt of a failed task: one second, doubled with every failure, at most a minute
pub fn retry_delay_ms(attempts: u32) -> f64 {
    (1000.0 * 2f64.powi(attempts.saturating_sub(1).min(6) as i32)).min(60_000.0)
}

/// The workbook of a key, none for a key of the app storage
fn workbook_of_key(key: &str) -> Option<&str> {
    if key.starts_with('@') {
        return None;
    }
    key.split('/').next().filter(|id| !id.is_empty())
}

/// The script files that a task writes, deletes or renames, by workbook and file name
fn script_files(task: &WriteTask) -> Vec<(&str, &str)> {
    match task {
        WriteTask::WriteScript { workbook_id, file_name, .. } | WriteTask::DeleteScript { workbook_id, file_name } => {
            vec![(workbook_id, file_name)]
        }
        WriteTask::RenameScript { workbook_id, from, to } => vec![(workbook_id, from), (workbook_id, to)],
        _ => Vec::new(),
    }
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
    Status(WriterStatus),
    Log(LogLevel, String, Vec<(String, String)>),
}

/// The failure of a key
struct Failure {
    error: String,
    attempts: u32,
}

#[derive(Default)]
struct State {
    pending: HashMap<String, PendingTask>,
    /// The keys of the pending tasks in the order they were scheduled
    order: BTreeMap<u64, String>,
    next_seq: u64,
    /// The holds of the writer by reason, with their counts
    holds: BTreeMap<HoldReason, u32>,
    /// The holds of workbooks by reason, with their counts
    workbook_holds: HashMap<String, BTreeMap<HoldReason, u32>>,
    /// The failures of the keys whose tasks failed last
    failures: HashMap<String, Failure>,
    /// Did the holds or the failures change since the host was told?
    status_changed: bool,
    /// Writes of deleted workbooks are discarded until a workbook with the id is registered again
    deleted_workbooks: HashSet<String>,
    /// The armed timers, with their cancel handles once they run
    timers: HashMap<u64, Option<CancelHandle>>,
    next_timer: u64,
    /// The tasks of a chain that wait or run
    chains: HashMap<String, VecDeque<Execution>>,
    in_flight: usize,
    settle_waiters: Vec<Sender<()>>,
    /// The latest generation of every key, every scheduled write advances it. A deleted workbook drops its keys.
    generations: HashMap<String, u64>,
    next_generation: u64,
    statistics: BTreeMap<String, WriteStatistics>,
    effects: Vec<Effect>,
}

impl State {
    /// Does a hold keep the task of a key pending? A forced write passes the holds of the writer, never those of a
    /// workbook.
    fn is_held_key(&self, key: &str, force: bool) -> bool {
        (!force && !self.holds.is_empty()) || workbook_of_key(key).is_some_and(|id| self.workbook_holds.contains_key(id))
    }

    fn is_paused_key(&self, key: &str) -> bool {
        self.is_held_key(key, false)
    }

    fn is_workbook_held(&self, workbook_id: &str) -> bool {
        !self.holds.is_empty() || self.workbook_holds.contains_key(workbook_id)
    }

    /// Take a hold of the writer or of a workbook. A change outside the app holds a workbook once.
    fn hold(&mut self, workbook_id: Option<&str>, reason: HoldReason) {
        let holds = match workbook_id {
            Some(id) => self.workbook_holds.entry(id.to_string()).or_default(),
            None => &mut self.holds,
        };
        let count = holds.entry(reason).or_insert(0);
        if reason == HoldReason::ExternalChange && *count > 0 {
            return;
        }
        *count += 1;
        match workbook_id {
            Some(id) => self.clear_timers_where(|key| belongs_to_workbook(key, id)),
            None => self.clear_timers_where(|_| true),
        }
        self.status_changed = true;
    }

    /// Release a hold, or all holds of the reason. The tasks that no hold keeps any more wait for their debounce
    /// duration again.
    fn release(&mut self, workbook_id: Option<&str>, reason: HoldReason, all: bool) {
        let holds = match workbook_id {
            Some(id) => match self.workbook_holds.get_mut(id) {
                Some(holds) => holds,
                None => return,
            },
            None => &mut self.holds,
        };
        let Some(count) = holds.get_mut(&reason) else { return };
        *count = if all { 0 } else { count.saturating_sub(1) };
        if *count == 0 {
            holds.remove(&reason);
        }
        let released = holds.is_empty();
        if let Some(id) = workbook_id.filter(|_| released) {
            self.workbook_holds.remove(id);
        }
        self.status_changed = true;
        if !released || !self.holds.is_empty() {
            return;
        }
        match workbook_id {
            Some(id) => self.rearm_timers_where(|key| belongs_to_workbook(key, id)),
            None => {
                let held: HashSet<String> = self.workbook_holds.keys().cloned().collect();
                self.rearm_timers_where(|key| !workbook_of_key(key).is_some_and(|id| held.contains(id)))
            }
        }
    }

    /// What the writer holds and what failed
    fn status(&self) -> WriterStatus {
        let mut holds: Vec<WriteHold> =
            self.holds.iter().map(|(reason, count)| WriteHold { workbook_id: None, reason: *reason, count: *count }).collect();
        let mut workbooks: Vec<(&String, &BTreeMap<HoldReason, u32>)> = self.workbook_holds.iter().collect();
        workbooks.sort_by(|a, b| a.0.cmp(b.0));
        for (id, reasons) in workbooks {
            holds.extend(reasons.iter().map(|(reason, count)| WriteHold { workbook_id: Some(id.clone()), reason: *reason, count: *count }));
        }
        let mut failed: Vec<(u64, FailedWrite)> = self
            .failures
            .iter()
            .map(|(key, failure)| {
                let seq = self.pending.get(key).map_or(u64::MAX, |pending| pending.seq);
                let write = FailedWrite {
                    key: key.clone(),
                    workbook_id: workbook_of_key(key).map(str::to_string),
                    error: failure.error.clone(),
                    attempts: failure.attempts,
                };
                (seq, write)
            })
            .collect();
        failed.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.key.cmp(&b.1.key)));
        WriterStatus { holds, failed: failed.into_iter().map(|(_, write)| write).collect() }
    }

    /// A key no longer fails, e.g. its task ran or was cancelled
    fn clear_failure(&mut self, key: &str) {
        if self.failures.remove(key).is_some() {
            self.status_changed = true;
        }
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
        // A newer task of a script file goes after a task that was scheduled after the pending one of its key and
        // touches the same file, e.g. a delete or a rename onto it, instead of keeping the place of the pending one
        if self.overtakes_pending(key, &task) {
            if let Some(mut previous) = self.remove_pending(key) {
                let resolver = previous.resolver.take();
                self.resolve(resolver, WriteOutcome::Superseded);
            }
        }
        let superseded = match self.pending.get_mut(key) {
            // The newer task keeps the place, the debounce duration and the timer of the first one
            Some(pending) => {
                let previous = pending.resolver.replace(sender);
                pending.task = task;
                Some(previous)
            }
            None => {
                let pending = PendingTask { seq: 0, task, resolver: Some(sender), debounce_ms: debounce_ms.max(0.0), timer: None };
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

    /// Was a task that touches a script file of a task scheduled after the pending task of its key? Then the task must
    /// not take the place of the pending one, it would run before the other.
    fn overtakes_pending(&self, key: &str, task: &WriteTask) -> bool {
        let files = script_files(task);
        let Some(seq) = self.pending.get(key).map(|pending| pending.seq) else { return false };
        !files.is_empty()
            && self.order.range(seq + 1..).any(|(_, other)| {
                self.pending.get(other).is_some_and(|other| script_files(&other.task).iter().any(|file| files.contains(file)))
            })
    }

    /// Start the pending task of a key: it leaves the pending tasks and waits for the tasks of its chain. A held key
    /// stays pending, a forced one passes the holds of the writer. Returns what completes once the task ran.
    fn process(&mut self, key: &str, force: bool) -> Option<Receiver<()>> {
        if !self.pending.contains_key(key) || self.is_held_key(key, force) {
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
                self.clear_failure(&key);
            }
            Err(WriteError::Host(error)) if error.external_change().is_some() => {
                let workbook_id = error.external_change().map(|c| c.workbook_id.clone()).unwrap_or_default();
                let file = error.external_change().map(|c| c.file_name.clone()).unwrap_or_default();
                self.log(
                    LogLevel::Warn,
                    "file changed outside the app, holding the write",
                    &[("key", &key), ("workbookId", &workbook_id), ("file", &file)],
                );
                self.hold(Some(&workbook_id), HoldReason::ExternalChange);
                if self.pending.contains_key(&key) {
                    // A newer task with the same key was scheduled while this one ran
                    let resolver = pending.resolver.take();
                    self.resolve(resolver, WriteOutcome::Superseded);
                } else {
                    self.insert_pending(key, pending);
                }
            }
            Err(error) => {
                let message = error.message();
                self.log(LogLevel::Error, "executing write task failed", &[("key", &key), ("error", &message)]);
                let resolver = pending.resolver.take();
                self.resolve(resolver, WriteOutcome::Failed(error));
                // The task stays pending and runs again after a backoff, unless a newer task replaced it
                let attempts = self.failures.get(&key).map_or(0, |failure| failure.attempts) + 1;
                self.failures.insert(key.clone(), Failure { error: message, attempts });
                self.status_changed = true;
                if !self.pending.contains_key(&key) && !self.deleted_workbooks.iter().any(|id| belongs_to_workbook(&key, id)) {
                    pending.debounce_ms = retry_delay_ms(attempts);
                    self.insert_pending(key.clone(), pending);
                    self.arm_timer(&key);
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

    fn cancel(&mut self, key: &str) {
        if let Some(mut pending) = self.remove_pending(key) {
            let resolver = pending.resolver.take();
            self.resolve(resolver, WriteOutcome::Cancelled);
        }
        self.clear_failure(key);
    }

    /// Forget the keys of a deleted workbook: their generations, statistics and failures
    fn forget_workbook(&mut self, workbook_id: &str) {
        self.generations.retain(|key, _| !belongs_to_workbook(key, workbook_id));
        self.statistics.retain(|key, _| !belongs_to_workbook(key, workbook_id));
        let failed: Vec<String> = self.failures.keys().filter(|key| belongs_to_workbook(key, workbook_id)).cloned().collect();
        for key in failed {
            self.clear_failure(&key);
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
    format_version: i64,
    state: RefCell<State>,
}

/// Change the state, then tell the host what changed
fn update<H: StorageHost, R>(shared: &Rc<Shared<H>>, change: impl FnOnce(&mut State) -> R) -> R {
    let (result, effects) = {
        let mut state = shared.state.borrow_mut();
        let result = change(&mut state);
        if std::mem::take(&mut state.status_changed) {
            let status = state.status();
            state.effects.push(Effect::Status(status));
        }
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
            Effect::Status(status) => shared.host.status_changed(&status),
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
async fn save_workbook_file<H: StorageHost>(shared: &Rc<Shared<H>>, workbook_id: &str, workbook: &WorkbookData) -> Result<(), HostError> {
    let json = workbook.to_json();
    let bytes = serde_json::to_string_pretty(&json).map(|text| text.len()).unwrap_or_default();
    timed_write(shared, &workbook_file_key(workbook_id), bytes, shared.host.save_workbook(workbook_id, &json)).await
}

/// The workbook file of a workbook, none if there is none
async fn load_workbook_file<H: StorageHost>(shared: &Rc<Shared<H>>, workbook_id: &str) -> Option<WorkbookData> {
    shared.host.load_workbook(workbook_id).await.ok().map(|json| WorkbookData::from_json(&json))
}

/// Patch an existing workbook file, the write is skipped when nothing changed. A missing workbook file is not
/// created, a moved native folder would otherwise come back as a new one.
async fn patch_workbook_file<H: StorageHost>(
    shared: &Rc<Shared<H>>,
    key: &str,
    workbook_id: &str,
    patch: impl FnOnce(&WorkbookData) -> WorkbookData,
) -> Result<(), WriteError> {
    let existing = shared
        .host
        .load_workbook(workbook_id)
        .await
        .map_err(|cause| WriteError::WorkbookUnavailable { workbook_id: workbook_id.to_string(), cause })?;
    let existing = WorkbookData::from_json(&existing);
    let next = patch(&existing);
    if same_file(&existing, &next) {
        return Ok(());
    }
    log(shared, LogLevel::Info, "Patching workbook", &[("key", key), ("workbookId", workbook_id)]);
    save_workbook_file(shared, workbook_id, &next).await?;
    Ok(())
}

async fn execute<H: StorageHost>(shared: &Rc<Shared<H>>, key: &str, task: &WriteTask) -> Result<(), WriteError> {
    let host = &shared.host;
    match task {
        WriteTask::WriteWorkbookManifest { workbook_id, connections, ephemeral } => {
            log(shared, LogLevel::Info, "Writing workbook", &[("key", key), ("workbookId", workbook_id)]);
            // What is on disk keeps its creation time, and the write is skipped when nothing changed
            let existing = load_workbook_file(shared, workbook_id).await;
            let now = iso_timestamp(host.now());
            let next = manifest_file(existing.as_ref(), workbook_id, shared.format_version, connections, *ephemeral, &now);
            if existing.as_ref().is_some_and(|existing| same_file(existing, &next)) {
                log(shared, LogLevel::Debug, "Skipping workbook write: manifest unchanged", &[("workbookId", workbook_id)]);
                return Ok(());
            }
            save_workbook_file(shared, workbook_id, &next).await?;
        }
        WriteTask::WriteWorkbookProperties { workbook_id, name, ephemeral, cloud } => {
            patch_workbook_file(shared, key, workbook_id, |existing| properties_patch(existing, name.as_deref(), *ephemeral, cloud.as_ref())).await?;
        }
        WriteTask::ReplaceWorkbookScripts { workbook_id, name, scripts, connection, original_file_name } => {
            log(shared, LogLevel::Info, "Creating workbook", &[("key", key), ("workbookId", workbook_id)]);
            for (file_name, source) in scripts {
                let Some(text) = source.read()? else { continue };
                timed_write(shared, &script_key(workbook_id, file_name), text.len(), host.save_script(workbook_id, file_name, &text)).await?;
            }
            // The workbook file comes last so it never names a script that doesn't exist yet. It keeps the name, the
            // creation time, the attachments and the script list on disk.
            let existing = load_workbook_file(shared, workbook_id).await;
            let now = iso_timestamp(host.now());
            let next = replaced_workbook_file(
                existing.as_ref(),
                workbook_id,
                shared.format_version,
                name.as_deref(),
                connection.as_ref(),
                original_file_name.as_deref(),
                &now,
            );
            save_workbook_file(shared, workbook_id, &next).await?;
        }
        WriteTask::WriteWorkbookScripts { workbook_id, scripts, connections } => {
            patch_workbook_file(shared, key, workbook_id, |existing| with_workbook_scripts(existing, scripts.clone(), connections)).await?;
        }
        WriteTask::SaveDataFile { workbook_id, file_name, file } => {
            log(shared, LogLevel::Info, "Writing attachment", &[("key", key), ("workbookId", workbook_id)]);
            timed_write(shared, key, file.len(), host.save_data_file(workbook_id, file_name, file)).await?;
        }
        WriteTask::RefreshWorkbookAttachments { workbook_id } => {
            let names = host.list_attachments(workbook_id).await?;
            patch_workbook_file(shared, key, workbook_id, |existing| attachments_patch(existing, &names)).await?;
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
            timed_write(shared, &connection_file_key(connection_id, file_name), text.len(), host.save_connection_file(connection_id, file_name, &text)).await?;
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
            timed_write(shared, &script_key(workbook_id, file_name), text.len(), host.save_script(workbook_id, file_name, text)).await?;
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
    pub fn new(host: H, format_version: i64) -> StorageWriter<H> {
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

    /// Hold the writes of the writer (no workbook) or of a workbook for a reason. Nothing of it is written until the
    /// hold is released, writes scheduled meanwhile stay pending. A forced flush writes past a hold of the writer,
    /// never past one of a workbook.
    pub fn hold(&self, workbook_id: Option<&str>, reason: HoldReason) {
        update(&self.shared, |state| state.hold(workbook_id, reason));
    }

    /// Release one hold of a reason. Once nothing holds them, the pending tasks wait for their debounce duration again.
    pub fn release(&self, workbook_id: Option<&str>, reason: HoldReason) {
        update(&self.shared, |state| state.release(workbook_id, reason, false));
    }

    /// Release every hold of a reason, e.g. the hold of a change outside the app once the host decided
    pub fn release_all(&self, workbook_id: Option<&str>, reason: HoldReason) {
        update(&self.shared, |state| state.release(workbook_id, reason, true));
    }

    /// Pause the writer, a hold of the writer (`HoldReason::Pause`)
    pub fn pause(&self) {
        self.hold(None, HoldReason::Pause);
    }

    /// Release a pause of the writer
    pub fn resume(&self) {
        self.release(None, HoldReason::Pause);
    }

    /// Is a workbook held, by a hold of the writer or of the workbook?
    pub fn is_workbook_held(&self, workbook_id: &str) -> bool {
        self.shared.state.borrow().is_workbook_held(workbook_id)
    }

    /// The reasons that hold a workbook itself, without the holds of the writer
    pub fn workbook_holds(&self, workbook_id: &str) -> Vec<HoldReason> {
        self.shared.state.borrow().workbook_holds.get(workbook_id).map(|holds| holds.keys().copied().collect()).unwrap_or_default()
    }

    /// What the writer holds and what failed
    pub fn status(&self) -> WriterStatus {
        self.shared.state.borrow().status()
    }

    /// The failed keys of a workbook with their last errors
    pub fn failed_writes_for_workbook(&self, workbook_id: &str) -> Vec<FailedWrite> {
        self.status().failed.into_iter().filter(|write| belongs_to_workbook(&write.key, workbook_id)).collect()
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

    /// Run every pending task right away and wait until all tasks ran. A flush writes past the holds of the writer,
    /// they stay; the tasks of a held workbook stay pending, they would overwrite what the hold protects.
    pub fn flush(&self) -> impl Future<Output = ()> + 'static {
        let shared = self.shared.clone();
        async move {
            let keys = update(&shared, |state| state.pending_keys());
            for key in keys {
                let ran = update(&shared, |state| state.process(&key, true));
                if let Some(ran) = ran {
                    ran.await;
                }
            }
            settle(shared).await;
        }
    }

    /// Write the pending tasks of a workbook right away and wait until they ran.
    ///
    /// True when every pending write of the workbook reached the storage. A held writer or workbook keeps its writes
    /// pending and gives false: unlike a flush, it never forces them, they would overwrite an external change. A
    /// failed write stays pending and gives false, it runs again after its backoff.
    pub fn flush_workbook(&self, workbook_id: &str) -> impl Future<Output = bool> + 'static {
        let shared = self.shared.clone();
        let workbook_id = workbook_id.to_string();
        async move {
            let flushed = update(&shared, |state| {
                if state.is_workbook_held(&workbook_id) {
                    return false;
                }
                let keys: Vec<String> = state.pending_keys().into_iter().filter(|key| belongs_to_workbook(key, &workbook_id)).collect();
                for key in keys {
                    state.process(&key, false);
                }
                true
            });
            if !flushed {
                return false;
            }
            settle(shared.clone()).await;
            // A write that would overwrite an external change holds the workbook and stays pending
            let state = shared.state.borrow();
            !state.is_workbook_held(&workbook_id) && !state.failures.keys().any(|key| belongs_to_workbook(key, &workbook_id))
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
            update(&shared, |state| state.forget_workbook(&workbook_id));
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
