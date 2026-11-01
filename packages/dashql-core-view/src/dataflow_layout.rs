//! The layout of the dataflow canvas: script boxes of statement rows, flowing from left to right.
//!
//! The layout has two levels. Inside a box the statements are stacked in script order, every statement is a row
//! of the same height and the chart of a visualized statement follows its row, so the box geometry is fixed by the
//! script. Between the boxes, the layout places the boxes of the scripts:
//!
//! - Without fixed boxes it arranges all of them in layers (Sugiyama): back edges of cycles are reversed, a box is
//!   one layer right of its rightmost producer and a box without producers sits right before its leftmost consumer,
//!   barycenter sweeps order the boxes of a layer, and alternating sweeps move a box to the median of the rows it
//!   is connected to in the layer before or after it, so that edges between statement rows run straight where
//!   they can. The connected parts of the graph are
//!   stacked, boxes without edges go into rows below them.
//! - With fixed boxes, e.g. the positions of `@vis flow` tags, only the others are placed, one at a time in
//!   topological order: right of their producers, left of their consumers, or below everything, at the median of
//!   their connected rows, and moved to the nearest free slot.
//!
//! The coordinates of the boxes that are not fixed snap to the grid.

use std::collections::BTreeSet;

/// The sizes of the canvas, in canvas pixels
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DataflowLayoutConfig {
    /// The width of a box
    pub box_width: f64,
    /// The height of the header of a box, a collapsed box is its header. With the defaults every row center is a
    /// multiple of the grid, so that snapped boxes keep edges between rows straight.
    pub header_height: f64,
    /// The height of a statement row
    pub row_height: f64,
    /// The space between the header, the rows and the bottom of a box
    pub row_padding: f64,
    /// The height of the chart below a visualized statement
    pub chart_height: f64,
    /// The horizontal space between the layers
    pub layer_gap: f64,
    /// The vertical space between the boxes of a layer
    pub box_gap: f64,
    /// The grid that coordinates snap to
    pub grid: f64,
    /// The boxes without edges per row
    pub isolated_per_row: usize,
}

impl Default for DataflowLayoutConfig {
    fn default() -> Self {
        Self {
            box_width: 280.0,
            header_height: 32.0,
            row_height: 32.0,
            row_padding: 8.0,
            chart_height: 200.0,
            layer_gap: 96.0,
            box_gap: 32.0,
            grid: 8.0,
            isolated_per_row: 4,
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
    /// The position of the box if it is fixed
    pub fixed: Option<(f64, f64)>,
    /// The width of the box, the width of the config if absent
    pub width: Option<f64>,
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
    fn port(&self, statement: u32, config: &DataflowLayoutConfig) -> f64 {
        match self.rows.get(statement as usize) {
            Some(&top) if self.height > config.header_height => top + config.row_height / 2.0,
            _ => config.header_height / 2.0,
        }
    }
}

/// The geometry of a box without its position
fn box_geometry(b: &DataflowLayoutBox, config: &DataflowLayoutConfig) -> DataflowBoxGeometry {
    let mut geometry = DataflowBoxGeometry { width: b.width.unwrap_or(config.box_width), ..Default::default() };
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
            y += config.row_padding + config.chart_height;
        }
    }
    geometry.height = y + config.row_padding;
    geometry
}

fn snap(value: f64, grid: f64) -> f64 {
    if grid > 0.0 {
        (value / grid).round() * grid
    } else {
        value
    }
}

fn median(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let mid = values.len() / 2;
    Some(if values.len() % 2 == 1 { values[mid] } else { (values[mid - 1] + values[mid]) / 2.0 })
}

/// The edges between different boxes
fn box_edges(edges: &[DataflowLayoutEdge], count: usize) -> Vec<DataflowLayoutEdge> {
    edges.iter().filter(|e| e.from_box != e.to_box && (e.from_box as usize) < count && (e.to_box as usize) < count).copied().collect()
}

