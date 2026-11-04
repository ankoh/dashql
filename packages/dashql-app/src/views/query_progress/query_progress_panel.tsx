import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './query_progress_panel.module.css';

import { QueryExecutionState, QueryExecutionStatus } from '../../query/query_execution_state.js';
import { TabHeader } from '../../session/tab_header.js';
import { QueryProfileView } from '../query_profile/query_profile_view.js';
import { useQueryProfileDetail } from '../../connections/query_executor.js';
import { QueryProgressFollower, type QueryProfileProgress } from '../../query/query_progress_model.js';
import { createProfileLayoutConfig, rotateProfileLayoutOrientation } from '../query_profile/profile_layout_config.js';
import { useDashQLCoreSetup, type DashQLSetupFn } from '../../runtime/core_provider.js';
import { useFileDownloader } from '../../platform/file/file_downloader_hook.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { DownloadIcon, ScreenFullIcon } from '../../ui/foundations/symbol_icon.js';
import { QueryProfileOverlay } from './query_profile_overlay.js';
import {
    formatCompactBytes,
    formatCompactCount,
    formatElapsed,
    formatPhase,
    monotonicFraction,
    stat,
    workOf,
    type ProgressWork,
} from './query_progress_model.js';

const view = dashql.buffers.profile;

/// Is a query still running?
function isActive(status: QueryExecutionStatus): boolean {
    return status !== QueryExecutionStatus.SUCCEEDED && status !== QueryExecutionStatus.FAILED
        && status !== QueryExecutionStatus.CANCELLED;
}

/// The end of a query, null while it runs
function finishedAt(query: QueryExecutionState): Date | null {
    return query.metrics.querySucceededAt ?? query.metrics.queryFailedAt ?? query.metrics.queryCancelledAt;
}

/// The milliseconds since the query was requested, ticking every second while the query runs
function useElapsed(query: QueryExecutionState): number {
    const active = isActive(query.status);
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);
    const start = query.metrics.queryRequestedAt?.getTime() ?? now;
    const end = finishedAt(query)?.getTime() ?? now;
    return Math.max(0, end - start);
}

/// A progress fraction that never moves backwards within a query
function useMonotonicFraction(queryId: number, work: ProgressWork | null): number | null {
    const state = React.useRef({ queryId, fraction: 0, known: false });
    if (state.current.queryId !== queryId) state.current = { queryId, fraction: 0, known: false };
    if (work != null) {
        state.current.fraction = monotonicFraction(state.current.fraction, work);
        state.current.known = true;
    }
    return state.current.known ? state.current.fraction : null;
}

