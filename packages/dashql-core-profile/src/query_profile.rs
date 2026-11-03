//! The query profile and its FlatBuffers encoding.
//!
//! The structure (operators, edges, fragments, pipelines, slots) carries no execution state. The execution state
//! lives in `progress` and leaves the model only as events.

use super::progress::ExecutionState;
use dashql_buffers::parser::SymbolSpan;
use dashql_buffers::profile as fb;
use flatbuffers::{FlatBufferBuilder, WIPOffset};
use std::collections::HashMap;

/// A component of the path from an operator to the JSON value of its child operator
#[derive(Clone, Debug, PartialEq)]
pub(super) enum PathComponent {
    /// A member in an object
    MemberInObject { attribute: String },
    /// An entry in an array
    EntryInArray { index: usize },
    /// No path (the document root)
    None,
}

/// A reference of an operator to another operator through the operator id serialized by Hyper
#[derive(Debug)]
pub(super) struct OperatorReference {
    /// The operator id serialized by Hyper of the referenced operator
    pub(super) source_operator_id: u64,
    /// The relationship kind
    pub(super) kind: &'static str,
    /// Additional reference attributes, values serialized as JSON
    pub(super) attributes: Vec<(String, String)>,
}

/// An operator found in the JSON plan, before flattening
#[derive(Debug, Default)]
pub(super) struct ParsedOperatorNode {
    /// The path from the parent operator (or the document root)
    pub(super) parent_child_path: Vec<PathComponent>,
    /// The members of the operator object that contain no operators, values serialized as JSON
    pub(super) attributes: Vec<(String, String)>,
    /// The estimated output rows
    pub(super) estimated_rows: Option<f64>,
    /// The runtime counters of an analyzed plan
    pub(super) analyzed: super::progress::Stats,
    /// The references to other operators
    pub(super) references: Vec<OperatorReference>,
    /// The operator type
    pub(super) operator_type: Option<String>,
    /// The operator label
    pub(super) operator_label: Option<String>,
    /// The operator id serialized by Hyper
    pub(super) source_operator_id: Option<u64>,
    /// The child operators (indexes of parsed operators)
    pub(super) child_operators: Vec<usize>,
    /// The source location
    pub(super) source_location: Option<SymbolSpan>,
}

/// A fragment: a part of the plan that the engine schedules as a unit (a Hyper federate, a Trino stage).
///
/// Fragments form a hierarchy. Every operator belongs to its innermost fragment only, so rollups over the
/// hierarchy count every operator once.
#[derive(Debug, Default)]
pub(super) struct Fragment {
    /// The fragment id of the engine
    pub(super) engine_id: Option<String>,
    /// The enclosing fragment
    pub(super) parent_fragment: Option<u32>,
    /// The root operator
    pub(super) root_operator: Option<u32>,
    /// The operators owned by the fragment
    pub(super) operators: Vec<u32>,
    /// The attributes, values serialized as JSON
    pub(super) attributes: Vec<(String, String)>,
    /// Draw no contour?
    pub(super) hidden: bool,
}

/// A pipeline.
/// Note that a pipeline does not need to to be linear.
/// Hyper implements a Fork operator that will effectively result in two pipeline targets.
#[derive(Debug, Default)]
pub(super) struct Pipeline {
    /// The pipeline id of the engine
    pub(super) engine_id: Option<String>,
    /// The fragment that runs the pipeline
    pub(super) fragment: Option<u32>,
    /// The slots of the pipeline (indexes into `QueryProfile::slots`)
    pub(super) slots: Vec<u32>,
    /// The attributes, values serialized as JSON
    pub(super) attributes: Vec<(String, String)>,
}

/// A slot: an operator in a pipeline, the finest grain of execution statistics
#[derive(Clone, Copy, Debug)]
pub(super) struct Slot {
    /// The pipeline
    pub(super) pipeline: u32,
    /// The operator
    pub(super) operator: u32,
    /// The role of the operator in the pipeline
    pub(super) role: fb::ProfileSlotRole,
}

