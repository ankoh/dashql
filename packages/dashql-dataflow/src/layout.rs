//! The layout of the dataflow canvas: script boxes of statement rows, flowing from left to right.
//!
//! The layout has two levels. Inside a box the statements are stacked in script order, every statement is a row
//! of the same height and the chart of a visualized statement follows its row, so the box geometry is fixed by the
//! script. Between the boxes, the layered layout of the Eclipse Layout Kernel (elk-rs) places the boxes and routes
//! the edges: every box is a node with a port per connected statement row, inputs on its left border and outputs on
//! its right border at the centers of the rows, and the edges are routed orthogonally, the edges out of one port
//! share their first segments.
//!
//! - Without hints ELK arranges the connected boxes in layers in the order of the session. The sinks of a fan-out,
//!   e.g. the charts of one base table, alternate between sub-layers once there are `wrap_siblings` of them. The
//!   connected parts are packed for the aspect ratio of the viewport, boxes without edges go into rows below them.
//! - With hints, where the boxes were, ELK lays out interactively, every connected part on its own: the columns follow
//!   the x of the boxes, the order in a column their y, and a box keeps its y where it does not overlap another. A
//!   dropped box goes into the column under its center, or into a new column in a gap between two columns. A layout
//!   that starts from where an earlier one put every box reproduces it.

use std::collections::{BTreeMap, BTreeSet};

/// The sizes of the dataflow canvas, in canvas pixels. The defaults are the sizes of the canvas of the app and of
/// the dataflow snapshots: the app reads them from the dataflow wasm module, this is the one place to change them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DataflowLayoutConfig {
    /// The width of a box
    pub box_width: f64,
    /// The width of a box with a chart, a chart or a table is wider than high
    pub chart_box_width: f64,
    /// The width of the box of an input or an attachment
    pub input_box_width: f64,
    /// The height of the header of a box, a collapsed box is its header
    pub header_height: f64,
    /// The height of a statement row
    pub row_height: f64,
    /// The space between the header, the rows and the bottom of a box
    pub row_padding: f64,
    /// The height of the chart below a visualized statement
    pub chart_height: f64,
    /// The bounds of the width of a resized box
    pub min_box_width: f64,
    pub max_box_width: f64,
    /// The bounds of the height of a resized chart
    pub min_chart_height: f64,
    pub max_chart_height: f64,
    /// The least horizontal space between the columns, wider where the edges between them need more rails
    pub layer_gap: f64,
    /// The least vertical space between the boxes of a column
    pub box_gap: f64,
    /// The space between two parallel edges
    pub edge_gap: f64,
    /// The space between an edge and a box
    pub edge_box_gap: f64,
    /// A dropped box that is this close to lining up a row with a row it is connected to lines it up, so that the
    /// edge between them runs straight instead of making a small hop
    pub align_snap: f64,
    /// The boxes without edges per row
    pub isolated_per_row: usize,
    /// The fewest sinks of a fan-out that alternate between sub-layers, 0 never
    pub wrap_siblings: usize,
    /// The width over the height that the connected parts are packed for, e.g. of the viewport
    pub aspect_ratio: f64,
    /// The grid that drags and resizes on the canvas snap to, the layout does not snap
    pub grid: f64,
}

impl Default for DataflowLayoutConfig {
    fn default() -> Self {
        Self {
            box_width: 280.0,
            chart_box_width: 480.0,
            input_box_width: 200.0,
            header_height: 32.0,
            row_height: 32.0,
            row_padding: 8.0,
            chart_height: 200.0,
            min_box_width: 200.0,
            max_box_width: 1600.0,
            min_chart_height: 96.0,
            max_chart_height: 1200.0,
            layer_gap: 144.0,
            box_gap: 48.0,
            edge_gap: 16.0,
            edge_box_gap: 24.0,
            align_snap: 24.0,
            isolated_per_row: 4,
            wrap_siblings: 4,
            aspect_ratio: 2.0,
            grid: 8.0,
        }
    }
}

/// A script box
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DataflowLayoutBox {
    /// The number of statements
    pub statements: u32,
    /// The statement whose chart follows its row
    pub chart_statement: Option<u32>,
    /// Is the box collapsed to its header?
    pub collapsed: bool,
    /// The width of the box, the width of the config if absent, the chart box width with a chart
    pub width: Option<f64>,
    /// The height of the chart, the chart height of the config if absent
    pub chart_height: Option<f64>,
    /// Is the box an input or an attachment? Its consumers are grouped as if it were absent, it is `input_box_width`
    /// wide by default.
    pub input: bool,
    /// Where the box was, e.g. saved in its `@flow` tag or where the last layout put it
    pub hint: Option<(f64, f64)>,
    /// Was the box just dropped at its hint by the user? The hints of the other boxes place the layout.
    pub dropped: bool,
}

/// An edge between statements of two boxes
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DataflowLayoutEdge {
    pub from_box: u32,
    pub from_statement: u32,
    pub to_box: u32,
    pub to_statement: u32,
}

/// The geometry of a box
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DataflowBoxGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// The top of every statement row, relative to the box. The rows of a collapsed box are its header.
    pub rows: Vec<f64>,
}

impl DataflowBoxGeometry {
    /// The vertical center of the row of a statement, relative to the box
    pub(crate) fn port(&self, statement: u32, config: &DataflowLayoutConfig) -> f64 {
        match self.rows.get(statement as usize) {
            Some(&top) if self.height > config.header_height => top + config.row_height / 2.0,
            _ => config.header_height / 2.0,
        }
    }
}

