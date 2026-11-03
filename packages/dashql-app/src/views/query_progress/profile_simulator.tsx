import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './profile_simulator.module.css';

import { useDashQLCoreSetup } from '../../runtime/core_provider.js';
import { readProfileRecording, recordingDuration, replayRecording, type ProfileRecording } from '../../query/query_progress_model.js';
import { createProfileLayoutConfig } from '../query_profile/profile_layout_config.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { XIcon } from '../../ui/foundations/symbol_icon.js';
import { ProfileProgressDetails } from './query_progress_panel.js';
import { formatElapsed, formatExecutionStatus, workOf } from './query_progress_model.js';

/// The step of the playback in milliseconds of the recording
const PLAYBACK_STEP_MS = 250;
/// The playback runs this much faster than the recording
const PLAYBACK_SPEED = 4;

interface ProfileSimulatorProps {
    onClose: () => void;
}

/// Replays the recording of the progress of a query: a recording downloaded from the Progress tab, or a recording
/// of the Trino test harness (snapshots/profiles/trino/recordings/). The slider seeks, replaying the payloads up
/// to that point through the adapters of the core.
export function ProfileSimulator(props: ProfileSimulatorProps) {
    const coreSetup = useDashQLCoreSetup();
    const [core, setCore] = React.useState<dashql.DashQL | null>(null);
    const [recording, setRecording] = React.useState<{ name: string; recording: ProfileRecording } | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [time, setTime] = React.useState(0);
    const [playing, setPlaying] = React.useState(false);
    const layout = React.useMemo(() => createProfileLayoutConfig(true), []);

    React.useEffect(() => {
        let cancelled = false;
        void coreSetup('profile_simulator').then(instance => { if (!cancelled) setCore(instance); });
        return () => { cancelled = true; };
    }, [coreSetup]);

    const duration = recording == null ? 0 : recordingDuration(recording.recording);
    const progress = React.useMemo(() => {
        if (core == null || recording == null) return null;
        try {
            return replayRecording(core, recording.recording, time, layout);
        } catch (e) {
            console.warn(e);
            return null;
        }
    }, [core, recording, time, layout]);

    // Play the recording until its end
    React.useEffect(() => {
        if (!playing) return;
        const timer = setInterval(() => {
            setTime(current => {
                const next = Math.min(duration, current + PLAYBACK_STEP_MS);
                if (next >= duration) setPlaying(false);
                return next;
            });
        }, PLAYBACK_STEP_MS / PLAYBACK_SPEED);
        return () => clearInterval(timer);
    }, [playing, duration]);

    const loadFile = React.useCallback(async (file: File | undefined) => {
        if (file == null) return;
        try {
            const loaded = readProfileRecording(await file.text());
            setRecording({ name: file.name, recording: loaded });
            setTime(recordingDuration(loaded));
            setPlaying(false);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, []);

    const query = progress?.execution.query ?? null;
    const work = workOf(query);
    return (
        <div className={styles.container} data-testid="profile-simulator">
            <div className={styles.header}>
                <span className={styles.title}>Profile simulator</span>
                <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Close" onClick={props.onClose}>
                    <XIcon size={16} />
                </IconButton>
            </div>
            <div className={styles.controls}>
                <input
                    type="file"
                    accept="application/json,.json"
                    aria-label="Profile recording"
                    data-testid="profile-simulator-file"
                    onChange={e => void loadFile(e.target.files?.[0])}
                />
                {recording != null && (
                    <>
                        <button type="button" className={styles.play} onClick={() => {
                            if (time >= duration) setTime(0);
                            setPlaying(p => !p);
                        }}>
                            {playing ? 'Pause' : 'Play'}
                        </button>
                        <input
                            type="range"
                            className={styles.slider}
                            min={0}
                            max={duration}
                            step={PLAYBACK_STEP_MS / 5}
                            value={time}
                            aria-label="Time in the recording"
                            data-testid="profile-simulator-time"
                            onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }}
                        />
                        <span className={styles.time}>{formatElapsed(time)} / {formatElapsed(duration)}</span>
                    </>
                )}
            </div>
            {error != null && <div className={styles.error} role="alert">{error}</div>}
            {recording != null && (
                <div className={styles.summary} data-testid="profile-simulator-summary">
                    <span>{recording.name}</span>
                    <span>{recording.recording.payloads.length} payloads</span>
                    {query != null && <span>Query {formatExecutionStatus(query.status).toLowerCase()}</span>}
                    {work != null && <span>{Math.floor((work.done / work.total) * 100)}%</span>}
                </div>
            )}
            <div className={styles.body}>
                {progress != null && <ProfileProgressDetails progress={progress} showProfile />}
            </div>
        </div>
    );
}
