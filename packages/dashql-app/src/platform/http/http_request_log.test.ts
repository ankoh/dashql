import { describe, expect, it } from 'vitest';

import { HttpClient, HttpFetchResult } from './http_client.js';
import { formatCurlCommand, HttpRequestEntry, HttpRequestLog, maskHeaders, RecordingHttpClient } from './http_request_log.js';

/// A response with a body that can be read once, like a fetch Response
function fakeResponse(status: number, body: string, contentType: string | null = 'application/json'): HttpFetchResult & { reads: number } {
    const headers = new Headers();
    if (contentType != null) headers.set('content-type', contentType);
    let consumed = false;
    const read = async () => {
        if (consumed) throw new TypeError('Body has already been consumed');
        consumed = true;
        result.reads += 1;
        return body;
    };
    const result = {
        reads: 0,
        headers,
        status,
        statusText: status == 200 ? 'OK' : 'Not Found',
        arrayBuffer: async () => new TextEncoder().encode(await read()).buffer as ArrayBuffer,
        text: read,
        json: async () => JSON.parse(await read()),
    };
    return result;
}

function fakeClient(respond: () => Promise<HttpFetchResult>): HttpClient {
    return { fetch: respond };
}

function entry(patch: Partial<HttpRequestEntry>): HttpRequestEntry {
    return {
        requestId: 1,
        method: 'GET',
        url: 'https://trino.example.com/v1/query/q1',
        requestHeaders: [],
        requestBody: null,
        sentAt: new Date(0),
        respondedAt: null,
        bodyReceivedAt: null,
        failedAt: null,
        status: null,
        statusText: null,
        responseHeaders: null,
        responseBody: null,
        error: null,
        ...patch,
    };
}

describe('HttpRequestLog', () => {
    it('keeps the latest requests', () => {
        const log = new HttpRequestLog(2);
        for (const url of ['a', 'b', 'c']) {
            log.add({ ...entry({ url }) });
        }
        expect(log.getSnapshot().map(e => [e.requestId, e.url])).toEqual([[2, 'b'], [3, 'c']]);
        // Updates of dropped requests are ignored
        log.update(1, { status: 200 });
        expect(log.getSnapshot().map(e => e.status)).toEqual([null, null]);
    });

    it('notifies subscribers with a new snapshot', () => {
        const log = new HttpRequestLog();
        let notified = 0;
        const unsubscribe = log.subscribe(() => { notified += 1; });
        const id = log.add(entry({}));
        const before = log.getSnapshot();
        log.update(id, { status: 404 });
        expect(log.getSnapshot()).not.toBe(before);
        expect(log.getSnapshot()[0].status).toEqual(404);
        log.clear();
        expect(log.getSnapshot()).toEqual([]);
        expect(notified).toEqual(3);
        unsubscribe();
    });
});

