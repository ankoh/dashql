import type * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { createQueryResponseStreamMetrics } from '../../query/query_execution_state.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { ChannelError } from '../../platform/channel_common.js';
import { AsyncConsumerLambdas } from '../../utils/async_consumer.js';
import type { TrinoApiClientInterface, TrinoQueryResult, TrinoQueryStage } from './trino_api_client.js';
import { TrinoApiEndpoint } from './trino_api_client.js';
import { basicTrinoApi } from '../../tests/mocks/trino_api.js';
import { TrinoChannel, TrinoQueryResultStream } from './trino_channel.js';
import type { TrinoSessionDefaults } from './trino_catalogs.js';
import * as proto from '../../proto.js';
import * as buf from '@bufbuild/protobuf';

const COLUMNS = [{ name: 'customer_id', type: 'bigint' }];
const state = (name: string) => ({ state: name }) as TrinoQueryResult['stats'];
const trinoStage = (stageId: string, state: string, subStages: TrinoQueryStage[] = []) => ({ stageId, state, subStages }) as TrinoQueryStage;

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
    it('publishes the progress of the query response and of every poll with the raw statistics', async () => {
        const { stream } = resultStream(
            { stats: { ...state('QUEUED'), queued: true } as TrinoQueryResult['stats'], nextUri: 'https://example.com/next' },
            [{ stats: state('RUNNING'), nextUri: 'https://example.com/next2' }, { columns: COLUMNS, stats: state('FINISHED') }],
        );
        const progress: { phase?: string | null; kind?: string; state?: string }[] = [];
        await stream.produce(
            new AsyncConsumerLambdas(),
            new AsyncConsumerLambdas((_, update) => progress.push({
                phase: update.phase,
                kind: update.engineProgress?.kind,
                state: (update.engineProgress as { stats?: { state?: string } } | null | undefined)?.stats?.state,
            })),
        );
        expect(progress).toEqual([
            { phase: 'QUEUED', kind: 'trino_statement_stats', state: 'QUEUED' },
            { phase: 'RUNNING', kind: 'trino_statement_stats', state: 'RUNNING' },
            { phase: 'FINISHED', kind: 'trino_statement_stats', state: 'FINISHED' },
        ]);
    });

    it('requests the plans of the stages once the stages exist', async () => {
        const running = { ...state('RUNNING'), rootStage: { stageId: '0' } } as TrinoQueryResult['stats'];
        const { stream, apiClient } = resultStream(
            { stats: state('QUEUED'), nextUri: 'https://example.com/next' },
            [{ stats: running, nextUri: 'https://example.com/next2' }, { stats: running, nextUri: 'https://example.com/next3' }, { columns: COLUMNS, stats: state('FINISHED') }],
        );
        const info = { queryId: 'query-id', state: 'FINISHED', finalQueryInfo: true, stages: { stages: [] } };
        (apiClient as unknown as { getQueryInfo: ReturnType<typeof vi.fn> }).getQueryInfo = vi.fn().mockResolvedValue(info);
        stream.setProfileDetail(true);
        const kinds: (string | undefined)[] = [];
        await stream.produce(
            new AsyncConsumerLambdas(),
            new AsyncConsumerLambdas((_, update) => kinds.push(update.engineProgress?.kind)),
        );
        // The plans once, and the final QueryInfo of the finished query before the stream ends
        expect(kinds).toContain('trino_query_info');
        expect(kinds[kinds.length - 1]).toEqual('trino_query_info_stats');
        const calls = vi.mocked(apiClient.getQueryInfo).mock.calls;
        expect(calls.map(call => call.length > 3 ? 'pruned' : call[1])).toEqual(['query-id', 'query-id']);
    });

    it('fetches QueryInfo again when the tasks of more stages are done', async () => {
        const stages = (...states: string[]) => ({
            ...state('RUNNING'),
            rootStage: trinoStage('0', states[0], states.slice(1).map((s, i) => trinoStage(`${i + 1}`, s))),
        }) as TrinoQueryResult['stats'];
        const { stream, apiClient } = resultStream(
            { stats: stages('RUNNING', 'RUNNING', 'RUNNING'), nextUri: 'https://example.com/1' },
            [
                { stats: stages('RUNNING', 'RUNNING', 'PENDING'), nextUri: 'https://example.com/2' },
                { stats: stages('RUNNING', 'RUNNING', 'PENDING'), nextUri: 'https://example.com/3' },
                { stats: stages('RUNNING', 'PENDING', 'PENDING'), nextUri: 'https://example.com/4' },
                { columns: COLUMNS, stats: state('FINISHED') },
            ],
        );
        const final = { queryId: 'query-id', state: 'FINISHED', finalQueryInfo: true, stages: { stages: [] } };
        (apiClient as unknown as { getQueryInfo: ReturnType<typeof vi.fn> }).getQueryInfo = vi.fn().mockResolvedValue(final);
        stream.setProfileDetail(true);
        const kinds: (string | undefined)[] = [];
        await stream.produce(
            new AsyncConsumerLambdas(),
            new AsyncConsumerLambdas((_, update) => kinds.push(update.engineProgress?.kind)),
        );
        // The plans, one QueryInfo per stage whose tasks are done (one while the first is pending), the final one
        expect(kinds.filter(kind => kind === 'trino_query_info')).toHaveLength(1);
        expect(kinds.filter(kind => kind === 'trino_query_info_stats').length).toBeGreaterThanOrEqual(2);
        expect(vi.mocked(apiClient.getQueryInfo).mock.calls.length).toEqual(1 + kinds.filter(kind => kind === 'trino_query_info_stats').length);
    });

    it('fetches QueryInfo again while a stage whose tasks are done has no operator summaries', async () => {
        vi.useFakeTimers();
        try {
            const running = { ...state('RUNNING'), rootStage: trinoStage('0', 'PENDING') } as TrinoQueryResult['stats'];
            const { stream, apiClient } = resultStream({ stats: running, nextUri: 'https://example.com/next' });
            let resolveNext: (result: TrinoQueryResult) => void = () => {};
            vi.mocked(apiClient.getQueryResult).mockReturnValueOnce(new Promise(resolve => { resolveNext = resolve; }));
            const stage = (summaries: object[]) => ({ stageId: 'query-id.0', state: 'PENDING', stageStats: { operatorSummaries: summaries } });
            const getQueryInfo = vi.fn()
                .mockResolvedValueOnce({ queryId: 'query-id', state: 'RUNNING', stages: { stages: [stage([])] } })
                .mockResolvedValueOnce({ queryId: 'query-id', state: 'RUNNING', stages: { stages: [stage([{ operatorId: 0 }])] } })
                .mockResolvedValue({ queryId: 'query-id', state: 'FINISHED', finalQueryInfo: true, stages: { stages: [] } });
            (apiClient as unknown as { getQueryInfo: ReturnType<typeof vi.fn> }).getQueryInfo = getQueryInfo;
            stream.setProfileDetail(true);
            const produced = stream.produce(new AsyncConsumerLambdas(), new AsyncConsumerLambdas());
            await vi.advanceTimersByTimeAsync(0);
            expect(getQueryInfo).toHaveBeenCalledTimes(1);
            // The plans lack the summaries of the pending stage, one retry brings them, then no more retries
            await vi.advanceTimersByTimeAsync(1000);
            expect(getQueryInfo).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(5000);
            expect(getQueryInfo).toHaveBeenCalledTimes(2);
            resolveNext({ id: 'query-id', columns: COLUMNS, stats: state('FINISHED') } as TrinoQueryResult);
            await vi.advanceTimersByTimeAsync(0);
            await produced;
            expect(getQueryInfo).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it('fetches the QueryInfo of a finished query until it is final', async () => {
        vi.useFakeTimers();
        try {
            const running = { ...state('RUNNING'), rootStage: { stageId: '0' } } as TrinoQueryResult['stats'];
            const { stream, apiClient } = resultStream(
                { stats: running, nextUri: 'https://example.com/next' },
                [{ columns: COLUMNS, stats: state('FINISHED') }],
            );
            const getQueryInfo = vi.fn()
                .mockResolvedValueOnce({ queryId: 'query-id', state: 'RUNNING' })
                .mockResolvedValueOnce({ queryId: 'query-id', state: 'FINISHED', finalQueryInfo: false })
                .mockResolvedValue({ queryId: 'query-id', state: 'FINISHED', finalQueryInfo: true });
            (apiClient as unknown as { getQueryInfo: ReturnType<typeof vi.fn> }).getQueryInfo = getQueryInfo;
            stream.setProfileDetail(true);
            const produced = stream.produce(new AsyncConsumerLambdas(), new AsyncConsumerLambdas());
            await vi.advanceTimersByTimeAsync(1000);
            await produced;
            // The plans, a QueryInfo that is not final yet, the final one
            expect(getQueryInfo).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it('fetches no plans while nobody shows the profile', async () => {
        const running = { ...state('RUNNING'), rootStage: { stageId: '0' } } as TrinoQueryResult['stats'];
        const { stream, apiClient } = resultStream(
            { stats: running, nextUri: 'https://example.com/next' },
            [{ columns: COLUMNS, stats: state('FINISHED') }],
        );
        (apiClient as unknown as { getQueryInfo: ReturnType<typeof vi.fn> }).getQueryInfo = vi.fn().mockResolvedValue({});
        await stream.produce(new AsyncConsumerLambdas(), new AsyncConsumerLambdas());
        expect(apiClient.getQueryInfo).not.toHaveBeenCalled();
        // Showing the profile after the stream ended fetches nothing either
        stream.setProfileDetail(true);
        expect(apiClient.getQueryInfo).not.toHaveBeenCalled();
    });

    it('fetches no more QueryInfo when the query fails', async () => {
        vi.useFakeTimers();
        try {
            const running = { ...state('RUNNING'), rootStage: { stageId: '0' } } as TrinoQueryResult['stats'];
            const { stream, apiClient } = resultStream({ stats: running, nextUri: 'https://example.com/next' });
            (apiClient as unknown as { getQueryInfo: ReturnType<typeof vi.fn> }).getQueryInfo = vi.fn().mockResolvedValue({});
            stream.setProfileDetail(true);
            vi.mocked(apiClient.getQueryResult).mockRejectedValueOnce(new Error('connection lost'));
            await expect(stream.produce(new AsyncConsumerLambdas(), new AsyncConsumerLambdas())).rejects.toThrow('connection lost');
            await vi.advanceTimersByTimeAsync(10_000);
            // The plans only, nothing after the failure
            expect(apiClient.getQueryInfo).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

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

    it.each<[string, string]>([
        ['boolean', 'Bool'],
        ['tinyint', 'Int8'],
        ['smallint', 'Int16'],
        ['integer', 'Int32'],
        ['bigint', 'Int64'],
        ['real', 'Float32'],
        ['double', 'Float64'],
        ['decimal(10, 2)', 'Decimal[10e+2]'],
        ['decimal', 'Decimal[38e0]'],
        ['varchar(20)', 'Utf8'],
        ['char(3)', 'Utf8'],
        ['varbinary', 'Binary'],
        ['json', 'Utf8'],
        ['date', 'Date32<DAY>'],
        ['time(3)', 'Time32<MILLISECOND>'],
        ['timestamp(3)', 'Timestamp<MILLISECOND>'],
        ['timestamp(3) with time zone', 'Timestamp<MILLISECOND, UTC>'],
        ['interval day to second', 'Utf8'],
        ['uuid', 'Utf8'],
        ['ipaddress', 'Utf8'],
        ['array(integer)', 'Utf8'],
        ['row(a integer)', 'Utf8'],
        ['hyperloglog', 'Utf8'],
    ])('translates the Trino type %s', async (type, arrowType) => {
        const { stream } = resultStream({ columns: [{ name: 'c', type }], stats: state('FINISHED') });
        expect((await stream.getSchema())!.fields[0].type.toString()).toBe(arrowType);
    });

    it('follows the next URIs until the query finished and translates the data', async () => {
        const { stream, apiClient } = resultStream({ nextUri: 'next-1', stats: state('QUEUED') }, [
            { nextUri: 'next-2', columns: COLUMNS, stats: state('RUNNING') },
            { nextUri: 'next-3', columns: COLUMNS, data: [[1], [2]], stats: state('RUNNING') },
            { columns: COLUMNS, data: [[3]], stats: state('FINISHED') },
        ]);
        const batches = await produceAll(stream);
        expect(vi.mocked(apiClient.getQueryResult).mock.calls.map(call => call[1])).toEqual(['next-1', 'next-2', 'next-3']);
        expect(batches.map(batch => batch.toArray().map(row => row.customer_id))).toEqual([[1n, 2n], [3n]]);
        expect(stream.getMetrics()).toMatchObject({ totalQueryRequestsStarted: 3, totalQueryRequestsSucceeded: 3, totalBatchesReceived: 2, totalRowsReceived: 3 });
    });

    it('follows the next URIs through any query state', async () => {
        const { stream, apiClient } = resultStream({ nextUri: 'next-1', stats: state('QUEUED') }, [
            { nextUri: 'next-2', stats: state('PLANNING') },
            { nextUri: 'next-3', columns: COLUMNS, data: [[1]], stats: state('FINISHED') },
            { columns: COLUMNS, data: [[2]], stats: state('FINISHED') },
        ]);
        const batches = await produceAll(stream);
        expect(vi.mocked(apiClient.getQueryResult).mock.calls.map(call => call[1])).toEqual(['next-1', 'next-2', 'next-3']);
        expect(batches.map(batch => batch.toArray().map(row => row.customer_id))).toEqual([[1n], [2n]]);
    });

    it('requests the next page before producing the current one', async () => {
        const { stream, apiClient } = resultStream({ nextUri: 'next-1', stats: state('RUNNING') }, [
            { nextUri: 'next-2', columns: COLUMNS, data: [[1]], stats: state('RUNNING') },
            { columns: COLUMNS, data: [[2]], stats: state('FINISHED') },
        ]);
        const requestsAtBatch: number[] = [];
        await stream.produce(
            new AsyncConsumerLambdas(() => { requestsAtBatch.push(vi.mocked(apiClient.getQueryResult).mock.calls.length); }),
            new AsyncConsumerLambdas(),
        );
        expect(requestsAtBatch).toEqual([2, 2]);
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

    it('cancels the query by its next URI', async () => {
        const { stream, apiClient } = resultStream({ nextUri: 'next-1', stats: state('RUNNING') });
        await stream.cancel();
        expect(apiClient.cancelQuery).toHaveBeenCalledWith(expect.any(TrinoApiEndpoint), 'next-1');
    });

    it('does not cancel a query without a next URI', async () => {
        const { stream, apiClient } = resultStream({ stats: state('FINISHED') });
        await stream.cancel();
        expect(apiClient.cancelQuery).not.toHaveBeenCalled();
    });
});

describe('TrinoChannel', () => {
    /// A channel with basic auth whose HTTP client answers every request with the response
    function channel(response: () => Response, defaults: TrinoSessionDefaults = { catalog: null, schema: null }) {
        const { fetch, endpoint, client } = basicTrinoApi(response);
        return { fetch, channel: new TrinoChannel(new TestLogger(), client, endpoint, defaults) };
    }
    const sessionHeaders = (fetch: { mock: { calls: unknown[][] } }) => {
        const headers = new Headers((fetch.mock.calls[0] as [URL, RequestInit])[1].headers);
        return [headers.get('X-Trino-Catalog'), headers.get('X-Trino-Schema')];
    };
    const query = (text: string) => buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, { query: text });

    it('posts the statement without a default catalog or schema and opens the result stream', async () => {
        const { fetch, channel: trino } = channel(() => new Response(JSON.stringify({ id: 'q1', columns: COLUMNS, stats: { state: 'FINISHED' } })));
        const stream = await trino.executeQuery(query('select 1'));

        const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
        expect(url.toString()).toBe('https://trino.example.com/v1/statement');
        expect(init.body).toBe('select 1');
        const headers = new Headers(init.headers);
        expect([headers.get('X-Trino-Catalog'), headers.get('X-Trino-Schema'), headers.get('X-Trino-User'), headers.get('Authorization')]).toEqual([null, null, 'user', `Basic ${btoa('user:secret')}`]);
        expect((await stream.getSchema())?.fields.map(field => field.name)).toEqual(['customer_id']);
        expect(stream.getMetrics()).toMatchObject({ totalQueryRequestsStarted: 1, totalQueryRequestsSucceeded: 1 });
    });

    it('sends the default catalog and schema', async () => {
        const finished = () => new Response(JSON.stringify({ id: 'q1', columns: COLUMNS, stats: { state: 'FINISHED' } }));
        const withSchema = channel(finished, { catalog: 'hive', schema: 'sales' });
        await withSchema.channel.executeQuery(query('select 1'));
        expect(sessionHeaders(withSchema.fetch)).toEqual(['hive', 'sales']);
        const withoutSchema = channel(finished, { catalog: 'hive', schema: null });
        await withoutSchema.channel.executeQuery(query('select 1'));
        expect(sessionHeaders(withoutSchema.fetch)).toEqual(['hive', null]);
    });

    it('fails on statements that Trino rejects', async () => {
        const { channel: trino } = channel(() => new Response('denied', { status: 403, statusText: 'Forbidden' }));
        await expect(trino.executeQuery(query('select 1'))).rejects.toMatchObject({ message: 'Query failed', keyValues: { status: '403', message: 'Forbidden' } });
    });
});

