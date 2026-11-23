//! The views of the runs of workbooks: the options of a run, the `run` slice of a workbook with the state of its last
//! run, the events of the scripts and how a run ended, as JS objects with generated declarations
//! (docs/design/dashql_core.md).

use std::collections::BTreeMap;

use dashql_core_runtime::workbook_run::{
    report, RunFailure, RunFailureKind, RunPhase, RunResult, RunState, ScriptEvent,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// The options of a run of the scripts of a workbook
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RunWorkbookOptions {
    /// Run the scripts that a change of these inputs affects. A run that holds the workbook stops, the run starts once
    /// the workbook is free, with the inputs of every change since.
    #[serde(default)]
    #[tsify(optional)]
    pub inputs: Option<Vec<String>>,
    /// Run these scripts with what they need, by their indexes in feed order, every script without
    #[serde(default)]
    #[tsify(optional)]
    pub targets: Option<Vec<u32>>,
    /// Reuse no stored results: the scripts run and their results replace the stored ones
    #[serde(default)]
    #[tsify(optional)]
    pub refresh: Option<bool>,
    /// Analyze the results of the outputs on the compute database, true by default. The command line tool prints them.
    #[serde(default)]
    #[tsify(optional)]
    pub analyze: Option<bool>,
}

/// The options of a run of a script
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RunScriptOptions {
    /// Reuse no stored results, neither of the script nor of the scripts it references
    #[serde(default)]
    #[tsify(optional)]
    pub refresh: Option<bool>,
}

/// The run that holds a workbook: a run of the whole workbook or of one of its scripts
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum WorkbookRunKind {
    Workbook,
    Script,
    /// The workbook was shown the first time: it runs on the embedded Hyper, the other scripts show their stored
    /// results
    Open,
}

/// The phase of a run
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Tsify)]
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

/// The state of a run of a workbook
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookRunState {
    pub phase: WorkbookRunPhase,
    /// Does the run plan, run or stop?
    pub busy: bool,
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
            busy: matches!(state.phase, RunPhase::Planning | RunPhase::Running | RunPhase::Stopping),
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

/// The runs of a workbook, the slice `run` of the runtime
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookRunView {
    pub workbook_id: String,
    /// The run that holds the workbook, null while none does. The workbook starts no other run then.
    pub held: Option<WorkbookRunKind>,
    /// The state of the last run of the whole workbook, also of the run when the workbook is first shown, it stays once
    /// the run ended
    pub state: Option<WorkbookRunState>,
    /// The inputs whose change waits for the workbook
    pub pending_inputs: Vec<String>,
    /// The inputs whose change runs or waits for the workbook: the inputs of the run that holds the workbook and the
    /// pending ones. A control of an input shows that it is busy until the run that applies it ended.
    pub busy_inputs: Vec<String>,
}

/// Why a run failed
#[derive(Clone, Copy, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum WorkbookRunFailureKind {
    Plan,
    Cancelled,
    Error,
}

/// The failure of a run or of a script, what the platform failed with goes next to it
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookRunFailure {
    pub kind: WorkbookRunFailureKind,
    pub message: String,
    /// The details of the error of a failed statement, e.g. what Trino said
    #[tsify(type = "Record<string, string>")]
    pub details: BTreeMap<String, String>,
    /// The target of the log messages of the error of a failed statement
    pub target: Option<String>,
    /// The query of the statement that failed, null for a failure of no statement
    pub query_id: Option<u64>,
    /// Did the platform fail with a value? It goes next to the failure.
    pub host_value: bool,
}

/// What a run knows of the failure of a statement, the value of a `StatementFailure`
pub(crate) struct StatementError {
    pub query_id: u64,
    pub failure: dashql_core_runtime::executor::QueryFailure,
}

