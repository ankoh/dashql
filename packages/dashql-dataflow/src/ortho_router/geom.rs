//! Plain geometry: points, rectangles and the four sides.

/// Coordinates closer than this are the same line (in the caller's
/// units, typically pixels or points).
pub(crate) const EPS: f32 = 1e-3;

/// A point.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    /// The abscissa.
    pub x: f32,
    /// The ordinate.
    pub y: f32,
}

impl Point {
    /// A point at `x`, `y`.
    pub const fn new(x: f32, y: f32) -> Point {
        Point { x, y }
    }

    /// Whether both coordinates are finite.
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }

    /// The point moved `d` along a side's outward direction.
    pub(crate) fn toward(self, side: Side, d: f32) -> Point {
        let (dx, dy) = side.direction();
        Point::new(self.x + dx * d, self.y + dy * d)
    }

    /// Whether two points are the same within [`EPS`].
    pub(crate) fn near(self, other: Point) -> bool {
        (self.x - other.x).abs() <= EPS && (self.y - other.y).abs() <= EPS
    }
}

impl From<[f32; 2]> for Point {
    fn from([x, y]: [f32; 2]) -> Point {
        Point::new(x, y)
    }
}

impl From<(f32, f32)> for Point {
    fn from((x, y): (f32, f32)) -> Point {
        Point::new(x, y)
    }
}

impl From<Point> for [f32; 2] {
    fn from(p: Point) -> [f32; 2] {
        [p.x, p.y]
    }
}

/// An axis-aligned rectangle, from its smallest to its largest corner.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    /// The corner with the smallest coordinates.
    pub min: Point,
    /// The corner with the largest coordinates.
    pub max: Point,
}

impl Rect {
    /// The rectangle between two corners, in any order.
    pub fn from_corners(a: impl Into<Point>, b: impl Into<Point>) -> Rect {
        let (a, b) = (a.into(), b.into());
        Rect {
            min: Point::new(a.x.min(b.x), a.y.min(b.y)),
            max: Point::new(a.x.max(b.x), a.y.max(b.y)),
        }
    }

    /// The rectangle at `min` of this width and height.
    pub fn from_min_size(min: impl Into<Point>, width: f32, height: f32) -> Rect {
        let min = min.into();
        Rect::from_corners(min, Point::new(min.x + width, min.y + height))
    }

    /// Its width.
    pub fn width(&self) -> f32 {
        self.max.x - self.min.x
    }

    /// Its height.
    pub fn height(&self) -> f32 {
        self.max.y - self.min.y
    }

    /// Whether its corners are finite and in order.
    pub fn is_valid(&self) -> bool {
        self.min.is_finite()
            && self.max.is_finite()
            && self.min.x <= self.max.x
            && self.min.y <= self.max.y
    }

    /// The rectangle grown by `d` on every side.
    pub fn expand(&self, d: f32) -> Rect {
        Rect {
            min: Point::new(self.min.x - d, self.min.y - d),
            max: Point::new(self.max.x + d, self.max.y + d),
        }
    }
}

/// The side of a node a port leaves from: a connector's first segment
/// goes out that way, and its last segment comes in from that way.
///
/// `Top` is toward smaller `y` and `Bottom` toward larger `y`, as on a
/// screen where `y` grows downward; with `y` growing upward, swap them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Side {
    /// Toward smaller `x`.
    Left,
    /// Toward larger `x`.
    Right,
    /// Toward smaller `y`.
    Top,
    /// Toward larger `y`.
    Bottom,
}

impl Side {
    /// The unit vector pointing out of the node.
    pub fn direction(self) -> (f32, f32) {
        match self {
            Side::Left => (-1.0, 0.0),
            Side::Right => (1.0, 0.0),
            Side::Top => (0.0, -1.0),
            Side::Bottom => (0.0, 1.0),
        }
    }

    /// The opposite side.
    pub fn opposite(self) -> Side {
        match self {
            Side::Left => Side::Right,
            Side::Right => Side::Left,
            Side::Top => Side::Bottom,
            Side::Bottom => Side::Top,
        }
    }

    /// Whether a segment leaving this side is horizontal.
    pub fn is_horizontal(self) -> bool {
        matches!(self, Side::Left | Side::Right)
    }

    /// Its index as a search direction (0 to 3).
    pub(crate) fn index(self) -> usize {
        self as usize
    }

    pub(crate) const ALL: [Side; 4] = [Side::Left, Side::Right, Side::Top, Side::Bottom];
}
