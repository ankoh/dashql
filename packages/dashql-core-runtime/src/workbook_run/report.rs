//! The report of a run of a workbook: which scripts a run that names them reports, what a connection is called in its
//! events, and how a run ended for the scripts that it reports. `dashql run` prints the report, a tab that runs a
//! workbook for the agent of a session sends it back (`runWorkbookReported` of `@akohn/dashql`). The host keeps the
//! events of the scripts in order and the timings, the decisions are here.

use serde_json::Value;

use crate::connections::{ConnectionParams, ConnectorType};
use crate::names::{find_script_file, script_name_of};

/// The scripts that a run reports
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunScriptSelection {
    /// The file names of the scripts in the order of the workbook
    pub selected: Vec<String>,
    /// Did the run name scripts? A run without names runs and reports every script.
    pub requested: bool,
    /// The names that no script of the workbook has, without path and `.sql`
    pub unknown: Vec<String>,
}

/// The scripts of a run by their names, every script without names. A name names a script as `find_script_file` has
/// it: `scripts/Orders.sql` names `orders.sql`.
pub fn select_run_scripts(files: &[String], names: &[String]) -> RunScriptSelection {
    let mut requested: Vec<&String> = Vec::new();
    let mut unknown: Vec<String> = Vec::new();
    for name in names {
        match find_script_file(files, name) {
            Some(file) if !requested.contains(&file) => requested.push(file),
            Some(_) => {}
            None => {
                let name = script_name_of(name).to_string();
                if !unknown.contains(&name) {
                    unknown.push(name);
                }
            }
        }
    }
    let selected = files.iter().filter(|file| names.is_empty() || requested.contains(file)).cloned().collect();
    RunScriptSelection { selected, requested: !names.is_empty(), unknown }
}

/// What a connection is in the events of a run, e.g. `trino http://localhost:8080` or `the embedded hyper`
pub fn run_connection_label(params: &ConnectionParams) -> String {
    let endpoint = || params.params.get("endpoint").and_then(Value::as_str).unwrap_or("").to_string();
    match params.connector {
        ConnectorType::Trino => format!("trino {}", endpoint()),
        ConnectorType::Hyper => match params.params.get("protocol").and_then(Value::as_str) {
            Some("WASM") | None => "the embedded hyper".to_string(),
            Some(_) => format!("hyper {}", endpoint()).trim().to_string(),
        },
        ConnectorType::SalesforceDataCloud => "salesforce".to_string(),
        ConnectorType::Dbcom => "dbcom".to_string(),
    }
}

/// What happened to a script that a run reports
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportedScriptOutcome {
    /// It ran or the cache served its result
    Ok,
    /// A statement of it failed
    Failed,
    /// The run stopped it while it ran
    Cancelled,
    /// It did not run
    NotRun,
}

/// How a reported run ended
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportedRunEnd {
    /// Every script that the run reports ran
    Ok,
    /// A script or the run failed
    Failed,
    /// The run was stopped
    Interrupted,
}

/// How a run ended, as its report has it
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunEnd {
    /// The run never started, e.g. another run holds the workbook
    pub refused: bool,
    /// The message of the failure of the run, none for a run that succeeded or was cancelled
    pub failure: Option<String>,
    /// Was the run stopped from outside?
    pub interrupted: bool,
}

/// The end of the report of a run
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunReportEnd {
    /// The error of the run itself, e.g. a script that can't be planned; a failed script reports its own
    pub run_error: Option<String>,
    /// The scripts that the run reports and that didn't settle, with the reason
    pub not_run: Vec<(String, String)>,
    pub ok: u32,
    pub failed: u32,
    pub cancelled: u32,
    pub not_run_count: u32,
    pub end: ReportedRunEnd,
}

