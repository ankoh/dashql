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

/// The sizes of the dataflow canvas (`layout::DataflowLayoutConfig`), the one place where they are set
#[wasm_bindgen]
pub struct DataflowConfig {
    #[wasm_bindgen(js_name = boxWidth)]
    pub box_width: f64,
    #[wasm_bindgen(js_name = chartBoxWidth)]
    pub chart_box_width: f64,
    #[wasm_bindgen(js_name = inputBoxWidth)]
    pub input_box_width: f64,
    #[wasm_bindgen(js_name = headerHeight)]
    pub header_height: f64,
    #[wasm_bindgen(js_name = rowHeight)]
    pub row_height: f64,
    #[wasm_bindgen(js_name = rowPadding)]
    pub row_padding: f64,
    #[wasm_bindgen(js_name = chartHeight)]
    pub chart_height: f64,
    #[wasm_bindgen(js_name = minBoxWidth)]
    pub min_box_width: f64,
    #[wasm_bindgen(js_name = maxBoxWidth)]
    pub max_box_width: f64,
    #[wasm_bindgen(js_name = minChartHeight)]
    pub min_chart_height: f64,
    #[wasm_bindgen(js_name = maxChartHeight)]
    pub max_chart_height: f64,
    #[wasm_bindgen(js_name = layerGap)]
    pub layer_gap: f64,
    #[wasm_bindgen(js_name = boxGap)]
    pub box_gap: f64,
    #[wasm_bindgen(js_name = edgeGap)]
    pub edge_gap: f64,
    #[wasm_bindgen(js_name = edgeBoxGap)]
    pub edge_box_gap: f64,
    pub grid: f64,
}

/// The sizes of the dataflow canvas
#[wasm_bindgen(js_name = dataflowConfig)]
pub fn dataflow_config() -> DataflowConfig {
    let c = dashql_dataflow::layout::DataflowLayoutConfig::default();
    DataflowConfig {
        box_width: c.box_width,
        chart_box_width: c.chart_box_width,
        input_box_width: c.input_box_width,
        header_height: c.header_height,
        row_height: c.row_height,
        row_padding: c.row_padding,
        chart_height: c.chart_height,
        min_box_width: c.min_box_width,
        max_box_width: c.max_box_width,
        min_chart_height: c.min_chart_height,
        max_chart_height: c.max_chart_height,
        layer_gap: c.layer_gap,
        box_gap: c.box_gap,
        edge_gap: c.edge_gap,
        edge_box_gap: c.edge_box_gap,
        grid: c.grid,
    }
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
    for route in route_edges(&boxes, &edges, &dashql_dataflow::layout::DataflowLayoutConfig::default()) {
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

    /// Add a box, returns its index. A negative chart statement is absent, a width or a chart height that is not
    /// positive is the one of the config, the chart box width for a box with a chart, the input box width for an
    /// input, which does not tie its consumers into a fan-out. A hinted box is laid out from where it was, a dropped one from where the
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
