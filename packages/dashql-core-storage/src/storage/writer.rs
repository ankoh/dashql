//! The storage writer: debounced writes of workbooks and connections.
//!
//! A write has a key (`keys`) and a task. A newer write of a pending key replaces the task and keeps the place and the
//! timer of the first one, the caller of the replaced task learns that it was superseded. A timer runs a task after its
//! debounce duration, the tasks of a chain (`keys::chain_key`) run one after another.
//!
//! The tasks of one file keep their order (`WriteTask::files`): a write, a delete and a rename of a script file, the
//! creation and the patches of a workbook file. A task waits for the earlier pending tasks of its files, and a newer
//! task replaces a pending one of its key only when no task of the same files was scheduled after it, else it queues
//! behind. A task that failed keeps its place, the later tasks of its files wait for it.
//!
//! Holds keep tasks pending. A hold has a reason (`HoldReason`) and is counted: every hold is released on its own, a
//! check of a folder releases the hold it took and not the one of an open question. A pause of the writer keeps every
//! task pending, a forced flush (`flush`, e.g. when the page hides) writes past it. Every other hold is never forced: a
//! handover keeps the writes of a tab that another tab took over, a write that would overwrite a script or a workbook
//! file that changed outside the app holds its workbook (`HoldReason::ExternalChange`) until the host decides between
//! the disk and the app, a reload or an import holds the workbook it replaces. A task may pass the hold of its caller
//! (`write_past`), e.g. the writes of an import that holds the workbook it replaces.
//!
//! A task that failed for a moment (`WriteError::is_permanent`) runs again after a backoff, one whose target is gone
//! stops until a newer task of its key replaces it or the host discards it. Its key and its last error are part of the
//! status of the writer (`WriterStatus`) until a write of the key succeeds or the task is cancelled.
//!
//! The writer records the stamps of the scripts and workbook files it writes (`stamps`), a write expects what the app
//! wrote or acknowledged on disk.
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
    attachment_file, attachment_key, attachment_rename_key, belongs_to_workbook, chain_key, connection_entry_key,
    connection_file_key, connection_file_prefix, script_deletion_key, script_file, script_key, script_rename_key,
    workbook_attachment_list_key, workbook_connection_copy_key, workbook_creation_key, workbook_file_key,
    workbook_script_list_key,
};
use super::stamps::{Expect, FolderStamps};
use super::workbook_file::{
    attachments_patch, created_workbook_file, properties_patch, same_file, upsert_connection_entry, CreatedWorkbook,
};
use super::StorageHost;
use crate::workbook_format::data::{WorkbookCloudLink, WorkbookConnection, WorkbookData, WorkbookScript};
use crate::workbook_format::files::{file_name_key, patch_workbook_connection, with_workbook_scripts};
use dashql_core_runtime::host::signal::{cancellable, oneshot, CancelHandle, Receiver, Sender};
use dashql_core_runtime::host::{HostError, LogLevel};
use dashql_core_runtime::http::HostBytes;
use dashql_core_runtime::time::iso_timestamp_f64;

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
    /// Write the workbook file of a new workbook: the given connection, the name and the ephemeral marker. The
    /// scripts, the connections, the creation time and the attachments on disk stay.
    CreateWorkbook {
        workbook_id: String,
        name: Option<String>,
        connection: Option<WorkbookConnection>,
        ephemeral: bool,
        original_file_name: Option<String>,
    },
    /// Patch the properties that the user owns into the workbook file. A write without `ephemeral` promotes the
    /// workbook, one without `cloud` removes the link to the cloud.
    WriteWorkbookProperties {
        workbook_id: String,
        name: Option<String>,
        ephemeral: bool,
        cloud: Option<WorkbookCloudLink>,
    },
    /// Insert or replace a connection entry of the app manifest
    WriteConnectionEntry {
        entry: Value,
    },
    /// Remove a connection entry of the app manifest and the files of the connection
    DeleteConnectionEntry {
        connection_id: String,
    },
    /// Write a file of a connection
    WriteConnectionFile {
        connection_id: String,
        file_name: String,
        text: TextSource,
    },
    /// Patch the copies of a connection into an existing workbook file, see `files::patch_workbook_connection`
    PatchWorkbookConnection {
        workbook_id: String,
        copy: WorkbookConnection,
        replaced: Vec<String>,
    },
    WriteScript {
        workbook_id: String,
        file_name: String,
        text: String,
    },
    DeleteScript {
        workbook_id: String,
        file_name: String,
    },
    RenameScript {
        workbook_id: String,
        from: String,
        to: String,
    },
    /// Patch the script list and the copies of the connections it uses into the workbook file
    WriteWorkbookScripts {
        workbook_id: String,
        scripts: Vec<WorkbookScript>,
        connections: Vec<WorkbookConnection>,
    },
    /// Patch the attachment list of the workbook file from the attachments on disk
    RefreshWorkbookAttachments {
        workbook_id: String,
    },
    /// Save an attachment of a workbook, a file that stays with the host
    SaveDataFile {
        workbook_id: String,
        file_name: String,
        file: HostBytes,
    },
    /// Rename an attachment of a workbook, its contents are unchanged
    RenameDataFile {
        workbook_id: String,
        from: String,
        to: String,
    },
}

