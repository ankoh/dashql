import * as arrow from 'apache-arrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryExecutionResponseStreamMock } from './query_execution_mock.js';
import { HyperDatabaseClientMock } from './hyper/hyperdb_grpc_client_mock.js';
import { SalesforceAPIClientMock, type SalesforceConnectorMockConfig } from './salesforce/salesforce_api_client_mock.js';
import { QueryExecutionStatus, type QueryExecutionResponseStream } from '../query/query_execution_state.js';
import { AsyncConsumerLambdas } from '../utils/async_consumer.js';

/// Collect the batches that a stream produces
function batchCollector(): [arrow.RecordBatch[], AsyncConsumerLambdas<QueryExecutionResponseStream, arrow.RecordBatch>] {
    const batches: arrow.RecordBatch[] = [];
    return [batches, new AsyncConsumerLambdas((_stream, batch) => batches.push(batch))];
}

describe('the mocked query result stream', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('describes a running query with three int columns', async () => {
        vi.useFakeTimers();
        const stream = new QueryExecutionResponseStreamMock();
        expect(stream.getStatus()).toBe(QueryExecutionStatus.RUNNING);
        expect(stream.getMetadata().size).toBe(0);
        expect(stream.getMetrics()).toBe(stream.metrics);
        const schema = stream.getSchema();
        await vi.advanceTimersByTimeAsync(200);
        expect((await schema)?.fields.map(field => field.name)).toEqual(['A', 'B', 'C']);
    });

    it('produces one batch of 1000 rows', async () => {
        vi.useFakeTimers();
        const stream = new QueryExecutionResponseStreamMock();
        const [batches, consumer] = batchCollector();
        const produced = stream.produce(consumer, new AsyncConsumerLambdas());
        await vi.advanceTimersByTimeAsync(400);
        await produced;
        expect(batches.length).toBe(1);
        expect(batches[0].numRows).toBe(1000);
        expect(batches[0].schema.fields.map(field => field.name)).toEqual(['A', 'B', 'C']);
        for (const name of ['A', 'B', 'C']) {
            const values = batches[0].getChild(name)!.toArray() as Int32Array;
            expect(values.length).toBe(1000);
            expect(values.every(value => value >= 0 && value <= 1000)).toBe(true);
        }
        expect(stream.batchesWritten).toBe(1);
    });

    it('stops producing when aborted', async () => {
        vi.useFakeTimers();
        const stream = new QueryExecutionResponseStreamMock();
        const [batches, consumer] = batchCollector();
        const abort = new AbortController();
        const produced = stream.produce(consumer, new AsyncConsumerLambdas(), abort.signal);
        const failed = expect(produced).rejects.toThrow('stop');
        abort.abort(new Error('stop'));
        await vi.advanceTimersByTimeAsync(400);
        await failed;
        expect(batches).toEqual([]);
        expect(stream.batchesWritten).toBe(0);
    });
});

describe('the mocked connector clients', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('opens Hyper channels that return mocked results', async () => {
        const channel = await new HyperDatabaseClientMock().connect({} as never, {} as never);
        const stream = await channel.executeQuery({} as never);
        expect(stream).toBeInstanceOf(QueryExecutionResponseStreamMock);
        await expect(channel.close()).resolves.toBeUndefined();
    });

    it('returns the configured Salesforce tokens and metadata after a delay', async () => {
        vi.useFakeTimers();
        const config = {
            enabled: true,
            pkceChallenge: { value: 'challenge', verifier: 'verifier' },
            coreAccess: { accessToken: 'core' },
            coreUserInfo: { userId: 'user' },
            dataCloudAccess: { accessToken: { token: 'data-cloud' } },
            dataCloudMetadata: { entities: [] },
        } as unknown as SalesforceConnectorMockConfig;
        const client = new SalesforceAPIClientMock(config);
        const cancel = new AbortController().signal;
        const pending = Promise.all([
            client.getCoreAccessToken({} as never, {} as never, 'code', 'verifier', cancel),
            client.getCoreUserInfo(config.coreAccess, cancel),
            client.getDataCloudMetadata(config.coreAccess, 'default', cancel),
            client.getDataCloudAccessToken(config.coreAccess, cancel),
        ]);
        await vi.advanceTimersByTimeAsync(200);
        expect(await pending).toEqual([config.coreAccess, config.coreUserInfo, config.dataCloudMetadata, config.dataCloudAccess]);
        expect(client.executeQuery('select 1', config.dataCloudAccess)).toBeInstanceOf(QueryExecutionResponseStreamMock);
    });
});
