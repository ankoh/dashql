import * as React from 'react';

import { MORPH_PIECES, OUTLINE_POINTS, VIEWBOX_SIZE, morphPoints, outlinePath, springAtRest, stepSpring, type Spring } from './agent_face_morph.js';
import * as styles from './agent_face.module.css';

/// The knobs of the agent face animation
export interface AgentFaceTuning {
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

export const DEFAULT_AGENT_FACE_TUNING: AgentFaceTuning = {
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
    glanceAmplitude: 9,
    blinkIntervalMs: 4500,
};

/// What the agent face shows
export enum AgentFaceMode {
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
const EYE_WIDTH = 14;
const EYE_HEIGHT = 26;
/// The duration of a blink
const BLINK_MS = 150;
/// The share of the morph next to the brand mark over which the goo fades out
const GOO_FADE = 0.45;
/// How long the eyes take to close before a morph
const EYES_CLOSE_MS = 180;

interface AgentFaceProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref' | 'mode'> {
    tuning?: Partial<AgentFaceTuning>;
    mode?: AgentFaceMode;
    /// Stops the animation, e.g. while the face is hidden
    paused?: boolean;
    /// The accessible label of the face
    label?: string;
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

/// The agent face, a liquid disk with eyes that glance around and morphs into the DashQL brand mark and back.
/// The frames write the path data through refs, React renders the face once.
export function AgentFace(props: AgentFaceProps): React.ReactElement {
    const { tuning, mode = AgentFaceMode.Cycle, paused = false, label, className, ...svgProps } = props;
    const tuningRef = React.useRef<AgentFaceTuning>(DEFAULT_AGENT_FACE_TUNING);
    tuningRef.current = { ...DEFAULT_AGENT_FACE_TUNING, ...tuning };
    const modeRef = React.useRef(mode);
    modeRef.current = mode;

    const id = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const maskId = `agent-face-mask-${id}`;
    const gooId = `agent-face-goo-${id}`;
    const pathRefs = React.useRef<(SVGPathElement | null)[]>([]);
    const eyeRefs = React.useRef<(SVGRectElement | null)[]>([]);
    const gooGroupRef = React.useRef<SVGGElement | null>(null);
    const blurRef = React.useRef<SVGFEGaussianBlurElement | null>(null);

    const reducedMotion = React.useMemo(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);

    React.useEffect(() => {
        if (paused) return;
        const outlines = MORPH_PIECES.map(() => new Float64Array(2 * OUTLINE_POINTS));
        const scratch = new Float64Array(2 * OUTLINE_POINTS);
        const morph: Spring = { value: modeRef.current === AgentFaceMode.Logo ? 1 : 0, velocity: 0 };
        const glance: Spring = { value: 0, velocity: 0 };
        let eyesOpen = morph.value === 0 ? 1 : 0;
        let glanceTarget = 0;
        let phase = morph.value === 0 ? Phase.Face : Phase.Logo;
        let phaseStart = performance.now();
        let faceHold = jitter(tuningRef.current.faceHoldMs);
        let nextGlance = phaseStart + jitter(tuningRef.current.glanceIntervalMs);
        let nextBlink = phaseStart + jitter(tuningRef.current.blinkIntervalMs);
        let last = phaseStart;
        let gooOn = false;
        let frame = 0;

        const enterPhase = (next: Phase, now: number) => {
            phase = next;
            phaseStart = now;
            if (next === Phase.Face) faceHold = jitter(tuningRef.current.faceHoldMs);
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
                    if (requested === AgentFaceMode.Logo || (requested === AgentFaceMode.Cycle && elapsed >= faceHold && !reducedMotion)) {
                        enterPhase(Phase.ClosingEyes, now);
                    }
                    break;
                case Phase.ClosingEyes:
                    if (requested === AgentFaceMode.Face) enterPhase(Phase.Face, now);
                    else if (elapsed >= EYES_CLOSE_MS) enterPhase(Phase.Logo, now);
                    break;
                case Phase.Logo:
                    if (requested === AgentFaceMode.Face || (requested === AgentFaceMode.Cycle && elapsed >= t.logoHoldMs)) {
                        enterPhase(Phase.Returning, now);
                    }
                    break;
                case Phase.Returning:
                    if (requested === AgentFaceMode.Logo) enterPhase(Phase.Logo, now);
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
            if (!reducedMotion && phase === Phase.Face) {
                if (now >= nextGlance) {
                    const choices = [-1, -0.5, 0, 0, 0.5, 1].filter(c => c !== glanceTarget);
                    glanceTarget = choices[Math.floor(Math.random() * choices.length)];
                    nextGlance = now + jitter(t.glanceIntervalMs);
                }
                if (now >= nextBlink + BLINK_MS) nextBlink = now + jitter(t.blinkIntervalMs);
            } else if (phase !== Phase.Face) {
                glanceTarget = 0;
            }
            stepSpring(glance, glanceTarget, 260, 26, dt);
            const blinkT = (now - nextBlink) / BLINK_MS;
            const blink = blinkT > 0 && blinkT < 1 ? Math.abs(2 * blinkT - 1) : 1;
            const openness = eyesOpen * blink;
            const eyeHeight = Math.max(0.001, EYE_HEIGHT * openness);
            const eyeWidth = EYE_WIDTH * (1 + 0.25 * (1 - openness));
            for (let i = 0; i < 2; ++i) {
                const eye = eyeRefs.current[i];
                if (eye == null) continue;
                const cx = VIEWBOX_SIZE / 2 + (i === 0 ? -EYE_DX : EYE_DX) + glance.value * t.glanceAmplitude;
                eye.setAttribute('x', (cx - eyeWidth / 2).toFixed(2));
                eye.setAttribute('y', (EYE_Y - eyeHeight / 2).toFixed(2));
                eye.setAttribute('width', eyeWidth.toFixed(2));
                eye.setAttribute('height', eyeHeight.toFixed(2));
            }

            // Morph the shapes, the exact brand mark once the spring rests at it
            const time = (now / 1000) * t.wobbleSpeed;
            const atLogo = morphTarget === 1 && springAtRest(morph, 1);
            for (let i = 0; i < MORPH_PIECES.length; ++i) {
                const path = pathRefs.current[i];
                if (path == null) continue;
                if (atLogo) {
                    path.setAttribute('d', MORPH_PIECES[i].logoPath);
                    continue;
                }
                morphPoints(MORPH_PIECES[i], {
                    progress: morph.value,
                    time,
                    wobble: reducedMotion ? 0 : t.wobble * Math.max(0, 1 - morph.value),
                    lag: t.lag,
                    ripple: reducedMotion ? 0 : t.ripple,
                }, outlines[i], scratch);
                path.setAttribute('d', outlinePath(outlines[i]));
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
        };
        // The tuning and the mode are read through refs, only a still face redraws when the mode changes
    }, [paused, reducedMotion, gooId, reducedMotion ? mode : null]);

    const initialPaths = React.useMemo(() => MORPH_PIECES.map(piece => outlinePath(piece.faceRest)), []);
    return (
        <svg
            {...svgProps}
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
