import { DuckDB } from '../dist/duckdb_node.js';
import * as duckdb from '../dist/duckdb_node.js';

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

    let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
    let iter = await duckdb.webapi.QueryResultIterator.iterate(chunks);
    expect(iter.isEnd()).toBe(false);

    let v = new duckdb.webapi.Value();
    for (let i = 0; i <= 10000; ++i) {
        expect(iter.isEnd()).toBe(false);
        expect(iter.getValue(0, v).i32).toBe(i);
        await iter.next();
    }
    expect(iter.isEnd()).toBe(true);
});
