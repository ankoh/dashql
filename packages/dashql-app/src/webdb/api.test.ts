import * as arrow from 'apache-arrow';
import { instantiateTestWebDB } from './webdb_test_worker.js';
import { WebDB, WebDBConnection } from './api.js';

// Use the precompiled WASM binary injected by vitest_setup.ts
declare const WEBDB_PRECOMPILED: Promise<Uint8Array> | undefined;

let webdbWasmBinary: Uint8Array | null = null;
let skipTests = false;

// Helper to convert Arrow Table rows to plain objects
function toPlainObjects(table: arrow.Table): any[] {
    return table.toArray().map(row => {
        const obj: any = {};
        for (const key of Object.keys(row)) {
            obj[key] = row[key];
        }
        return obj;
    });
}

beforeAll(async () => {
    if (typeof WEBDB_PRECOMPILED === 'undefined') {
        console.warn('WEBDB_PRECOMPILED not available - WebDB tests will be skipped');
        console.warn('Build the WASM with: bazel build //packages/duckdb-wasm:webdb_wasm');
        skipTests = true;
        return;
    }

    try {
        webdbWasmBinary = await WEBDB_PRECOMPILED;
    } catch (e) {
        console.warn('Failed to load WEBDB_PRECOMPILED:', e);
        skipTests = true;
    }
});

describe('WebDB Basic Operations', () => {
    let webdb: WebDB;

    beforeEach(async () => {
        if (skipTests) {
            return;
        }
        webdb = await instantiateTestWebDB(webdbWasmBinary!);
        await webdb.open({ maximumThreads: 1 });
    });

    afterEach(() => {
        if (webdb) {
            webdb.terminate();
        }
    });

    it('should ping the worker', async () => {
        if (skipTests) return;
        await expect(webdb.ping()).resolves.toBeUndefined();
    });

    it('should get DuckDB version', async () => {
        if (skipTests) return;
        const version = await webdb.getVersion();
        expect(version).toMatch(/^v[0-9]+\.[0-9]+\.[0-9]+/);
    });

    it('should create and close a connection', async () => {
        if (skipTests) return;
        const conn = await webdb.connect();
        expect(conn).toBeDefined();
        await conn.close();
    });
});

describe('WebDB Query Operations', () => {
    let webdb: WebDB;
    let conn: WebDBConnection;

    beforeEach(async () => {
        if (skipTests) {
            return;
        }
        webdb = await instantiateTestWebDB(webdbWasmBinary!);
        await webdb.open({ maximumThreads: 1 });
        conn = await webdb.connect();
    });

    afterEach(async () => {
        if (conn) {
            await conn.close();
        }
        if (webdb) {
            webdb.terminate();
        }
    });

    it('should execute a simple query', async () => {
        if (skipTests) return;
        const result = await conn.query('SELECT 42 as answer');
        expect(result.numRows).toBe(1);
        expect(result.numCols).toBe(1);

        const rows = toPlainObjects(result);
        expect(rows).toEqual([{ answer: 42 }]);
    });

    it('should execute a query with multiple rows', async () => {
        if (skipTests) return;
        const result = await conn.query('SELECT * FROM (VALUES (1, \'a\'), (2, \'b\'), (3, \'c\')) AS t(id, name)');
        expect(result.numRows).toBe(3);
        expect(result.numCols).toBe(2);

        const rows = toPlainObjects(result);
        expect(rows).toEqual([
            { id: 1, name: 'a' },
            { id: 2, name: 'b' },
            { id: 3, name: 'c' },
        ]);
    });

    it('should handle query with aggregation', async () => {
        if (skipTests) return;
        const result = await conn.query(
            'SELECT COUNT(*) as cnt, SUM(x) as total FROM (VALUES (1), (2), (3), (4), (5)) AS t(x)'
        );

        const rows = toPlainObjects(result);
        expect(rows).toEqual([{ cnt: 5n, total: 15n }]);
    });

    it('should handle errors in queries', async () => {
        if (skipTests) return;
        await expect(conn.query('SELECT * FROM nonexistent_table')).rejects.toThrow();
    });
});

