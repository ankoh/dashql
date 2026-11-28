//! The layout of the dataflow canvas: script boxes of statement rows, flowing from left to right.
//!
//! The layout has two levels. Inside a box the statements are stacked in script order, every statement is a row
//! of the same height and the chart of a visualized statement follows its row, so the box geometry is fixed by the
//! script. Between the boxes, the layered layout of the Eclipse Layout Kernel (elk-rs) places the boxes and routes
//! the edges: every box is a node with a port per connected statement row, inputs on its left border and outputs on
//! its right border at the centers of the rows, and the edges are routed orthogonally, the edges out of one port
//! share their first segments.
//!
//! - Without hints ELK arranges the connected boxes in layers in the order of the session, the consumers of a box
//!   stack in one column. The connected parts are packed by ELK, boxes without edges go into rows below them.
//! - With hints, where the boxes were, ELK lays out interactively, every connected part on its own: the columns follow
//!   the x of the boxes, the order in a column their y, and a box keeps its y where it does not overlap another. A
//!   dropped box goes into the column under its center, or into a new column in a gap between two columns. A layout
//!   that starts from where an earlier one put every box reproduces it.
//!
//! The dense layout of a narrow canvas draws every box as a tile of one size and flows from top to bottom: the same
//! layered layout with the inputs of a tile on its top border and the outputs on its bottom border. It ignores the
//! hints, the positions of the boxes belong to the layout of the full boxes.

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
    /// The grid that drags and resizes on the canvas snap to, the layout does not snap
    pub grid: f64,
    /// The size of a tile of the dense layout: a name, a status and a summary of its result
    pub tile_width: f64,
    pub tile_height: f64,
    /// The least vertical space between the rows of tiles of the dense layout, wider where the edges need more rails
    pub dense_layer_gap: f64,
    /// The least horizontal space between the tiles of a row of the dense layout
    pub dense_box_gap: f64,
    /// The most tiles in a row of the dense layout, what fits the width of the canvas. The tiles without edges go into
    /// rows of as many.
    pub dense_columns: usize,
    /// The ratio of width to height that ELK packs the connected parts of the dense layout to, a narrow canvas is
    /// higher than wide
    pub dense_aspect_ratio: f64,
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
            grid: 8.0,
            tile_width: 160.0,
            tile_height: 56.0,
            dense_layer_gap: 48.0,
            dense_box_gap: 24.0,
            dense_columns: 2,
            dense_aspect_ratio: 0.5,
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
    /// Is the box an input or an attachment? It is `input_box_width` wide by default.
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
    edges
        .iter()
        .filter(|e| e.from_box != e.to_box && (e.from_box as usize) < count && (e.to_box as usize) < count)
        .copied()
        .collect()
}

/// The connected parts of the graph, by their first box. Boxes without edges are left out.
fn components(count: usize, edges: &[DataflowLayoutEdge]) -> Vec<Vec<usize>> {
    let mut parent: Vec<usize> = (0..count).collect();
    fn find(parent: &mut [usize], i: usize) -> usize {
        let mut root = i;
        while let Some(&up) = parent.get(root).filter(|&&up| up != root) {
            root = up;
        }
        if let Some(p) = parent.get_mut(i) {
            *p = root;
        }
        root
    }
    for e in edges {
        let (a, b) = (find(&mut parent, e.from_box as usize), find(&mut parent, e.to_box as usize));
        if let Some(p) = parent.get_mut(a.max(b)) {
            *p = a.min(b);
        }
    }
    let connected: BTreeSet<usize> = edges.iter().flat_map(|e| [e.from_box as usize, e.to_box as usize]).collect();
    // The parts by their root, in the order of their first box
    let mut parts: Vec<(usize, Vec<usize>)> = Vec::new();
    for i in (0..count).filter(|i| connected.contains(i)) {
        let root = find(&mut parent, i);
        match parts.iter_mut().find(|(r, _)| *r == root) {
            Some((_, part)) => part.push(i),
            None => parts.push((root, vec![i])),
        }
    }
    parts.into_iter().map(|(_, part)| part).collect()
}

/// Put boxes into rows of `per_row` from a top left corner, `gap` apart, returns the bottom of the rows with a gap
fn place_in_rows(
    boxes: &[usize],
    (left, mut top): (f64, f64),
    (per_row, gap): (usize, f64),
    geometry: &mut [DataflowBoxGeometry],
) -> f64 {
    for row in boxes.chunks(per_row.max(1)) {
        let mut x = left;
        let mut height: f64 = 0.0;
        for &i in row {
            let Some(g) = geometry.get_mut(i) else { continue };
            g.x = x;
            g.y = top;
            x += g.width + gap;
            height = height.max(g.height);
        }
        top += height + gap;
    }
    top
}

