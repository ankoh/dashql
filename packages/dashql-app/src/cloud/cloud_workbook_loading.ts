import * as React from 'react';

import { IndicatorStatus } from '@akohn/dashql-react/components/status_indicator';

// The steps of loading a version of a published workbook, shown by a card in place of the feed. The version is
// downloaded, its connections resolved, its scripts and attachments saved, its query results added to the workbook and
// the workbook opened. A step without anything to do, e.g. a version without attachments, is skipped. See docs/design/cloud.md.

/// The steps in order
export const CLOUD_LOADING_STEPS = ['download', 'connections', 'scripts', 'attachments', 'results', 'open'] as const;
export type CloudLoadingStepId = typeof CLOUD_LOADING_STEPS[number];

export interface CloudLoadingStep {
    id: CloudLoadingStepId;
    status: IndicatorStatus;
    /// A short detail, e.g. a count
    detail: string | null;
}

/// A version of a published workbook that is being loaded
export interface CloudWorkbookLoading {
    /// The name of the published workbook
    name: string;
    /// Is it loaded as a preview, or imported?
    preview: boolean;
    steps: CloudLoadingStep[];
    /// Why the loading failed, the card stays until it is closed
    error: string | null;
}

/// What a downloaded version holds
export interface CloudLoadingCounts {
    version: number;
    connections: number;
    results: number;
    scripts: number;
    attachments: number;
}

function count(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

function update(state: CloudWorkbookLoading, id: CloudLoadingStepId, patch: Partial<CloudLoadingStep>): CloudWorkbookLoading {
    return { ...state, steps: state.steps.map(step => step.id === id ? { ...step, ...patch } : step) };
}

/// Start loading, the download runs
export function startCloudLoading(name: string, preview: boolean): CloudWorkbookLoading {
    return {
        name,
        preview,
        error: null,
        steps: CLOUD_LOADING_STEPS.map(id => ({ id, status: id === 'download' ? IndicatorStatus.Running : IndicatorStatus.None, detail: null })),
    };
}

/// The version is downloaded, the steps that have nothing to do are skipped
export function cloudLoadingDownloaded(state: CloudWorkbookLoading, counts: CloudLoadingCounts): CloudWorkbookLoading {
    const details: Record<Exclude<CloudLoadingStepId, 'open'>, [number | null, string | null]> = {
        download: [null, `Version ${counts.version}`],
        connections: [counts.connections, count(counts.connections, 'connection', 'connections')],
        results: [counts.results, count(counts.results, 'result', 'results')],
        scripts: [counts.scripts, count(counts.scripts, 'script', 'scripts')],
        attachments: [counts.attachments, count(counts.attachments, 'attachment', 'attachments')],
    };
    let next = update(state, 'download', { status: IndicatorStatus.Succeeded, detail: details.download[1] });
    for (const id of ['connections', 'results', 'scripts', 'attachments'] as const) {
        const [n, detail] = details[id];
        next = update(next, id, n === 0 ? { status: IndicatorStatus.Skip, detail: 'None' } : { detail });
    }
    return next;
}

/// A step runs, the step that ran before succeeded. A skipped step stays skipped.
export function cloudLoadingStep(state: CloudWorkbookLoading, id: CloudLoadingStepId): CloudWorkbookLoading {
    const target = state.steps.find(step => step.id === id);
    if (target == null || target.status === IndicatorStatus.Skip || target.status === IndicatorStatus.Running) return state;
    const steps = state.steps.map(step => step.status === IndicatorStatus.Running ? { ...step, status: IndicatorStatus.Succeeded } : step);
    return update({ ...state, steps }, id, { status: IndicatorStatus.Running });
}

/// The detail of a step, and its status once it is known
export function cloudLoadingDetail(state: CloudWorkbookLoading, id: CloudLoadingStepId, detail: string, status?: IndicatorStatus): CloudWorkbookLoading {
    return update(state, id, status == null ? { detail } : { detail, status });
}

/// The loading failed at the step that runs
export function cloudLoadingFailed(state: CloudWorkbookLoading, error: string): CloudWorkbookLoading {
    return {
        ...state,
        error,
        steps: state.steps.map(step => step.status === IndicatorStatus.Running ? { ...step, status: IndicatorStatus.Failed } : step),
    };
}

let loading: CloudWorkbookLoading | null = null;
const listeners = new Set<() => void>();

/// Show the loading of a version, null once it is done
export function setCloudWorkbookLoading(next: CloudWorkbookLoading | null): void {
    loading = next;
    for (const listener of listeners) listener();
}

/// Change the loading that is shown
export function updateCloudWorkbookLoading(change: (state: CloudWorkbookLoading) => CloudWorkbookLoading): void {
    if (loading != null) setCloudWorkbookLoading(change(loading));
}

/// The version of a published workbook that is being loaded, null if none
export function useCloudWorkbookLoading(): CloudWorkbookLoading | null {
    return React.useSyncExternalStore(listener => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, () => loading);
}
