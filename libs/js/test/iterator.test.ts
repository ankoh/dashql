import { DuckDB } from '../dist/duckdb_node.js';

var db: DuckDB;

beforeEach(async () => {
    db = new DuckDB();
    await db.open();
});

afterEach(() => {
});

test('DuckDB open', async () => {
    let conn = await db.connect();
    let result = await db.sendQuery(conn, "select 1");
    expect(1 + 2).toBe(3);
});
