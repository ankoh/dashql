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
use std::ops::Range;

use super::geom::{Point, Rect, Side, EPS};

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
    (v.partition_point(|&x| x < lo - EPS), v.partition_point(|&x| x <= hi + EPS))
}

/// The range of lines strictly inside `(lo, hi)` (within [`EPS`]).
fn open(v: &[f32], lo: f32, hi: f32) -> (usize, usize) {
    (v.partition_point(|&x| x <= lo + EPS), v.partition_point(|&x| x < hi - EPS))
}

/// The index of the line at `x`, if there is one.
fn line_of(v: &[f32], x: f32) -> Option<usize> {
    let i = v.partition_point(|&a| a < x - EPS);
    v.get(i).is_some_and(|&a| (a - x).abs() <= EPS).then_some(i)
}

/// Marks the cells of `rows` and `columns` in a grid of `nx` columns.
fn mark(cells: &mut [bool], nx: usize, rows: Range<usize>, columns: Range<usize>) {
    for j in rows {
        if let Some(row) = cells.get_mut(j * nx + columns.start..j * nx + columns.end) {
            row.fill(true);
        }
    }
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
        let xs = lines(obstacles.iter().flat_map(|o| [o.min.x, o.max.x]).chain(points.iter().map(|p| p.x)).collect());
        let ys = lines(obstacles.iter().flat_map(|o| [o.min.y, o.max.y]).chain(points.iter().map(|p| p.y)).collect());
        let nx = xs.len();
        let n = nx * ys.len();
        let mut grid = Grid { blocked: vec![false; n], h_blocked: vec![false; n], v_blocked: vec![false; n], xs, ys };
        for o in obstacles {
            let (cxa, cxb) = closed(&grid.xs, o.min.x, o.max.x);
            let (cya, cyb) = closed(&grid.ys, o.min.y, o.max.y);
            let (oxa, oxb) = open(&grid.xs, o.min.x, o.max.x);
            let (oya, oyb) = open(&grid.ys, o.min.y, o.max.y);
            mark(&mut grid.h_blocked, nx, oya..oyb, cxa..cxb.saturating_sub(1));
            mark(&mut grid.blocked, nx, oya..oyb, oxa..oxb);
            mark(&mut grid.v_blocked, nx, cya..cyb.saturating_sub(1), oxa..oxb);
        }
        grid
    }

    fn nx(&self) -> usize {
        self.xs.len()
    }

    /// The vertices, the ones inside an obstacle too.
    fn vertices(&self) -> usize {
        self.blocked.len()
    }

    /// Whether `v` is a vertex outside every obstacle.
    fn free(&self, v: usize) -> bool {
        self.blocked.get(v) == Some(&false)
    }

    /// The column and the row of a vertex.
    fn cell(&self, v: usize) -> Option<(usize, usize)> {
        Some((v.checked_rem(self.nx())?, v.checked_div(self.nx())?))
    }

    /// The vertex at `p`, when `p` is on two lines and outside every
    /// obstacle.
    pub(crate) fn vertex(&self, p: Point) -> Option<usize> {
        let i = line_of(&self.xs, p.x)?;
        let j = line_of(&self.ys, p.y)?;
        let v = j * self.nx() + i;
        self.free(v).then_some(v)
    }

    /// Where a vertex is.
    pub(crate) fn point(&self, v: usize) -> Option<Point> {
        let (i, j) = self.cell(v)?;
        Some(Point::new(*self.xs.get(i)?, *self.ys.get(j)?))
    }

    /// The vertex next to `v` going `d`, when the way is free.
    fn step(&self, v: usize, d: Side) -> Option<usize> {
        let nx = self.nx();
        let (i, j) = self.cell(v)?;
        // The next vertex and whether the edge to it crosses an obstacle
        let (next, edge) = match d {
            Side::Left if i > 0 => (v - 1, self.h_blocked.get(v - 1)),
            Side::Right if i + 1 < nx => (v + 1, self.h_blocked.get(v)),
            Side::Top if j > 0 => (v - nx, self.v_blocked.get(v - nx)),
            Side::Bottom if j + 1 < self.ys.len() => (v + nx, self.v_blocked.get(v)),
            _ => return None,
        };
        (edge == Some(&false) && self.free(next)).then_some(next)
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
        other.f.total_cmp(&self.f).then_with(|| other.state.cmp(&self.state))
    }
}

impl PartialOrd for Open {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// What the search knows about a state.
#[derive(Clone, Copy, Debug)]
struct Node {
    /// The cost of the cheapest way to it so far.
    g: f32,
    /// The state it is reached from on that way.
    parent: u32,
    /// Whether its cheapest way is final.
    done: bool,
}

const NONE: u32 = u32::MAX;

impl Node {
    const UNSEEN: Node = Node { g: f32::INFINITY, parent: NONE, done: false };
}

/// The search's buffers, kept between searches.
#[derive(Clone, Debug, Default)]
pub(crate) struct Search {
    /// The states, by `vertex * 4 + direction`.
    nodes: Vec<Node>,
    heap: BinaryHeap<Open>,
}

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
        let states = grid.vertices() * 4;
        if states > NONE as usize {
            return None;
        }
        self.nodes.clear();
        self.nodes.resize(states, Node::UNSEEN);
        self.heap.clear();

        let target = grid.point(goal)?;
        let h = |p: Point| (p.x - target.x).abs() + (p.y - target.y).abs();
        let s0 = start * 4 + first.index();
        self.nodes.get_mut(s0)?.g = 0.0;
        self.heap.push(Open { f: h(grid.point(start)?), state: s0 as u32 });
        let mut best = (f32::INFINITY, NONE);
        while let Some(Open { f, state }) = self.heap.pop() {
            if f >= best.0 {
                break;
            }
            let s = state as usize;
            let Some(node) = self.nodes.get_mut(s).filter(|node| !node.done) else { continue };
            node.done = true;
            let g = node.g;
            let (v, d) = (s / 4, Side::from_index(s % 4));
            if v == goal {
                let total = g + if d == last { 0.0 } else { bend };
                if total < best.0 {
                    best = (total, state);
                }
                continue;
            }
            let Some(a) = grid.point(v) else { continue };
            for nd in Side::ALL {
                if nd == d.opposite() {
                    continue;
                }
                let Some(n) = grid.step(v, nd) else { continue };
                let Some(b) = grid.point(n) else { continue };
                let ns = n * 4 + nd.index();
                let Some(next) = self.nodes.get_mut(ns).filter(|next| !next.done) else { continue };
                let len = (a.x - b.x).abs() + (a.y - b.y).abs();
                let cost = g + len + if nd == d { 0.0 } else { bend };
                if cost < next.g {
                    next.g = cost;
                    next.parent = state;
                    self.heap.push(Open { f: cost + h(b), state: ns as u32 });
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
            s = self.nodes.get(s as usize).map_or(NONE, |node| node.parent);
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
        assert_eq!(lines(vec![2.0, 1.0, 1.0005, f32::NAN, 3.0]), vec![1.0, 2.0, 3.0]);
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
