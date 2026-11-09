import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputationRegistry } from '../compute/computation_registry.js';
import { ComputeConnectionProvider, useComputeDatabase } from '../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { ConnectionRegistry, useConnectionRegistry } from '../connections/connection_registry.js';
import { ConnectionHealth, createConnectionMetrics, type ConnectionState } from '../connections/connection_state.js';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType, TRINO_CONNECTOR } from '../connections/connector_info.js';
import { HyperLogMetricsProvider } from '../connections/hyper/hyper_log_metrics_provider.js';
import { QueryExecutorProvider } from '../connections/query_executor.js';
import { SessionTestBackend, testSession } from '../storage/session_test_backend.js';
import { StorageProvider, useStorageWriter } from '../storage/storage_provider.js';
import type { StorageWriter } from '../storage/storage_writer.js';
import { scriptConnectionOf, type SessionScripts } from './scripts/session_scripts.js';
import { SessionScriptsRegistryProvider, useSessionScriptsRegistry } from './scripts/session_scripts_registry.js';
import { useReplaceConnection } from './session_connection_replace.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/// A Trino connection without a channel
function connection(connectionId: string, endpoint: string): ConnectionState {
    return {
        connectionId, active: true,
        connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO],
        connectionHealth: ConnectionHealth.NOT_STARTED, metrics: createConnectionMetrics(),
        params: { trino: { endpoint } },
        details: { type: TRINO_CONNECTOR, value: { proto: { setupParams: { endpoint } } } },
        catalog: { dropDescriptor: vi.fn(), destroy: vi.fn() },
        catalogRelationEntryId: 1,
        catalogFunctionScript: { catalog_entry_id: 2, destroy: vi.fn() },
        catalogUpdates: { tasksRunning: new Map(), tasksFinished: new Map(), currentFullRefresh: null, described: false },
        queriesActive: new Map(), queriesActiveOrdered: [],
        queriesFinished: new Map(), queriesFinishedOrdered: [], snapshotQueriesActiveFinished: 0,
    } as unknown as ConnectionState;
}

/// A session whose next script runs on a connection
function session(on: ConnectionState): SessionScripts {
    return {
        sessionId: SESSION_ID,
        pendingConnection: scriptConnectionOf(on),
        scripts: {},
        scriptRefs: {},
        scriptOrder: [],
        attachments: [],
    } as unknown as SessionScripts;
}

interface Api {
    replace: ReturnType<typeof useReplaceConnection>;
    writer: StorageWriter;
    connections: ReadonlyMap<string, ConnectionState>;
    sessions: ReadonlyMap<string, SessionScripts>;
}

function Capture(props: { databases: ConnectionState[]; session: SessionScripts; capture: (api: Api) => void }) {
    const [registry, setRegistry] = useConnectionRegistry();
    const [scripts, setScripts] = useSessionScriptsRegistry();
    const replace = useReplaceConnection();
    const writer = useStorageWriter();
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
        setScripts(prev => ({
            ...prev,
            sessionScriptsMap: new Map([[props.session.sessionId, props.session]]),
            sessionScriptsByConnection: new Map([[props.session.pendingConnection!.connectionId, [props.session.sessionId]]]),
        }));
    }, [props.databases, props.session, setRegistry, setScripts]);
    React.useLayoutEffect(() => {
        if (compute) props.capture({ replace, writer, connections: registry.connections, sessions: scripts.sessionScriptsMap });
    });
    return null;
}

describe('useReplaceConnection', () => {
    let container: HTMLDivElement;
    let root: Root;
    let api: Api | null;
    let backend: SessionTestBackend;
    const source = connection('source', 'http://old');
    const target = connection('target', 'http://new');

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        api = null;
        backend = new SessionTestBackend();
        await backend.saveSessionManifest(SESSION_ID, testSession({
            sessionId: SESSION_ID,
            connections: [{ connectionId: 'source', params: source.params! }],
        }));
        const setupDatabase = async () => ({ terminate: vi.fn() }) as unknown as EmbeddedComputeDatabase;
        await act(async () => {
            root.render(<LoggerProvider>
                <StorageProvider backend={backend}>
                    <ConnectionRegistry>
                        <SessionScriptsRegistryProvider>
                            <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                                <HyperLogMetricsProvider>
                                    <ComputeConnectionProvider>
                                        <ComputationRegistry>
                                            <QueryExecutorProvider>
                                                <Capture databases={[source, target]} session={session(source)} capture={next => { api = next; }} />
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
        await vi.waitFor(() => expect(api?.sessions.has(SESSION_ID)).toBe(true));
        await vi.waitFor(() => expect(api?.connections.has('source')).toBe(true));
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('rewrites the session files before it removes the replaced connection', async () => {
        let result!: Awaited<ReturnType<Api['replace']>>;
        await act(async () => { result = await api!.replace('source', 'target'); });
        expect(result).toEqual({ removed: true });
        await vi.waitFor(() => expect(api!.connections.has('source')).toBe(false));
        expect(api!.sessions.get(SESSION_ID)?.pendingConnection?.connectionId).toBe('target');
        // The session file names the target before the connection is gone
        const stored = await backend.loadSession(SESSION_ID);
        expect(stored.connections.map(copy => copy.connectionId)).toEqual(['target']);
    });

    it('keeps the replaced connection until the session files are written, a repeated replacement removes it', async () => {
        api!.writer.pauseSession(SESSION_ID);
        let result!: Awaited<ReturnType<Api['replace']>>;
        await act(async () => { result = await api!.replace('source', 'target'); });
        // The session moved, its file still names the replaced connection
        expect(result).toEqual({ removed: false });
        expect(api!.connections.has('source')).toBe(true);
        expect(api!.sessions.get(SESSION_ID)?.pendingConnection?.connectionId).toBe('target');
        expect((await backend.loadSession(SESSION_ID)).connections.map(copy => copy.connectionId)).toEqual(['source']);

        // Once the session writes again, the replacement continues
        api!.writer.resumeSession(SESSION_ID);
        await act(async () => { result = await api!.replace('source', 'target'); });
        expect(result).toEqual({ removed: true });
        await vi.waitFor(() => expect(api!.connections.has('source')).toBe(false));
        expect((await backend.loadSession(SESSION_ID)).connections.map(copy => copy.connectionId)).toEqual(['target']);
    });
});
