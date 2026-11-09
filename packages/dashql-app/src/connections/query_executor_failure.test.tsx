import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputationRegistry } from '../compute/computation_registry.js';
import { ComputeConnectionProvider, useComputeDatabase } from '../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { QueryExecutionStatus, QueryType } from '../query/query_execution_state.js';
import { ConnectionRegistry, useConnectionRegistry } from './connection_registry.js';
import { ConnectionHealth, createConnectionMetrics, type ConnectionState } from './connection_state.js';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType, HYPER_CONNECTOR } from './connector_info.js';
import { HyperLogMetricsProvider } from './hyper/hyper_log_metrics_provider.js';
import { QueryExecutorProvider, useQueryExecutor } from './query_executor.js';
import { SessionTestBackend } from '../storage/session_test_backend.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { SessionScriptsRegistryProvider } from '../session/scripts/session_scripts_registry.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

interface Api {
    execute: ReturnType<typeof useQueryExecutor>;
    connections: ReadonlyMap<string, ConnectionState>;
}

function Capture(props: { database: ConnectionState; capture: (api: Api) => void }) {
    const [registry, setRegistry] = useConnectionRegistry();
    const execute = useQueryExecutor();
    const compute = useComputeDatabase();
    React.useEffect(() => {
        setRegistry(prev => {
            const next = { ...prev, connections: new Map(prev.connections), connectionsByType: CONNECTOR_TYPES.map(() => [] as string[]) };
            next.connections.set(props.database.connectionId, props.database);
            next.connectionsByType[props.database.connectorInfo.connectorType].push(props.database.connectionId);
            return next;
        });
    }, [props.database, setRegistry]);
    React.useLayoutEffect(() => {
        if (compute) props.capture({ execute, connections: registry.connections });
    });
    return null;
}

describe('QueryExecutorProvider', () => {
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

    it('records a query with a failure as failed without executing it', async () => {
        const executeQuery = vi.fn();
        const database = {
            connectionId: 'hyper', active: false,
            connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
            connectionHealth: ConnectionHealth.ONLINE, metrics: createConnectionMetrics(),
            params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } },
            details: { type: HYPER_CONNECTOR, value: { proto: {}, channel: { executeQuery, close: vi.fn() } } },
            catalog: { dropDescriptor: vi.fn(), destroy: vi.fn() },
            catalogRelationEntryId: 1,
            catalogFunctionScript: { catalog_entry_id: 2, destroy: vi.fn() },
            catalogUpdates: { tasksRunning: new Map(), tasksFinished: new Map(), currentFullRefresh: null, described: false, touchedRelations: [], touchedFailures: 0 },
            queriesActive: new Map(), queriesActiveOrdered: [],
            queriesFinished: new Map(), queriesFinishedOrdered: [], snapshotQueriesActiveFinished: 0,
        } as unknown as ConnectionState;
        let api: Api | null = null;
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
                                                <Capture database={database} capture={next => { api = next; }} />
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
        await vi.waitFor(() => expect(api?.connections.has('hyper')).toBe(true));
        let queryId = 0;
        await act(async () => {
            const [id, execution] = api!.execute('hyper', {
                query: 'select * from :missing',
                failure: new Error('bar.sql: unknown script :missing'),
                metadata: { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true },
            });
            queryId = id;
            await execution.catch(() => null);
        });
        expect(executeQuery).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            const query = api!.connections.get('hyper')!.queriesFinished.get(queryId);
            expect(query?.status).toBe(QueryExecutionStatus.FAILED);
            expect(query?.error?.message).toBe('bar.sql: unknown script :missing');
        });
    });
});
