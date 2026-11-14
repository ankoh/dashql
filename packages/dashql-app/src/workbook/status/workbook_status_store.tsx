import * as React from 'react';

import { isWorkbookBusy, pickWorkbookStatus, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import type { Logger } from '../../platform/logger/logger.js';
import { WORKBOOK_LOG_KEY } from './workbook_log.js';

/// The status of a workbook as the bars of Wobble show it
export interface WorkbookStatusSnapshot {
    /// The conditions of the moment: what runs and what needs the user
    live: readonly WorkbookStatus[];
    /// How the latest thing ended, null before anything ended
    outcome: WorkbookStatus | null;
    /// The status that Wobble tells, null while nothing happened
    status: WorkbookStatus | null;
    /// Does anything run?
    busy: boolean;
}

const EMPTY_SNAPSHOT: WorkbookStatusSnapshot = { live: [], outcome: null, status: null, busy: false };

/// Two lists of statuses tell the same
function sameStatuses(left: readonly WorkbookStatus[], right: readonly WorkbookStatus[]): boolean {
    return left.length === right.length && left.every((status, i) => {
        const other = right[i];
        return status.key === other.key && status.tone === other.tone && status.text === other.text
            && status.detail === other.detail && status.scriptKey === other.scriptKey;
    });
}

/// The statuses of the workbooks, for the session. The sources of a workbook set their live statuses and the outcomes,
/// the bars of Wobble read them in any view of the workbook. The log of a workbook is the log of the app, see
/// `useWorkbookLog`.
export class WorkbookStatusStore {
    /// The live statuses of a workbook by source
    protected live = new Map<string, Map<string, readonly WorkbookStatus[]>>();
    protected outcomes = new Map<string, WorkbookStatus>();
    protected snapshots = new Map<string, WorkbookStatusSnapshot>();
    protected listeners = new Set<() => void>();

    /// Set the live statuses of a source of a workbook, an empty list removes them
    setLive(workbookId: string, source: string, statuses: readonly WorkbookStatus[]): void {
        let sources = this.live.get(workbookId);
        const current = sources?.get(source) ?? [];
        if (sameStatuses(current, statuses)) return;
        if (sources == null) {
            sources = new Map();
            this.live.set(workbookId, sources);
        }
        if (statuses.length === 0) sources.delete(source);
        else sources.set(source, statuses);
        this.changed(workbookId);
    }

    /// Set how the latest thing of a workbook ended
    setOutcome(workbookId: string, outcome: WorkbookStatus): void {
        this.outcomes.set(workbookId, outcome);
        this.changed(workbookId);
    }

    /// The status of a workbook, the same object until it changes
    snapshot(workbookId: string): WorkbookStatusSnapshot {
        let snapshot = this.snapshots.get(workbookId);
        if (snapshot == null) {
            const live = [...(this.live.get(workbookId)?.values() ?? [])].flat();
            const outcome = this.outcomes.get(workbookId) ?? null;
            snapshot = live.length === 0 && outcome == null
                ? EMPTY_SNAPSHOT
                : { live, outcome, status: pickWorkbookStatus(live, outcome), busy: isWorkbookBusy(live) };
            this.snapshots.set(workbookId, snapshot);
        }
        return snapshot;
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    protected changed(workbookId: string): void {
        this.snapshots.delete(workbookId);
        for (const listener of this.listeners) listener();
    }
}

/// The store of the app, tests provide their own
const APP_STORE = new WorkbookStatusStore();
export const WorkbookStatusContext = React.createContext<WorkbookStatusStore>(APP_STORE);

export function useWorkbookStatusStore(): WorkbookStatusStore {
    return React.useContext(WorkbookStatusContext);
}

/// The status of a workbook, follows its changes
export function useWorkbookStatus(workbookId: string): WorkbookStatusSnapshot {
    const store = useWorkbookStatusStore();
    return React.useSyncExternalStore(store.subscribe, () => store.snapshot(workbookId));
}

/// Publish the live statuses of a source while the component is mounted
export function useLiveWorkbookStatuses(workbookId: string, source: string, statuses: readonly WorkbookStatus[]): void {
    const store = useWorkbookStatusStore();
    React.useEffect(() => {
        store.setLive(workbookId, source, statuses);
    }, [store, workbookId, source, statuses]);
    React.useEffect(() => () => store.setLive(workbookId, source, []), [store, workbookId, source]);
}

/// The target of the records that tell how things of a workbook ended
export const WORKBOOK_STATUS_LOG_TARGET = 'workbook_status';

/// Tell how things of a workbook ended: a record of the log of the app each, the newest is the outcome of the bar
export function reportWorkbookOutcomes(store: WorkbookStatusStore, logger: Logger | null, workbookId: string, outcomes: readonly WorkbookStatus[]): void {
    for (const outcome of outcomes) {
        const fields: Record<string, string | undefined> = {
            [WORKBOOK_LOG_KEY]: workbookId,
            source: outcome.source,
            detail: outcome.detail ?? undefined,
            scriptKey: outcome.scriptKey != null ? String(outcome.scriptKey) : undefined,
        };
        if (outcome.tone === WorkbookStatusTone.Failed) logger?.warn(outcome.text, fields, WORKBOOK_STATUS_LOG_TARGET);
        else logger?.info(outcome.text, fields, WORKBOOK_STATUS_LOG_TARGET);
    }
    if (outcomes.length > 0) store.setOutcome(workbookId, outcomes[outcomes.length - 1]);
}

/// Report the outcomes of a workbook from a component
export function useReportWorkbookOutcomes(): (workbookId: string, outcomes: readonly WorkbookStatus[]) => void {
    const store = useWorkbookStatusStore();
    const logger = useLogger();
    return React.useCallback((workbookId, outcomes) => reportWorkbookOutcomes(store, logger, workbookId, outcomes), [store, logger]);
}

/// Calls `diff` with the previous and the next value whenever the value changes and reports the outcomes it returns.
/// The first value only sets the baseline, what happened before is not reported.
export function useWorkbookOutcomeTransitions<T>(workbookId: string, value: T, diff: (prev: T, next: T) => WorkbookStatus[]): void {
    const report = useReportWorkbookOutcomes();
    const prev = React.useRef<{ workbookId: string; value: T } | null>(null);
    const diffRef = React.useRef(diff);
    diffRef.current = diff;
    React.useEffect(() => {
        const last = prev.current;
        prev.current = { workbookId, value };
        if (last == null || last.workbookId !== workbookId || Object.is(last.value, value)) return;
        report(workbookId, diffRef.current(last.value, value));
    }, [report, workbookId, value]);
}
