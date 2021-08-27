import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as arrow from 'apache-arrow';
import * as access from './row_proxy';
import * as test from '../test';

describe('RowProxies', () => {
    let db: duckdb.AsyncDuckDB | null = null;
    let conn: duckdb.AsyncConnection | null = null;

    beforeAll(async () => {
        db = await test.initDuckDB();
    });
    beforeEach(async () => {
        conn = await db.connect();
    });
    afterAll(async () => {
        await db.terminate();
    });
    afterEach(async () => {
        await conn.disconnect();
    });

    it('generate 10k', async () => {
        const result = await conn.runQuery<{ foo: arrow.Int32 }>(
            'SELECT v::INTEGER as foo FROM generate_series(1, 10000) t(v)',
        );
        const proxies = access.proxyTable(result);
        const values = proxies.map(p => p.foo);
        expect(values.length).toBe(10000);
        for (let i = 0; i <= 100; ++i) {
            expect(values[i]).toBe(i + 1);
        }
    });
});
