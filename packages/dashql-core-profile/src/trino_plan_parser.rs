//! Reading Trino plans into the query profile.
//!
//! Trino plans are a map from fragment id to the plan tree of the fragment, the JSON format of
//! `EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON)`. QueryInfo (`/v1/query/{id}`) carries the same JSON per stage
//! (`stages.stages[].plan.jsonRepresentation`), both are read. Every fragment is a stage at runtime, the stage id
//! `<queryId>.<fragmentId>` ends with the fragment id.
//!
//! A `RemoteSource` (or `RemoteMerge`) node reads the output of the fragments in `sourceFragmentIds`. The parser
//! hangs the roots of those fragments below it, so the plan is one tree and the fragments nest.

use super::query_profile::{Fragment, ParsedOperatorNode, PathComponent, QueryProfile};
use dashql_buffers::profile as fb;
use dashql_buffers::status::StatusCode;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

/// The engine-neutral kind of a Trino plan node
fn trino_operator_kind(name: &str) -> fb::ProfileOperatorKind {
    use fb::ProfileOperatorKind as K;
    match name {
        "Output" => K::OUTPUT,
        "TableScan" | "ScanFilter" | "ScanProject" | "ScanFilterProject" => K::SCAN,
        "Values" => K::VIRTUAL_TABLE,
        "TableFunction" | "TableFunctionProcessor" => K::TABLE_FUNCTION,
        "Filter" => K::FILTER,
        "Project" => K::PROJECT,
        "Aggregate" | "MarkDistinct" => K::AGGREGATE,
        "Window" | "TopNRanking" | "RowNumber" => K::WINDOW,
        "Sort" | "PartialSort" | "TopN" | "TopNPartial" | "LocalMerge" => K::SORT,
        "Limit" | "LimitPartial" | "DistinctLimit" | "DistinctLimitPartial" => K::LIMIT,
        "InnerJoin" | "CrossJoin" | "SpatialJoin" | "IndexJoin" => K::JOIN,
        "LeftJoin" => K::LEFT_OUTER_JOIN,
        "RightJoin" => K::RIGHT_OUTER_JOIN,
        "FullJoin" => K::FULL_OUTER_JOIN,
        "SemiJoin" => K::LEFT_SEMI_JOIN,
        "Union" => K::UNION_ALL,
        "Intersect" => K::INTERSECT,
        "Except" => K::EXCEPT,
        "TableWriter" | "TableWriterPartial" | "TableFinish" | "MergeWriter" | "TableExecute" => K::INSERT,
        "LocalExchange" | "RemoteSource" | "RemoteMerge" | "RemoteExchange" | "Exchange" => K::EXCHANGE,
        _ => K::OTHER,
    }
}

/// Serialize an attribute value as compact JSON
fn to_json(value: &Value) -> String {
    serde_json::to_string(value).expect("a JSON value always serializes")
}

/// The fragments of a node that reads other fragments (`sourceFragmentIds: "[1, 2]"`)
fn source_fragments(node: &Map<String, Value>) -> Vec<String> {
    let Some(ids) = node.get("descriptor").and_then(|d| d.get("sourceFragmentIds")).and_then(Value::as_str) else {
        return Vec::new();
    };
    let ids = ids.trim_matches(|c| c == '[' || c == ']');
    ids.split(',').map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect()
}

/// The label of a node: the table of a scan (`tpch:sf1:lineitem` -> `lineitem`)
fn label_of(node: &Map<String, Value>) -> Option<String> {
    let table = node.get("descriptor")?.get("table")?.as_str()?;
    Some(table.rsplit(':').next().unwrap_or(table).to_string())
}

/// The fragments of a Trino plan document by fragment id
fn read_fragments(document: Value) -> Result<BTreeMap<String, Value>, StatusCode> {
    let Value::Object(mut object) = document else {
        return Err(StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR);
    };
    // A QueryInfo: the plans of the stages
    if let Some(stages) = object.remove("stages") {
        let mut fragments = BTreeMap::new();
        let stages = stages.get("stages").and_then(Value::as_array).cloned().unwrap_or_default();
        for stage in stages {
            let Some(stage_id) = stage.get("stageId").and_then(Value::as_str) else { continue };
            let fragment_id = stage_id.rsplit('.').next().unwrap_or(stage_id).to_string();
            let Some(plan) = stage.get("plan").and_then(|p| p.get("jsonRepresentation")).and_then(Value::as_str) else {
                continue;
            };
            let plan: Value = serde_json::from_str(plan).map_err(|_| StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR)?;
            fragments.insert(fragment_id, plan);
        }
        return Ok(fragments);
    }
    // EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON): fragment id -> plan node
    if object.values().all(|v| v.get("name").is_some_and(Value::is_string)) {
        return Ok(object.into_iter().collect());
    }
    Err(StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR)
}


/// The ids of the fragments that a plan tree reads
fn read_fragment_ids(root: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    let mut pending = vec![root];
    while let Some(node) = pending.pop() {
        if let Some(node) = node.as_object() {
            ids.extend(source_fragments(node));
            pending.extend(node.get("children").and_then(Value::as_array).into_iter().flatten());
        }
    }
    ids
}