/// A non-containment relationship between operators
#[derive(Debug)]
pub(super) struct OperatorCrossEdge {
    /// The referenced producer operator
    pub(super) source_node: u32,
    /// The operator containing the reference
    pub(super) target_node: u32,
    /// The relationship kind
    pub(super) kind: &'static str,
    /// Additional reference attributes, values serialized as JSON
    pub(super) attributes: Vec<(String, String)>,
}

/// An operator edge
#[derive(Debug)]
pub(super) struct OperatorEdge {
    /// The parent operator
    pub(super) parent_operator: u32,
    /// The child operator
    pub(super) child_operator: u32,
    /// The port count of the parent
    pub(super) parent_port_count: usize,
    /// The port id in the parent where this edge ends
    pub(super) parent_port_index: usize,
    /// The slot of the child in the pipeline that carries the edge
    pub(super) slot: Option<u32>,
}

/// A sealed operator node
#[derive(Debug, Default)]
pub(super) struct OperatorNode {
    /// The operator type
    pub(super) operator_type: Option<String>,
    /// The operator label
    pub(super) operator_label: Option<String>,
    /// The engine-neutral operator kind
    pub(super) kind: fb::ProfileOperatorKind,
    /// The operator id of the engine
    pub(super) engine_id: Option<String>,
    /// The operator id serialized by Hyper, until the cross edges and pipelines are resolved
    pub(super) source_operator_id: Option<u64>,
    /// The members of the operator object that contain no operators, values serialized as JSON
    pub(super) attributes: Vec<(String, String)>,
    /// The estimated output rows
    pub(super) estimated_rows: Option<f64>,
    /// The runtime counters of an analyzed plan, until they are applied as events
    pub(super) analyzed: super::progress::Stats,
    /// The references to other operators, until the cross edges are resolved
    pub(super) references: Vec<OperatorReference>,
    /// The parent operator
    pub(super) parent: Option<usize>,
    /// The parent path
    pub(super) parent_path: Vec<PathComponent>,
    /// The source location
    pub(super) source_location: Option<SymbolSpan>,
    /// The child operators
    pub(super) children_begin: usize,
    /// The number of child operators
    pub(super) children_count: usize,
    /// The begin of outgoing cross edges
    pub(super) cross_edges_begin: usize,
    /// The number of outgoing cross edges
    pub(super) cross_edge_count: usize,
    /// The slots of the operator
    pub(super) slots: Vec<u32>,
    /// The innermost fragment
    pub(super) fragment: Option<u32>,
    /// The layout info
    pub(super) layout_rect: Option<fb::ProfileLayoutRect>,
}

impl OperatorNode {
    /// Construct from a parsed node
    pub(super) fn from_parsed(parsed: ParsedOperatorNode) -> Self {
        Self {
            operator_type: parsed.operator_type,
            operator_label: parsed.operator_label,
            engine_id: parsed.source_operator_id.map(|id| id.to_string()),
            source_operator_id: parsed.source_operator_id,
            attributes: parsed.attributes,
            estimated_rows: parsed.estimated_rows,
            analyzed: parsed.analyzed,
            references: parsed.references,
            parent_path: parsed.parent_child_path,
            source_location: parsed.source_location,
            ..Default::default()
        }
    }

    /// The child operators
    pub(super) fn children(&self) -> std::ops::Range<usize> {
        self.children_begin..self.children_begin + self.children_count
    }

    /// Serialize the parent child path
    pub(super) fn serialize_parent_path(&self) -> String {
        let mut out = String::new();
        for (i, component) in self.parent_path.iter().enumerate() {
            match component {
                PathComponent::MemberInObject { attribute } => {
                    if i > 0 {
                        out.push('.');
                    }
                    out.push_str(attribute);
                }
                PathComponent::EntryInArray { index } => {
                    out.push('[');
                    out.push_str(&index.to_string());
                    out.push(']');
                }
                PathComponent::None => {}
            }
        }
        out
    }
}

/// A string dictionary
#[derive(Default)]
struct StringDictionary {
    /// The allocated strings
    strings: Vec<String>,
    /// The string ids
    string_ids: HashMap<String, u32>,
}

