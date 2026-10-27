import type * as arrow from 'apache-arrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EmbeddedComputeDatabase, EmbeddedTableImportConnection } from '../../platform/database/embedded_database.js';
import { setupWebHyperDB } from '../../platform/hyperdb/hyperdb_provider_web.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { bindSqlTemplate } from '../shared/sql_template.js';
import { readBoardRows } from './live_board.js';
import { deleteTicksBeforeSql, insertTicksSql, type Tick } from './tick_feed.js';

import SCHEMA_SQL from './sql/schema.sql?raw';
import LIVE_BOARD_SQL from './sql/live_board.sql?raw';
import SYMBOL_CHART_SQL from './sql/symbol_chart.sql?raw';
import THROUGHPUT_SQL from './sql/throughput.sql?raw';
import STATS_SQL from './sql/stats.sql?raw';

function plainRows(table: arrow.Table): Record<string, unknown>[] {
    return table.toArray().map(row => Object.fromEntries(Object.keys(row).map(key => [key, row[key]])));
}

describe('Stock Analysis SQL in HyperDB WASM', () => {
    let database: EmbeddedComputeDatabase;
    let conn: EmbeddedTableImportConnection;
    let now: number;

    beforeAll(async () => {
        database = await setupWebHyperDB('stock_analysis_sql_test', new TestLogger());
        conn = await database.connect({ defaultDatabase: 'hyper' });
        await conn.execute(SCHEMA_SQL);
        now = Date.now();
        const ticks: Tick[] = [
            { symbol: 'AAA', ts: now - 120_000, price: 10, size: 1, bid: 9.9, ask: 10.1 },
            { symbol: 'AAA', ts: now - 90_000, price: 12, size: 1, bid: 11.9, ask: 12.1 },
            { symbol: 'AAA', ts: now - 1_000, price: 11, size: 1, bid: 10.9, ask: 11.1 },
            { symbol: 'BBB', ts: now - 30_000, price: 5, size: 2, bid: null, ask: null },
            // Older than the board, it only counts for the size of the table
            { symbol: 'BBB', ts: now - 25 * 3600_000, price: 100, size: 1, bid: null, ask: null },
        ];
        await conn.execute(insertTicksSql(ticks));
    });
    afterAll(async () => {
        await conn?.close();
        await database?.terminate();
    });

    it('computes the live board of the last 24 hours', async () => {
        const rows = readBoardRows(await conn.query(LIVE_BOARD_SQL));
        expect(rows.map(r => r.symbol)).toEqual(['AAA', 'BBB']);
        const [aaa, bbb] = rows;
        expect(aaa).toMatchObject({ last: 11, open: 10, change: 1, bid: 10.9, ask: 11.1, volume: 33, trades: 3 });
        expect(aaa.changeRatio).toBeCloseTo(0.1);
        expect(Math.abs(aaa.updatedMs - (now - 1_000))).toBeLessThan(1);
        expect(bbb).toMatchObject({ last: 5, open: 5, change: 0, changeRatio: 0, bid: null, ask: null, volume: 10, trades: 1 });
    });

    it('computes the price of a symbol per second', async () => {
        const rows = plainRows(await conn.query(bindSqlTemplate(SYMBOL_CHART_SQL, { symbol: 'AAA' })));
        expect(rows.map(r => r.close)).toEqual([10, 12, 11]);
        expect(rows.map(r => r.t)).toEqual([now - 120_000, now - 90_000, now - 1_000].map(t => Math.floor(t / 1000) * 1000));
        expect(rows[1]).toMatchObject({ open: 12, high: 12, low: 12, close: 12, size: 1 });
    });

    it('computes the trades per second of the last minute', async () => {
        const rows = plainRows(await conn.query(THROUGHPUT_SQL));
        expect(rows).toEqual([
            { t: Math.floor((now - 30_000) / 1000) * 1000, trades: 1 },
            { t: Math.floor((now - 1_000) / 1000) * 1000, trades: 1 },
        ]);
    });

    it('counts the table and deletes old ticks', async () => {
        expect(plainRows(await conn.query(STATS_SQL))).toEqual([{ rows: 5, symbols: 2 }]);
        await conn.execute(deleteTicksBeforeSql(3600_000));
        expect(plainRows(await conn.query(STATS_SQL))).toEqual([{ rows: 4, symbols: 2 }]);
    });
});
