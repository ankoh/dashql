//! What a run reads from a plan: the statements with where they come from, the errors of an invalid plan, the scripts
//! that the scripts of a plan follow, the nodes that a run leaves out and the visualizations of the outputs. The result
//! keys are `result_key`. Pure functions on an `ExecutionGraphT`, the run in `engine` decides with them.

use std::collections::{BTreeMap, BTreeSet};

use dashql_buffers::execution::{CompiledVisualizationT, ExecutionGraphEdgeT, ExecutionGraphNodeT, ExecutionGraphT};
use serde_json::{json, Value};

use crate::planner::dataflow::{Dataflow, DataflowEdgeKind};

/// The absent index of the graph
pub const NONE: u32 = u32::MAX;

/// The nodes of a graph
pub fn nodes(graph: &ExecutionGraphT) -> &[ExecutionGraphNodeT] {
    graph.nodes.as_deref().unwrap_or_default()
}

/// The edges of a graph
pub fn edges(graph: &ExecutionGraphT) -> &[ExecutionGraphEdgeT] {
    graph.edges.as_deref().unwrap_or_default()
}

/// The path of a materialization, empty if it is unknown
fn materialization_path(graph: &ExecutionGraphT, index: u32) -> Option<&str> {
    graph.materializations.as_ref()?.get(index as usize)?.path.as_deref()
}

/// The file of a script, `script <index>` for an unknown one
fn file_of(files: &[String], index: u32) -> String {
    files.get(index as usize).cloned().unwrap_or_else(|| format!("script {index}"))
}

/// The run of a plan: of the whole workbook or of a target script
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlanRun {
    /// A run of the workbook, of every script or of the scripts that a change of inputs affects
    Workbook,
    /// A run of a script, the file of the target
    Script(String),
}

/// A scan of a materialized result by a statement
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatementScan {
    /// The file of the scanned script
    pub script: String,
    /// The path of the file of the result
    pub path: String,
    /// Does the host provide the file of an earlier run?
    pub cached: bool,
}

/// Where a statement of a plan comes from
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlannedStatement {
    /// The run of the plan
    pub run: PlanRun,
    /// The node of the plan
    pub node: u32,
    /// The file of the script of the statement
    pub script: String,
    /// The statement among the statements of the script in the plan, from 1
    pub statement: u32,
    /// The statements of the script in the plan
    pub statements: u32,
    /// The type of the statement, e.g. SELECT
    pub statement_type: String,
    /// Is the statement the result of its script?
    pub result: bool,
    /// Is the statement the cached result of its script? The executor reads the file instead of running it.
    pub cached: bool,
    /// The scripts whose queries the statement inlines
    pub inlined: Vec<String>,
    /// The materialized results that the statement scans
    pub scans: Vec<StatementScan>,
    /// The file that the result of the statement is written to
    pub materializes: Option<String>,
    /// The nodes the statement runs after, with the reasons
    pub after: Vec<(u32, String)>,
}

impl PlannedStatement {
    /// The title in the query history, e.g. `bar.sql 2/3 · inlines foo.sql`
    pub fn title(&self) -> String {
        let mut parts = vec![format!("{} {}/{}", self.script, self.statement, self.statements)];
        if self.cached {
            parts.push("cached result".to_string());
        }
        if !self.inlined.is_empty() {
            parts.push(format!("inlines {}", self.inlined.join(", ")));
        }
        if !self.scans.is_empty() {
            let scans: Vec<String> = self
                .scans
                .iter()
                .map(|scan| if scan.cached { format!("{} (cached)", scan.script) } else { scan.script.clone() })
                .collect();
            parts.push(format!("scans {}", scans.join(", ")));
        }
        if self.materializes.is_some() {
            parts.push("materialized".to_string());
        }
        parts.join(" · ")
    }

