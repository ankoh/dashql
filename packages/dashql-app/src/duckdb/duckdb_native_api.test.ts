// @vitest-environment node
import * as arrow from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeAPIRustBridge } from '../platform/native_api_rust_bridge.js';
import { NativeDuckDB } from './duckdb_native_api.js';

function toPlainObjects(table: arrow.Table): any[] {
    return table.toArray().map(row => {
        const obj: any = {};
        for (const key of Object.keys(row)) {
            obj[key] = (row as any)[key];
        }
        return obj;
    });
}

describe('NativeDuckDB API', () => {
    let bridge: NativeAPIRustBridge | null = null;

    beforeEach(() => {
        bridge = new NativeAPIRustBridge();
        vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            return bridge!.process(request);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        bridge?.close();
        bridge = null;
    });

    it('runs queries, inserts arrow data, and executes prepared statements', async () => {
        const duckdb = new NativeDuckDB();
        await duckdb.open();

        const version = await duckdb.getVersion();
        expect(version.trim().length).toBeGreaterThan(0);

        const conn = await duckdb.connect();

        const queryResult = await conn.query('SELECT 42 AS answer');
        expect(toPlainObjects(queryResult)).toEqual([{ answer: 42 }]);

        const uploadSource = arrow.tableFromArrays({
            uploaded_value: new Int32Array([11, 12, 13]),
        });
        await conn.insertArrowTable(uploadSource, {
            name: 'native_api_uploaded_rows',
            create: true,
        });
        const uploadedRows = await conn.query('SELECT uploaded_value FROM native_api_uploaded_rows ORDER BY uploaded_value');
        expect(toPlainObjects(uploadedRows)).toEqual([
            { uploaded_value: 11 },
            { uploaded_value: 12 },
            { uploaded_value: 13 },
        ]);

        const stmt = await conn.prepare('SELECT $1::INTEGER + $2::INTEGER AS sum');
        const stmtResult = await stmt.run([10, 20]);
        expect(toPlainObjects(stmtResult)).toEqual([{ sum: 30 }]);
        await stmt.close();

        const firstBatch = await conn.queryPending(
            "SELECT i::INTEGER AS id, repeat('x', 1000) AS payload FROM generate_series(1, 10000) AS t(i)",
            true,
        );
        expect(firstBatch.numCols).toEqual(2);
        expect(firstBatch.numRows).toBeGreaterThan(0);
        await conn.cancelPending();

        await conn.close();
        duckdb.terminate();
    });

    it('supports parallel queries on separate connections', async () => {
        const duckdb = new NativeDuckDB();
        await duckdb.open();

        const conn1 = await duckdb.connect();
        const conn2 = await duckdb.connect();

        await conn1.query('CREATE TABLE native_parallel_rows (id INTEGER, value VARCHAR)');
        await conn1.query("INSERT INTO native_parallel_rows VALUES (1, 'one'), (2, 'two'), (3, 'three')");

        const [countRows, valuesRows] = await Promise.all([
            conn1.query('SELECT COUNT(*)::INTEGER AS row_count FROM native_parallel_rows'),
            conn2.query('SELECT value FROM native_parallel_rows ORDER BY id'),
        ]);

        expect(toPlainObjects(countRows)).toEqual([{ row_count: 3 }]);
        expect(toPlainObjects(valuesRows)).toEqual([
            { value: 'one' },
            { value: 'two' },
            { value: 'three' },
        ]);

        await conn1.close();
        await conn2.close();
        duckdb.terminate();
    });
});