/// The end of the report of a run: the outcomes of the scripts as their events had them, the scripts that the run
/// reports and how the run ended
pub fn finish_run_report(
    selected: &[String],
    outcomes: &[(String, ReportedScriptOutcome)],
    end: &RunEnd,
) -> RunReportEnd {
    // The last outcome of a script counts
    let mut scripts: Vec<(&str, ReportedScriptOutcome)> = Vec::new();
    for (script, outcome) in outcomes {
        match scripts.iter_mut().find(|(name, _)| name == script) {
            Some(entry) => entry.1 = *outcome,
            None => scripts.push((script.as_str(), *outcome)),
        }
    }
    let outcome_of = |script: &str| scripts.iter().find(|(name, _)| *name == script).map(|(_, outcome)| *outcome);
    let script_failed = scripts.iter().any(|(_, outcome)| *outcome == ReportedScriptOutcome::Failed);
    let run_error = if end.interrupted || script_failed {
        None
    } else if end.refused {
        Some("the workbook is running elsewhere".to_string())
    } else {
        end.failure.clone()
    };
    let reason = if end.interrupted {
        "interrupted"
    } else if script_failed {
        "the run stopped"
    } else {
        "the run failed"
    };
    let not_run: Vec<(String, String)> = selected
        .iter()
        .filter(|script| outcome_of(script).is_none())
        .map(|script| (script.clone(), reason.to_string()))
        .collect();
    // The scripts that ran count only if the run reports them
    let tally = |wanted: ReportedScriptOutcome| {
        scripts
            .iter()
            .filter(|(script, outcome)| {
                *outcome == wanted
                    && (wanted != ReportedScriptOutcome::Ok || selected.iter().any(|name| name == script))
            })
            .count() as u32
    };
    let (ok, failed, cancelled) = (
        tally(ReportedScriptOutcome::Ok),
        tally(ReportedScriptOutcome::Failed),
        tally(ReportedScriptOutcome::Cancelled),
    );
    let not_run_count = tally(ReportedScriptOutcome::NotRun) + not_run.len() as u32;
    let all_ok = run_error.is_none()
        && selected.iter().all(|script| outcome_of(script) == Some(ReportedScriptOutcome::Ok))
        && failed + cancelled + not_run_count == 0;
    let end = if end.interrupted {
        ReportedRunEnd::Interrupted
    } else if all_ok {
        ReportedRunEnd::Ok
    } else {
        ReportedRunEnd::Failed
    };
    RunReportEnd { run_error, not_run, ok, failed, cancelled, not_run_count, end }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn selects_the_scripts_by_their_base_names() {
        let files = names(&["a.sql", "b.sql", "c.sql"]);
        let all = select_run_scripts(&files, &[]);
        assert_eq!((all.selected, all.requested, all.unknown.len()), (files.clone(), false, 0));
        let some = select_run_scripts(&files, &names(&["scripts/c.sql", "dir\\a.sql", "x.sql", "C", "x"]));
        assert_eq!(some.selected, names(&["a.sql", "c.sql"]));
        assert!(some.requested);
        assert_eq!(some.unknown, names(&["x"]));
        let none = select_run_scripts(&files, &names(&["x"]));
        assert_eq!((none.selected.len(), none.requested), (0, true));
    }

    #[test]
    fn labels_the_connections_of_a_run() {
        let label = |value: Value| {
            run_connection_label(
                &ConnectionParams::from_object(value.as_object().cloned().unwrap_or_default()).unwrap(),
            )
        };
        assert_eq!(label(json!({ "trino": { "endpoint": "http://localhost:8080" } })), "trino http://localhost:8080");
        assert_eq!(label(json!({ "hyper": { "protocol": "WASM" } })), "the embedded hyper");
        assert_eq!(label(json!({ "hyper": {} })), "the embedded hyper");
        assert_eq!(label(json!({ "hyper": { "protocol": "V3_HTTP", "endpoint": "http://h" } })), "hyper http://h");
        assert_eq!(label(json!({ "hyper": { "protocol": "V3_GRPC" } })), "hyper");
        assert_eq!(label(json!({ "salesforce": {} })), "salesforce");
        assert_eq!(label(json!({ "dbcom": {} })), "dbcom");
    }

    #[test]
    fn ends_the_report_of_a_run() {
        use ReportedScriptOutcome::*;
        let selected = names(&["a.sql", "b.sql"]);
        let outcome = |script: &str, outcome| (script.to_string(), outcome);

        let ok = finish_run_report(
            &selected,
            &[outcome("a.sql", Ok), outcome("b.sql", Ok), outcome("dep.sql", Ok)],
            &RunEnd::default(),
        );
        assert_eq!((ok.end, ok.ok, ok.not_run_count, ok.run_error), (ReportedRunEnd::Ok, 2, 0, None));

        // A failed script reports its own error, the scripts it stopped didn't run
        let failed = finish_run_report(
            &selected,
            &[outcome("a.sql", Failed)],
            &RunEnd { failure: Some("boom".into()), ..RunEnd::default() },
        );
        assert_eq!(failed.run_error, None);
        assert_eq!(failed.not_run, vec![("b.sql".to_string(), "the run stopped".to_string())]);
        assert_eq!((failed.failed, failed.not_run_count, failed.end), (1, 1, ReportedRunEnd::Failed));

        // A run that failed by itself, or never started
        let plan = finish_run_report(&selected, &[], &RunEnd { failure: Some("no plan".into()), ..RunEnd::default() });
        assert_eq!(plan.run_error.as_deref(), Some("no plan"));
        assert_eq!(plan.not_run[0].1, "the run failed");
        let refused = finish_run_report(&selected, &[], &RunEnd { refused: true, ..RunEnd::default() });
        assert_eq!(refused.run_error.as_deref(), Some("the workbook is running elsewhere"));

        // A stopped run is interrupted, whatever its scripts did
        let stopped = finish_run_report(
            &selected,
            &[outcome("a.sql", Cancelled)],
            &RunEnd { interrupted: true, ..RunEnd::default() },
        );
        assert_eq!((stopped.end, stopped.cancelled, stopped.run_error), (ReportedRunEnd::Interrupted, 1, None));
        assert_eq!(stopped.not_run, vec![("b.sql".to_string(), "interrupted".to_string())]);
    }
}
