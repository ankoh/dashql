import { DuckDB } from '../dist/duckdb_node.js';

var db: DuckDB;

beforeEach(async () => {
    db = new DuckDB();
    await db.open();
});

afterEach(() => {
});

test('INTEGER column', async () => {
    let conn = await db.connect();
    let result = await db.sendQuery(conn, `
        SELECT v::INTEGER FROM generate_series(0, 10000) as t(v);
    `);
    expect(result.root.columnTypesLength()).toBe(1);
});
