import * as duckdb from '../dist/duckdb_node.js';

var db: duckdb.DuckDB;
var conn: number = 0;

beforeAll(async () => {
    db = new duckdb.DuckDB();
    await db.open();
});

beforeEach(async () => {
    conn = await db.connect();
});

afterEach(async () => {
    await db.disconnect(conn);
});

describe('DuckDBBindings', () => {
    describe('error handling', () => {
        test('INVALID SQL', async () => {
            let error: Error | null = null;
            try {
                await db.sendQuery(conn, 'INVALID SQL');
            } catch (e) {
                error = e
            }
            expect(error).toEqual(new Error('Parser: syntax error at or near "INVALID" [1]'));
        });
    });
});
