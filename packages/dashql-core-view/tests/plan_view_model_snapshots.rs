//! The plan view model snapshots, produced by the Rust view model:
//! - snapshots/plans/hyper/tests/*.yaml: the structure of Hyper plans (and the state of analyzed plans)
//! - snapshots/plans/progress/*.yaml: a plan, input events, and the output events of the rollups
//! - snapshots/plans/trino/tests/*.yaml: recorded Trino statement polls through the Trino adapter
//!
//! The view model is encoded with `dashql_snapshots::encode::plan_view_model`.

use dashql_snapshots::encode::plan_view_model::{
    encode_hyper_plan, encode_plan_progress, encode_trino_statement_progress,
};
use dashql_snapshots::{compare, load_category_from, run, snapshot_root, Arguments, Failed, Trial, Yaml};

/// Compare sections, a section is missing on both sides or present on both sides
fn compare_sections(expected: &Yaml, actual: &Yaml, keys: &[&str]) -> Result<(), Failed> {
    for key in keys {
        let (expected, actual) = (&expected[*key], &actual[*key]);
        match (matches!(expected, Yaml::BadValue), matches!(actual, Yaml::BadValue)) {
            (true, true) => {}
            (true, false) => return Err(Failed::from(format!("{key}: missing in the snapshot"))),
            _ => compare(expected, actual).map_err(|e| Failed::from(format!("{key}: {e}")))?,
        }
    }
    Ok(())
}

fn main() {
    let args = Arguments::from_args();
    let plans = snapshot_root().join("plans");
    let mut trials = Vec::new();

    let cases = load_category_from(&plans.join("hyper").join("tests"), "plan").expect("cannot load plan snapshots");
    trials.extend(cases.into_iter().map(|case| {
        Trial::test(case.trial_name(), move || {
            // The input is passed untrimmed
            let input = case.node["input"].as_str().ok_or("case without input")?;
            let produced = encode_hyper_plan(input)?.into_yaml();
            let sections = ["fragments", "operators", "operator-edges", "pipelines", "events"];
            compare_sections(&case.node, &produced, &sections)
        })
    }));

    let cases = load_category_from(&plans.join("progress"), "progress").expect("cannot load progress snapshots");
    trials.extend(cases.into_iter().map(|case| {
        Trial::test(case.trial_name(), move || {
            let plan = case.node["plan"].as_str().ok_or("case without plan")?;
            let events = case.node["events"].as_str().ok_or("case without events")?;
            let updates = encode_plan_progress(plan, events)?.to_yaml();
            compare(&case.node["updates"], &updates).map_err(|e| Failed::from(format!("updates: {e}")))
        })
    }));
    let trino = plans.join("trino");
    let cases = load_category_from(&trino.join("tests"), "trino-progress").expect("cannot load Trino snapshots");
    trials.extend(cases.into_iter().map(|case| {
        let recordings = trino.join("recordings");
        Trial::test(case.trial_name(), move || {
            let name = case.node["recording"].as_str().ok_or("case without recording")?;
            let path = recordings.join(format!("{name}.json"));
            let recording = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let produced = encode_trino_statement_progress(&recording)?.into_yaml();
            compare_sections(&case.node, &produced, &["fragments", "updates"])
        })
    }));
    run(&args, trials).exit();
}