impl WorkbookRunFailure {
    /// The view of a failure and what the platform failed with, undefined without
    pub fn of(failure: &RunFailure) -> (Self, wasm_bindgen::JsValue) {
        let kind = match failure.kind {
            RunFailureKind::Plan => WorkbookRunFailureKind::Plan,
            RunFailureKind::Cancelled => WorkbookRunFailureKind::Cancelled,
            RunFailureKind::Error => WorkbookRunFailureKind::Error,
        };
        let mut view = WorkbookRunFailure {
            kind,
            message: failure.message.clone(),
            details: BTreeMap::new(),
            target: None,
            query_id: None,
            host_value: false,
        };
        let value = match failure.value.as_ref() {
            Some(value) => match value.downcast_ref::<StatementError>() {
                Some(statement) => {
                    view.details = statement.failure.details.iter().cloned().collect();
                    view.target = Some(statement.failure.target.clone());
                    view.query_id = Some(statement.query_id);
                    crate::host::host_value(statement.failure.value.as_ref())
                }
                None => crate::host::host_value(Some(value)),
            },
            None => wasm_bindgen::JsValue::UNDEFINED,
        };
        view.host_value = !value.is_undefined();
        (view, value)
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

impl WorkbookScriptRunEvent {
    /// The view of an event and what the platform failed with, undefined without
    pub fn of(event: &ScriptEvent) -> (Self, wasm_bindgen::JsValue) {
        let view = match event {
            ScriptEvent::Planned { follows } => WorkbookScriptRunEvent::Planned { follows: follows.clone() },
            ScriptEvent::Cached { key, query_id } => {
                WorkbookScriptRunEvent::Cached { key: key.clone(), query_id: *query_id }
            }
            ScriptEvent::Skipped { reason } => WorkbookScriptRunEvent::Skipped { reason: reason.clone() },
            ScriptEvent::Started => WorkbookScriptRunEvent::Started,
            ScriptEvent::Done { key, query_id } => {
                WorkbookScriptRunEvent::Done { key: key.clone(), query_id: *query_id }
            }
            ScriptEvent::Failed { failure } => {
                let (failure, value) = WorkbookRunFailure::of(failure);
                return (WorkbookScriptRunEvent::Failed { failure }, value);
            }
            ScriptEvent::Cancelled => WorkbookScriptRunEvent::Cancelled,
        };
        (view, wasm_bindgen::JsValue::UNDEFINED)
    }
}

/// How a run ended
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RunOutcome {
    /// Why the run didn't start, e.g. another run holds the workbook, null for a run that started
    pub refused: Option<String>,
    /// The queries of the last outputs of the scripts in feed order
    pub outputs: Vec<Option<u64>>,
    pub failure: Option<WorkbookRunFailure>,
    /// Did the run hand a statement to the executor?
    pub launched: bool,
}

impl RunOutcome {
    /// A run that didn't start
    pub fn refused(reason: impl Into<String>) -> Self {
        RunOutcome { refused: Some(reason.into()), outputs: Vec::new(), failure: None, launched: false }
    }

    /// How a run ended and what the platform failed with, undefined without
    pub fn of(result: &RunResult) -> (Self, wasm_bindgen::JsValue) {
        let (failure, value) = match result.failure.as_ref().map(WorkbookRunFailure::of) {
            Some((failure, value)) => (Some(failure), value),
            None => (None, wasm_bindgen::JsValue::UNDEFINED),
        };
        (RunOutcome { refused: None, outputs: result.outputs.clone(), failure, launched: result.launched }, value)
    }
}

/// The scripts that a reported run reports, by their file names in the order of the workbook
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RunScriptSelection {
    pub selected: Vec<String>,
    /// Did the run name scripts? A run without names reports every script.
    pub requested: bool,
    /// The names that no script of the workbook has
    pub unknown: Vec<String>,
}

impl From<report::RunScriptSelection> for RunScriptSelection {
    fn from(selection: report::RunScriptSelection) -> Self {
        RunScriptSelection { selected: selection.selected, requested: selection.requested, unknown: selection.unknown }
    }
}

/// What happened to a script of a reported run, as its events had it
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum ReportedScriptOutcome {
    Ok,
    Failed,
    Cancelled,
    NotRun,
}

impl From<ReportedScriptOutcome> for report::ReportedScriptOutcome {
    fn from(outcome: ReportedScriptOutcome) -> Self {
        match outcome {
            ReportedScriptOutcome::Ok => report::ReportedScriptOutcome::Ok,
            ReportedScriptOutcome::Failed => report::ReportedScriptOutcome::Failed,
            ReportedScriptOutcome::Cancelled => report::ReportedScriptOutcome::Cancelled,
            ReportedScriptOutcome::NotRun => report::ReportedScriptOutcome::NotRun,
        }
    }
}

/// The outcome of a script of a reported run
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReportedScript {
    pub script: String,
    pub outcome: ReportedScriptOutcome,
}

/// How a reported run ended, as the host saw it
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RunReportInput {
    /// The scripts that the run reports
    pub selected: Vec<String>,
    /// The outcomes of the scripts in the order of their events
    pub outcomes: Vec<ReportedScript>,
    /// Was the run stopped from outside?
    pub interrupted: bool,
    /// Did the run never start, e.g. because another run holds the workbook?
    pub refused: bool,
    /// The message of the failure of the run, null for a run that succeeded or was cancelled
    #[serde(default)]
    #[tsify(optional)]
    pub failure: Option<String>,
}

/// A script that a reported run reports and that didn't run
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReportedNotRun {
    pub script: String,
    pub reason: String,
}

/// The end of the report of a run
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RunReportEnd {
    /// The error of the run itself, e.g. a script that can't be planned; a failed script reports its own
    pub run_error: Option<String>,
    /// The scripts that the run reports and that didn't settle, with the reason
    pub not_run: Vec<ReportedNotRun>,
    pub ok: u32,
    pub failed: u32,
    pub cancelled: u32,
    /// The scripts that didn't run, those of `notRun` included
    pub not_run_count: u32,
    /// How the run ended
    #[tsify(type = "'ok' | 'failed' | 'interrupted'")]
    pub end: String,
}

impl RunReportEnd {
    /// The end of the report of a run as the host saw it
    pub fn of(input: RunReportInput) -> Self {
        let outcomes: Vec<(String, report::ReportedScriptOutcome)> =
            input.outcomes.into_iter().map(|script| (script.script, script.outcome.into())).collect();
        let end = report::RunEnd { refused: input.refused, failure: input.failure, interrupted: input.interrupted };
        let report = report::finish_run_report(&input.selected, &outcomes, &end);
        RunReportEnd {
            run_error: report.run_error,
            not_run: report.not_run.into_iter().map(|(script, reason)| ReportedNotRun { script, reason }).collect(),
            ok: report.ok,
            failed: report.failed,
            cancelled: report.cancelled,
            not_run_count: report.not_run_count,
            end: match report.end {
                report::ReportedRunEnd::Ok => "ok",
                report::ReportedRunEnd::Failed => "failed",
                report::ReportedRunEnd::Interrupted => "interrupted",
            }
            .to_string(),
        }
    }
}
