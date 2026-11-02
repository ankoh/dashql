//! Routes: straight when clear, around one obstacle, through a
//! corridor, the fallback when boxed in, port sides, and determinism.

use super::{Connector, Options, Point, Port, Rect, Route, Router, Side};

fn rect(x: f32, y: f32, w: f32, h: f32) -> Rect {
    Rect::from_min_size([x, y], w, h)
}

fn right(x: f32, y: f32) -> Port {
    Port::new([x, y], Side::Right)
}

fn left(x: f32, y: f32) -> Port {
    Port::new([x, y], Side::Left)
}

fn router(obstacles: &[Rect]) -> Router {
    Router::new(Options::default()).with_obstacles(obstacles.iter().copied())
}

/// Every segment is horizontal or vertical.
fn assert_orthogonal(route: &Route) {
    for w in route.points.windows(2) {
        assert!(
            w[0].x == w[1].x || w[0].y == w[1].y,
            "a slanted segment: {:?}",
            route.points
        );
    }
}

/// No segment enters an obstacle's inside, except within `slack` of
/// the route's own ports.
fn assert_clear(route: &Route, obstacles: &[Rect]) {
    let inside = |o: &Rect, p: Point| {
        p.x > o.min.x + 0.01 && p.x < o.max.x - 0.01 && p.y > o.min.y + 0.01 && p.y < o.max.y - 0.01
    };
    for w in route.points.windows(2) {
        for k in 0..=32 {
            let t = k as f32 / 32.0;
            let p = Point::new(
                w[0].x + (w[1].x - w[0].x) * t,
                w[0].y + (w[1].y - w[0].y) * t,
            );
            for o in obstacles {
                assert!(!inside(o, p), "{p:?} is inside {o:?}: {:?}", route.points);
            }
        }
    }
}

#[test]
fn a_clear_line_is_one_straight_segment() {
    let nodes = [rect(0.0, 0.0, 100.0, 60.0), rect(300.0, 0.0, 100.0, 60.0)];
    let wire = Connector::new(right(100.0, 30.0), left(300.0, 30.0));
    let route = router(&nodes).route(&wire);
    assert!(route.routed);
    assert_eq!(route.points, vec![wire.from.at, wire.to.at]);
    assert_eq!(route.bends(), 0);
    assert_eq!(route.length(), 200.0);
}

#[test]
fn offset_ports_take_two_bends() {
    let nodes = [rect(0.0, 0.0, 100.0, 60.0), rect(300.0, 100.0, 100.0, 60.0)];
    let wire = Connector::new(right(100.0, 30.0), left(300.0, 130.0));
    let route = router(&nodes).route(&wire);
    assert!(route.routed);
    assert_eq!(route.bends(), 2);
    assert_orthogonal(&route);
    assert_clear(&route, &nodes);
    // Out to the right, in from the left.
    assert!(route.points[1].x > wire.from.at.x);
    assert!(route.points[route.points.len() - 2].x < wire.to.at.x);
}

#[test]
fn a_node_in_the_way_is_gone_around() {
    let nodes = [
        rect(0.0, 0.0, 100.0, 60.0),
        rect(400.0, 0.0, 100.0, 60.0),
        rect(200.0, -40.0, 100.0, 140.0),
    ];
    let wire = Connector::new(right(100.0, 30.0), left(400.0, 30.0));
    let route = router(&nodes).route(&wire);
    assert!(route.routed);
    assert_orthogonal(&route);
    assert_clear(&route, &nodes);
    assert_eq!(route.bends(), 4);
    // At the margin's distance, above or below the wall.
    let margin = Options::default().margin;
    assert!(
        route
            .points
            .iter()
            .any(|p| p.y == -40.0 - margin || p.y == 100.0 + margin),
        "{:?}",
        route.points
    );
}

