//! The wasm-bindgen API of the layout of the dataflow canvas (`dashql-dataflow`): ELK places the boxes and
//! routes the edges, and orthogonal routes go around boxes at any position. A module of its own, so that the core
//! module does not carry ELK; the app loads it when it opens the dataflow canvas. The TypeScript wrapper is
//! `DashQLDataflow` in `packages/dashql-core-js/src/layout.ts`.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(message: &str);
}

/// Log panics to the console before the module traps. A panic aborts, the module must not be used anymore.
#[wasm_bindgen(js_name = installPanicHook)]
pub fn install_panic_hook() {
    static INSTALLED: std::sync::Once = std::sync::Once::new();
    INSTALLED.call_once(|| {
        std::panic::set_hook(Box::new(|info| console_error(&format!("dashql dataflow panicked: {info}"))));
    });
}

/// Route the edges of the dataflow canvas around its boxes (`routing::route_edges`). The boxes are x, y,
/// width and height, the edges x and y of the source on the right border of its box and x and y of the target on the
/// left border of its box. Returns per edge the number of points of its route, 0 without a route, followed by x and
/// y of the points of a polyline of horizontal and vertical segments.
#[wasm_bindgen(js_name = routeDataflowEdges)]
pub fn route_dataflow_edges(boxes: &[f64], edges: &[f64]) -> Vec<f64> {
    use dashql_dataflow::routing::{route_edges, RouteBox, RouteRequestEdge};
    let boxes: Vec<RouteBox> = boxes.chunks_exact(4).map(|b| RouteBox { x: b[0], y: b[1], width: b[2], height: b[3] }).collect();
    let edges: Vec<RouteRequestEdge> = edges.chunks_exact(4).map(|e| RouteRequestEdge { from: (e[0], e[1]), to: (e[2], e[3]) }).collect();
    let mut out = Vec::new();
    for route in route_edges(&boxes, &edges) {
        let points = route.unwrap_or_default();
        out.push(points.len() as f64);
        out.extend(points.iter().flat_map(|p| [p.0, p.1]));
    }
    out
}


/// The layout of the dataflow canvas (`layout::compute_dataflow_layout_with_routes`): boxes and edges in, the geometry
/// of the boxes out
#[wasm_bindgen]
pub struct DataflowLayout {
    config: dashql_dataflow::layout::DataflowLayoutConfig,
    boxes: Vec<dashql_dataflow::layout::DataflowLayoutBox>,
    edges: Vec<dashql_dataflow::layout::DataflowLayoutEdge>,
    geometry: Vec<dashql_dataflow::layout::DataflowBoxGeometry>,
    routes: Vec<dashql_dataflow::layout::DataflowEdgeRoute>,
}

#[wasm_bindgen]
impl DataflowLayout {
    #[wasm_bindgen(constructor)]
    pub fn new() -> DataflowLayout {
        DataflowLayout { config: Default::default(), boxes: Vec::new(), edges: Vec::new(), geometry: Vec::new(), routes: Vec::new() }
    }

    /// Set the sizes of the canvas, the defaults of the core otherwise
    #[wasm_bindgen(js_name = setConfig)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_config(
        &mut self,
        box_width: f64,
        chart_box_width: f64,
        header_height: f64,
        row_height: f64,
        row_padding: f64,
        chart_height: f64,
        layer_gap: f64,
        box_gap: f64,
        wrap_siblings: u32,
    ) {
        self.config = dashql_dataflow::layout::DataflowLayoutConfig {
            box_width,
            chart_box_width,
            header_height,
            row_height,
            row_padding,
            chart_height,
            layer_gap,
            box_gap,
            wrap_siblings: wrap_siblings as usize,
            ..self.config
        };
    }

    /// Set the width over the height that the parts of the graph are packed for, e.g. of the viewport
    #[wasm_bindgen(js_name = setAspectRatio)]
    pub fn set_aspect_ratio(&mut self, aspect_ratio: f64) {
        self.config.aspect_ratio = aspect_ratio;
    }

    /// Add a box, returns its index. A negative chart statement is absent, a width or a chart height that is not
    /// positive is the one of the config, the chart box width for a box with a chart, the box of an input does not
    /// tie its consumers into a fan-out. A hinted box is laid out from where it was, a dropped one from where the
    /// user dropped it.
    #[wasm_bindgen(js_name = addBox)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_box(
        &mut self,
        statements: u32,
        chart_statement: i32,
        collapsed: bool,
        width: f64,
        chart_height: f64,
        input: bool,
        hinted: bool,
        hint_x: f64,
        hint_y: f64,
        dropped: bool,
    ) -> u32 {
        self.boxes.push(dashql_dataflow::layout::DataflowLayoutBox {
            statements,
            chart_statement: u32::try_from(chart_statement).ok(),
            collapsed,
            width: (width > 0.0).then_some(width),
            chart_height: (chart_height > 0.0).then_some(chart_height),
            input,
            hint: hinted.then_some((hint_x, hint_y)),
            dropped,
        });
        (self.boxes.len() - 1) as u32
    }

    /// Add an edge between statements of two boxes
    #[wasm_bindgen(js_name = addEdge)]
    pub fn add_edge(&mut self, from_box: u32, from_statement: u32, to_box: u32, to_statement: u32) {
        self.edges.push(dashql_dataflow::layout::DataflowLayoutEdge { from_box, from_statement, to_box, to_statement });
    }

    /// Lay out the boxes, returns x, y, width and height of every box
    pub fn compute(&mut self) -> Vec<f64> {
        (self.geometry, self.routes) = dashql_dataflow::layout::compute_dataflow_layout_with_routes(&self.boxes, &self.edges, &self.config);
        self.geometry.iter().flat_map(|g| [g.x, g.y, g.width, g.height]).collect()
    }

    /// The routes of the edges between boxes after `compute` if the layout arranged every box: per route the box and
    /// statement of its source and of its target, the number of its points, and x and y of the points
    pub fn routes(&self) -> Vec<f64> {
        let mut out = Vec::new();
        for ((from, fs, to, ts), points) in &self.routes {
            out.extend([*from as f64, *fs as f64, *to as f64, *ts as f64, points.len() as f64]);
            out.extend(points.iter().flat_map(|p| [p.0, p.1]));
        }
        out
    }

    /// The tops of the statement rows of a box relative to the box, after `compute`
    pub fn rows(&self, index: u32) -> Vec<f64> {
        self.geometry.get(index as usize).map(|g| g.rows.clone()).unwrap_or_default()
    }
}

impl Default for DataflowLayout {
    fn default() -> Self {
        Self::new()
    }
}
