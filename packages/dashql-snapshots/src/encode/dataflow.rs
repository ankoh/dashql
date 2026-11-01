//! The dataflow snapshot encoder: the statements of every script, the edges between them and the boxes of the
//! canvas, for sessions described like the planner snapshots.
//!
//! The boxes are laid out like the app lays them out on its first render: a script with a `@vis flow` tag is fixed
//! at its position, the chart of a visualized terminal statement follows its row, and the scripts of `collapsed` are
//! collapsed to their headers.

use super::planner::{prepare_fixture, Fixture};
use super::{location_text, Map};
use crate::ryml::Node;
use dashql_core_session::dataflow::{derive_session_dataflow, Dataflow, DataflowEdgeKind};
use dashql_core_view::dataflow_layout::{compute_dataflow_layout, DataflowLayoutBox, DataflowLayoutConfig, DataflowLayoutEdge};
use yaml_rust2::Yaml;

/// Derive the dataflow of a fixture and encode it
pub fn encode_fixture(fixture: &Yaml) -> Result<Yaml, String> {
    let collapsed: Vec<String> = fixture["collapsed"].as_vec().into_iter().flatten().filter_map(|n| n.as_str().map(str::to_string)).collect();
    encode_dataflow_fixture(&Fixture::from_yaml(fixture), &collapsed).map(|node| node.to_yaml())
}

/// The scripts of a template fixture whose boxes are collapsed
pub fn collapsed_of(fixture: &Node) -> Vec<String> {
    fixture.get("collapsed").map(Node::children).unwrap_or_default().into_iter().filter_map(|n| n.val().map(str::to_string)).collect()
}

/// Lay out the boxes of the scripts of a dataflow
fn layout(dataflow: &Dataflow, scripts: &[&dashql_core::script::Script], collapsed: &[bool]) -> Vec<(f64, f64, f64, f64)> {
    let boxes: Vec<DataflowLayoutBox> = dataflow
        .scripts
        .iter()
        .zip(scripts)
        .zip(collapsed)
        .map(|((script, input), &collapsed)| {
            let analyzed = input.analyzed.as_ref();
            let terminal = script.statements.len().checked_sub(1).map(|t| t as u32);
            let chart_statement = analyzed
                .filter(|_| script.analyzed && !collapsed)
                .and_then(|a| a.visualization_specs.iter().find(|v| v.renderer.is_some() && v.ast_statement_id == terminal))
                .and(terminal);
            DataflowLayoutBox {
                statements: script.statements.len() as u32,
                chart_statement,
                collapsed,
                fixed: analyzed.and_then(|a| a.flow).map(|flow| (flow.x as f64, flow.y as f64)),
            }
        })
        .collect();
    let edges: Vec<DataflowLayoutEdge> = dataflow
        .edges
        .iter()
        .filter(|e| e.from.script != e.to.script)
        .map(|e| DataflowLayoutEdge { from_box: e.from.script, from_statement: e.from.statement, to_box: e.to.script, to_statement: e.to.statement })
        .collect();
    compute_dataflow_layout(&boxes, &edges, &DataflowLayoutConfig::default()).iter().map(|g| (g.x, g.y, g.width, g.height)).collect()
}

/// Derive the dataflow of a fixture and encode it as a styled tree
pub fn encode_dataflow_fixture(fixture: &Fixture, collapsed: &[String]) -> Result<Node, String> {
    let prepared = prepare_fixture(fixture)?;
    if let Some(unknown) = collapsed.iter().find(|c| !prepared.names.contains(c)) {
        return Err(format!("unknown collapsed dataflow script {unknown}"));
    }
    let dataflow = prepared.with_request(None, derive_session_dataflow);
    let names = &prepared.names;
    let port = |script: u32, statement: u32| format!("{}.{statement}", names[script as usize]);
    let inputs: Vec<&dashql_core::script::Script> = prepared.scripts.iter().map(|(s, _)| s).collect();
    let is_collapsed: Vec<bool> = names.iter().map(|n| collapsed.contains(n)).collect();
    let boxes = layout(&dataflow, &inputs, &is_collapsed);

    let scripts = dataflow
        .scripts
        .iter()
        .enumerate()
        .map(|(i, script)| {
            let mut m = Map::new();
            m.plain("name", &names[i]);
            if !script.analyzed {
                m.boolean("analyzed", false);
            } else {
                let text = inputs[i].text().to_string();
                let statements = script
                    .statements
                    .iter()
                    .map(|s| {
                        let mut m = Map::new();
                        m.plain("type", s.statement_type.variant_name().unwrap_or(""));
                        if let Some(target) = &s.target {
                            m.plain("target", target);
                        }
                        m.quoted("text", &location_text(&text, s.text_span.offset, s.text_span.length));
                        m.into_node()
                    })
                    .collect();
                m.insert("statements", Node::seq(statements));
            }
            let (x, y, w, h) = boxes[i];
            m.insert("box", Node::flow_seq([x, y, w, h].iter().map(|v| Node::int(v.round() as i64)).collect()));
            m.into_node()
        })
        .collect();
    let edges = dataflow
        .edges
        .iter()
        .map(|e| {
            let mut m = Map::new();
            m.plain("from", &port(e.from.script, e.from.statement));
            m.plain("to", &port(e.to.script, e.to.statement));
            m.plain(
                "kind",
                match e.kind {
                    DataflowEdgeKind::InlineReference => "inline",
                    DataflowEdgeKind::ScanReference => "scan",
                    DataflowEdgeKind::InvalidReference => "invalid",
                    DataflowEdgeKind::Table => "table",
                },
            );
            m.plain("name", &e.name);
            m.into_node()
        })
        .collect();
    let mut out = Map::new();
    out.insert("scripts", Node::seq(scripts));
    out.insert("edges", Node::seq(edges));
    Ok(out.into_node())
}
