//! Nudging: routes found one by one share the grid's lines, so wires
//! through one channel are drawn on top of each other. Afterwards,
//! segments of different routes that lie on one line and overlap are
//! spread apart across it, `spacing` apart and centred on the line.
//!
//! A segment moves as a whole, across its own direction: its two
//! neighbours are perpendicular to it, so they only grow or shrink and
//! the route stays orthogonal. A route's first and last segments are
//! left in place, since they hold its ports. The spread is at most the
//! margin (half of it on each side of the line), so a nudged segment
//! keeps at least half the margin away from the obstacles.
//!
//! Within a group, segments are ordered so the spreading adds as few
//! crossings as it can. Take vertical segments, ordered left to right:
//! each has a top end and a bottom end, where it turns left or right.
//! A segment turning left at both ends goes left of one turning right
//! at both; between two turning the same way at the top, the one whose
//! top is lower goes on that side (so its turn does not cut the other
//! one), and between two turning the same way at the bottom, the one
//! whose bottom is higher goes on that side. Horizontal segments are
//! ordered the same way with the axes swapped. Ties keep the
//! connectors' order.

use super::Route;
use super::geom::{EPS, Point};

/// A segment eligible for nudging.
#[derive(Clone, Copy, Debug)]
struct Seg {
    /// The route and the index of the segment's first point.
    route: usize,
    k: usize,
    horizontal: bool,
    /// Its line: `y` when horizontal, else `x`.
    at: f32,
    lo: f32,
    hi: f32,
    /// Its place across the line, smallest first.
    key: (f32, f32),
}

/// Spreads overlapping collinear segments of `routes` apart.
pub(crate) fn nudge(routes: &mut [Route], spacing: f32, margin: f32) {
    if spacing <= 0.0 || !spacing.is_finite() {
        return;
    }
    let mut segs = segments(routes);
    segs.sort_by(|a, b| {
        a.horizontal
            .cmp(&b.horizontal)
            .then(a.at.total_cmp(&b.at))
            .then(a.lo.total_cmp(&b.lo))
            .then(a.route.cmp(&b.route))
            .then(a.k.cmp(&b.k))
    });
    // Shifts, decided on the routes as found, then applied.
    let mut shifts: Vec<(usize, usize, bool, f32)> = Vec::new();
    let mut start = 0;
    while start < segs.len() {
        // A group: one line, and each segment overlapping the span of
        // those before it.
        let first = segs[start];
        let mut end = start + 1;
        let mut hi = first.hi;
        while end < segs.len() {
            let s = segs[end];
            if s.horizontal != first.horizontal || (s.at - first.at).abs() > EPS || s.lo >= hi - EPS
            {
                break;
            }
            hi = hi.max(s.hi);
            end += 1;
        }
        let group = &mut segs[start..end];
        start = end;
        let routes_in = {
            let mut r: Vec<usize> = group.iter().map(|s| s.route).collect();
            r.dedup();
            r.len()
        };
        if group.len() < 2 || routes_in < 2 {
            continue;
        }
        group.sort_by(|a, b| {
            a.key
                .0
                .total_cmp(&b.key.0)
                .then(a.key.1.total_cmp(&b.key.1))
                .then(a.route.cmp(&b.route))
        });
        let n = group.len() as f32;
        let step = spacing.min(margin.max(0.0) / (n - 1.0));
        for (m, s) in group.iter().enumerate() {
            let off = (m as f32 - (n - 1.0) / 2.0) * step;
            if off != 0.0 {
                shifts.push((s.route, s.k, s.horizontal, off));
            }
        }
    }
    for (r, k, horizontal, off) in shifts {
        let points = &mut routes[r].points;
        for p in &mut points[k..k + 2] {
            if horizontal {
                p.y += off;
            } else {
                p.x += off;
            }
        }
    }
}

