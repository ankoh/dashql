import * as React from 'react';
import * as dashql from '@akohn/dashql';

import { replayProgressRecording } from '@akohn/dashql/platform/query/query_progress';
import { ProfileExecutionState } from '@akohn/dashql/platform/query/profile_execution_state';
import { createProfileLayoutConfig } from '@akohn/dashql/platform/query/profile_layout_config';
import { DashQLCoreProvider, useDashQLCore } from '../../runtime/core_provider.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { Button, ButtonSize, ButtonVariant } from '../../ui/foundations/button.js';
import { PlanFlowView } from './plan_flow_view.js';
import { TPCH_Q3_RECORDING } from './tpch_q3_recording.js';
import * as styles from './plan_flow_page.module.css';

const ORIENTATION = dashql.buffers.profile.ProfileLayoutOrientation;
const SPEEDS = [0.5, 1, 2, 4] as const;
const SCHEMES = ['dark', 'light'] as const;

interface Recording {
    name: string;
    text: string;
    /// The points in time of its payloads in milliseconds, ascending
    times: number[];
}

/// The points in time of the payloads of a recording, of format version 1 or of the Trino test harness
function readRecording(name: string, text: string): Recording {
    const document = JSON.parse(text) as {
        payloads?: { elapsedMs?: number }[];
        statementResponses?: { elapsedMs?: number }[];
        queryInfos?: { elapsedMs?: number }[];
    };
    const samples = document.payloads ?? [...(document.statementResponses ?? []), ...(document.queryInfos ?? [])];
    const times = [...new Set(samples.map(sample => sample.elapsedMs ?? 0))].sort((a, b) => a - b);
    return { name, text, times };
}

const DEFAULT_RECORDING = readRecording('tpch q3 · sf1', TPCH_Q3_RECORDING);

/// The plan gets more room between its operators than the plan view, the bands of the edges and the captions need it
function createFlowLayoutConfig(orientation: dashql.buffers.profile.ProfileLayoutOrientation): dashql.buffers.profile.ProfileLayoutConfigT {
    const config = createProfileLayoutConfig(orientation);
    if (orientation === ORIENTATION.LEFT_TO_RIGHT) {
        config.nodeMarginHorizontal = 40;
        config.nodeMarginVertical = 52;
    } else {
        config.levelHeight = 72;
        config.nodeMarginHorizontal = 56;
    }
    return config;
}