describe('WebDB Arrow IPC Insert and Query', () => {
    let webdb: WebDB;
    let conn: WebDBConnection;

    beforeEach(async () => {
        if (skipTests) {
            return;
        }
        webdb = await instantiateTestWebDB(webdbWasmBinary!);
        await webdb.open({
            maximumThreads: 1,
            query: {
                castBigIntToDouble: true,
            },
        });
        conn = await webdb.connect();
    });

    afterEach(async () => {
        if (conn) {
            await conn.close();
        }
        if (webdb) {
            webdb.terminate();
        }
    });

    it('should insert Arrow table via IPC and query it back', async () => {
        if (skipTests) return;

        // Create an Arrow table
        const inputTable = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3, 4, 5]),
            name: ['Alice', 'Bob', 'Charlie', 'David', 'Eve'],
            age: new Int32Array([25, 30, 35, 40, 45]),
            score: new Float64Array([85.5, 92.3, 78.9, 88.1, 95.7]),
        });

        // Insert the table into DuckDB
        await conn.insertArrowTable(inputTable, {
            name: 'users',
            create: true,
        });

        // Query the data back
        const result = await conn.query('SELECT * FROM users ORDER BY id');

        // Verify the results
        expect(result.numRows).toBe(5);
        expect(result.numCols).toBe(4);

        const rows = toPlainObjects(result);
        expect(rows).toEqual([
            { id: 1, name: 'Alice', age: 25, score: 85.5 },
            { id: 2, name: 'Bob', age: 30, score: 92.3 },
            { id: 3, name: 'Charlie', age: 35, score: 78.9 },
            { id: 4, name: 'David', age: 40, score: 88.1 },
            { id: 5, name: 'Eve', age: 45, score: 95.7 },
        ]);
    });

    it('should handle multiple inserts to the same table', async () => {
        if (skipTests) return;

        // First batch
        const batch1 = arrow.tableFromArrays({
            id: new Int32Array([1, 2]),
            value: ['a', 'b'],
        });

        await conn.insertArrowTable(batch1, {
            name: 'test_table',
            create: true,
        });

        // Second batch
        const batch2 = arrow.tableFromArrays({
            id: new Int32Array([3, 4]),
            value: ['c', 'd'],
        });

        await conn.insertArrowTable(batch2, {
            name: 'test_table',
            create: false, // Don't recreate
        });

        // Query all data
        const result = await conn.query('SELECT * FROM test_table ORDER BY id');
        const rows = toPlainObjects(result);

        expect(rows).toEqual([
            { id: 1, value: 'a' },
            { id: 2, value: 'b' },
            { id: 3, value: 'c' },
            { id: 4, value: 'd' },
        ]);
    });

    it('should handle Arrow table with nulls', async () => {
        if (skipTests) return;

        const table = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            nullable_value: [10, null, 30],
        });

        await conn.insertArrowTable(table, {
            name: 'nullable_test',
            create: true,
        });

        const result = await conn.query('SELECT * FROM nullable_test ORDER BY id');
        const rows = toPlainObjects(result);

        expect(rows).toEqual([
            { id: 1, nullable_value: 10 },
            { id: 2, nullable_value: null },
            { id: 3, nullable_value: 30 },
        ]);
    });

    it('should query inserted data with aggregations', async () => {
        if (skipTests) return;

        const table = arrow.tableFromArrays({
            category: ['A', 'B', 'A', 'B', 'A'],
            value: new Float64Array([10.5, 20.3, 15.7, 25.1, 12.8]),
        });

        await conn.insertArrowTable(table, {
            name: 'categories',
            create: true,
        });

        const result = await conn.query(
            'SELECT category, COUNT(*) as count, SUM(value) as total FROM categories GROUP BY category ORDER BY category'
        );

        const rows = toPlainObjects(result);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ category: 'A', count: 3 });
        expect(rows[0].total).toBeCloseTo(39, 5);
        expect(rows[1]).toMatchObject({ category: 'B', count: 2 });
        expect(rows[1].total).toBeCloseTo(45.4, 5);
    });

    it('should handle large Arrow table', async () => {
        if (skipTests) return;

        // Create a larger table
        const size = 1000;
        const ids = new Int32Array(size);
        const values = new Float64Array(size);

        for (let i = 0; i < size; i++) {
            ids[i] = i;
            values[i] = Math.random() * 100;
        }

        const table = arrow.tableFromArrays({
            id: ids,
            value: values,
        });

        await conn.insertArrowTable(table, {
            name: 'large_table',
            create: true,
        });

        // Query count
        const countResult = await conn.query('SELECT COUNT(*) as cnt FROM large_table');
        expect(toPlainObjects(countResult)).toEqual([{ cnt: size }]);

        // Query with filter
        const filterResult = await conn.query('SELECT COUNT(*) as cnt FROM large_table WHERE id < 100');
        expect(toPlainObjects(filterResult)).toEqual([{ cnt: 100 }]);
    });
});