describe('RecordingHttpClient', () => {
    it('records the request and the response', async () => {
        const log = new HttpRequestLog();
        const client = new RecordingHttpClient(fakeClient(async () => fakeResponse(200, '{"id":"q1"}')), log);
        const headers = new Headers({ 'X-Trino-User': 'alice', Authorization: 'Bearer secret' });
        const response = await client.fetch(new URL('https://trino.example.com/v1/statement'), { method: 'post', headers, body: 'SELECT 1' });
        expect(await response.text()).toEqual('{"id":"q1"}');

        const [recorded] = log.getSnapshot();
        expect(recorded.method).toEqual('POST');
        expect(recorded.url).toEqual('https://trino.example.com/v1/statement');
        expect(Object.fromEntries(recorded.requestHeaders)).toEqual({
            'authorization': 'Bearer secret',
            'content-type': 'text/plain;charset=UTF-8',
            'x-trino-user': 'alice',
        });
        expect(recorded.requestBody).toEqual({ kind: 'text', text: 'SELECT 1', byteLength: 8, truncated: false });
        expect(recorded.status).toEqual(200);
        expect(recorded.respondedAt).not.toBeNull();
        expect(recorded.bodyReceivedAt).not.toBeNull();
        expect(recorded.responseBody).toEqual({ kind: 'text', text: '{"id":"q1"}', byteLength: 11, truncated: false });
    });

    it('reads the body of an error response that the caller does not read', async () => {
        const log = new HttpRequestLog();
        const fake = fakeResponse(404, 'no such path', 'text/plain');
        const client = new RecordingHttpClient(fakeClient(async () => fake), log);
        const response = await client.fetch('https://gateway.example.com/v1/query/q1');
        expect(response.status).toEqual(404);
        // The body is read without the caller
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(log.getSnapshot()[0].responseBody).toEqual({ kind: 'text', text: 'no such path', byteLength: 12, truncated: false });
        // The caller can still read the body, it is read once
        expect(await response.text()).toEqual('no such path');
        expect(await response.json().catch(() => 'not json')).toEqual('not json');
        expect(fake.reads).toEqual(1);
    });

    it('records failed requests', async () => {
        const log = new HttpRequestLog();
        const client = new RecordingHttpClient(fakeClient(async () => { throw new Error('connection refused'); }), log);
        await expect(client.fetch('https://gateway.example.com/v1/statement')).rejects.toThrow('connection refused');
        const [recorded] = log.getSnapshot();
        expect(recorded.error).toEqual('connection refused');
        expect(recorded.failedAt).not.toBeNull();
        expect(recorded.status).toBeNull();
    });

    it('records binary bodies by size', async () => {
        const log = new HttpRequestLog();
        const client = new RecordingHttpClient(fakeClient(async () => fakeResponse(200, 'abc', 'application/octet-stream')), log);
        const response = await client.fetch('https://example.com/data', {
            method: 'POST',
            headers: { 'content-type': 'application/grpc-web+proto' },
            body: new Uint8Array([0, 1, 2, 3]),
        });
        await response.arrayBuffer();
        const [recorded] = log.getSnapshot();
        expect(recorded.requestBody).toEqual({ kind: 'binary', byteLength: 4 });
        expect(recorded.responseBody).toEqual({ kind: 'binary', byteLength: 3 });
    });
});

describe('formatCurlCommand', () => {
    it('formats a GET request', () => {
        const command = formatCurlCommand(entry({
            requestHeaders: [['authorization', 'Bearer secret'], ['x-trino-user', 'alice']],
        }));
        expect(command).toEqual(`curl 'https://trino.example.com/v1/query/q1' \\
  -H 'authorization: Bearer secret' \\
  -H 'x-trino-user: alice'`);
    });

    it('quotes the body of a POST request', () => {
        const command = formatCurlCommand(entry({
            method: 'POST',
            url: 'https://trino.example.com/v1/statement',
            requestHeaders: [['content-type', 'text/plain;charset=UTF-8']],
            requestBody: { kind: 'text', text: "SELECT 'it''s'\nFROM t", byteLength: 21, truncated: false },
        }));
        expect(command).toEqual(`curl 'https://trino.example.com/v1/statement' \\
  -H 'content-type: text/plain;charset=UTF-8' \\
  --data-raw 'SELECT '\\''it'\\'''\\''s'\\''
FROM t'`);
    });

    it('notes bodies that it leaves out', () => {
        const command = formatCurlCommand(entry({
            method: 'POST',
            requestBody: { kind: 'binary', byteLength: 42 },
        }));
        expect(command).toEqual(`# The binary request body of 42 bytes is left out
curl 'https://trino.example.com/v1/query/q1' \\
  -X POST`);
    });

    it('sets the method of a DELETE request', () => {
        expect(formatCurlCommand(entry({ method: 'DELETE' }))).toEqual(`curl 'https://trino.example.com/v1/query/q1' \\
  -X DELETE`);
    });
});

describe('maskHeaders', () => {
    it('masks credentials', () => {
        expect(maskHeaders([['Authorization', 'Bearer secret'], ['X-Trino-User', 'alice']])).toEqual([
            ['Authorization', '••••••••'],
            ['X-Trino-User', 'alice'],
        ]);
    });
});