/// Lay out the boxes
pub fn compute_dataflow_layout(boxes: &[DataflowLayoutBox], edges: &[DataflowLayoutEdge], config: &DataflowLayoutConfig) -> Vec<DataflowBoxGeometry> {
    let mut geometry: Vec<DataflowBoxGeometry> = boxes.iter().map(|b| box_geometry(b, config)).collect();
    let edges = box_edges(edges, boxes.len());
    if boxes.iter().any(|b| b.fixed.is_some()) {
        place(boxes, &edges, config, &mut geometry);
    } else {
        arrange(&edges, config, &mut geometry);
    }
    // Fixed boxes stay where they are
    for (g, b) in geometry.iter_mut().zip(boxes) {
        if b.fixed.is_none() {
            g.x = snap(g.x, config.grid);
            g.y = snap(g.y, config.grid);
        }
    }
    geometry
}

/// The boxes in topological order. A cycle is broken at the pending box with the most pending consumers over pending
/// producers, a box on the cycle rather than one of its consumers, the first one in session order among equals.
fn topological_order(count: usize, edges: &[DataflowLayoutEdge]) -> Vec<usize> {
    let mut indegree = vec![0usize; count];
    let mut outdegree = vec![0usize; count];
    for e in edges {
        indegree[e.to_box as usize] += 1;
        outdegree[e.from_box as usize] += 1;
    }
    let mut done = vec![false; count];
    let mut order = Vec::with_capacity(count);
    while order.len() < count {
        let next = (0..count).find(|&i| !done[i] && indegree[i] == 0).unwrap_or_else(|| {
            (0..count)
                .filter(|&i| !done[i])
                .max_by_key(|&i| (outdegree[i] as i64 - indegree[i] as i64, std::cmp::Reverse(i)))
                .unwrap()
        });
        done[next] = true;
        order.push(next);
        for e in edges.iter().filter(|e| e.from_box as usize == next) {
            let to = e.to_box as usize;
            indegree[to] = indegree[to].saturating_sub(1);
        }
        for e in edges.iter().filter(|e| e.to_box as usize == next) {
            let from = e.from_box as usize;
            outdegree[from] = outdegree[from].saturating_sub(1);
        }
    }
    order
}

