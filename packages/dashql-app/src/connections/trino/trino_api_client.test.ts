import { describe, expect, it, vi } from 'vitest';

import { basicTrinoApi } from '../../tests/mocks/trino_api.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { parseTrinoJson, TARGET_RESULT_SIZE, TrinoApiClient, TrinoApiEndpoint } from './trino_api_client.js';

const NEXT_URI = 'https://trino.example.com/v1/statement/executing/q1/y1/1';

/// An API client without retry delays whose HTTP client answers the requests with the responses in order
function retryingTrinoApi(attempts: number, responses: (() => Response)[]) {
    const fetch = vi.fn(async (_input: URL | Request | string, _init?: RequestInit) => responses.shift()!());
    const endpoint = new TrinoApiEndpoint('https://trino.example.com', { authType: 'AUTH_BASIC', basic: { username: 'user', secret: 'secret' } } as never);
    const client = new TrinoApiClient(new TestLogger(), { fetch }, { attempts, initialDelayMs: 0, maxDelayMs: 0 });
    return { fetch, endpoint, client };
}

describe('TrinoApiClient', () => {
    it('reads the info of a query', async () => {
        const { fetch, endpoint, client } = basicTrinoApi(() => new Response(JSON.stringify({ queryId: 'q1', state: 'FINISHED' })));
        expect(await client.getQueryInfo(endpoint, 'q1')).toMatchObject({ queryId: 'q1', state: 'FINISHED' });
        const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
        expect([url.toString(), init.method]).toEqual(['https://trino.example.com/v1/query/q1', 'GET']);
        expect(new Headers(init.headers).get('X-Trino-User')).toBe('user');
    });

    it('asks executing queries for large result pages', async () => {
        const { fetch, endpoint, client } = basicTrinoApi(() => new Response(JSON.stringify({ id: 'q1' })));
        await client.getQueryResult(endpoint, 'https://trino.example.com/v1/statement/queued/q1/y1/1');
        await client.getQueryResult(endpoint, 'https://trino.example.com/v1/statement/executing/q1/y2/2');
        expect(fetch.mock.calls.map(call => (call[0] as URL).toString())).toEqual([
            'https://trino.example.com/v1/statement/queued/q1/y1/1',
            `https://trino.example.com/v1/statement/executing/q1/y2/2?targetResultSize=${TARGET_RESULT_SIZE}`,
        ]);
    });

    it('retries rejected and failed requests of query results', async () => {
        const { fetch, endpoint, client } = retryingTrinoApi(4, [
            () => new Response('', { status: 503 }),
            () => { throw new TypeError('Failed to fetch'); },
            () => new Response('', { status: 502 }),
            () => new Response(JSON.stringify({ id: 'q1', data: [[1]] })),
        ]);
        expect(await client.getQueryResult(endpoint, NEXT_URI)).toMatchObject({ id: 'q1', data: [[1]] });
        expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('gives up on query results after the last attempt and on other errors', async () => {
        const unavailable = retryingTrinoApi(2, [() => new Response('', { status: 503 }), () => new Response('', { status: 504 })]);
        await expect(unavailable.client.getQueryResult(unavailable.endpoint, NEXT_URI)).rejects.toMatchObject({ keyValues: { status: '504' } });
        const missing = retryingTrinoApi(5, [() => new Response('', { status: 404 })]);
        await expect(missing.client.getQueryResult(missing.endpoint, NEXT_URI)).rejects.toMatchObject({ keyValues: { status: '404' } });
        expect(missing.fetch).toHaveBeenCalledTimes(1);
    });

    it('stops retrying when the request is aborted', async () => {
        const abort = new AbortController();
        const { fetch, endpoint, client } = retryingTrinoApi(5, [() => { abort.abort(new Error('stop')); return new Response('', { status: 503 }); }]);
        await expect(client.getQueryResult(endpoint, NEXT_URI, abort.signal)).rejects.toThrow('stop');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('parses integers beyond the safe integers as BigInt', () => {
        const parsed = parseTrinoJson('{"data":[[9007199254740993, 1e20, 2, "1234567890123456"]]}');
        expect(parsed.data).toEqual([[9007199254740993n, 1e20, 2, '1234567890123456']]);
    });

    it('cancels a query by deleting its next URI', async () => {
        const { fetch, endpoint, client } = basicTrinoApi(() => new Response(null, { status: 204 }));
        await client.cancelQuery(endpoint, NEXT_URI);
        const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
        expect([url.toString(), init.method]).toEqual([NEXT_URI, 'DELETE']);
    });

    it('fails on rejected requests', async () => {
        const { endpoint, client } = basicTrinoApi(() => new Response('', { status: 404, statusText: 'Not Found' }));
        const rejected = { keyValues: { status: '404', message: 'Not Found' } };
        await expect(client.getQueryInfo(endpoint, 'q1')).rejects.toMatchObject({ message: 'Failed to fetch query info', ...rejected });
        await expect(client.cancelQuery(endpoint, NEXT_URI)).rejects.toMatchObject({ message: 'Cancelling a query failed', ...rejected });
    });
});
