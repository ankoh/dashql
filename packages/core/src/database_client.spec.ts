import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as arrow from 'apache-arrow';
import * as test from './test';

describe('DuckDB', () => {
    let db: duckdb.AsyncDuckDB | null = null;
    let conn: duckdb.AsyncConnection | null = null;

    beforeEach(async () => {
        if (db == null) {
            db = await test.initDuckDB();
            conn = await db.connect();
        }
    });
    afterEach(async () => {
        await conn.disconnect();
        await db.reset();
    });

    it('hello world', async () => {
        const table = await conn.runQuery<{ hello_world: arrow.Int32 }>('SELECT 1::INTEGER as hello_world');
        expect(table.numCols).toBe(1);
        expect(table.getColumnAt(0).length).toBe(1);
        const rows = table.toArray();
        expect(rows[0].hello_world).toBe(1);
    });
});
