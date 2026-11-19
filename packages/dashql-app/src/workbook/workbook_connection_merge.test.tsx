import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';
import { createTestConnection } from '@akohn/dashql/runtime/testing/connection_fixtures';

import { ComputeConnectionProvider, useComputeDatabase } from '../connections/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../platform/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '@akohn/dashql/platform/embedded_database';
import { LoggerProvider } from '../platform/logger_provider.js';
import { createQueryResponseStreamMetrics, QueryType, type QueryExecutionResponseStream } from '@akohn/dashql/platform/query/query_execution_state';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { useConnections, useRuntime } from '@akohn/dashql-react/hooks';
import type { HyperLogMetrics } from '../connections/hyper/hyper_log_metrics.js';
import { HyperLogMetricsProvider, useHyperLogMetrics } from '../connections/hyper/hyper_log_metrics_provider.js';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { StorageProvider } from '../storage/storage_provider.js';

import { useMergeConnections } from './workbook_connection_merge.js';
import { TestRuntime } from '../tests/test_runtime.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// A Hyper connection whose queries run until they are cancelled
function connection(connectionId: string) {
    const stream: QueryExecutionResponseStream = {
        cancel: vi.fn(async () => {}),
        getMetrics: createQueryResponseStreamMetrics,
        getSchema: async () => null,
        produce: vi.fn<QueryExecutionResponseStream['produce']>(async (_batches, _progress, abort) => {
            await new Promise(resolve => abort?.addEventListener('abort', resolve, { once: true }));
            abort?.throwIfAborted();
        }),
    };
    /// Create the connection in the runtime of the test
    const database = async (runtime: Runtime) => {
        const state: ConnectionState = await createTestConnection(runtime, {
            connectionId,
            params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as any,
            channel: { executeQuery: async () => stream, close: vi.fn() },
        });
        expect(state.connectionHealth).toBe(ConnectionHealth.ONLINE);
    };
    return { database, stream };
}

interface Api {
    execute: Runtime['execute'];
    merge: ReturnType<typeof useMergeConnections>;
    logMetrics: HyperLogMetrics;
    connections: ReadonlyMap<string, ConnectionState>;
}

function Capture(props: { databases: ((runtime: Runtime) => Promise<void>)[]; capture: (api: Api) => void }) {
    const connections = useConnections();
    const runtime = useRuntime();
    const execute = runtime.execute.bind(runtime);
    const merge = useMergeConnections();
    const logMetrics = useHyperLogMetrics()!;
    const compute = useComputeDatabase();
    const [created, setCreated] = React.useState(false);
    React.useEffect(() => {
        void (async () => {
            for (const create of props.databases) await create(runtime);
            setCreated(true);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runtime]);
    React.useLayoutEffect(() => {
        if (compute && created) props.capture({ execute, merge, logMetrics, connections });
    });
    return null;
}

describe('useMergeConnections', () => {
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

    it('shuts a merged connection down before deleting it with its folder', async () => {
        const source = connection('source');
        const target = connection('target');
        const setupDatabase = async () => ({ terminate: vi.fn() }) as unknown as EmbeddedComputeDatabase;
        await act(async () => {
            root.render(<LoggerProvider>
                <StorageProvider backend={new WorkbookTestBackend()}>
                    <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                        <ComputeConnectionProvider>
                            <TestRuntime>
                                <HyperLogMetricsProvider>
                                    <Capture databases={[source.database, target.database]} capture={next => { api = next; }} />
                                </HyperLogMetricsProvider>
                            </TestRuntime>
                        </ComputeConnectionProvider>
                    </EmbeddedDatabaseProvider>
                </StorageProvider>
            </LoggerProvider>);
        });
        await vi.waitFor(() => expect(api?.connections.has('source')).toBe(true));

        const [, execution] = api!.execute('source', {
            query: 'select 1',
            metadata: { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true },
        });
        await vi.waitFor(() => expect(source.stream.produce).toHaveBeenCalledTimes(1));

        // The log monitor closes the monitoring database in the folder of the connection
        let closeMonitor!: () => void;
        const forget = vi.spyOn(api!.logMetrics, 'forget').mockImplementation(() => new Promise(resolve => { closeMonitor = resolve; }));
        let merged = false;
        const merging = api!.merge('target', ['source']).then(() => { merged = true; });
        await vi.waitFor(() => expect(forget).toHaveBeenCalledWith('source'));
        // The running query was cancelled at the backend and settled before
        expect(source.stream.cancel).toHaveBeenCalledTimes(1);
        await expect(execution).resolves.toBeNull();
        // The connection, and with it its folder, outlives the open monitoring database
        expect(merged).toBe(false);
        expect(api!.connections.has('source')).toBe(true);
        await act(async () => {
            closeMonitor();
            await merging;
        });
        await vi.waitFor(() => expect(api!.connections.has('source')).toBe(false));
        expect(api!.connections.has('target')).toBe(true);
    });
});
