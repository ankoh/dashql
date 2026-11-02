//! Orthogonal routes of the edges of the dataflow canvas around its boxes, for the edges that the layout did not
//! route: the edges of a box that was moved, or of a box that another box was moved onto.
//!
//! An edge leaves the right border of its source box and enters the left border of its target box, at the rows of
//! their statements. ortho-router builds a grid of the lines through the boxes grown by a margin and the stubs of
//! the ports, searches the shortest route with few bends through it, and spreads routes that share a channel apart.

use crate::dataflow_layout::{DataflowBoxGeometry, DataflowEdgeRoute, DataflowLayoutConfig, DataflowLayoutEdge};
use ortho_router::{Connector, Options, Point, Port, Rect, Router, Side};
use std::collections::BTreeSet;

/// The clearance between a route and a box, and the length of the straight stub out of a port
pub const ROUTE_MARGIN: f64 = 12.0;
/// The distance between routes that share a channel
pub const ROUTE_SPACING: f64 = 6.0;
/// What a bend costs, as a length
pub const ROUTE_BEND_PENALTY: f64 = 40.0;

/// A box that routes go around
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RouteBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// An edge to route: from a point on the right border of a box to a point on the left border of a box
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RouteRequestEdge {
    pub from: (f64, f64),
    pub to: (f64, f64),
}

/// Route edges around boxes as polylines of horizontal and vertical segments, `None` for an edge without a way
/// around the boxes
pub fn route_edges(boxes: &[RouteBox], edges: &[RouteRequestEdge]) -> Vec<Option<Vec<(f64, f64)>>> {
    let point = |(x, y): (f64, f64)| Point { x: x as f32, y: y as f32 };
    let mut router = Router::new(Options { margin: ROUTE_MARGIN as f32, bend_penalty: ROUTE_BEND_PENALTY as f32, spacing: ROUTE_SPACING as f32 })
        .with_obstacles(boxes.iter().map(|b| Rect::from_min_size(point((b.x, b.y)), b.width as f32, b.height as f32)));
    let connectors: Vec<Connector> = edges.iter().map(|e| Connector::new(Port::new(point(e.from), Side::Right), Port::new(point(e.to), Side::Left))).collect();
    router
        .route_all(&connectors)
        .into_iter()
        .map(|route| route.routed.then(|| route.points.iter().map(|p| (p.x as f64, p.y as f64)).collect()))
        .collect()
}

/// Route the edges between statements of laid out boxes like the canvas does for moved boxes
pub fn route_dataflow_edges(geometry: &[DataflowBoxGeometry], edges: &[DataflowLayoutEdge], config: &DataflowLayoutConfig) -> Vec<DataflowEdgeRoute> {
    let boxes: Vec<RouteBox> = geometry.iter().map(|g| RouteBox { x: g.x, y: g.y, width: g.width, height: g.height }).collect();
    let unique: Vec<(u32, u32, u32, u32)> = edges
        .iter()
        .filter(|e| e.from_box != e.to_box)
        .map(|e| (e.from_box, e.from_statement, e.to_box, e.to_statement))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let requests: Vec<RouteRequestEdge> = unique
        .iter()
        .map(|&(from, fs, to, ts)| {
            let (f, t) = (&geometry[from as usize], &geometry[to as usize]);
            RouteRequestEdge { from: (f.x + f.width, f.y + f.port(fs, config)), to: (t.x, t.y + t.port(ts, config)) }
        })
        .collect();
    route_edges(&boxes, &requests).into_iter().zip(unique).map(|(points, edge)| (edge, points.unwrap_or_default())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> RouteBox {
        RouteBox { x, y, width, height }
    }

    /// Does a polyline pass through the inside of a box?
    fn crosses(points: &[(f64, f64)], b: &RouteBox) -> bool {
        points.windows(2).any(|w| {
            let (x0, x1) = (w[0].0.min(w[1].0), w[0].0.max(w[1].0));
            let (y0, y1) = (w[0].1.min(w[1].1), w[0].1.max(w[1].1));
            x0 < b.x + b.width && x1 > b.x && y0 < b.y + b.height && y1 > b.y
        })
    }

    #[test]
    fn routes_around_a_box_in_the_way_with_right_angles() {
        let boxes = [rect(0.0, 0.0, 100.0, 60.0), rect(200.0, 0.0, 100.0, 60.0), rect(400.0, 0.0, 100.0, 60.0)];
        let routes = route_edges(&boxes, &[RouteRequestEdge { from: (100.0, 30.0), to: (400.0, 30.0) }]);
        let points = routes[0].as_ref().expect("a route");
        assert_eq!(points.first(), Some(&(100.0, 30.0)));
        assert_eq!(points.last(), Some(&(400.0, 30.0)));
        assert!(!crosses(points, &boxes[1]));
        assert!(points.windows(2).all(|w| w[0].0 == w[1].0 || w[0].1 == w[1].1));
    }

    #[test]
    fn routes_back_to_a_box_on_the_left_around_both() {
        let boxes = [rect(0.0, 0.0, 100.0, 60.0), rect(200.0, 0.0, 100.0, 60.0)];
        let routes = route_edges(&boxes, &[RouteRequestEdge { from: (300.0, 30.0), to: (0.0, 30.0) }]);
        let points = routes[0].as_ref().expect("a route");
        assert!(points.iter().any(|p| p.1 < 0.0 || p.1 > 60.0));
        assert!(points.windows(2).all(|w| w[0].0 == w[1].0 || w[0].1 == w[1].1));
    }
}
