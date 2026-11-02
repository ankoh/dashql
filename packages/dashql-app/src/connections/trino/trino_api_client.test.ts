import { describe, expect, it } from 'vitest';

import { basicTrinoApi } from '../../tests/mocks/trino_api.js';

describe('TrinoApiClient', () => {
    it('reads the info of a query', async () => {
        const { fetch, endpoint, client } = basicTrinoApi(() => new Response(JSON.stringify({ queryId: 'q1', state: 'FINISHED' })));
        expect(await client.getQueryInfo(endpoint, 'q1')).toMatchObject({ queryId: 'q1', state: 'FINISHED' });
        const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
        expect([url.toString(), init.method]).toEqual(['https://trino.example.com/v1/query/q1', 'GET']);
        expect(new Headers(init.headers).get('X-Trino-User')).toBe('user');
    });

    it('cancels a query', async () => {
        const { fetch, endpoint, client } = basicTrinoApi(() => new Response(JSON.stringify({ id: 'q1' })));
        expect(await client.cancelQuery(endpoint, 'q1')).toMatchObject({ id: 'q1' });
        const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
        expect([url.toString(), init.method]).toEqual(['https://trino.example.com/v1/query/q1', 'DELETE']);
    });

    it('fails on rejected requests', async () => {
        const { endpoint, client } = basicTrinoApi(() => new Response('', { status: 404, statusText: 'Not Found' }));
        const rejected = { keyValues: { status: '404', message: 'Not Found' } };
        await expect(client.getQueryInfo(endpoint, 'q1')).rejects.toMatchObject({ message: 'Failed to fetch query info', ...rejected });
        await expect(client.cancelQuery(endpoint, 'q1')).rejects.toMatchObject({ message: 'Cancelling a query failed', ...rejected });
    });
});
