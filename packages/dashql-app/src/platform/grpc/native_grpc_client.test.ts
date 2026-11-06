import { afterEach, describe, expect, it } from 'vitest';

import { ChannelError } from '../channel_common.js';
import { TestLogger } from '../logger/test_logger.js';
import { installNativeGrpcProxy, nativeStreamBatch } from '../../tests/mocks/native_proxy.js';
import { NativeGrpcClient, NativeGrpcServerStreamBatchEvent, NativeGrpcServerStreamMessageIterator } from './native_grpc_client.js';

const PROXY = { proxyEndpoint: new URL('dashql-native://localhost') };
const METADATA = { getRequestMetadata: async () => ({ authorization: 'Bearer token' }) };

const batch = (event: NativeGrpcServerStreamBatchEvent, messages: string[], count?: number) =>
    nativeStreamBatch(event, messages, { count, headers: { 'x-trailer': event } });

async function readAll(iterator: AsyncIterator<Uint8Array>): Promise<string[]> {
    const messages: string[] = [];
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) messages.push(new TextDecoder().decode(next.value));
    return messages;
}

describe('NativeGrpcClient', () => {
    afterEach(() => {
        delete globalThis.dashqlElectron;
    });

    it('opens a channel with the endpoint, the TLS files and the request metadata', async () => {
        const { seen } = installNativeGrpcProxy([]);
        const channel = await new NativeGrpcClient(PROXY, new TestLogger()).connect(
            { endpoint: 'https://hyper:7484', tls: { keyPath: '/key', pubPath: '/pub', caPath: '/ca' } },
            METADATA,
        );
        expect(channel.channelId).toBe(3);
        const headers = seen[0].headers;
        expect([headers.get('dashql-endpoint'), headers.get('dashql-tls'), headers.get('authorization')]).toEqual(['https://hyper:7484', '1', 'Bearer token']);
        expect([headers.get('dashql-tls-client-key'), headers.get('dashql-tls-client-cert'), headers.get('dashql-tls-cacerts')]).toEqual(['/key', '/pub', '/ca']);
    });

    it('reads the messages of a server stream across batches', async () => {
        const { requests, seen } = installNativeGrpcProxy([
            batch(NativeGrpcServerStreamBatchEvent.FlushAfterBytes, ['a', 'bc']),
            batch(NativeGrpcServerStreamBatchEvent.StreamFinished, ['def']),
        ]);
        const channel = await new NativeGrpcClient(PROXY, new TestLogger()).connect({ endpoint: 'https://hyper' }, METADATA);
        const stream = await channel.startServerStream({ path: '/salesforce.hyperdb.grpc.v1.HyperService/ExecuteQuery', body: new Uint8Array([1]) });
        const messages = new NativeGrpcServerStreamMessageIterator(stream, new TestLogger());

        expect(await readAll(messages)).toEqual(['a', 'bc', 'def']);
        expect(messages.metadata.get('x-trailer')).toBe(NativeGrpcServerStreamBatchEvent.StreamFinished);
        expect(seen[1].headers.get('dashql-path')).toBe('/salesforce.hyperdb.grpc.v1.HyperService/ExecuteQuery');
        expect(requests).toEqual(['POST /grpc/channels', 'POST /grpc/channel/3/streams', 'GET /grpc/channel/3/stream/7', 'GET /grpc/channel/3/stream/7']);

        // A finished stream needs no drop
        await stream.destroy();
        await channel.close();
        expect(requests.slice(4)).toEqual(['DELETE /grpc/channel/3']);
    });

    it('drops a stream with a corrupt batch', async () => {
        const { requests } = installNativeGrpcProxy([batch(NativeGrpcServerStreamBatchEvent.FlushAfterBytes, ['a'], 2)]);
        const channel = await new NativeGrpcClient(PROXY, new TestLogger()).connect({ endpoint: 'https://hyper' }, METADATA);
        const stream = await channel.startServerStream({ path: '/p', body: new Uint8Array() });
        await expect(stream.read()).rejects.toThrow('batch message count mismatch');
        expect(requests[requests.length - 1]).toBe('DELETE /grpc/channel/3/stream/7');
    });

    it('fails on failed streams and on proxy errors', async () => {
        installNativeGrpcProxy([
            batch(NativeGrpcServerStreamBatchEvent.StreamFailed, []),
            new Response(JSON.stringify({ message: 'unavailable' }), { status: 400, headers: { 'dashql-error': 'true', 'dashql-grpc-status': '14' } }),
        ]);
        const channel = await new NativeGrpcClient(PROXY, new TestLogger()).connect({ endpoint: 'https://hyper' }, METADATA);
        const failed = await channel.startServerStream({ path: '/p', body: new Uint8Array() });
        await expect(failed.next()).rejects.toThrow('stream failed');
        expect(await failed.next()).toEqual({ value: undefined, done: true });

        const broken = await channel.startServerStream({ path: '/p', body: new Uint8Array() });
        const error = await broken.read().catch(error => error);
        expect(error).toBeInstanceOf(ChannelError);
        expect(error).toMatchObject({ message: 'unavailable', statusCode: 14 });
    });

    it('drops an unfinished stream on destroy', async () => {
        const { requests } = installNativeGrpcProxy([]);
        const channel = await new NativeGrpcClient(PROXY, new TestLogger()).connect({ endpoint: 'https://hyper' }, METADATA);
        const stream = await channel.startServerStream({ path: '/p', body: new Uint8Array() });
        await stream.destroy();
        expect(requests[requests.length - 1]).toBe('DELETE /grpc/channel/3/stream/7');
    });
});