#[test]
fn a_corridor_between_two_nodes_is_taken() {
    // A wall with a gap: the route goes through the gap rather than
    // around the whole wall.
    let nodes = [
        rect(0.0, 0.0, 100.0, 60.0),
        rect(600.0, 400.0, 100.0, 60.0),
        rect(250.0, -1000.0, 100.0, 1200.0),
        rect(250.0, 260.0, 100.0, 1000.0),
    ];
    let wire = Connector::new(right(100.0, 30.0), left(600.0, 430.0));
    let route = router(&nodes).route(&wire);
    assert!(route.routed);
    assert_orthogonal(&route);
    assert_clear(&route, &nodes);
    let through = route
        .points
        .windows(2)
        .any(|w| w[0].y == w[1].y && w[0].y > 200.0 && w[0].y < 260.0);
    assert!(through, "not through the gap: {:?}", route.points);
    assert!(route.length() < 1200.0);
}

#[test]
fn a_backward_wire_goes_around_its_own_nodes() {
    // The input is left of the output: out right, around, in from the
    // left, never through either node.
    let nodes = [rect(300.0, 0.0, 100.0, 60.0), rect(0.0, 0.0, 100.0, 60.0)];
    let wire = Connector::new(right(400.0, 30.0), left(0.0, 30.0));
    let route = router(&nodes).route(&wire);
    assert!(route.routed);
    assert_orthogonal(&route);
    assert_clear(&route, &nodes);
    assert!(route.points[1].x > 400.0);
    assert!(route.points[route.points.len() - 2].x < 0.0);
}

#[test]
fn top_and_bottom_ports_leave_vertically() {
    let nodes = [rect(0.0, 0.0, 100.0, 60.0), rect(0.0, 200.0, 100.0, 60.0)];
    let wire = Connector::new(
        Port::new([50.0, 60.0], Side::Bottom),
        Port::new([50.0, 200.0], Side::Top),
    );
    let route = router(&nodes).route(&wire);
    assert!(route.routed);
    assert_eq!(route.points, vec![wire.from.at, wire.to.at]);
}

#[test]
fn a_boxed_in_port_falls_back_to_one_elbow() {
    // The second node is walled in on every side.
    let target = rect(400.0, 0.0, 100.0, 60.0);
    let nodes = [
        rect(0.0, 0.0, 100.0, 60.0),
        target,
        rect(340.0, -60.0, 220.0, 40.0),
        rect(340.0, 80.0, 220.0, 40.0),
        rect(340.0, -60.0, 40.0, 180.0),
        rect(520.0, -60.0, 40.0, 180.0),
    ];
    let wire = Connector::new(right(100.0, 30.0), left(400.0, 50.0));
    let route = router(&nodes).route(&wire);
    assert!(!route.routed);
    assert_orthogonal(&route);
    assert_eq!(route.points.first(), Some(&wire.from.at));
    assert_eq!(route.points.last(), Some(&wire.to.at));
    // Out, one elbow halfway, in: the stubs merge into its arms.
    assert_eq!(route.bends(), 2);
    assert_eq!(route.points[1].x, 250.0);
}

#[test]
fn a_coordinate_that_is_not_finite_falls_back_to_a_segment() {
    let wire = Connector::new(right(f32::NAN, 0.0), left(10.0, 0.0));
    let route = router(&[]).route(&wire);
    assert!(!route.routed);
    assert_eq!(route.points.len(), 2);
}

#[test]
fn routes_are_deterministic() {
    let (nodes, wires) = rows_and_columns();
    let mut a = router(&nodes);
    let first = a.route_all(&wires);
    let again = a.route_all(&wires);
    let fresh = router(&nodes).route_all(&wires);
    assert_eq!(first, again);
    assert_eq!(first, fresh);
    for r in &first {
        assert!(r.routed);
        assert_orthogonal(r);
        assert_clear(r, &nodes);
    }
}

#[test]
fn wires_sharing_a_channel_are_spread_apart() {
    let (nodes, wires) = rows_and_columns();
    let routes = router(&nodes).route_all(&wires);
    for (i, ri) in routes.iter().enumerate() {
        for rj in &routes[i + 1..] {
            for a in inner_segments(ri) {
                for b in inner_segments(rj) {
                    assert!(!overlap(a, b), "{a:?} on top of {b:?}");
                }
            }
        }
    }
    for r in &routes {
        assert_orthogonal(r);
        assert_clear(r, &nodes);
    }
}