    /// The description in the query history
    pub fn description(&self) -> String {
        let mut first = format!("{} {} of {} of {}", self.statement_type, self.statement, self.statements, self.script);
        if self.result {
            first.push_str(", the result of the script");
        }
        match &self.run {
            PlanRun::Workbook => first.push_str(", run of the workbook"),
            PlanRun::Script(target) => first.push_str(&format!(", run of {target}")),
        }
        let mut parts = vec![first];
        if self.cached {
            parts.push("served from the query result cache".to_string());
        }
        if !self.inlined.is_empty() {
            parts.push(format!("inlines the queries of {}", self.inlined.join(", ")));
        }
        for scan in &self.scans {
            parts.push(format!(
                "scans the {} result of {} at {}",
                if scan.cached { "cached" } else { "materialized" },
                scan.script,
                scan.path
            ));
        }
        if let Some(path) = &self.materializes {
            parts.push(format!("writes its result to {path}"));
        }
        if !self.after.is_empty() {
            let after: Vec<String> =
                self.after.iter().map(|(node, reason)| format!("node {node} ({reason})")).collect();
            parts.push(format!("runs after {}", after.join(", ")));
        }
        parts.join("; ")
    }

    /// Who issued the statement, the history shows it
    pub fn issuer(&self) -> String {
        match &self.run {
            PlanRun::Workbook => "Workbook run".to_string(),
            PlanRun::Script(target) => format!("Run of {target}"),
        }
    }

    /// The fields of the log messages of the statement
    pub fn log_fields(&self) -> Vec<(String, String)> {
        let scans: Vec<String> = self
            .scans
            .iter()
            .map(|scan| format!("{}{}: {}", scan.script, if scan.cached { " (cached)" } else { "" }, scan.path))
            .collect();
        let after: Vec<String> = self.after.iter().map(|(node, reason)| format!("{node} {reason}")).collect();
        vec![
            ("run".to_string(), self.run_name()),
            ("node".to_string(), self.node.to_string()),
            ("script".to_string(), self.script.clone()),
            ("statement".to_string(), format!("{}/{}", self.statement, self.statements)),
            ("statementType".to_string(), self.statement_type.clone()),
            ("result".to_string(), self.result.to_string()),
            ("cached".to_string(), self.cached.to_string()),
            ("inlined".to_string(), self.inlined.join(", ")),
            ("scans".to_string(), scans.join(", ")),
            ("materializes".to_string(), self.materializes.clone().unwrap_or_default()),
            ("after".to_string(), after.join(", ")),
        ]
    }

    /// The run as the log names it
    pub fn run_name(&self) -> String {
        match &self.run {
            PlanRun::Workbook => "workbook".to_string(),
            PlanRun::Script(target) => format!("script {target}"),
        }
    }

    /// The statement as the query metadata of the host holds it (`PlannedStatement` of `@akohn/dashql`)
    pub fn to_json(&self) -> Value {
        let (run, target) = match &self.run {
            PlanRun::Workbook => ("workbook", Value::Null),
            PlanRun::Script(target) => ("script", Value::String(target.clone())),
        };
        json!({
            "run": run,
            "target": target,
            "node": self.node,
            "script": self.script,
            "statement": self.statement,
            "statements": self.statements,
            "statementType": self.statement_type,
            "result": self.result,
            "cached": self.cached,
            "inlined": self.inlined,
            "scans": self.scans.iter().map(|scan| json!({ "script": scan.script, "path": scan.path, "cached": scan.cached })).collect::<Vec<_>>(),
            "materializes": self.materializes,
            "after": self.after.iter().map(|(node, reason)| json!({ "node": node, "reason": reason })).collect::<Vec<_>>(),
        })
    }
}

/// Where the statements of a plan come from, one per node
pub fn planned_statements(graph: &ExecutionGraphT, files: &[String], run: &PlanRun) -> Vec<PlannedStatement> {
    let nodes = nodes(graph);
    let mut statements_of: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for (index, node) in nodes.iter().enumerate() {
        statements_of.entry(node.script).or_default().push(index as u32);
    }
    let mut after: Vec<Vec<(u32, String)>> = vec![Vec::new(); nodes.len()];
    for edge in edges(graph) {
        let reason = edge.reason.variant_name().map(str::to_string).unwrap_or_else(|| edge.reason.0.to_string());
        if let Some(list) = after.get_mut(edge.to as usize) {
            if !list.iter().any(|(node, r)| *node == edge.from && *r == reason) {
                list.push((edge.from, reason));
            }
        }
    }
    let materializations = graph.materializations.as_deref().unwrap_or_default();
    nodes
        .iter()
        .enumerate()
        .map(|(index, node)| {
            let statements = statements_of.get(&node.script).map(Vec::as_slice).unwrap_or_default();
            let position = statements.iter().position(|n| *n as usize == index).unwrap_or(0);
            let scans = node
                .inputs
                .iter()
                .flatten()
                .filter_map(|m| materializations.get(*m as usize))
                .map(|m| StatementScan {
                    script: file_of(files, m.script),
                    path: m.path.clone().unwrap_or_default(),
                    cached: m.node == NONE,
                })
                .collect();
            PlannedStatement {
                run: run.clone(),
                node: index as u32,
                script: file_of(files, node.script),
                statement: position as u32 + 1,
                statements: statements.len() as u32,
                statement_type: node
                    .statement_type
                    .variant_name()
                    .map(str::to_string)
                    .unwrap_or_else(|| node.statement_type.0.to_string()),
                result: node.script_result,
                cached: false,
                inlined: node.inlined_scripts.iter().flatten().map(|script| file_of(files, *script)).collect(),
                scans,
                materializes: (node.materialization != NONE)
                    .then(|| materialization_path(graph, node.materialization).unwrap_or_default().to_string()),
                after: after.get(index).cloned().unwrap_or_default(),
            }
        })
        .collect()
}

