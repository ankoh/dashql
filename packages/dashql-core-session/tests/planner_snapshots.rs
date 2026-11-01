//! The planner snapshots (snapshots/planner/*.yaml).

use dashql_buffers::execution::ExecutionGraphT;
use dashql_core_session::planner::plan_session;
use dashql_snapshots::encode::planner::{encode_fixture, prepare_fixture, Fixture};
use dashql_snapshots::{compare, load_category, run, Arguments, Failed, Trial};

/// The nodes of a plan are in statement order of the scripts in session order, edges point forward
fn check_order(graph: &ExecutionGraphT) -> Result<(), String> {
    let nodes = graph.nodes.as_deref().unwrap_or_default();
    let (scripts, connections) = (graph.scripts.as_ref().map_or(0, Vec::len), graph.connections.as_ref().map_or(0, Vec::len));
    for (i, node) in nodes.iter().enumerate() {
        if node.script as usize >= scripts || node.connection as usize >= connections {
            return Err(format!("node {i} references an unknown script or connection"));
        }
        if i > 0 && (nodes[i - 1].script, nodes[i - 1].statement_id) >= (node.script, node.statement_id) {
            return Err(format!("node {i} is not in statement order"));
        }
    }
    match graph.edges.iter().flatten().find(|e| e.from >= e.to || e.to as usize >= nodes.len()) {
        Some(e) => Err(format!("the edge {} -> {} does not point forward", e.from, e.to)),
        None => Ok(()),
    }
}

fn main() {
    let args = Arguments::from_args();
    let mut trials = Vec::new();
    for case in load_category("planner").expect("cannot load planner snapshots") {
        trials.push(Trial::test(case.trial_name(), move || {
            let expected = case.expected().ok_or_else(|| Failed::from("missing expected"))?;
            let actual = encode_fixture(&case.node).map_err(Failed::from)?;
            compare(expected, &actual).map_err(Failed::from)?;
            let prepared = prepare_fixture(&Fixture::from_yaml(&case.node)).map_err(Failed::from)?;
            check_order(&prepared.with_request(None, |request| plan_session(request))).map_err(Failed::from)
        }));
    }
    run(&args, trials).exit();
}