/// The edges without the back edges of cycles: an edge against the topological order is reversed
fn acyclic_edges(edges: &[DataflowLayoutEdge], order: &[usize]) -> Vec<DataflowLayoutEdge> {
    let mut rank = vec![0usize; order.len()];
    for (r, &b) in order.iter().enumerate() {
        rank[b] = r;
    }
    edges
        .iter()
        .map(|e| {
            if rank[e.from_box as usize] < rank[e.to_box as usize] {
                *e
            } else {
                DataflowLayoutEdge { from_box: e.to_box, from_statement: e.to_statement, to_box: e.from_box, to_statement: e.from_statement }
            }
        })
        .collect()
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
    for i in 0..count {
        if !connected.contains(&i) {
            continue;
        }
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

/// The number of crossings between the edges of two adjacent layers
fn crossings(position: &[usize], segments: &[(usize, usize)], layer_of: &[usize]) -> usize {
    let mut count = 0;
    for (i, &(a, b)) in segments.iter().enumerate() {
        for &(c, d) in &segments[i + 1..] {
            if layer_of[a] != layer_of[c] {
                continue;
            }
            let (pa, pb, pc, pd) = (position[a], position[b], position[c], position[d]);
            if (pa < pc && pb > pd) || (pa > pc && pb < pd) {
                count += 1;
            }
        }
    }
    count
}

/// Arrange every box in layers
fn arrange(edges: &[DataflowLayoutEdge], config: &DataflowLayoutConfig, geometry: &mut [DataflowBoxGeometry]) {
    let count = geometry.len();
    let order = topological_order(count, edges);
    let edges = acyclic_edges(edges, &order);
    let mut top = 0.0;
    for component in components(count, &edges) {
        let edges: Vec<DataflowLayoutEdge> = edges.iter().filter(|e| component.contains(&(e.from_box as usize))).copied().collect();
        let height = arrange_component(&component, &order, &edges, config, geometry, top);
        top += height + config.box_gap * 2.0;
    }
    // Boxes without edges go into rows below
    let connected: BTreeSet<usize> = edges.iter().flat_map(|e| [e.from_box as usize, e.to_box as usize]).collect();
    let isolated: Vec<usize> = (0..count).filter(|i| !connected.contains(i)).collect();
    for row in isolated.chunks(config.isolated_per_row.max(1)) {
        let mut x = 0.0;
        let mut height: f64 = 0.0;
        for &i in row {
            geometry[i].x = x;
            geometry[i].y = top;
            x += geometry[i].width + config.box_gap;
            height = height.max(geometry[i].height);
        }
        top += height + config.box_gap;
    }
}

/// Arrange the boxes of a connected part of the graph below `top`, returns its height
fn arrange_component(
    component: &[usize],
    topological: &[usize],
    edges: &[DataflowLayoutEdge],
    config: &DataflowLayoutConfig,
    geometry: &mut [DataflowBoxGeometry],
    top: f64,
) -> f64 {
    let count = geometry.len();
    // Layers: longest path from the sources, sources move right before their leftmost consumer
    let mut layer = vec![0usize; count];
    for &b in topological.iter().filter(|b| component.contains(b)) {
        for e in edges.iter().filter(|e| e.to_box as usize == b) {
            layer[b] = layer[b].max(layer[e.from_box as usize] + 1);
        }
    }
    for &b in topological.iter().rev().filter(|b| component.contains(b)) {
        let has_producers = edges.iter().any(|e| e.to_box as usize == b);
        let consumers = edges.iter().filter(|e| e.from_box as usize == b).map(|e| layer[e.to_box as usize]).min();
        if let (false, Some(first)) = (has_producers, consumers) {
            layer[b] = first.saturating_sub(1).max(layer[b]);
        }
    }
    // Long edges pass through dummy nodes, one per layer in between: (from, to) segments of nodes. Nodes below
    // `count` are boxes, the others dummies.
    let mut layer_of: Vec<usize> = layer.clone();
    let mut segments: Vec<(usize, usize)> = Vec::new();
    for e in edges {
        let (from, to) = (e.from_box as usize, e.to_box as usize);
        let mut previous = from;
        for l in layer[from] + 1..layer[to] {
            let dummy = layer_of.len();
            layer_of.push(l);
            segments.push((previous, dummy));
            previous = dummy;
        }
        segments.push((previous, to));
    }
    let layers = component.iter().map(|&b| layer[b]).max().unwrap_or(0) + 1;
    let mut order: Vec<Vec<usize>> = vec![Vec::new(); layers];
    for &b in component {
        order[layer[b]].push(b);
    }
    for dummy in count..layer_of.len() {
        order[layer_of[dummy]].push(dummy);
    }
    let mut position = vec![0usize; layer_of.len()];
    let index = |order: &[Vec<usize>], position: &mut [usize]| {
        for nodes in order {
            for (p, &n) in nodes.iter().enumerate() {
                position[n] = p;
            }
        }
    };
    index(&order, &mut position);

    // Order the layers with barycenter sweeps, keep the order with the fewest crossings
    let mut best = order.clone();
    let mut best_crossings = crossings(&position, &segments, &layer_of);
    for sweep in 0..8 {
        let down = sweep % 2 == 0;
        let range: Vec<usize> = if down { (1..layers).collect() } else { (0..layers.saturating_sub(1)).rev().collect() };
        for l in range {
            let mut keyed: Vec<(f64, usize, usize)> = order[l]
                .iter()
                .enumerate()
                .map(|(p, &n)| {
                    let neighbors: Vec<f64> = segments
                        .iter()
                        .filter_map(|&(a, b)| match down {
                            true if b == n => Some(position[a] as f64),
                            false if a == n => Some(position[b] as f64),
                            _ => None,
                        })
                        .collect();
                    let key = if neighbors.is_empty() { p as f64 } else { neighbors.iter().sum::<f64>() / neighbors.len() as f64 };
                    (key, p, n)
                })
                .collect();
            keyed.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
            order[l] = keyed.into_iter().map(|(_, _, n)| n).collect();
            index(&order, &mut position);
        }
        let c = crossings(&position, &segments, &layer_of);
        if c < best_crossings {
            best_crossings = c;
            best = order.clone();
        }
    }
    let order: Vec<Vec<usize>> = best.into_iter().map(|nodes| nodes.into_iter().filter(|&n| n < count).collect()).collect();

    // x by layer, y stacked and then moved to the median of the connected rows
    let mut x = 0.0;
    for nodes in &order {
        let width = nodes.iter().map(|&b| geometry[b].width).fold(0.0, f64::max);
        let mut y = 0.0;
        for &b in nodes {
            geometry[b].x = x;
            geometry[b].y = y;
            y += geometry[b].height + config.box_gap;
        }
        x += width + config.layer_gap;
    }
    for sweep in 0..8 {
        let down = sweep % 2 == 0;
        let layers: Vec<usize> = if down { (1..order.len()).collect() } else { (0..order.len().saturating_sub(1)).rev().collect() };
        for l in layers {
            let mut wanted: Vec<f64> = order[l]
                .iter()
                .map(|&b| {
                    let rows: Vec<f64> = edges
                        .iter()
                        .filter_map(|e| {
                            let (this, this_statement, other, other_statement) = if down {
                                (e.to_box, e.to_statement, e.from_box, e.from_statement)
                            } else {
                                (e.from_box, e.from_statement, e.to_box, e.to_statement)
                            };
                            (this as usize == b).then(|| {
                                let other = &geometry[other as usize];
                                other.y + other.port(other_statement, config) - geometry[b].port(this_statement, config)
                            })
                        })
                        .collect();
                    median(rows).unwrap_or(geometry[b].y)
                })
                .collect();
            // Keep the order and the gaps: push boxes down that would overlap the box above them
            for i in 1..wanted.len() {
                let above = order[l][i - 1];
                wanted[i] = wanted[i].max(wanted[i - 1] + geometry[above].height + config.box_gap);
            }
            for (i, &b) in order[l].iter().enumerate() {
                geometry[b].y = wanted[i];
            }
        }
    }
    // The part starts at `top`
    let min_y = component.iter().map(|&b| geometry[b].y).fold(f64::INFINITY, f64::min);
    let mut max_y: f64 = 0.0;
    for &b in component {
        geometry[b].y += top - min_y;
        max_y = max_y.max(geometry[b].y + geometry[b].height);
    }
    max_y - top
}

/// Do two boxes overlap, with a gap between them?
fn overlaps(a: &DataflowBoxGeometry, b: &DataflowBoxGeometry, gap: f64) -> bool {
    a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
}

/// Place the boxes that are not fixed, around the fixed ones
fn place(boxes: &[DataflowLayoutBox], edges: &[DataflowLayoutEdge], config: &DataflowLayoutConfig, geometry: &mut [DataflowBoxGeometry]) {
    let count = boxes.len();
    let mut placed = vec![false; count];
    for (i, b) in boxes.iter().enumerate() {
        if let Some((x, y)) = b.fixed {
            geometry[i].x = x;
            geometry[i].y = y;
            placed[i] = true;
        }
    }
    for b in topological_order(count, edges) {
        if placed[b] {
            continue;
        }
        let producers: Vec<&DataflowLayoutEdge> = edges.iter().filter(|e| e.to_box as usize == b && placed[e.from_box as usize]).collect();
        let consumers: Vec<&DataflowLayoutEdge> = edges.iter().filter(|e| e.from_box as usize == b && placed[e.to_box as usize]).collect();
        let row = |other: u32, other_statement: u32, statement: u32| {
            let other = &geometry[other as usize];
            other.y + other.port(other_statement, config) - geometry[b].port(statement, config)
        };
        let (x, y) = if !producers.is_empty() {
            let x = producers.iter().map(|e| geometry[e.from_box as usize].x + geometry[e.from_box as usize].width).fold(f64::MIN, f64::max);
            let y = median(producers.iter().map(|e| row(e.from_box, e.from_statement, e.to_statement)).collect()).unwrap();
            (x + config.layer_gap, y)
        } else if !consumers.is_empty() {
            let x = consumers.iter().map(|e| geometry[e.to_box as usize].x).fold(f64::MAX, f64::min);
            let y = median(consumers.iter().map(|e| row(e.to_box, e.to_statement, e.from_statement)).collect()).unwrap();
            (x - config.layer_gap - geometry[b].width, y)
        } else {
            // Below everything placed, at the left edge
            let others: Vec<&DataflowBoxGeometry> = (0..count).filter(|&i| placed[i]).map(|i| &geometry[i]).collect();
            let x = others.iter().map(|g| g.x).fold(f64::INFINITY, f64::min);
            let bottom = others.iter().map(|g| g.y + g.height).fold(f64::NEG_INFINITY, f64::max);
            if others.is_empty() {
                (0.0, 0.0)
            } else {
                (x, bottom + config.box_gap)
            }
        };
        // The nearest free slot, alternating below and above
        let step = config.grid.max(1.0) * 2.0;
        let mut candidate = geometry[b].clone();
        candidate.x = snap(x, config.grid);
        for k in 0..2048i32 {
            let offset = if k % 2 == 1 { (k + 1) / 2 } else { -(k / 2) } as f64 * step;
            candidate.y = snap(y, config.grid) + offset;
            if !(0..count).any(|i| placed[i] && overlaps(&geometry[i], &candidate, config.box_gap / 2.0)) {
                break;
            }
        }
        geometry[b].x = candidate.x;
        geometry[b].y = candidate.y;
        placed[b] = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(statements: u32) -> DataflowLayoutBox {
        DataflowLayoutBox { statements, ..Default::default() }
    }

    fn edge(from_box: u32, from_statement: u32, to_box: u32, to_statement: u32) -> DataflowLayoutEdge {
        DataflowLayoutEdge { from_box, from_statement, to_box, to_statement }
    }

    fn assert_no_overlaps(geometry: &[DataflowBoxGeometry]) {
        for (i, a) in geometry.iter().enumerate() {
            for b in &geometry[i + 1..] {
                assert!(!overlaps(a, b, 0.0), "{a:?} overlaps {b:?}");
            }
        }
    }

    #[test]
    fn box_geometry_stacks_rows_and_charts() {
        let config = DataflowLayoutConfig::default();
        let g = box_geometry(&DataflowLayoutBox { statements: 2, chart_statement: Some(0), ..Default::default() }, &config);
        assert_eq!(g.rows, vec![40.0, 40.0 + 32.0 + 8.0 + 200.0]);
        assert_eq!(g.height, 40.0 + 32.0 + 8.0 + 200.0 + 32.0 + 8.0);
        let collapsed = box_geometry(&DataflowLayoutBox { statements: 2, collapsed: true, ..Default::default() }, &config);
        assert_eq!(collapsed.height, 32.0);
        assert_eq!(collapsed.port(1, &config), 16.0);
    }

    #[test]
    fn arrange_flows_left_to_right() {
        let config = DataflowLayoutConfig::default();
        let boxes = [data(1), data(2), data(1), data(1)];
        let edges = [edge(0, 0, 1, 0), edge(1, 1, 2, 0), edge(0, 0, 2, 0)];
        let g = compute_dataflow_layout(&boxes, &edges, &config);
        assert!(g[0].x < g[1].x && g[1].x < g[2].x);
        // The box without edges goes below
        assert_eq!(g[3].x, 0.0);
        assert!(g[3].y >= g.iter().take(3).map(|g| g.y + g.height).fold(0.0, f64::max));
        assert_no_overlaps(&g);
        assert_eq!(g, compute_dataflow_layout(&boxes, &edges, &config));
    }

    #[test]
    fn arrange_aligns_the_connected_rows() {
        let config = DataflowLayoutConfig::default();
        // The consumer reads the second statement of the producer
        let g = compute_dataflow_layout(&[data(3), data(1)], &[edge(0, 1, 1, 0)], &config);
        assert_eq!(g[0].y + g[0].port(1, &config), g[1].y + g[1].port(0, &config));
    }

    #[test]
    fn arrange_survives_cycles() {
        let config = DataflowLayoutConfig::default();
        let g = compute_dataflow_layout(&[data(1), data(1)], &[edge(0, 0, 1, 0), edge(1, 0, 0, 0)], &config);
        assert!(g[0].x < g[1].x);
        assert_no_overlaps(&g);
    }

    #[test]
    fn arrange_breaks_cycles_on_the_cycle() {
        let config = DataflowLayoutConfig::default();
        // 0 reads 1, 1 and 2 read each other: 0 is no part of the cycle and stays right of its producer
        let g = compute_dataflow_layout(&[data(1), data(1), data(1)], &[edge(1, 0, 0, 0), edge(2, 0, 1, 0), edge(1, 0, 2, 0)], &config);
        assert!(g[0].x > g[1].x);
        assert_no_overlaps(&g);
    }

    #[test]
    fn a_source_sits_before_its_consumer() {
        let config = DataflowLayoutConfig::default();
        // 0 -> 1 -> 2 and 3 -> 2: 3 goes into the layer of 1
        let g = compute_dataflow_layout(&[data(1), data(1), data(1), data(1)], &[edge(0, 0, 1, 0), edge(1, 0, 2, 0), edge(3, 0, 2, 0)], &config);
        assert_eq!(g[3].x, g[1].x);
        assert_no_overlaps(&g);
    }

    #[test]
    fn place_keeps_fixed_boxes_and_places_the_others_next_to_them() {
        let config = DataflowLayoutConfig::default();
        let fixed = |x, y| DataflowLayoutBox { statements: 1, fixed: Some((x, y)), ..Default::default() };
        let boxes = [fixed(400.0, 800.0), data(1), fixed(400.0, 100.0), data(1)];
        let edges = [edge(0, 0, 1, 0), edge(2, 0, 1, 0)];
        let g = compute_dataflow_layout(&boxes, &edges, &config);
        assert_eq!((g[0].x, g[0].y), (400.0, 800.0));
        assert_eq!((g[2].x, g[2].y), (400.0, 100.0));
        // Right of its producers, between them
        assert_eq!(g[1].x, 400.0 + 280.0 + 96.0);
        assert!(g[1].y > 100.0 && g[1].y < 800.0);
        // The box without edges goes below everything
        assert_eq!(g[3].x, 400.0);
        assert!(g[3].y >= 800.0 + g[0].height);
        assert_no_overlaps(&g);
    }

    #[test]
    fn place_moves_a_box_to_a_free_slot() {
        let config = DataflowLayoutConfig::default();
        let fixed = |x, y| DataflowLayoutBox { statements: 1, fixed: Some((x, y)), ..Default::default() };
        // Two consumers of one producer want the same slot
        let boxes = [fixed(0.0, 0.0), data(1), data(1)];
        let g = compute_dataflow_layout(&boxes, &[edge(0, 0, 1, 0), edge(0, 0, 2, 0)], &config);
        assert_eq!(g[1].x, g[2].x);
        assert_no_overlaps(&g);
    }
}
