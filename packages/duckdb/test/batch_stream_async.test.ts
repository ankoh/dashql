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

    describe('Arrow Record-Batches Row-Major', () => {
        describe('single column', () => {
            it('TINYINT', async () => {
                const result = await conn.sendQuery(`
                    SELECT (v & 127)::TINYINT AS v FROM generate_series(0, ${testRows}) as t(v);
                `);
                let i = 0;
                for await (const batch of result) {
                    expect(batch.numCols).toBe(1);
                    for (const row of batch) {
                        expect(row!.v).toBe(i++ & 127);
                    }
                }
                expect(i).toBe(testRows + 1);
            });

            it('SMALLINT', async () => {
                const result = await conn.sendQuery(`
                    SELECT (v & 32767)::SMALLINT AS v FROM generate_series(0, ${testRows}) as t(v);
                `);
                let i = 0;
                for await (const batch of result) {
                    expect(batch.numCols).toBe(1);
                    for (const v of batch.getChildAt(0)!) {
                        expect(v).toBe(i++ & 32767);
                    }
                }
                expect(i).toBe(testRows + 1);
            });

            it('INTEGER', async () => {
                const result = await conn.sendQuery(`
                    SELECT v::INTEGER AS v FROM generate_series(0, ${testRows}) as t(v);
                `);
                let i = 0;
                for await (const batch of result) {
                    expect(batch.numCols).toBe(1);
                    for (const v of batch.getChildAt(0)!) {
                        expect(v).toBe(i++);
                    }
                }
                expect(i).toBe(testRows + 1);
            });

            it('BIGINT', async () => {
                const result = await conn.sendQuery(`
                    SELECT v::BIGINT AS v FROM generate_series(0, ${testRows}) as t(v);
                `);
                let i = 0;
                for await (const batch of result) {
                    expect(batch.numCols).toBe(1);
                    for (const v of batch.getChildAt(0)!) {
                        expect(v.valueOf()).toBe(i++);
                    }
                }
                expect(i).toBe(testRows + 1);
            });

            it('STRING', async () => {
                const result = await conn.sendQuery(`
                    SELECT v::VARCHAR AS v FROM generate_series(0, ${testRows}) as t(v);
                `);
                let i = 0;
                for await (const batch of result) {
                    expect(batch.numCols).toBe(1);
                    for (const v of batch.getChildAt(0)!) {
                        expect(v).toBe(String(i++));
                    }
                }
                expect(i).toBe(testRows + 1);
            });
        });
    });
}