describe('WebDB Prepared Statements', () => {
    let webdb: WebDB;
    let conn: WebDBConnection;

    beforeEach(async () => {
        if (skipTests) {
            return;
        }
        webdb = await instantiateTestWebDB(webdbWasmBinary!);
        await webdb.open({ maximumThreads: 1 });
        conn = await webdb.connect();
    });

    afterEach(async () => {
        if (conn) {
            await conn.close();
        }
        if (webdb) {
            webdb.terminate();
        }
    });

    it('should prepare and execute a statement with parameters', async () => {
        if (skipTests) return;

        const stmt = await conn.prepare('SELECT $1::INTEGER + $2::INTEGER as sum');
        const result = await stmt.run([10, 20]);

        const rows = toPlainObjects(result);
        expect(rows).toEqual([{ sum: 30 }]);

        await stmt.close();
    });

    it('should reuse prepared statement with different parameters', async () => {
        if (skipTests) return;

        const stmt = await conn.prepare('SELECT $1::INTEGER * $2::INTEGER as product');

        let result = await stmt.run([5, 6]);
        expect(toPlainObjects(result)).toEqual([{ product: 30 }]);

        result = await stmt.run([10, 20]);
        expect(toPlainObjects(result)).toEqual([{ product: 200 }]);

        await stmt.close();
    });

    it('should handle prepared statement with string parameters', async () => {
        if (skipTests) return;

        await conn.query('CREATE TABLE test_prep (id INTEGER, name VARCHAR)');
        await conn.query('INSERT INTO test_prep VALUES (1, \'Alice\'), (2, \'Bob\'), (3, \'Charlie\')');

        const stmt = await conn.prepare('SELECT * FROM test_prep WHERE name = $1');
        const result = await stmt.run(['Bob']);

        const rows = toPlainObjects(result);
        expect(rows).toEqual([{ id: 2, name: 'Bob' }]);

        await stmt.close();
    });

    it('should handle errors in prepared statements', async () => {
        if (skipTests) return;

        await expect(conn.prepare('SELECT * FROM nonexistent')).rejects.toThrow();
    });
});

describe('WebDB Multiple Connections', () => {
    let webdb: WebDB;

    beforeEach(async () => {
        if (skipTests) {
            return;
        }
        webdb = await instantiateTestWebDB(webdbWasmBinary!);
        await webdb.open({ maximumThreads: 2 });
    });

    afterEach(() => {
        if (webdb) {
            webdb.terminate();
        }
    });

    it('should support multiple independent connections', async () => {
        if (skipTests) return;

        const conn1 = await webdb.connect();
        const conn2 = await webdb.connect();

        // Create table in conn1
        await conn1.query('CREATE TABLE shared_table (id INTEGER, value VARCHAR)');
        await conn1.query('INSERT INTO shared_table VALUES (1, \'from_conn1\')');

        // Read from conn2 (should see the data)
        const result = await conn2.query('SELECT * FROM shared_table');
        expect(toPlainObjects(result)).toEqual([{ id: 1, value: 'from_conn1' }]);

        // Insert from conn2
        await conn2.query('INSERT INTO shared_table VALUES (2, \'from_conn2\')');

        // Read from conn1
        const result2 = await conn1.query('SELECT * FROM shared_table ORDER BY id');
        expect(toPlainObjects(result2)).toEqual([
            { id: 1, value: 'from_conn1' },
            { id: 2, value: 'from_conn2' },
        ]);

        await conn1.close();
        await conn2.close();
    });
});