/// The route of an edge between statements of two boxes, by the box and statement of its source and its target: the
/// points of a polyline of horizontal and vertical segments from the right border of the source box to the left
/// border of the target box
pub type DataflowEdgeRoute = ((u32, u32, u32, u32), Vec<(f64, f64)>);

/// The geometry of a box without its position
fn box_geometry(b: &DataflowLayoutBox, config: &DataflowLayoutConfig) -> DataflowBoxGeometry {
    let default_width = if b.input {
        config.input_box_width
    } else if b.chart_statement.is_some() {
        config.chart_box_width
    } else {
        config.box_width
    };
    let mut geometry = DataflowBoxGeometry { width: b.width.unwrap_or(default_width), ..Default::default() };
    if b.collapsed || b.statements == 0 {
        geometry.rows = vec![0.0; b.statements as usize];
        geometry.height = config.header_height;
        return geometry;
    }
    let mut y = config.header_height + config.row_padding;
    for statement in 0..b.statements {
        geometry.rows.push(y);
        y += config.row_height;
        if b.chart_statement == Some(statement) {
            y += config.row_padding + b.chart_height.unwrap_or(config.chart_height);
        }
    }
    geometry.height = y + config.row_padding;
    geometry
}

/// The edges between different boxes
fn box_edges(edges: &[DataflowLayoutEdge], count: usize) -> Vec<DataflowLayoutEdge> {
    edges.iter().filter(|e| e.from_box != e.to_box && (e.from_box as usize) < count && (e.to_box as usize) < count).copied().collect()
}

/// Does no edge start at a box?
fn is_sink(b: usize, edges: &[DataflowLayoutEdge]) -> bool {
    !edges.iter().any(|e| e.from_box as usize == b)
}

/// The boxes that tie the sinks of a fan-out together: the producers of a box without the inputs, or the inputs if
/// it only reads inputs
fn sibling_key(b: usize, edges: &[DataflowLayoutEdge], inputs: &[bool]) -> BTreeSet<usize> {
    let all: BTreeSet<usize> = edges.iter().filter(|e| e.to_box as usize == b).map(|e| e.from_box as usize).collect();
    let scripts: BTreeSet<usize> = all.iter().copied().filter(|&p| !inputs[p]).collect();
    if scripts.is_empty() {
        all
    } else {
        scripts
    }
}

/// The connected parts of the graph, by their first box. Boxes without edges are left out.
fn components(count: usize, edges: &[DataflowLayoutEdge]) -> Vec<Vec<usize>> {
    let mut parent: Vec<usize> = (0..count).collect();
    fn find(parent: &mut [usize], i: usize) -> usize {
        let mut root = i;
        while parent[root] != root {
            root = parent[root];
        }
        parent[i] = root;
        root
    }
    for e in edges {
        let (a, b) = (find(&mut parent, e.from_box as usize), find(&mut parent, e.to_box as usize));
        parent[a.max(b)] = a.min(b);
    }
    let connected: BTreeSet<usize> = edges.iter().flat_map(|e| [e.from_box as usize, e.to_box as usize]).collect();
    let mut out: Vec<Vec<usize>> = Vec::new();
    let mut roots: Vec<usize> = Vec::new();
    for i in (0..count).filter(|i| connected.contains(i)) {
        let root = find(&mut parent, i);
        match roots.iter().position(|&r| r == root) {
            Some(c) => out[c].push(i),
            None => {
                roots.push(root);
                out.push(vec![i]);
            }
        }
    }
    out
}

/// Put boxes into rows of `isolated_per_row` from a top left corner, returns the bottom of the rows with a gap
fn place_in_rows(boxes: &[usize], (left, mut top): (f64, f64), config: &DataflowLayoutConfig, geometry: &mut [DataflowBoxGeometry]) -> f64 {
    for row in boxes.chunks(config.isolated_per_row.max(1)) {
        let mut x = left;
        let mut height: f64 = 0.0;
        for &i in row {
            geometry[i].x = x;
            geometry[i].y = top;
            x += geometry[i].width + config.box_gap;
            height = height.max(geometry[i].height);
        }
        top += height + config.box_gap;
    }
    top
}

/// Lay out the boxes
pub fn compute_dataflow_layout(boxes: &[DataflowLayoutBox], edges: &[DataflowLayoutEdge], config: &DataflowLayoutConfig) -> Vec<DataflowBoxGeometry> {
    compute_dataflow_layout_with_routes(boxes, edges, config).0
}

/// Lay out the boxes, with the routes of the edges between boxes
pub fn compute_dataflow_layout_with_routes(
    boxes: &[DataflowLayoutBox],
    edges: &[DataflowLayoutEdge],
    config: &DataflowLayoutConfig,
) -> (Vec<DataflowBoxGeometry>, Vec<DataflowEdgeRoute>) {
    let mut geometry: Vec<DataflowBoxGeometry> = boxes.iter().map(|b| box_geometry(b, config)).collect();
    let edges = box_edges(edges, boxes.len());
    // A drop is laid out twice: the second layout starts where the first one put every box, like a reload does, so
    // the canvas shows what a reload shows
    let routes = if boxes.iter().any(|b| b.dropped) {
        arrange(boxes, &edges, config, &mut geometry);
        let settled: Vec<DataflowLayoutBox> =
            boxes.iter().zip(geometry.iter()).map(|(b, g)| DataflowLayoutBox { hint: Some((g.x, g.y)), dropped: false, ..b.clone() }).collect();
        arrange(&settled, &edges, config, &mut geometry)
    } else {
        arrange(boxes, &edges, config, &mut geometry)
    };
    (geometry, routes)
}

