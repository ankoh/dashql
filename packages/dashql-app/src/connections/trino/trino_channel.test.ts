import type * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { createQueryResponseStreamMetrics } from '../../query/query_execution_state.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { ChannelError } from '../../platform/channel_common.js';
import { AsyncConsumerLambdas } from '../../utils/async_consumer.js';
import type { TrinoApiClientInterface, TrinoQueryResult } from './trino_api_client.js';
import { TrinoApiClient, TrinoApiEndpoint } from './trino_api_client.js';
import { TrinoChannel, TrinoQueryResultStream } from './trino_channel.js';
import * as proto from '../../proto.js';
import * as buf from '@bufbuild/protobuf';

const COLUMNS = [{ name: 'customer_id', type: 'bigint' }];
const state = (name: string) => ({ state: name }) as TrinoQueryResult['stats'];

/// A result stream starting at the first result, the API client returns the next results in order
function resultStream(first: Partial<TrinoQueryResult>, next: Partial<TrinoQueryResult>[] = []) {
    const getQueryResult = vi.fn();
    for (const result of next) getQueryResult.mockResolvedValueOnce({ id: 'query-id', ...result });
    const apiClient = { getQueryResult, cancelQuery: vi.fn() } as unknown as TrinoApiClientInterface;
    const stream = new TrinoQueryResultStream(
        new TestLogger(),
        apiClient,
        new TrinoApiEndpoint('https://example.com', {} as never),
        { id: 'query-id', ...first } as TrinoQueryResult,
        createQueryResponseStreamMetrics(),
    );
    return { stream, apiClient };
}

/// Produce all batches of a stream
async function produceAll(stream: TrinoQueryResultStream): Promise<arrow.RecordBatch[]> {
    const batches: arrow.RecordBatch[] = [];
    await stream.produce(
        new AsyncConsumerLambdas((_, batch) => { if (batch) batches.push(batch); }),
        new AsyncConsumerLambdas(),
    );
    return batches;
}

describe('TrinoQueryResultStream', () => {
    it('exposes the schema from an already-finished zero-row response', async () => {
        const { stream } = resultStream({ columns: COLUMNS, stats: state('FINISHED') });
        const schema = await stream.getSchema();
        expect(schema?.fields.map(field => field.name)).toEqual(['customer_id']);
    });

    it('uses Decimal128 for Trino decimals that exceed 64-bit precision', async () => {
        const { stream } = resultStream({ columns: [{ name: 'amount', type: 'decimal(21, 1)' }], stats: state('FINISHED') });
        const decimal = (await stream.getSchema())?.fields[0].type as arrow.Decimal;
        expect([decimal.precision, decimal.scale, decimal.bitWidth]).toEqual([21, 1, 128]);
    });

    it('follows the next URIs until the query finished and translates the data', async () => {
        const { stream, apiClient } = resultStream({ nextUri: 'next-1', stats: state('QUEUED') }, [
            { nextUri: 'next-2', columns: COLUMNS, stats: state('RUNNING') },
            { nextUri: 'next-3', columns: COLUMNS, data: [[1], [2]], stats: state('RUNNING') },
            { columns: COLUMNS, data: [[3]], stats: state('FINISHED') },
        ]);
        const batches = await produceAll(stream);
        expect(vi.mocked(apiClient.getQueryResult).mock.calls.map(call => call[1])).toEqual(['next-1', 'next-2', 'next-3']);
        expect(batches.map(batch => batch.toArray().map(row => row.customer_id))).toEqual([[1, 2], [3]]);
        expect(stream.getMetrics()).toMatchObject({ totalQueryRequestsStarted: 3, totalQueryRequestsSucceeded: 3, totalBatchesReceived: 2, totalRowsReceived: 3 });
    });

    it('fails on query errors and rejects a pending schema', async () => {
        const { stream } = resultStream({ nextUri: 'next-1', stats: state('QUEUED') }, [
            { error: { errorCode: 1, errorName: 'SYNTAX_ERROR', errorType: 'USER_ERROR', message: 'line 1' } } as Partial<TrinoQueryResult>,
        ]);
        const schema = stream.getSchema();
        await expect(produceAll(stream)).rejects.toBeInstanceOf(ChannelError);
        await expect(schema).rejects.toBeInstanceOf(ChannelError);
        expect(stream.getMetrics().totalQueryRequestsFailed).toEqual(1);
    });

    it('fails on data without a schema', async () => {
        const { stream } = resultStream({ nextUri: 'next-1', stats: state('RUNNING') }, [
            { data: [[1]], stats: state('FINISHED') },
        ]);
        await expect(produceAll(stream)).rejects.toThrow('Result schema is missing');
    });

    it('cancels the query by its id', async () => {
        const { stream, apiClient } = resultStream({ stats: state('RUNNING') });
        await stream.cancel();
        expect(apiClient.cancelQuery).toHaveBeenCalledWith(expect.any(TrinoApiEndpoint), 'query-id');
    });
});

describe('TrinoChannel', () => {
    /// A channel with basic auth whose HTTP client answers every request with the response
    function channel(response: () => Response) {
        const fetch = vi.fn(async () => response());
        const endpoint = new TrinoApiEndpoint('https://trino.example.com', { authType: 'AUTH_BASIC', basic: { username: 'user', secret: 'secret' } } as never);
        return { fetch, channel: new TrinoChannel(new TestLogger(), new TrinoApiClient(new TestLogger(), { fetch }), endpoint, 'hive') };
    }
    const query = (text: string) => buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, { query: text });

    it('posts the statement to the catalog and opens the result stream', async () => {
        const { fetch, channel: trino } = channel(() => new Response(JSON.stringify({ id: 'q1', columns: COLUMNS, stats: { state: 'FINISHED' } })));
        const stream = await trino.executeQuery(query('select 1'));

        const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
        expect(url.toString()).toBe('https://trino.example.com/v1/statement');
        expect(init.body).toBe('select 1');
        const headers = new Headers(init.headers);
        expect([headers.get('X-Trino-Catalog'), headers.get('X-Trino-User'), headers.get('Authorization')]).toEqual(['hive', 'user', `Basic ${btoa('user:secret')}`]);
        expect((await stream.getSchema())?.fields.map(field => field.name)).toEqual(['customer_id']);
        expect(stream.getMetrics()).toMatchObject({ totalQueryRequestsStarted: 1, totalQueryRequestsSucceeded: 1 });
    });

    it('fails on statements that Trino rejects', async () => {
        const { channel: trino } = channel(() => new Response('denied', { status: 403, statusText: 'Forbidden' }));
        await expect(trino.executeQuery(query('select 1'))).rejects.toMatchObject({ message: 'Query failed', keyValues: { status: '403', message: 'Forbidden' } });
    });
});

