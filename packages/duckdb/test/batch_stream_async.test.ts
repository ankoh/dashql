import * as duckdb from '../src/';
import * as arrow from 'apache-arrow';

const testRows = 3000;

export function testAsyncBatchStream(db: () => duckdb.AsyncDuckDB) {
    let conn: duckdb.AsyncDuckDBConnection;

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    describe('AsyncDuckDB', () => {
        it('ping', async () => {
            await db().ping();
        });
    });

    describe('QueryResultRowIterator', () => {
        describe('single column', () => {
            it('TINYINT', async () => {
                const result = await conn.sendQuery(
                    `SELECT (v & 127)::TINYINT AS foo FROM generate_series(0, ${testRows}) as t(v);`,
                );
                let i = 0;
                const table = await arrow.Table.from(result);
                expect(table.numCols).toBe(1);
                for (const row of table.getColumnAt(0)!) {
                    expect(row).toBe(i++ & 127);
                }
                expect(i).toBe(testRows + 1);
            });
        });
    });
}
