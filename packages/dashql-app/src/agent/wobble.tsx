import * as React from 'react';

import { DASHQL_BRAND, OUTLINE_POINTS, DBCOM_BRAND, type WobbleBrand, VIEWBOX_SIZE, morphPoints, outlinePath, springAtRest, stepSpring, type Spring } from '@ankoh/dashql-ui/wobble/wobble_morph';
import { useAppFlavor } from '../config/flavor_provider.js';
import * as styles from './wobble.module.css';

/// The brand marks by the id of their app flavor
const BRANDS_BY_FLAVOR: ReadonlyMap<string, WobbleBrand> = new Map([DASHQL_BRAND, DBCOM_BRAND].map(brand => [brand.id, brand]));

/// The brand mark of the app flavor, the DashQL brand mark for a flavor without one
export function useFlavorWobbleBrand(): WobbleBrand {
    return BRANDS_BY_FLAVOR.get(useAppFlavor().id) ?? DASHQL_BRAND;
}

/// The knobs of the animation of Wobble
export interface WobbleTuning {
    /// The stiffness of the morph spring
    stiffness: number;
    /// The damping of the morph spring, low values overshoot
    damping: number;
    /// The share of the morph by which the points that travel the least start later
    lag: number;
    /// The amplitude of the ripple along the outline while the shape travels
    ripple: number;
    /// The radius wobble of the face, relative to the radius
    wobble: number;
    /// The speed of the wobble
    wobbleSpeed: number;
    /// The blur of the goo filter, full from the face to the middle of the morph and fading out towards the
    /// brand mark, 0 disables it
    gooBlur: number;
    /// How long the face shows before it morphs, randomized by ±20%
    faceHoldMs: number;
    /// How long the brand mark shows
    logoHoldMs: number;
    /// The mean time between two glances
    glanceIntervalMs: number;
    /// How far the eyes glance, in viewBox units
    glanceAmplitude: number;
    /// The mean time between two blinks
    blinkIntervalMs: number;
}

export const DEFAULT_WOBBLE_TUNING: WobbleTuning = {
    stiffness: 70,
    damping: 9,
    lag: 0.35,
    ripple: 3,
    wobble: 0.02,
    wobbleSpeed: 1,
    gooBlur: 5,
    faceHoldMs: 10000,
    logoHoldMs: 3000,
    glanceIntervalMs: 2400,
    glanceAmplitude: 15,
    blinkIntervalMs: 4500,
};

/// What Wobble shows
export enum WobbleMode {
    /// The face, morphing into the brand mark now and then
    Cycle = 'cycle',
    /// Only the face
    Face = 'face',
    /// Only the brand mark
    Logo = 'logo',
}

/// The eyes, pills cut out of the face
const EYE_Y = 90;
const EYE_DX = 24;
const EYE_WIDTH = 17;
const EYE_HEIGHT = 27;
/// The happy eyes, arcs like ^ ^
const HAPPY_EYE_WIDTH = 20;
const HAPPY_EYE_HEIGHT = 10;
const HAPPY_EYE_STROKE = 6;
/// How long the eyes stay happy after the last input
const HAPPY_HOLD_MS = 700;
/// How far the eyes look up and down, relative to the glance to the sides
const GAZE_VERTICAL = 1.1;
/// The distance at which the eyes look halfway to a gaze target, in face widths, to the sides and up or down.
/// The eyes react to closer targets up or down, a caret below the face draws them down clearly.
const GAZE_SOFTNESS_X = 2;
const GAZE_SOFTNESS_Y = 0.8;
/// How long the eyes follow the pointer after it stopped
const POINTER_IDLE_MS = 2500;
/// The duration of a blink
const BLINK_MS = 150;
/// The share of the morph next to the brand mark over which the goo fades out
const GOO_FADE = 0.45;
/// The morph progress from which the cutouts of the brand mark fade in
const CUTOUT_REVEAL_FROM = 0.8;
/// How long the eyes take to close before a morph
const EYES_CLOSE_MS = 180;

