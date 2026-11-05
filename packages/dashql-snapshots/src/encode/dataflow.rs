//! The dataflow snapshot encoder: the statements of every script, the edges between them and the boxes of the
//! canvas, for sessions described like the planner snapshots.
//!
//! The boxes are laid out like the app lays them out on its first render: a script with a `@flow` tag is laid out
//! from its position, the chart of a visualized terminal statement follows its row, and the scripts of `collapsed`
//! are collapsed to their headers. The inputs follow the scripts as boxes of one row, the attachments follow the
//! inputs the same way.

use super::planner::{prepare_fixture, Fixture};
use super::{location_text, Map};
use crate::ryml::Node;
use dashql_core_session::dataflow::{derive_session_dataflow, Dataflow, DataflowEdgeKind};
use dashql_dataflow::layout::{compute_dataflow_layout_with_routes, DataflowEdgeRoute, DataflowLayoutBox, DataflowLayoutConfig, DataflowLayoutEdge};
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


/// The box of an edge source or target in the layout: the scripts, then the inputs, then the attachments
fn layout_box(dataflow: &Dataflow, kind: DataflowEdgeKind, script: u32) -> u32 {
    let (scripts, inputs) = (dataflow.scripts.len() as u32, dataflow.inputs.len() as u32);
    match kind {
        DataflowEdgeKind::Input => scripts + script,
        DataflowEdgeKind::Attachment => scripts + inputs + script,
        _ => script,
    }
}

/// Lay out the boxes of the scripts of a dataflow, then the boxes of its inputs, with the routes of the edges
fn layout(dataflow: &Dataflow, scripts: &[&dashql_core::script::Script], collapsed: &[bool]) -> (Vec<(f64, f64, f64, f64)>, Vec<DataflowEdgeRoute>) {
    let boxes: Vec<DataflowLayoutBox> = dataflow
        .scripts
        .iter()
        .zip(scripts)
        .zip(collapsed)
        .map(|((script, input), &collapsed)| {
            let analyzed = input.analyzed.as_ref();
            let flow = analyzed.and_then(|a| a.flow);
            let terminal = script.statements.len().checked_sub(1).map(|t| t as u32);
            let chart_statement = analyzed
                .filter(|_| script.analyzed && !collapsed)
                .and_then(|a| a.visualization_specs.iter().find(|v| v.renderer.is_some() && v.ast_statement_id == terminal))
                .and(terminal);
            DataflowLayoutBox {
                statements: script.statements.len() as u32,
                chart_statement,
                collapsed,
                width: flow.and_then(|f| f.width).map(f64::from),
                chart_height: flow.and_then(|f| f.height).map(f64::from),
                input: false,
                hint: flow.and_then(|f| f.position).map(|(x, y)| (x as f64, y as f64)),
                dropped: false,
            }
        })
        .chain(dataflow.inputs.iter().map(|_| DataflowLayoutBox { statements: 1, input: true, ..Default::default() }))
        .chain(dataflow.attachments.iter().map(|_| DataflowLayoutBox { statements: 1, input: true, ..Default::default() }))
        .collect();
    let edges: Vec<DataflowLayoutEdge> = dataflow
        .edges
        .iter()
        .map(|e| DataflowLayoutEdge {
            from_box: layout_box(dataflow, e.kind, e.from.script),
            from_statement: e.from.statement,
            to_box: e.to.script,
            to_statement: e.to.statement,
        })
        .filter(|e| e.from_box != e.to_box)
        .collect();
    let (geometry, routes) = compute_dataflow_layout_with_routes(&boxes, &edges, &DataflowLayoutConfig::default());
    (geometry.iter().map(|g| (g.x, g.y, g.width, g.height)).collect(), routes)
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
    let (boxes, routes) = layout(&dataflow, &inputs, &is_collapsed);

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
                if script.manual {
                    m.boolean("manual", true);
                }
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
            if e.kind == DataflowEdgeKind::Input {
                m.quoted("from", &format!(":{}", dataflow.inputs[e.from.script as usize].name));
            } else if e.kind == DataflowEdgeKind::Attachment {
                m.plain("from", &dataflow.attachments[e.from.script as usize].file);
            } else {
                m.plain("from", &port(e.from.script, e.from.statement));
            }
            m.plain("to", &port(e.to.script, e.to.statement));
            m.plain(
                "kind",
                match e.kind {
                    DataflowEdgeKind::InlineReference => "inline",
                    DataflowEdgeKind::ScanReference => "scan",
                    DataflowEdgeKind::InvalidReference => "invalid",
                    DataflowEdgeKind::Table => "table",
                    DataflowEdgeKind::Input => "input",
                    DataflowEdgeKind::Attachment => "attachment",
                },
            );
            m.plain("name", &e.name);
            // The route of an edge between boxes, its points from the right border of the source box to the left
            // border of the target box
            let key = (layout_box(&dataflow, e.kind, e.from.script), e.from.statement, e.to.script, e.to.statement);
            if let Some((_, points)) = routes.iter().find(|(k, _)| *k == key) {
                let point = |&(x, y): &(f64, f64)| Node::flow_seq(vec![Node::int(x.round() as i64), Node::int(y.round() as i64)]);
                m.insert("route", Node::flow_seq(points.iter().map(point).collect()));
            }
            m.into_node()
        })
        .collect();
    let script_count = dataflow.scripts.len();
    let input_nodes: Vec<Node> = dataflow
        .inputs
        .iter()
        .enumerate()
        .map(|(i, input)| {
            let mut m = Map::new();
            m.plain("name", &input.name);
            m.quoted("type", &input.sql_type.to_string());
            if input.type_source != dashql_core_session::session_inputs::InputTypeSource::Cast {
                m.boolean("cast", false);
            }
            if let Some(literal) = &input.literal {
                m.quoted("value", &literal.to_hyper());
            }
            if !input.warnings.is_empty() {
                m.insert("warnings", Node::seq(input.warnings.iter().map(|w| Node::dquo(w.clone())).collect()));
            }
            let (x, y, w, h) = boxes[script_count + i];
            m.insert("box", Node::flow_seq([x, y, w, h].iter().map(|v| Node::int(v.round() as i64)).collect()));
            m.into_node()
        })
        .collect();
    let attachment_nodes: Vec<Node> = dataflow
        .attachments
        .iter()
        .enumerate()
        .map(|(i, attachment)| {
            let mut m = Map::new();
            m.plain("name", &attachment.name);
            m.plain("file", &attachment.file);
            let (x, y, w, h) = boxes[script_count + dataflow.inputs.len() + i];
            m.insert("box", Node::flow_seq([x, y, w, h].iter().map(|v| Node::int(v.round() as i64)).collect()));
            m.into_node()
        })
        .collect();
    let mut out = Map::new();
    out.insert("scripts", Node::seq(scripts));
    if !input_nodes.is_empty() {
        out.insert("inputs", Node::seq(input_nodes));
    }
    if !attachment_nodes.is_empty() {
        out.insert("attachments", Node::seq(attachment_nodes));
    }
    out.insert("edges", Node::seq(edges));
    Ok(out.into_node())
}
