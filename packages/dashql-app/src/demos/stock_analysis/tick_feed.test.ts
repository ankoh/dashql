import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HyperDBSourceConnection } from '../../platform/hyperdb/hyperdb_incremental_extract.js';
import { deleteTicksBeforeSql, insertTicksSql, TickWriter, type Tick } from './tick_feed.js';

function tick(symbol: string, price: number, ts = Date.UTC(2026, 0, 2, 3, 4, 5, 678)): Tick {
    return { symbol, ts, price, size: 2, bid: price - 0.01, ask: null };
}

/// A connection that records its statements
function recordingConnection(statements: string[]): HyperDBSourceConnection {
    return {
        query: async () => { throw new Error('unexpected query'); },
        execute: async (sql: string) => { statements.push(sql); return null; },
        close: async () => { },
    };
}

describe('insertTicksSql', () => {
    it('writes a row per tick with quoted symbols and UTC timestamps', () => {
        expect(insertTicksSql([tick("A'B", 1.5), tick('C', 2)])).toBe(
            'insert into ticks (symbol, ts, price, size, bid, ask) values\n'
            + "('A''B', '2026-01-02T03:04:05.678Z'::timestamptz, 1.5, 2, 1.49, null),\n"
            + "('C', '2026-01-02T03:04:05.678Z'::timestamptz, 2, 2, 1.99, null)",
        );
    });

    it('deletes by the retention in seconds', () => {
        expect(deleteTicksBeforeSql(30 * 60 * 1000)).toBe("delete from ticks where ts < now() - interval '1800 seconds'");
    });
});

describe('TickWriter', () => {
    let statements: string[];

    beforeEach(() => {
        vi.useFakeTimers();
        statements = [];
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('batches the ticks of an interval into inserts of a maximum size', async () => {
        const writer = new TickWriter(recordingConnection(statements), { flushIntervalMs: 200, maxBatchSize: 2, retentionIntervalMs: 60000 });
        writer.push([tick('A', 1), tick('B', 2)]);
        writer.push([tick('C', 3)]);
        expect(statements).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(200);
        const inserts = statements.filter(s => s.startsWith('insert'));
        expect(inserts).toHaveLength(2);
        expect(inserts[0]).toContain("'A'");
        expect(inserts[0]).toContain("'B'");
        expect(inserts[1]).toContain("'C'");
        expect(writer.written).toBe(3);
        await writer.stop();
    });

    it('deletes old ticks once per retention interval', async () => {
        const writer = new TickWriter(recordingConnection(statements), { flushIntervalMs: 100, retentionIntervalMs: 1000 });
        const deletes = () => statements.filter(s => s.startsWith('delete')).length;
        for (let i = 0; i < 5; ++i) {
            writer.push([tick('A', i)]);
            await vi.advanceTimersByTimeAsync(100);
        }
        expect(deletes()).toBe(0);
        await vi.advanceTimersByTimeAsync(500);
        writer.push([tick('A', 9)]);
        await vi.advanceTimersByTimeAsync(100);
        expect(deletes()).toBe(1);
        for (let i = 0; i < 5; ++i) {
            writer.push([tick('A', i)]);
            await vi.advanceTimersByTimeAsync(100);
        }
        expect(deletes()).toBe(1);
        await writer.stop();
    });

    it('drops the oldest ticks when the inserts fall behind', async () => {
        const writer = new TickWriter(recordingConnection(statements), { maxBatchSize: 1 });
        writer.push(Array.from({ length: 15 }, (_, i) => tick('A', i)));
        expect(writer.dropped).toBe(5);
        await writer.stop();
        expect(statements).toHaveLength(0);
    });

    it('reports failed statements and keeps going', async () => {
        const errors: unknown[] = [];
        let fail = true;
        const writer = new TickWriter({
            query: async () => { throw new Error('unexpected query'); },
            execute: async (sql: string) => {
                if (fail) { fail = false; throw new Error('disk full'); }
                statements.push(sql);
                return null;
            },
            close: async () => { },
        }, { flushIntervalMs: 100, onError: e => errors.push(e) });
        writer.push([tick('A', 1)]);
        await vi.advanceTimersByTimeAsync(100);
        expect(errors).toHaveLength(1);
        writer.push([tick('B', 1)]);
        await vi.advanceTimersByTimeAsync(100);
        expect(statements.some(s => s.includes("'B'"))).toBe(true);
        await writer.stop();
    });
});
