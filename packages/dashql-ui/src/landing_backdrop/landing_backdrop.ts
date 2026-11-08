import { outlineBounds, springAtRest, stepSpring, type AgentFaceBrand, type Spring } from '../agent_face/agent_face_morph.js';

/// What the backdrop shows. The brand, motion, dots and particles are fixed when it is attached, the rest can change.
export interface LandingBackdropOptions {
    /// The brand mark the sphere turns into
    brand: AgentFaceBrand;
    /// The length of one cycle in seconds
    period: number;
    /// The multiplier of the ink
    contrast: number;
    /// Does the cloud move, without motion it shows all dots of the brand mark
    motion: boolean;
    /// The number of dots
    dots: number;
    /// The number of particles of the ring around the cloud
    particles: number;
    /// How bright the particles of the ring are, on top of the contrast
    ringInk: number;
    /// How many frames per second the ring draws while no particles are on their way
    ringFps: number;
    /// How far the particles of the ring wobble, relative to their distance
    outerWobble: number;
    /// How many seconds the light takes to circle over the brand mark
    lightSeconds: number;
    /// How much brighter the brand mark is where the light falls on it
    glow: number;
    /// The share of the dots of the brand mark that is visible at a time
    density: number;
    /// The share of the dots of the sphere that is visible at a time
    sphereDensity: number;
    /// The share of the particles of the ring that is visible at a time
    ringDensity: number;
    /// How many seconds a dot takes to fade in, fade out and be hidden again, on average
    twinkleSeconds: number;
    /// How many seconds a particle takes to fly into or out of the shape at a switch
    fly: number;
    /// How far the inner edge of the ring lies from the center, in radii of the sphere
    gap: number;
    /// The size of the cloud, 1 is about as high as the page
    scale: number;
    /// Does the sphere have the eyes of the agent face
    eyes: boolean;
    /// How far the surface of the sphere wobbles, relative to its radius
    wobble: number;
    /// How far the surface of the brand mark wobbles, relative to the radius of the sphere
    markWobble: number;
    /// Reports the frames drawn per second once a second, and the GPU that draws them
    onStats?: (stats: BackdropStats) => void;
}

/// What the backdrop reports about its drawing
export interface BackdropStats {
    fps: number;
    renderer: string;
}

/// The settings of the backdrop as it is meant to look
export const DEFAULT_LANDING_BACKDROP = {
    period: 10,
    contrast: 0.4,
    dots: 5000,
    particles: 5000,
    ringInk: 1.6,
    ringFps: 15,
    outerWobble: 0.06,
    gap: 2,
    fly: 0.5,
    lightSeconds: 6,
    glow: 0.2,
    density: 0.5,
    sphereDensity: 0.5,
    ringDensity: 0.6,
    twinkleSeconds: 6,
    wobble: 0.07,
    markWobble: 0.005,
    scale: 0.3,
    eyes: true,
} satisfies Omit<LandingBackdropOptions, 'brand' | 'motion' | 'onStats'>;

/// The numbers of dots to choose from
export const CLOUD_DENSITIES = [5000, 10000, 20000, 40000];
/// The size of a dot at 40000 dots, fewer dots are a little larger
const DOT_SIZE = 2.0;
/// The share of the dots of the full sphere that is drawn. The front is enough, plus a margin for the wobble of its edge.
const DRAWN_SHARE = 0.56;
/// The time between two frames while a shape turns into the other, and while only slow things move
const FAST_FRAME_MS = 1000 / 60;
const REST_FRAME_MS = 1000 / 30;
/// The radius of the sphere in units of the viewBox of the mark, the disk of the agent face
const SPHERE_RADIUS = 70;
/// The units of the viewBox of the mark in half of the height of the page
const UNITS_PER_PAGE = 92;
/// The strength of the perspective
const PERSPECTIVE = 0.3;
/// The share of the morph by which the dots that travel the least start later
const MORPH_LAG = 0.32;
/// The eyes of the agent face, relative to the center of its disk in the same units as the sphere: two pills
const EYE_DX = 24;
const EYE_DY = 10;
const EYE_WIDTH = 17;
const EYE_HEIGHT = 27;
const EYE_DOT_SPACING = 3.1;
/// The dots per row of an eye from top to bottom: a pill like the eyes of the agent face, straight sides with round ends
const EYE_ROWS = [2, 4, 6, 6, 6, 6, 6, 6, 4, 2];
/// How far the eyes glance, and how often they glance and blink
const GLANCE_AMPLITUDE = 15;
const GLANCE_INTERVAL_MS = 2400;
const BLINK_INTERVAL_MS = 4500;
const BLINK_MS = 150;
/// The brightness of the dots of the eyes
const EYE_INK = 0.85;
/// The spring of the glance of the eyes
const GLANCE_STIFFNESS = 160;
const GLANCE_DAMPING = 22;
/// How long the eyes take to close before a morph
const EYES_CLOSE_MS = 180;
/// How long the eyes follow the pointer after it stopped
const POINTER_IDLE_MS = 2500;
/// The brightness of the dots of the shapes, half of them are hidden at a time
const BODY_INK = 3.4;
/// How wide the ring is, in radii of the sphere
const RING_WIDTH = 0.6;
/// How much of its radius the ring comes closer to the viewer, it lies at a slant of 1.2 radians
const RING_REACH_TOWARDS_VIEWER = Math.cos(1.2);
/// The share of the particles that flies at a switch
const PARTICLE_JOIN_SHARE = 0.55;
/// A switch is timed in the seconds that a particle takes to fly in: everything else follows, so the order stays the same
/// at any speed. Over how long the particles leave, and how long they stay on the shape.
const JOIN_SPREAD = 1.4;
const JOIN_HOLD = 1.6;
/// How long a particle that flies out takes to fade out in the ring and fade in on the shape
const JOIN_SWAP = 0.3;
/// The old shape dissolves dot by dot into a trace while it melts: over this time, each dot taking the fade time
const SHAPE_TRACE = 0.16;
const DISSOLVE_SPREAD = 0.9;
const DISSOLVE_FADE = 0.5;
/// Its dots light up again one by one, after the first particles landed: starting then, over this time
const REVEAL_START = 0.8;
const REVEAL_SPREAD = 1.5;
const REVEAL_FADE = 0.4;
/// The soft light that circles over the brand mark: its radius and the radius of its circle, in units of the viewBox.
/// Both brand marks fill about the same part of the viewBox, the same light fits them.
const LIGHT_RADIUS = 52;
const LIGHT_CIRCLE = 46;
/// Where the light stands when nothing moves
const LIGHT_STILL_ANGLE = 2.4;
/// The spring of the morph, damped so that it settles without wobbling
const MORPH_STIFFNESS = 11;
const MORPH_DAMPING = 5.2;