interface WobbleProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref' | 'mode'> {
    /// The brand mark Wobble morphs into, the brand mark of the app flavor by default
    brand?: WobbleBrand;
    tuning?: Partial<WobbleTuning>;
    mode?: WobbleMode;
    /// Stops the animation, e.g. while Wobble is hidden
    paused?: boolean;
    /// The accessible label of Wobble
    label?: string;
    /// Called when the face starts to morph into the brand mark, and when it is back
    onMorph?: (event: WobbleMorphEvent) => void;
    /// What the eyes look at, they glance around on their own without
    gaze?: WobbleGaze;
    /// The time of the last input Wobble reacts to, on the clock of `performance.now()`, read every frame.
    /// The eyes squint happily while the input goes on.
    lastInput?: () => number | null;
}

/// What the eyes of Wobble look at
export interface WobbleGaze {
    /// Follow the mouse pointer while it moves
    pointer?: boolean;
    /// A point in client coordinates, read every frame, it wins over the pointer. Null when there is none.
    target?: () => { x: number; y: number } | null;
}

/// The moments of the morph that `onMorph` reports
export enum WobbleMorphEvent {
    /// The eyes close and the face starts to morph into the brand mark
    Leaving = 'leaving',
    /// The face is back and opens its eyes
    Back = 'back',
}

/// Jitter a duration by ±20%
function jitter(ms: number): number {
    return ms * (0.8 + 0.4 * Math.random());
}

/// The phase of the cycle
enum Phase {
    Face,
    ClosingEyes,
    Logo,
    Returning,
}