/// How far apart the seeds of two columns are, more than the widest box
const COLUMN_SPREAD: f64 = 10000.0;

/// The column of a center x: the columns are the runs of overlapping x ranges of the boxes that stay, a center in the
/// gap between two columns is a new column between them. Returns the index of the column, halves for the gaps.
fn column_of(columns: &[(f64, f64)], center: f64) -> f64 {
    for (i, &(x0, x1)) in columns.iter().enumerate() {
        if center < x0 {
            return i as f64 - 0.5;
        }
        if center <= x1 {
            return i as f64;
        }
    }
    columns.len() as f64 - 0.5
}

/// Arrange the boxes once, from their hints if they have any
fn arrange(boxes: &[DataflowLayoutBox], edges: &[DataflowLayoutEdge], config: &DataflowLayoutConfig, geometry: &mut [DataflowBoxGeometry]) -> Vec<DataflowEdgeRoute> {
    let count = geometry.len();
    let linked: BTreeSet<usize> = edges.iter().flat_map(|e| [e.from_box as usize, e.to_box as usize]).collect();
    if !boxes.iter().any(|b| b.hint.is_some()) {
        // ELK packs the connected boxes, the boxes without edges go into rows below them
        let connected: Vec<usize> = (0..count).filter(|b| linked.contains(b)).collect();
        let routes = if connected.is_empty() { Vec::new() } else { elk(boxes, edges, config, geometry, &connected, &vec![None; count], false) };
        let left = connected.iter().map(|&b| geometry[b].x).fold(f64::INFINITY, f64::min);
        let bottom = connected.iter().map(|&b| geometry[b].y + geometry[b].height).fold(f64::NEG_INFINITY, f64::max);
        let corner = if left.is_finite() { (left, bottom + config.box_gap * 2.0) } else { (0.0, 0.0) };
        let isolated: Vec<usize> = (0..count).filter(|b| !linked.contains(b)).collect();
        place_in_rows(&isolated, corner, config, geometry);
        return routes;
    }
    // Interactive: every connected part on its own, so that moving a box in one part leaves the others alone
    let mut routes = Vec::new();
    let mut fresh: Vec<Vec<usize>> = Vec::new();
    for part in components(count, edges) {
        if !part.iter().any(|&b| boxes[b].hint.is_some()) {
            fresh.push(part);
            continue;
        }
        // A box without a hint starts right of its producers or left of its consumers that have one, with the row of
        // the edge level with the row at its other end
        let mut seeds: Vec<Option<(f64, f64)>> = boxes.iter().map(|b| b.hint).collect();
        for &b in &part {
            if seeds[b].is_some() {
                continue;
            }
            let producers: Vec<(f64, f64)> = edges
                .iter()
                .filter(|e| e.to_box as usize == b)
                .filter_map(|e| {
                    let p = &geometry[e.from_box as usize];
                    boxes[e.from_box as usize].hint.map(|(x, y)| (x + p.width, y + p.port(e.from_statement, config) - geometry[b].port(e.to_statement, config)))
                })
                .collect();
            let consumers: Vec<(f64, f64)> = edges
                .iter()
                .filter(|e| e.from_box as usize == b)
                .filter_map(|e| {
                    let c = &geometry[e.to_box as usize];
                    boxes[e.to_box as usize].hint.map(|(x, y)| (x, y + c.port(e.to_statement, config) - geometry[b].port(e.from_statement, config)))
                })
                .collect();
            seeds[b] = if let Some(&(x, y)) = producers.iter().max_by(|a, b| a.0.total_cmp(&b.0)) {
                Some((x + config.layer_gap, y))
            } else {
                consumers.iter().min_by(|a, b| a.0.total_cmp(&b.0)).map(|&(x, y)| (x - config.layer_gap - geometry[b].width, y))
            };
        }
        // A dropped box that almost lines up a row with a connected row of a box that stays lines it up
        for &b in part.iter().filter(|&&b| boxes[b].dropped) {
            let Some((x, y)) = seeds[b] else { continue };
            let deltas = edges.iter().filter_map(|e| {
                let (this, this_statement, other, other_statement) = if e.to_box as usize == b {
                    (b, e.to_statement, e.from_box as usize, e.from_statement)
                } else if e.from_box as usize == b {
                    (b, e.from_statement, e.to_box as usize, e.to_statement)
                } else {
                    return None;
                };
                let (_, other_y) = boxes[other].hint.filter(|_| !boxes[other].dropped)?;
                Some(other_y + geometry[other].port(other_statement, config) - (y + geometry[this].port(this_statement, config)))
            });
            if let Some(delta) = deltas.filter(|d| d.abs() <= config.align_snap).min_by(|a, b| a.abs().total_cmp(&b.abs())) {
                seeds[b] = Some((x, y + delta));
            }
        }
        // ELK forms its columns from overlapping x ranges, a wide or dropped box would merge two columns. The seeds put
        // every box at the column of its center instead, far apart: the boxes that stay form the columns.
        let mut ranges: Vec<(f64, f64)> =
            part.iter().filter(|&&b| !boxes[b].dropped).filter_map(|&b| boxes[b].hint.map(|(x, _)| (x, x + geometry[b].width))).collect();
        ranges.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut columns: Vec<(f64, f64)> = Vec::new();
        for (x0, x1) in ranges {
            match columns.last_mut() {
                Some(last) if x0 < last.1 => last.1 = last.1.max(x1),
                _ => columns.push((x0, x1)),
            }
        }
        for &b in &part {
            if let Some((x, y)) = seeds[b] {
                seeds[b] = Some((column_of(&columns, x + geometry[b].width / 2.0) * COLUMN_SPREAD, y));
            }
        }
        routes.extend(elk(boxes, edges, config, geometry, &part, &seeds, true));
    }
    // Boxes without edges keep their hints, the others and the parts without any hint go below everything
    let mut placed: Vec<usize> = (0..count).filter(|&b| linked.contains(&b) && !fresh.iter().any(|p| p.contains(&b))).collect();
    let mut loose: Vec<usize> = Vec::new();
    for b in (0..count).filter(|b| !linked.contains(b)) {
        match boxes[b].hint {
            Some((x, y)) => {
                geometry[b].x = x;
                geometry[b].y = y;
                placed.push(b);
            }
            None => loose.push(b),
        }
    }
    let left = placed.iter().map(|&b| geometry[b].x).fold(f64::INFINITY, f64::min);
    let left = if left.is_finite() { left } else { 0.0 };
    let bottom = placed.iter().map(|&b| geometry[b].y + geometry[b].height).fold(f64::NEG_INFINITY, f64::max);
    let mut top = if bottom.is_finite() { bottom + config.box_gap * 2.0 } else { 0.0 };
    for part in fresh {
        let part_routes = elk(boxes, edges, config, geometry, &part, &vec![None; count], false);
        let (x0, y0) = part.iter().fold((f64::INFINITY, f64::INFINITY), |(x, y), &b| (x.min(geometry[b].x), y.min(geometry[b].y)));
        let (dx, dy) = (left - x0, top - y0);
        for &b in &part {
            geometry[b].x += dx;
            geometry[b].y += dy;
        }
        top = part.iter().map(|&b| geometry[b].y + geometry[b].height).fold(top, f64::max) + config.box_gap * 2.0;
        routes.extend(part_routes.into_iter().map(|(k, points)| (k, points.into_iter().map(|(x, y)| (x + dx, y + dy)).collect())));
    }
    place_in_rows(&loose, (left, top), config, geometry);
    routes
}

