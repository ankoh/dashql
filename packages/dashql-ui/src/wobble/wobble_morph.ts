/// Geometry of Wobble that morphs into the DashQL brand mark and back.
///
/// Morphs between arbitrary paths only look fluid when both shapes share one point structure, so the morph
/// does not interpolate path strings. The face is a disk split along its diagonal into two halves, the brand mark
/// has two pieces. Every half and every piece is resampled to the same number of points by arc length, with the
/// same winding, and the pieces are rotated to the start point that moves the points the least. A frame then blends
/// point by point. Everything is plain math in the 200x200 viewBox of the brand mark, without the DOM.

/// The size of the viewBox
export const VIEWBOX_SIZE = 200;
/// The points of every outline
export const OUTLINE_POINTS = 200;

/// The center and the radius of the face
const FACE_CENTER = 100;
const FACE_RADIUS = 70;
/// The halves reach past the diagonal by this angle, so the joined halves show no seam
const FACE_SEAM_OVERLAP = (3 * Math.PI) / 180;

/// The share of a spring overshoot past the face that moves the points
const FACE_OVERSHOOT = 0.3;

/// The two pieces of the DashQL brand mark, `static/svg/logo/dashql.svg`, with the transforms of their groups
const DASHQL_PIECE_UPPER: BrandShape = {
    d: 'M171.857,146.784C172.231,148.654 173.873,150 175.779,150C189.377,150 241.375,150 257.621,150C258.819,150 259.954,149.463 260.714,148.536C261.474,147.609 261.778,146.391 261.543,145.216C259.52,135.099 254.853,111.766 253.143,103.216C252.769,101.346 251.128,100 249.221,100C241.703,100 223.297,100 215.779,100C213.872,100 212.231,98.654 211.857,96.784C210.051,87.756 204.949,62.244 203.143,53.216C202.769,51.346 201.128,50 199.221,50C190.646,50 167.521,50 157.379,50C156.181,50 155.046,50.537 154.286,51.464C153.526,52.391 153.222,53.609 153.457,54.784C156.947,72.235 168.94,132.201 171.857,146.784Z',
    map: (x, y) => dashqlPoint(x, y, -12.5),
};
const DASHQL_PIECE_LOWER: BrandShape = {
    d: 'M38.457,104.784C38.222,103.609 38.526,102.391 39.286,101.464C40.046,100.537 41.181,100 42.379,100C58.625,100 110.623,100 124.221,100C126.127,100 127.769,101.346 128.143,103.216C131.06,117.799 143.053,177.765 146.543,195.216C146.778,196.391 146.474,197.609 145.714,198.536C144.954,199.463 143.819,200 142.621,200C132.479,200 109.354,200 100.779,200C98.872,200 97.231,198.654 96.857,196.784C95.051,187.756 89.949,162.244 88.143,153.216C87.769,151.346 86.128,150 84.221,150C76.703,150 58.297,150 50.779,150C48.872,150 47.231,148.654 46.857,146.784C45.147,138.234 40.48,114.901 38.457,104.784Z',
    map: (x, y) => dashqlPoint(x, y, 12.5),
};

/// The DashQL brand mark shrinks a little around the center of the viewBox, so that it does not tower over the disk
/// of the face it melts from.
const DASHQL_SCALE = 0.9;

/// Map a point of a DashQL piece into the viewBox, the transform chain of the logo file and the scale
function dashqlPoint(x: number, y: number, dx: number): [number, number] {
    const [px, py] = dashqlFilePoint(x, y, dx);
    const c = VIEWBOX_SIZE / 2;
    return [c + (px - c) * DASHQL_SCALE, c + (py - c) * DASHQL_SCALE];
}

/// Map a point of a DashQL piece into the viewBox of the logo file
function dashqlFilePoint(x: number, y: number, dx: number): [number, number] {
    // matrix(1.25,0,0,0.935,-61.401,253.25) ∘ translate(dx, 25)
    let px = 1.25 * (x + dx) - 61.401;
    let py = 0.935 * (y + 25) + 253.25;
    // matrix(0.8,0,0,1.06952,0,-16.3556)
    px = 0.8 * px;
    py = 1.06952 * py - 16.3556;
    // translate(0, -304.5)
    return [px, py - 304.5];
}

