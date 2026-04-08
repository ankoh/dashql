// @vitest-environment node
import * as arrow from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeAPIRustBridge } from '../platform/native_api_rust_bridge.js';
import {
    HEADER_NAME_BATCH_BYTES,
    HEADER_NAME_BATCH_CHUNKS,
    HEADER_NAME_BATCH_EVENT,
    HEADER_NAME_BATCH_TIMEOUT,
    HEADER_NAME_CONNECTION_ID,
    HEADER_NAME_DATABASE_ID,
    HEADER_NAME_READ_TIMEOUT,
    HEADER_NAME_STREAM_ID,
    HEADER_NAME_UPLOAD_ID,
} from '../platform/native_proxy_headers.js';

function toPlainObjects(table: arrow.Table): any[] {
    return table.toArray().map(row => {
        const obj: any = {};
        for (const key of Object.keys(row)) {
            obj[key] = (row as any)[key];
        }
        return obj;
    });
}

function decodeLengthPrefixedChunks(buffer: Uint8Array): Uint8Array[] {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < buffer.byteLength) {
        const length = view.getUint32(offset, true);
        offset += 4;
        chunks.push(buffer.slice(offset, offset + length));
        offset += length;
    }
    return chunks;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

async function readDuckDBStream(databaseId: number, connectionId: number, streamId: number): Promise<Uint8Array> {
    const response = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/${connectionId}/stream/${streamId}`, {
        method: 'GET',
        headers: {
            [HEADER_NAME_READ_TIMEOUT]: '1000',
            [HEADER_NAME_BATCH_TIMEOUT]: '1000',
            [HEADER_NAME_BATCH_BYTES]: '1000000',
        },
    }));
    expect(response.status).toEqual(200);
    expect(response.headers.get(HEADER_NAME_BATCH_EVENT)).toEqual('StreamFinished');
    expect(Number.parseInt(response.headers.get(HEADER_NAME_BATCH_CHUNKS)!)).toBeGreaterThan(0);
    expect(Number.parseInt(response.headers.get(HEADER_NAME_BATCH_BYTES)!)).toBeGreaterThan(0);
    const payload = new Uint8Array(await response.arrayBuffer());
    return concatChunks(decodeLengthPrefixedChunks(payload));
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
        const databaseId = Number.parseInt(createResponse.headers.get(HEADER_NAME_DATABASE_ID)!);
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
        const connectionId = Number.parseInt(connectionResponse.headers.get(HEADER_NAME_CONNECTION_ID)!);
        expect(connectionId).toBeTruthy();

        const queryStartResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/${connectionId}/query`, {
            method: 'POST',
            headers: {
                'content-type': 'text/plain',
            },
            body: 'SELECT 42 AS answer',
        }));
        expect(queryStartResponse.status).toEqual(200);
        const queryStreamId = Number.parseInt(queryStartResponse.headers.get(HEADER_NAME_STREAM_ID)!);
        expect(queryStreamId).toBeTruthy();

        const queryBytes = await readDuckDBStream(databaseId, connectionId, queryStreamId);
        const result = new arrow.Table(arrow.RecordBatchReader.from(queryBytes));
        expect(result.numRows).toEqual(1);
        expect(result.numCols).toEqual(1);
        expect(toPlainObjects(result)).toEqual([{ answer: 42 }]);

        const streamStartResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/${connectionId}/query`, {
            method: 'POST',
            headers: {
                'content-type': 'text/plain',
            },
            body: 'SELECT v::INTEGER AS value FROM (VALUES (1), (2), (3)) AS t(v)',
        }));
        expect(streamStartResponse.status).toEqual(200);
        const streamId = Number.parseInt(streamStartResponse.headers.get(HEADER_NAME_STREAM_ID)!);
        expect(streamId).toBeTruthy();

        const streamedBytes = await readDuckDBStream(databaseId, connectionId, streamId);
        const streamedTable = new arrow.Table(arrow.RecordBatchReader.from(streamedBytes));
        expect(toPlainObjects(streamedTable)).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);

        const uploadSource = arrow.tableFromArrays({
            uploaded_value: new Int32Array([11, 12, 13]),
        });
        const uploadBytes = arrow.tableToIPC(uploadSource, 'stream');
        const uploadCreateResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/${connectionId}/uploads`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                name: 'native_uploaded_rows',
                create: true,
            }),
        }));
        expect(uploadCreateResponse.status).toEqual(200);
        const uploadId = Number.parseInt(uploadCreateResponse.headers.get(HEADER_NAME_UPLOAD_ID)!);
        expect(uploadId).toBeTruthy();

        const splitAt = Math.max(1, Math.floor(uploadBytes.length / 2));
        const uploadChunkResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/${connectionId}/upload/${uploadId}`, {
            method: 'PATCH',
            body: uploadBytes.slice(0, splitAt),
        }));
        expect(uploadChunkResponse.status).toEqual(200);

        const uploadFinishResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/${connectionId}/upload/${uploadId}/finish`, {
            method: 'POST',
            body: uploadBytes.slice(splitAt),
        }));
        expect(uploadFinishResponse.status).toEqual(200);

        const uploadedQueryStartResponse = await fetch(new Request(`dashql-native://localhost/duckdb/database/${databaseId}/connection/${connectionId}/query`, {
            method: 'POST',
            headers: {
                'content-type': 'text/plain',
            },
            body: 'SELECT uploaded_value FROM native_uploaded_rows ORDER BY uploaded_value',
        }));
        expect(uploadedQueryStartResponse.status).toEqual(200);
        const uploadedQueryStreamId = Number.parseInt(uploadedQueryStartResponse.headers.get(HEADER_NAME_STREAM_ID)!);
        expect(uploadedQueryStreamId).toBeTruthy();
        const uploadedQueryBytes = await readDuckDBStream(databaseId, connectionId, uploadedQueryStreamId);
        const uploadedTable = new arrow.Table(arrow.RecordBatchReader.from(uploadedQueryBytes));
        expect(toPlainObjects(uploadedTable)).toEqual([
            { uploaded_value: 11 },
            { uploaded_value: 12 },
            { uploaded_value: 13 },
        ]);

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