/// The parser state
struct TrinoPlanReader<'a> {
    /// The plan trees of the fragments
    plans: &'a BTreeMap<String, Value>,
    /// The parsed operators
    operators: Vec<ParsedOperatorNode>,
    /// The fragments in the order they were read, parents first
    fragments: Vec<Fragment>,
    /// The index of every fragment that was read
    fragment_index: HashMap<String, u32>,
}

impl TrinoPlanReader<'_> {
    /// Read a fragment, returns its root operator. A fragment is read once, a second reference is ignored.
    fn read_fragment(&mut self, fragment_id: &str, parent: Option<u32>) -> Option<usize> {
        if self.fragment_index.contains_key(fragment_id) {
            return None;
        }
        let root = self.plans.get(fragment_id)?.as_object()?;
        let fragment = self.fragments.len() as u32;
        self.fragment_index.insert(fragment_id.to_string(), fragment);
        self.fragments.push(Fragment {
            engine_id: Some(fragment_id.to_string()),
            parent_fragment: parent,
            // The root fragment encloses the whole plan, its contour shows nothing
            hidden: parent.is_none(),
            ..Default::default()
        });
        Some(self.read_node(root, fragment, Vec::new()))
    }

    /// Read a plan node and its children, children first
    fn read_node(&mut self, node: &Map<String, Value>, fragment: u32, path: Vec<PathComponent>) -> usize {
        let mut children = Vec::new();
        let child_nodes = node.get("children").and_then(Value::as_array).into_iter().flatten();
        for (i, child) in child_nodes.enumerate() {
            if let Some(child) = child.as_object() {
                let path = vec![
                    PathComponent::MemberInObject { attribute: "children".into() },
                    PathComponent::EntryInArray { index: i },
                ];
                children.push(self.read_node(child, fragment, path));
            }
        }
        for source in source_fragments(node) {
            if let Some(root) = self.read_fragment(&source, Some(fragment)) {
                self.operators[root].parent_child_path =
                    vec![PathComponent::MemberInObject { attribute: format!("fragment {source}") }];
                children.push(root);
            }
        }
        let name = node.get("name").and_then(Value::as_str).unwrap_or("Unknown").to_string();
        let estimated_rows = node
            .get("estimates")
            .and_then(Value::as_array)
            .and_then(|e| e.first())
            .and_then(|e| e.get("outputRowCount"))
            .and_then(Value::as_f64);
        let attributes = node
            .iter()
            .filter(|(key, _)| *key != "children")
            .map(|(key, value)| (key.clone(), to_json(value)))
            .collect();
        self.operators.push(ParsedOperatorNode {
            parent_child_path: path,
            attributes,
            estimated_rows,
            operator_label: label_of(node),
            operator_type: Some(name),
            engine_id: node.get("id").and_then(Value::as_str).map(String::from),
            fragment: Some(fragment),
            child_operators: children,
            ..Default::default()
        });
        self.operators.len() - 1
    }
}

impl QueryProfile {
    /// Parse a Trino plan: the fragments of `EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON)` or a QueryInfo with the plans
    /// of its stages. Fragment ids are the engine ids of the fragments and plan node ids the engine ids of the
    /// operators, so the progress of the stages finds its fragments.
    pub fn parse_trino_plan(&mut self, plan: &[u8]) -> Result<(), StatusCode> {
        self.reset();
        self.engine = fb::ProfileEngine::TRINO;
        let document: Value =
            serde_json::from_slice(plan).map_err(|_| StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR)?;
        let plans = read_fragments(document)?;

        // The root fragments are the fragments that no other fragment reads, usually fragment 0
        let read: HashSet<String> = plans.values().flat_map(read_fragment_ids).collect();
        let mut reader = TrinoPlanReader {
            plans: &plans,
            operators: Vec::new(),
            fragments: Vec::new(),
            fragment_index: HashMap::new(),
        };
        let mut roots = Vec::new();
        for fragment_id in plans.keys().filter(|id| !read.contains(*id)) {
            roots.extend(reader.read_fragment(fragment_id, None));
        }
        let TrinoPlanReader { operators, fragments, .. } = reader;
        self.flatten_operators(operators, roots);
        self.fragments = fragments;

        // The operators of the fragments; the root of a fragment has no parent in the same fragment
        for (op_id, op) in self.operators.iter_mut().enumerate() {
            op.kind = op.operator_type.as_deref().map(trino_operator_kind).unwrap_or_default();
            if let Some(fragment) = op.fragment {
                self.fragments[fragment as usize].operators.push(op_id as u32);
            }
        }
        for (op_id, op) in self.operators.iter().enumerate() {
            let Some(fragment) = op.fragment else { continue };
            if op.parent.is_none_or(|parent| self.operators[parent].fragment != Some(fragment)) {
                self.fragments[fragment as usize].root_operator = Some(op_id as u32);
            }
        }

        self.identify_operator_edges();
        self.seal_loaded_structure();
        Ok(())
    }
}
