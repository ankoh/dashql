//! The views of a run of a workbook: its options, its state, the events of its scripts, how it ended and the result
//! keys of the scripts, as JS objects with generated declarations (docs/wip/runtime_projection.md). A statement goes
//! to the host as JSON, the arguments of the query executor of the host.

use dashql_core_runtime::workbook_run::plan::{PlanRun, ResultKey};
use dashql_core_runtime::workbook_run::{RunFailure, RunFailureKind, RunOptions, RunPhase, RunResult, RunState, ScriptEvent};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// A run of the workbook or of the script `target`
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum WorkbookRunKind {
    Workbook,
    Script,
}

/// The options of a run of a workbook
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookRunOptions {
    pub run: WorkbookRunKind,
    /// The file of the script of a run of a script
    #[serde(default)]
    #[tsify(optional)]
    pub target: Option<String>,
    /// The indexes of the scripts that run with what they need, every script without
    #[serde(default)]
    #[tsify(optional)]
    pub targets: Option<Vec<u32>>,
    /// Run the scripts that a change of these inputs affects
    #[serde(default)]
    #[tsify(optional)]
    pub inputs: Option<Vec<String>>,
    /// Read no cached results
    #[serde(default)]
    #[tsify(optional)]
    pub refresh: Option<bool>,
    /// Report the state of the run to the host
    #[serde(default)]
    #[tsify(optional)]
    pub reports_state: Option<bool>,
}

impl From<WorkbookRunOptions> for RunOptions {
    fn from(options: WorkbookRunOptions) -> Self {
        let run = match (options.run, options.target) {
            (WorkbookRunKind::Script, Some(target)) => PlanRun::Script(target),
            _ => PlanRun::Workbook,
        };
        RunOptions {
            run,
            targets: options.targets,
            inputs: options.inputs,
            refresh: options.refresh.unwrap_or(false),
            reports_state: options.reports_state.unwrap_or(false),
        }
    }
}

/// The phase of a run
#[derive(Clone, Copy, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum WorkbookRunPhase {
    Planning,
    Running,
    Stopping,
    Succeeded,
    Failed,
    Cancelled,
}

impl From<RunPhase> for WorkbookRunPhase {
    fn from(phase: RunPhase) -> Self {
        match phase {
            RunPhase::Planning => WorkbookRunPhase::Planning,
            RunPhase::Running => WorkbookRunPhase::Running,
            RunPhase::Stopping => WorkbookRunPhase::Stopping,
            RunPhase::Succeeded => WorkbookRunPhase::Succeeded,
            RunPhase::Failed => WorkbookRunPhase::Failed,
            RunPhase::Cancelled => WorkbookRunPhase::Cancelled,
        }
    }
}

/// The state of a run
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookRunState {
    pub phase: WorkbookRunPhase,
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
    /// The scripts that the run left out: their connection can't run or could not be set up, they have no cached
    /// result or follow a script that runs on such a connection
    pub skipped_scripts: usize,
    pub skipped_files: Vec<String>,
}

impl From<&RunState> for WorkbookRunState {
    fn from(state: &RunState) -> Self {
        WorkbookRunState {
            phase: state.phase.into(),
            total_scripts: state.total_scripts,
            completed_scripts: state.completed_scripts,
            total_statements: state.total_statements,
            completed_statements: state.completed_statements,
            active_file_name: state.active_file_name.clone(),
            active_statement_index: state.active_statement_index,
            active_statement_count: state.active_statement_count,
            error: state.error.clone(),
            skipped_scripts: state.skipped_scripts,
            skipped_files: state.skipped_files.clone(),
        }
    }
}

/// Why a run failed
#[derive(Clone, Copy, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum WorkbookRunFailureKind {
    Plan,
    Cancelled,
    Error,
}

/// The failure of a run, what the host failed with goes next to it
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookRunFailure {
    pub kind: WorkbookRunFailureKind,
    pub message: String,
    /// Did the host fail with a value?
    pub host_value: bool,
}

impl From<&RunFailure> for WorkbookRunFailure {
    fn from(failure: &RunFailure) -> Self {
        let kind = match failure.kind {
            RunFailureKind::Plan => WorkbookRunFailureKind::Plan,
            RunFailureKind::Cancelled => WorkbookRunFailureKind::Cancelled,
            RunFailureKind::Error => WorkbookRunFailureKind::Error,
        };
        WorkbookRunFailure { kind, message: failure.message.clone(), host_value: failure.value.is_some() }
    }
}

/// An event of a script of a run
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum WorkbookScriptRunEvent {
    /// It runs once the scripts that it follows in the plan are done, by their files
    Planned { follows: Vec<String> },
    /// The cache served its result instead of its connection
    Cached { key: String, query_id: u64 },
    /// It doesn't run: its connection can't run or could not be set up, or it follows a script that doesn't run
    Skipped { reason: String },
    /// Its first statement started
    Started,
    /// Its statements are done: the key of its result if the key is reusable, the query of its last output
    Done { key: Option<String>, query_id: Option<u64> },
    /// A statement of the script failed, the run stops
    Failed { failure: WorkbookRunFailure },
    /// The run stopped the script while it ran
    Cancelled,
}

impl From<&ScriptEvent> for WorkbookScriptRunEvent {
    fn from(event: &ScriptEvent) -> Self {
        match event {
            ScriptEvent::Planned { follows } => WorkbookScriptRunEvent::Planned { follows: follows.clone() },
            ScriptEvent::Cached { key, query_id } => WorkbookScriptRunEvent::Cached { key: key.clone(), query_id: *query_id },
            ScriptEvent::Skipped { reason } => WorkbookScriptRunEvent::Skipped { reason: reason.clone() },
            ScriptEvent::Started => WorkbookScriptRunEvent::Started,
            ScriptEvent::Done { key, query_id } => WorkbookScriptRunEvent::Done { key: key.clone(), query_id: *query_id },
            ScriptEvent::Failed { failure } => WorkbookScriptRunEvent::Failed { failure: failure.into() },
            ScriptEvent::Cancelled => WorkbookScriptRunEvent::Cancelled,
        }
    }
}

/// How a run ended, what the host failed with goes next to it
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookRunResult {
    /// The queries of the last outputs of the scripts in feed order
    pub outputs: Vec<Option<u64>>,
    pub failure: Option<WorkbookRunFailure>,
    /// Did the run hand a statement to the host?
    pub launched: bool,
}

impl From<&RunResult> for WorkbookRunResult {
    fn from(result: &RunResult) -> Self {
        WorkbookRunResult { outputs: result.outputs.clone(), failure: result.failure.as_ref().map(Into::into), launched: result.launched }
    }
}

/// The result key of a script
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookResultKey {
    pub key: String,
    /// The signature that the key derives from
    pub signature: String,
    /// May a run read a file of the key instead of running the script?
    pub reusable: bool,
}

/// The result keys of the scripts in feed order, null for a script without a key
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(missing_as_null)]
pub struct WorkbookResultKeys(pub Vec<Option<WorkbookResultKey>>);

impl From<&[Option<ResultKey>]> for WorkbookResultKeys {
    fn from(keys: &[Option<ResultKey>]) -> Self {
        WorkbookResultKeys(
            keys.iter()
                .map(|key| key.as_ref().map(|k| WorkbookResultKey { key: k.key.clone(), signature: k.signature.clone(), reusable: k.reusable }))
                .collect(),
        )
    }
}