/// A route's segments that may move: not those at its ports.
fn inner_segments(r: &Route) -> Vec<(Point, Point)> {
    let n = r.points.len();
    (1..n.saturating_sub(2))
        .map(|k| (r.points[k], r.points[k + 1]))
        .collect()
}

/// Whether two segments lie on one line and share a stretch of it.
fn overlap(a: (Point, Point), b: (Point, Point)) -> bool {
    let horizontal = |s: (Point, Point)| s.0.y == s.1.y;
    if horizontal(a) != horizontal(b) {
        return false;
    }
    // Along the segments, and across.
    let uv = |p: Point| {
        if horizontal(a) {
            (p.x, p.y)
        } else {
            (p.y, p.x)
        }
    };
    let ((a0, va), (a1, _)) = (uv(a.0), uv(a.1));
    let ((b0, vb), (b1, _)) = (uv(b.0), uv(b.1));
    if (va - vb).abs() > 1e-3 {
        return false;
    }
    let lo = a0.min(a1).max(b0.min(b1));
    let hi = a0.max(a1).min(b0.max(b1));
    hi - lo > 1e-3
}

/// Six rows of five nodes, each node wired to one in the next column.
fn rows_and_columns() -> (Vec<Rect>, Vec<Connector>) {
    let nodes: Vec<Rect> = (0..6)
        .flat_map(|r| (0..5).map(move |c| rect(c as f32 * 240.0, r as f32 * 130.0, 180.0, 70.0)))
        .collect();
    let wires: Vec<Connector> = (0..6)
        .flat_map(|r| {
            (0..4).map(move |c| {
                let y = r as f32 * 130.0;
                let to_row = (r + c) % 6;
                Connector::new(
                    right(c as f32 * 240.0 + 180.0, y + 35.0),
                    left((c + 1) as f32 * 240.0, to_row as f32 * 130.0 + 35.0),
                )
            })
        })
        .collect();
    (nodes, wires)
}

#[test]
fn a_batch_routes_like_single_calls() {
    let nodes = [
        rect(0.0, 0.0, 100.0, 60.0),
        rect(0.0, 120.0, 100.0, 60.0),
        rect(300.0, 60.0, 100.0, 60.0),
    ];
    let wires = [
        Connector::new(right(100.0, 30.0), left(300.0, 80.0)),
        Connector::new(right(100.0, 150.0), left(300.0, 100.0)),
    ];
    let mut r = router(&nodes);
    let batch = r.route_all(&wires);
    for (w, b) in wires.iter().zip(&batch) {
        let one = r.route(w);
        assert!(one.routed && b.routed);
        assert_eq!(one.bends(), b.bends());
        assert_eq!(one.length(), b.length());
    }
}

#[test]
fn the_fingerprint_follows_the_layout() {
    let nodes = [rect(0.0, 0.0, 100.0, 60.0)];
    let wires = [Connector::new(right(100.0, 30.0), left(300.0, 30.0))];
    let r = router(&nodes);
    let key = r.fingerprint(&wires);
    assert_eq!(key, router(&nodes).fingerprint(&wires));
    assert_ne!(
        key,
        router(&[rect(0.0, 0.0, 100.0, 61.0)]).fingerprint(&wires)
    );
    let moved = [Connector::new(right(100.0, 31.0), left(300.0, 30.0))];
    assert_ne!(key, r.fingerprint(&moved));
    let mut wider = router(&nodes);
    wider.set_options(Options {
        margin: 20.0,
        ..Options::default()
    });
    assert_ne!(key, wider.fingerprint(&wires));
}

#[test]
fn invalid_obstacles_are_ignored() {
    let bad = Rect {
        min: Point::new(10.0, 10.0),
        max: Point::new(f32::INFINITY, 0.0),
    };
    let r = router(&[bad]);
    assert!(r.obstacles().is_empty());
}
