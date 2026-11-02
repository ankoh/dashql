//! The routing grid and the search over it.
//!
//! The grid is the Hanan grid of the obstacles grown by the margin: one
//! vertical line through each grown obstacle's left and right edges and
//! through each port's stub end, one horizontal line through each top
//! and bottom edge and each stub end. Its vertices are where the lines
//! cross, its edges join neighbouring vertices along a line. No obstacle
//! edge lies strictly between two neighbouring lines, so a grid edge
//! either crosses an obstacle's interior over its whole length or not at
//! all, and an edge along an obstacle's boundary is free: routes run
//! along the margin lines, at the margin's distance from the nodes.
//!
//! A route is a shortest path in that grid where each turn costs
//! [`Options::bend_penalty`](super::Options::bend_penalty) on top of the
//! length: A* over (vertex, direction) states, with the Manhattan
//! distance to the goal as its heuristic (a lower bound, since a bend
//! never costs less than nothing).

use std::cmp::Ordering;
use std::collections::BinaryHeap;

use super::geom::{EPS, Point, Rect, Side};

/// Sorted distinct coordinates, those within [`EPS`] of the previous
/// one dropped.
fn lines(mut v: Vec<f32>) -> Vec<f32> {
    v.retain(|x| x.is_finite());
    v.sort_by(f32::total_cmp);
    let mut out: Vec<f32> = Vec::with_capacity(v.len());
    for x in v {
        if out.last().is_none_or(|l| x - l > EPS) {
            out.push(x);
        }
    }
    out
}

/// The range of lines in `[lo, hi]` (within [`EPS`]).
fn closed(v: &[f32], lo: f32, hi: f32) -> (usize, usize) {
    (
        v.partition_point(|&x| x < lo - EPS),
        v.partition_point(|&x| x <= hi + EPS),
    )
}

/// The range of lines strictly inside `(lo, hi)` (within [`EPS`]).
fn open(v: &[f32], lo: f32, hi: f32) -> (usize, usize) {
    (
        v.partition_point(|&x| x <= lo + EPS),
        v.partition_point(|&x| x < hi - EPS),
    )
}

/// The index of the line at `x`, if there is one.
fn line_of(v: &[f32], x: f32) -> Option<usize> {
    let i = v.partition_point(|&a| a < x - EPS);
    (i < v.len() && (v[i] - x).abs() <= EPS).then_some(i)
}

/// The routing grid.
#[derive(Clone, Debug, Default)]
pub(crate) struct Grid {
    xs: Vec<f32>,
    ys: Vec<f32>,
    /// Vertices strictly inside an obstacle, by `j * nx + i`.
    blocked: Vec<bool>,
    /// Edges from `(i, j)` to `(i + 1, j)` through an obstacle.
    h_blocked: Vec<bool>,
    /// Edges from `(i, j)` to `(i, j + 1)` through an obstacle.
    v_blocked: Vec<bool>,
}

impl Grid {
    /// The grid of grown obstacles, with lines through `points` too.
    pub(crate) fn build(obstacles: &[Rect], points: &[Point]) -> Grid {
        let xs = lines(
            obstacles
                .iter()
                .flat_map(|o| [o.min.x, o.max.x])
                .chain(points.iter().map(|p| p.x))
                .collect(),
        );
        let ys = lines(
            obstacles
                .iter()
                .flat_map(|o| [o.min.y, o.max.y])
                .chain(points.iter().map(|p| p.y))
                .collect(),
        );
        let nx = xs.len();
        let n = nx * ys.len();
        let mut grid = Grid {
            blocked: vec![false; n],
            h_blocked: vec![false; n],
            v_blocked: vec![false; n],
            xs,
            ys,
        };
        for o in obstacles {
            let (cxa, cxb) = closed(&grid.xs, o.min.x, o.max.x);
            let (cya, cyb) = closed(&grid.ys, o.min.y, o.max.y);
            let (oxa, oxb) = open(&grid.xs, o.min.x, o.max.x);
            let (oya, oyb) = open(&grid.ys, o.min.y, o.max.y);
            for j in oya..oyb {
                for i in cxa..cxb.saturating_sub(1) {
                    grid.h_blocked[j * nx + i] = true;
                }
                for i in oxa..oxb {
                    grid.blocked[j * nx + i] = true;
                }
            }
            for i in oxa..oxb {
                for j in cya..cyb.saturating_sub(1) {
                    grid.v_blocked[j * nx + i] = true;
                }
            }
        }
        grid
    }

    fn nx(&self) -> usize {
        self.xs.len()
    }

    /// The vertex at `p`, when `p` is on two lines and outside every
    /// obstacle.
    pub(crate) fn vertex(&self, p: Point) -> Option<usize> {
        let i = line_of(&self.xs, p.x)?;
        let j = line_of(&self.ys, p.y)?;
        let v = j * self.nx() + i;
        (!self.blocked[v]).then_some(v)
    }

    /// Where a vertex is.
    pub(crate) fn point(&self, v: usize) -> Point {
        Point::new(self.xs[v % self.nx()], self.ys[v / self.nx()])
    }