impl WriteTask {
    /// The key that the runtime writes the task under (`keys`), e.g. for a write that the host schedules. A connection
    /// copy is keyed by the connection it replaces, or its own.
    pub fn key(&self) -> String {
        match self {
            WriteTask::CreateWorkbook { workbook_id, .. } => workbook_creation_key(workbook_id),
            WriteTask::WriteWorkbookProperties { workbook_id, .. } => workbook_file_key(workbook_id),
            WriteTask::WriteConnectionEntry { entry } => {
                connection_entry_key(entry.get("id").and_then(Value::as_str).unwrap_or_default())
            }
            WriteTask::DeleteConnectionEntry { connection_id } => connection_entry_key(connection_id),
            WriteTask::WriteConnectionFile { connection_id, file_name, .. } => {
                connection_file_key(connection_id, file_name)
            }
            WriteTask::PatchWorkbookConnection { workbook_id, copy, replaced } => {
                workbook_connection_copy_key(workbook_id, replaced.first().unwrap_or(&copy.connection_id))
            }
            WriteTask::WriteScript { workbook_id, file_name, .. } => script_key(workbook_id, file_name),
            WriteTask::DeleteScript { workbook_id, file_name } => script_deletion_key(workbook_id, file_name),
            WriteTask::RenameScript { workbook_id, from, .. } => script_rename_key(workbook_id, from),
            WriteTask::WriteWorkbookScripts { workbook_id, .. } => workbook_script_list_key(workbook_id),
            WriteTask::RefreshWorkbookAttachments { workbook_id } => workbook_attachment_list_key(workbook_id),
            WriteTask::SaveDataFile { workbook_id, file_name, .. } => attachment_key(workbook_id, file_name),
            WriteTask::RenameDataFile { workbook_id, from, .. } => attachment_rename_key(workbook_id, from),
        }
    }

