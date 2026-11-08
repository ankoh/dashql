import * as React from 'react';

import { AgentFace, AgentFaceMode, DEFAULT_AGENT_FACE_TUNING, useFlavorAgentFaceBrand, type AgentFaceTuning } from '../../agent/agent_face.js';
import { DASHQL_BRAND, DBCOM_BRAND } from '@ankoh/dashql-ui/agent_face/agent_face_morph';
import { AgentGreeting } from '../../agent/agent_greeting.js';
import { Button, ButtonSize, ButtonVariant } from '../../ui/foundations/button.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import * as styles from './agent_face_page.module.css';

/// A slider of a tuning knob
interface Knob {
    key: keyof AgentFaceTuning;
    label: string;
    min: number;
    max: number;
    step: number;
}

/// The knobs, grouped by what they shape
const KNOB_GROUPS: { title: string; knobs: Knob[] }[] = [
    {
        title: 'Morph',
        knobs: [
            { key: 'stiffness', label: 'Spring stiffness', min: 10, max: 300, step: 1 },
            { key: 'damping', label: 'Spring damping', min: 1, max: 40, step: 0.5 },
            { key: 'lag', label: 'Point lag', min: 0, max: 0.9, step: 0.01 },
            { key: 'ripple', label: 'Ripple', min: 0, max: 12, step: 0.1 },
            { key: 'gooBlur', label: 'Goo blur', min: 0, max: 16, step: 0.1 },
        ],
    },
    {
        title: 'Liquid face',
        knobs: [
            { key: 'wobble', label: 'Wobble', min: 0, max: 0.08, step: 0.001 },
            { key: 'wobbleSpeed', label: 'Wobble speed', min: 0, max: 4, step: 0.05 },
        ],
    },
    {
        title: 'Eyes',
        knobs: [
            { key: 'glanceIntervalMs', label: 'Glance interval (ms)', min: 400, max: 8000, step: 100 },
            { key: 'glanceAmplitude', label: 'Glance amplitude', min: 0, max: 20, step: 0.5 },
            { key: 'blinkIntervalMs', label: 'Blink interval (ms)', min: 1000, max: 12000, step: 100 },
        ],
    },
    {
        title: 'Cycle',
        knobs: [
            { key: 'faceHoldMs', label: 'Face hold (ms)', min: 1000, max: 20000, step: 100 },
            { key: 'logoHoldMs', label: 'Logo hold (ms)', min: 500, max: 10000, step: 100 },
        ],
    },
];

const BRANDS = [
    { label: 'DashQL', brand: DASHQL_BRAND },
    { label: 'Database.com', brand: DBCOM_BRAND },
];
/// The demo cycles faster than the app, to watch the morph without waiting
const DEMO_TUNING: AgentFaceTuning = { ...DEFAULT_AGENT_FACE_TUNING, faceHoldMs: 4000, logoHoldMs: 2000 };

/// The eyes follow the mouse pointer
const FOLLOW_POINTER = { pointer: true };

const MODES = [AgentFaceMode.Cycle, AgentFaceMode.Face, AgentFaceMode.Logo];
const MODE_LABELS = ['Cycle', 'Face', 'Logo'];
const SURFACES = ['light', 'dark'] as const;
const INKS = [
    { label: 'Neutral', color: 'var(--base_color_neutral_6)' },
    { label: 'Coral', color: 'var(--base_color_coral_5)' },
    { label: 'Blue', color: 'var(--base_color_blue_5)' },
];
const SIZES = [24, 48, 96];