/// Lay out the boxes
pub fn compute_dataflow_layout(
    boxes: &[DataflowLayoutBox],
    edges: &[DataflowLayoutEdge],
    config: &DataflowLayoutConfig,
) -> Vec<DataflowBoxGeometry> {
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
        let settled: Vec<DataflowLayoutBox> = boxes
            .iter()
            .zip(geometry.iter())
            .map(|(b, g)| DataflowLayoutBox { hint: Some((g.x, g.y)), dropped: false, ..b.clone() })
            .collect();
        arrange(&settled, &edges, config, &mut geometry)
    } else {
        arrange(boxes, &edges, config, &mut geometry)
    };
    (geometry, routes)
}

/// The geometry of a tile of the dense layout: every box is one size, its edges meet the middle of its top and
/// bottom borders
fn tile_geometry(b: &DataflowLayoutBox, config: &DataflowLayoutConfig) -> DataflowBoxGeometry {
    DataflowBoxGeometry {
        width: config.tile_width,
        height: config.tile_height,
        rows: vec![0.0; b.statements as usize],
        ..Default::default()
    }
}

/// Lay out the boxes as the tiles of a narrow canvas, from top to bottom, with the routes of the edges between them.
/// The hints are ignored: the positions of the boxes belong to `compute_dataflow_layout_with_routes`, so a dense
/// layout is the same wherever the boxes were. ELK arranges every connected part in rows of at most `dense_columns`
/// tiles from top to bottom and packs the parts higher than wide, the tiles without edges go into rows below them. A route runs from the middle of
/// the bottom border of its source tile to the middle of the top border of its target tile, the edges of one pair
/// of tiles share it.
pub fn compute_dense_dataflow_layout_with_routes(
    boxes: &[DataflowLayoutBox],
    edges: &[DataflowLayoutEdge],
    config: &DataflowLayoutConfig,
) -> (Vec<DataflowBoxGeometry>, Vec<DataflowEdgeRoute>) {
    let mut geometry: Vec<DataflowBoxGeometry> = boxes.iter().map(|b| tile_geometry(b, config)).collect();
    let edges = box_edges(edges, boxes.len());
    let count = geometry.len();
    let linked: BTreeSet<usize> = edges.iter().flat_map(|e| [e.from_box as usize, e.to_box as usize]).collect();
    let connected: Vec<usize> = (0..count).filter(|b| linked.contains(b)).collect();
    let routes = if connected.is_empty() {
        Vec::new()
    } else {
        elk(boxes, &edges, config, &mut geometry, &connected, &vec![None; count], Mode::Dense)
    };
    let left = geometry_of(&geometry, &connected).map(|g| g.x).fold(f64::INFINITY, f64::min);
    let bottom = geometry_of(&geometry, &connected).map(|g| g.y + g.height).fold(f64::NEG_INFINITY, f64::max);
    let corner = if left.is_finite() { (left, bottom + config.dense_layer_gap) } else { (0.0, 0.0) };
    let isolated: Vec<usize> = (0..count).filter(|b| !linked.contains(b)).collect();
    place_in_rows(&isolated, corner, (config.dense_columns, config.dense_box_gap), &mut geometry);
    (geometry, routes)
}

/// The tiles that fit side by side into a width of the canvas, at least one
pub fn dense_columns_for_width(width: f64, config: &DataflowLayoutConfig) -> usize {
    let columns = ((width + config.dense_box_gap) / (config.tile_width + config.dense_box_gap)).floor();
    if columns.is_finite() && columns >= 1.0 {
        columns as usize
    } else {
        1
    }
}

/// How ELK lays out a subset of the boxes
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// From scratch, from left to right in the order of the session
    Arrange,
    /// From the seeds of the boxes, from left to right
    Interactive,
    /// The tiles of the dense layout from scratch, from top to bottom
    Dense,
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

/// The geometry of some of the boxes
fn geometry_of<'a>(
    geometry: &'a [DataflowBoxGeometry],
    subset: &'a [usize],
) -> impl Iterator<Item = &'a DataflowBoxGeometry> + 'a {
    subset.iter().filter_map(|&b| geometry.get(b))
}

/// The columns of x ranges: the runs of overlapping ranges, from left to right
fn merge_columns(mut ranges: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    ranges.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut columns: Vec<(f64, f64)> = Vec::new();
    for (x0, x1) in ranges {
        match columns.last_mut() {
            Some(last) if x0 < last.1 => last.1 = last.1.max(x1),
            _ => columns.push((x0, x1)),
        }
    }
    columns
}

/// The boxes of a part in producer order: a box after the boxes it reads, in box order otherwise. The boxes of a
/// cycle follow in box order.
fn producer_order(part: &[usize], edges: &[DataflowLayoutEdge]) -> Vec<usize> {
    let mut incoming: BTreeMap<usize, usize> = part.iter().map(|&b| (b, 0)).collect();
    for e in edges {
        if let Some(n) = incoming.get_mut(&(e.to_box as usize)) {
            *n += 1;
        }
    }
    let mut ready: BTreeSet<usize> = incoming.iter().filter(|(_, &n)| n == 0).map(|(&b, _)| b).collect();
    let mut order = Vec::with_capacity(part.len());
    while let Some(b) = ready.pop_first() {
        order.push(b);
        for e in edges.iter().filter(|e| e.from_box as usize == b) {
            if let Some(n) = incoming.get_mut(&(e.to_box as usize)) {
                *n -= 1;
                if *n == 0 {
                    ready.insert(e.to_box as usize);
                }
            }
        }
    }
    let rest: Vec<usize> = part.iter().copied().filter(|b| !order.contains(b)).collect();
    order.extend(rest);
    order
}

