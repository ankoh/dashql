import * as React from 'react';

import { isWorkbookBusy, pickWorkbookStatus, type WorkbookStatus } from './workbook_status.js';

/// The lines that the log of a workbook keeps
export const WORKBOOK_LOG_LIMIT = 500;

/// The status of a workbook as the bars of Wobble show it
export interface WorkbookStatusSnapshot {
    /// The conditions of the moment: what runs and what needs the user
    live: readonly WorkbookStatus[];
    /// The things that happened, the newest last
    log: readonly WorkbookStatus[];
    /// The status that Wobble tells, null while nothing happened
    status: WorkbookStatus | null;
    /// Does anything run?
    busy: boolean;
}

const EMPTY_SNAPSHOT: WorkbookStatusSnapshot = { live: [], log: [], status: null, busy: false };

/// Two lists of statuses tell the same
function sameStatuses(left: readonly WorkbookStatus[], right: readonly WorkbookStatus[]): boolean {
    return left.length === right.length && left.every((status, i) => {
        const other = right[i];
        return status.key === other.key && status.tone === other.tone && status.text === other.text
            && status.detail === other.detail && status.scriptKey === other.scriptKey;
    });
}

/// The statuses and the logs of the workbooks, for the session. The sources of a workbook set their live statuses
/// and push the lines of the log, the bars of Wobble read them in any view of the workbook.
export class WorkbookStatusStore {
    /// The live statuses of a workbook by source
    protected live = new Map<string, Map<string, readonly WorkbookStatus[]>>();
    protected logs = new Map<string, readonly WorkbookStatus[]>();
    protected snapshots = new Map<string, WorkbookStatusSnapshot>();
    protected listeners = new Set<() => void>();
    /// Numbers the lines that live statuses leave in the log
    protected nextLine = 1;

    /// Set the live statuses of a source of a workbook, an empty list removes them.
    /// A status that is new or tells something else leaves a line in the log, the log has every step.
    setLive(workbookId: string, source: string, statuses: readonly WorkbookStatus[], now: number = Date.now()): void {
        let sources = this.live.get(workbookId);
        const current = sources?.get(source) ?? [];
        if (sameStatuses(current, statuses)) return;
        const steps: WorkbookStatus[] = [];
        for (const status of statuses) {
            const before = current.find(s => s.key === status.key);
            if (before != null && before.tone === status.tone && before.text === status.text && before.detail === status.detail) continue;
            steps.push({ ...status, key: `${status.key}#${this.nextLine++}`, at: now, progress: true });
        }
        if (steps.length > 0) this.appendLog(workbookId, steps);
        if (sources == null) {
            sources = new Map();
            this.live.set(workbookId, sources);
        }
        if (statuses.length === 0) sources.delete(source);
        else sources.set(source, statuses);
        this.changed(workbookId);
    }

    /// Append lines to the log of a workbook
    push(workbookId: string, lines: readonly WorkbookStatus[]): void {
        if (lines.length === 0) return;
        this.appendLog(workbookId, lines);
        this.changed(workbookId);
    }

    protected appendLog(workbookId: string, lines: readonly WorkbookStatus[]): void {
        const next = (this.logs.get(workbookId) ?? []).concat(lines);
        this.logs.set(workbookId, next.length > WORKBOOK_LOG_LIMIT ? next.slice(next.length - WORKBOOK_LOG_LIMIT) : next);
    }

    /// The status of a workbook, the same object until it changes
    snapshot(workbookId: string): WorkbookStatusSnapshot {
        let snapshot = this.snapshots.get(workbookId);
        if (snapshot == null) {
            const live = [...(this.live.get(workbookId)?.values() ?? [])].flat();
            const log = this.logs.get(workbookId) ?? [];
            snapshot = live.length === 0 && log.length === 0
                ? EMPTY_SNAPSHOT
                : { live, log, status: pickWorkbookStatus(live, log), busy: isWorkbookBusy(live) };
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

/// Calls `diff` with the previous and the next value whenever the value changes and logs the lines it returns.
/// The first value only sets the baseline, what happened before is not logged.
export function useWorkbookLogTransitions<T>(workbookId: string, value: T, diff: (prev: T, next: T) => WorkbookStatus[]): void {
    const store = useWorkbookStatusStore();
    const prev = React.useRef<{ workbookId: string; value: T } | null>(null);
    const diffRef = React.useRef(diff);
    diffRef.current = diff;
    React.useEffect(() => {
        const last = prev.current;
        prev.current = { workbookId, value };
        if (last == null || last.workbookId !== workbookId || Object.is(last.value, value)) return;
        store.push(workbookId, diffRef.current(last.value, value));
    }, [store, workbookId, value]);
}