/// Lay out a subset of the boxes with ELK, interactively at the seeds of the boxes, and move an interactive layout
/// back by the offset that most of its boxes with hints share: ELK moves a layout to the origin.
fn elk(
    boxes: &[DataflowLayoutBox],
    edges: &[DataflowLayoutEdge],
    config: &DataflowLayoutConfig,
    geometry: &mut [DataflowBoxGeometry],
    subset: &[usize],
    seeds: &[Option<(f64, f64)>],
    interactive: bool,
) -> Vec<DataflowEdgeRoute> {
    use org_eclipse_elk_alg_layered::org::eclipse::elk::alg::layered::layered_layout_provider::LayeredLayoutProvider;
    use org_eclipse_elk_alg_layered::org::eclipse::elk::alg::layered::options::{
        CrossingMinimizationStrategy, CycleBreakingStrategy, LayerUnzippingStrategy, LayeredOptions, LayeringStrategy, NodePlacementStrategy,
        OrderingStrategy,
    };
    use org_eclipse_elk_alg_layered::org::eclipse::elk::alg::layered::plain_java_initialization::initialize_plain_java_layout;
    use org_eclipse_elk_core::org::eclipse::elk::core::math::ElkPadding;
    use org_eclipse_elk_core::org::eclipse::elk::core::options::{CoreOptions, Direction, EdgeRouting, PortConstraints, PortSide, SizeConstraint};
    use org_eclipse_elk_core::org::eclipse::elk::core::util::BasicProgressMonitor;
    use org_eclipse_elk_core::org::eclipse::elk::core::IGraphLayoutEngine;
    use org_eclipse_elk_graph::org::eclipse::elk::graph::properties::Property;
    use org_eclipse_elk_graph::org::eclipse::elk::graph::util::ElkGraphUtil;
    use org_eclipse_elk_graph::org::eclipse::elk::graph::{ElkConnectableShapeRef, ElkNodeRef, ElkPortRef};

    fn set_node<T: Clone + Send + Sync + 'static>(node: &ElkNodeRef, property: &Property<T>, value: T) {
        node.borrow_mut().connectable().shape().graph_element().properties_mut().set_property(property, Some(value));
    }
    fn set_port<T: Clone + Send + Sync + 'static>(port: &ElkPortRef, property: &Property<T>, value: T) {
        port.borrow_mut().connectable().shape().graph_element().properties_mut().set_property(property, Some(value));
    }

    initialize_plain_java_layout();
    let graph = ElkGraphUtil::create_graph();
    set_node(&graph, CoreOptions::DIRECTION, Direction::Right);
    set_node(&graph, CoreOptions::PADDING, ElkPadding::with_any(0.0));
    set_node(&graph, LayeredOptions::SPACING_NODE_NODE, config.box_gap);
    set_node(&graph, LayeredOptions::SPACING_NODE_NODE_BETWEEN_LAYERS, config.layer_gap);
    set_node(&graph, LayeredOptions::SPACING_COMPONENT_COMPONENT, config.box_gap * 2.0);
    set_node(&graph, LayeredOptions::SPACING_EDGE_EDGE, config.edge_gap);
    set_node(&graph, LayeredOptions::SPACING_EDGE_EDGE_BETWEEN_LAYERS, config.edge_gap);
    set_node(&graph, LayeredOptions::SPACING_EDGE_NODE, config.edge_box_gap);
    set_node(&graph, LayeredOptions::SPACING_EDGE_NODE_BETWEEN_LAYERS, config.edge_box_gap);
    // Orthogonal routes, the edges out of one port share their first segments
    set_node(&graph, LayeredOptions::EDGE_ROUTING, EdgeRouting::Orthogonal);
    set_node(&graph, LayeredOptions::MERGE_EDGES, true);
    if interactive {
        // The phases keep what the user arranged: the cycles, the columns by x, the order in a column by y and the y
        // of the boxes. A part is laid out on its own.
        set_node(&graph, LayeredOptions::CYCLE_BREAKING_STRATEGY, CycleBreakingStrategy::Interactive);
        set_node(&graph, LayeredOptions::LAYERING_STRATEGY, LayeringStrategy::Interactive);
        set_node(&graph, LayeredOptions::CROSSING_MINIMIZATION_STRATEGY, CrossingMinimizationStrategy::Interactive);
        set_node(&graph, LayeredOptions::NODE_PLACEMENT_STRATEGY, NodePlacementStrategy::Interactive);
        set_node(&graph, LayeredOptions::CONSIDER_MODEL_ORDER_STRATEGY, OrderingStrategy::None);
        set_node(&graph, LayeredOptions::SEPARATE_CONNECTED_COMPONENTS, false);
    } else {
        // The order of the session, the sinks of a fan-out alternate between sub-layers, the parts are packed
        set_node(&graph, LayeredOptions::NODE_PLACEMENT_STRATEGY, NodePlacementStrategy::NetworkSimplex);
        set_node(&graph, LayeredOptions::CONSIDER_MODEL_ORDER_STRATEGY, OrderingStrategy::NodesAndEdges);
        set_node(&graph, LayeredOptions::LAYER_UNZIPPING_STRATEGY, LayerUnzippingStrategy::Alternating);
        set_node(&graph, LayeredOptions::SEPARATE_CONNECTED_COMPONENTS, true);
        set_node(&graph, LayeredOptions::ASPECT_RATIO, if config.aspect_ratio > 0.0 { config.aspect_ratio } else { 2.0 });
        set_node(&graph, LayeredOptions::COMPACTION_CONNECTED_COMPONENTS, true);
    }

    let mut in_subset = vec![false; geometry.len()];
    for &b in subset {
        in_subset[b] = true;
    }
    let edges: Vec<DataflowLayoutEdge> = edges.iter().filter(|e| in_subset[e.from_box as usize] && in_subset[e.to_box as usize]).copied().collect();
    let mut connected: Vec<(BTreeSet<u32>, BTreeSet<u32>)> = vec![Default::default(); geometry.len()];
    let mut unique: BTreeSet<(u32, u32, u32, u32)> = BTreeSet::new();
    for e in &edges {
        connected[e.to_box as usize].0.insert(e.to_statement);
        connected[e.from_box as usize].1.insert(e.from_statement);
        unique.insert((e.from_box, e.from_statement, e.to_box, e.to_statement));
    }
    // The sinks of the fan-outs of at least `wrap_siblings` boxes alternate between two sub-layers, three beyond six.
    // The split of a layer is the smallest one of its boxes, every other box has 1.
    let inputs: Vec<bool> = boxes.iter().map(|b| b.input).collect();
    let mut fan_outs: Vec<(BTreeSet<usize>, Vec<usize>)> = Vec::new();
    for b in subset.iter().copied().filter(|&b| is_sink(b, &edges)) {
        let key = sibling_key(b, &edges, &inputs);
        if key.is_empty() {
            continue;
        }
        match fan_outs.iter_mut().find(|(k, _)| *k == key) {
            Some((_, members)) => members.push(b),
            None => fan_outs.push((key, vec![b])),
        }
    }
    let mut split = vec![1i32; geometry.len()];
    for (_, members) in fan_outs.iter().filter(|(_, m)| config.wrap_siblings > 0 && m.len() >= config.wrap_siblings.max(2)) {
        for &m in members {
            split[m] = if members.len() <= 6 { 2 } else { 3 };
        }
    }
    let mut nodes = Vec::with_capacity(subset.len());
    let mut ports: BTreeMap<(u32, bool, u32), ElkPortRef> = BTreeMap::new();
    for &b in subset {
        let (g, (ins, outs)) = (&geometry[b], &connected[b]);
        let node = ElkGraphUtil::create_node(Some(graph.clone()));
        node.borrow_mut().connectable().shape().set_dimensions(g.width, g.height);
        if let Some((x, y)) = seeds[b] {
            node.borrow_mut().connectable().shape().set_location(x, y);
        }
        set_node(&node, CoreOptions::NODE_SIZE_CONSTRAINTS, SizeConstraint::fixed());
        set_node(&node, CoreOptions::PORT_CONSTRAINTS, PortConstraints::FixedPos);
        if !interactive {
            set_node(&node, LayeredOptions::LAYER_UNZIPPING_LAYER_SPLIT, split[b]);
        }
        for (output, statements) in [(false, ins), (true, outs)] {
            for &statement in statements {
                let port = ElkGraphUtil::create_port(Some(node.clone()));
                port.borrow_mut().connectable().shape().set_location(if output { g.width } else { 0.0 }, g.port(statement, config));
                set_port(&port, CoreOptions::PORT_SIDE, if output { PortSide::East } else { PortSide::West });
                ports.insert((b as u32, output, statement), port);
            }
        }
        nodes.push(node);
    }
    let mut elk_edges = Vec::new();
    for (from, fs, to, ts) in unique {
        let (Some(source), Some(target)) = (ports.get(&(from, true, fs)), ports.get(&(to, false, ts))) else { continue };
        let edge = ElkGraphUtil::create_simple_edge(ElkConnectableShapeRef::Port(source.clone()), ElkConnectableShapeRef::Port(target.clone()));
        elk_edges.push(((from, fs, to, ts), edge));
    }
    LayeredLayoutProvider::new().layout(&graph, &mut BasicProgressMonitor::new());
    for (&b, node) in subset.iter().zip(&nodes) {
        let mut node = node.borrow_mut();
        let shape = node.connectable().shape();
        geometry[b].x = shape.x();
        geometry[b].y = shape.y();
    }
    // ELK moves the layout to the origin, an interactive layout moves back by the offset that most of its boxes with
    // hints share: the boxes that ELK left where they were. A dropped box does not count.
    let mut offset = (0.0, 0.0);
    if interactive {
        let anchors = subset.iter().filter(|&&b| boxes[b].hint.is_some() && !boxes[b].dropped).count();
        let mut counts: Vec<((i64, i64), usize)> = Vec::new();
        for &b in subset.iter().filter(|&&b| !(boxes[b].dropped && anchors > 0)) {
            if let Some((x, y)) = boxes[b].hint {
                let key = ((x - geometry[b].x).round() as i64, (y - geometry[b].y).round() as i64);
                match counts.iter_mut().find(|(k, _)| *k == key) {
                    Some((_, n)) => *n += 1,
                    None => counts.push((key, 1)),
                }
            }
        }
        // The most frequent offset, the first one among equals
        if let Some(((dx, dy), _)) = counts.iter().fold(None::<&((i64, i64), usize)>, |best, c| if best.is_none_or(|b| c.1 > b.1) { Some(c) } else { best }) {
            offset = (*dx as f64, *dy as f64);
        }
        for &b in subset {
            geometry[b].x += offset.0;
            geometry[b].y += offset.1;
        }
    }
    let mut routes: Vec<DataflowEdgeRoute> = elk_edges
        .into_iter()
        .map(|(key, edge)| {
            let mut points = Vec::new();
            let mut edge = edge.borrow_mut();
            for section in edge.sections().iter() {
                let mut section = section.borrow_mut();
                points.push((section.start_x() + offset.0, section.start_y() + offset.1));
                points.extend(section.bend_points().iter().map(|p| (p.borrow().x() + offset.0, p.borrow().y() + offset.1)));
                points.push((section.end_x() + offset.0, section.end_y() + offset.1));
            }
            (key, points)
        })
        .collect();
    center_rails(&mut routes, subset, geometry);
    routes
}