impl StringDictionary {
    /// Allocate a string in the string dictionary
    fn allocate(&mut self, s: &str) -> u32 {
        if let Some(id) = self.string_ids.get(s) {
            return *id;
        }
        let id = self.strings.len() as u32;
        self.strings.push(s.to_string());
        self.string_ids.insert(s.to_string(), id);
        id
    }

    /// Allocate an optional string, u32::MAX if there is none
    fn allocate_opt(&mut self, s: Option<&str>) -> u32 {
        s.map(|s| self.allocate(s)).unwrap_or(u32::MAX)
    }
}

/// Pack attributes, returns the begin and the count
fn pack_attributes(
    source: &[(String, String)],
    strings: &mut StringDictionary,
    attributes: &mut Vec<fb::ProfileAttribute>,
) -> (u32, u32) {
    let begin = attributes.len();
    for (name, value_json) in source {
        attributes.push(fb::ProfileAttribute::new(strings.allocate(name), strings.allocate(value_json)));
    }
    (begin as u32, (attributes.len() - begin) as u32)
}

/// An optional index as u32, u32::MAX if there is none
pub(super) fn index_or_max(index: Option<u32>) -> u32 {
    index.unwrap_or(u32::MAX)
}

/// The profile of a query: the structure of its plan and its execution state.
///
/// It holds the structure of a plan (Hyper or Trino) and the execution state of a running or analyzed query.
pub struct QueryProfile {
    /// The engine that produced the plan
    pub(super) engine: fb::ProfileEngine,
    /// The structure version
    pub(super) structure_version: u32,
    /// The operators
    pub(super) operators: Vec<OperatorNode>,
    /// The operator edges
    pub(super) operator_edges: Vec<OperatorEdge>,
    /// The operator cross edges
    pub(super) operator_cross_edges: Vec<OperatorCrossEdge>,
    /// The root operators
    pub(super) root_operators: Vec<u32>,
    /// The fragments
    pub(super) fragments: Vec<Fragment>,
    /// The pipelines
    pub(super) pipelines: Vec<Pipeline>,
    /// The slots
    pub(super) slots: Vec<Slot>,
    /// The number of fragments, pipelines and slots of the loaded plan, the rest was registered at runtime
    pub(super) loaded_counts: (usize, usize, usize),
    /// The execution state
    pub(super) execution: ExecutionState,
    /// The layout config
    pub(super) layout_config: fb::DerivedProfileLayoutConfig,
    /// The layout info of the entire plan
    pub(super) layout_rect: Option<fb::ProfileLayoutRect>,
}

impl Default for QueryProfile {
    fn default() -> Self {
        Self::new()
    }
}

impl QueryProfile {
    /// Constructor
    pub fn new() -> Self {
        Self {
            engine: fb::ProfileEngine::UNKNOWN,
            structure_version: 0,
            operators: Vec::new(),
            operator_edges: Vec::new(),
            operator_cross_edges: Vec::new(),
            root_operators: Vec::new(),
            fragments: Vec::new(),
            pipelines: Vec::new(),
            slots: Vec::new(),
            loaded_counts: (0, 0, 0),
            execution: ExecutionState::default(),
            layout_config: fb::DerivedProfileLayoutConfig::default(),
            layout_rect: None,
        }
    }

    /// Reset the entire profile. The layout config is kept, the structure version grows.
    pub fn reset(&mut self) {
        self.engine = fb::ProfileEngine::UNKNOWN;
        self.structure_version = self.structure_version.wrapping_add(1);
        self.fragments.clear();
        self.pipelines.clear();
        self.slots.clear();
        self.root_operators.clear();
        self.operators.clear();
        self.operator_edges.clear();
        self.operator_cross_edges.clear();
        self.loaded_counts = (0, 0, 0);
        self.execution = ExecutionState::default();
        self.layout_rect = None;
    }

