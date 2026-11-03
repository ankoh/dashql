//! Reading Hyper plans into the view model.

use super::plan_view_model::{
    Fragment, OperatorCrossEdge, OperatorEdge, OperatorReference, ParsedOperatorNode, PathComponent, PlanViewModel,
};
use super::progress::{PlanInputEvent, Stats};
use dashql_buffers::parser::SymbolSpan;
use dashql_buffers::status::StatusCode;
use dashql_buffers::view as fb;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// A JSON node on the DFS stack.
///
/// The logic is the following:
/// - We do a post-order DFS traversal
/// - Whenever we find an operator, we re-construct the path toward the lowest operator ancestor
struct ParserDfsNode<'a> {
    /// The json value
    json_value: &'a Value,
    /// The DFS visited marker for the post-order traversal
    visited: bool,
    /// The parent index in the DFS
    parent_node_index: Option<usize>,
    /// The reference in the parent
    parent_path: PathComponent,
    /// The operator type (if any)
    operator_type: Option<String>,
    /// The operator label (if any)
    operator_label: Option<String>,
    /// The operator id serialized by Hyper (if any)
    source_operator_id: Option<u64>,
    /// The already emitted children
    child_operators: Vec<usize>,
    /// The source location
    source_location: Option<SymbolSpan>,
}

impl<'a> ParserDfsNode<'a> {
    fn new(json_value: &'a Value, parent_node_index: Option<usize>, parent_path: PathComponent) -> Self {
        Self {
            json_value,
            visited: false,
            parent_node_index,
            parent_path,
            operator_type: None,
            operator_label: None,
            source_operator_id: None,
            child_operators: Vec::new(),
            source_location: None,
        }
    }
}

/// Find the lowest operator ancestor of a DFS node and the path towards it
fn find_ancestor(nodes: &[ParserDfsNode], mut next: usize) -> (Option<usize>, Vec<PathComponent>) {
    let mut path = Vec::new();

    // Check the current node
    let node = &nodes[next];
    match node.parent_node_index {
        Some(parent) => {
            path.push(node.parent_path.clone());
            next = parent;
        }
        None => return (None, Vec::new()),
    }

    // Walk upwards until we hit the root or an operator
    loop {
        let node = &nodes[next];
        if node.operator_type.is_some() {
            path.reverse();
            return (Some(next), path);
        }
        match node.parent_node_index {
            None => {
                path.reverse();
                return (None, path);
            }
            Some(parent) => {
                path.push(node.parent_path.clone());
                next = parent;
            }
        }
    }
}

/// Infer the label of a scan from the relation of the attributes it defines
fn infer_scan_label(object: &Map<String, Value>) -> Option<String> {
    let attributes = object.get("attributes")?.as_array()?;
    let mut relation: Option<&str> = None;
    for attribute in attributes {
        let Some(qualified_id) = attribute.get("defines").and_then(|d| d.get("id")).and_then(Value::as_str) else {
            continue;
        };
        let candidate = match qualified_id.rsplit_once('.') {
            Some((candidate, _)) if !candidate.is_empty() => candidate,
            _ => continue,
        };
        if relation.is_some_and(|relation| relation != candidate) {
            return None;
        }
        relation = Some(candidate);
    }
    relation.map(String::from)
}

/// Read the source location of an operator from its `sqlpos` (`[[begin, end], ...]`)
fn read_source_location(sql_pos: &[Value]) -> Option<SymbolSpan> {
    let [begin, end] = sql_pos.first()?.as_array()?.as_slice() else {
        return None;
    };
    let read = |v: &Value| v.as_u64().and_then(|n| u32::try_from(n).ok()).unwrap_or(0);
    let (begin, end) = (read(begin), read(end));
    Some(SymbolSpan::new(begin, end.max(begin) - begin))
}

/// Is the operator type one of the join operators that may reference a magic set?
fn is_join_operator(operator_type: &str) -> bool {
    matches!(
        operator_type,
        "join"
            | "leftouterjoin"
            | "rightouterjoin"
            | "fullouterjoin"
            | "leftantijoin"
            | "rightantijoin"
            | "leftsemijoin"
            | "rightsemijoin"
            | "leftsinglejoin"
            | "rightsinglejoin"
            | "leftmarkjoin"
            | "rightmarkjoin"
    )
}

/// Serialize an attribute value as compact JSON
fn to_json(value: &Value) -> String {
    serde_json::to_string(value).expect("a JSON value always serializes")
}