/// A small generator of random numbers, the cloud is the same on every load
function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/// The places of a honeycomb inside of the outlines of the brand mark, around its middle with y up.
/// Every row of the honeycomb is cut by the outlines, the places between the cuts are inside.
function latticePlaces(brand: AgentFaceBrand, spacing: number): { x: number; y: number }[] {
    const places: { x: number; y: number }[] = [];
    const crossings: number[] = [];
    let row = 0;
    for (let y = 0; y < 200; y += spacing * 0.866, ++row) {
        const shift = row % 2 === 0 ? 0 : spacing / 2;
        for (const piece of brand.pieces) {
            const outline = piece.logo;
            const n = outline.length / 2;
            crossings.length = 0;
            for (let i = 0, j = n - 1; i < n; j = i++) {
                const ay = outline[2 * j + 1], by = outline[2 * i + 1];
                if ((by > y) !== (ay > y)) {
                    const ax = outline[2 * j], bx = outline[2 * i];
                    crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
                }
            }
            crossings.sort((a, b) => a - b);
            for (let c = 0; c + 1 < crossings.length; c += 2) {
                const first = Math.ceil((crossings[c] - shift) / spacing);
                for (let x = first * spacing + shift; x < crossings[c + 1]; x += spacing) {
                    places.push({ x: x - 100, y: 100 - y });
                }
            }
        }
    }
    return places;
}

/// A honeycomb with at least this many places
function markLattice(brand: AgentFaceBrand, count: number): { x: number; y: number }[] {
    // The number of places grows with one over the square of the spacing, a few steps find the spacing
    let spacing = 2;
    for (let i = 0; i < 4; ++i) spacing *= Math.sqrt(latticePlaces(brand, spacing).length / count);
    let places = latticePlaces(brand, spacing);
    while (places.length < count) {
        spacing *= 0.995;
        places = latticePlaces(brand, spacing);
    }
    return places;
}

/// The floats of a dot: its direction on the sphere, its place on the mark, how much later it starts, and its twinkle
const CLOUD_FLOATS = 7;
/// The floats of a particle: four seeds, if and when it joins a shape, its twinkle, and then a dot of the shape
const PARTICLE_FLOATS = 14;
const CLOUDS = new Map<string, Float32Array>();

/// Every dot of the sphere gets a place on the mark.
/// Seen from the front, a side of the sphere and the mark are two regions of the plane. They are matched by cutting both
/// into rows with the same number of dots, and pairing the dots of a row from left to right. Dots that are neighbors on the
/// sphere stay neighbors on the mark, so the dots flow without crossing each other.
function buildCloud(brand: AgentFaceBrand, count: number): Float32Array {
    const key = `${brand.id}-${count}`;
    const cached = CLOUDS.get(key);
    if (cached != null) return cached;
    const drawn = Math.ceil(count * DRAWN_SHARE);
    const cloud = new Float32Array(CLOUD_FLOATS * drawn);
    const random = seededRandom(11);

    // The dots spread evenly over the sphere from its front to its back, the two sides are matched on their own
    const sides: number[][] = [[], []];
    for (let i = 0; i < drawn; ++i) {
        const z = 1 - (2 * (i + 0.5)) / count;
        const ring = Math.sqrt(1 - z * z);
        const angle = 2.399963229728653 * i;
        const offset = CLOUD_FLOATS * i;
        cloud[offset] = Math.cos(angle) * ring;
        cloud[offset + 1] = Math.sin(angle) * ring;
        cloud[offset + 2] = z;
        sides[z >= 0 ? 0 : 1].push(i);
    }

    const lattice = markLattice(brand, sides[0].length);
    let longest = 0;
    for (const sources of sides) {
        if (sources.length === 0) continue;
        // A few places too many are left out evenly
        const targets: number[] = [];
        for (let i = 0; i < sources.length; ++i) targets.push(Math.floor((i * lattice.length) / sources.length));
        sources.sort((a, b) => cloud[CLOUD_FLOATS * b + 1] - cloud[CLOUD_FLOATS * a + 1]);
        targets.sort((a, b) => lattice[b].y - lattice[a].y);
        const rows = Math.max(1, Math.round(Math.sqrt(sources.length)));
        for (let row = 0; row < rows; ++row) {
            const from = Math.floor((row * sources.length) / rows);
            const to = Math.floor(((row + 1) * sources.length) / rows);
            const rowSources = sources.slice(from, to).sort((a, b) => cloud[CLOUD_FLOATS * a] - cloud[CLOUD_FLOATS * b]);
            const rowTargets = targets.slice(from, to).sort((a, b) => lattice[a].x - lattice[b].x);
            for (let k = 0; k < rowSources.length; ++k) {
                const offset = CLOUD_FLOATS * rowSources[k];
                const { x, y } = lattice[rowTargets[k]];
                cloud[offset + 3] = x;
                cloud[offset + 4] = y;
                const travel = Math.hypot(cloud[offset] * SPHERE_RADIUS - x, cloud[offset + 1] * SPHERE_RADIUS - y, cloud[offset + 2] * SPHERE_RADIUS);
                cloud[offset + 5] = travel;
                longest = Math.max(longest, travel);
            }
        }
    }
    // The dots that travel far lead, the others follow
    for (let i = 0; i < drawn; ++i) {
        cloud[CLOUD_FLOATS * i + 5] = 1 - cloud[CLOUD_FLOATS * i + 5] / (longest || 1);
    }
    // The dots are in a random order, their twinkle is their place in that order: the visible ones are one slice of the buffer
    for (let i = drawn - 1; i > 0; --i) {
        const j = Math.floor(random() * (i + 1));
        for (let k = 0; k < CLOUD_FLOATS; ++k) {
            const swap = cloud[CLOUD_FLOATS * i + k];
            cloud[CLOUD_FLOATS * i + k] = cloud[CLOUD_FLOATS * j + k];
            cloud[CLOUD_FLOATS * j + k] = swap;
        }
    }
    for (let i = 0; i < drawn; ++i) cloud[CLOUD_FLOATS * i + 6] = (i + 0.5) / drawn;
    CLOUDS.set(key, cloud);
    return cloud;
}

/// The dots of the two eyes: the center of the eye and the place of the dot in it
function buildEyes(): Float32Array {
    const places: number[] = [];
    const rowStep = EYE_DOT_SPACING * 0.866;
    EYE_ROWS.forEach((dots, row) => {
        const y = (row - (EYE_ROWS.length - 1) / 2) * rowStep;
        for (let dot = 0; dot < dots; ++dot) {
            const x = (dot - (dots - 1) / 2) * EYE_DOT_SPACING;
            places.push(-EYE_DX, EYE_DY, x, y);
            places.push(EYE_DX, EYE_DY, x, y);
        }
    });
    return new Float32Array(places);
}

