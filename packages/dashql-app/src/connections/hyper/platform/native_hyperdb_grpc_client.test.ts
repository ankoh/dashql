import * as arrow from 'apache-arrow';
import * as buf from '@bufbuild/protobuf';
import { afterEach, describe, expect, it } from 'vitest';

import * as pb from '../../../proto.js';
import { TestLogger } from '../../../platform/logger/test_logger.js';
import { AsyncConsumerLambdas } from '../../../utils/async_consumer.js';
import { installNativeGrpcProxy, nativeStreamBatch } from '../../../tests/mocks/native_proxy.js';
import type { HyperDatabaseConnectionContext } from '../hyperdb_grpc_client.js';
import { NativeHyperDatabaseClient } from './native_hyperdb_grpc_client.js';
import { tableFromArrays } from '../../../tests/arrow_fixtures.js';

const hyper = pb.salesforce_hyperdb_grpc_v1.pb;
const PROXY = { proxyEndpoint: new URL('dashql-native://localhost') };
const CONTEXT: HyperDatabaseConnectionContext = {
    getRequestMetadata: async () => ({}),
    getAttachedDatabases: () => [buf.create(hyper.AttachedDatabaseSchema, { path: '/data/db.hyper', alias: 'db' })],
    getQueryParameters: () => ({ lc_time: 'en_US' }),
    getClientContext: () => ({ app: 'dashql' }) as never,
};

/// The gRPC messages of a query result: a header and the Arrow IPC stream of the table
function resultMessages(table: arrow.Table): Uint8Array[] {
    const message = (result: buf.MessageInitShape<typeof hyper.QueryResultSchema$>) =>
        buf.toBinary(hyper.QueryResultSchema$, buf.create(hyper.QueryResultSchema$, result));
    return [
        message({ result: { case: 'header', value: {} } }),
        message({ result: { case: 'arrowChunk', value: { data: arrow.tableToIPC(table, 'stream') } } }),
    ];
}

const queryParam = (query: string) => buf.create(hyper.QueryParamSchema, { query });

describe('NativeHyperDatabaseClient', () => {
    afterEach(() => {
        delete globalThis.dashqlElectron;
    });

    it('executes a query with the attached databases and parameters and reads the Arrow batches', async () => {
        const table = tableFromArrays({ a: Int32Array.from([1, 2, 3]) });
        const { seen } = installNativeGrpcProxy([nativeStreamBatch('StreamFinished', resultMessages(table))]);
        const channel = await new NativeHyperDatabaseClient(PROXY, new TestLogger()).connect({ endpoint: 'http://localhost:7484' } as never, CONTEXT);
        expect(seen[0].headers.get('dashql-tls')).toBeNull();

        const stream = await channel.executeQuery(queryParam('select 1'));
        const sent = buf.fromBinary(hyper.QueryParamSchema, seen[1].body);
        expect(sent.query).toBe('select 1');
        expect(sent.outputFormat).toBe(hyper.QueryParam_OutputFormat.ARROW_STREAM);
        expect(sent.database.map(db => db.path)).toEqual(['/data/db.hyper']);
        expect(sent.params).toMatchObject({ lc_time: 'en_US', external_client_context: JSON.stringify({ app: 'dashql' }) });

        const batches: arrow.RecordBatch[] = [];
        await stream.produce(new AsyncConsumerLambdas((_, batch) => { batches.push(batch); }), new AsyncConsumerLambdas());
        expect((await stream.getSchema())!.fields.map(field => field.name)).toEqual(['a']);
        expect(batches.flatMap(batch => [...batch.getChild('a')!])).toEqual([1, 2, 3]);
        expect(stream.getMetrics().totalDataBytesReceived).toBeGreaterThan(0);
    });

    it('connects with TLS to https endpoints and rejects TLS files without https', async () => {
        const { seen } = installNativeGrpcProxy([]);
        const client = new NativeHyperDatabaseClient(PROXY, new TestLogger());
        await client.connect({ endpoint: 'https://hyper:7484', tls: { caCertsPath: '/ca' } } as never, CONTEXT);
        expect([seen[0].headers.get('dashql-tls'), seen[0].headers.get('dashql-tls-cacerts')]).toEqual(['1', '/ca']);
        await expect(client.connect({ endpoint: 'http://hyper:7484', tls: { caCertsPath: '/ca' } } as never, CONTEXT)).rejects.toThrow('https://');
    });

    it('starts no stream for an aborted query and closes the channel', async () => {
        const { requests } = installNativeGrpcProxy([]);
        const channel = await new NativeHyperDatabaseClient(PROXY, new TestLogger()).connect({ endpoint: 'http://localhost:7484' } as never, CONTEXT);
        await expect(channel.executeQuery(queryParam('select 1'), AbortSignal.abort())).rejects.toThrow();
        expect(requests).toEqual(['POST /grpc/channels']);
        await channel.close();
        expect(requests[requests.length - 1]).toBe('DELETE /grpc/channel/3');
    });

    it('rejects qsv1 result chunks', async () => {
        const qsv1 = buf.toBinary(hyper.QueryResultSchema$, buf.create(hyper.QueryResultSchema$, { result: { case: 'qsv1Chunk', value: {} } }));
        installNativeGrpcProxy([nativeStreamBatch('StreamFinished', [qsv1])]);
        const channel = await new NativeHyperDatabaseClient(PROXY, new TestLogger()).connect({ endpoint: 'http://localhost:7484' } as never, CONTEXT);
        const stream = await channel.executeQuery(queryParam('select 1'));
        await expect(stream.produce(new AsyncConsumerLambdas(), new AsyncConsumerLambdas())).rejects.toThrow('qsv1Chunk');
    });
});
