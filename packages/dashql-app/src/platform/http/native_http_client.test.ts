import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../logger/test_logger.js';
import { LogLevel } from '../logger/log_buffer.js';
import { NativeHttpClient } from './native_http_client.js';

describe('NativeHttpClient', () => {
    const logger = new TestLogger();
    const client = new NativeHttpClient({ proxyEndpoint: new URL('dashql-native://localhost') }, logger);

    afterEach(() => { delete (globalThis as any).dashqlElectron; });

    function setProxyResponses(...responses: Response[]): void {
        globalThis.dashqlElectron = {
            nativeProxyRequest: async () => {
                const response = responses.shift()!;
                return {
                    status: response.status,
                    statusText: response.statusText,
                    headers: [...response.headers],
                    body: new Uint8Array(await response.arrayBuffer()),
                };
            },
        } as unknown as DashQLElectronBridge;
    }

    it('drops the stream in the proxy when the request is aborted', async () => {
        const requests: string[] = [];
        const abort = new AbortController();
        const responses = [
            new Response(null, { headers: { 'dashql-stream-id': '7' } }),
            new Response('partial', { headers: { 'dashql-batch-event': 'FlushAfterTimeout' } }),
            new Response(null),
        ];
        globalThis.dashqlElectron = {
            nativeProxyRequest: async (request: { method: string; url: string }) => {
                requests.push(`${request.method} ${new URL(request.url).pathname}`);
                // The first batch arrives, the caller aborts before the next one
                if (requests.length === 2) abort.abort();
                const response = responses.shift()!;
                return { status: response.status, statusText: response.statusText, headers: [...response.headers], body: new Uint8Array(await response.arrayBuffer()) };
            },
        } as unknown as DashQLElectronBridge;

        await expect(client.fetch('https://trino.example/v1/statement', { signal: abort.signal })).rejects.toThrow();
        await vi.waitFor(() => expect(requests).toEqual(['POST /http/streams', 'GET /http/stream/7', 'DELETE /http/stream/7']));
    });

    it('surfaces proxy setup failures with their cause and details', async () => {
        setProxyResponses(new Response(JSON.stringify({
            message: 'header stores invalid endpoint',
            details: { error: 'invalid port number', endpoint: 'https://bad-host' },
        }), { status: 400, headers: { 'dashql-error': 'true' } }));

        await expect(client.fetch('https://hyper.example/api/v3/query')).rejects.toMatchObject({
            message: 'header stores invalid endpoint: invalid port number',
            keyValues: { error: 'invalid port number', endpoint: 'https://bad-host' },
        });
    });

    it('surfaces connection failures while waiting for upstream headers', async () => {
        setProxyResponses(
            new Response(null, { headers: { 'dashql-stream-id': '1' } }),
            new Response(JSON.stringify({
                message: 'http request failed',
                details: { stream: '1', error: 'dns error: failed to lookup address' },
            }), { status: 400, headers: { 'dashql-error': 'true' } }),
        );

        await expect(client.fetch('https://hyper.example/api/v3/query')).rejects.toMatchObject({
            message: 'http request failed: dns error: failed to lookup address',
            keyValues: { stream: '1', error: 'dns error: failed to lookup address' },
        });
    });

    it('preserves an upstream HTTP error as a response rather than a proxy failure', async () => {
        setProxyResponses(
            new Response(null, { headers: { 'dashql-stream-id': '1' } }),
            new Response(JSON.stringify({ error: 'INVALID_ARGUMENT', message: 'bad query' }), {
                status: 400,
                headers: { 'dashql-response-started': 'true', 'dashql-batch-event': 'StreamFinished', 'content-type': 'application/json', 'x-hyperdb-status': '{"queryId":"q1"}' },
            }),
        );

        const response = await client.fetch('https://hyper.example/api/v3/query');
        expect(response.status).toBe(400);
        expect(response.headers.get('x-hyperdb-status')).toBe('{"queryId":"q1"}');
        expect(logger.buffer.at(logger.buffer.length - 1)).toMatchObject({
            level: LogLevel.Warn,
            message: 'Native HTTP upstream error response',
            keyValues: { status: '400', contentType: 'application/json', hyperdbStatusPresent: 'true' },
        });
        expect(await response.json()).toEqual({ error: 'INVALID_ARGUMENT', message: 'bad query' });
    });

    it('forwards the Hyper status header on a successful upstream response', async () => {
        setProxyResponses(
            new Response(null, { headers: { 'dashql-stream-id': '1' } }),
            new Response(null, {
                headers: { 'dashql-response-started': 'true', 'dashql-batch-event': 'StreamFinished', 'x-hyperdb-status': '{"queryId":"q2"}' },
            }),
        );

        const response = await client.fetch('https://hyper.example/api/v3/query');
        expect(response.headers.get('x-hyperdb-status')).toBe('{"queryId":"q2"}');
    });

    it('surfaces proxy read failures after upstream headers', async () => {
        setProxyResponses(
            new Response(null, { headers: { 'dashql-stream-id': '1' } }),
            new Response('partial response', {
                headers: { 'dashql-response-started': 'true', 'dashql-batch-event': 'FlushAfterBytes' },
            }),
            new Response(JSON.stringify({
                message: 'reading chunk from http stream failed',
                details: { stream: '1', error: 'connection reset' },
            }), { status: 400, headers: { 'dashql-error': 'true' } }),
        );

        const response = await client.fetch('https://hyper.example/api/v3/query');
        await expect(response.arrayBuffer()).rejects.toMatchObject({
            message: 'reading chunk from http stream failed: connection reset',
            keyValues: { stream: '1', error: 'connection reset' },
        });
    });
});
