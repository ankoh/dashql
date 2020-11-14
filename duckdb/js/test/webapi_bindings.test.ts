import * as duckdb from '../';

var db: duckdb.DuckDB;
var conn: duckdb.DuckDBConnection;

beforeAll(async () => {
    db = new duckdb.DuckDB();
    await db.open();
});

beforeEach(async () => {
    conn = await db.connect();
});

afterEach(async () => {
    await conn.disconnect();
});

describe('DuckDBBindings', () => {
    describe('error handling', () => {
        test('INVALID SQL', async () => {
            let error: Error | null = null;
            try {
                await conn.sendQuery('INVALID');
            } catch (e) {
                error = e
            }
            expect(error).not.toBe(null);
        });
    });
});
