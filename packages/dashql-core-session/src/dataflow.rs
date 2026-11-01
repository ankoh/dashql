//! The dataflow of a session: which statements read the data that other statements produce.
//!
//! The dataflow view draws every script as a box of its statements and the flow of data between the
//! statements as edges. The dataflow is a projection of a tolerant plan of the session (`PlanScope::Tolerant`),
//! so relations and script references are resolved exactly like a run resolves them:
//!
//! - A table parameter `:foo` reads the result of the terminal query of `foo.sql`, inlined within one connection
//!   or scanned as materialized result on the LOCAL connection. Invalid references are edges too, as long as their
//!   name finds a script, the editor reports their errors.
//! - A statement reads or writes a relation after another statement created or wrote it: the planner edges
//!   `READ_AFTER_WRITE`, `WRITE_AFTER_WRITE` and `DDL` of a relation whose source statement wrote it. A drop
//!   reads no data. A statement that reads a relation only through the query of an inlined script reads it through
//!   that script, the edge into the statement is left out.
//!
//! The planner edges that only order statements (`WRITE_AFTER_READ`, `BARRIER`, `SEQUENCE`) and the edges of
//! materializations, which the references stand for, are no dataflow.

use crate::planner::{plan_session, PlanScope, Prepared, SessionPlanRequest};
use crate::script_references::{check_script_references, CheckedReferenceKind};
use dashql_buffers::execution::{ExecutionGraphAccessMode as Mode, ExecutionGraphEdgeReason as Reason, ExecutionGraphNodeT, ExecutionGraphT};
use dashql_buffers::parser::StatementType;
use dashql_parser::span::TextSpan;
use std::collections::{BTreeMap, BTreeSet};

const NONE: u32 = u32::MAX;

/// What carries the data of an edge
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum DataflowEdgeKind {
    /// A table parameter inlines the terminal query of the referenced script
    InlineReference,
    /// A table parameter scans the materialized result of the referenced script
    ScanReference,
    /// A table parameter with errors
    InvalidReference,
    /// A statement reads or writes a relation that another statement created or wrote
    Table,
}

/// A statement of a script
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataflowStatement {
    /// The statement type
    pub statement_type: StatementType,
    /// The relation that the statement creates, writes or drops
    pub target: Option<String>,
    /// The text of the statement, in UTF-8 bytes
    pub text_span: TextSpan,
}

/// A script of the session
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DataflowScript {
    /// Was the script planned? A script without a current analysis is not, its statements and the edges that start
    /// or end at it are unknown.
    pub analyzed: bool,
    /// The text version of the analysis
    pub text_version: u64,
    /// The statements in script order
    pub statements: Vec<DataflowStatement>,
}

/// An end of an edge: a statement of a script
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct DataflowPort {
    /// The script index
    pub script: u32,
    /// The statement id
    pub statement: u32,
}

/// The flow of data from one statement to another
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct DataflowEdge {
    /// The statement that produces the data
    pub from: DataflowPort,
    /// The statement that reads the data
    pub to: DataflowPort,
    /// What carries the data
    pub kind: DataflowEdgeKind,
    /// The parameter name of a reference, the relation name of a table edge
    pub name: String,
}

/// The dataflow of a session
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Dataflow {
    /// The scripts in session order
    pub scripts: Vec<DataflowScript>,
    /// The edges, sorted and without duplicates
    pub edges: Vec<DataflowEdge>,
}

/// A relation that a node accesses: an entity or an unresolved reference
type Relation = (u32, u32);

fn relation_of(entity: u32, unresolved: u32) -> Option<Relation> {
    (entity != NONE || unresolved != NONE).then_some((entity, unresolved))
}

/// The name of a relation of the graph
fn relation_name(graph: &ExecutionGraphT, (entity, unresolved): Relation) -> String {
    let name = if entity != NONE {
        graph.entities.as_ref().and_then(|e| e.get(entity as usize)).and_then(|e| e.name.clone())
    } else {
        graph.unresolved_references.as_ref().and_then(|r| r.get(unresolved as usize)).and_then(|r| r.name.clone())
    };
    name.unwrap_or_default()
}

/// The relations that a node writes or creates
fn writes(node: &ExecutionGraphNodeT) -> impl Iterator<Item = Relation> + '_ {
    node.accesses
        .iter()
        .flatten()
        .filter(|a| a.mode != Mode::READ)
        .filter_map(|a| relation_of(a.entity, a.unresolved_reference))
}

/// Does the statement of a node read a relation itself, not only through the query of an inlined script? The table
/// references of its analysis are those of its own text.
fn reads_directly(request: &SessionPlanRequest, graph: &ExecutionGraphT, node: &ExecutionGraphNodeT, (entity, unresolved): Relation) -> bool {
    let Some(analyzed) = request.scripts.get(node.script as usize).and_then(|s| s.script.analyzed.as_ref()) else { return false };
    let entity_id = graph.entities.as_ref().and_then(|e| e.get(entity as usize)).map(|e| e.catalog_object_id.object_id);
    let unresolved_name = graph.unresolved_references.as_ref().and_then(|r| r.get(unresolved as usize)).and_then(|r| r.name.clone());
    analyzed
        .table_references
        .iter()
        .filter(|r| r.ast_statement_id == Some(node.statement_id) && !r.reads_script_result())
        .filter_map(|r| r.inner.as_ref())
        .any(|relation| match (&relation.resolved_table, entity_id) {
            (Some(resolved), Some(id)) => resolved.catalog_table_id.unpack_table_id().pack() == id,
            (None, None) => unresolved_name.as_deref() == Some(&*relation.table_name.table_name.text),
            _ => false,
        })
}

