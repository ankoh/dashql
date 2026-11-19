//! Checks the assumptions of the query progress model against a live Trino.
//!
//! The progress model maps Trino stages to plan fragments, plan nodes to operators and the
//! `operatorSummaries` of QueryInfo to (pipeline, operator) slots. These checks pin the behavior of the
//! Trino version in `//bazel:external_trino.bzl`, a version bump that changes it fails here first.

use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use trino_testing::queries::RECORDED_QUERIES;
use trino_testing::{is_final_query_info, QueryOptions, QueryRun, TrinoClient, TrinoServer};

/// Collects the outcome of the checks
#[derive(Default)]
struct Checks {
    failures: Vec<String>,
    passed: usize,
}

impl Checks {
    /// Record a check, the detail explains a failure
    fn check(&mut self, name: impl AsRef<str>, ok: bool, detail: impl FnOnce() -> String) {
        let name = name.as_ref();
        if ok {
            self.passed += 1;
            println!("ok   {name}");
        } else {
            let message = format!("{name}: {}", detail());
            println!("FAIL {message}");
            self.failures.push(message);
        }
    }
}

/// The stages of a QueryInfo: `stages.stages`, a flat list
fn stages(info: &Value) -> Vec<&Value> {
    let stages = info.pointer("/stages/stages").and_then(Value::as_array);
    stages.map(|s| s.iter().collect()).unwrap_or_default()
}

/// The fragment id of a stage id `<queryId>.<fragmentId>`
fn fragment_of_stage(query_id: &str, stage_id: &str) -> Option<String> {
    stage_id.strip_prefix(query_id)?.strip_prefix('.').map(str::to_string)
}

/// The ids of all nodes of a plan in the EXPLAIN JSON format
fn plan_node_ids(node: &Value, out: &mut BTreeSet<String>) {
    if let Some(id) = node.get("id").and_then(Value::as_str) {
        out.insert(id.to_string());
    }
    for child in node.get("children").and_then(Value::as_array).into_iter().flatten() {
        plan_node_ids(child, out);
    }
}

/// The plan of a stage, parsed from `plan.jsonRepresentation`
fn stage_plan(stage: &Value) -> Option<Value> {
    serde_json::from_str(stage.pointer("/plan/jsonRepresentation")?.as_str()?).ok()
}

/// The operator summaries of a stage
fn operator_summaries(stage: &Value) -> &[Value] {
    let summaries = stage.pointer("/stageStats/operatorSummaries").and_then(Value::as_array);
    summaries.map(Vec::as_slice).unwrap_or_default()
}

/// A string member, empty if missing
fn str_of<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// The stage ids of a stage tree in the statement stats
fn stage_tree_ids(root: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    let mut todo = vec![root];
    while let Some(stage) = todo.pop() {
        ids.push(str_of(stage, "stageId").to_string());
        todo.extend(stage.get("subStages").and_then(Value::as_array).into_iter().flatten());
    }
    ids
}

/// The statement protocol: states, the stage tree and the progress counters
fn check_statement_protocol(checks: &mut Checks, run: &QueryRun) {
    let first = &run.statement_responses[0].body;
    let first_state = first.pointer("/stats/state");
    checks.check("the POST response carries stats", first.get("stats").is_some(), || first.to_string());
    checks.check("the POST response is QUEUED", first_state == Some(&Value::from("QUEUED")), || {
        format!("{first_state:?}")
    });
    checks.check("the POST response has no stage tree", first.pointer("/stats/rootStage").is_none(), String::new);

    let states: Vec<&str> = run.stats().map(|s| str_of(s, "state")).collect();
    let queued_with_stages = run.stats().any(|s| s.get("rootStage").is_some() && str_of(s, "state") == "QUEUED");
    checks.check("a queued query has no stage tree", !queued_with_stages, || format!("{states:?}"));
    checks.check("the last response is FINISHED", states.last() == Some(&"FINISHED"), || format!("{states:?}"));

    let stage_ids: Vec<String> = run.stats().filter_map(|s| s.get("rootStage")).flat_map(stage_tree_ids).collect();
    let numeric = stage_ids.iter().all(|id| id.parse::<u32>().is_ok());
    checks.check("stage ids of the statement stats are fragment ids", numeric, || format!("{stage_ids:?}"));

    let completed: Vec<u64> = run.stats().filter_map(|s| s.get("completedSplits")?.as_u64()).collect();
    let monotonic = completed.windows(2).all(|w| w[0] <= w[1]);
    checks.check("completed splits never decrease", monotonic, || format!("{completed:?}"));
    let percent: Vec<f64> = run.stats().filter_map(|s| s.get("progressPercentage")?.as_f64()).collect();
    let monotonic = percent.windows(2).all(|w| w[0] <= w[1]);
    checks.check("the progress percentage never decreases", monotonic, || format!("{percent:?}"));
    let early_percent = run.stats().any(|s| {
        s.get("progressPercentage").is_some() && s.get("totalSplits").and_then(Value::as_u64).unwrap_or(0) == 0
    });
    checks.check("there is no progress percentage before the splits are known", !early_percent, String::new);
}