/// Arrange the boxes once, from their hints if they have any
fn arrange(
    boxes: &[DataflowLayoutBox],
    edges: &[DataflowLayoutEdge],
    config: &DataflowLayoutConfig,
    geometry: &mut [DataflowBoxGeometry],
) -> Vec<DataflowEdgeRoute> {
    let count = geometry.len();
    let hint = |b: usize| boxes.get(b).and_then(|x| x.hint);
    let dropped = |b: usize| boxes.get(b).is_some_and(|x| x.dropped);
    let linked: BTreeSet<usize> = edges.iter().flat_map(|e| [e.from_box as usize, e.to_box as usize]).collect();
    if !boxes.iter().any(|b| b.hint.is_some()) {
        // ELK packs the connected boxes, the boxes without edges go into rows below them
        let connected: Vec<usize> = (0..count).filter(|b| linked.contains(b)).collect();
        let routes = if connected.is_empty() {
            Vec::new()
        } else {
            elk(boxes, edges, config, geometry, &connected, &vec![None; count], Mode::Arrange)
        };
        let left = geometry_of(geometry, &connected).map(|g| g.x).fold(f64::INFINITY, f64::min);
        let bottom = geometry_of(geometry, &connected).map(|g| g.y + g.height).fold(f64::NEG_INFINITY, f64::max);
        let corner = if left.is_finite() { (left, bottom + config.box_gap * 2.0) } else { (0.0, 0.0) };
        let isolated: Vec<usize> = (0..count).filter(|b| !linked.contains(b)).collect();
        place_in_rows(&isolated, corner, (config.isolated_per_row, config.box_gap), geometry);
        return routes;
    }
    // Interactive: every connected part on its own, so that moving a box in one part leaves the others alone
    let mut routes = Vec::new();
    let mut fresh: Vec<Vec<usize>> = Vec::new();
    for part in components(count, edges) {
        if !part.iter().any(|&b| hint(b).is_some()) {
            fresh.push(part);
            continue;
        }
        // A box without a hint starts right of its producers or left of its consumers that have a seed, with the row of
        // the edge level with the row at its other end. The boxes take their seeds in producer order, from the boxes
        // with hints downstream first, then upstream, so that a chain of boxes without hints starts box after box.
        let mut seeds: Vec<Option<(f64, f64)>> = boxes.iter().map(|b| b.hint).collect();
        let order = producer_order(&part, edges);
        loop {
            let mut seeded = false;
            for &b in &order {
                let (Some(None), Some(g)) = (seeds.get(b), geometry.get(b)) else { continue };
                let seed = edges
                    .iter()
                    .filter(|e| e.to_box as usize == b)
                    .filter_map(|e| {
                        let p = geometry.get(e.from_box as usize)?;
                        let (x, y) = seeds.get(e.from_box as usize).copied().flatten()?;
                        Some((x + p.width, y + p.port(e.from_statement, config) - g.port(e.to_statement, config)))
                    })
                    .max_by(|a, b| a.0.total_cmp(&b.0))
                    .map(|(x, y)| (x + config.layer_gap, y));
                if let (Some(seed), Some(s)) = (seed, seeds.get_mut(b)) {
                    *s = Some(seed);
                    seeded = true;
                }
            }
            for &b in order.iter().rev() {
                let (Some(None), Some(g)) = (seeds.get(b), geometry.get(b)) else { continue };
                let seed = edges
                    .iter()
                    .filter(|e| e.from_box as usize == b)
                    .filter_map(|e| {
                        let c = geometry.get(e.to_box as usize)?;
                        let (x, y) = seeds.get(e.to_box as usize).copied().flatten()?;
                        Some((x, y + c.port(e.to_statement, config) - g.port(e.from_statement, config)))
                    })
                    .min_by(|a, b| a.0.total_cmp(&b.0))
                    .map(|(x, y)| (x - config.layer_gap - g.width, y));
                if let (Some(seed), Some(s)) = (seed, seeds.get_mut(b)) {
                    *s = Some(seed);
                    seeded = true;
                }
            }
            if !seeded {
                break;
            }
        }
        // A dropped box that almost lines up a row with a connected row of a box that stays lines it up
        for &b in part.iter().filter(|&&b| dropped(b)) {
            let (Some(&Some((x, y))), Some(this)) = (seeds.get(b), geometry.get(b)) else { continue };
            let snap = edges
                .iter()
                .filter_map(|e| {
                    let (this_statement, other, other_statement) = if e.to_box as usize == b {
                        (e.to_statement, e.from_box as usize, e.from_statement)
                    } else if e.from_box as usize == b {
                        (e.from_statement, e.to_box as usize, e.to_statement)
                    } else {
                        return None;
                    };
                    let (_, other_y) = hint(other).filter(|_| !dropped(other))?;
                    let other_row = geometry.get(other)?.port(other_statement, config);
                    Some(other_y + other_row - (y + this.port(this_statement, config)))
                })
                .filter(|d| d.abs() <= config.align_snap)
                .min_by(|a, b| a.abs().total_cmp(&b.abs()));
            if let (Some(delta), Some(seed)) = (snap, seeds.get_mut(b)) {
                *seed = Some((x, y + delta));
            }
        }
        // ELK forms its columns from overlapping x ranges, a wide or dropped box would merge two columns. The seeds put
        // every box at the column of its center instead, far apart: the boxes that stay form the columns. The other
        // boxes in a gap between two columns form new columns there, in the order of their seeds.
        let stays = |b: usize| hint(b).is_some() && !dropped(b);
        let ranges = part.iter().filter(|&&b| stays(b)).filter_map(|&b| {
            let (x, _) = hint(b)?;
            Some((x, x + geometry.get(b)?.width))
        });
        let columns = merge_columns(ranges.collect());
        let mut gaps: BTreeMap<i64, Vec<(f64, f64)>> = BTreeMap::new();
        for &b in part.iter().filter(|&&b| !stays(b)) {
            let (Some(Some((x, _))), Some(g)) = (seeds.get(b), geometry.get(b)) else { continue };
            let column = column_of(&columns, x + g.width / 2.0);
            if column.fract() != 0.0 {
                gaps.entry(column.floor() as i64).or_default().push((*x, x + g.width));
            }
        }
        let gaps: BTreeMap<i64, Vec<(f64, f64)>> =
            gaps.into_iter().map(|(gap, ranges)| (gap, merge_columns(ranges))).collect();
        for &b in &part {
            let (Some(Some((x, _))), Some(g)) = (seeds.get_mut(b), geometry.get(b)) else { continue };
            let mut column = column_of(&columns, *x + g.width / 2.0);
            if !stays(b) && column.fract() != 0.0 {
                // The new columns of a gap split it evenly
                let gap = column.floor();
                if let Some(ranges) = gaps.get(&(gap as i64)) {
                    let index = ranges.iter().position(|&(x0, x1)| *x >= x0 && *x < x1).unwrap_or_default();
                    column = gap + (index + 1) as f64 / (ranges.len() + 1) as f64;
                }
            }
            *x = column * COLUMN_SPREAD;
        }
        // ELK routes an edge that runs from right to left around the top of the columns: it puts its dummies at y 0,
        // `edge_gap` apart, and pushes a box down that is closer than `edge_box_gap` below them. The seeds start below
        // the room that these edges take, so that every box keeps its y. The layout moves back by the offset of its
        // boxes, wherever the seeds start.
        let column = |b: u32| seeds.get(b as usize).copied().flatten().map(|(x, _)| x);
        let backward: BTreeSet<(u32, u32, u32, u32)> = edges
            .iter()
            .filter(|e| part.contains(&(e.from_box as usize)))
            .filter(|e| matches!((column(e.from_box), column(e.to_box)), (Some(from), Some(to)) if to <= from))
            .map(|e| (e.from_box, e.from_statement, e.to_box, e.to_statement))
            .collect();
        let top =
            part.iter().filter_map(|&b| seeds.get(b).copied().flatten()).map(|(_, y)| y).fold(f64::INFINITY, f64::min);
        if !backward.is_empty() && top.is_finite() {
            let shift = config.edge_box_gap + config.edge_gap * (backward.len() - 1) as f64 - top;
            for &b in &part {
                if let Some(Some((_, y))) = seeds.get_mut(b) {
                    *y += shift;
                }
            }
        }
        routes.extend(elk(boxes, edges, config, geometry, &part, &seeds, Mode::Interactive));
    }
    // Boxes without edges keep their hints, the others and the parts without any hint go below everything
    let mut placed: Vec<usize> =
        (0..count).filter(|&b| linked.contains(&b) && !fresh.iter().any(|p| p.contains(&b))).collect();
    let mut loose: Vec<usize> = Vec::new();
    for (b, (layout_box, g)) in boxes.iter().zip(geometry.iter_mut()).enumerate().filter(|(b, _)| !linked.contains(b)) {
        match layout_box.hint {
            Some((x, y)) => {
                g.x = x;
                g.y = y;
                placed.push(b);
            }
            None => loose.push(b),
        }
    }
    let left = geometry_of(geometry, &placed).map(|g| g.x).fold(f64::INFINITY, f64::min);
    let left = if left.is_finite() { left } else { 0.0 };
    let bottom = geometry_of(geometry, &placed).map(|g| g.y + g.height).fold(f64::NEG_INFINITY, f64::max);
    let mut top = if bottom.is_finite() { bottom + config.box_gap * 2.0 } else { 0.0 };
    for part in fresh {
        let part_routes = elk(boxes, edges, config, geometry, &part, &vec![None; count], Mode::Arrange);
        let (x0, y0) =
            geometry_of(geometry, &part).fold((f64::INFINITY, f64::INFINITY), |(x, y), g| (x.min(g.x), y.min(g.y)));
        let (dx, dy) = (left - x0, top - y0);
        for &b in &part {
            if let Some(g) = geometry.get_mut(b) {
                g.x += dx;
                g.y += dy;
            }
        }
        top = geometry_of(geometry, &part).map(|g| g.y + g.height).fold(top, f64::max) + config.box_gap * 2.0;
        routes.extend(
            part_routes.into_iter().map(|(k, points)| (k, points.into_iter().map(|(x, y)| (x + dx, y + dy)).collect())),
        );
    }
    place_in_rows(&loose, (left, top), (config.isolated_per_row, config.box_gap), geometry);
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
    mode: Mode,
) -> Vec<DataflowEdgeRoute> {
    let interactive = mode == Mode::Interactive;
    let dense = mode == Mode::Dense;
    use org_eclipse_elk_alg_layered::org::eclipse::elk::alg::layered::layered_layout_provider::LayeredLayoutProvider;
    use org_eclipse_elk_alg_layered::org::eclipse::elk::alg::layered::options::{
        CrossingMinimizationStrategy, CycleBreakingStrategy, LayeredOptions, LayeringStrategy, NodePlacementStrategy,
        OrderingStrategy,
    };
    use org_eclipse_elk_alg_layered::org::eclipse::elk::alg::layered::plain_java_initialization::initialize_plain_java_layout;
    use org_eclipse_elk_core::org::eclipse::elk::core::math::ElkPadding;
    use org_eclipse_elk_core::org::eclipse::elk::core::options::{
        CoreOptions, Direction, EdgeRouting, PortConstraints, PortSide, SizeConstraint,
    };
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
    // The dense layout flows from top to bottom, its layers are rows of tiles
    let (box_gap, layer_gap) =
        if dense { (config.dense_box_gap, config.dense_layer_gap) } else { (config.box_gap, config.layer_gap) };
    set_node(&graph, CoreOptions::DIRECTION, if dense { Direction::Down } else { Direction::Right });
    set_node(&graph, CoreOptions::PADDING, ElkPadding::with_any(0.0));
    set_node(&graph, LayeredOptions::SPACING_NODE_NODE, box_gap);
    set_node(&graph, LayeredOptions::SPACING_NODE_NODE_BETWEEN_LAYERS, layer_gap);
    set_node(&graph, LayeredOptions::SPACING_COMPONENT_COMPONENT, box_gap * 2.0);
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
        // The order of the session, ELK packs the parts
        set_node(&graph, LayeredOptions::NODE_PLACEMENT_STRATEGY, NodePlacementStrategy::NetworkSimplex);
        set_node(&graph, LayeredOptions::CONSIDER_MODEL_ORDER_STRATEGY, OrderingStrategy::NodesAndEdges);
        set_node(&graph, LayeredOptions::SEPARATE_CONNECTED_COMPONENTS, true);
        if dense {
            set_node(&graph, LayeredOptions::ASPECT_RATIO, config.dense_aspect_ratio);
            // A row holds at most as many tiles as fit the canvas, the consumers of a wide fan-out go into more rows
            set_node(&graph, LayeredOptions::LAYERING_STRATEGY, LayeringStrategy::CoffmanGraham);
            set_node(&graph, LayeredOptions::LAYERING_COFFMAN_GRAHAM_LAYER_BOUND, config.dense_columns.max(1) as i32);
        }
    }

    let hint = |b: usize| boxes.get(b).and_then(|x| x.hint);
    let dropped = |b: usize| boxes.get(b).is_some_and(|x| x.dropped);
    let in_subset: BTreeSet<usize> = subset.iter().copied().collect();
    let edges: Vec<DataflowLayoutEdge> = edges
        .iter()
        .filter(|e| in_subset.contains(&(e.from_box as usize)) && in_subset.contains(&(e.to_box as usize)))
        .copied()
        .collect();
    // The connected statements of the boxes, the inputs and the outputs
    let mut connected: BTreeMap<usize, (BTreeSet<u32>, BTreeSet<u32>)> = BTreeMap::new();
    let mut unique: BTreeSet<(u32, u32, u32, u32)> = BTreeSet::new();
    for e in &edges {
        connected.entry(e.to_box as usize).or_default().0.insert(e.to_statement);
        connected.entry(e.from_box as usize).or_default().1.insert(e.from_statement);
        unique.insert((e.from_box, e.from_statement, e.to_box, e.to_statement));
    }
    let unconnected = Default::default();
    let mut nodes = Vec::with_capacity(subset.len());
    let mut ports: BTreeMap<(u32, bool, u32), ElkPortRef> = BTreeMap::new();
    for &b in subset {
        let Some(g) = geometry.get(b) else { continue };
        let (ins, outs) = connected.get(&b).unwrap_or(&unconnected);
        let node = ElkGraphUtil::create_node(Some(graph.clone()));
        node.borrow_mut().connectable().shape().set_dimensions(g.width, g.height);
        if let Some(&Some((x, y))) = seeds.get(b) {
            node.borrow_mut().connectable().shape().set_location(x, y);
        }
        set_node(&node, CoreOptions::NODE_SIZE_CONSTRAINTS, SizeConstraint::fixed());
        set_node(&node, CoreOptions::PORT_CONSTRAINTS, PortConstraints::FixedPos);
        for (output, statements) in [(false, ins), (true, outs)] {
            if dense {
                // A tile has one input in the middle of its top border and one output in the middle of its bottom
                if statements.is_empty() {
                    continue;
                }
                let port = ElkGraphUtil::create_port(Some(node.clone()));
                port.borrow_mut()
                    .connectable()
                    .shape()
                    .set_location(g.width / 2.0, if output { g.height } else { 0.0 });
                set_port(&port, CoreOptions::PORT_SIDE, if output { PortSide::South } else { PortSide::North });
                ports.insert((b as u32, output, 0), port);
                continue;
            }
            for &statement in statements {
                let port = ElkGraphUtil::create_port(Some(node.clone()));
                port.borrow_mut()
                    .connectable()
                    .shape()
                    .set_location(if output { g.width } else { 0.0 }, g.port(statement, config));
                set_port(&port, CoreOptions::PORT_SIDE, if output { PortSide::East } else { PortSide::West });
                ports.insert((b as u32, output, statement), port);
            }
        }
        nodes.push((b, node));
    }
    let mut elk_edges = Vec::new();
    for (from, fs, to, ts) in unique {
        let (sp, tp) = if dense { (0, 0) } else { (fs, ts) };
        let (Some(source), Some(target)) = (ports.get(&(from, true, sp)), ports.get(&(to, false, tp))) else {
            continue;
        };
        let edge = ElkGraphUtil::create_simple_edge(
            ElkConnectableShapeRef::Port(source.clone()),
            ElkConnectableShapeRef::Port(target.clone()),
        );
        elk_edges.push(((from, fs, to, ts), edge));
    }
    LayeredLayoutProvider::new().layout(&graph, &mut BasicProgressMonitor::new());
    for (b, node) in &nodes {
        let mut node = node.borrow_mut();
        let shape = node.connectable().shape();
        if let Some(g) = geometry.get_mut(*b) {
            g.x = shape.x();
            g.y = shape.y();
        }
    }
    // ELK moves the layout to the origin, an interactive layout moves back by the offset that most of its boxes with
    // hints share: the boxes that ELK left where they were. A dropped box does not count.
    let mut offset = (0.0, 0.0);
    if interactive {
        let anchors = subset.iter().filter(|&&b| hint(b).is_some() && !dropped(b)).count();
        let mut counts: Vec<((i64, i64), usize)> = Vec::new();
        for &b in subset.iter().filter(|&&b| !(dropped(b) && anchors > 0)) {
            if let (Some((x, y)), Some(g)) = (hint(b), geometry.get(b)) {
                let key = ((x - g.x).round() as i64, (y - g.y).round() as i64);
                match counts.iter_mut().find(|(k, _)| *k == key) {
                    Some((_, n)) => *n += 1,
                    None => counts.push((key, 1)),
                }
            }
        }
        // The most frequent offset, the first one among equals
        if let Some(((dx, dy), _)) = counts.iter().fold(None::<&((i64, i64), usize)>, |best, c| {
            if best.is_none_or(|b| c.1 > b.1) {
                Some(c)
            } else {
                best
            }
        }) {
            offset = (*dx as f64, *dy as f64);
        }
        for &b in subset {
            if let Some(g) = geometry.get_mut(b) {
                g.x += offset.0;
                g.y += offset.1;
            }
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
                points.extend(
                    section.bend_points().iter().map(|p| (p.borrow().x() + offset.0, p.borrow().y() + offset.1)),
                );
                points.push((section.end_x() + offset.0, section.end_y() + offset.1));
            }
            (key, points)
        })
        .collect();
    if dense {
        // The rails of the dense layout are horizontal, between the rows: center them like the vertical ones
        let flip = |(x, y): (f64, f64)| (y, x);
        let mut transposed: Vec<DataflowEdgeRoute> =
            routes.into_iter().map(|(k, points)| (k, points.into_iter().map(flip).collect())).collect();
        let swapped: Vec<DataflowBoxGeometry> = geometry
            .iter()
            .map(|g| DataflowBoxGeometry { x: g.y, y: g.x, width: g.height, height: g.width, rows: Vec::new() })
            .collect();
        center_rails(&mut transposed, subset, &swapped);
        return transposed.into_iter().map(|(k, points)| (k, points.into_iter().map(flip).collect())).collect();
    }
    center_rails(&mut routes, subset, geometry);
    routes
}