/// Derive the dataflow of the scripts of a session. Ignores the scope and the materializations of the request.
pub fn derive_session_dataflow(request: &SessionPlanRequest) -> Dataflow {
    let tolerant = SessionPlanRequest { scope: PlanScope::Tolerant, materialized: &[], ..*request };
    let graph = plan_session(&tolerant);
    let empty = Vec::new();
    let nodes = graph.nodes.as_ref().unwrap_or(&empty);
    let port = |node: &ExecutionGraphNodeT| DataflowPort { script: node.script, statement: node.statement_id };
    let node_of: BTreeMap<(u32, u32), u32> = nodes.iter().enumerate().map(|(i, n)| ((n.script, n.statement_id), i as u32)).collect();

    // The statements, from the nodes of the plan
    let mut scripts: Vec<DataflowScript> = vec![DataflowScript::default(); request.scripts.len()];
    let spans: Vec<Vec<TextSpan>> = request
        .scripts
        .iter()
        .map(|s| Prepared::lenient(s.script).map(|p| p.parsed.associate_descriptions().iter().map(|d| d.statement_span).collect()).unwrap_or_default())
        .collect();
    for node in nodes {
        let Some(script) = scripts.get_mut(node.script as usize) else { continue };
        let text_span = spans[node.script as usize].get(node.statement_id as usize).copied().unwrap_or_default();
        script.analyzed = true;
        script.statements.push(DataflowStatement {
            statement_type: node.statement_type,
            target: writes(node).next().map(|r| relation_name(&graph, r)),
            text_span,
        });
    }
    for (i, script) in scripts.iter_mut().enumerate() {
        let input = request.scripts[i].script;
        // A script without statements has no nodes, it is planned if its analysis is current
        if !script.analyzed {
            script.analyzed = Prepared::lenient(input).is_some_and(|p| p.parsed.statements.is_empty());
        }
        if script.analyzed {
            script.text_version = input.analyzed.as_ref().map_or(0, |a| a.parsed.scanned.text_version);
        }
    }

    let mut edges: BTreeSet<DataflowEdge> = BTreeSet::new();
    // The terminal node of a script
    let terminal_of = |script: u32| -> Option<u32> {
        let meta = graph.scripts.as_ref()?.get(script as usize)?;
        node_of.get(&(script, meta.terminal_statement_id)).copied()
    };

    // Script references
    for reference in graph.references.iter().flatten() {
        let (Some(from), Some(to)) = (terminal_of(reference.script), nodes.get(reference.node as usize)) else { continue };
        edges.insert(DataflowEdge {
            from: port(&nodes[from as usize]),
            to: port(to),
            kind: if reference.materialization != NONE { DataflowEdgeKind::ScanReference } else { DataflowEdgeKind::InlineReference },
            name: reference.parameter.clone().unwrap_or_default(),
        });
    }
    for (consumer, checked) in check_script_references(request).into_iter().enumerate() {
        for reference in checked.references.into_iter().filter(|r| r.kind == CheckedReferenceKind::Invalid) {
            let (Some(producer), Some(statement)) = (reference.script, reference.statement_id) else { continue };
            let Some(from) = terminal_of(producer) else { continue };
            if !node_of.contains_key(&(consumer as u32, statement)) {
                continue;
            }
            edges.insert(DataflowEdge {
                from: port(&nodes[from as usize]),
                to: DataflowPort { script: consumer as u32, statement },
                kind: DataflowEdgeKind::InvalidReference,
                name: reference.parameter,
            });
        }
    }

    // Relations: the edges whose source wrote the relation
    let mut table_edges: BTreeMap<(u32, Relation), BTreeSet<u32>> = BTreeMap::new();
    for e in graph.edges.iter().flatten() {
        if !matches!(e.reason, Reason::READ_AFTER_WRITE | Reason::WRITE_AFTER_WRITE | Reason::DDL) {
            continue;
        }
        let Some(relation) = relation_of(e.entity, e.unresolved_reference) else { continue };
        let (from, to) = (&nodes[e.from as usize], &nodes[e.to as usize]);
        // A drop neither produces nor reads data
        let drop = |node: &ExecutionGraphNodeT| matches!(node.statement_type, StatementType::DROP_TABLE | StatementType::DROP_VIEW);
        if !writes(from).any(|r| r == relation) || drop(from) || drop(to) {
            continue;
        }
        table_edges.entry((e.from, relation)).or_default().insert(e.to);
    }
    for (&(from, relation), targets) in &table_edges {
        for &to in targets {
            // A read only through the query of an inlined script flows through that script
            let node = &nodes[to as usize];
            let through_inlined = node
                .inlined_scripts
                .iter()
                .flatten()
                .filter_map(|&script| terminal_of(script))
                .any(|terminal| terminal != to && targets.contains(&terminal));
            if through_inlined && !writes(node).any(|r| r == relation) && !reads_directly(request, &graph, node, relation) {
                continue;
            }
            edges.insert(DataflowEdge {
                from: port(&nodes[from as usize]),
                to: port(&nodes[to as usize]),
                kind: DataflowEdgeKind::Table,
                name: relation_name(&graph, relation),
            });
        }
    }

    Dataflow { scripts, edges: edges.into_iter().collect() }
}
