/// Geometry of the agent face that morphs into the DashQL brand mark and back.
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

/// The DashQL brand mark grows a little around the center of the viewBox, so that the face does not seem to lose
/// mass when it melts into it. The two pieces cover about as much as the disk of the face.
const DASHQL_SCALE = 1.06;

/// Map a point of a DashQL piece into the viewBox, the transform chain of the logo file and the growth
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
/// start of the next. One arc and its chord is a half, two arcs are a vertical slice, one full turn is the disk.
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

/// A vertical slice of the face between two offsets from the center, in face radii in [-1, 1]
function faceSlice(left: number, right: number): [number, number][] {
    const l = Math.acos(Math.max(-1, Math.min(1, left)));
    const r = Math.acos(Math.max(-1, Math.min(1, right)));
    // The top arc runs from the left to the right, the bottom arc back
    return [[-l, -r], [r, l]];
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

/// A brand mark the face morphs into
export interface AgentFaceBrand {
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
export const DASHQL_BRAND: AgentFaceBrand = {
    id: 'dashql',
    pieces: [
        buildPiece([[(5 * Math.PI) / 4 - FACE_SEAM_OVERLAP, (9 * Math.PI) / 4 + FACE_SEAM_OVERLAP]], DASHQL_PIECE_UPPER, OUTLINE_POINTS),
        buildPiece([[Math.PI / 4 - FACE_SEAM_OVERLAP, (5 * Math.PI) / 4 + FACE_SEAM_OVERLAP]], DASHQL_PIECE_LOWER, OUTLINE_POINTS),
    ],
    cutouts: [],
};

/// The SIDB wordmark, `static/svg/logo/sidb.svg`, glyph outlines of Bricolage Grotesque ExtraBold.
/// Every outer contour is a piece, the D is a stem and a bowl, the counters of the B are cut out.
const SIDB_WORDMARK = { minX: 39, maxX: 2270, centerY: -330 };
/// The wordmark is wider than the viewBox, the face would otherwise seem to lose mass when it melts into the letters
const SIDB_WIDTH = 204;
const SIDB_SCALE = SIDB_WIDTH / (SIDB_WORDMARK.maxX - SIDB_WORDMARK.minX);
const SIDB_DX = (VIEWBOX_SIZE - SIDB_WIDTH) / 2 - SIDB_WORDMARK.minX * SIDB_SCALE;
const SIDB_DY = VIEWBOX_SIZE / 2 - SIDB_WORDMARK.centerY * SIDB_SCALE;
const sidbPoint = (x: number, y: number): [number, number] => [SIDB_DX + x * SIDB_SCALE, SIDB_DY + y * SIDB_SCALE];
const SIDB_S = 'M331,14Q267,14 215,2Q163,-10 125,-34.5Q87,-59 65,-97Q43,-135 39,-185L180,-232Q183,-190 204,-162Q225,-134 260.5,-120.5Q296,-107 340,-107Q382,-107 410.5,-117.5Q439,-128 453.5,-144.5Q468,-161 468,-180Q468,-202 449,-216.5Q430,-231 397,-241.5Q364,-252 320,-262Q270,-274 222,-288Q174,-302 135,-324.5Q96,-347 73.5,-382.5Q51,-418 51,-472Q51,-533 82,-578Q113,-623 173,-648.5Q233,-674 321,-674Q408,-674 469,-649Q530,-624 563,-579.5Q596,-535 599,-476L455,-435Q455,-464 445.5,-486Q436,-508 419,-522.5Q402,-537 377,-544.5Q352,-552 320,-552Q282,-552 255.5,-543Q229,-534 216,-519.5Q203,-505 203,-486Q203,-462 223.5,-446.5Q244,-431 279.5,-420.5Q315,-410 358,-400Q401,-391 447,-377.5Q493,-364 533,-342Q573,-320 597.5,-282.5Q622,-245 622,-188Q622,-127 589.5,-81.5Q557,-36 492,-11Q427,14 331,14Z';
const SIDB_I = 'M712,0L712,-660L876,-660L876,0L712,0Z';
const SIDB_D_BOWL = 'M1075,0L1075,-130L1266,-130Q1318,-130 1353,-152Q1388,-174 1405.5,-218Q1423,-262 1423,-328Q1423,-381 1412,-419Q1401,-457 1379.5,-481.5Q1358,-506 1324.5,-518Q1291,-530 1246,-530L1075,-530L1075,-660L1240,-660Q1363,-660 1441,-621Q1519,-582 1555,-509.5Q1591,-437 1591,-336Q1591,-258 1572.5,-201Q1554,-144 1522,-105.5Q1490,-67 1448.5,-43.5Q1407,-20 1361.5,-10Q1316,0 1271,0L1075,0Z';
const SIDB_D_STEM = 'M1000,0L1000,-660L1161,-660L1161,0L1000,0Z';
const SIDB_B = 'M1690,0L1690,-660L1975,-660Q2037,-660 2086.5,-649.5Q2136,-639 2171,-617.5Q2206,-596 2224.5,-562.5Q2243,-529 2243,-483Q2243,-444 2226.5,-415Q2210,-386 2175,-368Q2140,-350 2082,-344L2082,-327Q2178,-321 2224,-281Q2270,-241 2270,-173Q2270,-115 2239,-77Q2208,-39 2148,-19.5Q2088,0 2000,0L1690,0Z';
const SIDB_B_COUNTERS = 'M1844,-128L1994,-128Q2055,-128 2084,-145.5Q2113,-163 2113,-201Q2113,-243 2078,-264Q2043,-285 1971,-285L1844,-285L1844,-128ZM1844,-383L1949,-383Q2020,-383 2053,-402.5Q2086,-422 2086,-461Q2086,-499 2055.5,-516.5Q2025,-534 1963,-534L1844,-534L1844,-383Z';

/// The face splits into vertical slices from left to right, one per piece of the wordmark. The slices end halfway
/// between the centers of two neighboring pieces, mapped from the width of the wordmark onto the width of the face.
function sidbBrand(): AgentFaceBrand {
    const glyphs = [SIDB_S, SIDB_I, SIDB_D_STEM, SIDB_D_BOWL, SIDB_B];
    const centers = glyphs.map(d => {
        const xs = parseClosedPath(d).flatMap(c => [c[0], c[6]]);
        return (Math.min(...xs) + Math.max(...xs)) / 2;
    });
    const toFace = (x: number) => -1 + (2 * (x - SIDB_WORDMARK.minX)) / (SIDB_WORDMARK.maxX - SIDB_WORDMARK.minX);
    const bounds = [-1, ...centers.slice(1).map((c, i) => toFace((centers[i] + c) / 2)), 1];
    // The slices overlap a little, so the joined slices show no seam
    const overlap = 0.04;
    return {
        id: 'sidb',
        pieces: glyphs.map((d, i) => buildPiece(
            faceSlice(bounds[i] - (i > 0 ? overlap : 0), bounds[i + 1] + (i < glyphs.length - 1 ? overlap : 0)),
            { d, map: sidbPoint },
            OUTLINE_POINTS,
        )),
        cutouts: [{ d: SIDB_B_COUNTERS, transform: `translate(${SIDB_DX} ${SIDB_DY}) scale(${SIDB_SCALE})` }],
    };
}
export const SIDB_BRAND: AgentFaceBrand = sidbBrand();

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
