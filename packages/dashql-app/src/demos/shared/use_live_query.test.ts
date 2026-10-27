import * as arrow from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HyperDBSourceConnection, HyperDBSourceDatabase } from '../../platform/hyperdb/hyperdb_incremental_extract.js';
import { LiveQueryLoop, type LiveQueryState } from './use_live_query.js';

/// Run the pending promise callbacks
async function flush() {
    for (let i = 0; i < 10; ++i) await Promise.resolve();
}

/// A database whose queries finish when the test resolves them
class FakeDatabase implements HyperDBSourceDatabase {
    connects = 0;
    closes = 0;
    queries: { sql: string; abort?: AbortSignal; resolve: (table: arrow.Table) => void; reject: (e: Error) => void }[] = [];

    async connect(): Promise<HyperDBSourceConnection> {
        this.connects++;
        return {
            query: (sql: string, abort?: AbortSignal) => new Promise<arrow.Table>((resolve, reject) => {
                this.queries.push({ sql, abort, resolve, reject });
                abort?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
            execute: async () => null,
            close: async () => { this.closes++; },
        };
    }
}

describe('LiveQueryLoop', () => {
    let database: FakeDatabase;
    let results: LiveQueryState[];
    let hidden: boolean;
    let loop: LiveQueryLoop;

    beforeEach(() => {
        vi.useFakeTimers();
        database = new FakeDatabase();
        results = [];
        hidden = false;
        loop = new LiveQueryLoop(database, 'select 1', { intervalMs: 100, isHidden: () => hidden }, r => results.push(r));
    });
    afterEach(async () => {
        await loop.stop();
        vi.useRealTimers();
    });

    it('starts the next run an interval after the previous one ended', async () => {
        loop.start();
        await flush();
        expect(database.queries).toHaveLength(1);
        // A slow query delays the next run
        await vi.advanceTimersByTimeAsync(500);
        expect(database.queries).toHaveLength(1);
        database.queries[0].resolve(arrow.tableFromArrays({ x: [1] }));
        await flush();
        expect(results).toHaveLength(1);
        expect(results[0].table?.numRows).toBe(1);
        await vi.advanceTimersByTimeAsync(99);
        expect(database.queries).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(database.queries).toHaveLength(2);
        // The runs share a connection
        expect(database.connects).toBe(1);
    });

    it('reports failures and keeps going', async () => {
        loop.start();
        await flush();
        database.queries[0].reject(new Error('table not found'));
        await flush();
        expect(results[0].error?.message).toBe('table not found');
        expect(results[0].table).toBeNull();
        await vi.advanceTimersByTimeAsync(100);
        expect(database.queries).toHaveLength(2);
    });

    it('skips runs while the page is hidden', async () => {
        hidden = true;
        loop.start();
        await vi.advanceTimersByTimeAsync(1000);
        expect(database.queries).toHaveLength(0);
        hidden = false;
        await vi.advanceTimersByTimeAsync(100);
        expect(database.queries).toHaveLength(1);
    });

    it('cancels the running query and closes the connection on stop', async () => {
        loop.start();
        await flush();
        await loop.stop();
        expect(database.queries[0].abort?.aborted).toBe(true);
        expect(database.closes).toBe(1);
        expect(results).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1000);
        expect(database.queries).toHaveLength(1);
    });
});