/// The errors of an invalid plan, e.g. `bar.sql: unknown script or attachment :foo`
pub fn describe_plan_errors(graph: &ExecutionGraphT, files: &[String]) -> String {
    let diagnostics = graph.diagnostics.as_deref().unwrap_or_default();
    let errors: Vec<_> = diagnostics.iter().filter(|d| d.error).collect();
    let shown: Vec<_> = if errors.is_empty() { diagnostics.iter().collect() } else { errors };
    let messages: Vec<String> = shown
        .iter()
        .map(|diagnostic| {
            let message = diagnostic.message.clone().unwrap_or_default();
            let file = (diagnostic.script != NONE).then(|| files.get(diagnostic.script as usize)).flatten();
            match file {
                Some(file) if !message.starts_with(file.as_str()) => format!("{file}: {message}"),
                _ => message,
            }
        })
        .collect();
    let joined = messages.join("; ");
    if joined.is_empty() {
        "Invalid workbook execution plan".to_string()
    } else {
        joined
    }
}

/// The scripts whose nodes the nodes of a script follow, by script index. Edges go from earlier to later scripts.
pub fn script_follows(graph: &ExecutionGraphT, scripts: usize) -> Vec<BTreeSet<u32>> {
    let nodes = nodes(graph);
    let mut follows = vec![BTreeSet::new(); scripts];
    for edge in edges(graph) {
        let (Some(from), Some(to)) = (nodes.get(edge.from as usize), nodes.get(edge.to as usize)) else { continue };
        if from.script != to.script {
            if let Some(set) = follows.get_mut(to.script as usize) {
                set.insert(from.script);
            }
        }
    }
    follows
}

/// The nodes of a plan that don't run: the nodes of the connections that can't run and the nodes that follow them. A
/// script runs completely or not at all, so a skipped node skips the other nodes of its script too.
pub fn skipped_nodes(
    graph: &ExecutionGraphT,
    connection_ids: &[String],
    can_run: impl Fn(&str) -> bool,
) -> BTreeSet<u32> {
    let nodes = nodes(graph);
    let mut successors: Vec<Vec<u32>> = vec![Vec::new(); nodes.len()];
    for edge in edges(graph) {
        if let Some(list) = successors.get_mut(edge.from as usize) {
            list.push(edge.to);
        }
    }
    let mut nodes_of_script: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for (index, node) in nodes.iter().enumerate() {
        nodes_of_script.entry(node.script).or_default().push(index as u32);
    }
    let mut pending: Vec<u32> = nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| !connection_ids.get(node.connection as usize).is_some_and(|id| can_run(id)))
        .map(|(index, _)| index as u32)
        .collect();
    let mut skip = BTreeSet::new();
    while let Some(index) = pending.pop() {
        if !skip.insert(index) {
            continue;
        }
        pending.extend(successors.get(index as usize).into_iter().flatten().copied());
        if let Some(node) = nodes.get(index as usize) {
            pending.extend(nodes_of_script.get(&node.script).into_iter().flatten().copied());
        }
    }
    skip
}

