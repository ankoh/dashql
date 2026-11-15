import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputeConnectionProvider, useComputeDatabase } from '../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '@ankoh/dashql-runtime/platform/database/embedded_database';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { useConnectionRegistry } from '../connections/connection_registry.js';
import { ConnectionHealth, createConnectionMetrics, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType, TRINO_CONNECTOR } from '@ankoh/dashql-runtime/connections/connector_info';
import { HyperLogMetricsProvider } from '../connections/hyper/hyper_log_metrics_provider.js';

import { WorkbookTestBackend, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { StorageProvider, useStorageWriter } from '../storage/storage_provider.js';
import type { StorageWriter } from '@ankoh/dashql-runtime/storage/storage_writer';
import { createWorkbookScripts, scriptConnectionOf, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { createEmptyMetadata } from '@ankoh/dashql-runtime/workbook/scripts/script_types';
import * as core from '@ankoh/dashql-core';
import { createTestConnection } from '@ankoh/dashql-runtime/testing/connection_fixtures';
import { useWorkbookScriptsRegistry } from './scripts/workbook_scripts_registry.js';
import { useReplaceConnection } from './workbook_connection_replace.js';
import { TestRuntime } from '../tests/test_runtime.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

const WORKBOOK_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/// A Trino connection without a channel
function connection(connectionId: string, endpoint: string): ConnectionState {
    const state = createTestConnection(dql, { connectionId, params: { trino: { endpoint } } as any, active: true });
    expect(state.connectionHealth).toBe(ConnectionHealth.NOT_STARTED);
    return state;
}

/// A workbook whose next script runs on a connection
function workbook(on: ConnectionState): WorkbookScripts {
    return createWorkbookScripts({
        instance: dql,
        workbookId: WORKBOOK_ID,
        name: null,
        workbookMetadata: createEmptyMetadata(),
        pendingConnection: scriptConnectionOf(on),
        scripts: [],
        dataFiles: [],
    });
}

interface Api {
    replace: ReturnType<typeof useReplaceConnection>;
    writer: StorageWriter;
    connections: ReadonlyMap<string, ConnectionState>;
    workbooks: ReadonlyMap<string, WorkbookScripts>;
}

function Capture(props: { databases: ConnectionState[]; workbook: WorkbookScripts; capture: (api: Api) => void }) {
    const [registry, setRegistry] = useConnectionRegistry();
    const [scripts, setScripts] = useWorkbookScriptsRegistry();
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
            workbookScriptsMap: new Map([[props.workbook.workbookId, props.workbook]]),
            workbookScriptsByConnection: new Map([[props.workbook.pendingConnection!.connectionId, [props.workbook.workbookId]]]),
        }));
    }, [props.databases, props.workbook, setRegistry, setScripts]);
    React.useLayoutEffect(() => {
        if (compute) props.capture({ replace, writer, connections: registry.connections, workbooks: scripts.workbookScriptsMap });
    });
    return null;
}

describe('useReplaceConnection', () => {
    let container: HTMLDivElement;
    let root: Root;
    let api: Api | null;
    let backend: WorkbookTestBackend;
    let source: ConnectionState;
    let target: ConnectionState;

    beforeEach(async () => {
        source = connection('source', 'http://old');
        target = connection('target', 'http://new');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        api = null;
        backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(WORKBOOK_ID, testWorkbook({
            workbookId: WORKBOOK_ID,
            connections: [{ connectionId: 'source', params: source.params! }],
        }));
        const setupDatabase = async () => ({ terminate: vi.fn() }) as unknown as EmbeddedComputeDatabase;
        await act(async () => {
            root.render(<LoggerProvider>
                <StorageProvider backend={backend}>
                    <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                        <ComputeConnectionProvider>
                            <TestRuntime>
                                <HyperLogMetricsProvider>
                                    <Capture databases={[source, target]} workbook={workbook(source)} capture={next => { api = next; }} />
                                </HyperLogMetricsProvider>
                            </TestRuntime>
                        </ComputeConnectionProvider>
                    </EmbeddedDatabaseProvider>
                </StorageProvider>
            </LoggerProvider>);
        });
        await vi.waitFor(() => expect(api?.workbooks.has(WORKBOOK_ID)).toBe(true));
        await vi.waitFor(() => expect(api?.connections.has('source')).toBe(true));
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('rewrites the workbook files before it removes the replaced connection', async () => {
        let result!: Awaited<ReturnType<Api['replace']>>;
        await act(async () => { result = await api!.replace('source', 'target'); });
        expect(result).toEqual({ removed: true });
        await vi.waitFor(() => expect(api!.connections.has('source')).toBe(false));
        expect(api!.workbooks.get(WORKBOOK_ID)?.pendingConnection?.connectionId).toBe('target');
        // The workbook file names the target before the connection is gone
        const stored = await backend.loadWorkbook(WORKBOOK_ID);
        expect(stored.connections.map(copy => copy.connectionId)).toEqual(['target']);
    });

    it('keeps the replaced connection until the workbook files are written, a repeated replacement removes it', async () => {
        api!.writer.pauseWorkbook(WORKBOOK_ID);
        let result!: Awaited<ReturnType<Api['replace']>>;
        await act(async () => { result = await api!.replace('source', 'target'); });
        // The workbook moved, its file still names the replaced connection
        expect(result).toEqual({ removed: false });
        expect(api!.connections.has('source')).toBe(true);
        expect(api!.workbooks.get(WORKBOOK_ID)?.pendingConnection?.connectionId).toBe('target');
        expect((await backend.loadWorkbook(WORKBOOK_ID)).connections.map(copy => copy.connectionId)).toEqual(['source']);

        // Once the workbook writes again, the replacement continues
        api!.writer.resumeWorkbook(WORKBOOK_ID);
        await act(async () => { result = await api!.replace('source', 'target'); });
        expect(result).toEqual({ removed: true });
        await vi.waitFor(() => expect(api!.connections.has('source')).toBe(false));
        expect((await backend.loadWorkbook(WORKBOOK_ID)).connections.map(copy => copy.connectionId)).toEqual(['target']);
    });
});