/// A progress bar, indeterminate without a fraction
function ProgressBar(props: { fraction: number | null; label: string; active: boolean }) {
    const percent = props.fraction == null ? null : Math.round(props.fraction * 100);
    return (
        <div
            className={styles.bar}
            role="progressbar"
            aria-label={props.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            data-indeterminate={props.fraction == null && props.active}
        >
            <div className={styles.bar_fill} style={{ width: `${percent ?? 0}%` }} />
        </div>
    );
}

/// A labeled figure of the query strip
function Figure(props: { label: string; value: string | null }) {
    if (props.value == null) return null;
    return (
        <div className={styles.figure}>
            <span className={styles.figure_label}>{props.label}</span>
            <span className={styles.figure_value}>{props.value}</span>
        </div>
    );
}

interface QueryProgressPanelProps {
    query: QueryExecutionState;
    /// Show the profile of the query (the plan with its stages) once the plan is known
    showProfile?: boolean;
    /// The height of the profile in pixels, 360 by default
    profileHeight?: number;
}


/// Download the recording of the progress of a query, replaying it in the profile simulator reproduces the profile
function DownloadRecordingButton(props: { queryId: number; progress: QueryProfileProgress }) {
    const fileDownloader = useFileDownloader();
    const download = React.useCallback(() => {
        const text = JSON.stringify(props.progress.recording());
        void fileDownloader.downloadBufferAsFile(new TextEncoder().encode(text), `query-${props.queryId}-profile.json`);
    }, [fileDownloader, props.progress, props.queryId]);
    return (
        <IconButton
            variant={ButtonVariant.Invisible}
            size={ButtonSize.Small}
            aria-label="Download the profile recording"
            description="Download the recording of the progress, the profile simulator replays it"
            data-testid="download-profile-recording"
            onClick={download}
        >
            <DownloadIcon size={16} />
        </IconButton>
    );
}

/// The progress of a query with its plan laid out in the other orientation, while rotated. The progress model of
/// the query keeps its layout, a follower of the panel applies the recorded payloads again. Without core, e.g.
/// while it loads, the progress stays as it is.
function useRotatedProgress(progress: QueryProfileProgress, rotated: boolean): QueryProfileProgress {
    const coreSetup = useDashQLCoreSetup() as DashQLSetupFn | null;
    const [core, setCore] = React.useState<dashql.DashQL | null>(null);
    React.useEffect(() => {
        if (!rotated || core != null || coreSetup == null) return;
        let cancelled = false;
        coreSetup('query_progress').then(
            instance => { if (!cancelled) setCore(instance); },
            () => { /* The plan stays in its orientation */ },
        );
        return () => { cancelled = true; };
    }, [rotated, core, coreSetup]);

    const follower = React.useRef<QueryProgressFollower | null>(null);
    React.useEffect(() => () => {
        follower.current?.destroy();
        follower.current = null;
    }, []);
    return React.useMemo(() => {
        if (!rotated || core == null) {
            follower.current?.destroy();
            follower.current = null;
            return progress;
        }
        const orientation = progress.structure.read().layoutConfig()?.input()?.orientation()
            ?? dashql.buffers.profile.ProfileLayoutOrientation.LEFT_TO_RIGHT;
        follower.current ??= new QueryProgressFollower(core, createProfileLayoutConfig(rotateProfileLayoutOrientation(orientation)));
        return follower.current.follow(progress) ?? progress;
    }, [core, progress, rotated]);
}

/// The profile of a query with the progress of its stages on their contours, once the plan is known
export function ProfileProgressDetails(props: { progress: QueryProfileProgress; height?: number | string }) {
    const [rotated, setRotated] = React.useState(false);
    const progress = useRotatedProgress(props.progress, rotated);
    const rotate = React.useCallback(() => setRotated(value => !value), []);
    const hasOperators = React.useMemo(() => progress.structure.read().operatorsLength() > 0, [progress.structure]);
    if (!hasOperators) return null;
    return (
        <div className={styles.profile} style={props.height == null ? undefined : { height: props.height }} data-testid="query-progress-profile">
            <QueryProfileView plan={progress.structure} execution={progress.execution} onRotate={rotate} showProgress fill />
        </div>
    );
}

/// The progress of a query: its phase, a progress bar, throughput and the profile with the progress of its stages
export function QueryProgressPanel(props: QueryProgressPanelProps) {
    const { query } = props;
    // The connector fetches the plan and its statistics only while a profile is shown
    useQueryProfileDetail(query.queryId, props.showProfile === true);
    const progress = query.latestProgressUpdate;
    const profileProgress = progress?.profileProgress ?? null;
    const queryState = profileProgress?.execution.query ?? null;
    const active = isActive(query.status);
    const elapsedMs = useElapsed(query);
    const work = workOf(queryState);
    const fraction = useMonotonicFraction(query.queryId, work);
    const structure = profileProgress?.structure ?? null;
    // Trino counts work in splits, other engines report a fraction
    const countsSplits = React.useMemo(() => structure?.read().engine() === dashql.buffers.profile.ProfileEngine.TRINO, [structure]);

    const rows = stat(queryState, view.ProfileStatsField.TUPLES_IN, s => s.tuplesIn) ?? progress?.rowsProcessed ?? null;
    const cpuUs = stat(queryState, view.ProfileStatsField.CPU_TIME, s => s.cpuTimeUs);
    const memory = stat(queryState, view.ProfileStatsField.MEMORY_BYTES, s => s.memoryBytes);
    const spilled = stat(queryState, view.ProfileStatsField.SPILLED_BYTES, s => s.spilledBytes);
    const phase = active ? (progress?.phase ?? null) : null;
    const phaseLabel = phase != null ? formatPhase(phase) : QueryExecutionStatus[query.status] != null
        ? formatPhase(QueryExecutionStatus[query.status]) : null;
    const seconds = elapsedMs / 1000;
    const [profileOpen, setProfileOpen] = React.useState(false);
    const showsProfile = props.showProfile === true && profileProgress != null;
    const hasOperators = React.useMemo(() => (structure?.read().operatorsLength() ?? 0) > 0, [structure]);

    return (
        <div className={styles.container} data-testid="query-progress-panel">
            <TabHeader
                title="Progress"
                detail={phaseLabel}
                actions={showsProfile
                    ? (
                        <>
                            <DownloadRecordingButton queryId={query.queryId} progress={profileProgress} />
                            {hasOperators && <IconButton
                                variant={ButtonVariant.Invisible}
                                size={ButtonSize.Small}
                                aria-label="Open the query plan"
                                description="Open the plan with the progress of its stages in a large card"
                                data-testid="open-query-profile"
                                onClick={() => setProfileOpen(true)}
                            >
                                <ScreenFullIcon size={16} />
                            </IconButton>}
                        </>
                    )
                    : undefined}
            />
            <div className={styles.strip}>
                <ProgressBar
                    fraction={!active && query.status === QueryExecutionStatus.SUCCEEDED ? 1 : fraction}
                    label="Query progress"
                    active={active}
                />
                <div className={styles.figures}>
                    <Figure label="Elapsed" value={formatElapsed(elapsedMs)} />
                    <Figure label="Splits" value={work == null || !countsSplits ? null : `${formatCompactCount(work.done)} / ${formatCompactCount(work.total)}`} />
                    <Figure label="Rows" value={rows == null ? null : formatCompactCount(rows)} />
                    <Figure label="Rows/s" value={rows == null || seconds < 0.5 ? null : formatCompactCount(rows / seconds)} />
                    <Figure label="CPU" value={cpuUs == null ? null : formatElapsed(cpuUs / 1000)} />
                    <Figure label="Memory" value={memory == null ? null : formatCompactBytes(memory)} />
                    <Figure label="Spilled" value={spilled == null || spilled === 0 ? null : formatCompactBytes(spilled)} />
                </div>
            </div>
            {showsProfile && <ProfileProgressDetails progress={profileProgress} height={props.profileHeight} />}
            {/* The card follows the progress of the query while it runs */}
            {showsProfile && profileOpen && (
                <QueryProfileOverlay onClose={() => setProfileOpen(false)}>
                    <ProfileProgressDetails progress={profileProgress} height="100%" />
                </QueryProfileOverlay>
            )}
        </div>
    );
}

/// Does a query have structured progress to show?
export function hasQueryProgress(query: QueryExecutionState | null): boolean {
    return query?.latestProgressUpdate?.profileProgress != null;
}