describe('WebDB Data Types', () => {
    let webdb: WebDB;
    let conn: WebDBConnection;

    beforeEach(async () => {
        if (skipTests) {
            return;
        }
        webdb = await instantiateTestWebDB(webdbWasmBinary!);
        await webdb.open({ maximumThreads: 1 });
        conn = await webdb.connect();
    });

    afterEach(async () => {
        if (conn) {
            await conn.close();
        }
        if (webdb) {
            webdb.terminate();
        }
    });

    it('should handle various numeric types', async () => {
        if (skipTests) return;

        const table = arrow.tableFromArrays({
            int32_col: new Int32Array([1, -2, 3]),
            int64_col: new BigInt64Array([100n, -200n, 300n]),
            float32_col: new Float32Array([1.5, 2.5, 3.5]),
            float64_col: new Float64Array([10.123, 20.456, 30.789]),
        });

        await conn.insertArrowTable(table, {
            name: 'numeric_types',
            create: true,
        });

        const result = await conn.query('SELECT * FROM numeric_types ORDER BY int32_col');
        expect(result.numRows).toBe(3);
    });

    it('should handle boolean type', async () => {
        if (skipTests) return;

        const table = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            flag: [true, false, true],
        });

        await conn.insertArrowTable(table, {
            name: 'bool_test',
            create: true,
        });

        const result = await conn.query('SELECT * FROM bool_test WHERE flag = true ORDER BY id');
        const rows = toPlainObjects(result);
        expect(rows).toEqual([
            { id: 1, flag: true },
            { id: 3, flag: true },
        ]);
    });

    it('should handle date types', async () => {
        if (skipTests) return;

        const result = await conn.query(
            "SELECT DATE '2024-01-15' as date_col, TIMESTAMP '2024-01-15 10:30:00' as timestamp_col"
        );

        expect(result.numRows).toBe(1);
        const rows = toPlainObjects(result);
        expect(rows[0]).toHaveProperty('date_col');
        expect(rows[0]).toHaveProperty('timestamp_col');
    });
});

describe('WebDB Edge Cases', () => {
    let webdb: WebDB;
    let conn: WebDBConnection;

    beforeEach(async () => {
        if (skipTests) {
            return;
        }
        webdb = await instantiateTestWebDB(webdbWasmBinary!);
        await webdb.open({ maximumThreads: 1 });
        conn = await webdb.connect();
    });

    afterEach(async () => {
        if (conn) {
            await conn.close();
        }
        if (webdb) {
            webdb.terminate();
        }
    });

    it('should handle empty result set', async () => {
        if (skipTests) return;

        const result = await conn.query('SELECT * FROM (VALUES (1)) AS t(x) WHERE x > 100');
        expect(result.numRows).toBe(0);
        expect(toPlainObjects(result)).toEqual([]);
    });

    it('should handle empty Arrow table insert', async () => {
        if (skipTests) return;

        const table = arrow.tableFromArrays({
            id: new Int32Array([]),
            value: [],
        });

        await conn.insertArrowTable(table, {
            name: 'empty_table',
            create: true,
        });

        const result = await conn.query('SELECT COUNT(*) as cnt FROM empty_table');
        expect(toPlainObjects(result)).toEqual([{ cnt: 0n }]);
    });

    it('should handle very long strings', async () => {
        if (skipTests) return;

        const longString = 'x'.repeat(10000);
        const table = arrow.tableFromArrays({
            id: new Int32Array([1]),
            text: [longString],
        });

        await conn.insertArrowTable(table, {
            name: 'long_strings',
            create: true,
        });

        const result = await conn.query('SELECT LENGTH(text) as len FROM long_strings');
        expect(toPlainObjects(result)).toEqual([{ len: BigInt(longString.length) }]);
    });
});
