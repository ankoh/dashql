//! The runs of workbooks: a run of the whole workbook, of the scripts that a change of inputs affects, or of one
//! script with the scripts it references.
//!
//! A run is an async task on a `RunHost`. It analyzes the scripts of the workbook and publishes their declarations,
//! plans the scripts with the planner of the runtime (`planner::plan_session` through `Workbook::plan_run`), reuses
//! the stored results of the scripts whose keys match, plans again with the files of those results, and runs the nodes of
//! the plan across their connections: a node starts once its predecessors are done, at most a number of statements
//! of a connection run at once. The statements run through the host, which hands them to the query executor and keeps
//! the result tables. The run registers the queries and the results of the scripts on the workbook and captures the
//! visualization of every output, the host learns that the workbook changed. A statement is done once its result is
//! there: the analysis of the result runs on after it and holds up neither the statements that follow it nor the end
//! of the run, a Stop of the run stops the analyses of its results that still run. A failed statement cancels the running
//! ones, the run settles once they are done and then releases its files: the stored files it kept and the pins of the
//! files it scans and writes, then it removes its transient files (docs/design/workbook_results.md).

mod engine;
pub mod plan;
pub mod report;
pub mod result_key;

use std::future::Future;

use crate::executor::{HostValue, QueryId, StoredFile};
use crate::host::{Host, HostError, LocalFuture};
use crate::workbook::{ScriptKey, WorkbookEffect};
pub use engine::{start_run, RunHandle};
pub use plan::{PlanRun, PlannedStatement};
pub use result_key::ResultKey;

/// The target of the log messages of the runs
pub const LOG_TARGET: &str = "workbook_execution";

/// How a statement uses the stored result of its script
#[derive(Clone, Debug, PartialEq)]
pub enum StatementResult {
    /// It doesn't
    None,
    /// The statement runs and its result becomes the file of its script, named after the key. The run names the file
    /// when it plans, the keys of the scripts downstream of the script cover the name.
    Store { script: String, key: String, name: String },
    /// The statement reads a file of the results of the workbook or fails with a miss, it never runs
    Read { script: String, file: StoredFile },
}

/// A statement that a run hands to the host
#[derive(Clone, Debug)]
pub struct StatementRequest {
    /// The connection
    pub connection_id: String,
    /// The script of the statement, the owner of its result
    pub script_key: ScriptKey,
    /// The SQL text
    pub text: String,
    /// Analyze the result, the statement is the output of its script
    pub analyze_results: bool,
    /// Collect the result, a statement whose output nothing reads drains it
    pub publish_results: bool,
    /// The stored result of the script
    pub result: StatementResult,
    /// Where the statement comes from
    pub planned: PlannedStatement,
}

/// The failure of a statement or of a call of the host
#[derive(Clone)]
pub struct StatementFailure {
    /// The message
    pub message: String,
    /// A statement that only reads a stored result found no file
    pub cache_miss: bool,
    /// What the host failed with, it goes back unchanged
    pub value: Option<HostValue>,
}

impl StatementFailure {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), cache_miss: false, value: None }
    }
}

impl std::fmt::Debug for StatementFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StatementFailure")
            .field("message", &self.message)
            .field("cache_miss", &self.cache_miss)
            .finish()
    }
}

/// A statement that runs
pub struct StatementHandle {
    /// The query of the statement
    pub query_id: QueryId,
    /// Completes when the statement ended, once its result is there: does it have a result? The analysis of the
    /// result runs on after it, a cancel of the query stops it.
    pub done: LocalFuture<Result<bool, StatementFailure>>,
}

/// The stored result of a script that a run keeps until it ends
#[derive(Clone, Debug, PartialEq)]
pub struct RetainedFile {
    /// The id of the host, the run releases the file by it
    pub id: u64,
    /// The file below the mount prefix, with its key and when it was written
    pub file: StoredFile,
}

/// What a run asks of the host
pub trait RunHost: Host {
    /// Run a statement on its connection
    fn execute(&self, request: StatementRequest) -> Result<StatementHandle, StatementFailure>;
    /// Cancel a statement, completes once it is cancelled. A statement that ended stops the analysis of its result.
    fn cancel(&self, connection_id: &str, query_id: QueryId) -> impl Future<Output = ()> + 'static;

    /// Can the statements of a connection run? The scripts of one that can't use their stored results whatever their
    /// keys, the others are skipped with the scripts that follow them.
    fn can_run(&self, connection_id: &str) -> bool;
    /// The statements that a connection runs at once
    fn max_concurrent_queries(&self, connection_id: &str) -> usize;
    /// Does the host set up the connections of a run before its first statement?
    fn prepares_connections(&self) -> bool;
    /// Set up a connection that statements run on, the scripts of one that fails are skipped
    fn prepare_connection(&self, connection_id: &str) -> impl Future<Output = Result<(), HostError>> + 'static;