/// ELK puts the vertical segments of the edges between two columns next to the left column, center them in the gap
/// instead: away from the boxes on both sides. The segments of a gap move together, so their order and the space
/// between them stay.
fn center_rails(routes: &mut [DataflowEdgeRoute], subset: &[usize], geometry: &[DataflowBoxGeometry]) {
    let mut ranges: Vec<(f64, f64)> = subset.iter().map(|&b| (geometry[b].x, geometry[b].x + geometry[b].width)).collect();
    ranges.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut columns: Vec<(f64, f64)> = Vec::new();
    for (x0, x1) in ranges {
        match columns.last_mut() {
            Some(last) if x0 < last.1 => last.1 = last.1.max(x1),
            _ => columns.push((x0, x1)),
        }
    }
    for gap in columns.windows(2).map(|w| (w[0].1, w[1].0)) {
        let inside = |x: f64| x > gap.0 && x < gap.1;
        let rails: Vec<f64> =
            routes.iter().flat_map(|(_, points)| points.windows(2).filter(|w| w[0].0 == w[1].0 && inside(w[0].0)).map(|w| w[0].0)).collect();
        let (Some(lo), Some(hi)) = (rails.iter().copied().reduce(f64::min), rails.iter().copied().reduce(f64::max)) else { continue };
        let shift = ((gap.0 + gap.1) / 2.0 - (lo + hi) / 2.0).round();
        for (_, points) in routes.iter_mut() {
            for p in points.iter_mut().filter(|p| inside(p.0)) {
                p.0 += shift;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(statements: u32) -> DataflowLayoutBox {
        DataflowLayoutBox { statements, ..Default::default() }
    }

    fn chart() -> DataflowLayoutBox {
        DataflowLayoutBox { statements: 1, chart_statement: Some(0), ..Default::default() }
    }

    fn edge(from_box: u32, from_statement: u32, to_box: u32, to_statement: u32) -> DataflowLayoutEdge {
        DataflowLayoutEdge { from_box, from_statement, to_box, to_statement }
    }

    /// The boxes with hints where a layout put them
    fn hinted(boxes: &[DataflowLayoutBox], geometry: &[DataflowBoxGeometry]) -> Vec<DataflowLayoutBox> {
        boxes.iter().zip(geometry).map(|(b, g)| DataflowLayoutBox { hint: Some((g.x, g.y)), ..b.clone() }).collect()
    }

    /// A source, two consumers of it, a chart of the first consumer, and a pair of boxes on their own
    fn two_parts() -> (Vec<DataflowLayoutBox>, Vec<DataflowLayoutEdge>) {
        let boxes = vec![data(2), data(1), data(1), chart(), data(1), data(1)];
        let edges = vec![edge(0, 0, 1, 0), edge(0, 1, 2, 0), edge(1, 0, 3, 0), edge(4, 0, 5, 0)];
        (boxes, edges)
    }

    fn assert_no_overlaps(geometry: &[DataflowBoxGeometry]) {
        for (i, a) in geometry.iter().enumerate() {
            for b in &geometry[i + 1..] {
                let overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
                assert!(!overlap, "{a:?} overlaps {b:?}");
            }
        }
    }

    #[test]
    fn box_geometry_stacks_rows_and_charts() {
        let config = DataflowLayoutConfig::default();
        let g = box_geometry(&DataflowLayoutBox { statements: 2, chart_statement: Some(0), ..Default::default() }, &config);
        assert_eq!(g.rows, vec![40.0, 40.0 + 32.0 + 8.0 + 200.0]);
        assert_eq!(g.height, 40.0 + 32.0 + 8.0 + 200.0 + 32.0 + 8.0);
        // A box with a chart is wider than a box without one
        assert_eq!(g.width, config.chart_box_width);
        assert_eq!(box_geometry(&DataflowLayoutBox { statements: 2, ..Default::default() }, &config).width, config.box_width);
        // A box with its own size, e.g. from a resized `@flow` tag
        let sized = DataflowLayoutBox { statements: 2, chart_statement: Some(0), width: Some(400.0), chart_height: Some(96.0), ..Default::default() };
        let sized = box_geometry(&sized, &config);
        assert_eq!(sized.width, 400.0);
        assert_eq!(sized.rows, vec![40.0, 40.0 + 32.0 + 8.0 + 96.0]);
        let collapsed = box_geometry(&DataflowLayoutBox { statements: 2, collapsed: true, ..Default::default() }, &config);
        assert_eq!(collapsed.height, 32.0);
        assert_eq!(collapsed.port(1, &config), 16.0);
    }

    #[test]
    fn flows_left_to_right_and_aligns_the_connected_rows() {
        let config = DataflowLayoutConfig::default();
        let boxes = [data(2), data(1), data(1)];
        let edges = [edge(0, 1, 1, 0), edge(1, 0, 2, 0)];
        let g = compute_dataflow_layout(&boxes, &edges, &config);
        assert!(g[0].x + g[0].width < g[1].x && g[1].x + g[1].width < g[2].x);
        // The row a box reads is level with the row it reads it from
        assert_eq!(g[0].y + g[0].port(1, &config), g[1].y + g[1].port(0, &config));
        assert_eq!(g[1].y + g[1].port(0, &config), g[2].y + g[2].port(0, &config));
    }

    #[test]
    fn survives_cycles() {
        let boxes = [data(1), data(1), data(1)];
        let edges = [edge(0, 0, 1, 0), edge(1, 0, 2, 0), edge(2, 0, 0, 0)];
        let (g, routes) = compute_dataflow_layout_with_routes(&boxes, &edges, &DataflowLayoutConfig::default());
        assert_no_overlaps(&g);
        assert_eq!(routes.len(), 3);
    }

    #[test]
    fn a_fan_out_alternates_between_two_columns() {
        let config = DataflowLayoutConfig::default();
        let boxes = [data(1), chart(), chart(), chart(), chart(), chart()];
        let edges: Vec<_> = (1..6).map(|i| edge(0, 0, i, 0)).collect();
        let g = compute_dataflow_layout(&boxes, &edges, &config);
        let columns: BTreeSet<i64> = g[1..].iter().map(|g| g.x as i64).collect();
        assert_eq!(columns.len(), 2);
        assert_no_overlaps(&g);
        // Below the threshold the consumers stay a column
        let g = compute_dataflow_layout(&boxes[..4], &edges[..3], &config);
        assert_eq!(g[1..].iter().map(|g| g.x as i64).collect::<BTreeSet<_>>().len(), 1);
    }

    #[test]
    fn an_input_does_not_split_a_fan_out() {
        let config = DataflowLayoutConfig::default();
        let input = DataflowLayoutBox { statements: 1, width: Some(200.0), input: true, ..Default::default() };
        let boxes = [data(1), chart(), chart(), chart(), chart(), input];
        let mut edges: Vec<_> = (1..5).map(|i| edge(0, 0, i, 0)).collect();
        edges.push(edge(5, 0, 1, 0));
        let g = compute_dataflow_layout(&boxes, &edges, &config);
        assert_eq!(g[1..5].iter().map(|g| g.x as i64).collect::<BTreeSet<_>>().len(), 2);
    }

    #[test]
    fn boxes_without_edges_go_into_rows_below() {
        let config = DataflowLayoutConfig::default();
        let boxes = [data(1), data(1), data(1), data(1), data(1), data(1), data(1)];
        let g = compute_dataflow_layout(&boxes, &[edge(0, 0, 1, 0)], &config);
        let bottom = g[0].y.max(g[1].y) + 80.0;
        assert!(g[2..].iter().all(|b| b.y > bottom));
        assert_eq!(g[2].y, g[5].y);
        assert!(g[6].y > g[2].y);
        assert_eq!(g[6].x, g[2].x);
    }

    #[test]
    fn reload_reproduces_the_layout_and_its_routes() {
        let config = DataflowLayoutConfig::default();
        let (boxes, edges) = two_parts();
        let (first, routes) = compute_dataflow_layout_with_routes(&boxes, &edges, &config);
        assert_eq!(routes.len(), edges.len());
        let (reloaded, reloaded_routes) = compute_dataflow_layout_with_routes(&hinted(&boxes, &first), &edges, &config);
        assert_eq!(reloaded, first);
        assert_eq!(reloaded_routes, routes);
        // Orthogonal routes from the right border of the source row to the left border of the target row
        for ((from, fs, to, ts), points) in &routes {
            let (f, t) = (&first[*from as usize], &first[*to as usize]);
            assert_eq!(points.first(), Some(&(f.x + f.width, f.y + f.port(*fs, &config))));
            assert_eq!(points.last(), Some(&(t.x, t.y + t.port(*ts, &config))));
            assert!(points.windows(2).all(|w| w[0].0 == w[1].0 || w[0].1 == w[1].1));
        }
    }

    #[test]
    fn a_drop_keeps_the_y_and_the_column_and_leaves_the_others() {
        let config = DataflowLayoutConfig::default();
        let (boxes, edges) = two_parts();
        let first = compute_dataflow_layout(&boxes, &edges, &config);
        // The second consumer goes far down in its column
        let mut dropped = hinted(&boxes, &first);
        dropped[2].hint = Some((first[2].x + 20.0, first[2].y + 400.0));
        dropped[2].dropped = true;
        let after = compute_dataflow_layout(&dropped, &edges, &config);
        assert_eq!((after[2].x, after[2].y), (first[2].x, first[2].y + 400.0));
        for i in [0, 1, 3, 4, 5] {
            assert_eq!((after[i].x, after[i].y), (first[i].x, first[i].y), "box {i} moved");
        }
        assert_no_overlaps(&after);
        // The layout after the drop reloads as it is
        assert_eq!(compute_dataflow_layout(&hinted(&boxes, &after), &edges, &config), after);
    }

    #[test]
    fn a_drop_into_a_gap_makes_a_column() {
        let config = DataflowLayoutConfig::default();
        let (boxes, edges) = two_parts();
        let first = compute_dataflow_layout(&boxes, &edges, &config);
        // The chart of the first consumer is dropped with its center in the gap between the source and the consumers
        let mut dropped = hinted(&boxes, &first);
        let gap = (first[0].x + first[0].width + first[1].x) / 2.0;
        dropped[3].hint = Some((gap - first[3].width / 2.0, first[3].y));
        dropped[3].dropped = true;
        let after = compute_dataflow_layout(&dropped, &edges, &config);
        // The chart reads the first consumer, so its new column right of the source pushes the consumer right of it
        assert!(after[3].x > after[0].x + after[0].width);
        assert!(after[1].x > after[3].x + after[3].width);
        // The other part stays
        assert_eq!((after[4].x, after[4].y, after[5].x, after[5].y), (first[4].x, first[4].y, first[5].x, first[5].y));
    }

    #[test]
    fn a_box_without_a_hint_goes_next_to_its_producer() {
        let config = DataflowLayoutConfig::default();
        let (boxes, edges) = two_parts();
        let first = compute_dataflow_layout(&boxes, &edges, &config);
        let mut hints = hinted(&boxes, &first);
        hints[3].hint = None;
        let after = compute_dataflow_layout(&hints, &edges, &config);
        assert!(after[3].x > after[1].x + after[1].width);
        // Level with the row it reads
        assert_eq!(after[3].y + after[3].port(0, &config), after[1].y + after[1].port(0, &config));
        for i in [0, 1, 2, 4, 5] {
            assert_eq!((after[i].x, after[i].y), (first[i].x, first[i].y), "box {i} moved");
        }
    }

    #[test]
    fn rails_run_in_the_middle_of_the_gap_between_columns() {
        let config = DataflowLayoutConfig::default();
        // Two consumers of two rows, the lower one dropped further down: its edge needs a rail
        let boxes = [data(2), data(1), data(1)];
        let edges = [edge(0, 0, 1, 0), edge(0, 1, 2, 0)];
        let first = compute_dataflow_layout(&boxes, &edges, &config);
        let mut dropped = hinted(&boxes, &first);
        dropped[2].hint = Some((first[2].x, first[2].y + 200.0));
        dropped[2].dropped = true;
        let (g, routes) = compute_dataflow_layout_with_routes(&dropped, &edges, &config);
        let gap = (g[0].x + g[0].width, g[2].x);
        let rail = routes.iter().find(|(k, _)| k.2 == 2).unwrap().1.windows(2).find(|w| w[0].0 == w[1].0).unwrap()[0].0;
        assert!((rail - (gap.0 + gap.1) / 2.0).abs() <= 1.0, "rail at {rail} in {gap:?}");
    }

    #[test]
    fn a_drop_close_to_a_straight_edge_lines_up_the_rows() {
        let config = DataflowLayoutConfig::default();
        let (boxes, edges) = two_parts();
        let first = compute_dataflow_layout(&boxes, &edges, &config);
        let row = |g: &[DataflowBoxGeometry], b: usize, s: u32| g[b].y + g[b].port(s, &config);
        // The chart goes 400 down and an offset further, then its producer is dropped 400 down: the row of the
        // producer is the offset away from the row of the chart and lines up with it within `align_snap`
        for (offset, snaps) in [(10.0, true), (config.align_snap + 8.0, false)] {
            let mut dropped = hinted(&boxes, &first);
            dropped[3].hint = Some((first[3].x, first[3].y + 400.0 + offset));
            dropped[3].dropped = true;
            let moved = compute_dataflow_layout(&dropped, &edges, &config);
            let mut again = hinted(&boxes, &moved);
            again[1].hint = Some((moved[1].x, moved[1].y + 400.0));
            again[1].dropped = true;
            let after = compute_dataflow_layout(&again, &edges, &config);
            assert_eq!(row(&after, 1, 0) == row(&after, 3, 0), snaps, "offset {offset}");
        }
    }

    #[test]
    fn boxes_without_edges_keep_their_hints() {
        let config = DataflowLayoutConfig::default();
        let boxes = [DataflowLayoutBox { hint: Some((120.0, 40.0)), ..data(1) }, data(1)];
        let g = compute_dataflow_layout(&boxes, &[], &config);
        assert_eq!((g[0].x, g[0].y), (120.0, 40.0));
        // A box without a hint goes below, at their left edge
        assert_eq!(g[1].x, 120.0);
        assert!(g[1].y > 40.0 + g[0].height);
    }
}
