import * as arrow from 'apache-arrow';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputationRegistry } from '../compute/computation_registry.js';
import { ComputeConnectionProvider, useComputeDatabase } from '../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { LoggableException, type Logger, type TracedLogger } from '../platform/logger/logger.js';
import { HttpClientProvider } from '../platform/http/http_client_provider.js';
import { LoggerProvider, useLogger } from '../platform/logger/logger_provider.js';
import { QueryCacheMissError, type QueryResultCache, type QueryResultCacheEntry } from '../query/query_result_cache.js';
import {
    createQueryResponseStreamMetrics,
    QueryExecutionStatus,
    QueryType,
    type QueryExecutionProgress,
    type QueryExecutionResponseStream,
    type QueryExecutionState,
} from '../query/query_execution_state.js';
import { SessionScriptsRegistryProvider } from '../session/scripts/session_scripts_registry.js';
import { vectorFromArray } from '../tests/arrow_fixtures.js';
import { SessionTestBackend } from '../storage/session_test_backend.js';
import { QueryResultCacheProvider } from '../storage/query_result_cache_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import type { AsyncConsumer } from '../utils/async_consumer.js';
import { ConnectionRegistry, useConnectionRegistry } from './connection_registry.js';
import { ConnectionHealth, createConnectionMetrics, type ConnectionState } from './connection_state.js';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR } from './connector_info.js';
import { HyperLogMetricsProvider } from './hyper/hyper_log_metrics_provider.js';
import type { QueryExecutionArgs } from './query_execution_args.js';
import {
    computeQueryCacheKeyForConnection,
    EXECUTOR_CTX,
    logQueryFailure,
    QueryExecutorProvider,
    useQueryProfileDetail,
    useQueryState,
    type QueryExecutorContextValue,
} from './query_executor.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const CONNECTION_ID = 'hyper';
const SIGNATURE = 'script-signature';
const SCHEMA = new arrow.Schema([new arrow.Field('n', new arrow.Int32())]);

function batchOf(values: number[]): arrow.RecordBatch {
    return new arrow.RecordBatch(SCHEMA, arrow.makeData({
        type: new arrow.Struct(SCHEMA.fields),
        length: values.length,
        children: [vectorFromArray(values, new arrow.Int32()).data[0]],
    }));
}

const tableOf = (values: number[]) => new arrow.Table(SCHEMA, [batchOf(values)]);

/// A result stream under the control of a test
class TestStream implements QueryExecutionResponseStream {
    readonly cancel = vi.fn(async () => { this.rejectProduce?.(new DOMException('cancelled', 'AbortError')); });
    readonly setProfileDetail = vi.fn<(wanted: boolean) => void>();
    readonly metrics = createQueryResponseStreamMetrics();
    private rejectProduce: ((error: unknown) => void) | null = null;
    private finishProduce: (() => void) | null = null;
    private produced = false;
    private sink: AsyncConsumer<QueryExecutionResponseStream, arrow.RecordBatch> | null = null;

    constructor(
        readonly batches: arrow.RecordBatch[] = [batchOf([1, 2])],
        /// Run until the test finishes the stream
        readonly hold = false,
        readonly failure: Error | null = null,
        readonly progress: QueryExecutionProgress[] = [],
    ) { }

    getMetadata() { return new Map([['source', 'test']]); }
    getMetrics() { return this.metrics; }
    getStatus() { return QueryExecutionStatus.RUNNING; }
    async getSchema() { return SCHEMA; }
    async produce(
        batches: AsyncConsumer<QueryExecutionResponseStream, arrow.RecordBatch>,
        progress: AsyncConsumer<QueryExecutionResponseStream, QueryExecutionProgress>,
        abort?: AbortSignal,
    ): Promise<void> {
        this.produced = true;
        this.sink = batches;
        for (const update of this.progress) await progress.resolve(this, update);
        if (this.failure != null) throw this.failure;
        for (const batch of this.batches) await batches.resolve(this, batch);
        if (!this.hold) return;
        await new Promise<void>((resolve, reject) => {
            this.finishProduce = resolve;
            this.rejectProduce = reject;
            abort?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
    }
    finish() { this.finishProduce?.(); }
    get started() { return this.produced && this.sink != null; }
}

interface Api {
    executor: QueryExecutorContextValue;
    connection: ConnectionState;
    logger: Logger;
}

function Capture(props: { database: ConnectionState; capture: (api: Api) => void }) {
    const [registry, setRegistry] = useConnectionRegistry();
    const executor = React.useContext(EXECUTOR_CTX)!;
    const compute = useComputeDatabase();
    const logger = useLogger();
    React.useEffect(() => {
        setRegistry(prev => {
            const next = { ...prev, connections: new Map(prev.connections), connectionsByType: CONNECTOR_TYPES.map(() => [] as string[]) };
            next.connections.set(props.database.connectionId, props.database);
            next.connectionsByType[props.database.connectorInfo.connectorType].push(props.database.connectionId);
            return next;
        });
    }, [props.database, setRegistry]);
    const connection = registry.connections.get(props.database.connectionId);
    React.useLayoutEffect(() => {
        if (compute && connection) props.capture({ executor, connection, logger });
    });
    return null;
}

function createDatabase(executeQuery: unknown, setupParams: object | null = { protocol: 'V3_GRPC', endpoint: 'http://hyper' }): ConnectionState {
    return {
        connectionId: CONNECTION_ID, active: false,
        connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
        connectionHealth: ConnectionHealth.ONLINE, metrics: createConnectionMetrics(),
        params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } },
        details: { type: HYPER_CONNECTOR, value: { proto: { setupParams }, channel: { executeQuery, close: vi.fn() } } },
        catalog: { dropDescriptor: vi.fn(), destroy: vi.fn() },
        catalogRelationScript: { catalog_entry_id: 1, destroy: vi.fn() },
        catalogFunctionScript: { catalog_entry_id: 2, destroy: vi.fn() },
        catalogUpdates: { tasksRunning: new Map(), tasksFinished: new Map(), currentFullRefresh: null, lastFullRefresh: null, restoredAt: null },
        queriesActive: new Map(), queriesActiveOrdered: [],
        queriesFinished: new Map(), queriesFinishedOrdered: [], snapshotQueriesActiveFinished: 0,
    } as unknown as ConnectionState;
}