/// A playground of the agent face that morphs into the DashQL brand mark, to tune its motion
function AgentFacePage(): React.ReactElement {
    const [tuning, setTuning] = React.useState<AgentFaceTuning>(DEMO_TUNING);
    // The demo starts with the brand mark of the flavor, `demos.html?flavor=dbcom#/agent_face`
    const flavorBrand = useFlavorAgentFaceBrand();
    const [brand, setBrand] = React.useState(() => Math.max(0, BRANDS.findIndex(entry => entry.brand === flavorBrand)));
    const [mode, setMode] = React.useState(0);
    const [followPointer, setFollowPointer] = React.useState(1);
    // The face gets excited about every key typed into the try field
    const lastInput = React.useRef<number | null>(null);
    const readLastInput = React.useCallback(() => lastInput.current, []);
    const [surface, setSurface] = React.useState(0);
    const [ink, setInk] = React.useState(0);
    const [copied, setCopied] = React.useState(false);

    const tuningText = React.useMemo(() => JSON.stringify(tuning, null, 4), [tuning]);
    const copyTuning = async () => {
        await navigator.clipboard.writeText(tuningText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };

    const faceProps = { brand: BRANDS[brand].brand, tuning, lastInput: readLastInput, gaze: followPointer === 1 ? FOLLOW_POINTER : undefined, mode: MODES[mode], style: { color: INKS[ink].color } };
    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <h1 className={styles.title}>Agent Face</h1>
                <p className={styles.subtitle}>
                    The face of the agent on the empty session, it glances around and now and then melts into a brand mark.
                </p>
            </div>
            <div className={styles.layout}>
                <div className={styles.stage} data-surface={SURFACES[surface]}>
                    <AgentFace {...faceProps} className={styles.stage_face} label="Agent face" />
                    <div className={styles.greeting}>
                        <AgentGreeting face={{ ...faceProps, className: styles.greeting_face, label: 'Agent face next to its question' }}
                            questionClassName={styles.greeting_text} questionElement="p" />
                    </div>
                    <input id="agent-face-try" className={styles.try_input} placeholder="Type here, the face gets excited"
                        aria-label="Type to excite the face" onKeyDown={() => { lastInput.current = performance.now(); }} />
                    <div className={styles.sizes}>
                        {SIZES.map(size => (
                            <div key={size} className={styles.size}>
                                <AgentFace {...faceProps} width={size} height={size} label={`Agent face at ${size} pixels`} />
                                <span className={styles.size_label}>{size}px</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className={styles.controls}>
                    <div className={styles.control_row}>
                        <span className={styles.control_label}>Brand</span>
                        <SegmentedControl aria-label="Brand" size={SegmentedControlSize.Small} onChange={setBrand}>
                            {BRANDS.map((entry, i) => (
                                <SegmentedControl.Button key={entry.label} selected={brand === i}>{entry.label}</SegmentedControl.Button>
                            ))}
                        </SegmentedControl>
                    </div>
                    <div className={styles.control_row}>
                        <span className={styles.control_label}>Gaze</span>
                        <SegmentedControl aria-label="What the eyes look at" size={SegmentedControlSize.Small} onChange={setFollowPointer}>
                            <SegmentedControl.Button selected={followPointer === 0}>Around</SegmentedControl.Button>
                            <SegmentedControl.Button selected={followPointer === 1}>Pointer</SegmentedControl.Button>
                        </SegmentedControl>
                    </div>
                    <div className={styles.control_row}>
                        <span className={styles.control_label}>Shows</span>
                        <SegmentedControl aria-label="What the face shows" size={SegmentedControlSize.Small} onChange={setMode}>
                            {MODE_LABELS.map((label, i) => (
                                <SegmentedControl.Button key={label} selected={mode === i}>{label}</SegmentedControl.Button>
                            ))}
                        </SegmentedControl>
                    </div>
                    <div className={styles.control_row}>
                        <span className={styles.control_label}>Surface</span>
                        <SegmentedControl aria-label="Surface" size={SegmentedControlSize.Small} onChange={setSurface}>
                            <SegmentedControl.Button selected={surface === 0}>Light</SegmentedControl.Button>
                            <SegmentedControl.Button selected={surface === 1}>Dark</SegmentedControl.Button>
                        </SegmentedControl>
                    </div>
                    <div className={styles.control_row}>
                        <span className={styles.control_label}>Ink</span>
                        <SegmentedControl aria-label="Ink" size={SegmentedControlSize.Small} onChange={setInk}>
                            {INKS.map((entry, i) => (
                                <SegmentedControl.Button key={entry.label} selected={ink === i}>{entry.label}</SegmentedControl.Button>
                            ))}
                        </SegmentedControl>
                    </div>
                    {KNOB_GROUPS.map(group => (
                        <fieldset key={group.title} className={styles.group}>
                            <legend className={styles.group_title}>{group.title}</legend>
                            {group.knobs.map(knob => (
                                <label key={knob.key} className={styles.knob}>
                                    <span className={styles.knob_label}>{knob.label}</span>
                                    <input id={`agent-face-${knob.key}`} type="range" min={knob.min} max={knob.max} step={knob.step}
                                        value={tuning[knob.key]}
                                        onChange={e => {
                                            const value = Number(e.target.value);
                                            setTuning(t => ({ ...t, [knob.key]: value }));
                                        }} />
                                    <span className={styles.knob_value}>{tuning[knob.key]}</span>
                                </label>
                            ))}
                        </fieldset>
                    ))}
                    <div className={styles.control_row}>
                        <Button size={ButtonSize.Small} variant={ButtonVariant.Default} onClick={() => setTuning(DEMO_TUNING)}>
                            Reset
                        </Button>
                        <Button size={ButtonSize.Small} variant={ButtonVariant.Primary} onClick={copyTuning}>
                            {copied ? 'Copied' : 'Copy tuning'}
                        </Button>
                    </div>
                    <pre className={styles.tuning}>{tuningText}</pre>
                </div>
            </div>
        </div>
    );
}

export default AgentFacePage;
