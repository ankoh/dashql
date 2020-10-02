import { DuckDB } from '../dist/duckdb_node.js';

beforeEach(async () => {
    var db = new DuckDB();
    await db.open();
});

afterEach(() => {
});

test('DuckDB open', async () => {
    expect(1 + 2).toBe(3);
});