    /// Start an empty model for a query of an engine. The structure appears with the progress of the query
    /// (Trino stages are registered as fragments), a plan can be loaded later.
    pub fn start_query(&mut self, engine: fb::ProfileEngine) {
        self.reset();
        self.engine = engine;
        self.seal_loaded_structure();
    }

    /// The structure version
    pub fn structure_version(&self) -> u32 {
        self.structure_version
    }

    /// Seal the structure of a loaded plan: everything registered later is runtime structure
    pub(super) fn seal_loaded_structure(&mut self) {
        self.loaded_counts = (self.fragments.len(), self.pipelines.len(), self.slots.len());
        self.execution.resize(self.fragments.len(), self.pipelines.len(), self.slots.len(), self.operators.len());
    }

    /// Add a pipeline with its slots, returns the pipeline index.
    ///
    /// An operator appears at most once per pipeline, the first role wins. Edges between two operators of the
    /// pipeline that have no slot yet are carried by the slot of their child in this pipeline.
    pub(super) fn add_pipeline(
        &mut self,
        engine_id: Option<String>,
        fragment: Option<u32>,
        slots: &[(u32, fb::ProfileSlotRole)],
        attributes: Vec<(String, String)>,
    ) -> u32 {
        let pipeline = self.pipelines.len() as u32;
        let mut slot_of: HashMap<u32, u32> = HashMap::with_capacity(slots.len());
        let mut pipeline_slots = Vec::with_capacity(slots.len());
        for &(operator, role) in slots {
            if slot_of.contains_key(&operator) {
                continue;
            }
            let slot = self.slots.len() as u32;
            self.slots.push(Slot { pipeline, operator, role });
            self.operators[operator as usize].slots.push(slot);
            slot_of.insert(operator, slot);
            pipeline_slots.push(slot);
        }
        for edge in &mut self.operator_edges {
            if edge.slot.is_none() && slot_of.contains_key(&edge.parent_operator) {
                edge.slot = slot_of.get(&edge.child_operator).copied();
            }
        }
        self.pipelines.push(Pipeline { engine_id, fragment, slots: pipeline_slots, attributes });
        pipeline
    }

    /// Flatten the operators.
    ///
    /// Runs a post-order DFS over the parsed operator tree and writes the children of every operator as one block.
    pub(super) fn flatten_operators(&mut self, parsed_ops: Vec<ParsedOperatorNode>, parsed_roots: Vec<usize>) {
        let mut parsed_ops: Vec<Option<ParsedOperatorNode>> = parsed_ops.into_iter().map(Some).collect();
        let children_of: Vec<Vec<usize>> =
            parsed_ops.iter().map(|op| op.as_ref().unwrap().child_operators.clone()).collect();

        // Prepare the operators: (parsed operator, visited)
        let mut pending: Vec<(usize, bool)> = parsed_roots.iter().rev().map(|r| (*r, false)).collect();
        self.operators.reserve(parsed_ops.len());

        // The flattened operators that are not yet placed
        let mut mapped: Vec<Option<OperatorNode>> = (0..parsed_ops.len()).map(|_| None).collect();
        while let Some(&(op, visited)) = pending.last() {
            if visited {
                // Add child operators
                let children_begin = self.operators.len();
                for &child in &children_of[op] {
                    let node = mapped[child].take().expect("child operator must be flattened");
                    self.place_operator(node);
                }
                let child_count = self.operators.len() - children_begin;
                let mut flat = OperatorNode::from_parsed(parsed_ops[op].take().unwrap());
                flat.children_begin = children_begin;
                flat.children_count = child_count;

                // Register flat operator
                mapped[op] = Some(flat);
                pending.pop();
            } else {
                pending.last_mut().unwrap().1 = true;
                // Add the children, reversed since we're using a DFS stack
                pending.extend(children_of[op].iter().rev().map(|c| (*c, false)));
            }
        }

        // Now only the root operators are left. They are placed in reverse plan order
        // (see docs/design/core_quirks.md).
        self.root_operators.reserve(parsed_roots.len());
        for root in parsed_roots.into_iter().rev() {
            let node = mapped[root].take().expect("root operator must be flattened");
            let oid = self.place_operator(node);
            self.root_operators.push(oid as u32);
        }
    }

