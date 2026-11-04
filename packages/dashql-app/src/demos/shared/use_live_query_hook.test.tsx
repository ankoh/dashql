import * as arrow from 'apache-arrow';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HyperDBSourceConnection, HyperDBSourceDatabase } from '../../platform/hyperdb/hyperdb_incremental_extract.js';
import { NO_LIVE_QUERY_RESULT, useLiveQuery, type LiveQueryState } from './use_live_query.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

/// A database whose queries return the next scripted outcome
class ScriptedDatabase implements HyperDBSourceDatabase {
    outcomes: (arrow.Table | Error)[] = [];
    queries: string[] = [];
    closes = 0;

    async connect(): Promise<HyperDBSourceConnection> {
        return {
            query: async (sql: string) => {
                this.queries.push(sql);
                const outcome = this.outcomes.shift() ?? new Error('no more results');
                if (outcome instanceof Error) throw outcome;
                return outcome;
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
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
    });

    it('has no result without a database or a query', () => {
        act(() => root.render(<Probe database={null} sql="select 1" />));
        expect(state).toEqual(NO_LIVE_QUERY_RESULT);
        act(() => root.render(<Probe database={new ScriptedDatabase()} sql={null} />));
        expect(state).toEqual(NO_LIVE_QUERY_RESULT);
    });

    it('keeps the previous result on screen when a run fails', async () => {
        const database = new ScriptedDatabase();
        database.outcomes = [tableFromArrays({ x: [1, 2] }), new Error('table not found')];
        await act(async () => root.render(<Probe database={database} sql="select x from t" />));
        await act(async () => { await vi.waitFor(() => expect(state.table?.numRows).toBe(2)); });
        expect(state.error).toBeNull();
        expect(state.latencyMs).toBeGreaterThanOrEqual(0);

        await act(async () => { await vi.waitFor(() => expect(state.error?.message).toBe('table not found')); });
        expect(state.table?.numRows).toBe(2);
        expect(database.queries).toEqual(['select x from t', 'select x from t']);
    });

    it('restarts with a new query and stops when unmounted', async () => {
        const database = new ScriptedDatabase();
        database.outcomes = [tableFromArrays({ x: [1] }), tableFromArrays({ y: [1, 2, 3] })];
        await act(async () => root.render(<Probe database={database} sql="select x" />));
        await act(async () => { await vi.waitFor(() => expect(state.table?.numRows).toBe(1)); });
        await act(async () => root.render(<Probe database={database} sql="select y" />));
        await act(async () => { await vi.waitFor(() => expect(state.table?.numRows).toBe(3)); });
        expect(database.queries.slice(0, 2)).toEqual(['select x', 'select y']);
        await act(async () => root.render(<Probe database={null} sql={null} />));
        await act(async () => { await vi.waitFor(() => expect(state).toEqual(NO_LIVE_QUERY_RESULT)); });
        await act(async () => { await vi.waitFor(() => expect(database.closes).toBe(2)); });
    });
});
