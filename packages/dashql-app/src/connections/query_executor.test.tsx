import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputeConnectionProvider, useComputeDatabase } from '../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '@ankoh/dashql-runtime/platform/database/embedded_database';
import { LoggableException, type Logger, type TracedLogger } from '@ankoh/dashql-runtime/platform/logger/logger';
import { HttpClientProvider } from '../platform/http/http_client_provider.js';
import { LoggerProvider, useLogger } from '../platform/logger/logger_provider.js';
import { QueryCacheMissError, type QueryResultCache, type QueryResultCacheEntry } from '@ankoh/dashql-runtime/query/query_result_cache';
import {
    createQueryResponseStreamMetrics,
    QueryExecutionStatus,
    QueryType,
    type QueryExecutionProgress,
    type QueryExecutionResponseStream,
    type QueryExecutionState,
} from '@ankoh/dashql-runtime/query/query_execution_state';

import { vectorFromArray } from '@ankoh/dashql-runtime/testing/arrow_fixtures';
import { WorkbookTestBackend } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { QueryResultCacheProvider } from '../storage/query_result_cache_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import type { AsyncConsumer } from '@ankoh/dashql-runtime/utils/async_consumer';
import { useConnectionRegistry } from './connection_registry.js';
import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { createTestConnection } from '@ankoh/dashql-runtime/testing/connection_fixtures';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR } from '@ankoh/dashql-runtime/connections/connector_info';
import { HyperLogMetricsProvider } from './hyper/hyper_log_metrics_provider.js';
import type { QueryExecutionArgs } from '@ankoh/dashql-runtime/connections/query_execution_args';
import { computeQueryCacheKeyForConnection, logQueryFailure } from '@ankoh/dashql-runtime/connections/query_executor_service';
import { useQueryExecutor, useQueryProfileDetail, useQueryState } from './query_executor.js';
import type { QueryExecutor } from '@ankoh/dashql-runtime/connections/query_execution_args';
import type { WatchQueryProfile } from '@ankoh/dashql-runtime/connections/query_executor_service';
import { TestRuntime } from '../tests/test_runtime.js';

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

    getMetrics() { return this.metrics; }
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
    execute: QueryExecutor;
    connection: ConnectionState;
    logger: Logger;
}

function Capture(props: { database: ConnectionState; capture: (api: Api) => void }) {
    const [registry, setRegistry] = useConnectionRegistry();
    const execute = useQueryExecutor();
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
        if (compute && connection) props.capture({ execute, connection, logger });
    });
    return null;
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
/// The core of the connections of the tests
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// A Hyper connection on the Rust connection of the core, online with a channel that runs the queries. Other setup
/// params than those of the connection are only read by the tests.
function createDatabase(executeQuery: unknown, setupParams?: object | null): ConnectionState {
    const state = createTestConnection(dql, {
        connectionId: CONNECTION_ID,
        params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as any,
        channel: { executeQuery, close: vi.fn() },
    });
    expect(state.connectionHealth).toBe(ConnectionHealth.ONLINE);
    if (setupParams === undefined) return state;
    const proto = { ...state.details.value.proto, setupParams: setupParams ?? undefined };
    return { ...state, details: { ...state.details, value: { ...state.details.value, proto } } } as ConnectionState;
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

// The behavior of the executor is tested in the runtime (connections/query_executor_service.test.ts), these are the
// hooks of the app on it
describe('the query executor of the app', () => {
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
            <TestRuntime>
                <HyperLogMetricsProvider>
                    <Capture database={database} capture={next => { api = next; }} />
                </HyperLogMetricsProvider>
            </TestRuntime>
        );
        await act(async () => {
            root.render(<LoggerProvider>
                <HttpClientProvider>
                    <StorageProvider backend={new WorkbookTestBackend()}>
                        <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                            <ComputeConnectionProvider>
                                {options.cache != null ? <QueryResultCacheProvider cache={options.cache}>{tree}</QueryResultCacheProvider> : tree}
                            </ComputeConnectionProvider>
                        </EmbeddedDatabaseProvider>
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
            const [id, execution] = api!.execute(CONNECTION_ID, args);
            queryId = id;
            table = await execution;
        });
        return { queryId, table };
    }
    async function finished(queryId: number): Promise<QueryExecutionState> {
        await vi.waitFor(() => expect(api!.connection.queriesFinished.has(queryId)).toBe(true));
        return api!.connection.queriesFinished.get(queryId)!;
    }

    describe('useQueryState', () => {
        function QueryStatus(props: { workbookId: string | null; queryId: number | null }) {
            const state = useQueryState(props.workbookId, props.queryId);
            return <div data-testid="status">{state == null ? 'none' : String(state.status)}</div>;
        }
        const statusOf = () => container.querySelector('[data-testid="status"]')?.textContent;

        it('finds a query on any connection, and nothing without a query or a workbook', async () => {
            const database = createDatabase(vi.fn(async () => new TestStream()));
            const render = async (workbookId: string | null, queryId: number | null) => {
                const setupDatabase = async () => ({ terminate: vi.fn() }) as unknown as EmbeddedComputeDatabase;
                await act(async () => {
                    root.render(<LoggerProvider>
                        <StorageProvider backend={new WorkbookTestBackend()}>
                            <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                                <ComputeConnectionProvider>
                                    <TestRuntime>
                                        <HyperLogMetricsProvider>
                                            <>
                                                <Capture database={database} capture={next => { api = next; }} />
                                                <QueryStatus workbookId={workbookId} queryId={queryId} />
                                            </>
                                        </HyperLogMetricsProvider>
                                    </TestRuntime>
                                </ComputeConnectionProvider>
                            </EmbeddedDatabaseProvider>
                        </StorageProvider>
                    </LoggerProvider>);
                });
                await vi.waitFor(() => expect(api).not.toBeNull());
            };
            await render('workbook', null);
            expect(statusOf()).toBe('none');
            const { queryId } = await run(argsOf());
            await render(null, queryId);
            expect(statusOf()).toBe('none');
            await render('workbook', queryId);
            await vi.waitFor(() => expect(statusOf()).toBe(String(QueryExecutionStatus.SUCCEEDED)));
            await render('workbook', queryId + 1000);
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
        const backend = new WorkbookTestBackend();
        const render = (queryId: number | null, enabled?: boolean) => act(async () => {
            root.render(
                <LoggerProvider>
                    <StorageProvider backend={backend}>
                        <TestRuntime watchProfile={watchProfile as WatchQueryProfile}>
                            <Viewer queryId={queryId} enabled={enabled} />
                        </TestRuntime>
                    </StorageProvider>
                </LoggerProvider>,
            );
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

    it('does nothing without a runtime', async () => {
        await act(async () => { root.render(<Viewer queryId={1} />); });
        expect(container.textContent).toBe('');
    });
});