/// The particles of the ring. A particle that joins a shape lands on a dot of its front: it becomes one of its dots, it shows
/// and hides with it.
function buildParticles(brand: AgentFaceBrand, dots: number, count: number): Float32Array {
    const cloud = buildCloud(brand, dots);
    const particles = new Float32Array(PARTICLE_FLOATS * count);
    const random = seededRandom(23);
    // The dots of the front of the sphere
    const fronts: number[] = [];
    for (let i = 0; i < cloud.length / CLOUD_FLOATS; ++i) if (cloud[CLOUD_FLOATS * i + 2] >= 0) fronts.push(i);
    for (let i = 0; i < count; ++i) {
        const offset = PARTICLE_FLOATS * i;
        for (let k = 0; k < 4; ++k) particles[offset + k] = random();
        particles[offset + 4] = random() < PARTICLE_JOIN_SHARE ? 1 : 0;
        particles[offset + 5] = random();
        // The twinkle is the place in the buffer, the other seeds are random
        particles[offset + 6] = (i + 0.5) / count;
        const dot = CLOUD_FLOATS * fronts[Math.floor(random() * fronts.length)];
        particles.set(cloud.subarray(dot, dot + CLOUD_FLOATS), offset + 7);
    }
    return particles;
}

/// The head of the vertex shaders. They run for every dot in every frame, what is known ahead of time comes from the buffers.
const VERTEX_HEAD = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uView;
uniform float uTime;
uniform float uMorph;
uniform float uDpr;
uniform float uContrast;
uniform float uScale;
uniform mat3 uRotation;
uniform float uSize;
uniform float uWobble;
uniform float uMarkWobble;
// The place of the light on the brand mark and its brightness, the shares of the visible dots and the length of their cycle
uniform vec2 uLight;
uniform float uGlow;
uniform float uDensity;
uniform float uTwinkle;
// The seconds since the shape last switched between the sphere and the mark, and the seconds of the way of a particle
uniform float uSwitch;
uniform float uFly;
out float vAlpha;
out vec3 vColor;

// A dot is visible for a share of its own cycle, so that this share of the dots is visible at any time
// All dots share the length of the cycle: the visible ones are one slice of the buffers, the rest does not even get here
float twinkle(float seed, float density) {
    if (density >= 0.99) return 1.0;
    float way = fract(seed + uTime / uTwinkle);
    float edge = min(0.5 * density, 0.15);
    return smoothstep(0.0, edge, way) * (1.0 - smoothstep(density - edge, density, way));
}

// A dot that costs no drawing
void hide() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vColor = vec3(0.0);
}

void project(vec3 p, float size) {
    vec3 place = uRotation * p / ${UNITS_PER_PAGE.toFixed(1)} * uScale;
    float perspective = 1.0 / (1.0 - place.z * ${PERSPECTIVE.toFixed(2)});
    gl_Position = vec4(place.xy * perspective * uView, 0.0, 1.0);
    gl_PointSize = clamp(size * perspective, 1.0, 4.0) * uDpr;
}

// The color of the dots, from a dark grey over a light grey to white
vec3 ramp(float h) {
    return mix(mix(vec3(0.26, 0.28, 0.32), vec3(0.62, 0.64, 0.68), smoothstep(0.0, 0.5, h)), vec3(1.0), smoothstep(0.55, 1.0, h));
}

float settledAt(float lag) {
    float delay = ${MORPH_LAG.toFixed(3)} * lag;
    return uMorph <= delay ? 0.0 : clamp((uMorph - delay) / (1.0 - delay), 0.0, 1.0);
}

// The mark has to stay readable: its outline wobbles a little
vec3 markSurface(vec2 a) {
    vec2 m = a / ${SPHERE_RADIUS.toFixed(1)};
    float b1 = 3.0 * m.x + 1.6 * m.y + 1.3 * uTime;
    float b2 = 2.0 * m.y - 0.9 * uTime + 1.7;
    float b3 = 3.0 * m.x + 2.1 * uTime + 0.4;
    float wave = 0.5 * sin(b1) + 0.3 * sin(b2) + 0.2 * sin(b3);
    return vec3(a, 0.0) + ${SPHERE_RADIUS.toFixed(1)} * uMarkWobble * vec3(0.6 * sin(b1) + 0.4 * sin(b3), 0.6 * sin(b2) + 0.4 * sin(b1 + 1.0), wave);
}

// How much a dot of the mark is lit: the dots show the whole mark, the light only moves over it very subtly
float markLit(vec2 a) {
    vec2 d = a - uLight;
    return uGlow * exp(-dot(d, d) / ${(LIGHT_RADIUS * LIGHT_RADIUS).toFixed(1)});
}

vec3 sphereSurface(vec3 s, float settled) {
    float wave = 0.5 * sin(3.0 * s.x + 1.6 * s.y + 1.3 * uTime)
        + 0.3 * sin(2.0 * s.y - 2.4 * s.z - 0.9 * uTime + 1.7)
        + 0.2 * sin(5.0 * s.z + 3.0 * s.x + 2.1 * uTime + 0.4);
    return s * ${SPHERE_RADIUS.toFixed(1)} * (1.0 + uWobble * (1.0 - settled) * (wave + 0.4 * sin(0.8 * uTime)));
}
`;

const CLOUD_VERTEX = /* glsl */ `${VERTEX_HEAD}
in vec3 aSphere;
in vec2 aMark;
in float aLag;
in float aSeed;
uniform float uSphereDensity;
// The glance of the eyes, how open they are, and if they are shown
uniform vec4 uEyes;