function createCache(overrides: Partial<QueryResultCache> = {}): QueryResultCache {
    const entry: QueryResultCacheEntry = { name: 'key.uuid.parquet', key: 'key', size: 1, cachedAtMs: 1234, lastAccessMs: 1234 };
    return {
        mountPath: '/cache',
        lookup: vi.fn(async () => null),
        has: vi.fn(async () => false),
        retain: vi.fn(async () => null),
        list: vi.fn(async () => []),
        touch: vi.fn(async () => { }),
        delete: vi.fn(async () => true),
        clear: vi.fn(async () => []),
        pin: vi.fn(async () => async () => { }),
        newFileName: vi.fn((key: string) => `${key}.new.parquet`),
        newTransientFileName: vi.fn(() => 'transient.parquet'),
        mount: vi.fn(async () => { }),
        writeTable: vi.fn(async () => new File([], entry.name)),
        readTable: vi.fn(async () => tableOf([7])),
        remove: vi.fn(async () => { }),
        ...overrides,
    } as QueryResultCache;
}
const CACHE_HIT: QueryResultCacheEntry = { name: 'key.uuid.parquet', key: 'key', size: 1, cachedAtMs: 1234, lastAccessMs: 1234 };

const METADATA = { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
const argsOf = (overrides: Partial<QueryExecutionArgs> = {}): QueryExecutionArgs => ({
    query: 'select 1',
    metadata: METADATA,
    ...overrides,
});
const cacheableArgs = (overrides: Partial<QueryExecutionArgs> = {}) => argsOf({ cacheable: true, cacheSignature: SIGNATURE, ...overrides });

describe('QueryExecutorProvider', () => {
    let container: HTMLDivElement;
    let root: Root;
    let api: Api | null;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        api = null;
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    /// Render the executor. A compute database that holds Parquet files makes results cacheable.
    async function renderExecutor(executeQuery: unknown, options: {
        cache?: QueryResultCache;
        database?: ConnectionState;
        compute?: object;
    } = {}) {
        const database = options.database ?? createDatabase(executeQuery);
        const compute = options.compute ?? {};
        const setupDatabase = async () => ({ terminate: vi.fn(), ...compute }) as unknown as EmbeddedComputeDatabase;
        const tree = (
            <ComputationRegistry>
                <QueryExecutorProvider>
                    <Capture database={database} capture={next => { api = next; }} />
                </QueryExecutorProvider>
            </ComputationRegistry>
        );
        await act(async () => {
            root.render(<LoggerProvider>
                <HttpClientProvider>
                    <StorageProvider backend={new SessionTestBackend()}>
                        <ConnectionRegistry>
                            <SessionScriptsRegistryProvider>
                                <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                                    <HyperLogMetricsProvider>
                                        <ComputeConnectionProvider>
                                            {options.cache != null ? <QueryResultCacheProvider cache={options.cache}>{tree}</QueryResultCacheProvider> : tree}
                                        </ComputeConnectionProvider>
                                    </HyperLogMetricsProvider>
                                </EmbeddedDatabaseProvider>
                            </SessionScriptsRegistryProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </HttpClientProvider>
            </LoggerProvider>);
        });
        await vi.waitFor(() => expect(api).not.toBeNull());
    }
    const parquetDatabase = {
        registerExternalDirectory: vi.fn(),
        removeExternalDirectory: vi.fn(),
        registerExternalFile: vi.fn(),
        removeExternalFile: vi.fn(),
        refreshExternalDirectory: vi.fn(),
    };

    /// Run a query to its end
    async function run(args: QueryExecutionArgs): Promise<{ queryId: number; table: arrow.Table | null }> {
        let queryId = 0;
        let table: arrow.Table | null = null;
        await act(async () => {
            const [id, execution] = api!.executor.execute(CONNECTION_ID, args);
            queryId = id;
            table = await execution;
        });
        return { queryId, table };
    }
    async function finished(queryId: number): Promise<QueryExecutionState> {
        await vi.waitFor(() => expect(api!.connection.queriesFinished.has(queryId)).toBe(true));
        return api!.connection.queriesFinished.get(queryId)!;
    }

    describe('a client function call', () => {
        const description = (name: string, options: Record<string, unknown> = {}) => ({ namespace: 'cdp', function: name, effect: 'read' as const, explain: false, options });
        /// A Salesforce connection, the backend of its channel must stay out of a call
        const salesforce = (executeQuery: unknown): ConnectionState => {
            const database = createDatabase(executeQuery);
            return {
                ...database,
                connectorInfo: CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD],
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        proto: { setupParams: {} },
                        channel: {
                            executeQuery, close: vi.fn(),
                            coreToken: { accessToken: 'core-token', instanceUrl: 'https://org.my.salesforce.com' },
                            dataCloudToken: { instanceUrl: 'https://tenant.c360a.salesforce.com/', jwt: { raw: 'tenant-jwt' } },
                        },
                    },
                },
            } as unknown as ConnectionState;
        };
        afterEach(() => { vi.restoreAllMocks(); });

        it('asks the service and shows its result like any query', async () => {
            const backend = vi.fn();
            const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ segments: [{ apiName: 'Vip' }, { apiName: 'New' }] })));
            await renderExecutor(backend, { database: salesforce(backend) });
            const { queryId, table } = await run(argsOf({
                query: 'call cdp.segment_list ()',
                clientFunctionCall: description('segment_list'),
            }));
            expect(backend).not.toHaveBeenCalled();
            expect(fetch.mock.calls[0][0].toString()).toEqual('https://org.my.salesforce.com/services/data/v68.0/ssot/segments');
            expect(table!.numRows).toBe(2);
            expect(table!.getChild('api_name')!.get(1)).toEqual('New');
            const query = await finished(queryId);
            expect(query.status).toBe(QueryExecutionStatus.SUCCEEDED);
            expect(query.resultTable?.numRows).toBe(2);
        });

        it('fails with the message of the service', async () => {
            const backend = vi.fn();
            vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify([{ message: 'No access' }]), { status: 403 }));
            await renderExecutor(backend, { database: salesforce(backend) });
            const [queryId, execution] = api!.executor.execute(CONNECTION_ID, argsOf({ clientFunctionCall: description('segment_list'), throwOnError: true }));
            await act(async () => { await expect(execution).rejects.toThrow('No access'); });
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.FAILED);
            expect(backend).not.toHaveBeenCalled();
        });

        it('stops its request when it is cancelled', async () => {
            const backend = vi.fn();
            let onStarted = () => {};
            const started = new Promise<void>(resolve => { onStarted = resolve; });
            vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
                init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                onStarted();
            }));
            await renderExecutor(backend, { database: salesforce(backend) });
            const [queryId, execution] = api!.executor.execute(CONNECTION_ID, argsOf({ clientFunctionCall: description('segment_list') }));
            await act(async () => {
                await started;
                await api!.executor.cancel(CONNECTION_ID, queryId);
                await execution;
            });
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.CANCELLED);
        });
    });

    describe('a query', () => {
        it('collects the batches of the backend into a table', async () => {
            const stream = new TestStream([batchOf([1, 2]), batchOf([3])]);
            const executeQuery = vi.fn(async () => stream);
            await renderExecutor(executeQuery);
            const { queryId, table } = await run(argsOf());
            expect(executeQuery).toHaveBeenCalledOnce();
            expect(table!.numRows).toBe(3);
            const query = await finished(queryId);
            expect(query.status).toBe(QueryExecutionStatus.SUCCEEDED);
            expect(query.resultTable?.numRows).toBe(3);
            expect(query.resultMetadata?.get('source')).toBe('test');
        });

        it('passes the progress of the backend on', async () => {
            const update = { isQueued: false, metrics: null } as unknown as QueryExecutionProgress;
            await renderExecutor(vi.fn(async () => new TestStream(undefined, false, null, [update])));
            const { queryId } = await run(argsOf());
            const query = await finished(queryId);
            expect(query.status).toBe(QueryExecutionStatus.SUCCEEDED);
            expect(query.latestProgressUpdate).toEqual(expect.objectContaining(update));
        });

        it('drains a statement without a table when its results are not published', async () => {
            await renderExecutor(vi.fn(async () => new TestStream()));
            const { queryId, table } = await run(argsOf({ publishResults: false }));
            expect(table).toBeNull();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.SUCCEEDED);
        });

        it('reports the lifecycle to its observers once', async () => {
            await renderExecutor(vi.fn(async () => new TestStream()));
            const onTiming = vi.fn();
            const onResultsReady = vi.fn();
            await run(argsOf({ onTiming, onResultsReady }));
            expect(onTiming.mock.calls.map(call => call[0])).toEqual(['Results']);
            expect(onResultsReady).toHaveBeenCalledOnce();
        });

        it('is not interrupted by observers that throw', async () => {
            await renderExecutor(vi.fn(async () => new TestStream()));
            const boom = () => { throw new Error('observer failed'); };
            const { queryId, table } = await run(argsOf({ onTiming: boom, onResultsReady: boom, onLog: boom }));
            expect(table!.numRows).toBe(2);
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.SUCCEEDED);
        });

        it('streams the log messages of its trace while it runs', async () => {
            await renderExecutor(vi.fn(async () => new TestStream()));
            const unsubscribe = vi.spyOn(api!.logger.buffer, 'unsubscribeTrace');
            const messages: string[] = [];
            await run(argsOf({ onLog: message => messages.push(message) }));
            expect(messages).toContain('Executing query');
            expect(messages).toContain('Executed query');
            // The observer stops with the query
            await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
        });

        it('finishes without results when the backend returns no stream', async () => {
            await renderExecutor(vi.fn(async () => null));
            const onTiming = vi.fn();
            const { queryId, table } = await run(argsOf({ onTiming }));
            expect(table).toBeNull();
            expect(onTiming.mock.calls.map(call => call[0])).toEqual(['Results']);
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.SUCCEEDED);
        });

        it('runs on an explicit channel instead of the channel of the connection', async () => {
            const ownChannel = vi.fn();
            const override = vi.fn(async () => new TestStream());
            await renderExecutor(ownChannel);
            await run(argsOf({ channelOverride: { type: 'hyper', channel: { executeQuery: override } as never } }));
            expect(override).toHaveBeenCalledOnce();
            expect(ownChannel).not.toHaveBeenCalled();
        });
    });

    describe('a failing query', () => {
        it('records the failure and resolves with no result', async () => {
            await renderExecutor(vi.fn(async () => { throw new Error('table does not exist'); }));
            const { queryId, table } = await run(argsOf());
            expect(table).toBeNull();
            const query = await finished(queryId);
            expect(query.status).toBe(QueryExecutionStatus.FAILED);
            expect(query.error?.message).toBe('table does not exist');
        });

        it('hands the original error to hosts that ask for it', async () => {
            const failure = new Error('table does not exist');
            await renderExecutor(vi.fn(async () => { throw failure; }));
            let rejected: unknown = null;
            let queryId = 0;
            await act(async () => {
                const [id, execution] = api!.executor.execute(CONNECTION_ID, argsOf({ throwOnError: true }));
                queryId = id;
                await execution.catch(error => { rejected = error; });
            });
            expect(rejected).toBe(failure);
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.FAILED);
        });

        it('records a failure of the stream', async () => {
            await renderExecutor(vi.fn(async () => new TestStream([], false, new Error('connection lost'))));
            const { queryId, table } = await run(argsOf());
            expect(table).toBeNull();
            expect((await finished(queryId)).error?.message).toBe('connection lost');
        });

        it('does not apply the catalog changes of a failed statement', async () => {
            await renderExecutor(vi.fn(async () => { throw new Error('nope'); }));
            const onCatalogChanged = vi.fn();
            await run(argsOf({ catalogChanges: [{}] as never, onCatalogChanged }));
            expect(onCatalogChanged).not.toHaveBeenCalled();
        });

        it('rejects for a connection that does not exist', async () => {
            await renderExecutor(vi.fn());
            let rejected: Error | null = null;
            await act(async () => {
                const [, execution] = api!.executor.execute('unknown', argsOf());
                await execution.catch(error => { rejected = error; });
            });
            expect(rejected!.message).toContain("Couldn't find a connection with id unknown");
        });
    });

    describe('the analysis of a result', () => {
        it('fails the query and rejects, the result has no summaries', async () => {
            // The compute database of the test cannot run the analysis
            await renderExecutor(vi.fn(async () => new TestStream()));
            let rejected: Error | null = null;
            let queryId = 0;
            const onTiming = vi.fn();
            const onResultsReady = vi.fn();
            await act(async () => {
                const [id, execution] = api!.executor.execute(CONNECTION_ID, argsOf({ analyzeResults: true, onTiming, onResultsReady }));
                queryId = id;
                await execution.catch(error => { rejected = error; });
            });
            expect(rejected).not.toBeNull();
            // The results were ready before the analysis started
            expect(onResultsReady).toHaveBeenCalledOnce();
            expect(onTiming.mock.calls.map(call => call[0])).toEqual(['Results', 'Postprocess']);
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.FAILED);
        });
    });

    describe('the catalog changes of a statement', () => {
        it('tell the observer, an observer that throws does not fail the statement', async () => {
            await renderExecutor(vi.fn(async () => new TestStream()));
            const onCatalogChanged = vi.fn(() => { throw new Error('observer failed'); });
            const { queryId, table } = await run(argsOf({ catalogChanges: [{}] as never, onCatalogChanged }));
            expect(onCatalogChanged).toHaveBeenCalledOnce();
            expect(table).not.toBeNull();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.SUCCEEDED);
        });

        it('tell nobody when a statement changed nothing', async () => {
            await renderExecutor(vi.fn(async () => new TestStream()));
            const onCatalogChanged = vi.fn();
            await run(argsOf({ catalogChanges: [] as never, onCatalogChanged }));
            expect(onCatalogChanged).not.toHaveBeenCalled();
        });
    });

    describe('cancelling', () => {
        it('stops a running query at the backend', async () => {
            const stream = new TestStream(undefined, true);
            await renderExecutor(vi.fn(async () => stream));
            let queryId = 0;
            let execution!: Promise<arrow.Table | null>;
            await act(async () => { [queryId, execution] = api!.executor.execute(CONNECTION_ID, argsOf()); });
            await vi.waitFor(() => expect(stream.started).toBe(true));
            await act(async () => { await api!.executor.cancel(CONNECTION_ID, queryId); });
            expect(stream.cancel).toHaveBeenCalledOnce();
            expect(await execution).toBeNull();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.CANCELLED);
        });

        it('stops a query with the signal of the caller', async () => {
            const stream = new TestStream(undefined, true);
            await renderExecutor(vi.fn(async () => stream));
            const abort = new AbortController();
            let queryId = 0;
            let execution!: Promise<arrow.Table | null>;
            await act(async () => { [queryId, execution] = api!.executor.execute(CONNECTION_ID, argsOf({ abortSignal: abort.signal })); });
            await vi.waitFor(() => expect(stream.started).toBe(true));
            await act(async () => { abort.abort(); await execution; });
            expect(stream.cancel).toHaveBeenCalledOnce();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.CANCELLED);
        });

        it('does not reach the backend when the signal was aborted before', async () => {
            const executeQuery = vi.fn(async () => new TestStream());
            await renderExecutor(executeQuery);
            const abort = new AbortController();
            abort.abort();
            let queryId = 0;
            await act(async () => {
                const [id, execution] = api!.executor.execute(CONNECTION_ID, argsOf({ abortSignal: abort.signal }));
                queryId = id;
                await execution.catch(() => null);
            });
            expect(executeQuery).not.toHaveBeenCalled();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.CANCELLED);
        });

        it('cancels a stream that arrives after the cancel', async () => {
            const stream = new TestStream();
            let deliver!: (stream: TestStream) => void;
            await renderExecutor(vi.fn(() => new Promise<TestStream>(resolve => { deliver = resolve; })));
            let queryId = 0;
            let execution!: Promise<arrow.Table | null>;
            await act(async () => { [queryId, execution] = api!.executor.execute(CONNECTION_ID, argsOf()); });
            await vi.waitFor(() => expect(deliver).toBeDefined());
            let cancelled!: Promise<void>;
            await act(async () => { cancelled = api!.executor.cancel(CONNECTION_ID, queryId); });
            await act(async () => { deliver(stream); await cancelled; });
            expect(stream.cancel).toHaveBeenCalledOnce();
            expect(await execution).toBeNull();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.CANCELLED);
        });

        it('logs a backend that fails to cancel and still ends the query', async () => {
            const stream = new TestStream(undefined, true);
            stream.cancel.mockImplementation(async () => { throw new Error('backend gone'); });
            await renderExecutor(vi.fn(async () => stream));
            const warn = vi.spyOn(api!.logger, 'warn');
            let queryId = 0;
            let execution!: Promise<arrow.Table | null>;
            await act(async () => { [queryId, execution] = api!.executor.execute(CONNECTION_ID, argsOf()); });
            await vi.waitFor(() => expect(stream.started).toBe(true));
            await act(async () => { await api!.executor.cancel(CONNECTION_ID, queryId); });
            expect(warn).toHaveBeenCalledWith('Failed to cancel query at the backend', expect.objectContaining({ error: expect.stringContaining('backend gone') }), 'query_executor');
            expect(await execution).toBeNull();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.CANCELLED);
        });

        it('ignores a query that already ended', async () => {
            const stream = new TestStream();
            await renderExecutor(vi.fn(async () => stream));
            const { queryId } = await run(argsOf());
            await act(async () => { await api!.executor.cancel(CONNECTION_ID, queryId); });
            expect(stream.cancel).not.toHaveBeenCalled();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.SUCCEEDED);
        });
    });

    describe('the profile of a running query', () => {
        it('is fetched while a view shows it', async () => {
            const stream = new TestStream(undefined, true);
            await renderExecutor(vi.fn(async () => stream));
            let queryId = 0;
            let execution!: Promise<arrow.Table | null>;
            await act(async () => { [queryId, execution] = api!.executor.execute(CONNECTION_ID, argsOf()); });
            await vi.waitFor(() => expect(stream.started).toBe(true));
            // Nobody watched when the stream started
            expect(stream.setProfileDetail.mock.calls).toEqual([[false]]);
            const stopFirst = api!.executor.watchProfile(queryId);
            const stopSecond = api!.executor.watchProfile(queryId);
            stopFirst();
            // One view still shows it
            expect(stream.setProfileDetail.mock.lastCall).toEqual([true]);
            stopSecond();
            expect(stream.setProfileDetail.mock.lastCall).toEqual([false]);
            stream.finish();
            await act(async () => { await execution; });
        });

        it('is fetched from the start when a view shows it before the stream arrives', async () => {
            const stream = new TestStream();
            let deliver!: (stream: TestStream) => void;
            await renderExecutor(vi.fn(() => new Promise<TestStream>(resolve => { deliver = resolve; })));
            let queryId = 0;
            let execution!: Promise<arrow.Table | null>;
            await act(async () => { [queryId, execution] = api!.executor.execute(CONNECTION_ID, argsOf()); });
            await vi.waitFor(() => expect(deliver).toBeDefined());
            const stop = api!.executor.watchProfile(queryId);
            await act(async () => { deliver(stream); await execution; });
            expect(stream.setProfileDetail.mock.calls[0]).toEqual([true]);
            stop();
        });

        it('ignores a query that ended', async () => {
            const stream = new TestStream();
            await renderExecutor(vi.fn(async () => stream));
            const { queryId } = await run(argsOf());
            const calls = stream.setProfileDetail.mock.calls.length;
            api!.executor.watchProfile(queryId)();
            expect(stream.setProfileDetail.mock.calls.length).toBe(calls);
        });
    });

    describe('the query result cache', () => {
        const compute = parquetDatabase;

        it('stores the result of a miss for the next run', async () => {
            const cache = createCache();
            const stream = new TestStream();
            await renderExecutor(vi.fn(async () => stream), { cache, compute });
            const { queryId, table } = await run(cacheableArgs());
            expect(table!.numRows).toBe(2);
            await vi.waitFor(() => expect(cache.writeTable).toHaveBeenCalledOnce());
            const release = await (cache.pin as ReturnType<typeof vi.fn>).mock.results[0].value;
            expect(typeof release).toBe('function');
            await vi.waitFor(() => expect(api!.connection.queriesFinished.get(queryId)?.cacheKey).toBeTruthy());
            const query = api!.connection.queriesFinished.get(queryId)!;
            // This run hit the backend
            expect(query.servedFromCache).toBeFalsy();
        });

        it('serves a hit without reaching the backend', async () => {
            const cache = createCache({ lookup: vi.fn(async () => CACHE_HIT) });
            const executeQuery = vi.fn(async () => new TestStream());
            await renderExecutor(executeQuery, { cache, compute });
            const onResultsReady = vi.fn();
            const { queryId, table } = await run(cacheableArgs({ onResultsReady }));
            expect(executeQuery).not.toHaveBeenCalled();
            expect(table!.numRows).toBe(1);
            expect(onResultsReady).toHaveBeenCalledOnce();
            expect(cache.touch).toHaveBeenCalledWith(CACHE_HIT.name);
            expect(cache.writeTable).not.toHaveBeenCalled();
            const query = await finished(queryId);
            expect(query.status).toBe(QueryExecutionStatus.SUCCEEDED);
            expect(query.resultTable?.numRows).toBe(1);
            await vi.waitFor(() => expect(api!.connection.queriesFinished.get(queryId)?.servedFromCache).toBe(true));
            expect(api!.connection.queriesFinished.get(queryId)?.cachedAt?.getTime()).toBe(CACHE_HIT.cachedAtMs);
        });

        it('does not apply the catalog changes again for a cached result', async () => {
            const cache = createCache({ lookup: vi.fn(async () => CACHE_HIT) });
            await renderExecutor(vi.fn(), { cache, compute });
            const onCatalogChanged = vi.fn();
            await run(cacheableArgs({ catalogChanges: [{}] as never, onCatalogChanged }));
            expect(onCatalogChanged).not.toHaveBeenCalled();
        });

        it('runs on the backend for a refresh and stores the new result', async () => {
            const cache = createCache({ lookup: vi.fn(async () => CACHE_HIT) });
            const executeQuery = vi.fn(async () => new TestStream());
            await renderExecutor(executeQuery, { cache, compute });
            const { table } = await run(cacheableArgs({ refreshCache: true }));
            expect(cache.lookup).not.toHaveBeenCalled();
            expect(executeQuery).toHaveBeenCalledOnce();
            expect(table!.numRows).toBe(2);
            await vi.waitFor(() => expect(cache.writeTable).toHaveBeenCalledOnce());
        });

        it('fails a query that may only come from the cache on a miss', async () => {
            const cache = createCache();
            const executeQuery = vi.fn(async () => new TestStream());
            await renderExecutor(executeQuery, { cache, compute });
            let rejected: unknown = null;
            let queryId = 0;
            await act(async () => {
                const [id, execution] = api!.executor.execute(CONNECTION_ID, cacheableArgs({ cacheOnly: true, throwOnError: true }));
                queryId = id;
                await execution.catch(error => { rejected = error; });
            });
            expect(rejected).toBeInstanceOf(QueryCacheMissError);
            expect(executeQuery).not.toHaveBeenCalled();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.FAILED);
        });

        it('falls back to the backend when the lookup fails', async () => {
            const cache = createCache({ lookup: vi.fn(async () => { throw new Error('opfs gone'); }) });
            const executeQuery = vi.fn(async () => new TestStream());
            await renderExecutor(executeQuery, { cache, compute });
            const { table } = await run(cacheableArgs());
            expect(executeQuery).toHaveBeenCalledOnce();
            expect(table!.numRows).toBe(2);
        });

        it('treats an unreadable entry as a miss', async () => {
            const cache = createCache({
                lookup: vi.fn(async () => CACHE_HIT),
                readTable: vi.fn(async () => { throw new Error('corrupt parquet'); }),
            });
            const executeQuery = vi.fn(async () => new TestStream());
            await renderExecutor(executeQuery, { cache, compute });
            const { queryId, table } = await run(cacheableArgs());
            expect(executeQuery).toHaveBeenCalledOnce();
            expect(table!.numRows).toBe(2);
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.SUCCEEDED);
        });

        it('is not disturbed by a failed access record', async () => {
            const cache = createCache({
                lookup: vi.fn(async () => CACHE_HIT),
                touch: vi.fn(async () => { throw new Error('read only'); }),
            });
            await renderExecutor(vi.fn(), { cache, compute });
            const { queryId, table } = await run(cacheableArgs());
            expect(table!.numRows).toBe(1);
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.SUCCEEDED);
        });

        it('keeps the result when it cannot be stored, and releases the new file', async () => {
            const released = vi.fn(async () => { });
            const cache = createCache({
                pin: vi.fn(async () => released),
                writeTable: vi.fn(async () => { throw new Error('quota exceeded'); }),
            });
            await renderExecutor(vi.fn(async () => new TestStream()), { cache, compute });
            const { queryId, table } = await run(cacheableArgs());
            expect(table!.numRows).toBe(2);
            await vi.waitFor(() => expect(released).toHaveBeenCalledOnce());
            const query = await finished(queryId);
            expect(query.status).toBe(QueryExecutionStatus.SUCCEEDED);
            expect(query.cacheKey).toBeNull();
        });

        it('does not store a statement without a result', async () => {
            const cache = createCache();
            await renderExecutor(vi.fn(async () => new TestStream()), { cache, compute });
            await run(cacheableArgs({ publishResults: false }));
            expect(cache.pin).not.toHaveBeenCalled();
        });

        it('leaves queries that do not ask for the cache alone', async () => {
            const cache = createCache({ lookup: vi.fn(async () => CACHE_HIT) });
            await renderExecutor(vi.fn(async () => new TestStream()), { cache, compute });
            await run(argsOf());
            expect(cache.lookup).not.toHaveBeenCalled();
            expect(cache.pin).not.toHaveBeenCalled();
        });

        it('leaves a compute database without Parquet files alone', async () => {
            const cache = createCache({ lookup: vi.fn(async () => CACHE_HIT) });
            await renderExecutor(vi.fn(async () => new TestStream()), { cache });
            await run(cacheableArgs());
            expect(cache.lookup).not.toHaveBeenCalled();
        });

        it('leaves a connection that was not set up alone', async () => {
            const cache = createCache({ lookup: vi.fn(async () => CACHE_HIT) });
            const executeQuery = vi.fn(async () => new TestStream());
            await renderExecutor(executeQuery, { cache, compute, database: createDatabase(executeQuery, null) });
            await run(cacheableArgs());
            expect(cache.lookup).not.toHaveBeenCalled();
            expect(executeQuery).toHaveBeenCalledOnce();
        });

        it('honors a cancel during the lookup', async () => {
            let finishLookup!: (entry: QueryResultCacheEntry | null) => void;
            const cache = createCache({ lookup: vi.fn(() => new Promise<QueryResultCacheEntry | null>(resolve => { finishLookup = resolve; })) });
            const executeQuery = vi.fn(async () => new TestStream());
            await renderExecutor(executeQuery, { cache, compute });
            let queryId = 0;
            let execution!: Promise<arrow.Table | null>;
            await act(async () => { [queryId, execution] = api!.executor.execute(CONNECTION_ID, cacheableArgs()); });
            await vi.waitFor(() => expect(finishLookup).toBeDefined());
            let cancelled!: Promise<void>;
            await act(async () => { cancelled = api!.executor.cancel(CONNECTION_ID, queryId); });
            await act(async () => { finishLookup(CACHE_HIT); await cancelled; });
            expect(await execution).toBeNull();
            expect(executeQuery).not.toHaveBeenCalled();
            expect(cache.readTable).not.toHaveBeenCalled();
            expect((await finished(queryId)).status).toBe(QueryExecutionStatus.CANCELLED);
        });
    });

    describe('useQueryState', () => {
        function QueryStatus(props: { sessionId: string | null; queryId: number | null }) {
            const state = useQueryState(props.sessionId, props.queryId);
            return <div data-testid="status">{state == null ? 'none' : String(state.status)}</div>;
        }
        const statusOf = () => container.querySelector('[data-testid="status"]')?.textContent;

        it('finds a query on any connection, and nothing without a query or a session', async () => {
            const database = createDatabase(vi.fn(async () => new TestStream()));
            const render = async (sessionId: string | null, queryId: number | null) => {
                const setupDatabase = async () => ({ terminate: vi.fn() }) as unknown as EmbeddedComputeDatabase;
                await act(async () => {
                    root.render(<LoggerProvider>
                        <StorageProvider backend={new SessionTestBackend()}>
                            <ConnectionRegistry>
                                <SessionScriptsRegistryProvider>
                                    <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                                        <HyperLogMetricsProvider>
                                            <ComputeConnectionProvider>
                                                <ComputationRegistry>
                                                    <QueryExecutorProvider>
                                                        <>
                                                            <Capture database={database} capture={next => { api = next; }} />
                                                            <QueryStatus sessionId={sessionId} queryId={queryId} />
                                                        </>
                                                    </QueryExecutorProvider>
                                                </ComputationRegistry>
                                            </ComputeConnectionProvider>
                                        </HyperLogMetricsProvider>
                                    </EmbeddedDatabaseProvider>
                                </SessionScriptsRegistryProvider>
                            </ConnectionRegistry>
                        </StorageProvider>
                    </LoggerProvider>);
                });
                await vi.waitFor(() => expect(api).not.toBeNull());
            };
            await render('session', null);
            expect(statusOf()).toBe('none');
            const { queryId } = await run(argsOf());
            await render(null, queryId);
            expect(statusOf()).toBe('none');
            await render('session', queryId);
            await vi.waitFor(() => expect(statusOf()).toBe(String(QueryExecutionStatus.SUCCEEDED)));
            await render('session', queryId + 1000);
            expect(statusOf()).toBe('none');
        });
    });
});

