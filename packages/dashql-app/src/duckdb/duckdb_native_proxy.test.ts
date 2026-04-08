// @vitest-environment node
import * as arrow from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeAPIRustBridge } from '../platform/native_api_rust_bridge.js';

function toPlainObjects(table: arrow.Table): any[] {
    return table.toArray().map(row => {
        const obj: any = {};
        for (const key of Object.keys(row)) {
            obj[key] = (row as any)[key];
        }
        return obj;
    });
}

describe('Native DuckDB proxy integration', () => {
    let bridge: NativeAPIRustBridge;

    beforeEach(() => {
        bridge = new NativeAPIRustBridge();
        vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            return bridge.process(request);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        bridge.close();
    });

    it('runs a real DuckDB query through the Rust proxy', async () => {
        const createResponse = await fetch(new Request('dashql-native://localhost/duckdb/databases', {
            method: 'POST',
        }));
        expect(createResponse.status).toEqual(200);
        const databaseId = Number.parseInt(createResponse.headers.get('dashql-database-id')!);
        expect(databaseId).toBeTruthy();

        const openResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/open`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: '',
        }));
        expect(openResponse.status).toEqual(200);

        const versionResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/version`, {
            method: 'GET',
        }));
        expect(versionResponse.status).toEqual(200);
        expect((await versionResponse.text()).trim().length).toBeGreaterThan(0);

        const connectionResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connections`, {
            method: 'POST',
        }));
        expect(connectionResponse.status).toEqual(200);
        const connectionId = Number.parseInt(connectionResponse.headers.get('dashql-connection-id')!);
        expect(connectionId).toBeTruthy();

        const queryResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/${connectionId}/query`, {
            method: 'POST',
            headers: {
                'content-type': 'text/plain',
            },
            body: 'SELECT 42 AS answer',
        }));
        expect(queryResponse.status).toEqual(200);
        expect(queryResponse.headers.get('dashql-arrow-status')).not.toBeNull();

        const queryBytes = new Uint8Array(await queryResponse.arrayBuffer());
        const result = new arrow.Table(arrow.RecordBatchReader.from(queryBytes));
        expect(result.numRows).toEqual(1);
        expect(result.numCols).toEqual(1);
        expect(toPlainObjects(result)).toEqual([{ answer: 42 }]);

        const unknownConnectionResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/999999/query`, {
            method: 'POST',
            headers: {
                'content-type': 'text/plain',
            },
            body: 'SELECT 1',
        }));
        expect(unknownConnectionResponse.status).toEqual(404);

        const closeResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/${connectionId}`, {
            method: 'DELETE',
        }));
        expect(closeResponse.status).toEqual(200);

        const deleteResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}`, {
            method: 'DELETE',
        }));
        expect(deleteResponse.status).toEqual(200);
    });
});