// The distance to a pill around a center
float pill(vec2 p, vec2 center, vec2 half_size) {
    float radius = min(half_size.x, half_size.y);
    vec2 d = abs(p - center) - half_size + radius;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

void main() {
    float settled = settledAt(aLag);
    // A switch dissolves the old shape dot by dot while it melts, and its dots light up one by one as the particles build
    // the new one
    float dissolveAt = aSeed * ${DISSOLVE_SPREAD.toFixed(2)} * uFly;
    float dissolve = smoothstep(dissolveAt, dissolveAt + ${DISSOLVE_FADE.toFixed(2)} * uFly, uSwitch);
    float revealAt = (${REVEAL_START.toFixed(2)} + aSeed * ${REVEAL_SPREAD.toFixed(2)}) * uFly;
    float reveal = smoothstep(revealAt, revealAt + ${REVEAL_FADE.toFixed(2)} * uFly, uSwitch);
    float switching = mix(1.0, mix(${SHAPE_TRACE.toFixed(2)}, 1.0, reveal), dissolve);

    // The brand mark at rest needs nothing of the sphere, the back of the sphere has no dots on it
    if (settled >= 1.0) {
        float shown = aSphere.z >= 0.0 ? twinkle(aSeed, uDensity) : 0.0;
        if (shown <= 0.0) {
            hide();
            return;
        }
        float lit = markLit(aMark);
        project(markSurface(aMark), uSize * (0.8 + 0.2 * shown + 0.1 * lit));
        vAlpha = uContrast * ${BODY_INK.toFixed(1)} * shown * (0.6 + lit) * switching;
        vColor = ramp(0.55 + 0.3 * lit);
        return;
    }

    // The harmonics of the wobble of the agent face, on the surface of the sphere
    float a1 = 3.0 * aSphere.x + 1.6 * aSphere.y + 1.3 * uTime;
    float a2 = 2.0 * aSphere.y - 2.4 * aSphere.z - 0.9 * uTime + 1.7;
    float a3 = 5.0 * aSphere.z + 3.0 * aSphere.x + 2.1 * uTime + 0.4;
    float wave = 0.5 * sin(a1) + 0.3 * sin(a2) + 0.2 * sin(a3);
    // The waves tilt the surface, so the light breaks on them
    vec3 slope = vec3(1.5 * cos(a1) + 0.6 * cos(a3), 0.8 * cos(a1) + 0.6 * cos(a2), -0.72 * cos(a2) + cos(a3));
    vec3 sphereNormal = aSphere - 2.5 * uWobble * (slope - dot(slope, aSphere) * aSphere);
    // The mark is flat, the dots of the back of the sphere stay behind the ones of its front
    vec3 markNormal = vec3(0.0, 0.0, aSphere.z >= 0.0 ? 1.0 : -1.0);
    vec3 surfaceNormal = normalize(mix(sphereNormal, markNormal, settled));
    vec3 normal = uRotation * surfaceNormal;
    // The far side is not drawn at all
    if (normal.z < -0.05) {
        hide();
        return;
    }

    // The eyes have dots of their own and rest while the surface wobbles. The dots of the sphere make room where they are now:
    // a dot that wobbles through an eye would add to its dots and make it flicker.
    vec3 sphere = sphereSurface(aSphere, settled);
    float underEye = 1.0;
    if (uEyes.w > 0.5 && aSphere.z > 0.0 && settled < 0.02) {
        float open = uEyes.z;
        vec2 size = vec2(${EYE_WIDTH.toFixed(1)} * (1.0 + 0.25 * (1.0 - open)), max(${EYE_HEIGHT.toFixed(1)} * open, 0.1)) * 0.5;
        vec2 onFace = sphere.xy - uEyes.xy * ${GLANCE_AMPLITUDE.toFixed(1)};
        float d = min(
            pill(onFace, vec2(-${EYE_DX.toFixed(1)}, ${EYE_DY.toFixed(1)}), size),
            pill(onFace, vec2(${EYE_DX.toFixed(1)}, ${EYE_DY.toFixed(1)}), size)
        );
        underEye = mix(1.0, smoothstep(2.5, 6.5, d), smoothstep(0.03, 0.18, open));
    }

    float sphereShown = twinkle(aSeed, uSphereDensity) * underEye;
    float markShown = settled > 0.0 ? twinkle(aSeed, uDensity) : 0.0;
    float shown = mix(sphereShown, markShown, settled);
    if (shown <= 0.0) {
        hide();
        return;
    }

    float lit = settled > 0.0 ? markLit(aMark) : 0.0;
    vec3 mark = settled > 0.0 ? markSurface(aMark) : vec3(0.0);
    // A ripple runs over the surface while the dots are on their way
    float ripple = 3.0 * sin(3.14159 * settled) * sin(6.0 * aSphere.x + 5.0 * aSphere.y + 4.0 * uTime);
    project(mix(sphere, mark, settled) + surfaceNormal * ripple,
        uSize * mix(1.0, 0.8 + 0.2 * markShown + 0.1 * lit, settled));

    // An even body, lit only softly from the upper left so that its dots stay visible where no light falls. The edge gets
    // only a hint of a rim.
    float diffuse = max(dot(normal, normalize(vec3(-0.5, 0.68, 0.55))), 0.0);
    float rim = pow(1.0 - max(normal.z, 0.0), 2.6);
    // The crests of the waves are a little brighter
    float crestWave = wave * (1.0 - settled);
    float crest = 1.0 + 0.35 * crestWave;
    // The dots of a sphere crowd together where it turns away and would add up to a bright outline
    float crowd = mix(mix(0.4, 1.0, smoothstep(0.0, 0.5, normal.z)), 1.0, settled);
    float sphereLight = (0.34 + 0.2 * diffuse + 0.05 * rim) * sphereShown;
    float markLight = markShown * (0.6 + lit);
    vAlpha = uContrast * crest * crowd * ${BODY_INK.toFixed(1)} * mix(sphereLight, markLight, settled) * switching;
    float tone = mix(clamp(0.5 + 0.2 * diffuse + 0.05 * rim + 0.08 * crestWave, 0.0, 0.8), 0.55 + 0.3 * lit, settled);
    vColor = ramp(tone);
}`;

/// The dots of the eyes, a small grid that slides over the sphere as a block when the eyes glance, and squeezes together
/// when they blink. A dot never enters or leaves an eye. These dots are the brightest and the closest ones, on them even a
/// shift of a part of a pixel shows as a shimmer: they lie on whole pixels at a fixed distance, the pattern never changes.
const EYE_VERTEX = /* glsl */ `${VERTEX_HEAD}
// The center of the eye on the face, and the place of the dot in the eye
in vec4 aEye;
uniform vec4 uEyes;
// The pixels of the canvas from its center to its edge
uniform vec2 uPixels;

void main() {
    float open = uEyes.z;
    const float R = ${SPHERE_RADIUS.toFixed(1)};
    // The point between the eyes: both eyes move as one block, one of them must not step a frame before the other
    vec2 onFace = vec2(0.0, aEye.y) + uEyes.xy * ${GLANCE_AMPLITUDE.toFixed(1)};
    vec3 s = vec3(onFace, sqrt(max(0.0, R * R - dot(onFace, onFace)))) / R;
    // Like on the agent face, the eyes do not follow the wobble of the surface: they rest while it moves around them
    vec3 place = uRotation * s * R / ${UNITS_PER_PAGE.toFixed(1)} * uScale;
    float perspective = 1.0 / (1.0 - place.z * ${PERSPECTIVE.toFixed(2)});
    float pixelsPerUnit = uScale / ${UNITS_PER_PAGE.toFixed(1)} * uView.y * uPixels.y;
    vec2 center = floor(place.xy * perspective * uView * uPixels) + 0.5 + vec2(floor(aEye.x * pixelsPerUnit + 0.5), 0.0);

    // An even distance of the dots: half of it is the distance of the dots of a row with an even number of them to its middle
    float pitch = max(4.0, 2.0 * floor(0.5 * ${EYE_DOT_SPACING.toFixed(1)} * pixelsPerUnit + 0.5));
    // Rows at the same distance, the dots lie in a square grid
    float rowPitch = pitch;
    vec2 cell = aEye.zw / vec2(${EYE_DOT_SPACING.toFixed(1)}, ${(EYE_DOT_SPACING * 0.866).toFixed(4)});
    // A blink squeezes the dots together, and the eye gets a little wider
    vec2 fromCenter = floor(cell * vec2(pitch * (1.0 + 0.25 * (1.0 - open)), rowPitch * max(open, 0.04)) + 0.5);
    gl_Position = vec4((center + fromCenter) / uPixels, 0.0, 1.0);
    // An odd size has its center in the middle of a pixel
    gl_PointSize = max(3.0, 2.0 * floor(0.75 * uSize * uDpr) + 1.0);
    // Below full white: a dot that clips loses its soft edge
    vAlpha = ${EYE_INK.toFixed(2)} * smoothstep(0.03, 0.18, open);
    vColor = vec3(1.0);
}`;

const CLOUD_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
in float vAlpha;
in vec3 vColor;
out vec4 outColor;
void main() {
    float a = smoothstep(0.5, 0.08, length(gl_PointCoord - 0.5)) * vAlpha;
    outColor = vec4(vColor * a, a);
}`;

const PARTICLE_VERTEX = /* glsl */ `${VERTEX_HEAD}
in vec4 aSeeds;
// If it joins a shape, and when it leaves
in vec2 aJoin;
in float aTwinkle;
// The dot of the shape that the particle becomes if it joins
in vec3 aSphere;
in vec2 aMark;
in float aLag;
in float aMarkSeed;
uniform float uOuterWobble;
uniform float uGap;
uniform float uRingDensity;
uniform float uRingInk;
// Do the particles fly out of the shape at this switch, or into it
uniform float uOutward;

void main() {
    float a = aSeeds.x, b = aSeeds.y, c = aSeeds.z, d = aSeeds.w;
    const float R = ${SPHERE_RADIUS.toFixed(1)};

    float start = aJoin.y * ${JOIN_SPREAD.toFixed(2)} * uFly;
    float arrive;
    float handover;
    if (uOutward > 0.5) {
        // The globe turns into the brand mark and throws particles off: each fades out in the ring at its own moment, fades in
        // on the shape and flies out to where it came from
        float swapEnd = start + ${JOIN_SWAP.toFixed(2)} * uFly;
        float swap = smoothstep(start, swapEnd, uSwitch);
        handover = aJoin.x > 0.5 ? abs(2.0 * swap - 1.0) : 1.0;
        arrive = aJoin.x > 0.5 && swap > 0.5 ? 1.0 - smoothstep(swapEnd, swapEnd + uFly, uSwitch) : 0.0;
    } else {
        // The brand mark turns into the globe and draws particles in: each leaves at its own moment, arcs to its dot and rides
        // along with it. Later it fades out there and fades in again where it came from, it never flies back.
        arrive = aJoin.x * smoothstep(start, start + uFly, uSwitch);
        float leaveAt = start + uFly * (1.0 + ${JOIN_HOLD.toFixed(2)});
        float release = smoothstep(leaveAt, leaveAt + 0.6, uSwitch);
        handover = aJoin.x > 0.5 ? abs(2.0 * release - 1.0) : 1.0;
        if (release > 0.5) arrive = 0.0;
    }

    // Most of the time most particles are just part of the ring, and many of them are hidden
    float shown = twinkle(aTwinkle, uRingDensity);
    if (arrive <= 0.0 && shown <= 0.0) {
        hide();
        return;
    }

    // A thin ring that lies at a slant, like the rings of a planet
    float angle = a * 6.28318 + uTime * (0.05 + 0.05 * c);
    float radius = R * (uGap + ${RING_WIDTH.toFixed(2)} * b * b);
    vec3 p = vec3(cos(angle) * radius, (c - 0.5) * R * 0.1, sin(angle) * radius);
    const float SLANT_COS = ${Math.cos(1.2).toFixed(6)};
    const float SLANT_SIN = ${Math.sin(1.2).toFixed(6)};
    const float ROLL_COS = ${Math.cos(0.32).toFixed(6)};
    const float ROLL_SIN = ${Math.sin(0.32).toFixed(6)};
    p = vec3(p.x, p.y * SLANT_COS - p.z * SLANT_SIN, p.y * SLANT_SIN + p.z * SLANT_COS);
    p = vec3(p.x * ROLL_COS - p.y * ROLL_SIN, p.x * ROLL_SIN + p.y * ROLL_COS, p.z);

    // The same harmonics as the sphere, slower: the whole ring wobbles a little
    vec3 u = p / length(p);
    float wave = 0.5 * sin(3.0 * u.x + 1.6 * u.y + 0.9 * uTime)
        + 0.3 * sin(2.0 * u.y - 2.4 * u.z - 0.6 * uTime + 1.7)
        + 0.2 * sin(5.0 * u.z + 3.0 * u.x + 1.4 * uTime + 0.4);
    // A switch shakes the ring up: its wobble flares and settles, it keeps its form
    float shaken = exp(-uSwitch * 1.5);
    p *= 1.0 + (uOuterWobble + 0.1 * shaken) * wave;
    if (shaken > 0.01) {
        p += shaken * R * 0.02 * vec3(sin(uTime * 19.0 + a * 60.0), sin(uTime * 23.0 + b * 60.0), sin(uTime * 17.0 + c * 60.0));
    }

    float depth = p.z / R;
    // The far ones are dim, they lie behind the shape. They twinkle slowly as well.
    float ringAlpha = uRingInk * shown * (0.7 + 0.3 * sin(uTime * (0.4 + 0.8 * c) + a * 40.0)) * (0.3 + 0.9 * d) * mix(0.5, 1.0, smoothstep(-1.0, 0.6, depth));
    float ringTone = 0.5 + 0.35 * d;
    float ringSize = 1.3 + 1.5 * d * d;

    // Only the particles on their way or on a shape need the shape
    if (arrive > 0.0) {
        float landed = settledAt(aLag);
        float markShown = landed > 0.0 ? twinkle(aMarkSeed, uDensity) : 0.0;
        float lit = landed > 0.0 ? markLit(aMark) : 0.0;
        vec3 onShape = mix(sphereSurface(aSphere, landed), landed > 0.0 ? markSurface(aMark) : vec3(0.0), landed);
        p = mix(p, onShape, arrive);
        // The way there is an arc
        p.xy += vec2(-onShape.y, onShape.x) * 0.45 * sin(3.14159 * arrive);
        project(p, mix(ringSize, uSize * mix(1.0, 0.8 + 0.2 * markShown + 0.1 * lit, landed), arrive));
        // On the shape it looks like the dots of the shape
        vAlpha = handover * uContrast * mix(ringAlpha, mix(1.6, ${BODY_INK.toFixed(1)} * markShown * (0.6 + lit), landed), arrive);
        vColor = ramp(mix(ringTone, mix(0.55, 0.55 + 0.3 * lit, landed), arrive));
    } else {
        project(p, ringSize);
        vAlpha = handover * uContrast * ringAlpha;
        vColor = ramp(ringTone);
    }
    if (vAlpha < 0.002) hide();
}`;

function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
    const program = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(shader)}`);
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(program)}`);
    return program;
}

