//! Unit tests of reading Trino plans into the query profile.

use super::QueryProfile;
use dashql_buffers::profile as fb;
use dashql_buffers::status::StatusCode;

fn parse(plan: &str) -> Result<Vec<u8>, StatusCode> {
    let mut profile = QueryProfile::new();
    profile.parse_trino_plan(plan.as_bytes())?;
    profile.compute_layout();
    Ok(profile.pack_buffer())
}

fn root(buffer: &[u8]) -> fb::QueryProfile<'_> {
    flatbuffers::root::<fb::QueryProfile>(buffer).expect("valid query profile")
}

fn string<'a>(profile: &fb::QueryProfile<'a>, id: u32) -> &'a str {
    profile.string_dictionary().unwrap().get(id as usize)
}

/// A join of two fragments below a coordinator fragment
const JOIN: &str = r#"{
    "0": {"id": "9", "name": "Output", "children": [
        {"id": "8", "name": "RemoteSource", "descriptor": {"sourceFragmentIds": "[1]"}, "children": []}]},
    "1": {"id": "7", "name": "InnerJoin", "estimates": [{"outputRowCount": "NaN"}], "children": [
        {"id": "5", "name": "ScanFilter", "descriptor": {"table": "tpch:sf1:orders"}, "children": []},
        {"id": "6", "name": "RemoteSource", "descriptor": {"sourceFragmentIds": "[2, 3]"}, "children": []}]},
    "2": {"id": "2", "name": "TableScan", "descriptor": {"table": "tpch:sf1:customer"},
          "estimates": [{"outputRowCount": 150000.0}], "children": []},
    "3": {"id": "3", "name": "Values", "children": []}
}"#;

#[test]
fn stitches_fragments_into_one_tree() {
    let buffer = parse(JOIN).unwrap();
    let profile = root(&buffer);
    assert_eq!(profile.engine(), fb::ProfileEngine::TRINO);
    assert_eq!(profile.root_operators().unwrap().len(), 1);
    let operators = profile.operators().unwrap();
    assert_eq!(operators.len(), 7);
    assert_eq!(profile.operator_edges().unwrap().len(), 6);

    // The fragments nest along the remote sources, the root fragment draws no contour
    let fragments = profile.fragments().unwrap();
    let described: Vec<(&str, u32, u8)> =
        fragments.iter().map(|f| (string(&profile, f.engine_id()), f.parent_fragment(), f.hidden())).collect();
    assert_eq!(described, vec![("0", u32::MAX, 1), ("1", 0, 0), ("2", 1, 0), ("3", 1, 0)]);
    for (f, fragment) in fragments.iter().enumerate() {
        let root = operators.get(fragment.root_operator() as usize);
        assert_eq!(root.fragment(), f as u32);
    }

    // Kinds, labels and estimates
    let by_engine_id = |id: &str| operators.iter().find(|op| string(&profile, op.engine_id()) == id).unwrap();
    let scan = by_engine_id("2");
    let described = (scan.kind(), string(&profile, scan.label()), scan.estimated_rows());
    assert_eq!(described, (fb::ProfileOperatorKind::SCAN, "customer", 150000.0));
    assert_eq!(by_engine_id("7").kind(), fb::ProfileOperatorKind::JOIN);
    assert!(by_engine_id("7").estimated_rows().is_nan());
    assert_eq!(by_engine_id("8").kind(), fb::ProfileOperatorKind::EXCHANGE);
    assert_eq!(by_engine_id("3").kind(), fb::ProfileOperatorKind::VIRTUAL_TABLE);
    // The remote source reads both fragments
    assert_eq!(by_engine_id("6").children_count(), 2);
}

#[test]
fn reads_the_stage_plans_of_a_query_info() {
    let stage = |id: &str, plan: &str| {
        serde_json::json!({"stageId": format!("q.{id}"), "plan": {"jsonRepresentation": plan}})
    };
    let info = serde_json::json!({"queryId": "q", "stages": {"stages": [
        stage("0", r#"{"id": "1", "name": "Output", "children": [
            {"id": "2", "name": "RemoteSource", "descriptor": {"sourceFragmentIds": "[1]"}, "children": []}]}"#),
        stage("1", r#"{"id": "3", "name": "TableScan", "children": []}"#),
        // A pruned stage has no plan
        serde_json::json!({"stageId": "q.2"}),
    ]}});
    let buffer = parse(&info.to_string()).unwrap();
    let profile = root(&buffer);
    assert_eq!(profile.operators().unwrap().len(), 3);
    assert_eq!(profile.fragments().unwrap().len(), 2);
}

