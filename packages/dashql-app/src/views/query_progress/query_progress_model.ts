import * as dashql from '@ankoh/dashql-core';
import { isStatReported, type ProfileEntityState } from '../../query/profile_execution_state.js';
import type { QueryProfileProgress } from '../../query/query_progress_model.js';
import type { QueryExecutionProgress } from '../../query/query_execution_state.js';

const view = dashql.buffers.profile;
type ProfileStatsT = dashql.buffers.profile.ProfileStatsT;

/// A statistic as number, null if not reported
export function stat(state: ProfileEntityState | null | undefined, field: dashql.buffers.profile.ProfileStatsField, value: (stats: ProfileStatsT) => bigint): number | null {
    if (state == null || !isStatReported(state.stats, field)) return null;
    return Number(value(state.stats));
}

/// The work of an entity: completed and known units (splits for Trino)
export interface ProgressWork {
    done: number;
    total: number;
}

/// The work of an entity, null if unknown or nothing is scheduled yet
export function workOf(state: ProfileEntityState | null | undefined): ProgressWork | null {
    const done = stat(state, view.ProfileStatsField.WORK_DONE, s => s.workDone);
    const total = stat(state, view.ProfileStatsField.WORK_TOTAL, s => s.workTotal);
    if (done == null || total == null || total === 0) return null;
    return { done: Math.min(done, total), total };
}

/// A label of an execution status
export function formatExecutionStatus(status: dashql.buffers.profile.ProfileExecutionStatus): string {
    switch (status) {
        case view.ProfileExecutionStatus.PENDING: return 'Pending';
        case view.ProfileExecutionStatus.RUNNING: return 'Running';
        case view.ProfileExecutionStatus.SUCCEEDED: return 'Done';
        case view.ProfileExecutionStatus.FAILED: return 'Failed';
        case view.ProfileExecutionStatus.SKIPPED: return 'Skipped';
        default: return 'Unknown';
    }
}

/// A phase name of an engine (QUEUED, WAITING_FOR_RESOURCES) as label (Queued, Waiting for resources)
export function formatPhase(phase: string): string {
    const words = phase.toLowerCase().replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/// Format a count compactly, e.g. 12, 1.3K, 2.1M, 4.2B
export function formatCompactCount(count: number): string {
    if (count < 1000) return Math.round(count).toString();
    if (count < 1e6) return `${Number((count / 1e3).toPrecision(3))}K`;
    if (count < 1e9) return `${Number((count / 1e6).toPrecision(3))}M`;
    return `${Number((count / 1e9).toPrecision(3))}B`;
}

/// Format a duration in milliseconds, e.g. 850 ms, 1.24 s, 2m 03s, 1h 02m
export function formatElapsed(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${Number(seconds.toPrecision(3))} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${Math.floor(seconds - minutes * 60).toString().padStart(2, '0')}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${(minutes - hours * 60).toString().padStart(2, '0')}m`;
}

/// Format bytes compactly, e.g. 512 B, 7.8 MB
export function formatCompactBytes(bytes: number): string {
    if (bytes < 1000) return `${Math.round(bytes)} B`;
    const units = ['kB', 'MB', 'GB', 'TB', 'PB'];
    let value = bytes / 1000;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit += 1;
    }
    return `${Number(value.toPrecision(3))} ${units[unit]}`;
}

/// A short summary of the progress of a running query for its status line, e.g. `Planning` or `42% · 1.2M rows/s`.
/// Null without structured progress.
export function summarizeQueryProgress(progress: QueryExecutionProgress | null): string | null {
    const execution = progress?.profileProgress?.execution;
    if (progress == null || execution == null) return null;
    const parts: string[] = [];
    if (progress.phase != null && progress.phase !== 'RUNNING') parts.push(formatPhase(progress.phase));
    const work = workOf(execution.query);
    if (work != null) parts.push(`${Math.floor((work.done / work.total) * 100)}%`);
    const rows = stat(execution.query, view.ProfileStatsField.TUPLES_IN, s => s.tuplesIn);
    const seconds = (progress.executionTimeMs ?? 0) / 1000;
    if (rows != null && rows > 0 && seconds >= 1) parts.push(`${formatCompactCount(rows / seconds)} rows/s`);
    return parts.length === 0 ? null : parts.join(' · ');
}

/// The fraction of a progress bar that never moves backwards: Trino learns about splits while it schedules,
/// so done / total can shrink. Returns the new maximum.
export function monotonicFraction(previous: number, work: ProgressWork | null): number {
    if (work == null) return previous;
    return Math.max(previous, Math.min(1, work.done / work.total));
}