    /// The vertex next to `v` going `d`, when the way is free.
    fn step(&self, v: usize, d: Side) -> Option<usize> {
        let nx = self.nx();
        let (i, j) = (v % nx, v / nx);
        let next = match d {
            Side::Left if i > 0 && !self.h_blocked[v - 1] => v - 1,
            Side::Right if i + 1 < nx && !self.h_blocked[v] => v + 1,
            Side::Top if j > 0 && !self.v_blocked[v - nx] => v - nx,
            Side::Bottom if j + 1 < self.ys.len() && !self.v_blocked[v] => v + nx,
            _ => return None,
        };
        (!self.blocked[next]).then_some(next)
    }
}

/// An open state, the cheapest estimate first.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Open {
    f: f32,
    state: u32,
}

impl Eq for Open {}

impl Ord for Open {
    fn cmp(&self, other: &Self) -> Ordering {
        // A max-heap: reversed, and ties broken by the state so the
        // order (and the route) only depends on the input.
        other
            .f
            .total_cmp(&self.f)
            .then_with(|| other.state.cmp(&self.state))
    }
}

impl PartialOrd for Open {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// The search's buffers, kept between searches.
#[derive(Clone, Debug, Default)]
pub(crate) struct Search {
    g: Vec<f32>,
    parent: Vec<u32>,
    done: Vec<bool>,
    heap: BinaryHeap<Open>,
}

const NONE: u32 = u32::MAX;

impl Search {
    /// The cheapest path from `start`, leaving in direction `first`, to
    /// `goal`, arriving in direction `last`: its vertices, from `start`
    /// to `goal`. `None` when `goal` cannot be reached.
    pub(crate) fn find(
        &mut self,
        grid: &Grid,
        start: usize,
        first: Side,
        goal: usize,
        last: Side,
        bend: f32,
    ) -> Option<Vec<usize>> {
        let states = grid.blocked.len() * 4;
        if states > NONE as usize {
            return None;
        }
        self.g.clear();
        self.g.resize(states, f32::INFINITY);
        self.parent.clear();
        self.parent.resize(states, NONE);
        self.done.clear();
        self.done.resize(states, false);
        self.heap.clear();

        let target = grid.point(goal);
        let h = |v: usize| {
            let p = grid.point(v);
            (p.x - target.x).abs() + (p.y - target.y).abs()
        };
        let s0 = start * 4 + first.index();
        self.g[s0] = 0.0;
        self.heap.push(Open {
            f: h(start),
            state: s0 as u32,
        });
        let mut best = (f32::INFINITY, NONE);
        while let Some(Open { f, state }) = self.heap.pop() {
            if f >= best.0 {
                break;
            }
            let s = state as usize;
            if self.done[s] {
                continue;
            }
            self.done[s] = true;
            let (v, d) = (s / 4, Side::ALL[s % 4]);
            let g = self.g[s];
            if v == goal {
                let total = g + if d == last { 0.0 } else { bend };
                if total < best.0 {
                    best = (total, state);
                }
                continue;
            }
            for nd in Side::ALL {
                if nd == d.opposite() {
                    continue;
                }
                let Some(n) = grid.step(v, nd) else { continue };
                let ns = n * 4 + nd.index();
                if self.done[ns] {
                    continue;
                }
                let (a, b) = (grid.point(v), grid.point(n));
                let len = (a.x - b.x).abs() + (a.y - b.y).abs();
                let cost = g + len + if nd == d { 0.0 } else { bend };
                if cost < self.g[ns] {
                    self.g[ns] = cost;
                    self.parent[ns] = state;
                    self.heap.push(Open {
                        f: cost + h(n),
                        state: ns as u32,
                    });
                }
            }
        }
        if best.1 == NONE {
            return None;
        }
        let mut path = Vec::new();
        let mut s = best.1;
        while s != NONE {
            path.push(s as usize / 4);
            s = self.parent[s as usize];
        }
        path.reverse();
        Some(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_coordinates_make_one_line() {
        assert_eq!(
            lines(vec![2.0, 1.0, 1.0005, f32::NAN, 3.0]),
            vec![1.0, 2.0, 3.0]
        );
    }

    #[test]
    fn an_obstacle_blocks_its_inside_and_frees_its_edges() {
        let o = Rect::from_corners([0.0, 0.0], [10.0, 10.0]);
        let g = Grid::build(&[o], &[Point::new(5.0, 5.0), Point::new(20.0, 20.0)]);
        // The centre is inside.
        assert!(g.vertex(Point::new(5.0, 5.0)).is_none());
        // A corner is on the edge: free, and so is the way along it.
        let corner = g.vertex(Point::new(0.0, 0.0)).unwrap();
        assert!(g.step(corner, Side::Right).is_some());
        assert!(g.step(corner, Side::Bottom).is_some());
        // Going in from the middle of an edge is blocked.
        let mid = g.vertex(Point::new(5.0, 0.0)).unwrap();
        assert!(g.step(mid, Side::Bottom).is_none());
        assert!(g.step(mid, Side::Top).is_none(), "no line above");
    }
}