    /// Append a flattened operator and point its children at it
    fn place_operator(&mut self, node: OperatorNode) -> usize {
        let operator_id = self.operators.len();
        let children = node.children();
        self.operators.push(node);
        for child in &mut self.operators[children] {
            child.parent = Some(operator_id);
        }
        operator_id
    }

    /// Pack a plan operator
    fn pack_operator(
        &self,
        op: &OperatorNode,
        slots_begin: usize,
        strings: &mut StringDictionary,
        attributes: &mut Vec<fb::ProfileAttribute>,
    ) -> fb::ProfileOperator {
        let mut out = fb::ProfileOperator::default();
        out.set_engine_id(strings.allocate_opt(op.engine_id.as_deref()));
        out.set_kind(op.kind);
        out.set_type_name(strings.allocate_opt(op.operator_type.as_deref()));
        out.set_label(strings.allocate_opt(op.operator_label.as_deref()));
        out.set_parent(op.parent.map(|p| p as u32).unwrap_or(u32::MAX));
        out.set_parent_path(strings.allocate(&op.serialize_parent_path()));
        if let Some(loc) = &op.source_location {
            out.set_source_location(&SymbolSpan::new(loc.offset(), loc.length()));
        }
        out.set_children_begin(op.children_begin as u32);
        out.set_children_count(op.children_count as u32);
        out.set_cross_edges_begin(op.cross_edges_begin as u32);
        out.set_cross_edge_count(op.cross_edge_count as u32);
        let (attributes_begin, attribute_count) = pack_attributes(&op.attributes, strings, attributes);
        out.set_attributes_begin(attributes_begin);
        out.set_attribute_count(attribute_count);
        out.set_slots_begin(slots_begin as u32);
        out.set_slot_count(op.slots.len() as u32);
        out.set_fragment(index_or_max(op.fragment));
        out.set_estimated_rows(op.estimated_rows.unwrap_or(f64::NAN));
        if let Some(rect) = &op.layout_rect {
            out.set_layout_rect(rect);
        }
        out
    }