    /// The files that the task writes, deletes or renames. The tasks of a file keep their order. Two names of the same
    /// file name the same file, a file belongs to the chain of the key of its task.
    pub fn files(&self) -> Vec<String> {
        match self {
            WriteTask::CreateWorkbook { workbook_id, .. }
            | WriteTask::WriteWorkbookProperties { workbook_id, .. }
            | WriteTask::PatchWorkbookConnection { workbook_id, .. }
            | WriteTask::WriteWorkbookScripts { workbook_id, .. }
            | WriteTask::RefreshWorkbookAttachments { workbook_id } => vec![workbook_file_key(workbook_id)],
            WriteTask::WriteScript { workbook_id, file_name, .. }
            | WriteTask::DeleteScript { workbook_id, file_name } => {
                vec![script_file(workbook_id, file_name)]
            }
            WriteTask::RenameScript { workbook_id, from, to } => {
                let (from, to) = (script_file(workbook_id, from), script_file(workbook_id, to));
                if from == to {
                    vec![from]
                } else {
                    vec![from, to]
                }
            }
            WriteTask::SaveDataFile { workbook_id, file_name, .. } => vec![attachment_file(workbook_id, file_name)],
            WriteTask::RenameDataFile { workbook_id, from, to } => {
                let (from, to) = (attachment_file(workbook_id, from), attachment_file(workbook_id, to));
                if from == to {
                    vec![from]
                } else {
                    vec![from, to]
                }
            }
            WriteTask::WriteConnectionEntry { .. } | WriteTask::DeleteConnectionEntry { .. } => vec![self.key()],
            WriteTask::WriteConnectionFile { connection_id, file_name, .. } => {
                vec![connection_file_key(connection_id, file_name)]
            }
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
    /// Another tab took over the app, nothing is written any more
    Handover,
    /// The host paused the writes, e.g. while it moves a workbook. The only hold that a forced flush passes.
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
    /// The target of the write is gone, the writer stopped retrying it
    pub permanent: bool,
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
        self.holds
            .iter()
            .filter(|hold| hold.reason == HoldReason::ExternalChange)
            .filter_map(|hold| hold.workbook_id.as_deref())
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

/// The name of the recovery copy of a script, the `n`th if the first ones are taken
fn recovery_name(file_name: &str, n: u32) -> String {
    let base = file_name.strip_suffix(".sql").unwrap_or(file_name);
    match n {
        1 => format!("{base} (recovered).sql"),
        n => format!("{base} (recovered {n}).sql"),
    }
}

/// Why a write failed
#[derive(Clone, Debug)]
pub enum WriteError {
    Host(HostError),
    /// The workbook file of a workbook is not available, e.g. its native folder was moved or deleted. A patch never
    /// creates a workbook file.
    WorkbookUnavailable {
        workbook_id: String,
        cause: HostError,
    },
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

    /// Does another attempt fail the same way? The target of the write is gone, e.g. a moved workbook folder. Other
    /// failures may pass, e.g. a full disk or a lock of another process.
    pub fn is_permanent(&self) -> bool {
        match self {
            WriteError::Host(error) => error.is_unavailable(),
            WriteError::WorkbookUnavailable { .. } => true,
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
    key: String,
    task: WriteTask,
    /// The files of the task, see `WriteTask::files`
    files: Vec<String>,
    /// Resolves the caller of the task, none once it was told
    resolver: Option<Sender<WriteOutcome>>,
    debounce_ms: f64,
    /// The armed timer
    timer: Option<u64>,
    /// The task should run, an earlier task of its files keeps it waiting
    due: bool,
    /// The target of the task is gone, it runs again once a newer task replaces it
    stopped: bool,
    /// The hold that the task passes
    passes: Option<HoldReason>,
}

impl PendingTask {
    fn shares_file(&self, files: &[String]) -> bool {
        self.files.iter().any(|file| files.contains(file))
    }
}

struct Execution {
    /// The place of the task in the order of the tasks
    seq: u64,
    pending: PendingTask,
    /// Tells a flush that the task ran
    done: Sender<()>,
}

/// The tasks of a chain that wait, and whether one of them runs
#[derive(Default)]
struct Chain {
    queue: VecDeque<Execution>,
    running: bool,
}

/// What the host is told once the state is released
enum Effect {
    Resolve(Sender<WriteOutcome>, WriteOutcome),
    Done(Sender<()>),
    ArmTimer { seq: u64, timer: u64, ms: f64 },
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
    permanent: bool,
}

#[derive(Default)]
struct State {
    /// The pending tasks by their place in the order of the tasks. A key has more than one pending task when a task of
    /// the same files was scheduled in between.
    pending: BTreeMap<u64, PendingTask>,
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
    /// The chains with tasks that wait or run
    chains: HashMap<String, Chain>,
    in_flight: usize,
    settle_waiters: Vec<Sender<()>>,
    /// The latest generation of every key, every scheduled write advances it. A deleted workbook drops its keys.
    generations: HashMap<String, u64>,
    next_generation: u64,
    statistics: BTreeMap<String, WriteStatistics>,
    effects: Vec<Effect>,
}

impl State {
    /// Does a hold keep a task of a key pending? A forced write passes a pause of the writer, a task passes the hold
    /// of its caller.
    fn is_held(&self, key: &str, force: bool, passes: Option<HoldReason>) -> bool {
        let blocks = |reason: &HoldReason| Some(*reason) != passes;
        let writer = self.holds.keys().any(|reason| blocks(reason) && !(force && *reason == HoldReason::Pause));
        let workbook = workbook_of_key(key)
            .and_then(|id| self.workbook_holds.get(id))
            .is_some_and(|holds| holds.keys().any(blocks));
        writer || workbook
    }

    fn is_workbook_held(&self, workbook_id: &str) -> bool {
        !self.holds.is_empty() || self.workbook_holds.contains_key(workbook_id)
    }

    fn is_deleted(&self, key: &str) -> bool {
        self.deleted_workbooks.iter().any(|id| belongs_to_workbook(key, id))
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
        let mut holds: Vec<WriteHold> = self
            .holds
            .iter()
            .map(|(reason, count)| WriteHold { workbook_id: None, reason: *reason, count: *count })
            .collect();
        let mut workbooks: Vec<(&String, &BTreeMap<HoldReason, u32>)> = self.workbook_holds.iter().collect();
        workbooks.sort_by(|a, b| a.0.cmp(b.0));
        for (id, reasons) in workbooks {
            holds.extend(reasons.iter().map(|(reason, count)| WriteHold {
                workbook_id: Some(id.clone()),
                reason: *reason,
                count: *count,
            }));
        }
        let mut failed: Vec<(u64, FailedWrite)> = self
            .failures
            .iter()
            .map(|(key, failure)| {
                let seq =
                    self.pending.iter().find(|(_, pending)| pending.key == *key).map_or(u64::MAX, |(seq, _)| *seq);
                let write = FailedWrite {
                    key: key.clone(),
                    workbook_id: workbook_of_key(key).map(str::to_string),
                    error: failure.error.clone(),
                    attempts: failure.attempts,
                    permanent: failure.permanent,
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

    /// The pending keys in the order they were scheduled, each once
    fn pending_keys(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        self.pending
            .values()
            .filter(|pending| seen.insert(pending.key.as_str()))
            .map(|pending| pending.key.clone())
            .collect()
    }

    /// The pending tasks of a key, by their places
    fn seqs_of(&self, key: &str) -> Vec<u64> {
        self.pending.iter().filter(|(_, pending)| pending.key == key).map(|(seq, _)| *seq).collect()
    }

    /// Does an earlier pending task share a file with the task at a place? A task that passes a hold doesn't wait for
    /// the tasks that the hold keeps, e.g. the writes of an import for the edits of the version it replaces.
    fn is_blocked(&self, seq: u64, files: &[String], passes: Option<HoldReason>) -> bool {
        self.pending.range(..seq).any(|(_, earlier)| {
            earlier.shares_file(files) && !(passes.is_some() && self.is_held(&earlier.key, false, earlier.passes))
        })
    }

    /// Is the first later pending task of the files of a task one of its key? Then that task replaces it.
    fn is_subsumed(&self, seq: u64, key: &str, files: &[String]) -> bool {
        self.pending
            .range(seq + 1..)
            .find(|(_, later)| later.shares_file(files))
            .is_some_and(|(_, later)| later.key == key)
    }

    fn remove_pending(&mut self, seq: u64) -> Option<PendingTask> {
        let mut pending = self.pending.remove(&seq)?;
        self.clear_timer(&mut pending);
        Some(pending)
    }

    fn arm_timer(&mut self, seq: u64) {
        let Some(pending) = self.pending.get_mut(&seq) else { return };
        let previous = pending.timer.take();
        let timer = self.next_timer;
        self.next_timer += 1;
        pending.timer = Some(timer);
        let ms = pending.debounce_ms;
        if let Some(previous) = previous {
            self.cancel_timer(previous);
        }
        self.timers.insert(timer, None);
        self.effects.push(Effect::ArmTimer { seq, timer, ms });
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
            .values_mut()
            .filter(|pending| select(&pending.key))
            .filter_map(|pending| pending.timer.take())
            .collect();
        for timer in timers {
            self.cancel_timer(timer);
        }
    }

    /// Wait for the debounce duration again, a stopped task waits for a newer one
    fn rearm_timers_where(&mut self, select: impl Fn(&str) -> bool) {
        let seqs: Vec<u64> = self
            .pending
            .iter()
            .filter(|(_, pending)| !pending.stopped && select(&pending.key))
            .map(|(seq, _)| *seq)
            .collect();
        for seq in seqs {
            self.arm_timer(seq);
        }
    }

    /// Schedule a task, returns its place
    fn schedule(
        &mut self,
        key: &str,
        task: WriteTask,
        debounce_ms: f64,
        passes: Option<HoldReason>,
    ) -> (WriteResult, Option<u64>) {
        let (sender, receiver) = oneshot();
        // Writes that were queued while a workbook was deleted must not recreate its files
        if self.is_deleted(key) {
            self.resolve(Some(sender), WriteOutcome::Cancelled);
            return (WriteResult(receiver), None);
        }
        let generation = self.next_generation + 1;
        self.next_generation = generation;
        self.generations.insert(key.to_string(), generation);
        let files = task.files();
        // A newer task takes the place of the last pending one of its key, unless a task of the same files was
        // scheduled after that one: it would run before the other
        let latest = self.seqs_of(key).last().copied();
        let replaced = latest.filter(|seq| {
            let known = self.pending.get(seq).map(|pending| pending.files.clone()).unwrap_or_default();
            !self.pending.range(seq + 1..).any(|(_, later)| later.shares_file(&files) || later.shares_file(&known))
        });
        let seq = match replaced.and_then(|seq| self.pending.get_mut(&seq).map(|pending| (seq, pending))) {
            Some((seq, pending)) => {
                // The newer task keeps the place, the debounce duration and the timer of the first one
                let previous = pending.resolver.replace(sender);
                pending.task = task;
                pending.files = files;
                pending.passes = passes;
                // A stopped task gets another attempt after the debounce duration of the newer one
                let restart = std::mem::replace(&mut pending.stopped, false);
                if restart {
                    pending.debounce_ms = debounce_ms.max(0.0);
                }
                self.resolve(previous, WriteOutcome::Superseded);
                if restart {
                    self.arm_timer(seq);
                }
                seq
            }
            None => {
                let seq = self.next_seq;
                self.next_seq += 1;
                let pending = PendingTask {
                    key: key.to_string(),
                    task,
                    files,
                    resolver: Some(sender),
                    debounce_ms: debounce_ms.max(0.0),
                    timer: None,
                    due: false,
                    stopped: false,
                    passes,
                };
                self.pending.insert(seq, pending);
                self.arm_timer(seq);
                seq
            }
        };
        self.register_scheduled_write(key);
        (WriteResult(receiver), Some(seq))
    }

    /// Start a pending task: it leaves the pending tasks and waits for the tasks of its chain. A held task stays
    /// pending, a forced one passes a pause of the writer. A task that waits for an earlier task of its files becomes
    /// due and starts once that one is done. Returns what completes once the task ran.
    fn process(&mut self, seq: u64, force: bool) -> Option<Receiver<()>> {
        let pending = self.pending.get(&seq)?;
        if self.is_held(&pending.key, force, pending.passes) {
            return None;
        }
        if self.is_blocked(seq, &pending.files, pending.passes) {
            if let Some(pending) = self.pending.get_mut(&seq) {
                pending.due = true;
            }
            return None;
        }
        let mut pending = self.remove_pending(seq)?;
        pending.due = false;
        let (done, ran) = oneshot();
        let chain = chain_key(&pending.key);
        let entry = self.chains.entry(chain.clone()).or_default();
        let idle = !entry.running && entry.queue.is_empty();
        entry.queue.push_back(Execution { seq, pending, done });
        self.in_flight += 1;
        if idle {
            self.effects.push(Effect::RunChain(chain));
        }
        Some(ran)
    }

    /// Start a task with the earlier pending tasks of its files first, e.g. a write that runs right away
    fn process_with_predecessors(&mut self, seq: u64, force: bool) {
        let files = match self.pending.get(&seq) {
            Some(pending) => pending.files.clone(),
            None => return,
        };
        let earlier: Vec<u64> = self
            .pending
            .range(..seq)
            .filter(|(_, earlier)| !earlier.stopped && earlier.shares_file(&files))
            .map(|(seq, _)| *seq)
            .collect();
        for earlier in earlier {
            self.process(earlier, force);
        }
        self.process(seq, force);
    }

    /// Start the due tasks that nothing keeps waiting any more
    fn run_due(&mut self) {
        loop {
            let due: Vec<u64> = self
                .pending
                .iter()
                .filter(|(_, pending)| pending.due && !pending.stopped)
                .map(|(seq, _)| *seq)
                .collect();
            let started = due.into_iter().filter(|seq| self.process(*seq, false).is_some()).count();
            if started == 0 {
                return;
            }
        }
    }

    /// The task leaves the chain, the tasks that wait for it may start
    fn leave_chain(&mut self, done: Sender<()>) {
        self.effects.push(Effect::Done(done));
        self.in_flight = self.in_flight.saturating_sub(1);
        if self.in_flight == 0 {
            for waiter in std::mem::take(&mut self.settle_waiters) {
                self.effects.push(Effect::Done(waiter));
            }
        }
    }

    /// A task of a chain waits for an earlier task of its files that failed meanwhile: it returns to its place
    fn defer(&mut self, execution: Execution) {
        let Execution { seq, mut pending, done } = execution;
        pending.due = true;
        self.pending.insert(seq, pending);
        self.leave_chain(done);
    }

    /// Apply the result of a task that ran
    fn finish(&mut self, execution: Execution, result: Result<(), WriteError>) {
        let Execution { seq, mut pending, done } = execution;
        let key = pending.key.clone();
        let deleted = self.is_deleted(&key);
        match result {
            Ok(()) => {
                let resolver = pending.resolver.take();
                self.resolve(resolver, WriteOutcome::Written);
                self.clear_failure(&key);
            }
            // The workbook was deleted while the task ran, nothing of it is kept
            Err(_) if deleted => {
                let resolver = pending.resolver.take();
                self.resolve(resolver, WriteOutcome::Cancelled);
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
                if self.is_subsumed(seq, &key, &pending.files) {
                    // A newer task with the same key was scheduled while this one ran
                    let resolver = pending.resolver.take();
                    self.resolve(resolver, WriteOutcome::Superseded);
                } else {
                    // The task keeps its place, it runs once the hold is released
                    self.pending.insert(seq, pending);
                }
            }
            Err(error) => {
                let message = error.message();
                let permanent = error.is_permanent();
                let attempts = self.failures.get(&key).map_or(0, |failure| failure.attempts) + 1;
                // A failure that passes is retried quietly, a stopped write is shown once
                let level = if permanent && attempts == 1 { LogLevel::Error } else { LogLevel::Warn };
                let message_of_log =
                    if permanent { "write task failed, its target is gone" } else { "write task failed, retrying it" };
                self.log(level, message_of_log, &[("key", &key), ("error", &message)]);
                let resolver = pending.resolver.take();
                self.resolve(resolver, WriteOutcome::Failed(error));
                self.failures.insert(key.clone(), Failure { error: message, attempts, permanent });
                self.status_changed = true;
                // The task keeps its place unless a newer task replaced it, the later tasks of its files wait for it
                if !self.is_subsumed(seq, &key, &pending.files) {
                    pending.stopped = permanent;
                    pending.debounce_ms = retry_delay_ms(attempts);
                    self.pending.insert(seq, pending);
                    if !permanent && !self.is_held(&key, false, None) {
                        self.arm_timer(seq);
                    }
                }
            }
        }
        self.leave_chain(done);
        self.run_due();
    }

    /// Discard the pending tasks of a key, their callers learn that they were cancelled
    fn cancel(&mut self, key: &str) {
        for seq in self.seqs_of(key) {
            if let Some(mut pending) = self.remove_pending(seq) {
                let resolver = pending.resolver.take();
                self.resolve(resolver, WriteOutcome::Cancelled);
            }
        }
        self.clear_failure(key);
    }

    /// Discard the pending tasks of a workbook
    fn cancel_workbook(&mut self, workbook_id: &str) {
        let keys: Vec<String> =
            self.pending_keys().into_iter().filter(|key| belongs_to_workbook(key, workbook_id)).collect();
        for key in keys {
            self.cancel(&key);
        }
        let failed: Vec<String> =
            self.failures.keys().filter(|key| belongs_to_workbook(key, workbook_id)).cloned().collect();
        for key in failed {
            self.clear_failure(&key);
        }
    }

    /// Forget a deleted workbook: its pending tasks, holds, generations, statistics and failures
    fn forget_workbook(&mut self, workbook_id: &str) {
        self.cancel_workbook(workbook_id);
        if self.workbook_holds.remove(workbook_id).is_some() {
            self.status_changed = true;
        }
        self.generations.retain(|key, _| !belongs_to_workbook(key, workbook_id));
        self.statistics.retain(|key, _| !belongs_to_workbook(key, workbook_id));
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
    /// The stamps of the folders that may change outside the app
    stamps: Rc<FolderStamps>,
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
            Effect::ArmTimer { seq, timer, ms } => arm(shared, seq, timer, ms),
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
fn arm<H: StorageHost>(shared: &Rc<Shared<H>>, seq: u64, timer: u64, ms: f64) {
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
            match state.pending.get_mut(&seq) {
                Some(pending) if pending.timer == Some(timer) => pending.timer = None,
                _ => return,
            }
            state.process(seq, false);
            state.run_due();
        });
    }));
}

/// Run the tasks of a chain one after another until none waits
async fn run_chain<H: StorageHost>(shared: Rc<Shared<H>>, chain: String) {
    loop {
        // The task leaves the queue while it runs, a task that joins the chain meanwhile waits behind it
        let next = update(&shared, |state| loop {
            let entry = state.chains.get_mut(&chain)?;
            let Some(execution) = entry.queue.pop_front() else {
                state.chains.remove(&chain);
                return None;
            };
            // An earlier task of its files failed after the task joined the chain
            if state.is_blocked(execution.seq, &execution.pending.files, execution.pending.passes) {
                state.defer(execution);
                continue;
            }
            entry_running(state, &chain, true);
            return Some(execution);
        });
        let Some(execution) = next else { return };
        let result = execute(&shared, &execution.pending.key, &execution.pending.task).await;
        update(&shared, |state| {
            entry_running(state, &chain, false);
            state.finish(execution, result);
        });
    }
}

/// Mark the chain as running a task or idle
fn entry_running(state: &mut State, chain: &str, running: bool) {
    if let Some(entry) = state.chains.get_mut(chain) {
        entry.running = running;
    }
}

/// Write a file and record the write with its size and duration
async fn timed_write<H: StorageHost, T>(
    shared: &Rc<Shared<H>>,
    path: &str,
    bytes: usize,
    write: impl Future<Output = Result<T, HostError>>,
) -> Result<T, HostError> {
    let before = shared.host.now();
    let written = write.await?;
    let now = shared.host.now();
    update(shared, |state| state.register_write(path, bytes, now - before, now));
    Ok(written)
}

fn log<H: StorageHost>(shared: &Rc<Shared<H>>, level: LogLevel, message: &str, details: &[(&str, &str)]) {
    shared.host.log(level, message, details);
}

/// Save the workbook file of a workbook, expecting what the app wrote or acknowledged, and record the write
async fn save_workbook_file<H: StorageHost>(
    shared: &Rc<Shared<H>>,
    workbook_id: &str,
    workbook: &WorkbookData,
) -> Result<(), HostError> {
    let json = workbook.to_json();
    let bytes = serde_json::to_string_pretty(&json).map(|text| text.len()).unwrap_or_default();
    let expect = shared.stamps.expect_workbook(workbook_id);
    let stamp = timed_write(
        shared,
        &workbook_file_key(workbook_id),
        bytes,
        shared.host.save_workbook(workbook_id, &json, expect),
    )
    .await?;
    shared.stamps.wrote_workbook(workbook_id, stamp);
    Ok(())
}

/// Save a script, expecting what the app wrote or acknowledged, and record the write
async fn save_script_file<H: StorageHost>(
    shared: &Rc<Shared<H>>,
    workbook_id: &str,
    file_name: &str,
    text: &str,
    expect: Expect,
) -> Result<(), HostError> {
    let write = shared.host.save_script(workbook_id, file_name, text, expect);
    let stamp = timed_write(shared, &script_key(workbook_id, file_name), text.len(), write).await?;
    shared.stamps.wrote_script(workbook_id, file_name, stamp);
    Ok(())
}

/// The workbook file of a workbook, none if there is none
async fn load_workbook_file<H: StorageHost>(shared: &Rc<Shared<H>>, workbook_id: &str) -> Option<WorkbookData> {
    shared.host.load_workbook(workbook_id).await.ok().map(|json| WorkbookData::from_json(&json))
}

/// A failure of a host call on the files of a workbook: a target that is gone makes the workbook unavailable
fn workbook_error(workbook_id: &str, error: HostError) -> WriteError {
    if error.is_unavailable() {
        WriteError::WorkbookUnavailable { workbook_id: workbook_id.to_string(), cause: error }
    } else {
        WriteError::Host(error)
    }
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
    save_workbook_file(shared, workbook_id, &next).await.map_err(|error| workbook_error(workbook_id, error))
}

async fn execute<H: StorageHost>(shared: &Rc<Shared<H>>, key: &str, task: &WriteTask) -> Result<(), WriteError> {
    let host = &shared.host;
    let stamps = &shared.stamps;
    match task {
        WriteTask::CreateWorkbook { workbook_id, name, connection, ephemeral, original_file_name } => {
            log(shared, LogLevel::Info, "Creating workbook", &[("key", key), ("workbookId", workbook_id)]);
            // A workbook file on disk keeps its scripts, its name and its creation time
            let existing = load_workbook_file(shared, workbook_id).await;
            let now = iso_timestamp_f64(host.now());
            let created = CreatedWorkbook {
                workbook_id,
                format_version: shared.format_version,
                name: name.as_deref(),
                connection: connection.as_ref(),
                ephemeral: *ephemeral,
                original_file_name: original_file_name.as_deref(),
                now: &now,
            };
            let next = created_workbook_file(existing.as_ref(), &created);
            if existing.as_ref().is_some_and(|existing| same_file(existing, &next)) {
                return Ok(());
            }
            save_workbook_file(shared, workbook_id, &next).await.map_err(|error| workbook_error(workbook_id, error))?;
        }
        WriteTask::WriteWorkbookProperties { workbook_id, name, ephemeral, cloud } => {
            patch_workbook_file(shared, key, workbook_id, |existing| {
                properties_patch(existing, name.as_deref(), *ephemeral, cloud.as_ref())
            })
            .await?;
        }
        WriteTask::WriteWorkbookScripts { workbook_id, scripts, connections } => {
            patch_workbook_file(shared, key, workbook_id, |existing| {
                with_workbook_scripts(existing, scripts.clone(), connections)
            })
            .await?;
        }
        WriteTask::SaveDataFile { workbook_id, file_name, file } => {
            log(shared, LogLevel::Info, "Writing attachment", &[("key", key), ("workbookId", workbook_id)]);
            let write = host.save_data_file(workbook_id, file_name, file);
            timed_write(shared, key, file.len(), write).await.map_err(|error| workbook_error(workbook_id, error))?;
        }
        WriteTask::RefreshWorkbookAttachments { workbook_id } => {
            let names = host.list_attachments(workbook_id).await.map_err(|error| workbook_error(workbook_id, error))?;
            patch_workbook_file(shared, key, workbook_id, |existing| attachments_patch(existing, &names)).await?;
        }
        WriteTask::WriteConnectionEntry { entry } => {
            let bytes = serde_json::to_string(entry).map(|text| text.len()).unwrap_or_default();
            let upserted = entry.clone();
            let update = Box::new(move |connections: Option<Vec<Value>>| {
                upsert_connection_entry(connections.as_deref(), &upserted)
            });
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
            timed_write(
                shared,
                &connection_file_key(connection_id, file_name),
                text.len(),
                host.save_connection_file(connection_id, file_name, &text),
            )
            .await?;
        }
        WriteTask::PatchWorkbookConnection { workbook_id, copy, replaced } => {
            // Only an existing workbook file is patched
            patch_workbook_file(shared, key, workbook_id, |existing| {
                patch_workbook_connection(existing, copy, replaced).unwrap_or_else(|| existing.clone())
            })
            .await?;
        }
        WriteTask::WriteScript { workbook_id, file_name, text } => {
            log(
                shared,
                LogLevel::Info,
                "Writing workbook script",
                &[("key", key), ("workbookId", workbook_id), ("file", file_name)],
            );
            let expect = stamps.expect_script(workbook_id, file_name);
            save_script_file(shared, workbook_id, file_name, text, expect)
                .await
                .map_err(|error| workbook_error(workbook_id, error))?;
        }
        WriteTask::DeleteScript { workbook_id, file_name } => {
            log(
                shared,
                LogLevel::Info,
                "Deleting workbook script",
                &[("key", key), ("workbookId", workbook_id), ("file", file_name)],
            );
            let expect = stamps.expect_script(workbook_id, file_name);
            host.delete_script(workbook_id, file_name, expect)
                .await
                .map_err(|error| workbook_error(workbook_id, error))?;
            stamps.deleted_script(workbook_id, file_name);
        }
        WriteTask::RenameScript { workbook_id, from, to } => {
            log(
                shared,
                LogLevel::Info,
                "Renaming workbook script",
                &[("key", key), ("workbookId", workbook_id), ("from", from), ("to", to)],
            );
            let expect_from = stamps.expect_script(workbook_id, from);
            // A rename that only changes the case or the Unicode form of a name moves the file onto itself
            let expect_to = if file_name_key(from) == file_name_key(to) {
                Expect::Any
            } else {
                stamps.expect_script(workbook_id, to)
            };
            host.rename_script(workbook_id, from, to, expect_from, expect_to)
                .await
                .map_err(|error| workbook_error(workbook_id, error))?;
            stamps.renamed_script(workbook_id, from, to);
        }
        WriteTask::RenameDataFile { workbook_id, from, to } => {
            log(
                shared,
                LogLevel::Info,
                "Renaming attachment",
                &[("key", key), ("workbookId", workbook_id), ("from", from), ("to", to)],
            );
            host.rename_data_file(workbook_id, from, to).await.map_err(|error| workbook_error(workbook_id, error))?;
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
        Self::with_stamps(host, format_version, Rc::default())
    }

    /// A writer that records the stamps of its writes in stamps that the host shares, e.g. with the checks of folders
    pub fn with_stamps(host: H, format_version: i64, stamps: Rc<FolderStamps>) -> StorageWriter<H> {
        StorageWriter {
            shared: Rc::new(Shared { host, format_version, stamps, state: RefCell::new(State::default()) }),
        }
    }

    pub fn host(&self) -> &H {
        &self.shared.host
    }

    /// The stamps of the folders that may change outside the app
    pub fn stamps(&self) -> &Rc<FolderStamps> {
        &self.shared.stamps
    }

    /// Schedule a debounced write. A newer write with the same key replaces a pending task and supersedes its caller.
    pub fn write(&self, key: &str, task: WriteTask, debounce_ms: f64) -> WriteResult {
        update(&self.shared, |state| state.schedule(key, task, debounce_ms, None).0)
    }

    /// Write without debouncing. The task replaces a pending task with the same key and runs right away, after the
    /// earlier tasks of its files and the running tasks of its chain. A paused writer or workbook defers it, it stays
    /// pending and runs on resume.
    pub fn write_durable(&self, key: &str, task: WriteTask) -> WriteResult {
        self.write_now(key, task, None)
    }

    /// Write right away past a hold of a reason, e.g. the writes of an import that holds the workbook it replaces
    pub fn write_past(&self, key: &str, task: WriteTask, reason: HoldReason) -> WriteResult {
        self.write_now(key, task, Some(reason))
    }

    fn write_now(&self, key: &str, task: WriteTask, passes: Option<HoldReason>) -> WriteResult {
        update(&self.shared, |state| {
            let (result, seq) = state.schedule(key, task, 0.0, passes);
            let Some(seq) = seq else { return result };
            if state.is_held(key, false, passes) {
                if let Some((timer, resolver)) =
                    state.pending.get_mut(&seq).map(|p| (p.timer.take(), p.resolver.take()))
                {
                    if let Some(timer) = timer {
                        state.cancel_timer(timer);
                    }
                    state.resolve(resolver, WriteOutcome::Deferred);
                }
            } else {
                state.process_with_predecessors(seq, false);
            }
            result
        })
    }

    /// Hold the writes of the writer (no workbook) or of a workbook for a reason. Nothing of it is written until the
    /// hold is released, writes scheduled meanwhile stay pending. A forced flush writes past a pause of the writer,
    /// never past another hold.
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
        self.shared
            .state
            .borrow()
            .workbook_holds
            .get(workbook_id)
            .map(|holds| holds.keys().copied().collect())
            .unwrap_or_default()
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
        self.pending_keys().into_iter().filter(|key| belongs_to_workbook(key, workbook_id)).collect()
    }

    /// Discard pending writes, their callers learn that they were cancelled, and the failures of their keys. Tasks that
    /// run already finish.
    pub fn cancel_pending_writes(&self, keys: &[String]) {
        update(&self.shared, |state| {
            for key in keys {
                state.cancel(key);
            }
            state.run_due();
        });
    }

    /// Discard the pending writes of a workbook
    pub fn cancel_pending_writes_for_workbook(&self, workbook_id: &str) {
        update(&self.shared, |state| state.cancel_workbook(workbook_id));
    }

    /// Discard the pending writes of the files of a connection that is deleted, they would create its folder again
    pub fn cancel_pending_connection_file_writes(&self, connection_id: &str) {
        let prefix = connection_file_prefix(connection_id);
        let keys: Vec<String> = self.pending_keys().into_iter().filter(|key| key.starts_with(&prefix)).collect();
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

    /// Run every pending task right away and wait until all tasks ran. A flush writes past a pause of the writer, which
    /// stays; the tasks that another hold keeps stay pending, e.g. of a held workbook or of a tab that handed over. A
    /// stopped task stays pending.
    pub fn flush(&self) -> impl Future<Output = ()> + 'static {
        let shared = self.shared.clone();
        async move {
            let seqs: Vec<u64> = update(&shared, |state| {
                state.pending.iter().filter(|(_, pending)| !pending.stopped).map(|(seq, _)| *seq).collect()
            });
            for seq in seqs {
                let ran = update(&shared, |state| state.process(seq, true));
                if let Some(ran) = ran {
                    ran.await;
                }
            }
            settle(shared).await;
        }
    }

    /// Another tab takes over the app: the pending writes are written, then nothing is written any more, not even by a
    /// flush (`HoldReason::Handover`). The writer is paused while it flushes, a write scheduled meanwhile stays pending.
    pub fn hand_over(&self) -> impl Future<Output = ()> + 'static {
        self.pause();
        let flush = self.flush();
        let writer = self.clone();
        async move {
            flush.await;
            writer.hold(None, HoldReason::Handover);
            writer.resume();
        }
    }

    /// Write a recovery copy of every script whose pending write a change outside the app or a reload holds, next to
    /// it in the folder of its workbook (`<name> (recovered).sql`), e.g. before the window closes while the question
    /// about the change is open. A copy never replaces a file, the writes stay pending.
    pub fn recover_held_scripts(&self) -> impl Future<Output = ()> + 'static {
        let shared = self.shared.clone();
        async move {
            let held: Vec<(String, String, String)> = {
                let state = shared.state.borrow();
                let is_held = |workbook_id: &str| {
                    state.workbook_holds.get(workbook_id).is_some_and(|holds| {
                        holds.contains_key(&HoldReason::ExternalChange) || holds.contains_key(&HoldReason::Reload)
                    })
                };
                state
                    .pending
                    .values()
                    .filter_map(|pending| match &pending.task {
                        WriteTask::WriteScript { workbook_id, file_name, text } if is_held(workbook_id) => {
                            Some((workbook_id.clone(), file_name.clone(), text.clone()))
                        }
                        _ => None,
                    })
                    .collect()
            };
            for (workbook_id, file_name, text) in held {
                for n in 1..=5 {
                    let name = recovery_name(&file_name, n);
                    match save_script_file(&shared, &workbook_id, &name, &text, Expect::Absent).await {
                        Ok(()) => {
                            log(
                                &shared,
                                LogLevel::Warn,
                                "Kept a held script as a recovery copy",
                                &[("workbookId", &workbook_id), ("file", &name)],
                            );
                            break;
                        }
                        // The name is taken, the next one is tried
                        Err(error) if error.external_change().is_some() => continue,
                        Err(error) => {
                            let details = [
                                ("workbookId", workbook_id.as_str()),
                                ("file", file_name.as_str()),
                                ("error", error.message()),
                            ];
                            log(&shared, LogLevel::Error, "Failed to keep a held script as a recovery copy", &details);
                            break;
                        }
                    }
                }
            }
        }
    }

    /// Write the pending tasks of a workbook right away and wait until they ran.
    ///
    /// True when every pending write of the workbook reached the storage. A held writer or workbook keeps its writes
    /// pending and gives false: unlike a flush, it never forces them, they would overwrite an external change. A
    /// failed write stays pending and gives false.
    pub fn flush_workbook(&self, workbook_id: &str) -> impl Future<Output = bool> + 'static {
        let shared = self.shared.clone();
        let workbook_id = workbook_id.to_string();
        async move {
            let flushed = update(&shared, |state| {
                if state.is_workbook_held(&workbook_id) {
                    return false;
                }
                let seqs: Vec<u64> = state
                    .pending
                    .iter()
                    .filter(|(_, pending)| !pending.stopped && belongs_to_workbook(&pending.key, &workbook_id))
                    .map(|(seq, _)| *seq)
                    .collect();
                for seq in seqs {
                    state.process(seq, false);
                }
                true
            });
            if !flushed {
                return false;
            }
            settle(shared.clone()).await;
            // A write that would overwrite an external change holds the workbook and stays pending
            let state = shared.state.borrow();
            !state.is_workbook_held(&workbook_id)
                && !state.failures.keys().any(|key| belongs_to_workbook(key, &workbook_id))
        }
    }

    /// Delete a workbook. Its pending writes and failures are discarded, the writes that run already finish first, and
    /// no write creates files of the workbook afterwards. A failed deletion accepts writes of the workbook again.
    pub fn delete_workbook(&self, workbook_id: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let shared = self.shared.clone();
        let workbook_id = workbook_id.to_string();
        async move {
            update(&shared, |state| {
                state.deleted_workbooks.insert(workbook_id.clone());
                state.cancel_workbook(&workbook_id);
            });
            settle(shared.clone()).await;
            if let Err(error) = shared.host.delete_workbook(&workbook_id).await {
                update(&shared, |state| {
                    state.deleted_workbooks.remove(&workbook_id);
                });
                return Err(error);
            }
            update(&shared, |state| state.forget_workbook(&workbook_id));
            shared.stamps.forget(&workbook_id);
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
