//! The plan view model snapshot encoder.

use super::{plain, Map};
use crate::ryml::Node;
use dashql_buffers::view as fb;
use dashql_core_view::{PlanInputEvent, PlanViewModel};

/// The layout config of the plan view model snapshots
pub fn snapshot_config() -> fb::PlanLayoutConfig {
    let mut config = fb::PlanLayoutConfig::default();
    config.set_level_height(64.0);
    config.set_node_height(32.0);
    config.set_node_margin_horizontal(20.0);
    config.set_node_padding_left(8.0);
    config.set_node_padding_right(8.0);
    config.set_icon_width(14.0);
    config.set_icon_margin_right(8.0);
    config.set_max_label_chars(20);
    config.set_width_per_label_char(8.5);
    config.set_node_min_width(0.0);
    config
}

/// Format a double with six decimals (`%f`)
fn to_string(v: f64) -> String {
    format!("{v:.6}")
}

/// A string of the dictionary, None for u32::MAX
fn string<'a>(vm: &fb::PlanViewModel<'a>, id: u32) -> Option<&'a str> {
    (id != u32::MAX).then(|| vm.string_dictionary().unwrap().get(id as usize))
}

/// The name of an operator kind
fn kind_name(kind: fb::PlanOperatorKind) -> String {
    kind.variant_name().unwrap_or("UNKNOWN").to_lowercase().replace('_', "-")
}

/// Encode an operator and its children depth-first
fn encode_operator(vm: &fb::PlanViewModel, oid: u32) -> Node {
    let op = vm.operators().unwrap().get(oid as usize);
    let mut out = Map::new();
    out.plain("id", &oid.to_string());
    if let Some(engine_id) = string(vm, op.engine_id()) {
        out.plain("engine-id", engine_id);
    }
    let parent_path = string(vm, op.parent_path()).unwrap_or("");
    if !parent_path.is_empty() {
        out.plain("path", parent_path);
    }
    out.plain("type", string(vm, op.type_name()).unwrap_or(""));
    if op.kind() != fb::PlanOperatorKind::OTHER {
        out.plain("kind", &kind_name(op.kind()));
    }
    if let Some(label) = string(vm, op.label()).filter(|l| !l.is_empty()) {
        out.plain("label", label);
    }
    let loc = op.source_location();
    if loc.length() > 0 {
        out.plain("loc", &format!("{}..{}", loc.offset(), loc.offset() + loc.length()));
    }
    if op.parent() != u32::MAX {
        out.plain("parent", &op.parent().to_string());
    }
    if !op.estimated_rows().is_nan() {
        out.plain("estimated-rows", &op.estimated_rows().to_string());
    }
    let rect = op.layout_rect();
    out.insert("position", Node::flow_seq(vec![plain(&to_string(rect.x())), plain(&to_string(rect.y()))]));
    if op.children_count() > 0 {
        let children = (0..op.children_count()).map(|i| encode_operator(vm, op.children_begin() + i)).collect();
        out.insert("children", Node::seq(children));
    }
    out.into_node()
}

/// The name of a slot role
fn role_name(role: fb::PlanSlotRole) -> String {
    role.variant_name().unwrap_or("UNKNOWN").to_lowercase()
}

/// Encode a packed plan view model: the sections `fragments`, `operators`,
/// `operator-edges` and `pipelines`
pub fn encode_plan_view_model(buffer: &[u8]) -> Map {
    let vm = flatbuffers::root::<fb::PlanViewModel>(buffer).expect("valid plan view model");
    let roots = vm.root_operators().unwrap();
    let fragment_operators = vm.fragment_operators().unwrap();
    let slots = vm.slots().unwrap();
    let mut root = Map::new();

    let mut out_fragments = Vec::new();
    for (f, fragment) in vm.fragments().unwrap().iter().enumerate() {
        let mut out = Map::new();
        out.plain("id", &f.to_string());
        if let Some(engine_id) = string(&vm, fragment.engine_id()) {
            out.plain("engine-id", engine_id);
        }
        if fragment.parent_fragment() != u32::MAX {
            out.plain("parent", &fragment.parent_fragment().to_string());
        }
        if fragment.root_operator() != u32::MAX {
            out.plain("root", &fragment.root_operator().to_string());
        }
        if fragment.hidden() != 0 {
            out.boolean("hidden", true);
        }
        let operators = (0..fragment.operator_count())
            .map(|i| plain(&fragment_operators.get((fragment.operators_begin() + i) as usize).to_string()))
            .collect();
        out.insert("operators", Node::flow_seq(operators));
        out_fragments.push(out.into_node());
    }
    root.insert("fragments", Node::seq(out_fragments));
    root.insert("operators", Node::seq(roots.iter().map(|r| encode_operator(&vm, r)).collect()));

    let mut out_edges = Vec::new();
    for edge in vm.operator_edges().unwrap() {
        let mut out = Map::new();
        out.plain("child", &edge.child().to_string());
        out.plain("parent", &edge.parent().to_string());
        out.plain("port-index", &edge.port_index().to_string());
        out.plain("port-count", &edge.port_count().to_string());
        if edge.slot() != u32::MAX {
            out.plain("slot", &edge.slot().to_string());
        }
        out_edges.push(out.into_node());
    }
    root.insert("operator-edges", Node::seq(out_edges));

    let mut out_pipelines = Vec::new();
    for (p, pipeline) in vm.pipelines().unwrap().iter().enumerate() {
        let mut out = Map::new();
        out.plain("id", &p.to_string());
        if let Some(engine_id) = string(&vm, pipeline.engine_id()) {
            out.plain("engine-id", engine_id);
        }
        if pipeline.fragment() != u32::MAX {
            out.plain("fragment", &pipeline.fragment().to_string());
        }
        let mut out_slots = Vec::new();
        for s in pipeline.slots_begin()..pipeline.slots_begin() + pipeline.slot_count() {
            let slot = slots.get(s as usize);
            let mut out_slot = Map::new();
            out_slot.plain("slot", &s.to_string());
            out_slot.plain("operator", &slot.operator().to_string());
            out_slot.plain("role", &role_name(slot.role()));
            out_slots.push(out_slot.into_node());
        }
        out.insert("slots", Node::seq(out_slots));
        out_pipelines.push(out.into_node());
    }
    root.insert("pipelines", Node::seq(out_pipelines));
    root
}