    /// Pack the query profile as flatbuffer
    pub fn pack<'a>(&self, builder: &mut FlatBufferBuilder<'a>) -> WIPOffset<fb::QueryProfile<'a>> {
        // Track strings in a dictionary for flatbuffer
        let mut dictionary = StringDictionary::default();
        let mut flat_attributes: Vec<fb::ProfileAttribute> = Vec::new();

        // Pack plan operators and their slots
        let mut flat_ops = Vec::with_capacity(self.operators.len());
        let mut flat_operator_slots: Vec<u32> = Vec::with_capacity(self.slots.len());
        for op in &self.operators {
            let slots_begin = flat_operator_slots.len();
            flat_operator_slots.extend_from_slice(&op.slots);
            flat_ops.push(self.pack_operator(op, slots_begin, &mut dictionary, &mut flat_attributes));
        }

        // Pack the plan edges
        let flat_op_edges: Vec<fb::ProfileOperatorEdge> = self
            .operator_edges
            .iter()
            .map(|edge| {
                fb::ProfileOperatorEdge::new(
                    edge.child_operator,
                    edge.parent_operator,
                    edge.parent_port_index as u32,
                    edge.parent_port_count as u32,
                    index_or_max(edge.slot),
                )
            })
            .collect();

        // Pack the plan cross edges and their relationship metadata
        let mut flat_cross_edges = Vec::with_capacity(self.operator_cross_edges.len());
        for edge in &self.operator_cross_edges {
            let attributes_begin = flat_attributes.len();
            let kind = (String::from("kind"), format!("\"{}\"", edge.kind));
            pack_attributes(std::slice::from_ref(&kind), &mut dictionary, &mut flat_attributes);
            pack_attributes(&edge.attributes, &mut dictionary, &mut flat_attributes);
            flat_cross_edges.push(fb::ProfileOperatorCrossEdge::new(
                edge.source_node,
                edge.target_node,
                attributes_begin as u32,
                (flat_attributes.len() - attributes_begin) as u32,
            ));
        }

        // Pack plan fragments
        let mut flat_fragments = Vec::with_capacity(self.fragments.len());
        let mut flat_fragment_operators: Vec<u32> = Vec::new();
        for f in &self.fragments {
            let operators_begin = flat_fragment_operators.len();
            flat_fragment_operators.extend_from_slice(&f.operators);
            let (attributes_begin, attribute_count) =
                pack_attributes(&f.attributes, &mut dictionary, &mut flat_attributes);
            flat_fragments.push(fb::ProfileFragment::new(
                dictionary.allocate_opt(f.engine_id.as_deref()),
                index_or_max(f.parent_fragment),
                index_or_max(f.root_operator),
                operators_begin as u32,
                (flat_fragment_operators.len() - operators_begin) as u32,
                attributes_begin,
                attribute_count,
                f.hidden as u8,
            ));
        }

        // Pack plan pipelines and their slots.
        // Slots are created pipeline by pipeline (`add_pipeline`), so the slots of a pipeline are contiguous.
        let flat_slots: Vec<fb::ProfileSlot> =
            self.slots.iter().map(|s| fb::ProfileSlot::new(s.pipeline, s.operator, s.role)).collect();
        let mut flat_pipelines = Vec::with_capacity(self.pipelines.len());
        for p in &self.pipelines {
            let (attributes_begin, attribute_count) =
                pack_attributes(&p.attributes, &mut dictionary, &mut flat_attributes);
            flat_pipelines.push(fb::ProfilePipeline::new(
                dictionary.allocate_opt(p.engine_id.as_deref()),
                index_or_max(p.fragment),
                p.slots.first().copied().unwrap_or(0),
                p.slots.len() as u32,
                attributes_begin,
                attribute_count,
            ));
        }

        let flat_fragments_ofs = builder.create_vector(&flat_fragments);
        let flat_fragment_operators_ofs = builder.create_vector(&flat_fragment_operators);
        let flat_pipelines_ofs = builder.create_vector(&flat_pipelines);
        let flat_slots_ofs = builder.create_vector(&flat_slots);
        let flat_operator_slots_ofs = builder.create_vector(&flat_operator_slots);
        let flat_ops_ofs = builder.create_vector(&flat_ops);
        let flat_attributes_ofs = builder.create_vector(&flat_attributes);
        let flat_edges_ofs = builder.create_vector(&flat_op_edges);
        let flat_cross_edges_ofs = builder.create_vector(&flat_cross_edges);
        let flat_roots_ofs = builder.create_vector(&self.root_operators);
        let string_offsets: Vec<WIPOffset<&str>> =
            dictionary.strings.iter().map(|s| builder.create_string(s)).collect();
        let string_dictionary_ofs = builder.create_vector(&string_offsets);

        fb::QueryProfile::create(
            builder,
            &fb::QueryProfileArgs {
                engine: self.engine,
                structure_version: self.structure_version,
                layout_config: Some(&self.layout_config),
                layout_rect: self.layout_rect.as_ref(),
                string_dictionary: Some(string_dictionary_ofs),
                attributes: Some(flat_attributes_ofs),
                operators: Some(flat_ops_ofs),
                root_operators: Some(flat_roots_ofs),
                operator_edges: Some(flat_edges_ofs),
                operator_cross_edges: Some(flat_cross_edges_ofs),
                fragments: Some(flat_fragments_ofs),
                fragment_operators: Some(flat_fragment_operators_ofs),
                pipelines: Some(flat_pipelines_ofs),
                slots: Some(flat_slots_ofs),
                operator_slots: Some(flat_operator_slots_ofs),
            },
        )
    }

    /// Pack the query profile into a finished flatbuffer
    pub fn pack_buffer(&self) -> Vec<u8> {
        let mut builder = FlatBufferBuilder::new();
        let vm = self.pack(&mut builder);
        builder.finish(vm, None);
        builder.finished_data().to_vec()
    }
}