    /// Does the workbook store the results of its scripts?
    fn has_results(&self) -> bool;
    /// Keep the stored result of a script until the run releases it, none if the script has none
    fn result_retain(&self, script: &str) -> impl Future<Output = Result<Option<RetainedFile>, HostError>> + 'static;
    /// Release a file that the run kept: a retained file or a pin
    fn result_release(&self, file: u64) -> impl Future<Output = ()> + 'static;

    /// The directory of the files of the materialized results of the run, the results of the workbook; none without
    /// the compute database
    fn mount_prefix(&self) -> Option<String>;
    /// The name of a new file of the result of a script: the file of the script under its key, a transient file
    /// without a key
    fn mount_file_name(&self, result: Option<(&str, &str)>) -> String;
    /// Mount the results of the workbook in the compute database and pin a file below the prefix, also one that the
    /// run is about to write. Returns the id that `result_release` releases the pin with.
    fn mount_pin(&self, path: &str) -> impl Future<Output = Result<u64, HostError>> + 'static;
    /// Write the result of a statement as Parquet file at a path below the prefix that the run pinned, returns its rows.
    /// The file of a script replaces the older files of the script.
    fn mount_write(&self, path: &str, query_id: QueryId) -> impl Future<Output = Result<u64, HostError>> + 'static;
    /// Remove a transient file of the run that nobody pins any more
    fn mount_remove(&self, name: &str) -> impl Future<Output = ()> + 'static;
    /// Can the host mount the attachments of the workbook?
    fn mounts_attachments(&self) -> bool;
    /// Mount the attachments of the workbook in the embedded Hyper
    fn mount_attachments(&self) -> impl Future<Output = Result<(), HostError>> + 'static;

    /// Is the workbook still the one of the app? A run of a workbook that is gone fails.
    fn workbook_live(&self) -> bool;
    /// The run changed the workbook, e.g. it registered a query or analyzed scripts (`analyzed`). The effects of its
    /// action, e.g. the files to write, go where the effects of every action of the workbook go.
    fn workbook_changed(&self, effects: Vec<WorkbookEffect>, analyzed: bool);
    /// The state of the run changed
    fn state(&self, state: &RunState);
    /// Something happened to a script of the run
    fn script_event(&self, file: &str, event: &ScriptEvent);
    /// Let the host do other work, e.g. paint
    fn cooperate(&self) -> impl Future<Output = ()> + 'static;
}

/// The phase of a run
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunPhase {
    Planning,
    Running,
    Stopping,
    Succeeded,
    Failed,
    Cancelled,
}

impl RunPhase {
    pub fn name(self) -> &'static str {
        match self {
            RunPhase::Planning => "planning",
            RunPhase::Running => "running",
            RunPhase::Stopping => "stopping",
            RunPhase::Succeeded => "succeeded",
            RunPhase::Failed => "failed",
            RunPhase::Cancelled => "cancelled",
        }
    }
}

/// The state of a run
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunState {
    pub phase: RunPhase,
    pub total_scripts: usize,
    pub completed_scripts: usize,
    /// The planned statements that run
    pub total_statements: usize,
    pub completed_statements: usize,
    /// The script of the statement that started last
    pub active_file_name: Option<String>,
    pub active_statement_index: Option<u32>,
    pub active_statement_count: Option<u32>,
    pub error: Option<String>,
    /// The scripts that the run left out: their connection can't run or could not be set up, they have no stored
    /// result whose key matches or follow a script that runs on such a connection
    pub skipped_scripts: usize,
    pub skipped_files: Vec<String>,
    /// The scripts that failed, in the order they failed. The scripts that follow them don't run, the others run on.
    pub failed: Vec<ScriptFailure>,
    /// What the run does before its statements run, a step can take a while; none while statements run
    pub step: Option<RunStep>,
}

/// A step of a run before its statements run, the status names it
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunStep {
    /// It analyzes the scripts whose analyses are outdated
    Analyzing,
    /// It plans the scripts
    Planning,
    /// It looks up the stored result of a script, by its file
    Checking { file: String },
    /// It reads the stored result of a script, by its file
    Reading { file: String },
    /// It sets up the connections that its statements run on, by their ids
    Connecting { connections: Vec<String> },
    /// It mounts the attachments of the workbook in the compute database
    MountingAttachments,
    /// It mounts the stored results that its statements scan in the compute database
    MountingResults,
}

/// A script that failed in a run
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScriptFailure {
    pub file: String,
    pub message: String,
}

