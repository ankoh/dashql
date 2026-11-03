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
