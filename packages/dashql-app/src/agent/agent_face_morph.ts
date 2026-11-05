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
const FACE_RADIUS = 78;
/// The halves reach past the diagonal by this angle, so the joined halves show no seam
const FACE_SEAM_OVERLAP = (3 * Math.PI) / 180;

/// The share of a spring overshoot past the face that moves the points
const FACE_OVERSHOOT = 0.3;

/// The two pieces of the brand mark, `static/svg/logo/dashql.svg`, with the translation of their group.
/// The nested group transforms of the file nearly collapse to a translation per piece, the scales cancel out.
const LOGO_PIECE_UPPER = {
    d: 'M171.857,146.784C172.231,148.654 173.873,150 175.779,150C189.377,150 241.375,150 257.621,150C258.819,150 259.954,149.463 260.714,148.536C261.474,147.609 261.778,146.391 261.543,145.216C259.52,135.099 254.853,111.766 253.143,103.216C252.769,101.346 251.128,100 249.221,100C241.703,100 223.297,100 215.779,100C213.872,100 212.231,98.654 211.857,96.784C210.051,87.756 204.949,62.244 203.143,53.216C202.769,51.346 201.128,50 199.221,50C190.646,50 167.521,50 157.379,50C156.181,50 155.046,50.537 154.286,51.464C153.526,52.391 153.222,53.609 153.457,54.784C156.947,72.235 168.94,132.201 171.857,146.784Z',
    dx: -12.5,
};
const LOGO_PIECE_LOWER = {
    d: 'M38.457,104.784C38.222,103.609 38.526,102.391 39.286,101.464C40.046,100.537 41.181,100 42.379,100C58.625,100 110.623,100 124.221,100C126.127,100 127.769,101.346 128.143,103.216C131.06,117.799 143.053,177.765 146.543,195.216C146.778,196.391 146.474,197.609 145.714,198.536C144.954,199.463 143.819,200 142.621,200C132.479,200 109.354,200 100.779,200C98.872,200 97.231,198.654 96.857,196.784C95.051,187.756 89.949,162.244 88.143,153.216C87.769,151.346 86.128,150 84.221,150C76.703,150 58.297,150 50.779,150C48.872,150 47.231,148.654 46.857,146.784C45.147,138.234 40.48,114.901 38.457,104.784Z',
    dx: 12.5,
};

/// Map a point of a piece into the viewBox, the transform chain of the logo file
function logoPoint(x: number, y: number, dx: number): [number, number] {
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

/// Parse a closed path of absolute `M`, `C`, `L` and `Z` commands into cubic segments
export function parseClosedPath(d: string): Cubic[] {
    const tokens = d.match(/[MCLZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
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

/// The samples of a face half: an arc point at an angle, or a point on the chord between the arc ends
interface FaceHalf {
    /// The angles of the arc ends
    from: number;
    to: number;
    /// Per sample, the angle on the arc or NaN for a chord sample
    angles: Float64Array;
    /// Per sample, the position on the chord from the end back to the start
    chord: Float64Array;
}

/// Sample a face half evenly by arc length, the arc runs clockwise on screen from `from` to `to`
function sampleFaceHalf(from: number, to: number, n: number): FaceHalf {
    const arcLength = FACE_RADIUS * (to - from);
    const chordLength = 2 * FACE_RADIUS * Math.sin((to - from) / 2);
    const total = arcLength + chordLength;
    const angles = new Float64Array(n);
    const chord = new Float64Array(n);
    for (let i = 0; i < n; ++i) {
        const s = (i * total) / n;
        if (s < arcLength) {
            angles[i] = from + s / FACE_RADIUS;
        } else {
            angles[i] = NaN;
            chord[i] = (s - arcLength) / chordLength;
        }
    }
    return { from, to, angles, chord };
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

/// Write the points of a face half at a time into `out`
function faceHalfPoints(half: FaceHalf, time: number, wobble: number, out: Float64Array) {
    const r0 = wobbleRadius(half.from, time, wobble), r1 = wobbleRadius(half.to, time, wobble);
    const x0 = FACE_CENTER + r0 * Math.cos(half.from), y0 = FACE_CENTER + r0 * Math.sin(half.from);
    const x1 = FACE_CENTER + r1 * Math.cos(half.to), y1 = FACE_CENTER + r1 * Math.sin(half.to);
    for (let i = 0; i < half.angles.length; ++i) {
        const angle = half.angles[i];
        if (Number.isNaN(angle)) {
            const t = half.chord[i];
            out[2 * i] = x1 + (x0 - x1) * t;
            out[2 * i + 1] = y1 + (y0 - y1) * t;
        } else {
            const r = wobbleRadius(angle, time, wobble);
            out[2 * i] = FACE_CENTER + r * Math.cos(angle);
            out[2 * i + 1] = FACE_CENTER + r * Math.sin(angle);
        }
    }
}

/// One morphing shape: a face half and the brand mark piece it turns into
export interface MorphPiece {
    /// The samples of the face half
    face: FaceHalf;
    /// The outline of the face half at rest
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

/// Build a piece of the brand mark in the viewBox, the outline and the exact path
function buildLogoPiece(piece: { d: string; dx: number }, n: number): { outline: Float64Array; path: string } {
    const cubics = parseClosedPath(piece.d).map(c => {
        const out: number[] = [];
        for (let i = 0; i < 8; i += 2) out.push(...logoPoint(c[i], c[i + 1], piece.dx));
        return out as Cubic;
    });
    let outline = resampleClosed(flattenCubics(cubics), n);
    if (signedArea(outline) < 0) outline = reverseOutline(outline);
    const f = (v: number) => Number(v.toFixed(3));
    let path = `M${f(cubics[0][0])},${f(cubics[0][1])}`;
    for (const c of cubics) path += `C${f(c[2])},${f(c[3])} ${f(c[4])},${f(c[5])} ${f(c[6])},${f(c[7])}`;
    return { outline, path: `${path}Z` };
}

/// Build a morph piece from a face half and a brand mark piece
function buildPiece(from: number, to: number, logoPiece: { d: string; dx: number }, n: number): MorphPiece {
    const face = sampleFaceHalf(from, to, n);
    const faceRest = new Float64Array(2 * n);
    faceHalfPoints(face, 0, 0, faceRest);
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

/// The two morph pieces. The upper right face half turns into the upper right piece of the brand mark,
/// the lower left half into the lower left piece. The diagonal runs from the top left to the bottom right.
export const MORPH_PIECES: readonly MorphPiece[] = [
    buildPiece((5 * Math.PI) / 4 - FACE_SEAM_OVERLAP, (9 * Math.PI) / 4 + FACE_SEAM_OVERLAP, LOGO_PIECE_UPPER, OUTLINE_POINTS),
    buildPiece(Math.PI / 4 - FACE_SEAM_OVERLAP, (5 * Math.PI) / 4 + FACE_SEAM_OVERLAP, LOGO_PIECE_LOWER, OUTLINE_POINTS),
];

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
    faceHalfPoints(piece.face, frame.time, frame.wobble, scratch);
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