/// ELK puts the vertical segments of the edges between two columns next to the left column, center them in the gap
/// instead: away from the boxes on both sides. The segments of a gap move together, so their order and the space
/// between them stay.
fn center_rails(routes: &mut [DataflowEdgeRoute], subset: &[usize], geometry: &[DataflowBoxGeometry]) {
    let columns = merge_columns(geometry_of(geometry, subset).map(|g| (g.x, g.x + g.width)).collect());
    for gap in columns.iter().zip(columns.iter().skip(1)).map(|(left, right)| (left.1, right.0)) {
        let inside = |x: f64| x > gap.0 && x < gap.1;
        let rails: Vec<f64> = routes
            .iter()
            .flat_map(|(_, points)| {
                points.iter().zip(points.iter().skip(1)).filter(|(a, b)| a.0 == b.0 && inside(a.0)).map(|(a, _)| a.0)
            })
            .collect();
        let (Some(lo), Some(hi)) = (rails.iter().copied().reduce(f64::min), rails.iter().copied().reduce(f64::max))
        else {
            continue;
        };
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
                let overlap =
                    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
                assert!(!overlap, "{a:?} overlaps {b:?}");
            }
        }
    }

    #[test]
    fn box_geometry_stacks_rows_and_charts() {
        let config = DataflowLayoutConfig::default();
        let g =
            box_geometry(&DataflowLayoutBox { statements: 2, chart_statement: Some(0), ..Default::default() }, &config);
        // The rows start below the header, the chart sits below its statement
        let first = config.header_height + config.row_padding;
        let second = first + config.row_height + config.row_padding + config.chart_height;
        assert_eq!(g.rows, vec![first, second]);
        assert_eq!(g.height, second + config.row_height + config.row_padding);
        // A box with a chart is wider than a box without one
        assert_eq!(g.width, config.chart_box_width);
        assert_eq!(
            box_geometry(&DataflowLayoutBox { statements: 2, ..Default::default() }, &config).width,
            config.box_width
        );
        // A box with its own size, e.g. from a resized `@flow` tag
        let sized = DataflowLayoutBox {
            statements: 2,
            chart_statement: Some(0),
            width: Some(400.0),
            chart_height: Some(96.0),
            ..Default::default()
        };
        let sized = box_geometry(&sized, &config);
        assert_eq!(sized.width, 400.0);
        assert_eq!(sized.rows, vec![first, first + config.row_height + config.row_padding + 96.0]);
        let collapsed =
            box_geometry(&DataflowLayoutBox { statements: 2, collapsed: true, ..Default::default() }, &config);
        // A collapsed box is its header, its edges meet the middle of it
        assert_eq!(collapsed.height, config.header_height);
        assert_eq!(collapsed.port(1, &config), config.header_height / 2.0);
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
    fn a_fan_out_stays_one_column() {
        let config = DataflowLayoutConfig::default();
        let boxes = [data(1), chart(), chart(), chart(), chart(), chart()];
        let edges: Vec<_> = (1..6).map(|i| edge(0, 0, i, 0)).collect();
        let g = compute_dataflow_layout(&boxes, &edges, &config);
        assert_eq!(g[1..].iter().map(|g| g.x as i64).collect::<BTreeSet<_>>().len(), 1);
        // In the order of the session, from top to bottom
        assert!(g[1..].windows(2).all(|w| w[0].y < w[1].y));
        assert_no_overlaps(&g);
    }

    #[test]
    fn boxes_without_edges_go_into_rows_below() {
        let config = DataflowLayoutConfig::default();
        // Two connected boxes, then one full row of boxes without edges and one more box
        let per_row = config.isolated_per_row;
        let boxes: Vec<_> = (0..2 + per_row + 1).map(|_| data(1)).collect();
        let g = compute_dataflow_layout(&boxes, &[edge(0, 0, 1, 0)], &config);
        let bottom = (g[0].y + g[0].height).max(g[1].y + g[1].height);
        assert!(g[2..].iter().all(|b| b.y > bottom));
        let (first, last, next) = (&g[2], &g[2 + per_row - 1], &g[2 + per_row]);
        assert_eq!(first.y, last.y);
        assert!(next.y > first.y);
        assert_eq!(next.x, first.x);
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
    fn a_consumer_left_of_its_producer_keeps_its_y() {
        let config = DataflowLayoutConfig::default();
        // ELK routes the edges from right to left around the top, the boxes below them keep their y
        for y in [0.0, 200.0, 400.0] {
            let boxes = [
                DataflowLayoutBox { hint: Some((800.0, 0.0)), ..data(2) },
                DataflowLayoutBox { hint: Some((0.0, y)), ..data(1) },
                DataflowLayoutBox { hint: Some((0.0, y + 200.0)), ..data(1) },
            ];
            let edges = [edge(0, 0, 1, 0), edge(0, 1, 2, 0)];
            let (g, routes) = compute_dataflow_layout_with_routes(&boxes, &edges, &config);
            assert_eq!((g[0].y, g[1].y, g[2].y), (0.0, y, y + 200.0), "y {y}");
            // The routes run above the boxes, the lower one `edge_box_gap` above the producer, the other `edge_gap` higher
            let top = routes.iter().flat_map(|(_, points)| points.iter().map(|p| p.1)).fold(f64::INFINITY, f64::min);
            assert_eq!(top, -config.edge_box_gap - config.edge_gap);
            assert_no_overlaps(&g);
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

    #[test]
    fn dense_tiles_flow_top_to_bottom() {
        let config = DataflowLayoutConfig::default();
        let boxes = [data(2), chart(), data(1)];
        let edges = [edge(0, 1, 1, 0), edge(1, 0, 2, 0)];
        let (g, routes) = compute_dense_dataflow_layout_with_routes(&boxes, &edges, &config);
        // Every box is a tile of one size
        assert!(g.iter().all(|g| g.width == config.tile_width && g.height == config.tile_height));
        // A chain is one column from top to bottom
        assert!(g[0].y + g[0].height + config.dense_layer_gap <= g[1].y);
        assert!(g[1].y + g[1].height + config.dense_layer_gap <= g[2].y);
        assert_eq!((g[0].x, g[1].x), (g[1].x, g[2].x));
        // A route runs from the middle of the bottom of its source to the middle of the top of its target
        assert_eq!(routes.len(), edges.len());
        for ((from, _, to, _), points) in &routes {
            let (f, t) = (&g[*from as usize], &g[*to as usize]);
            assert_eq!(points.first(), Some(&(f.x + f.width / 2.0, f.y + f.height)));
            assert_eq!(points.last(), Some(&(t.x + t.width / 2.0, t.y)));
            assert!(points.windows(2).all(|w| w[0].0 == w[1].0 || w[0].1 == w[1].1));
        }
    }

    #[test]
    fn dense_columns_fit_the_width() {
        let config = DataflowLayoutConfig::default();
        let two = 2.0 * config.tile_width + config.dense_box_gap;
        assert_eq!(dense_columns_for_width(two, &config), 2);
        assert_eq!(dense_columns_for_width(two - 1.0, &config), 1);
        assert_eq!(dense_columns_for_width(0.0, &config), 1);
        assert_eq!(dense_columns_for_width(f64::NAN, &config), 1);
    }

    #[test]
    fn dense_ignores_the_hints() {
        let config = DataflowLayoutConfig::default();
        let (boxes, edges) = two_parts();
        let fresh = compute_dense_dataflow_layout_with_routes(&boxes, &edges, &config);
        let full = compute_dataflow_layout(&boxes, &edges, &config);
        let mut hinted = hinted(&boxes, &full);
        hinted[2].hint = Some((4000.0, -900.0));
        hinted[2].dropped = true;
        assert_eq!(compute_dense_dataflow_layout_with_routes(&hinted, &edges, &config), fresh);
        assert_no_overlaps(&fresh.0);
    }

    #[test]
    fn dense_edges_of_one_pair_of_tiles_share_a_route() {
        let config = DataflowLayoutConfig::default();
        let boxes = [data(2), data(2)];
        let edges = [edge(0, 0, 1, 0), edge(0, 1, 1, 1)];
        let (_, routes) = compute_dense_dataflow_layout_with_routes(&boxes, &edges, &config);
        assert_eq!(routes.len(), 2);
        assert_eq!(routes[0].1, routes[1].1);
    }

    #[test]
    fn dense_fan_out_and_parts_stay_apart() {
        let config = DataflowLayoutConfig::default();
        let mut boxes = vec![data(1), chart(), chart(), chart(), chart(), chart()];
        let mut edges: Vec<_> = (1..6).map(|i| edge(0, 0, i, 0)).collect();
        // A second part and two tiles without edges
        boxes.extend([data(1), data(1), data(1), data(1)]);
        edges.push(edge(6, 0, 7, 0));
        let (g, routes) = compute_dense_dataflow_layout_with_routes(&boxes, &edges, &config);
        assert_no_overlaps(&g);
        assert_eq!(routes.len(), edges.len());
        // The consumers are below their producer, in rows of at most `dense_columns`
        assert!(g[1..6].iter().all(|c| c.y > g[0].y + g[0].height));
        let mut rows: BTreeMap<i64, usize> = BTreeMap::new();
        for c in &g[..8] {
            *rows.entry(c.y as i64).or_default() += 1;
        }
        assert!(rows.values().all(|&n| n <= config.dense_columns), "{rows:?}");
        // The tiles without edges are a row of two below everything else
        let bottom = g[..8].iter().map(|g| g.y + g.height).fold(f64::NEG_INFINITY, f64::max);
        assert!(g[8].y > bottom && g[8].y == g[9].y && g[8].x < g[9].x);
        // A wider canvas takes more tiles per row
        let wide = DataflowLayoutConfig { dense_columns: 3, ..config };
        let (g, _) = compute_dense_dataflow_layout_with_routes(&boxes, &edges, &wide);
        let rows = g[1..6].iter().map(|c| c.y as i64).collect::<BTreeSet<_>>();
        assert_eq!(rows.len(), 2);
    }
}