#[test]
fn rejects_documents_that_are_no_trino_plans() {
    let broken_stage = r#"{"stages":{"stages":[{"stageId":"q.0","plan":{"jsonRepresentation":"{"}}]}}"#;
    for plan in ["", "[]", r#"{"operator":"scan"}"#, broken_stage] {
        let mut profile = QueryProfile::new();
        let parsed = profile.parse_trino_plan(plan.as_bytes());
        assert_eq!(parsed, Err(StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR), "{plan}");
    }
}

#[test]
fn stage_progress_finds_the_fragments_of_the_plan() {
    let mut profile = QueryProfile::new();
    profile.parse_trino_plan(JOIN.as_bytes()).unwrap();
    let version = profile.structure_version();
    let stats = br#"{"state":"RUNNING","rootStage":{"stageId":"0","state":"RUNNING","subStages":[
        {"stageId":"1","state":"RUNNING","subStages":[
            {"stageId":"2","state":"FINISHED"},{"stageId":"3","state":"FINISHED"}]}]}}"#;
    let updates = profile.apply_trino_statement_stats(stats, 1).unwrap();
    assert_eq!(profile.structure_version(), version);
    let fragment = |index: u32| updates.iter().find(|u| u.entity == fb::ProfileEntity::FRAGMENT && u.index == index);
    assert_eq!(fragment(2).unwrap().state.status, super::Status::Succeeded);
    assert_eq!(fragment(1).unwrap().state.status, super::Status::Running);
}

#[test]
fn operator_summaries_register_pipelines_and_merge_operators_of_a_plan_node() {
    let mut profile = QueryProfile::new();
    profile.parse_trino_plan(JOIN.as_bytes()).unwrap();
    let summary = |pipeline: u32, operator: u32, node: &str, input: u64, output: u64| {
        serde_json::json!({
            "pipelineId": pipeline, "operatorId": operator, "planNodeId": node,
            "inputPositions": input, "outputPositions": output,
            "inputDataSize": "1.5kB", "outputDataSize": "10B",
            "addInputCpu": "1.50ms", "getOutputCpu": "500.00us", "finishCpu": "0.00ns",
            "blockedWall": "2.00s", "peakUserMemoryReservation": "1MB"
        })
    };
    let info = serde_json::json!({"stages": {"stages": [{
        "stageId": "q.1", "state": "FINISHED", "stageStats": {"operatorSummaries": [
            // Pipeline 0: the scan feeds the join, the join is two Trino operators (probe, output)
            summary(0, 2, "7", 40, 4),
            summary(0, 0, "5", 100, 50),
            summary(0, 1, "7", 50, 40),
            // An operator of a plan node that the plan does not know
            summary(0, 3, "999", 1, 1),
        ]}
    }]}})
    .to_string();
    let version = profile.structure_version();
    let updates = profile.apply_trino_query_info(info.as_bytes(), 5).unwrap();
    assert_eq!(profile.structure_version(), version + 1);
    let slots: Vec<_> = updates.iter().filter(|u| u.entity == fb::ProfileEntity::SLOT).collect();
    assert_eq!(slots.len(), 2);
    let join = slots[1].state;
    // Input of the first operator, output of the last, times summed in microseconds
    assert_eq!((join.stats.tuples_in, join.stats.tuples_out), (Some(50), Some(4)));
    assert_eq!(join.stats.cpu_time_us, Some(4000));
    assert_eq!(join.stats.blocked_time_us, Some(4_000_000));
    assert_eq!((join.stats.bytes_in, join.stats.memory_bytes), (Some(1536), Some(2 * 1024 * 1024)));
    assert_eq!(join.status, super::Status::Succeeded);

    // The next sample finds the pipeline
    assert!(profile.apply_trino_query_info(info.as_bytes(), 6).unwrap().is_empty());
    assert_eq!(profile.structure_version(), version + 1);
    let buffer = profile.pack_buffer();
    let packed = root(&buffer);
    let pipeline = packed.pipelines().unwrap().get(0);
    assert_eq!((string(&packed, pipeline.engine_id()), pipeline.fragment()), ("1.0", 1));
}
