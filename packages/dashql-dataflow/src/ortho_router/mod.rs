//! Orthogonal connector routing around rectangular obstacles: right-angled routes between ports on the sides of
//! boxes, with few bends, and routes that share a channel spread apart.
//!
//! Vendored from ortho-router 0.1.0 (https://crates.io/crates/ortho-router, part of
//! https://github.com/quazardous/egui-pop), MIT license (`LICENSE-MIT`, NOTICE). Changed: the crate root is this
//! module, its tests are `tests.rs`, and it indexes no slice (the safety lints of the crate): the grid and the search
//! look up their cells with `get`, the search keeps one `Node` per state. The router keeps only the API that the
//! layout calls: no cache key, no setters, no single-route call.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod geom;
mod grid;
mod nudge;

pub use geom::{Point, Rect, Side};

use geom::EPS;
use grid::{Grid, Search};

/// A connector's end: a point on a node's edge and the side it leaves
/// from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Port {
    /// Where the connector starts or ends, normally on its node's edge.
    pub at: Point,
    /// The side of the node the port is on: the connector leaves (or
    /// comes in) at a right angle to it.
    pub side: Side,
}

impl Port {
    /// A port at `at` on the `side` of its node.
    pub fn new(at: impl Into<Point>, side: Side) -> Port {
        Port { at: at.into(), side }
    }
}

/// A connector to route, from one port to another.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Connector {
    /// Where it starts.
    pub from: Port,
    /// Where it ends.
    pub to: Port,
}

impl Connector {
    /// A connector from `from` to `to`.
    pub fn new(from: Port, to: Port) -> Connector {
        Connector { from, to }
    }
}

/// How routes are drawn. The distances are in the caller's units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Options {
    /// How far routes keep from obstacles (default 12). It is also the
    /// length of the straight stub a route leaves a port with.
    pub margin: f32,
    /// What a bend costs, as a length (default 40): the higher, the
    /// fewer bends at the price of longer routes.
    pub bend_penalty: f32,
    /// How far apart [`Router::route_all`] spreads wires that share a
    /// channel (default 6; 0 leaves them on top of each other). A group
    /// spreads over the margin at most, so with many wires in one
    /// channel they come closer than this.
    pub spacing: f32,
}

impl Default for Options {
    fn default() -> Options {
        Options { margin: 12.0, bend_penalty: 40.0, spacing: 6.0 }
    }
}

/// A routed connector: a polyline of horizontal and vertical segments.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Route {
    /// Its vertices, from the first port to the second, without
    /// repeated or collinear points.
    pub points: Vec<Point>,
    /// `false` when no way around the obstacles was found: `points` is
    /// then the fallback, a stub out of each port joined by a single
    /// elbow (orthogonal, but it may cross obstacles). A connector with
    /// a coordinate that is not finite falls back to the straight
    /// segment between its ports.
    pub routed: bool,
}

/// Routes connectors around obstacles.
#[derive(Clone, Debug, Default)]
pub struct Router {
    obstacles: Vec<Rect>,
    options: Options,
    search: Search,
}

impl Router {
    /// A router with these options and no obstacles.
    pub fn new(options: Options) -> Router {
        Router { options, ..Router::default() }
    }

    /// The router with these obstacles, typically the nodes' rectangles.
    /// A rectangle that is not [valid](Rect::is_valid) is ignored.
    pub fn with_obstacles(mut self, obstacles: impl IntoIterator<Item = Rect>) -> Router {
        self.obstacles = obstacles.into_iter().filter(Rect::is_valid).collect();
        self
    }

    /// Routes connectors, in order: the routes match `connectors`.
    ///
    /// The connectors share one grid, built from the obstacles and every
    /// connector's ports, so routing many at once costs little more than
    /// routing one. Then wires sharing a channel are spread
    /// [`spacing`](Options::spacing) apart: their segments on one line
    /// move across it, the segments at the ports excepted.
    pub fn route_all(&mut self, connectors: &[Connector]) -> Vec<Route> {
        let margin = self.options.margin.max(0.0);
        let bend = self.options.bend_penalty.max(0.0);
        let grown: Vec<Rect> = self.obstacles.iter().map(|o| o.expand(margin)).collect();
        let stubs: Vec<Point> = connectors
            .iter()
            .flat_map(|c| [stub(&c.from, margin), stub(&c.to, margin)])
            .filter(|p| p.is_finite())
            .collect();
        let grid = Grid::build(&grown, &stubs);
        let mut routes: Vec<Route> =
            connectors.iter().map(|c| route_in(&grid, &mut self.search, c, margin, bend)).collect();
        nudge::nudge(&mut routes, self.options.spacing, margin);
        routes
    }
}

/// Where a route leaving `port` turns for the first time at the
/// earliest: `margin` out of the port.
fn stub(port: &Port, margin: f32) -> Point {
    port.at.toward(port.side, margin)
}

/// One connector over the grid, or its fallback.
fn route_in(grid: &Grid, search: &mut Search, c: &Connector, margin: f32, bend: f32) -> Route {
    let (a, b) = (c.from.at, c.to.at);
    if !a.is_finite() || !b.is_finite() {
        return Route { points: vec![a, b], routed: false };
    }
    let (sa, sb) = (stub(&c.from, margin), stub(&c.to, margin));
    let path = grid
        .vertex(sa)
        .zip(grid.vertex(sb))
        .and_then(|(va, vb)| {
            // The route arrives going into the second port's node.
            search.find(grid, va, c.from.side, vb, c.to.side.opposite(), bend)
        })
        .and_then(|path| path.into_iter().map(|v| grid.point(v)).collect::<Option<Vec<Point>>>());
    match path {
        Some(path) => {
            Route { points: simplify(std::iter::once(a).chain(path).chain(std::iter::once(b))), routed: true }
        }
        None => Route { points: simplify(fallback(a, sa, c.from.side, sb, b)), routed: false },
    }
}

/// A stub out of each port joined by one elbow, halfway across.
fn fallback(a: Point, sa: Point, side: Side, sb: Point, b: Point) -> [Point; 6] {
    let (p, q) = if side.is_horizontal() {
        let x = (sa.x + sb.x) / 2.0;
        (Point::new(x, sa.y), Point::new(x, sb.y))
    } else {
        let y = (sa.y + sb.y) / 2.0;
        (Point::new(sa.x, y), Point::new(sb.x, y))
    };
    [a, sa, p, q, sb, b]
}

/// The points without repeats and without the middle of three on one
/// line.
fn simplify(points: impl IntoIterator<Item = Point>) -> Vec<Point> {
    let mut out: Vec<Point> = Vec::new();
    for p in points {
        if out.last().is_some_and(|l| l.near(p)) {
            continue;
        }
        if let [.., u, v] = out[..] {
            let vertical = (u.x - v.x).abs() <= EPS && (v.x - p.x).abs() <= EPS;
            let horizontal = (u.y - v.y).abs() <= EPS && (v.y - p.y).abs() <= EPS;
            if vertical || horizontal {
                out.pop();
            }
        }
        out.push(p);
    }
    out
}

#[cfg(test)]
mod tests;