/// A buffer with the attributes of a program in a vertex array: the attributes as a name, a size and an offset in floats
function createVertices(gl: WebGL2RenderingContext, program: WebGLProgram, floatsPerVertex: number, data: Float32Array, attributes: readonly (readonly [string, number, number])[]): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } {
    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [name, size, offset] of attributes) {
        const location = gl.getAttribLocation(program, name);
        if (location < 0) continue;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, floatsPerVertex * 4, offset * 4);
    }
    gl.bindVertexArray(null);
    return { vao, buffer };
}

/// The uniforms of a program by name, a lookup per frame would be the most expensive script of the animation
function uniformLocations<T extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly T[]): Record<T, WebGLUniformLocation | null> {
    const locations = {} as Record<T, WebGLUniformLocation | null>;
    for (const name of names) locations[name] = gl.getUniformLocation(program, name);
    return locations;
}

const SHARED_UNIFORMS = ['uView', 'uTime', 'uMorph', 'uDpr', 'uContrast', 'uScale', 'uRotation', 'uSize', 'uWobble', 'uMarkWobble', 'uLight', 'uGlow', 'uDensity', 'uTwinkle', 'uSwitch', 'uFly'] as const;

/// A backdrop in a host element
export interface LandingBackdrop {
    /// Change what can change while it runs
    update(options: Partial<LandingBackdropOptions>): void;
    /// Remove it again
    dispose(): void;
}

