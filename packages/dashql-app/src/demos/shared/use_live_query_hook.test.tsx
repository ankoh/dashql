import * as arrow from 'apache-arrow';
import * as React from 'react';
import { act, waitForRender } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HyperDBSourceConnection, HyperDBSourceDatabase } from '../../platform/hyperdb/hyperdb_incremental_extract.js';
import { NO_LIVE_QUERY_RESULT, useLiveQuery, type LiveQueryState } from './use_live_query.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

/// A database whose queries wait for the outcome that the test releases.
/// The loop runs a query every few milliseconds, so the test could otherwise miss the result of a run.
class ScriptedDatabase implements HyperDBSourceDatabase {
    queries: string[] = [];
    closes = 0;
    private outcomes: (arrow.Table | Error)[] = [];
    private wake: () => void = () => { };

    /// Release the outcome of the next query
    release(outcome: arrow.Table | Error): void {
        this.outcomes.push(outcome);
        this.wake();
    }

    async connect(): Promise<HyperDBSourceConnection> {
        return {
            query: async (sql: string, signal?: AbortSignal) => {
                this.queries.push(sql);
                for (;;) {
                    if (signal?.aborted) throw new Error('aborted');
                    const outcome = this.outcomes.shift();
                    if (outcome instanceof Error) throw outcome;
                    if (outcome != null) return outcome;
                    await new Promise<void>(resolve => {
                        this.wake = resolve;
                        signal?.addEventListener('abort', () => resolve(), { once: true });
                    });
                }
            },
            execute: async () => null,
            close: async () => { this.closes++; },
        };
    }
}

describe('useLiveQuery', () => {
    let root: Root;
    let state: LiveQueryState;

    function Probe(props: { database: HyperDBSourceDatabase | null; sql: string | null }) {
        state = useLiveQuery(props.database, props.sql, 50);
        return null;
    }

    beforeEach(() => {
        // The loop skips its runs while the page is hidden, the test page may run in a background tab
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
        Reflect.deleteProperty(document, 'hidden');
    });

    it('has no result without a database or a query', () => {
        act(() => root.render(<Probe database={null} sql="select 1" />));
        expect(state).toEqual(NO_LIVE_QUERY_RESULT);
        act(() => root.render(<Probe database={new ScriptedDatabase()} sql={null} />));
        expect(state).toEqual(NO_LIVE_QUERY_RESULT);
    });

    it('keeps the previous result on screen when a run fails', async () => {
        const database = new ScriptedDatabase();
        await act(async () => root.render(<Probe database={database} sql="select x from t" />));
        database.release(tableFromArrays({ x: [1, 2] }));
        await waitForRender(() => expect(state.table?.numRows).toBe(2));
        expect(state.error).toBeNull();
        expect(state.latencyMs).toBeGreaterThanOrEqual(0);

        database.release(new Error('table not found'));
        await waitForRender(() => expect(state.error?.message).toBe('table not found'));
        expect(state.table?.numRows).toBe(2);
        expect(database.queries.slice(0, 2)).toEqual(['select x from t', 'select x from t']);
    });

    it('restarts with a new query and stops when unmounted', async () => {
        const database = new ScriptedDatabase();
        await act(async () => root.render(<Probe database={database} sql="select x" />));
        database.release(tableFromArrays({ x: [1] }));
        await waitForRender(() => expect(state.table?.numRows).toBe(1));
        await act(async () => root.render(<Probe database={database} sql="select y" />));
        database.release(tableFromArrays({ y: [1, 2, 3] }));
        await waitForRender(() => expect(state.table?.numRows).toBe(3));
        expect([...new Set(database.queries)]).toEqual(['select x', 'select y']);
        await act(async () => root.render(<Probe database={null} sql={null} />));
        await waitForRender(() => expect(state).toEqual(NO_LIVE_QUERY_RESULT));
        await waitForRender(() => expect(database.closes).toBe(2));
    });
});
