import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './query_progress_panel.module.css';

import { QueryExecutionState, QueryExecutionStatus } from '../../query/query_execution_state.js';
import { TabHeader } from '../../session/tab_header.js';
import { QueryProfileView } from '../query_profile/query_profile_view.js';
import { useQueryProfileDetail } from '../../connections/query_executor.js';
import {
    formatCompactBytes,
    formatCompactCount,
    formatElapsed,
    formatExecutionStatus,
    formatPhase,
    listProgressStages,
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

/// The status of a stage as data attribute value
function statusKey(status: dashql.buffers.profile.ProfileExecutionStatus): string {
    switch (status) {
        case view.ProfileExecutionStatus.RUNNING: return 'running';
        case view.ProfileExecutionStatus.SUCCEEDED: return 'succeeded';
        case view.ProfileExecutionStatus.FAILED: return 'failed';
        case view.ProfileExecutionStatus.PENDING: return 'pending';
        default: return 'other';
    }
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
    /// Cap the stage list at this many rows, then scroll
    maxStageRows?: number;
    /// Show the profile of the query (the plan with its stages) once the plan is known
    showProfile?: boolean;
}

/// The progress of a query: its phase, a progress bar, throughput and the stages with their progress
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
    const stages = React.useMemo(() => profileProgress == null ? [] : listProgressStages(profileProgress), [profileProgress]);
    const structure = profileProgress?.structure ?? null;
    const hasOperators = React.useMemo(() => structure != null && structure.read().operatorsLength() > 0, [structure]);
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

    return (
        <div className={styles.container} data-testid="query-progress-panel">
            <TabHeader title="Progress" detail={phaseLabel} />
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
            {stages.length > 0 && (
                <div
                    className={styles.stages}
                    style={props.maxStageRows == null ? undefined : { maxHeight: `${props.maxStageRows * 1.75}rem` }}
                    role="list"
                    aria-label="Stages"
                >
                    {stages.map(stage => (
                        <div key={stage.index} className={styles.stage} role="listitem" data-status={statusKey(stage.status)}>
                            <span className={styles.stage_name} style={{ paddingLeft: `${stage.depth * 0.75}rem` }}>
                                <span className={styles.stage_dot} aria-hidden />
                                Stage {stage.label}
                            </span>
                            <span className={styles.stage_status}>{formatExecutionStatus(stage.status)}</span>
                            <ProgressBar
                                fraction={stage.status === view.ProfileExecutionStatus.SUCCEEDED ? 1
                                    : stage.work == null ? null : stage.work.done / stage.work.total}
                                label={`Stage ${stage.label} progress`}
                                active={stage.status === view.ProfileExecutionStatus.RUNNING}
                            />
                            <span className={styles.stage_figure}>
                                {stage.work == null ? '' : `${formatCompactCount(stage.work.done)} / ${formatCompactCount(stage.work.total)}`}
                            </span>
                            <span className={styles.stage_figure}>{stage.rows == null ? '' : `${formatCompactCount(stage.rows)} rows`}</span>
                            <span className={styles.stage_figure}>{stage.cpuTimeUs == null ? '' : formatElapsed(stage.cpuTimeUs / 1000)}</span>
                        </div>
                    ))}
                </div>
            )}
            {props.showProfile && profileProgress != null && hasOperators && (
                <div className={styles.profile} data-testid="query-progress-profile">
                    <QueryProfileView plan={profileProgress.structure} execution={profileProgress.execution} showProgress />
                </div>
            )}
        </div>
    );
}

/// Does a query have structured progress to show?
export function hasQueryProgress(query: QueryExecutionState | null): boolean {
    return query?.latestProgressUpdate?.profileProgress != null;
}