/// The plan of a stage against EXPLAIN, and its operators against the plan
fn check_stage(checks: &mut Checks, query_id: &str, stage: &Value, explain: &Value, findings: &mut StageFindings) {
    let stage_id = str_of(stage, "stageId");
    let fragment = fragment_of_stage(query_id, stage_id).unwrap_or_default();
    let Some(plan) = stage_plan(stage) else {
        checks.check(format!("stage {stage_id} carries its plan as JSON"), false, String::new);
        return;
    };
    let mut nodes = BTreeSet::new();
    plan_node_ids(&plan, &mut nodes);
    let mut explained_nodes = BTreeSet::new();
    if let Some(root) = explain.get(&fragment) {
        plan_node_ids(root, &mut explained_nodes);
    }
    let name = format!("fragment {fragment}: the executed plan has the node ids of EXPLAIN");
    checks.check(name, nodes == explained_nodes, || format!("{nodes:?} vs {explained_nodes:?}"));

    // Operators map to plan nodes, (pipeline, node) is a slot
    let mut slots: BTreeMap<(u64, String), usize> = BTreeMap::new();
    let mut pipelines_of_node: BTreeMap<String, BTreeSet<u64>> = BTreeMap::new();
    for op in operator_summaries(stage) {
        let node = str_of(op, "planNodeId").to_string();
        let pipeline = op.get("pipelineId").and_then(Value::as_u64).unwrap_or(u64::MAX);
        *slots.entry((pipeline, node.clone())).or_default() += 1;
        pipelines_of_node.entry(node).or_default().insert(pipeline);
    }
    let unresolved: Vec<&String> = pipelines_of_node.keys().filter(|n| !nodes.contains(*n)).collect();
    let name = format!("fragment {fragment}: every operator resolves to a plan node");
    checks.check(name, unresolved.is_empty(), || format!("{unresolved:?}"));
    let uncovered: Vec<&String> = nodes.iter().filter(|n| !pipelines_of_node.contains_key(*n)).collect();
    let name = format!("fragment {fragment}: every plan node has an operator");
    checks.check(name, uncovered.is_empty(), || format!("{uncovered:?}"));

    let shared = pipelines_of_node.iter().filter(|(_, p)| p.len() > 1);
    findings.nodes_in_several_pipelines.extend(shared.map(|(n, _)| n.clone()));
    let crowded = slots.iter().filter(|(_, n)| **n > 1);
    findings.slots_with_several_operators.extend(crowded.map(|((p, n), _)| format!("{p}:{n}")));
}

/// What the stages showed about pipelines
#[derive(Default)]
struct StageFindings {
    nodes_in_several_pipelines: BTreeSet<String>,
    slots_with_several_operators: BTreeSet<String>,
}