/// The routes' segments that may move: not a route's first or last,
/// and only of routes found around the obstacles.
fn segments(routes: &[Route]) -> Vec<Seg> {
    let mut out = Vec::new();
    for (r, route) in routes.iter().enumerate() {
        if !route.routed {
            continue;
        }
        let p = &route.points;
        for k in 1..p.len().saturating_sub(2) {
            let (a, b) = (p[k], p[k + 1]);
            let (before, after) = (p[k - 1], p[k + 2]);
            let horizontal = (a.y - b.y).abs() <= EPS;
            // Along the segment `u`, across it `v`.
            let uv = |p: Point| if horizontal { (p.x, p.y) } else { (p.y, p.x) };
            let ((ua, va), (ub, _)) = (uv(a), uv(b));
            // Which way it turns at an end: -1 toward smaller `v`.
            let turn = |end: Point, next: Point| (uv(next).1 - uv(end).1).signum();
            let (ta, tb) = (turn(a, before), turn(b, after));
            // The first end (smaller `u`) and the second.
            let ((u1, t1), (u2, t2)) = if ua <= ub {
                ((ua, ta), (ub, tb))
            } else {
                ((ub, tb), (ua, ta))
            };
            out.push(Seg {
                route: r,
                k,
                horizontal,
                at: va,
                lo: u1,
                hi: u2,
                key: (t1 + t2, t1 * u1 - t2 * u2),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(points: &[[f32; 2]]) -> Route {
        Route {
            points: points.iter().map(|&p| Point::from(p)).collect(),
            routed: true,
        }
    }

    #[test]
    fn two_wires_down_one_channel_are_spread_apart() {
        // Both go down x = 50 between y = 0 and y = 100.
        let mut routes = vec![
            route(&[[0.0, 0.0], [50.0, 0.0], [50.0, 100.0], [100.0, 100.0]]),
            route(&[[0.0, 20.0], [50.0, 20.0], [50.0, 120.0], [100.0, 120.0]]),
        ];
        nudge(&mut routes, 6.0, 12.0);
        let x0 = routes[0].points[1].x;
        let x1 = routes[1].points[1].x;
        // The second turns in lower at the top and out lower at the
        // bottom: on the left, it crosses neither turn of the first.
        assert_eq!(x0 - x1, 6.0);
        assert_eq!(x0 + x1, 100.0, "centred on the line");
        for r in &routes {
            assert_eq!(r.points[1].x, r.points[2].x, "still vertical");
            assert_eq!(r.points[0], Point::new(0.0, r.points[0].y));
        }
    }

    #[test]
    fn the_spread_is_at_most_the_margin() {
        let mut routes: Vec<Route> = (0..5)
            .map(|i| {
                let y = i as f32 * 10.0;
                route(&[[0.0, y], [50.0, y], [50.0, y + 100.0], [100.0, y + 100.0]])
            })
            .collect();
        nudge(&mut routes, 6.0, 8.0);
        let xs: Vec<f32> = routes.iter().map(|r| r.points[1].x).collect();
        let (lo, hi) = xs
            .iter()
            .fold((f32::MAX, f32::MIN), |(l, h), &x| (l.min(x), h.max(x)));
        assert!(hi - lo <= 8.0 + 1e-4, "{xs:?}");
    }

    #[test]
    fn segments_that_do_not_overlap_stay() {
        let mut routes = vec![
            route(&[[0.0, 0.0], [50.0, 0.0], [50.0, 40.0], [100.0, 40.0]]),
            route(&[[0.0, 60.0], [50.0, 60.0], [50.0, 100.0], [100.0, 100.0]]),
        ];
        let before = routes.clone();
        nudge(&mut routes, 6.0, 12.0);
        assert_eq!(routes, before);
    }

    #[test]
    fn ports_never_move() {
        let mut routes = vec![
            route(&[[0.0, 0.0], [100.0, 0.0]]),
            route(&[[0.0, 0.0], [100.0, 0.0]]),
        ];
        let before = routes.clone();
        nudge(&mut routes, 6.0, 12.0);
        assert_eq!(routes, before);
    }
}
