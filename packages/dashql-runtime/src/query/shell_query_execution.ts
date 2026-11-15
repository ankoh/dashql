import type * as core from '@ankoh/dashql-core';

import { handlesOf, type HandleTable } from '../store/handles.js';
import type { QueryExecutionAction, QueryExecutionState, QueryExecutionTracker } from './query_execution_state.js';
import { applyQueryAction, QueryProjection } from './query_history_native.js';

export const SHELL_QUERY_HISTORY_LIMIT = 100;

/// The query history of the shell: a query history of the core of its own (`DashQLQueryHistory`) that keeps the last
/// `SHELL_QUERY_HISTORY_LIMIT` queries, the oldest finished ones leave first. The result tables and the JavaScript
/// objects of the queries are handles of the runtime of the core (store/handles.ts), the effects of the history
/// release them. `getSnapshot` lists the finished queries and then the active ones.
///
/// The tracker takes the core or a function that sets it up. Actions before the core is there wait for it, the first
/// one asks for it.
export class ShellQueryExecutionTracker implements QueryExecutionTracker {
    private history: core.DashQLQueryHistory | null = null;
    /// The handles of the runtime of the core of the history
    private handles: HandleTable | null = null;
    private pending: QueryExecutionAction[] | null = null;
    private readonly projection = new QueryProjection('shell');
    private revision: number | null = null;
    private snapshot: readonly QueryExecutionState[] = [];
    private readonly listeners = new Set<() => void>();

    constructor(private readonly setupCore: core.DashQL | (() => Promise<core.DashQL>), private readonly limit = SHELL_QUERY_HISTORY_LIMIT) {
        if (typeof setupCore !== 'function') {
            this.history = setupCore.createQueryHistory(limit);
            this.handles = handlesOf(setupCore);
        }
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

    /// Free the history of the core, the tracker starts empty. A later action sets up a new history. The queries keep
    /// running, their handles go.
    release(): void {
        const history = this.history;
        if (history != null) {
            for (const effect of history.clear().effects) {
                if (effect.type === 'release') this.handles?.release(effect.handle);
            }
            history.destroy();
        }
        this.history = null;
        this.pending = null;
        this.projection.clear();
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
            this.handles = handlesOf(instance);
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
        const handles = this.handles;
        if (handles == null) return false;
        const outcome = applyQueryAction(history, handles, action, Date.now());
        // The projected queries keep their tables, e.g. the result that the shell shows after its query left
        handles.apply(outcome.effects);
        return outcome.changed;
    }

    /// Project the history and notify the listeners if it changed
    private publish(): void {
        const history = this.history;
        const handles = this.handles;
        if (history == null || handles == null) return;
        const revision = history.revision();
        if (revision === this.revision) return;
        this.revision = revision;
        const queries = history.queries();
        const snapshot: QueryExecutionState[] = [];
        const ids: number[] = [];
        for (const [queryId, queryRevision] of [...queries.finished, ...queries.active]) {
            const state = this.projection.state(history, queryId, queryRevision, handles);
            if (state == null) continue;
            snapshot.push(state);
            ids.push(queryId);
        }
        // Forget the queries that left the history
        this.projection.retain(ids);
        this.snapshot = snapshot;
        for (const listener of this.listeners) listener();
    }
}