/// A cubic Bézier segment
type Cubic = [number, number, number, number, number, number, number, number];

/// Parse a closed path of absolute `M`, `C`, `Q`, `L` and `Z` commands into cubic segments
export function parseClosedPath(d: string): Cubic[] {
    const tokens = d.match(/[MCQLZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
    const segments: Cubic[] = [];
    let i = 0;
    let command = '';
    let startX = 0, startY = 0, x = 0, y = 0;
    const num = () => Number(tokens[i++]);
    while (i < tokens.length) {
        if (/^[a-z]$/i.test(tokens[i])) {
            command = tokens[i++];
        }
        switch (command) {
            case 'M':
                x = startX = num();
                y = startY = num();
                command = 'L';
                break;
            case 'L': {
                const nx = num(), ny = num();
                segments.push([x, y, x, y, nx, ny, nx, ny]);
                x = nx;
                y = ny;
                break;
            }
            case 'C': {
                const c = [num(), num(), num(), num(), num(), num()];
                segments.push([x, y, c[0], c[1], c[2], c[3], c[4], c[5]]);
                x = c[4];
                y = c[5];
                break;
            }
            case 'Q': {
                // A quadratic segment is a cubic with the control points two thirds towards the quadratic one
                const qx = num(), qy = num(), nx = num(), ny = num();
                segments.push([x, y, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
                x = nx;
                y = ny;
                break;
            }
            case 'Z':
                if (Math.hypot(x - startX, y - startY) > 1e-6) {
                    segments.push([x, y, x, y, startX, startY, startX, startY]);
                }
                x = startX;
                y = startY;
                command = '';
                break;
            default:
                throw new Error(`unsupported path command: ${command} in ${d}`);
        }
    }
    return segments;
}

/// Flatten cubic segments to a closed polyline, interleaved x and y, without repeating the start
function flattenCubics(segments: Cubic[], steps = 48): number[] {
    const out: number[] = [];
    for (const [x0, y0, x1, y1, x2, y2, x3, y3] of segments) {
        for (let s = 0; s < steps; ++s) {
            const t = s / steps, u = 1 - t;
            const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
            out.push(a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3);
        }
    }
    return out;
}

/// Resample a closed polyline to `n` points spaced evenly by arc length
export function resampleClosed(poly: ArrayLike<number>, n: number): Float64Array {
    const m = poly.length / 2;
    const cumulative = new Float64Array(m + 1);
    for (let i = 0; i < m; ++i) {
        const j = (i + 1) % m;
        cumulative[i + 1] = cumulative[i] + Math.hypot(poly[2 * j] - poly[2 * i], poly[2 * j + 1] - poly[2 * i + 1]);
    }
    const total = cumulative[m];
    const out = new Float64Array(2 * n);
    let k = 0;
    for (let i = 0; i < n; ++i) {
        const s = (i * total) / n;
        while (k < m - 1 && cumulative[k + 1] <= s) ++k;
        const j = (k + 1) % m;
        const span = cumulative[k + 1] - cumulative[k];
        const t = span > 0 ? (s - cumulative[k]) / span : 0;
        out[2 * i] = poly[2 * k] + (poly[2 * j] - poly[2 * k]) * t;
        out[2 * i + 1] = poly[2 * k + 1] + (poly[2 * j + 1] - poly[2 * k + 1]) * t;
    }
    return out;
}

/// The signed area of a closed outline, positive when clockwise on screen (y down)
export function signedArea(outline: ArrayLike<number>): number {
    const n = outline.length / 2;
    let area = 0;
    for (let i = 0; i < n; ++i) {
        const j = (i + 1) % n;
        area += outline[2 * i] * outline[2 * j + 1] - outline[2 * j] * outline[2 * i + 1];
    }
    return area / 2;
}

/// Reverse the point order of an outline
function reverseOutline(outline: Float64Array): Float64Array {
    const n = outline.length / 2;
    const out = new Float64Array(outline.length);
    for (let i = 0; i < n; ++i) {
        out[2 * i] = outline[2 * (n - 1 - i)];
        out[2 * i + 1] = outline[2 * (n - 1 - i) + 1];
    }
    return out;
}

/// The summed squared distances between `a[i]` and `b[(i + offset) % n]`
export function alignmentCost(a: ArrayLike<number>, b: ArrayLike<number>, offset: number): number {
    const n = a.length / 2;
    let cost = 0;
    for (let i = 0; i < n; ++i) {
        const j = (i + offset) % n;
        const dx = a[2 * i] - b[2 * j], dy = a[2 * i + 1] - b[2 * j + 1];
        cost += dx * dx + dy * dy;
    }
    return cost;
}

/// Rotate `b` to the start point that is closest to the points of `a`
export function alignOutline(a: ArrayLike<number>, b: Float64Array): { outline: Float64Array; offset: number } {
    const n = a.length / 2;
    let best = 0, bestCost = Infinity;
    for (let offset = 0; offset < n; ++offset) {
        const cost = alignmentCost(a, b, offset);
        if (cost < bestCost) {
            bestCost = cost;
            best = offset;
        }
    }
    const out = new Float64Array(b.length);
    for (let i = 0; i < n; ++i) {
        const j = (i + best) % n;
        out[2 * i] = b[2 * j];
        out[2 * i + 1] = b[2 * j + 1];
    }
    return { outline: out, offset: best };
}

/// A region of the face: arcs of the face outline, clockwise on screen, with chords from the end of one arc to the
/// start of the next. One arc and its chord is a half, two arcs are a horizontal band, one full turn is the disk.
interface FaceRegion {
    /// The arcs, [from, to] angles with from < to
    arcs: [number, number][];
    /// Per sample, the angle on an arc or NaN for a chord sample
    angles: Float64Array;
    /// Per chord sample, the arc whose end the chord leaves
    chordArc: Int32Array;
    /// Per chord sample, the position on the chord
    chordT: Float64Array;
}

/// Sample a face region evenly by length
function sampleFaceRegion(arcs: [number, number][], n: number): FaceRegion {
    const point = (angle: number): [number, number] => [FACE_RADIUS * Math.cos(angle), FACE_RADIUS * Math.sin(angle)];
    const edges: { arc: number; chord: boolean; length: number }[] = [];
    for (let k = 0; k < arcs.length; ++k) {
        const [from, to] = arcs[k];
        const next = arcs[(k + 1) % arcs.length][0];
        const [x0, y0] = point(to), [x1, y1] = point(next);
        edges.push({ arc: k, chord: false, length: FACE_RADIUS * (to - from) });
        edges.push({ arc: k, chord: true, length: Math.hypot(x1 - x0, y1 - y0) });
    }
    const total = edges.reduce((sum, edge) => sum + edge.length, 0);
    const angles = new Float64Array(n);
    const chordArc = new Int32Array(n);
    const chordT = new Float64Array(n);
    let e = 0, edgeStart = 0;
    for (let i = 0; i < n; ++i) {
        const s = (i * total) / n;
        while (e < edges.length - 1 && s >= edgeStart + edges[e].length) edgeStart += edges[e++].length;
        const edge = edges[e];
        const t = edge.length > 0 ? (s - edgeStart) / edge.length : 0;
        if (edge.chord) {
            angles[i] = NaN;
            chordArc[i] = edge.arc;
            chordT[i] = t;
        } else {
            const [from, to] = arcs[edge.arc];
            angles[i] = from + (to - from) * t;
        }
    }
    return { arcs, angles, chordArc, chordT };
}

/// A horizontal band of the face between two offsets from the center, in face radii in [-1, 1]
function faceBand(top: number, bottom: number): [number, number][] {
    const t = Math.asin(Math.max(-1, Math.min(1, top)));
    const b = Math.asin(Math.max(-1, Math.min(1, bottom)));
    // The right arc runs from the top to the bottom, the left arc back
    return [[t, b], [Math.PI - b, Math.PI - t]];
}

/// The radius wobble of the liquid face at an angle and a time in seconds
function wobbleRadius(angle: number, time: number, amount: number): number {
    if (amount === 0) return FACE_RADIUS;
    const w = 0.5 * Math.sin(3 * angle + 1.3 * time)
        + 0.3 * Math.sin(2 * angle - 0.9 * time + 1.7)
        + 0.2 * Math.sin(5 * angle + 2.1 * time + 0.4);
    const breath = 0.4 * Math.sin(0.8 * time);
    return FACE_RADIUS * (1 + amount * (w + breath));
}

/// Write the points of a face region at a time into `out`
function faceRegionPoints(region: FaceRegion, time: number, wobble: number, out: Float64Array) {
    const at = (angle: number): [number, number] => {
        const r = wobbleRadius(angle, time, wobble);
        return [FACE_CENTER + r * Math.cos(angle), FACE_CENTER + r * Math.sin(angle)];
    };
    const ends = region.arcs.map(([from, to]) => ({ from: at(from), to: at(to) }));
    for (let i = 0; i < region.angles.length; ++i) {
        const angle = region.angles[i];
        if (Number.isNaN(angle)) {
            const k = region.chordArc[i], t = region.chordT[i];
            const [x0, y0] = ends[k].to, [x1, y1] = ends[(k + 1) % ends.length].from;
            out[2 * i] = x0 + (x1 - x0) * t;
            out[2 * i + 1] = y0 + (y1 - y0) * t;
        } else {
            const [x, y] = at(angle);
            out[2 * i] = x;
            out[2 * i + 1] = y;
        }
    }
}

/// One morphing shape: a face region and the brand mark piece it turns into
export interface MorphPiece {
    /// The samples of the face region
    face: FaceRegion;
    /// The outline of the face region at rest
    faceRest: Float64Array;
    /// The outline of the brand mark piece, aligned to the face half
    logo: Float64Array;
    /// The exact path of the brand mark piece in the viewBox, drawn when the morph rests at the logo
    logoPath: string;
    /// Per point, the normalized travel distance in [0, 1]
    travel: Float64Array;
    /// The centroid of the brand mark piece, the ripple pushes away from it
    logoCenter: [number, number];
}

/// A closed outline of a brand mark, mapped into the viewBox
interface BrandShape {
    /// The path, absolute `M`, `C`, `L` and `Z` commands
    d: string;
    /// Map a point of the path into the viewBox
    map?: (x: number, y: number) => [number, number];
}

/// Build a piece of the brand mark in the viewBox, the outline and the exact path
function buildLogoPiece(piece: BrandShape, n: number): { outline: Float64Array; path: string } {
    const map = piece.map ?? ((x: number, y: number): [number, number] => [x, y]);
    const cubics = parseClosedPath(piece.d).map(c => {
        const out: number[] = [];
        for (let i = 0; i < 8; i += 2) out.push(...map(c[i], c[i + 1]));
        return out as Cubic;
    });
    let outline = resampleClosed(flattenCubics(cubics), n);
    if (signedArea(outline) < 0) outline = reverseOutline(outline);
    const f = (v: number) => Number(v.toFixed(3));
    let path = `M${f(cubics[0][0])},${f(cubics[0][1])}`;
    for (const c of cubics) path += `C${f(c[2])},${f(c[3])} ${f(c[4])},${f(c[5])} ${f(c[6])},${f(c[7])}`;
    return { outline, path: `${path}Z` };
}

/// Build a morph piece from a face region and a brand mark piece
function buildPiece(arcs: [number, number][], logoPiece: BrandShape, n: number): MorphPiece {
    const face = sampleFaceRegion(arcs, n);
    const faceRest = new Float64Array(2 * n);
    faceRegionPoints(face, 0, 0, faceRest);
    const built = buildLogoPiece(logoPiece, n);
    const { outline: logo } = alignOutline(faceRest, built.outline);
    const travel = new Float64Array(n);
    let maxTravel = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; ++i) {
        travel[i] = Math.hypot(logo[2 * i] - faceRest[2 * i], logo[2 * i + 1] - faceRest[2 * i + 1]);
        maxTravel = Math.max(maxTravel, travel[i]);
        cx += logo[2 * i] / n;
        cy += logo[2 * i + 1] / n;
    }
    for (let i = 0; i < n; ++i) travel[i] = maxTravel > 0 ? travel[i] / maxTravel : 0;
    return { face, faceRest, logo, logoPath: built.path, travel, logoCenter: [cx, cy] };
}

/// A shape cut out of the brand mark, revealed once the morph arrives at it
export interface BrandCutout {
    /// The path data
    d: string;
    /// The SVG transform into the viewBox
    transform: string;
}

/// A brand mark Wobble morphs into
export interface WobbleBrand {
    /// The id of the brand
    id: string;
    /// The morphing shapes, every one starts as a region of the face
    pieces: readonly MorphPiece[];
    /// The shapes cut out of the brand mark, like the eyes are cut out of the face
    cutouts: readonly BrandCutout[];
}

/// The DashQL brand mark, `static/svg/logo/dashql.svg`.
/// The upper right face half turns into the upper right piece of the brand mark, the lower left half into the
/// lower left piece. The diagonal runs from the top left to the bottom right.
export const DASHQL_BRAND: WobbleBrand = {
    id: 'dashql',
    pieces: [
        buildPiece([[(5 * Math.PI) / 4 - FACE_SEAM_OVERLAP, (9 * Math.PI) / 4 + FACE_SEAM_OVERLAP]], DASHQL_PIECE_UPPER, OUTLINE_POINTS),
        buildPiece([[Math.PI / 4 - FACE_SEAM_OVERLAP, (5 * Math.PI) / 4 + FACE_SEAM_OVERLAP]], DASHQL_PIECE_LOWER, OUTLINE_POINTS),
    ],
    cutouts: [],
};

/// The Hyper logo, the brand mark of Database.com in the one color of the face, `static/favicons/hyper/favicon.svg`.
/// The shapes run from top to bottom: the top of the cylinder and the three rings below it.
const HYPER_SHAPES = [
    'M68.788,44.394C105.304,44.394 134.879,34.691 134.879,22.7C134.879,10.723 105.304,1 68.788,1C32.314,1.014 2.725,10.723 2.725,22.7C2.725,34.691 32.314,44.394 68.788,44.394Z',
    'M134.77,30.012C133.436,41.618 104.459,50.888 68.788,50.888C33.138,50.888 4.181,41.618 2.848,30.026C1.688,32.122 1,34.321 1,36.595L1,57.066C1,72.919 31.366,85.748 68.788,85.748C106.252,85.748 136.611,72.919 136.611,57.066L136.611,36.595C136.611,34.321 135.93,32.122 134.769,30.012Z',
    'M68.788,92.798C36.966,92.798 10.311,83.514 3.04,70.994C1.756,73.2 1,75.481 1,77.859L1,98.357C1,114.189 31.366,127.032 68.788,127.032C106.252,127.032 136.611,114.189 136.611,98.357L136.611,77.859C136.611,75.481 135.855,73.2 134.577,70.994C127.286,83.514 100.645,92.798 68.788,92.798Z',
    'M68.788,134.172C36.966,134.172 10.311,124.888 3.04,112.389C1.756,114.567 1,116.856 1,119.226L1,139.738C1,155.57 31.366,168.399 68.788,168.399C106.252,168.399 136.611,155.57 136.611,139.738L136.611,119.226C136.611,116.856 135.855,114.567 134.577,112.389C127.286,124.888 100.645,134.172 68.788,134.172Z',
];
const HYPER_BOUNDS = { minX: 1, maxX: 136.611, minY: 1, maxY: 168.399 };
/// The logo is higher than the disk of the face, it shrinks to about the height of the disk
const HYPER_SCALE = 0.84;
const hyperPoint = (x: number, y: number): [number, number] => [
    VIEWBOX_SIZE / 2 + (x - (HYPER_BOUNDS.minX + HYPER_BOUNDS.maxX) / 2) * HYPER_SCALE,
    VIEWBOX_SIZE / 2 + (y - (HYPER_BOUNDS.minY + HYPER_BOUNDS.maxY) / 2) * HYPER_SCALE,
];

/// The face splits into horizontal bands from top to bottom, one per shape of the logo. The bands end halfway between
/// the centers of two neighboring shapes, mapped from the height of the logo onto the height of the face.
function dbcomBrand(): WobbleBrand {
    const centers = HYPER_SHAPES.map(d => {
        const ys = parseClosedPath(d).flatMap(c => [c[1], c[7]]);
        return (Math.min(...ys) + Math.max(...ys)) / 2;
    });
    const toFace = (y: number) => -1 + (2 * (y - HYPER_BOUNDS.minY)) / (HYPER_BOUNDS.maxY - HYPER_BOUNDS.minY);
    const bounds = [-1, ...centers.slice(1).map((c, i) => toFace((centers[i] + c) / 2)), 1];
    // The bands overlap a little, so the joined bands show no seam
    const overlap = 0.04;
    return {
        id: 'dbcom',
        pieces: HYPER_SHAPES.map((d, i) => buildPiece(
            faceBand(bounds[i] - (i > 0 ? overlap : 0), bounds[i + 1] + (i < HYPER_SHAPES.length - 1 ? overlap : 0)),
            { d, map: hyperPoint },
            OUTLINE_POINTS,
        )),
        cutouts: [],
    };
}
export const DBCOM_BRAND: WobbleBrand = dbcomBrand();

/// The parameters of one frame of the morph
export interface MorphFrame {
    /// The morph progress, 0 is the face and 1 is the brand mark, a spring can overshoot both ends
    progress: number;
    /// The time in seconds, drives the wobble and the ripple
    time: number;
    /// The radius wobble of the face, relative to the radius
    wobble: number;
    /// The share of the progress by which the points that travel the least start later, in [0, 1)
    lag: number;
    /// The amplitude of the ripple along the outline while the shape travels, in viewBox units
    ripple: number;
}

/// Compute the points of a piece for a frame into `out`, `scratch` holds the face points
export function morphPoints(piece: MorphPiece, frame: MorphFrame, out: Float64Array, scratch: Float64Array) {
    const n = piece.travel.length;
    faceRegionPoints(piece.face, frame.time, frame.wobble, scratch);
    const lag = Math.min(Math.max(frame.lag, 0), 0.95);
    const x = frame.progress;
    for (let i = 0; i < n; ++i) {
        // Points that travel far lead, points that travel little follow
        const delay = lag * (1 - piece.travel[i]);
        // An overshoot past the face only jiggles it, the halves would otherwise part at the seam
        const q = x < 0 ? FACE_OVERSHOOT * x : x < delay ? 0 : (x - delay) / (1 - delay);
        let px = scratch[2 * i] + (piece.logo[2 * i] - scratch[2 * i]) * q;
        let py = scratch[2 * i + 1] + (piece.logo[2 * i + 1] - scratch[2 * i + 1]) * q;
        if (frame.ripple !== 0) {
            // A wave runs along the outline while the point is in transit, away from the center of the piece
            const transit = Math.sin(Math.PI * Math.min(Math.max(q, 0), 1));
            if (transit > 0) {
                const dx = px - piece.logoCenter[0], dy = py - piece.logoCenter[1];
                const len = Math.hypot(dx, dy) || 1;
                const wave = frame.ripple * transit * Math.sin((6 * Math.PI * i) / n + 5 * frame.time);
                px += (dx / len) * wave;
                py += (dy / len) * wave;
            }
        }
        out[2 * i] = px;
        out[2 * i + 1] = py;
    }
}

/// Write an outline as a closed polygon path
export function outlinePath(outline: ArrayLike<number>): string {
    const n = outline.length / 2;
    const parts = new Array<string>(n);
    for (let i = 0; i < n; ++i) {
        parts[i] = `${outline[2 * i].toFixed(2)} ${outline[2 * i + 1].toFixed(2)}`;
    }
    return `M${parts.join('L')}Z`;
}

/// The bounding box of an outline, [minX, minY, maxX, maxY]
export function outlineBounds(outline: ArrayLike<number>): [number, number, number, number] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < outline.length; i += 2) {
        minX = Math.min(minX, outline[i]);
        maxX = Math.max(maxX, outline[i]);
        minY = Math.min(minY, outline[i + 1]);
        maxY = Math.max(maxY, outline[i + 1]);
    }
    return [minX, minY, maxX, maxY];
}

/// A damped spring toward a target, stepped with the frame time
export interface Spring {
    value: number;
    velocity: number;
}

/// Step a spring by `dt` seconds, in small substeps so that stiff springs stay stable
export function stepSpring(spring: Spring, target: number, stiffness: number, damping: number, dt: number) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let s = 0; s < steps; ++s) {
        const accel = -stiffness * (spring.value - target) - damping * spring.velocity;
        spring.velocity += accel * h;
        spring.value += spring.velocity * h;
    }
}

/// Is the spring at rest at its target
export function springAtRest(spring: Spring, target: number): boolean {
    return Math.abs(spring.value - target) < 1e-3 && Math.abs(spring.velocity) < 1e-2;
}