/// Wobble, a liquid disk with eyes that glance around and morphs into the DashQL brand mark and back.
/// The frames write the path data through refs, React renders Wobble once.
export function Wobble(props: WobbleProps): React.ReactElement {
    const flavorBrand = useFlavorWobbleBrand();
    const { brand = flavorBrand, tuning, mode = WobbleMode.Cycle, paused = false, label, onMorph, gaze, lastInput, className, ...svgProps } = props;
    const tuningRef = React.useRef<WobbleTuning>(DEFAULT_WOBBLE_TUNING);
    tuningRef.current = { ...DEFAULT_WOBBLE_TUNING, ...tuning };
    const modeRef = React.useRef(mode);
    modeRef.current = mode;
    const onMorphRef = React.useRef(onMorph);
    onMorphRef.current = onMorph;
    const lastInputRef = React.useRef(lastInput);
    lastInputRef.current = lastInput;
    const happyEyeRefs = React.useRef<(SVGPathElement | null)[]>([]);
    const gazeRef = React.useRef(gaze);
    gazeRef.current = gaze;
    const svgRef = React.useRef<SVGSVGElement | null>(null);

    const id = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const maskId = `wobble-mask-${id}`;
    const gooId = `wobble-goo-${id}`;
    const pathRefs = React.useRef<(SVGPathElement | null)[]>([]);
    const eyeRefs = React.useRef<(SVGRectElement | null)[]>([]);
    const gooGroupRef = React.useRef<SVGGElement | null>(null);
    const blurRef = React.useRef<SVGFEGaussianBlurElement | null>(null);
    const cutoutsRef = React.useRef<SVGGElement | null>(null);

    const reducedMotion = React.useMemo(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);

    React.useEffect(() => {
        if (paused) return;
        const outlines = brand.pieces.map(() => new Float64Array(2 * OUTLINE_POINTS));
        const scratch = new Float64Array(2 * OUTLINE_POINTS);
        const morph: Spring = { value: modeRef.current === WobbleMode.Logo ? 1 : 0, velocity: 0 };
        const glance: Spring = { value: 0, velocity: 0 };
        const lookY: Spring = { value: 0, velocity: 0 };
        // The excitement about input, happy eyes
        const happy: Spring = { value: 0, velocity: 0 };
        // The last pointer position, the eyes follow it while it moves
        let pointer: { x: number; y: number; time: number } | null = null;
        const onPointerMove = (event: PointerEvent) => {
            pointer = { x: event.clientX, y: event.clientY, time: performance.now() };
        };
        globalThis.addEventListener?.('pointermove', onPointerMove, { passive: true });
        const gazePoint = (now: number): { x: number; y: number } | null => {
            const gaze = gazeRef.current;
            if (gaze == null) return null;
            let target: { x: number; y: number } | null = null;
            try {
                target = gaze.target?.() ?? null;
            } catch {
                // A gaze target that cannot tell its position, e.g. of a detached editor, leaves the eyes to themselves
            }
            if (target != null) return target;
            if (gaze.pointer && pointer != null && now - pointer.time < POINTER_IDLE_MS) return pointer;
            return null;
        };
        let eyesOpen = morph.value === 0 ? 1 : 0;
        let glanceTarget = 0;
        let phase = morph.value === 0 ? Phase.Face : Phase.Logo;
        let phaseStart = performance.now();
        let faceHold = jitter(tuningRef.current.faceHoldMs);
        let nextGlance = phaseStart + jitter(tuningRef.current.glanceIntervalMs);
        let nextBlink = phaseStart + jitter(tuningRef.current.blinkIntervalMs);
        let last = phaseStart;
        let gooOn = false;
        gooGroupRef.current?.removeAttribute('filter');
        let frame = 0;

        const enterPhase = (next: Phase, now: number) => {
            const previous = phase;
            phase = next;
            phaseStart = now;
            if (next === Phase.Face) faceHold = jitter(tuningRef.current.faceHoldMs);
            if (previous === Phase.Face && next === Phase.ClosingEyes) onMorphRef.current?.(WobbleMorphEvent.Leaving);
            if (previous !== Phase.Face && next === Phase.Face) onMorphRef.current?.(WobbleMorphEvent.Back);
        };

        const render = (now: number) => {
            const t = tuningRef.current;
            const dt = Math.min((now - last) / 1000, 1 / 20);
            last = now;
            const elapsed = now - phaseStart;
            const requested = modeRef.current;

            // Advance the cycle
            switch (phase) {
                case Phase.Face:
                    if (requested === WobbleMode.Logo || (requested === WobbleMode.Cycle && elapsed >= faceHold && !reducedMotion)) {
                        enterPhase(Phase.ClosingEyes, now);
                    }
                    break;
                case Phase.ClosingEyes:
                    if (requested === WobbleMode.Face) enterPhase(Phase.Face, now);
                    else if (elapsed >= EYES_CLOSE_MS) enterPhase(Phase.Logo, now);
                    break;
                case Phase.Logo:
                    if (requested === WobbleMode.Face || (requested === WobbleMode.Cycle && elapsed >= t.logoHoldMs)) {
                        enterPhase(Phase.Returning, now);
                    }
                    break;
                case Phase.Returning:
                    if (requested === WobbleMode.Logo) enterPhase(Phase.Logo, now);
                    else if (morph.value < 0.05) enterPhase(Phase.Face, now);
                    break;
            }
            const morphTarget = phase === Phase.Logo ? 1 : 0;
            if (reducedMotion) {
                morph.value = morphTarget;
                morph.velocity = 0;
            } else {
                stepSpring(morph, morphTarget, t.stiffness, t.damping, dt);
            }

            // The eyes close before the morph and open once the face is back
            const eyesTarget = phase === Phase.Face ? 1 : 0;
            const eyesStep = dt * 1000 / EYES_CLOSE_MS;
            eyesOpen = eyesTarget > eyesOpen ? Math.min(eyesTarget, eyesOpen + eyesStep) : Math.max(eyesTarget, eyesOpen - eyesStep);
            // A gaze target or the pointer draws the eyes, the face otherwise glances around on its own
            let lookYTarget = 0;
            const gaze = !reducedMotion && phase === Phase.Face ? gazePoint(now) : null;
            if (gaze != null && svgRef.current != null) {
                const rect = svgRef.current.getBoundingClientRect();
                const dx = gaze.x - (rect.left + rect.width / 2);
                const dy = gaze.y - (rect.top + (rect.height * EYE_Y) / VIEWBOX_SIZE);
                glanceTarget = dx / Math.hypot(dx, Math.max(1, rect.width * GAZE_SOFTNESS_X));
                lookYTarget = dy / Math.hypot(dy, Math.max(1, rect.width * GAZE_SOFTNESS_Y));
                nextGlance = now + jitter(t.glanceIntervalMs);
            } else if (!reducedMotion && phase === Phase.Face) {
                if (now >= nextGlance) {
                    const choices = [-1, -1, -0.6, 0, 0.6, 1, 1].filter(c => c !== glanceTarget);
                    glanceTarget = choices[Math.floor(Math.random() * choices.length)];
                    nextGlance = now + jitter(t.glanceIntervalMs);
                }
            }
            if (!reducedMotion && phase === Phase.Face && now >= nextBlink + BLINK_MS) nextBlink = now + jitter(t.blinkIntervalMs);
            if (phase !== Phase.Face) glanceTarget = 0;
            stepSpring(glance, glanceTarget, 260, 26, dt);
            stepSpring(lookY, lookYTarget, 260, 26, dt);
            // The eyes squint happily while the input goes on
            const input = lastInputRef.current?.() ?? null;
            const happyTarget = phase === Phase.Face && input != null && now - input < HAPPY_HOLD_MS ? 1 : 0;
            if (reducedMotion) {
                happy.value = happyTarget;
            } else {
                stepSpring(happy, happyTarget, 320, 30, dt);
            }

            const blinkT = (now - nextBlink) / BLINK_MS;
            const blink = blinkT > 0 && blinkT < 1 ? Math.abs(2 * blinkT - 1) : 1;
            const squint = Math.min(Math.max(happy.value, 0), 1);
            const openness = eyesOpen * blink * (1 - squint);
            const eyeHeight = Math.max(0.001, EYE_HEIGHT * openness);
            const eyeWidth = EYE_WIDTH * (1 + 0.25 * (1 - openness));
            for (let i = 0; i < 2; ++i) {
                const eye = eyeRefs.current[i];
                if (eye == null) continue;
                const cx = VIEWBOX_SIZE / 2 + (i === 0 ? -EYE_DX : EYE_DX) + glance.value * t.glanceAmplitude;
                const cy = EYE_Y + lookY.value * t.glanceAmplitude * GAZE_VERTICAL;
                eye.setAttribute('x', (cx - eyeWidth / 2).toFixed(2));
                eye.setAttribute('y', (cy - eyeHeight / 2).toFixed(2));
                eye.setAttribute('width', eyeWidth.toFixed(2));
                eye.setAttribute('height', eyeHeight.toFixed(2));
                // The happy eyes, arcs like ^ ^
                const arc = happyEyeRefs.current[i];
                if (arc != null) {
                    const w = HAPPY_EYE_WIDTH / 2, h = HAPPY_EYE_HEIGHT / 2;
                    arc.setAttribute('d', `M${(cx - w).toFixed(2)} ${(cy + h).toFixed(2)}Q${cx.toFixed(2)} ${(cy - 2.2 * h).toFixed(2)} ${(cx + w).toFixed(2)} ${(cy + h).toFixed(2)}`);
                    arc.setAttribute('opacity', (eyesOpen * squint).toFixed(3));
                }
            }

            // Morph the shapes, the exact brand mark once the spring rests at it
            const time = (now / 1000) * t.wobbleSpeed;
            const atLogo = morphTarget === 1 && springAtRest(morph, 1);
            for (let i = 0; i < brand.pieces.length; ++i) {
                const path = pathRefs.current[i];
                if (path == null) continue;
                if (atLogo) {
                    path.setAttribute('d', brand.pieces[i].logoPath);
                    continue;
                }
                morphPoints(brand.pieces[i], {
                    progress: morph.value,
                    time,
                    wobble: reducedMotion ? 0 : t.wobble * Math.max(0, 1 - morph.value),
                    lag: t.lag,
                    ripple: reducedMotion ? 0 : t.ripple,
                }, outlines[i], scratch);
                path.setAttribute('d', outlinePath(outlines[i]));
            }

            // The cutouts of the brand mark fade in once the shape is close to it
            const cutouts = cutoutsRef.current;
            if (cutouts != null) {
                const reveal = Math.min(Math.max((morph.value - CUTOUT_REVEAL_FROM) / (1 - CUTOUT_REVEAL_FROM), 0), 1);
                cutouts.setAttribute('opacity', reveal.toFixed(3));
            }

            // The goo filter melts the halves together, until they are joined again on the way back.
            // The face is a disk the goo leaves as it is, the corners of the brand mark stay crisp at rest.
            const towardsLogo = Math.min(Math.max((1 - morph.value) / GOO_FADE, 0), 1);
            const blur = reducedMotion ? 0 : t.gooBlur * towardsLogo * towardsLogo * (3 - 2 * towardsLogo);
            const wantGoo = blur > 0.2;
            if (wantGoo !== gooOn) {
                gooOn = wantGoo;
                if (wantGoo) gooGroupRef.current?.setAttribute('filter', `url(#${gooId})`);
                else gooGroupRef.current?.removeAttribute('filter');
            }
            if (wantGoo) blurRef.current?.setAttribute('stdDeviation', blur.toFixed(2));

            // With reduced motion, a single frame shows the requested shape
            frame = reducedMotion ? 0 : requestAnimationFrame(render);
        };
        render(performance.now());
        return () => {
            if (frame !== 0) cancelAnimationFrame(frame);
            globalThis.removeEventListener?.('pointermove', onPointerMove);
        };
        // The tuning and the mode are read through refs, only a still face redraws when the mode changes
    }, [brand, paused, reducedMotion, gooId, reducedMotion ? mode : null]);

    const initialPaths = React.useMemo(() => brand.pieces.map(piece => outlinePath(piece.faceRest)), [brand]);
    return (
        <svg
            {...svgProps}
            ref={svgRef}
            className={className == null ? styles.root : `${styles.root} ${className}`}
            viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
            role="img"
            aria-label={label}
        >
            <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse" x={-50} y={-50} width={300} height={300}>
                    <rect x={-50} y={-50} width={300} height={300} fill="white" />
                    {[0, 1].map(i => (
                        <rect key={i} ref={el => { eyeRefs.current[i] = el; }}
                            x={VIEWBOX_SIZE / 2 + (i === 0 ? -EYE_DX : EYE_DX) - EYE_WIDTH / 2} y={EYE_Y - EYE_HEIGHT / 2}
                            width={EYE_WIDTH} height={EYE_HEIGHT} rx={EYE_WIDTH / 2} fill="black" />
                    ))}
                    {[0, 1].map(i => (
                        <path key={i} ref={el => { happyEyeRefs.current[i] = el; }} opacity={0} fill="none" stroke="black"
                            strokeWidth={HAPPY_EYE_STROKE} strokeLinecap="round" strokeLinejoin="round" />
                    ))}
                    <g ref={cutoutsRef} opacity={0}>
                        {brand.cutouts.map((cutout, i) => (
                            <path key={i} d={cutout.d} transform={cutout.transform} fill="black" />
                        ))}
                    </g>
                </mask>
                <filter id={gooId} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
                    <feGaussianBlur ref={blurRef} in="SourceGraphic" stdDeviation={0} result="blur" />
                    <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="goo" />
                    <feComposite in="SourceGraphic" in2="goo" operator="atop" />
                </filter>
            </defs>
            <g mask={`url(#${maskId})`}>
                <g ref={gooGroupRef}>
                    {initialPaths.map((d, i) => (
                        <path key={i} ref={el => { pathRefs.current[i] = el; }} d={d} fill="currentColor" />
                    ))}
                </g>
            </g>
        </svg>
    );
}
