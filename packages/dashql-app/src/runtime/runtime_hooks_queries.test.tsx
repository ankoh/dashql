import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputeConnectionProvider, useComputeDatabase } from '../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '@ankoh/dashql-runtime/platform/database/embedded_database';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import {
    createQueryResponseStreamMetrics,
    QueryExecutionStatus,
    QueryType,
    type QueryExecutionProgress,
    type QueryExecutionResponseStream,
} from '@ankoh/dashql-runtime/query/query_execution_state';

import { vectorFromArray } from '@ankoh/dashql-runtime/testing/arrow_fixtures';
import { WorkbookTestBackend } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { StorageProvider } from '../storage/storage_provider.js';
import type { AsyncConsumer } from '@ankoh/dashql-runtime/utils/async_consumer';
import { ConnectionHealth } from '@ankoh/dashql-runtime/connections/connection_state';
import { createTestConnection } from '@ankoh/dashql-runtime/testing/connection_fixtures';
import type { Runtime } from '@ankoh/dashql-runtime/runtime';
import { HyperLogMetricsProvider } from '../connections/hyper/hyper_log_metrics_provider.js';
import type { QueryExecutionArgs, QueryExecutor, WatchQueryProfile } from '@ankoh/dashql-runtime/connections/query_execution_args';
import { useQuery, useQueryProfileDetail, useRuntime } from './runtime_hooks.js';
import { TestRuntime } from '../tests/test_runtime.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const CONNECTION_ID = 'hyper';
const SCHEMA = new arrow.Schema([new arrow.Field('n', new arrow.Int32())]);

function batchOf(values: number[]): arrow.RecordBatch {
    return new arrow.RecordBatch(SCHEMA, arrow.makeData({
        type: new arrow.Struct(SCHEMA.fields),
        length: values.length,
        children: [vectorFromArray(values, new arrow.Int32()).data[0]],
    }));
}

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
}

/// Create the connection in the runtime of the test and capture the executor once the compute database is set up
function Capture(props: { database: (runtime: Runtime) => void; capture: (api: Api) => void }) {
    const runtime = useRuntime();
    const execute = runtime.execute;
    const compute = useComputeDatabase();
    const [created, setCreated] = React.useState(false);
    React.useEffect(() => {
        if (runtime.connection(CONNECTION_ID) == null) props.database(runtime);
        setCreated(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runtime]);
    React.useLayoutEffect(() => {
        if (compute && created) props.capture({ execute });
    });
    return null;
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// A Hyper connection of the runtime of the test, online with a channel that runs the queries
function createDatabase(executeQuery: unknown): (runtime: Runtime) => void {
    return runtime => {
        const state = createTestConnection(runtime, {
            connectionId: CONNECTION_ID,
            params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as any,
            channel: { executeQuery, close: vi.fn() },
        });
        expect(state.connectionHealth).toBe(ConnectionHealth.ONLINE);
    };
}

const METADATA = { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
const argsOf = (overrides: Partial<QueryExecutionArgs> = {}): QueryExecutionArgs => ({
    query: 'select 1',
    metadata: METADATA,
    ...overrides,
});

// The behavior of the executor is tested in the runtime, these are the hooks of the app on it
describe('the queries of the app', () => {
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

    /// Run a query to its end
    async function run(args: QueryExecutionArgs): Promise<{ queryId: number }> {
        let queryId = 0;
        await act(async () => {
            const [id, execution] = api!.execute(CONNECTION_ID, args);
            queryId = id;
            await execution;
        });
        return { queryId };
    }

    describe('useQuery', () => {
        function QueryStatus(props: { queryId: number | null }) {
            const state = useQuery(props.queryId);
            return <div data-testid="status">{state == null ? 'none' : String(state.status)}</div>;
        }
        const statusOf = () => container.querySelector('[data-testid="status"]')?.textContent;

        it('finds a query on any connection, and nothing without a query', async () => {
            const database = createDatabase(vi.fn(async () => new TestStream()));
            const render = async (queryId: number | null) => {
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
                                                <QueryStatus queryId={queryId} />
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
            await render(null);
            expect(statusOf()).toBe('none');
            const { queryId } = await run(argsOf());
            await render(queryId);
            await vi.waitFor(() => expect(statusOf()).toBe(String(QueryExecutionStatus.SUCCEEDED)));
            await render(queryId + 1000);
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