/// Does a JSON value contain an operator?
fn contains_operator(value: &Value) -> bool {
    match value {
        Value::Object(members) => {
            members.get("operator").is_some_and(Value::is_string) || members.values().any(contains_operator)
        }
        Value::Array(elements) => elements.iter().any(contains_operator),
        _ => false,
    }
}

/// The first of several members that exists
fn find_member<'a>(object: &'a Map<String, Value>, names: &[&str]) -> Option<&'a Value> {
    names.iter().find_map(|name| object.get(*name))
}

/// The first of several members that exists, if it is a number
fn find_number<'a>(object: &'a Map<String, Value>, names: &[&str]) -> Option<&'a serde_json::Number> {
    find_member(object, names).and_then(|member| member.as_number())
}

/// Read the estimated output rows and the runtime counters of an analyzed plan (EXPLAIN ANALYZE)
fn read_execution_statistics(source: &Map<String, Value>) -> (Option<f64>, Stats) {
    let runtime = source.get("statistics").and_then(Value::as_object).unwrap_or(source);

    const ROWS: &[&str] = &["estimated-rows", "estimatedRows", "cardinality"];
    let estimated_rows = find_number(source, ROWS).or_else(|| find_number(runtime, ROWS)).and_then(|n| n.as_f64());

    let count = |names: &[&str]| find_number(runtime, names).and_then(|n| n.as_u64());
    let analyzed = Stats {
        tuples_in: count(&["processed-rows", "processedRows"]),
        tuples_out: count(&["output-rows", "outputRows"]),
        memory_bytes: count(&["memory-bytes", "memoryBytes"]),
        ..Default::default()
    };
    (estimated_rows, analyzed)
}

/// The engine-neutral kind of a Hyper operator
fn hyper_operator_kind(operator_type: &str) -> fb::PlanOperatorKind {
    use fb::PlanOperatorKind as K;
    match operator_type.to_lowercase().replace('-', "").as_str() {
        "output" => K::OUTPUT,
        "scan" | "parquetscan" | "tablescan" => K::SCAN,
        "explicitscan" => K::EXPLICIT_SCAN,
        "virtualtable" => K::VIRTUAL_TABLE,
        "tableconstruction" => K::TABLE_CONSTRUCTION,
        "tablefunction" => K::TABLE_FUNCTION,
        "select" => K::FILTER,
        "map" => K::PROJECT,
        "groupby" => K::AGGREGATE,
        "window" => K::WINDOW,
        "sort" => K::SORT,
        "join" => K::JOIN,
        "leftouterjoin" => K::LEFT_OUTER_JOIN,
        "rightouterjoin" => K::RIGHT_OUTER_JOIN,
        "fullouterjoin" => K::FULL_OUTER_JOIN,
        "leftsemijoin" => K::LEFT_SEMI_JOIN,
        "rightsemijoin" => K::RIGHT_SEMI_JOIN,
        "leftantijoin" => K::LEFT_ANTI_JOIN,
        "rightantijoin" => K::RIGHT_ANTI_JOIN,
        "leftmarkjoin" => K::LEFT_MARK_JOIN,
        "rightmarkjoin" => K::RIGHT_MARK_JOIN,
        "unionall" => K::UNION_ALL,
        "union" => K::UNION,
        "intersectall" => K::INTERSECT_ALL,
        "intersect" => K::INTERSECT,
        "exceptall" => K::EXCEPT_ALL,
        "except" => K::EXCEPT,
        "iteration" => K::ITERATION,
        "iterationincrement" => K::ITERATION_INCREMENT,
        "insert" => K::INSERT,
        _ => K::OTHER,
    }
}

/// The references of an operator to other operators by their Hyper operator ids
fn read_operator_references(operator_type: &str, object: &Map<String, Value>) -> Vec<OperatorReference> {
    let mut references = Vec::new();
    let mut reference = |name: &str, kind: &'static str| {
        if let Some(source_operator_id) = object.get(name).and_then(Value::as_u64) {
            references.push(OperatorReference { source_operator_id, kind, attributes: Vec::new() });
        }
    };
    match operator_type {
        "explicitscan" | "explicit-scan" => reference("input", "input"),
        "iterationincrement" => reference("source", "source"),
        "earlyprobe" => reference("builder", "builder"),
        t if is_join_operator(t) => reference("magic", "magic"),
        _ => {}
    }

    let early_probes = object.get("earlyProbes").or_else(|| object.get("early-probes"));
    for probe in early_probes.and_then(Value::as_array).into_iter().flatten() {
        let Some(probe) = probe.as_object() else {
            continue;
        };
        if let Some(builder) = probe.get("builder").and_then(Value::as_u64) {
            let attributes = probe
                .iter()
                .filter(|(name, _)| *name != "builder" && *name != "kind")
                .map(|(name, value)| (name.clone(), to_json(value)))
                .collect();
            references.push(OperatorReference { source_operator_id: builder, kind: "early-probe", attributes });
        }
    }
    references
}