/// The playhead of the replay, it advances with the animation frames while playing
function usePlayhead(end: number, speed: number) {
    const [playhead, setPlayhead] = React.useState(0);
    const [playing, setPlaying] = React.useState(true);
    const playheadRef = React.useRef(playhead);
    playheadRef.current = playhead;
    React.useEffect(() => {
        if (!playing) return;
        let last = performance.now();
        let frame = requestAnimationFrame(function tick(now) {
            const next = Math.min(end, playheadRef.current + (now - last) * speed);
            last = now;
            playheadRef.current = next;
            setPlayhead(next);
            if (next >= end) setPlaying(false);
            else frame = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(frame);
    }, [playing, speed, end]);
    const play = React.useCallback(() => {
        setPlayhead(current => current >= end ? 0 : current);
        setPlaying(true);
    }, [end]);
    return { playhead, setPlayhead, playing, setPlaying, play };
}

function PlayIcon() {
    return <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>;
}

function PauseIcon() {
    return <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" /></svg>;
}

function PlanFlowDemo() {
    const core = useDashQLCore();
    const [recording, setRecording] = React.useState<Recording>(DEFAULT_RECORDING);
    const [error, setError] = React.useState<string | null>(null);
    const [speed, setSpeed] = React.useState<number>(1);
    const [leftToRight, setLeftToRight] = React.useState(true);
    const [resultLast, setResultLast] = React.useState(true);
    const [scheme, setScheme] = React.useState<(typeof SCHEMES)[number]>('dark');
    const end = recording.times[recording.times.length - 1] ?? 0;
    const { playhead, setPlayhead, playing, setPlaying, play } = usePlayhead(end, speed);

    // The progress changes only with a payload, the replay runs again when the playhead passes one
    let step = -1;
    while (step + 1 < recording.times.length && recording.times[step + 1] <= playhead) step += 1;
    const orientation = leftToRight ? ORIENTATION.LEFT_TO_RIGHT : ORIENTATION.TOP_DOWN;
    const progress = React.useMemo(() => {
        if (core == null || step < 0) return null;
        try {
            return replayProgressRecording(core, recording.text, recording.times[step], createFlowLayoutConfig(orientation));
        } catch {
            return null;
        }
    }, [core, recording, step, orientation]);
    // The plan of the previous replay stays while a replay has no plan yet, e.g. while the query is queued
    const [plan, setPlan] = React.useState<typeof progress>(null);
    React.useEffect(() => {
        if (progress != null && progress.structure.read().operatorsLength() > 0) setPlan(progress);
    }, [progress]);
    React.useEffect(() => setPlan(null), [recording, orientation]);
    const shown = progress != null && progress.structure.read().operatorsLength() > 0 ? progress : plan;

    const open = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file == null || core == null) return;
        try {
            const next = readRecording(file.name.replace(/\.json$/, ''), await file.text());
            if (replayProgressRecording(core, next.text) == null) throw new Error('The recording has no progress');
            setError(null);
            setRecording(next);
            setPlayhead(0);
            setPlaying(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [core, setPlayhead, setPlaying]);

    return (
        <div className={styles.root} data-scheme={scheme}>
            <div className={styles.controls}>
                <span className={styles.title}>Query progress, flow</span>
                <div className={styles.transport}>
                    <Button
                        variant={ButtonVariant.Default}
                        size={ButtonSize.Small}
                        leadingVisual={playing ? PauseIcon : PlayIcon}
                        onClick={() => playing ? setPlaying(false) : play()}
                    >
                        {playing ? 'Pause' : playhead >= end ? 'Replay' : 'Play'}
                    </Button>
                    <input
                        className={styles.scrubber}
                        type="range"
                        min={0}
                        max={end}
                        step={10}
                        value={playhead}
                        aria-label="Point in time of the replay"
                        onChange={event => { setPlaying(false); setPlayhead(Number(event.target.value)); }}
                    />
                    <span className={styles.clock}>{(playhead / 1000).toFixed(1)} / {(end / 1000).toFixed(1)} s</span>
                    <SegmentedControl aria-label="Speed" size={SegmentedControlSize.Small} onChange={index => setSpeed(SPEEDS[index])}>
                        {SPEEDS.map(value => <SegmentedControl.Button key={value} selected={speed === value}>{`${value}×`}</SegmentedControl.Button>)}
                    </SegmentedControl>
                </div>
                <div className={styles.options}>
                    <SegmentedControl aria-label="Orientation" size={SegmentedControlSize.Small} onChange={index => setLeftToRight(index === 0)}>
                        <SegmentedControl.Button selected={leftToRight}>Horizontal</SegmentedControl.Button>
                        <SegmentedControl.Button selected={!leftToRight}>Vertical</SegmentedControl.Button>
                    </SegmentedControl>
                    <SegmentedControl aria-label="Direction of the data" size={SegmentedControlSize.Small} onChange={index => setResultLast(index === 0)}>
                        <SegmentedControl.Button selected={resultLast}>{leftToRight ? 'Result right' : 'Result bottom'}</SegmentedControl.Button>
                        <SegmentedControl.Button selected={!resultLast}>{leftToRight ? 'Result left' : 'Result top'}</SegmentedControl.Button>
                    </SegmentedControl>
                    <SegmentedControl aria-label="Color scheme" size={SegmentedControlSize.Small} onChange={index => setScheme(SCHEMES[index])}>
                        {SCHEMES.map(value => <SegmentedControl.Button key={value} selected={scheme === value}>{value === 'dark' ? 'Dark' : 'Light'}</SegmentedControl.Button>)}
                    </SegmentedControl>
                    <label className={styles.open}>
                        Open recording…
                        <input type="file" accept=".json,application/json" onChange={open} />
                    </label>
                </div>
            </div>
            {error != null && <div className={styles.error}>{error}</div>}
            <main className={styles.stage}>
                {core == null ? (
                    <div className={styles.placeholder}>Loading the core…</div>
                ) : shown == null ? (
                    <div className={styles.placeholder}>{step < 0 ? 'Waiting for the query…' : 'Queued, the plan arrives with the stages…'}</div>
                ) : (
                    <PlanFlowView
                        plan={shown.structure}
                        execution={progress?.execution ?? ProfileExecutionState.EMPTY}
                        elapsedMs={playhead}
                        engine="Trino"
                        title={recording.name}
                        resultLast={resultLast}
                    />
                )}
            </main>
        </div>
    );
}

/// Explore an adaptation of a timeline, a sidebar and edges as thick as their rows for the query progress, on a replay
/// of a recorded Trino query, in both orientations of the plan
export default function PlanFlowPage(): React.ReactElement {
    return (
        <DashQLCoreProvider>
            <PlanFlowDemo />
        </DashQLCoreProvider>
    );
}