/// The scripts that a change of inputs runs: the scripts that use one of the inputs and every script downstream of
/// them, by the references and relation edges of the dataflow. A script that runs only on request (`@manual`) is left
/// out, the scripts downstream of it are not. Indexes the scripts of the dataflow.
pub fn affected_scripts(dataflow: &Dataflow, inputs: &[String]) -> Vec<u32> {
    let mut affected = BTreeSet::new();
    let mut pending = Vec::new();
    for edge in &dataflow.edges {
        if edge.kind != DataflowEdgeKind::Input {
            continue;
        }
        let Some(input) = dataflow.inputs.get(edge.from.script as usize) else { continue };
        if !inputs.iter().any(|name| name.as_str() == &*input.name) {
            continue;
        }
        if affected.insert(edge.to.script) {
            pending.push(edge.to.script);
        }
    }
    while let Some(script) = pending.pop() {
        for edge in &dataflow.edges {
            // The source of an input or an attachment edge is no script
            let carries = matches!(
                edge.kind,
                DataflowEdgeKind::InlineReference | DataflowEdgeKind::ScanReference | DataflowEdgeKind::Table
            );
            if !carries || edge.from.script != script {
                continue;
            }
            if affected.insert(edge.to.script) {
                pending.push(edge.to.script);
            }
        }
    }
    affected.into_iter().filter(|script| !dataflow.scripts.get(*script as usize).is_some_and(|s| s.manual)).collect()
}

/// Can the views show a visualization? A Markdown visualization needs its document, a Vega-Lite one a spec that is
/// JSON, a KPI card its spec, a table nothing.
pub fn visualization_is_valid(visualization: &CompiledVisualizationT) -> bool {
    match visualization.renderer.as_deref() {
        Some("markdown") => visualization.markdown_spec.as_ref().is_some_and(|spec| spec.document.is_some()),
        Some("vegalite") => visualization
            .vegalite_spec
            .as_deref()
            .is_some_and(|spec| !spec.is_empty() && serde_json::from_str::<Value>(spec).is_ok()),
        Some("kpi") => visualization.kpi_spec.is_some(),
        Some("table") => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planner::dataflow::{DataflowEdge, DataflowPort, DataflowScript};
    use crate::planner::session_inputs::{InputTypeSource, SessionInput};
    use dashql_core::analyzer::{SqlType, SqlTypeKind};

    fn edge(from: u32, to: u32, kind: DataflowEdgeKind) -> DataflowEdge {
        DataflowEdge {
            from: DataflowPort { script: from, statement: 0 },
            to: DataflowPort { script: to, statement: 0 },
            kind,
            name: String::new(),
        }
    }

    fn input(name: &str) -> SessionInput {
        SessionInput {
            name: name.into(),
            sql_type: SqlType::scalar(SqlTypeKind::Text),
            type_source: InputTypeSource::None,
            literal: None,
            consumers: Vec::new(),
            warnings: Vec::new(),
        }
    }

    #[test]
    fn affected_scripts_follow_the_references_and_tables_downstream_of_the_inputs() {
        let dataflow = Dataflow {
            scripts: vec![DataflowScript::default(); 5],
            inputs: vec![input("min"), input("region")],
            attachments: Vec::new(),
            edges: vec![
                edge(0, 1, DataflowEdgeKind::Input),
                edge(1, 2, DataflowEdgeKind::InlineReference),
                edge(2, 4, DataflowEdgeKind::Table),
                edge(1, 3, DataflowEdgeKind::Input),
                edge(0, 0, DataflowEdgeKind::InvalidReference),
                // The source of an attachment edge is an attachment, the attachment 1 is no script
                edge(1, 0, DataflowEdgeKind::Attachment),
            ],
        };
        let names = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        assert_eq!(affected_scripts(&dataflow, &names(&["min"])), vec![1, 2, 4]);
        assert_eq!(affected_scripts(&dataflow, &names(&["region"])), vec![3]);
        assert_eq!(affected_scripts(&dataflow, &names(&["min", "region"])), vec![1, 2, 3, 4]);
        assert!(affected_scripts(&dataflow, &names(&["nope"])).is_empty());
    }

    #[test]
    fn affected_scripts_leave_out_scripts_that_run_on_request() {
        let mut scripts = vec![DataflowScript::default(); 3];
        scripts[1].manual = true;
        let dataflow = Dataflow {
            scripts,
            inputs: vec![input("min")],
            attachments: Vec::new(),
            edges: vec![edge(0, 1, DataflowEdgeKind::Input), edge(1, 2, DataflowEdgeKind::ScanReference)],
        };
        assert_eq!(affected_scripts(&dataflow, &["min".to_string()]), vec![2]);
    }
}