/// Read the operator from the DFS node of its JSON object
fn read_operator(node: ParserDfsNode, parent_child_path: Vec<PathComponent>) -> ParsedOperatorNode {
    let object = node.json_value.as_object().expect("operators are objects");
    let operator_type = node.operator_type.expect("operators have a type");
    // The attributes are the members that do not contain other operators
    let attributes = object
        .iter()
        .filter(|(_, value)| !contains_operator(value))
        .map(|(name, value)| (name.clone(), to_json(value)))
        .collect();
    let (estimated_rows, analyzed) = read_execution_statistics(object);
    ParsedOperatorNode {
        parent_child_path,
        references: read_operator_references(&operator_type, object),
        attributes,
        estimated_rows,
        analyzed,
        operator_type: Some(operator_type),
        operator_label: node.operator_label,
        source_operator_id: node.source_operator_id,
        child_operators: node.child_operators,
        source_location: node.source_location,
    }
}

impl PlanViewModel {
    /// Parse a Hyper plan.
    ///
    /// The runtime counters of an analyzed plan (EXPLAIN ANALYZE) are applied as one batch of input events, the
    /// same path as the progress of a running query.
    pub fn parse_hyper_plan(&mut self, plan: &[u8]) -> Result<(), StatusCode> {
        // Reset the current plan view model
        self.reset();
        self.engine = fb::PlanEngine::HYPER;

        // Parse the document
        let document: Value =
            serde_json::from_slice(plan).map_err(|_| StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR)?;

        // Run DFS over the json plan.
        // Perform a post-order DFS over all json nodes.
        // Emit operator nodes on our way up and resolve the lowest ancestor through the DFS stack.
        let mut parsed_operators: Vec<ParsedOperatorNode> = Vec::new();
        let mut root_operators: Vec<usize> = Vec::new();
        let mut pending = vec![ParserDfsNode::new(&document, None, PathComponent::None)];
        let mut child_edge_count = 0;
        while !pending.is_empty() {
            let current_index = pending.len() - 1;

            // Already visited?
            if pending[current_index].visited {
                // Is an operator?
                if pending[current_index].operator_type.is_some() {
                    // Build the ancestor path
                    let (ancestor, ancestor_path) = find_ancestor(&pending, current_index);
                    // Then emit the node
                    let current = pending.pop().unwrap();
                    let op = parsed_operators.len();
                    child_edge_count += current.child_operators.len();
                    parsed_operators.push(read_operator(current, ancestor_path));
                    match ancestor {
                        // Register as child operator in ancestor
                        Some(ancestor) => pending[ancestor].child_operators.push(op),
                        // No parent operator, register as root
                        None => root_operators.push(op),
                    }
                } else {
                    // Otherwise do nothing, the attributes are read when emitting the operator
                    pending.pop();
                }
                continue;
            }
            // Mark as visited
            pending[current_index].visited = true;

            match pending[current_index].json_value {
                // Current node is an object:
                // - Add children for DFS
                // - Check if it is an operator
                Value::Object(members) => {
                    let pending_begin = pending.len();
                    for (attribute_name, value) in members {
                        let current = &mut pending[current_index];
                        match (attribute_name.as_str(), value) {
                            // Is the current node an operator?
                            // Mark as such and skip attribute during DFS
                            ("operator", Value::String(operator_type)) => {
                                current.operator_type = Some(operator_type.clone());
                            }
                            // Contains an operator id?
                            ("operatorId" | "operator-id", _) if value.is_u64() => {
                                current.source_operator_id = value.as_u64();
                            }
                            // Contains a debug name? Hyper plans use both camelCase and kebab-case spellings.
                            ("debugName" | "debug-name", Value::Object(debug_name)) => {
                                if let Some(label) = debug_name.get("value").and_then(Value::as_str) {
                                    current.operator_label = Some(label.to_string());
                                }
                            }
                            // Contains a sqlpos?
                            ("sqlpos", Value::Array(sql_pos)) => {
                                if let Some(location) = read_source_location(sql_pos) {
                                    current.source_location = Some(location);
                                }
                            }
                            // Mark pending for DFS traversal
                            _ => pending.push(ParserDfsNode::new(
                                value,
                                Some(current_index),
                                PathComponent::MemberInObject { attribute: attribute_name.clone() },
                            )),
                        }
                    }
                    let current = &mut pending[current_index];
                    if current.operator_label.is_none() && current.operator_type.as_deref() == Some("scan") {
                        current.operator_label = infer_scan_label(members);
                    }
                    // Reverse the order of the attribute nodes on the stack
                    pending[pending_begin..].reverse();
                }
                // Current node is an array:
                // - Add children for DFS
                Value::Array(values) => {
                    for (j, child_value) in values.iter().enumerate().rev() {
                        pending.push(ParserDfsNode::new(
                            child_value,
                            Some(current_index),
                            PathComponent::EntryInArray { index: j },
                        ));
                    }
                }
                // Skip value nodes during DFS traversal
                Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
            }
        }

        // Flatten the Hyper operators
        self.flatten_operators(parsed_operators, root_operators);
        for op in &mut self.operators {
            op.kind = op.operator_type.as_deref().map(hyper_operator_kind).unwrap_or_default();
        }
        // Resolve non-containment references between flattened operators
        self.identify_operator_cross_edges();
        // Identify fragments introduced by federates
        self.identify_fragments();
        // Identify the operator edges
        self.identify_operator_edges(child_edge_count);
        // Read pipelines if this plan format provides them. Legacy plans render without pipeline overlays.
        if let Some(pipelines) = document.get("pipelines").and_then(Value::as_array) {
            self.parse_hyper_pipelines(pipelines);
        }
        self.seal_loaded_structure();

        // Apply the counters of an analyzed plan
        let analyzed: Vec<PlanInputEvent> = self
            .operators
            .iter_mut()
            .enumerate()
            .filter(|(_, op)| !op.analyzed.is_empty())
            .map(|(operator, op)| PlanInputEvent::UpdateOperator {
                time: 0,
                operator: operator as u32,
                status: None,
                stats: std::mem::take(&mut op.analyzed),
            })
            .collect();
        self.apply_events(&analyzed);
        Ok(())
    }