impl Default for RunState {
    fn default() -> Self {
        Self {
            phase: RunPhase::Planning,
            total_scripts: 0,
            completed_scripts: 0,
            total_statements: 0,
            completed_statements: 0,
            active_file_name: None,
            active_statement_index: None,
            active_statement_count: None,
            error: None,
            skipped_scripts: 0,
            skipped_files: Vec::new(),
            failed: Vec::new(),
            step: None,
        }
    }
}

/// What kind of failure ended a run
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunFailureKind {
    /// The scripts can't be planned, e.g. a reference to an unknown script
    Plan,
    /// The run was cancelled
    Cancelled,
    /// A statement or a call of the host failed, or the workbook changed
    Error,
}

/// Why a run failed
#[derive(Clone)]
pub struct RunFailure {
    pub kind: RunFailureKind,
    pub message: String,
    /// What the host failed with, it goes back unchanged
    pub value: Option<HostValue>,
}

impl std::fmt::Debug for RunFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunFailure").field("kind", &self.kind).field("message", &self.message).finish()
    }
}

impl RunFailure {
    pub fn error(message: impl Into<String>) -> Self {
        Self { kind: RunFailureKind::Error, message: message.into(), value: None }
    }
    pub fn plan(message: impl Into<String>) -> Self {
        Self { kind: RunFailureKind::Plan, message: message.into(), value: None }
    }
    pub fn cancelled() -> Self {
        Self { kind: RunFailureKind::Cancelled, message: "The run was cancelled".to_string(), value: None }
    }
    pub fn from_host(error: &HostError) -> Self {
        Self { kind: RunFailureKind::Error, message: error.message().to_string(), value: error.value().cloned() }
    }
    pub fn from_statement(failure: StatementFailure) -> Self {
        Self { kind: RunFailureKind::Error, message: failure.message, value: failure.value }
    }
}

/// What happens to a script in a run. A script of the plan is `Planned`, `Cached` or `Skipped`, or `Failed` if a run
/// of the workbook can't plan it. A planned script that starts is then `Done`, `Failed` or `Cancelled`. A planned
/// script that follows a script that failed is `Blocked`. A planned script that never starts, e.g. because the run
/// stopped first, gets no further event.
#[derive(Clone, Debug)]
pub enum ScriptEvent {
    /// It runs once the scripts that it follows in the plan are done, by their files
    Planned { follows: Vec<String> },
    /// Its stored result was reused instead of running it on its connection
    Cached { key: String, query_id: QueryId },
    /// It doesn't run: its connection can't run or could not be set up, or it follows a script that doesn't run
    Skipped { reason: String },
    /// Its first statement started
    Started,
    /// Its statements are done: the key of its result if the key is reusable, the query of its last output
    Done { key: Option<String>, query_id: Option<QueryId> },
    /// A statement of the script failed, or a run of the workbook can't plan it (`RunFailureKind::Plan`). The scripts
    /// that follow it don't run, the others run on.
    Failed { failure: RunFailure },
    /// It doesn't run since it follows a script that failed: the file of that script and its error
    Blocked { by: String, message: String },
    /// The run stopped the script while it ran
    Cancelled,
}

/// What a run runs
#[derive(Clone, Debug)]
pub struct RunOptions {
    /// A run of the workbook or of a script
    pub run: PlanRun,
    /// The scripts of the plan with what they need, by their indexes in feed order, every script without
    pub targets: Option<Vec<u32>>,
    /// Run the scripts that a change of these inputs affects instead (docs/design/workbook_inputs.md)
    pub inputs: Option<Vec<String>>,
    /// Reuse no stored results: the scripts run and their results replace the stored ones
    pub refresh: bool,
    /// Show the workbook: run only on the connections that the host can run, the embedded Hyper, and call no client
    /// function. The plan is tolerant, a script that can't be planned leaves the others alone. A script that doesn't
    /// run reads its stored result whatever its key if it shows no result yet, and is no skip that needs a connection,
    /// so does a script that the run didn't finish once it failed or stopped. A workbook that is shown for the first
    /// time runs so (docs/design/workbook_results.md).
    pub local: bool,
    /// Report the state of the run to the host
    pub reports_state: bool,
    /// Analyze the results of the outputs on the compute database, the command line tool only prints them
    pub analyze: bool,
}

/// How a run ended
#[derive(Debug)]
pub struct RunResult {
    /// The queries of the last outputs of the scripts, in feed order
    pub outputs: Vec<Option<QueryId>>,
    /// Why the run failed, none if it succeeded
    pub failure: Option<RunFailure>,
    /// Did the run hand a statement to the host?
    pub launched: bool,
}
