//! The dataflow snapshot encoder, for fixtures of the planner format.

use super::planner::{prepare_fixture, Fixture};
use super::{location_text, Map};
use crate::ryml::Node;
use dashql_core_session::dataflow::{derive_session_dataflow, DataflowEdgeKind};
use yaml_rust2::Yaml;

/// Derive the dataflow of a fixture and encode it
pub fn encode_fixture(fixture: &Yaml) -> Result<Yaml, String> {
    encode_dataflow_fixture(&Fixture::from_yaml(fixture)).map(|node| node.to_yaml())
}

/// Derive the dataflow of a fixture and encode it as a styled tree
pub fn encode_dataflow_fixture(fixture: &Fixture) -> Result<Node, String> {
    let prepared = prepare_fixture(fixture)?;
    let dataflow = prepared.with_request(None, derive_session_dataflow);
    let names = &prepared.names;
    let port = |script: u32, statement: u32| format!("{}.{statement}", names[script as usize]);

    let scripts = dataflow
        .scripts
        .iter()
        .enumerate()
        .map(|(i, script)| {
            let mut m = Map::new();
            m.plain("name", &names[i]);
            if !script.analyzed {
                m.boolean("analyzed", false);
                return m.into_node();
            }
            let text = prepared.scripts[i].0.text().to_string();
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