/// QueryInfo: stages, plans and operator summaries
fn check_query_info(checks: &mut Checks, run: &QueryRun, explain: &Value) {
    let info = run.final_query_info().expect("a final QueryInfo");
    let query_id = run.query_id.as_str();

    // Stages are fragments
    let stage_ids: Vec<&str> = stages(info).iter().map(|s| str_of(s, "stageId")).collect();
    let fragments: BTreeSet<String> = stage_ids.iter().filter_map(|s| fragment_of_stage(query_id, s)).collect();
    let explained: BTreeSet<String> = explain.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
    checks.check("stage ids are <queryId>.<fragmentId>", fragments.len() == stage_ids.len(), || {
        format!("{stage_ids:?}")
    });
    checks.check("the stages are the fragments of EXPLAIN", fragments == explained, || {
        format!("{fragments:?} vs {explained:?}")
    });

    let mut findings = StageFindings::default();
    for stage in stages(info) {
        check_stage(checks, query_id, stage, explain, &mut findings);
    }
    let shared = !findings.nodes_in_several_pipelines.is_empty();
    checks.check("a plan node can belong to several pipelines", shared, String::new);
    let crowded = !findings.slots_with_several_operators.is_empty();
    checks.check("a slot can hold several operators", crowded, String::new);

    // Running tasks report summarized task infos: no operator summaries until a stage is done
    let live_operators = run
        .query_infos
        .iter()
        .filter(|i| str_of(&i.body, "state") == "RUNNING")
        .flat_map(|i| stages(&i.body))
        .filter(|s| str_of(s, "state") == "RUNNING")
        .map(|s| operator_summaries(s).len())
        .sum::<usize>();
    checks.check("running stages report no operator summaries", live_operators == 0, || {
        format!("{live_operators} operators")
    });
    let final_operators = stages(info).iter().map(|s| operator_summaries(s).len()).sum::<usize>();
    checks.check("finished stages report their operator summaries", final_operators > 0, String::new);

    // A stage whose tasks are done waits for the query in PENDING, it finishes with the query. It reports its
    // operator summaries while the query still runs, and they are the ones it ends with. Right after the stage
    // turned PENDING the final task infos may still be missing, the summaries are empty then. The app fetches
    // QueryInfo when the statement stats show such a stage, and again while one has no summaries.
    let output_rows = |stage: &Value| operator_summaries(stage).iter().filter_map(|o| o["outputPositions"].as_u64()).sum::<u64>();
    let final_rows: BTreeMap<&str, u64> = stages(info).iter().map(|s| (str_of(s, "stageId"), output_rows(s))).collect();
    let early: Vec<(&str, u64)> = run
        .query_infos
        .iter()
        .filter(|i| str_of(&i.body, "state") == "RUNNING")
        .flat_map(|i| stages(&i.body))
        .filter(|s| matches!(str_of(s, "state"), "PENDING" | "FINISHED"))
        .map(|s| (str_of(s, "stageId"), output_rows(s)))
        .collect();
    checks.check("the tasks of a stage are done before the query", !early.is_empty(), String::new);
    let reported: Vec<&(&str, u64)> = early.iter().filter(|(_, rows)| *rows > 0).collect();
    let complete = !reported.is_empty() && reported.iter().all(|(id, rows)| final_rows.get(id) == Some(rows));
    checks.check("a pending stage reports its final operator summaries while the query runs", complete, || {
        format!("{early:?} vs {final_rows:?}")
    });

    // The QueryInfo becomes final shortly after the last statement response
    let last_response = run.statement_responses.last().map(|r| r.elapsed_ms).unwrap_or(0);
    let first_final = run.query_infos.iter().find(|i| is_final_query_info(&i.body)).map(|i| i.elapsed_ms);
    let in_time = first_final.is_some_and(|t| t <= last_response + 3000);
    checks.check("the QueryInfo is final within 3 s of the last statement response", in_time, || {
        format!("last response at {last_response} ms, final QueryInfo at {first_final:?} ms")
    });
}

/// Run a recorded query, with its distributed plan if it is recorded
fn run(client: &TrinoClient, name: &str) -> (QueryRun, Value) {
    let query = RECORDED_QUERIES.iter().find(|q| q.name == name).expect("a recorded query");
    let options = QueryOptions { query_info_on_stage_finish: true, ..query.sampled_options("") };
    let run = client.run_query(query.sql, &options).unwrap_or_else(|e| panic!("{name}: {e}"));
    let explain = match query.explain {
        true => client.explain_distributed(query.sql).expect("EXPLAIN"),
        false => Value::Null,
    };
    (run, explain)
}