describe('useQueryProfileDetail', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function Viewer(props: { queryId: number | null; enabled?: boolean }) {
        useQueryProfileDetail(props.queryId, props.enabled);
        return null;
    }

    it('watches the profile while mounted and enabled', async () => {
        const stop = vi.fn();
        const watchProfile = vi.fn(() => stop);
        const value = { execute: vi.fn(), cancel: vi.fn(), watchProfile } as unknown as QueryExecutorContextValue;
        const render = (queryId: number | null, enabled?: boolean) => act(async () => {
            root.render(<EXECUTOR_CTX.Provider value={value}><Viewer queryId={queryId} enabled={enabled} /></EXECUTOR_CTX.Provider>);
        });
        await render(null);
        expect(watchProfile).not.toHaveBeenCalled();
        await render(1, false);
        expect(watchProfile).not.toHaveBeenCalled();
        await render(1);
        expect(watchProfile).toHaveBeenCalledWith(1);
        await render(2);
        expect(stop).toHaveBeenCalledOnce();
        expect(watchProfile).toHaveBeenCalledWith(2);
    });

    it('does nothing without an executor', async () => {
        await act(async () => { root.render(<Viewer queryId={1} />); });
        expect(container.textContent).toBe('');
    });
});

describe('logQueryFailure', () => {
    const logger = () => ({ warn: vi.fn() }) as unknown as TracedLogger & { warn: ReturnType<typeof vi.fn> };

    it('logs the message and the details of a failure that describes itself', () => {
        const traced = logger();
        logQueryFailure(traced, new LoggableException('Syntax error', { line: '3' }, 'hyper'), 7, 'session');
        expect(traced.warn).toHaveBeenCalledWith('Syntax error', { line: '3', queryId: '7', sessionId: 'session' }, 'hyper');
    });

    it('logs the raw text of other failures', () => {
        const traced = logger();
        logQueryFailure(traced, new Error('boom'), 7, 'session');
        expect(traced.warn).toHaveBeenCalledWith('Query failed with unknown error', {
            queryId: '7',
            sessionId: 'session',
            raw: expect.stringContaining('boom'),
        }, 'query_executor');
    });
});

describe('computeQueryCacheKeyForConnection', () => {
    const details = (setupParams: object | null) => ({ type: HYPER_CONNECTOR, value: { proto: { setupParams } } }) as never;

    it('derives a stable key of the connection and the script', async () => {
        const params = { protocol: 'V3_GRPC', endpoint: 'http://hyper' };
        const key = await computeQueryCacheKeyForConnection(details(params), SIGNATURE);
        expect(key).toEqual(expect.any(String));
        expect(await computeQueryCacheKeyForConnection(details(params), SIGNATURE)).toBe(key);
        expect(await computeQueryCacheKeyForConnection(details(params), 'other')).not.toBe(key);
        expect(await computeQueryCacheKeyForConnection(details({ ...params, endpoint: 'http://other' }), SIGNATURE)).not.toBe(key);
    });

    it('reports no key before the setup of the connection', async () => {
        expect(await computeQueryCacheKeyForConnection(details(null), SIGNATURE)).toBeNull();
    });

    it('reports no key instead of failing', async () => {
        expect(await computeQueryCacheKeyForConnection({ type: 'unknown', value: { proto: { setupParams: {} } } } as never, SIGNATURE)).toBeNull();
    });
});
