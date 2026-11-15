import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import type { LoggableException } from '../platform/logger/logger.js';
import type { QueryExecutionAction, QueryExecutionProgress, QueryExecutionState, QueryExecutionTracker } from './query_execution_state.js';
import {
    applyQueryAction,
    projectQuery,
    queryRecord,
    updateQueryRecordProgress,
    type NativeQueryObjects,
    type QueryRecord,
} from './query_history_native.js';

export const SHELL_QUERY_HISTORY_LIMIT = 100;

/// The query history of the shell: a query history of the core of its own (`DashQLQueryHistory`) that keeps the last
/// `SHELL_QUERY_HISTORY_LIMIT` queries, the oldest finished ones leave first. The tracker keeps the result tables and
/// the JavaScript objects of the queries, `getSnapshot` lists the finished queries and then the active ones.
///
/// The tracker takes the core or a function that sets it up. Actions before the core is there wait for it, the first
/// one asks for it.
export class ShellQueryExecutionTracker implements QueryExecutionTracker, NativeQueryObjects {
    private history: core.DashQLQueryHistory | null = null;
    private pending: QueryExecutionAction[] | null = null;
    private readonly records = new Map<number, QueryRecord>();
    private readonly tables = new Map<number, arrow.Table>();
    private nextTableId = 1;
    private projected = new Map<number, { revision: number; state: QueryExecutionState }>();
    private revision: number | null = null;
    private snapshot: readonly QueryExecutionState[] = [];
    private readonly listeners = new Set<() => void>();

    constructor(private readonly setupCore: core.DashQL | (() => Promise<core.DashQL>), private readonly limit = SHELL_QUERY_HISTORY_LIMIT) {
        if (typeof setupCore !== 'function') this.history = setupCore.createQueryHistory(limit);
    }

    readonly getSnapshot = (): readonly QueryExecutionState[] => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    dispatch(action: QueryExecutionAction): void {
        if (this.history == null) {
            this.wait(action);
            return;
        }
        if (this.apply(this.history, action)) this.publish();
    }

    /// Free the history of the core, the tracker starts empty. A later action sets up a new history.
    release(): void {
        this.history?.destroy();
        this.history = null;
        this.pending = null;
        this.records.clear();
        this.tables.clear();
        this.projected = new Map();
        this.revision = null;
        if (this.snapshot.length > 0) {
            this.snapshot = [];
            for (const listener of this.listeners) listener();
        }
    }

    /// Keep an action until the core is there
    private wait(action: QueryExecutionAction): void {
        if (this.pending != null) {
            this.pending.push(action);
            return;
        }
        const pending = [action];
        this.pending = pending;
        const setup = this.setupCore;
        const instance = typeof setup === 'function' ? setup() : Promise.resolve(setup);
        instance.then(instance => {
            // Released in the meantime?
            if (this.pending !== pending) return;
            this.pending = null;
            const history = instance.createQueryHistory(this.limit);
            this.history = history;
            let changed = false;
            for (const action of pending) {
                try {
                    changed = this.apply(history, action) || changed;
                } catch {
                    // The history refuses the action, e.g. a query id that it knows, nobody waits for it anymore
                }
            }
            if (changed) this.publish();
        }, () => {
            // Without a core the shell has no history, the next action asks again
            if (this.pending === pending) this.pending = null;
        });
    }

    /// Apply an action to the history, returns whether it changed
    private apply(history: core.DashQLQueryHistory, action: QueryExecutionAction): boolean {
        const outcome = applyQueryAction(history, this, action, Date.now());
        // The projected queries keep their tables, e.g. the result that the shell shows after its query left
        for (const effect of outcome.effects) {
            if (effect.type === 'releaseResultTable') this.releaseTable(effect.tableId);
        }
        return outcome.changed;
    }

    // The JavaScript objects of the queries

    registerQuery(state: QueryExecutionState): void {
        if (!this.records.has(state.queryId)) this.records.set(state.queryId, queryRecord(state));
    }

    setQueryProgress(queryId: number, progress: QueryExecutionProgress): void {
        const record = this.records.get(queryId);
        if (record != null) updateQueryRecordProgress(record, progress);
    }

    setQueryError(queryId: number, error: LoggableException): void {
        const record = this.records.get(queryId);
        if (record != null) record.error = error;
    }

    registerTable(table: arrow.Table): number {
        const id = this.nextTableId++;
        this.tables.set(id, table);
        return id;
    }

    releaseTable(id: number): void {
        this.tables.delete(id);
    }

    /// Project the history and notify the listeners if it changed
    private publish(): void {
        const history = this.history;
        if (history == null) return;
        const revision = history.revision();
        if (revision === this.revision) return;
        this.revision = revision;
        const queries = history.queries();
        const snapshot: QueryExecutionState[] = [];
        const projected = new Map<number, { revision: number; state: QueryExecutionState }>();
        for (const [queryId, queryRevision] of [...queries.finished, ...queries.active]) {
            const previous = this.projected.get(queryId);
            const state = previous != null && previous.revision === queryRevision ? previous.state : this.project(history, queryId);
            if (state == null) continue;
            snapshot.push(state);
            projected.set(queryId, { revision: queryRevision, state });
        }
        // Forget the queries that left the history
        for (const queryId of this.records.keys()) {
            if (!projected.has(queryId)) this.records.delete(queryId);
        }
        this.projected = projected;
        this.snapshot = snapshot;
        for (const listener of this.listeners) listener();
    }

    /// The state of a query of the app
    private project(history: core.DashQLQueryHistory, queryId: number): QueryExecutionState | null {
        const record = this.records.get(queryId);
        const snapshot = history.query(queryId);
        if (record == null || snapshot == null) return null;
        const resultTable = snapshot.resultTable == null ? null : (this.tables.get(snapshot.resultTable.id) ?? null);
        return projectQuery(snapshot, record, resultTable, 'shell');
    }
}