const NO_BACKDROP: LandingBackdrop = { update: () => {}, dispose: () => {} };

/// Attach a sphere of dots that turns into the brand mark and back, in a ring of particles, to the middle of a positioned host.
/// The canvases are transparent, the host brings the background. Without WebGL2 it shows nothing.
export function attachLandingBackdrop(host: HTMLElement, options: LandingBackdropOptions): LandingBackdrop {
    const { brand, motion, dots, particles } = options;
    const latest = { current: options };

    // Two canvases, because a browser has to show every pixel of a canvas that changed. The ring moves slowly and is large: it
    // does not need many frames. The shapes need the frames and are small. They lie on top, with the ring showing through them.
    const ringCanvas = document.createElement('canvas');
    const shapeCanvas = document.createElement('canvas');
    for (const canvas of [ringCanvas, shapeCanvas]) {
        canvas.style.position = 'absolute';
        canvas.style.display = 'block';
        canvas.setAttribute('aria-hidden', 'true');
    }
    host.append(ringCanvas, shapeCanvas);
    // A dual GPU laptop should not wake its large GPU for a background
    const attributes: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
    const ringGl = ringCanvas.getContext('webgl2', attributes);
    const shapeGl = shapeCanvas.getContext('webgl2', attributes);
    if (ringGl == null || shapeGl == null) {
        console.warn('The backdrop needs WebGL2');
        ringCanvas.remove();
        shapeCanvas.remove();
        return NO_BACKDROP;
    }
    let cloudProgram: WebGLProgram;
    let eyeProgram: WebGLProgram;
    let particleProgram: WebGLProgram;
    try {
        cloudProgram = createProgram(shapeGl, CLOUD_VERTEX, CLOUD_FRAGMENT);
        eyeProgram = createProgram(shapeGl, EYE_VERTEX, CLOUD_FRAGMENT);
        particleProgram = createProgram(ringGl, PARTICLE_VERTEX, CLOUD_FRAGMENT);
    } catch (error) {
        console.error(error);
        ringCanvas.remove();
        shapeCanvas.remove();
        return NO_BACKDROP;
    }
    const drawnDots = Math.ceil(dots * DRAWN_SHARE);
    const cloudVertices = createVertices(shapeGl, cloudProgram, CLOUD_FLOATS, buildCloud(brand, dots), [
        ['aSphere', 3, 0], ['aMark', 2, 3], ['aLag', 1, 5], ['aSeed', 1, 6],
    ]);
    const particleVertices = createVertices(ringGl, particleProgram, PARTICLE_FLOATS, buildParticles(brand, dots, particles), [
        ['aSeeds', 4, 0], ['aJoin', 2, 4], ['aTwinkle', 1, 6], ['aSphere', 3, 7], ['aMark', 2, 10], ['aLag', 1, 12], ['aMarkSeed', 1, 13],
    ]);
    const eyeData = buildEyes();
    const eyeVertices = createVertices(shapeGl, eyeProgram, 4, eyeData, [['aEye', 4, 0]]);
    const eyeUniforms = uniformLocations(shapeGl, eyeProgram, [...SHARED_UNIFORMS, 'uEyes', 'uPixels']);
    const cloudUniforms = uniformLocations(shapeGl, cloudProgram, [...SHARED_UNIFORMS, 'uSphereDensity', 'uEyes']);
    const particleUniforms = uniformLocations(ringGl, particleProgram, [...SHARED_UNIFORMS, 'uOuterWobble', 'uGap', 'uRingDensity', 'uRingInk', 'uOutward']);

    for (const gl of [ringGl, shapeGl]) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
    }
    ringGl.clearColor(0, 0, 0, 0);
    shapeGl.clearColor(0, 0, 0, 0);

    // How far the brand mark reaches from its middle, in units of the viewBox
    let markReach = 0;
    for (const piece of brand.pieces) {
        const [minX, minY, maxX, maxY] = outlineBounds(piece.logo);
        markReach = Math.max(markReach, 100 - minX, maxX - 100, 100 - minY, maxY - 100);
    }

    // The canvases only cover what they show, one pixel of them is one pixel of the display: the browser would otherwise
    // resample them and the fine pattern of the dots would shimmer. An even size in the middle of the page lies on whole
    // pixels of the display.
    let dpr = 1;
    const ringView = { x: 1, y: 1 };
    const shapeView = { x: 1, y: 1 };
    const place = (canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, view: { x: number; y: number }, reach: number, towardsViewer: number) => {
        const current = latest.current;
        const pageWidth = host.clientWidth, pageHeight = host.clientHeight;
        const perspective = 1 / Math.max(0.2, 1 - towardsViewer * (reach / UNITS_PER_PAGE) * current.scale * PERSPECTIVE);
        const halfSide = (reach / UNITS_PER_PAGE) * current.scale * perspective * (pageHeight / 2) + 8;
        const pageDeviceWidth = Math.round(pageWidth * dpr), pageDeviceHeight = Math.round(pageHeight * dpr);
        const deviceWidth = Math.min(pageDeviceWidth, 2 * Math.ceil(halfSide * dpr));
        const deviceHeight = Math.min(pageDeviceHeight, 2 * Math.ceil(halfSide * dpr));
        canvas.width = Math.max(1, deviceWidth);
        canvas.height = Math.max(1, deviceHeight);
        canvas.style.width = `${deviceWidth / dpr}px`;
        canvas.style.height = `${deviceHeight / dpr}px`;
        canvas.style.left = `${Math.floor((pageDeviceWidth - deviceWidth) / 2) / dpr}px`;
        canvas.style.top = `${Math.floor((pageDeviceHeight - deviceHeight) / 2) / dpr}px`;
        view.x = pageHeight / Math.max(1, deviceWidth / dpr);
        view.y = pageHeight / Math.max(1, deviceHeight / dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
    };
    let layoutKey = '';
    const layout = () => {
        const current = latest.current;
        const key = `${host.clientWidth} ${host.clientHeight} ${window.devicePixelRatio} ${current.scale} ${current.gap} ${current.outerWobble} ${current.wobble} ${current.markWobble}`;
        if (key === layoutKey) return;
        layoutKey = key;
        dpr = window.devicePixelRatio;
        // How far the ring reaches at most with its wobble. The flare at a switch may touch the edge for a moment.
        place(ringCanvas, ringGl, ringView, (current.gap + RING_WIDTH) * SPHERE_RADIUS * (1.04 + current.outerWobble), RING_REACH_TOWARDS_VIEWER);
        // The shapes are as large as the sphere with its wobble, or the brand mark, with the ripple on their way
        place(shapeCanvas, shapeGl, shapeView, Math.max(SPHERE_RADIUS * (1 + 1.4 * current.wobble), markReach + SPHERE_RADIUS * 1.5 * current.markWobble) + 4, 1);
    };
    layout();

    // The cloud leans a little towards the pointer
    const pointer = { x: 0, y: 0 };
    const aim = { x: 0, y: 0 };
    let lastPointerMove = -Infinity;
    const onPointerMove = (event: PointerEvent) => {
        lastPointerMove = performance.now();
        const rect = host.getBoundingClientRect();
        aim.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        aim.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const morph: Spring = { value: motion ? 0 : 1, velocity: 0 };
    // The eyes, they glance around on their own and follow the pointer while it moves
    const glance: Spring = { value: 0, velocity: 0 };
    const look: Spring = { value: 0, velocity: 0 };
    let glanceTarget = 0;
    let nextGlance = performance.now() + GLANCE_INTERVAL_MS;
    let nextBlink = performance.now() + BLINK_INTERVAL_MS;
    let eyesOpen = motion ? 1 : 0;
    let time = 0;
    let lightAngle = LIGHT_STILL_ANGLE;
    // Long ago, nothing shakes at the start
    let switchedAt = -100;
    let lastTarget = 0;

    const setShared = (gl: WebGL2RenderingContext, view: { x: number; y: number }, u: Record<(typeof SHARED_UNIFORMS)[number], WebGLUniformLocation | null>, rotation: number[]) => {
        const current = latest.current;
        gl.uniform2f(u.uView, view.x, view.y);
        gl.uniform1f(u.uTime, time);
        gl.uniform1f(u.uMorph, morph.value);
        gl.uniform1f(u.uDpr, dpr);
        gl.uniform1f(u.uContrast, current.contrast);
        gl.uniform1f(u.uScale, current.scale);
        gl.uniformMatrix3fv(u.uRotation, false, rotation);
        gl.uniform1f(u.uSize, DOT_SIZE * Math.pow(40000 / dots, 0.25) * Math.sqrt(current.scale / 0.8));
        gl.uniform1f(u.uWobble, current.wobble);
        gl.uniform1f(u.uMarkWobble, current.markWobble);
        gl.uniform2f(u.uLight, LIGHT_CIRCLE * Math.cos(lightAngle), LIGHT_CIRCLE * Math.sin(lightAngle));
        gl.uniform1f(u.uGlow, current.glow);
        // A still image shows all of the dots, they cannot take turns
        gl.uniform1f(u.uDensity, motion ? current.density : 1);
        gl.uniform1f(u.uTwinkle, current.twinkleSeconds);
        gl.uniform1f(u.uSwitch, time - switchedAt);
        gl.uniform1f(u.uFly, current.fly);
    };

    // Draws the slice of a buffer that holds the visible dots: all dots go through their cycle in the order of the buffer
    const drawVisible = (gl: WebGL2RenderingContext, count: number, density: number) => {
        if (density >= 0.99) {
            gl.drawArrays(gl.POINTS, 0, count);
            return;
        }
        const phase = time / latest.current.twinkleSeconds;
        const start = Math.floor((1 - (phase - Math.floor(phase))) * count) % count;
        const length = Math.min(count, Math.ceil(density * count) + 2);
        if (start + length <= count) {
            gl.drawArrays(gl.POINTS, start, length);
        } else {
            gl.drawArrays(gl.POINTS, start, count - start);
            gl.drawArrays(gl.POINTS, 0, start + length - count);
        }
    };

    const rotationNow = () => {
        // It barely turns, a slow sway and a slight lean towards the pointer
        const sway = motion ? Math.sin(time * 0.33) * 0.02 : 0;
        const yaw = sway + pointer.x * 0.02, pitch = pointer.y * 0.015;
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        return [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
    };

    const drawShape = () => {
        const current = latest.current;
        const gl = shapeGl;
        layout();
        gl.clear(gl.COLOR_BUFFER_BIT);
        const rotation = rotationNow();
        gl.useProgram(cloudProgram);
        setShared(gl, shapeView, cloudUniforms, rotation);
        const sphereDensity = motion ? current.sphereDensity : 1;
        gl.uniform1f(cloudUniforms.uSphereDensity, sphereDensity);
        const blinkT = (performance.now() - nextBlink) / BLINK_MS;
        const blink = blinkT > 0 && blinkT < 1 ? Math.abs(2 * blinkT - 1) : 1;
        const open = eyesOpen * blink;
        gl.uniform4f(cloudUniforms.uEyes, glance.value, look.value, open, current.eyes ? 1 : 0);
        gl.bindVertexArray(cloudVertices.vao);
        // While the shapes turn into each other, both twinkles count
        if (morph.value < 0.001) drawVisible(gl, drawnDots, sphereDensity);
        else if (morph.value > 0.999) drawVisible(gl, drawnDots, motion ? current.density : 1);
        else gl.drawArrays(gl.POINTS, 0, drawnDots);

        if (current.eyes && open > 0.03) {
            gl.useProgram(eyeProgram);
            setShared(gl, shapeView, eyeUniforms, rotation);
            gl.uniform4f(eyeUniforms.uEyes, glance.value, look.value, open, 1);
            gl.uniform2f(eyeUniforms.uPixels, shapeCanvas.width / 2, shapeCanvas.height / 2);
            gl.bindVertexArray(eyeVertices.vao);
            gl.drawArrays(gl.POINTS, 0, eyeData.length / 4);
        }
    };

    const drawRing = () => {
        const current = latest.current;
        const gl = ringGl;
        layout();
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (particles === 0) return;
        gl.useProgram(particleProgram);
        setShared(gl, ringView, particleUniforms, rotationNow());
        gl.uniform1f(particleUniforms.uOuterWobble, current.outerWobble);
        gl.uniform1f(particleUniforms.uGap, current.gap);
        gl.uniform1f(particleUniforms.uOutward, lastTarget === 1 ? 1 : 0);
        const ringDensity = motion ? current.ringDensity : 1;
        gl.uniform1f(particleUniforms.uRingInk, current.ringInk);
        gl.uniform1f(particleUniforms.uRingDensity, ringDensity);
        gl.bindVertexArray(particleVertices.vao);
        // The particles that join a shape are visible whatever their twinkle says
        const joining = time - switchedAt < current.fly * (JOIN_SPREAD + 1 + JOIN_HOLD) + 0.7;
        if (joining) gl.drawArrays(gl.POINTS, 0, particles);
        else drawVisible(gl, particles, ringDensity);
    };

    const debugInfo = shapeGl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(debugInfo == null ? shapeGl.getParameter(shapeGl.RENDERER) : shapeGl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
    let frame = 0;
    let last = performance.now();
    let lastShapeDraw = 0;
    let lastRingDraw = 0;
    let frames = 0;
    let statsFrom = last;
    // The browser stops calling this in a hidden tab
    // A page that scrolled the backdrop away does not pay for it, the browser already stops this in a hidden tab
    let onScreen = true;
    const render = (now: number) => {
        if (!onScreen) {
            frame = 0;
            return;
        }
        frame = requestAnimationFrame(render);
        const current = latest.current;
        const dt = Math.min((now - last) / 1000, 1 / 20);
        last = now;
        time += dt;
        lightAngle += (dt * 2 * Math.PI) / current.lightSeconds;
        // The sphere shows for a moment, then the brand mark for half of the cycle, then the sphere again
        const phase = (time / current.period) % 1;
        const target = phase > 0.1 && phase < 0.6 ? 1 : 0;
        if (!springAtRest(morph, target)) stepSpring(morph, target, MORPH_STIFFNESS, MORPH_DAMPING, dt);
        if (target !== lastTarget) {
            lastTarget = target;
            switchedAt = time;
        }

        // The eyes close as the melt starts and open once the sphere is back
        const eyesTarget = target === 0 && morph.value < 0.05 ? 1 : 0;
        const eyesStep = (dt * 1000) / EYES_CLOSE_MS;
        eyesOpen = eyesTarget > eyesOpen ? Math.min(eyesTarget, eyesOpen + eyesStep) : Math.max(eyesTarget, eyesOpen - eyesStep);
        let lookTarget = 0;
        if (now - lastPointerMove < POINTER_IDLE_MS) {
            glanceTarget = Math.max(-1, Math.min(1, aim.x * 1.6));
            lookTarget = Math.max(-1, Math.min(1, -aim.y * 1.6));
            nextGlance = now + GLANCE_INTERVAL_MS;
        } else if (now >= nextGlance) {
            const choices = [-1, -0.6, 0, 0.6, 1].filter(choice => choice !== glanceTarget);
            glanceTarget = choices[Math.floor(Math.random() * choices.length)];
            nextGlance = now + GLANCE_INTERVAL_MS * (0.8 + 0.4 * Math.random());
        }
        stepSpring(glance, eyesTarget === 1 ? glanceTarget : 0, GLANCE_STIFFNESS, GLANCE_DAMPING, dt);
        stepSpring(look, eyesTarget === 1 ? lookTarget : 0, GLANCE_STIFFNESS, GLANCE_DAMPING, dt);
        if (now >= nextBlink + BLINK_MS) nextBlink = now + BLINK_INTERVAL_MS * (0.8 + 0.4 * Math.random());
        const follow = 1 - Math.exp(-dt * 3);
        pointer.x += (aim.x - pointer.x) * follow;
        pointer.y += (aim.y - pointer.y) * follow;

        // Most of the time only slow things move. Only the particles on their way need every frame.
        const flying = time - switchedAt < current.fly * (JOIN_SPREAD + JOIN_SWAP + 1);
        if (now - lastShapeDraw >= (flying ? FAST_FRAME_MS : REST_FRAME_MS) - 2) {
            lastShapeDraw = now;
            drawShape();
            frames += 1;
            // The ring draws in a frame of the shapes: the browser composes the page for every frame with a change, one
            // with both changes costs about as much as one with one of them
            if (now - lastRingDraw >= (flying ? FAST_FRAME_MS : 1000 / current.ringFps) - 2) {
                lastRingDraw = now;
                drawRing();
            }
        }
        if (now - statsFrom >= 1000) {
            current.onStats?.({ fps: Math.round((frames * 1000) / (now - statsFrom)), renderer });
            frames = 0;
            statsFrom = now;
        }
    };
    const drawAll = () => {
        drawRing();
        drawShape();
    };
    const visibility = new IntersectionObserver(entries => {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen && motion && frame === 0) {
            last = performance.now();
            frame = requestAnimationFrame(render);
        }
    });
    visibility.observe(host);
    const observer = new ResizeObserver(() => {
        layout();
        if (!motion) drawAll();
    });
    observer.observe(host);
    if (motion) {
        frame = requestAnimationFrame(render);
    } else {
        drawAll();
    }
    const dispose = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        visibility.disconnect();
        window.removeEventListener('pointermove', onPointerMove);
        shapeGl.deleteBuffer(cloudVertices.buffer);
        shapeGl.deleteVertexArray(cloudVertices.vao);
        shapeGl.deleteBuffer(eyeVertices.buffer);
        shapeGl.deleteVertexArray(eyeVertices.vao);
        shapeGl.deleteProgram(cloudProgram);
        shapeGl.deleteProgram(eyeProgram);
        ringGl.deleteBuffer(particleVertices.buffer);
        ringGl.deleteVertexArray(particleVertices.vao);
        ringGl.deleteProgram(particleProgram);
        for (const gl of [ringGl, shapeGl]) gl.getExtension('WEBGL_lose_context')?.loseContext();
        ringCanvas.remove();
        shapeCanvas.remove();
    };
    return {
        update(options) {
            latest.current = { ...latest.current, ...options };
            if (!motion) drawAll();
        },
        dispose,
    };
}
