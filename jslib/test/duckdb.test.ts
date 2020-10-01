import { DuckDBLoader } from '../dist/duckdb_node.js';

beforeEach(async () => {
    await DuckDBLoader.open();
});

afterEach(() => {
});

test('DuckDB open', async () => {
    expect(1 + 2).toBe(3);
});
