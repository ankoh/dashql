import { DuckDB } from '../dist/duckdb.js';

beforeEach(async () => {
    await DuckDB.open();
});

afterEach(() => {
});

test('DuckDB open', async () => {
    expect(1 + 2).toBe(3);
});
