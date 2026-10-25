import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputationRegistry } from '../../compute/computation_registry.js';
import { ComputeConnectionProvider, useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '../../platform/database/embedded_database.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { createQueryResponseStreamMetrics, QueryExecutionStatus, QueryType, type QueryExecutionResponseStream } from '../../query/query_execution_state.js';
import { ConnectionRegistry, useConnectionRegistry } from '../connections/connection_registry.js';
import { ConnectionHealth, createConnectionMetrics, type ConnectionState } from '../connections/connection_state.js';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType, HYPER_CONNECTOR } from '../connections/connector_info.js';
import type { HyperLogMetrics } from '../connections/hyper/hyper_log_metrics.js';
import { HyperLogMetricsProvider, useHyperLogMetrics } from '../connections/hyper/hyper_log_metrics_provider.js';
import { QueryExecutorProvider, useQueryExecutor } from '../connections/query_executor.js';
import { SessionTestBackend } from '../storage/session_test_backend.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { SessionScriptsRegistryProvider } from './scripts/session_scripts_registry.js';
import { useMergeConnections } from './session_connection_merge.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/// A Hyper connection whose queries run until they are cancelled
function connection(connectionId: string) {
    const stream: QueryExecutionResponseStream = {
        cancel: vi.fn(async () => {}),
        getMetadata: () => new Map(),
        getMetrics: createQueryResponseStreamMetrics,
        getStatus: () => QueryExecutionStatus.RUNNING,
        getSchema: async () => null,
        produce: vi.fn<QueryExecutionResponseStream['produce']>(async (_batches, _progress, abort) => {
            await new Promise(resolve => abort?.addEventListener('abort', resolve, { once: true }));
            abort?.throwIfAborted();
        }),
    };
    const database = {
        connectionId, active: false,
        connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
        connectionHealth: ConnectionHealth.ONLINE, metrics: createConnectionMetrics(),
        params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } },
        details: { type: HYPER_CONNECTOR, value: { proto: {}, channel: { executeQuery: async () => stream, close: vi.fn() } } },
        catalog: { dropDescriptor: vi.fn(), destroy: vi.fn() },
        catalogRelationScript: { catalog_entry_id: 1, destroy: vi.fn() },
        catalogFunctionScript: { catalog_entry_id: 2, destroy: vi.fn() },
        catalogUpdates: { tasksRunning: new Map(), tasksFinished: new Map(), currentFullRefresh: null, lastFullRefresh: null, restoredAt: null },
        queriesActive: new Map(), queriesActiveOrdered: [],
        queriesFinished: new Map(), queriesFinishedOrdered: [], snapshotQueriesActiveFinished: 0,
    } as unknown as ConnectionState;
    return { database, stream };
}

interface Api {
    execute: ReturnType<typeof useQueryExecutor>;
    merge: ReturnType<typeof useMergeConnections>;
    logMetrics: HyperLogMetrics;
    connections: ReadonlyMap<string, ConnectionState>;
}

function Capture(props: { databases: ConnectionState[]; capture: (api: Api) => void }) {
    const [registry, setRegistry] = useConnectionRegistry();
    const execute = useQueryExecutor();
    const merge = useMergeConnections();
    const logMetrics = useHyperLogMetrics()!;
    const compute = useComputeDatabase();
    React.useEffect(() => {
        setRegistry(prev => {
            const next = { ...prev, connections: new Map(prev.connections), connectionsByType: CONNECTOR_TYPES.map(() => [] as string[]) };
            for (const database of props.databases) {
                next.connections.set(database.connectionId, database);
                next.connectionsByType[database.connectorInfo.connectorType].push(database.connectionId);
            }
            return next;
        });
    }, [props.databases, setRegistry]);
    React.useLayoutEffect(() => {
        if (compute) props.capture({ execute, merge, logMetrics, connections: registry.connections });
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
                <StorageProvider backend={new SessionTestBackend()}>
                    <ConnectionRegistry>
                        <SessionScriptsRegistryProvider>
                            <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                                <HyperLogMetricsProvider>
                                    <ComputeConnectionProvider>
                                        <ComputationRegistry>
                                            <QueryExecutorProvider>
                                                <Capture databases={[source.database, target.database]} capture={next => { api = next; }} />
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
