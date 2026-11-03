import * as dashql from '@ankoh/dashql-core';
import { isStatReported, type ProfileEntityState } from '../../query/profile_execution_state.js';
import type { QueryProfileProgress } from '../../query/query_progress_model.js';

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

/// A stage (fragment) in the stage list
export interface ProgressStageRow {
    /// The fragment index
    index: number;
    /// The label, the engine id of the fragment
    label: string;
    /// The nesting depth
    depth: number;
    status: dashql.buffers.profile.ProfileExecutionStatus;
    work: ProgressWork | null;
    rows: number | null;
    cpuTimeUs: number | null;
}

/// The stages of a query, parents before their children
export function listProgressStages(progress: QueryProfileProgress): ProgressStageRow[] {
    const vm = progress.structure.read();
    const fragment = new view.ProfileFragment();
    const children: number[][] = [];
    const roots: number[] = [];
    for (let i = 0; i < vm.fragmentsLength(); ++i) children.push([]);
    for (let i = 0; i < vm.fragmentsLength(); ++i) {
        const parent = vm.fragments(i, fragment)!.parentFragment();
        if (parent < children.length) children[parent].push(i);
        else roots.push(i);
    }
    const rows: ProgressStageRow[] = [];
    const pending: [number, number][] = roots.reverse().map(r => [r, 0]);
    while (pending.length > 0) {
        const [index, depth] = pending.pop()!;
        const f = vm.fragments(index, fragment)!;
        const engineId = f.engineId();
        const state = progress.execution.fragments[index];
        rows.push({
            index,
            label: engineId < vm.stringDictionaryLength() ? vm.stringDictionary(engineId) : `${index}`,
            depth,
            status: state?.status ?? view.ProfileExecutionStatus.UNKNOWN,
            work: workOf(state),
            rows: stat(state, view.ProfileStatsField.TUPLES_IN, s => s.tuplesIn),
            cpuTimeUs: stat(state, view.ProfileStatsField.CPU_TIME, s => s.cpuTimeUs),
        });
        for (const child of [...children[index]].reverse()) pending.push([child, depth + 1]);
    }
    return rows;
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

/// The fraction of a progress bar that never moves backwards: Trino learns about splits while it schedules,
/// so done / total can shrink. Returns the new maximum.
export function monotonicFraction(previous: number, work: ProgressWork | null): number {
    if (work == null) return previous;
    return Math.max(previous, Math.min(1, work.done / work.total));
}