/// Cancelled and failed queries
fn check_failures(checks: &mut Checks, client: &TrinoClient) {
    let (cancelled, _) = run(client, "cancelled_sf10");
    let info = cancelled.final_query_info().cloned().unwrap_or_default();
    let state = str_of(&info, "state").to_string();
    checks.check("a cancelled query ends FAILED", state == "FAILED", || state.clone());
    let error = info.pointer("/errorCode/name").and_then(Value::as_str);
    checks.check("a cancelled query fails with USER_CANCELED", error == Some("USER_CANCELED"), || {
        format!("{error:?}")
    });

    let (failed, _) = run(client, "failed_cast");
    let last_state = failed.stats().last().map(|s| str_of(s, "state"));
    checks.check("a failing query returns an error", failed.error().is_some(), String::new);
    checks.check("a failing query ends FAILED", last_state == Some("FAILED"), || format!("{last_state:?}"));
}

/// QueryInfo can be pruned: it drops the stage plans and every stage but the output stage
fn check_pruned_query_info(checks: &mut Checks, client: &TrinoClient) {
    let sql = "SELECT count(*) FROM tpch.tiny.lineitem";
    let finished = client.run_query(sql, &QueryOptions::default()).expect("a query");
    let full = client.get_json(&format!("/v1/query/{}", finished.query_id)).expect("QueryInfo");
    let info = client.get_json(&format!("/v1/query/{}?pruned=true", finished.query_id)).expect("pruned QueryInfo");
    let pruned = info.get("pruned");
    checks.check("pruned=true prunes QueryInfo", pruned == Some(&Value::Bool(true)), || format!("{pruned:?}"));
    let pruned_stages = stages(&info);
    let all_plans_dropped = pruned_stages.iter().all(|s| stage_plan(s).is_none());
    checks.check("pruned QueryInfo drops the stage plans", all_plans_dropped, String::new);
    let ids: Vec<&str> = pruned_stages.iter().map(|s| str_of(s, "stageId")).collect();
    let output = info.pointer("/stages/outputStageId").and_then(Value::as_str);
    let only_output = stages(&full).len() > 1 && output.is_some_and(|o| ids == [o]);
    checks.check("pruned QueryInfo of a finished query keeps only the output stage", only_output, || {
        format!("{ids:?} of {} stages", stages(&full).len())
    });

    // While the query runs, the statement stats show the stage tree, the pruned QueryInfo the output stage
    let query = RECORDED_QUERIES.iter().find(|q| q.name == "tpch_q3_sf1").expect("a recorded query");
    let running = client.run_query(query.sql, &query.sampled_options("pruned=true")).expect("a query");
    let live: Vec<usize> = running
        .query_infos
        .iter()
        .filter(|i| str_of(&i.body, "state") == "RUNNING" && i.body.get("pruned") == Some(&Value::Bool(true)))
        .map(|i| stages(&i.body).len())
        .collect();
    let stage_tree = running.stats().filter_map(|s| s.get("rootStage")).map(|r| stage_tree_ids(r).len()).max();
    let only_output = !live.is_empty() && live.iter().all(|n| *n == 1) && stage_tree.unwrap_or(0) > 1;
    checks.check("pruned QueryInfo of a running query keeps only the output stage", only_output, || {
        format!("stages per sample {live:?}, stage tree of {stage_tree:?}")
    });
}

fn main() {
    let server = TrinoServer::start().unwrap_or_else(|e| panic!("cannot start Trino: {e}"));
    let client = server.client();
    let mut checks = Checks::default();

    let (q3, explain) = run(&client, "tpch_q3_sf1");
    checks.check("tpch_q3_sf1 succeeds", q3.error().is_none(), || format!("{:?}", q3.error()));
    check_statement_protocol(&mut checks, &q3);
    check_query_info(&mut checks, &q3, &explain);
    check_failures(&mut checks, &client);
    check_pruned_query_info(&mut checks, &client);

    println!("{} checks passed, {} failed", checks.passed, checks.failures.len());
    drop(server);
    if !checks.failures.is_empty() {
        std::process::exit(1);
    }
}