/// The names of the statistics fields in snapshots, in the order of the `PlanStatsField` bits
const STATS_FIELDS: [&str; 13] = [
    "started-at",
    "finished-at",
    "tuples-in",
    "tuples-out",
    "bytes-in",
    "bytes-out",
    "cpu-time-us",
    "wall-time-us",
    "blocked-time-us",
    "memory-bytes",
    "spilled-bytes",
    "work-done",
    "work-total",
];

/// Encode a Hyper plan snapshot case: the sections of `encode_plan_view_model`, plus `events` (the execution state
/// as snapshot events) if the plan is analyzed
pub fn encode_hyper_plan(input: &str) -> Result<Map, String> {
    let mut view_model = PlanViewModel::new();
    view_model.parse_hyper_plan(input.as_bytes()).map_err(|e| format!("cannot parse plan: {e:?}"))?;
    view_model.configure(&snapshot_config());
    view_model.compute_layout();
    let mut out = encode_plan_view_model(&view_model.pack_buffer());
    let events = view_model.snapshot_events();
    if !events.is_empty() {
        out.insert("events", encode_plan_events(&view_model.pack_events(&events)));
    }
    Ok(out)
}

/// Encode a progress snapshot case: load a Hyper plan, replay input events (a JSON array) and encode the output
/// events of all batches (`updates`)
pub fn encode_plan_progress(plan: &str, events: &str) -> Result<Node, String> {
    let mut view_model = PlanViewModel::new();
    view_model.parse_hyper_plan(plan.as_bytes()).map_err(|e| format!("cannot parse plan: {e:?}"))?;
    let events: Vec<PlanInputEvent> = serde_json::from_str(events).map_err(|e| format!("invalid events: {e}"))?;
    let updates = view_model.replay(&events);
    Ok(encode_plan_events(&view_model.pack_events(&updates)))
}

/// Encode packed `PlanEvents`: one entry per update with its status and reported statistics
pub fn encode_plan_events(buffer: &[u8]) -> Node {
    let events = flatbuffers::root::<fb::PlanEvents>(buffer).expect("valid plan events");
    let mut out = Vec::new();
    for event in events.events().unwrap() {
        let mut entry = Map::new();
        entry.plain("time", &event.event_time().to_string());
        entry.plain("entity", &event.entity().variant_name().unwrap_or("UNKNOWN").to_lowercase());
        if event.entity() != fb::PlanEntity::QUERY {
            entry.plain("index", &event.index().to_string());
        }
        if event.status() != fb::PlanExecutionStatus::UNKNOWN {
            entry.plain("status", &event.status().variant_name().unwrap_or("UNKNOWN").to_lowercase());
        }
        let stats = event.stats();
        let values = [
            stats.started_at(),
            stats.finished_at(),
            stats.tuples_in(),
            stats.tuples_out(),
            stats.bytes_in(),
            stats.bytes_out(),
            stats.cpu_time_us(),
            stats.wall_time_us(),
            stats.blocked_time_us(),
            stats.memory_bytes(),
            stats.spilled_bytes(),
            stats.work_done(),
            stats.work_total(),
        ];
        for (bit, (name, value)) in STATS_FIELDS.iter().zip(values).enumerate() {
            if stats.reported() & (1 << bit) != 0 {
                entry.plain(name, &value.to_string());
            }
        }
        out.push(entry.into_node());
    }
    Node::seq(out)
}
