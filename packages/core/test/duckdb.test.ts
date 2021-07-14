import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as arrow from 'apache-arrow';

export function testDuckDB(db: () => duckdb.AsyncDuckDB): void {
    let conn: duckdb.AsyncDuckDBConnection;

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
        await db().reset();
    });

    describe('DuckDB', () => {
        it('Hello World', async () => {
            const table = await conn.runQuery<{ hello_world: arrow.Int32 }>('SELECT 1::INTEGER as hello_world');
            expect(table.numCols).toBe(1);
            expect(table.getColumnAt(0).length).toBe(1);
            const rows = table.toArray();
            expect(rows[0].hello_world).toBe(1);
        });
    });
}