    /// Map the operator ids serialized by Hyper to operators, the first operator wins
    fn source_operator_ids(&self) -> HashMap<u64, u32> {
        let mut operator_ids = HashMap::new();
        for (operator_id, op) in self.operators.iter().enumerate() {
            if let Some(source_operator_id) = op.source_operator_id {
                operator_ids.entry(source_operator_id).or_insert(operator_id as u32);
            }
        }
        operator_ids
    }

    /// Resolve non-containment operator references
    fn identify_operator_cross_edges(&mut self) {
        let operator_ids = self.source_operator_ids();

        let mut pending: Vec<(u32, u32, &'static str, Vec<(String, String)>)> = Vec::new();
        for (operator_id, op) in self.operators.iter_mut().enumerate() {
            for reference in std::mem::take(&mut op.references) {
                if let Some(&source) = operator_ids.get(&reference.source_operator_id) {
                    pending.push((source, operator_id as u32, reference.kind, reference.attributes));
                }
            }
        }

        pending.sort_by_key(|(source_node, ..)| *source_node);
        self.operator_cross_edges.reserve(pending.len());
        for (source_node, target_node, kind, attributes) in pending {
            let source = &mut self.operators[source_node as usize];
            if source.cross_edge_count == 0 {
                source.cross_edges_begin = self.operator_cross_edges.len();
            }
            source.cross_edge_count += 1;
            self.operator_cross_edges.push(OperatorCrossEdge {
                source_node,
                target_node,
                kind,
                attributes,
            });
        }
    }

    /// Identify fragments introduced by federate operators.
    ///
    /// An execution target at the root introduces a hidden root fragment, every federate a fragment. Fragments
    /// nest: an operator belongs to its innermost fragment, a nested federate starts a child fragment.
    fn identify_fragments(&mut self) {
        let operators = &self.operators;
        let mut boundaries: Vec<u32> = Vec::new();
        let mut root_boundaries: Vec<u32> = Vec::new();
        let mut pending: Vec<u32> = Vec::with_capacity(operators.len());
        for &root in self.root_operators.iter().rev() {
            if operators[root as usize].operator_type.as_deref() == Some("executiontarget") {
                root_boundaries.push(root);
            }
            pending.push(root);
        }
        let push_children = |pending: &mut Vec<u32>, operator_id: u32| {
            pending.extend(operators[operator_id as usize].children().rev().map(|c| c as u32));
        };
        while let Some(operator_id) = pending.pop() {
            if operators[operator_id as usize].operator_type.as_deref() == Some("federate") {
                boundaries.push(operator_id);
            }
            push_children(&mut pending, operator_id);
        }
        boundaries.splice(0..0, root_boundaries);
        let fragment_of: HashMap<u32, u32> = boundaries.iter().enumerate().map(|(f, b)| (*b, f as u32)).collect();

        // Collect the operators of every fragment and stop at nested fragments.
        // Enclosing fragments come first, so a nested fragment knows its parent before it is collected.
        let mut parents: Vec<Option<u32>> = vec![None; boundaries.len()];
        let mut fragments = Vec::with_capacity(boundaries.len());
        for (f, &boundary_id) in boundaries.iter().enumerate() {
            let mut fragment = Fragment {
                parent_fragment: parents[f],
                root_operator: Some(boundary_id),
                operators: vec![boundary_id],
                hidden: operators[boundary_id as usize].operator_type.as_deref() == Some("executiontarget"),
                ..Default::default()
            };
            pending.clear();
            push_children(&mut pending, boundary_id);
            while let Some(operator_id) = pending.pop() {
                if let Some(&nested) = fragment_of.get(&operator_id) {
                    parents[nested as usize] = Some(f as u32);
                    continue;
                }
                fragment.operators.push(operator_id);
                push_children(&mut pending, operator_id);
            }
            fragments.push(fragment);
        }
        for (f, fragment) in fragments.iter().enumerate() {
            for &operator_id in &fragment.operators {
                self.operators[operator_id as usize].fragment = Some(f as u32);
            }
        }
        self.fragments = fragments;
    }

    /// Identify the operator edges
    fn identify_operator_edges(&mut self, child_edge_count: usize) {
        let mut child_edges = Vec::with_capacity(child_edge_count);
        for (parent_id, parent) in self.operators.iter().enumerate() {
            for (port, child_id) in parent.children().enumerate() {
                child_edges.push(OperatorEdge {
                    parent_operator: parent_id as u32,
                    child_operator: child_id as u32,
                    parent_port_count: parent.children_count,
                    parent_port_index: port,
                    slot: None,
                });
            }
        }
        self.operator_edges = child_edges;
    }

    /// Read explicit Hyper pipelines.
    ///
    /// A member without a member child produces the tuples of the pipeline (source), a member without a member
    /// parent consumes them (sink).
    fn parse_hyper_pipelines(&mut self, source_pipelines: &[Value]) {
        let operator_ids = self.source_operator_ids();
        for source_pipeline in source_pipelines {
            let Some(source_pipeline) = source_pipeline.as_object() else {
                continue;
            };
            let engine_id = source_pipeline.get("pipelineId").and_then(Value::as_u64).map(|id| id.to_string());
            let members: Vec<u32> = source_pipeline
                .get("operators")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|member| operator_ids.get(&member.as_u64()?).copied())
                .collect();
            let membership: HashSet<u32> = members.iter().copied().collect();
            let slots: Vec<(u32, fb::PlanSlotRole)> = members
                .iter()
                .map(|&member| {
                    let op = &self.operators[member as usize];
                    let consumes = op.children().any(|child| membership.contains(&(child as u32)));
                    let feeds = op.parent.is_some_and(|parent| membership.contains(&(parent as u32)));
                    let role = match (consumes, feeds) {
                        (false, _) => fb::PlanSlotRole::SOURCE,
                        (true, true) => fb::PlanSlotRole::THROUGH,
                        (true, false) => fb::PlanSlotRole::SINK,
                    };
                    (member, role)
                })
                .collect();
            let fragment = members.first().and_then(|m| self.operators[*m as usize].fragment);
            let attributes = source_pipeline
                .iter()
                .filter(|(name, _)| *name != "pipelineId" && *name != "operators")
                .map(|(name, value)| (name.clone(), to_json(value)))
                .collect();
            self.add_pipeline(engine_id, fragment, &slots, attributes);
        }
    }
}
