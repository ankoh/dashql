import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudPanel } from './cloud_overlay.js';
import { AppConfigProvider, useAppConfig, type AppConfig } from '../config/app_config.js';
import { FlavorProvider } from '../config/flavor_provider.js';
import { ConnectionRegistry, useConnectionRegistry } from '../connections/connection_registry.js';
import { ConnectionHealth, ConnectionStatus, type ConnectionState } from '../connections/connection_state.js';
import { CONNECTOR_INFOS, ConnectorType, HYPER_CONNECTOR, TRINO_CONNECTOR } from '../connections/connector_info.js';
import { EXECUTOR_CTX, type QueryExecutor } from '../connections/query_executor.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import type { HyperDB, HyperDBConnection } from '../platform/hyperdb/hyperdb_wasm.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { WorkbookTestBackend } from '../storage/workbook_test_backend.js';
import { createTestHyperDB, testDatabasePath } from '../tests/hyperdb_test_client.js';
import { createLocalCloudParams } from '../connections/cloud_connection.js';
import { createTestRoot } from '../tests/react_root.js';

// The Cloud overlay with a local cloud on the embedded Hyper of the tests, as the app runs it: the statements go through
// the query executor to the session of the local cloud connection, which attaches only the database of the local cloud

type Registry = ReturnType<typeof useConnectionRegistry>;

let database: HyperDB;
let dispose: () => Promise<void>;
let connection: HyperDBConnection;

beforeAll(async () => {
    const test = await createTestHyperDB('dashql-cloud-overlay');
    database = test.database;
    dispose = test.dispose;
    const path = await testDatabasePath(`dashql-cloud-overlay-${crypto.randomUUID()}.hyper`);
    connection = await database.connect({ defaultDatabase: null, attachedDatabases: [{ path, alias: 'dashql' }] });
}, 60_000);
afterAll(async () => {
    await connection?.close();
    await dispose?.();
});

/// A connection of the registry, a local cloud unless Trino
function connectionState(connectionId: string, name: string, health: ConnectionHealth, trino = false): ConnectionState {
    return {
        connectionId,
        name,
        connectorInfo: CONNECTOR_INFOS[trino ? ConnectorType.TRINO : ConnectorType.HYPER],
        details: trino
            ? { type: TRINO_CONNECTOR, value: {} }
            : { type: HYPER_CONNECTOR, value: { proto: { setupParams: (createLocalCloudParams() as { hyper: unknown }).hyper } } },
        params: trino ? { trino: { endpoint: 'https://trino.example' } } : createLocalCloudParams(),
        active: true,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: health,
        catalog: { clear: vi.fn() },
        catalogUpdates: { tasksRunning: new Map() },
        queriesFinished: new Map(),
        queriesFinishedOrdered: [],
        queriesActive: new Map(),
        queriesActiveOrdered: [],
    } as unknown as ConnectionState;
}

describe('CloudPanel', () => {
    let root: ReturnType<typeof createTestRoot>;
    let registry: Registry | null;
    let config: AppConfig | null;
    let executed: string[];

    function Capture() {
        registry = useConnectionRegistry();
        config = useAppConfig();
        return null;
    }

    const execute: QueryExecutor = (connectionId, args) => {
        executed.push(`${connectionId}: ${args.query}`);
        return [executed.length, connection.query(args.query, args.abortSignal)];
    };

    beforeEach(async () => {
        await connection.execute(`DROP SCHEMA IF EXISTS "dashql"."dashql" CASCADE`);
        root = createTestRoot();
        registry = null;
        config = null;
        executed = [];
    });
    afterEach(() => root.unmount());

    const tree = (content: React.ReactElement | null) => (
        <LoggerProvider>
            <FlavorProvider requested={null}>
                <AppConfigProvider>
                    <MemoryRouter>
                        <StorageProvider backend={new WorkbookTestBackend()}>
                            <ConnectionRegistry>
                                <EXECUTOR_CTX.Provider value={{ execute, cancel: async () => {}, watchProfile: () => () => {} }}>
                                    <>
                                        <Capture />
                                        {content}
                                    </>
                                </EXECUTOR_CTX.Provider>
                            </ConnectionRegistry>
                        </StorageProvider>
                    </MemoryRouter>
                </AppConfigProvider>
            </FlavorProvider>
        </LoggerProvider>
    );

    const setHealth = async (connectionId: string, health: ConnectionHealth) => await act(async () => registry![1](reg => {
        reg.connections.set(connectionId, { ...reg.connections.get(connectionId)!, connectionHealth: health });
        return { ...reg };
    }));
    const installer = () => root.container.querySelector<HTMLElement>('[data-testid="cloud-installer"]');
    const button = (testId: string) => root.container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);

    it('picks the cloud connection and installs DashQL in it', async () => {
        await root.render(tree(null));
        await vi.waitFor(() => expect(config).not.toBeNull());
        await act(async () => registry![1](reg => {
            reg.connections.set('trial', connectionState('trial', 'Trial', ConnectionHealth.NOT_STARTED));
            reg.connections.set('trino', connectionState('trino', 'Lake', ConnectionHealth.ONLINE, true));
            return { ...reg };
        }));
        const onClose = vi.fn();
        await root.render(tree(<CloudPanel onClose={onClose} />));

        // Trino doesn't write, only the local cloud can be the cloud connection
        expect(root.container.textContent).toContain('No cloud connection, use one of');
        expect([...root.container.querySelectorAll('[data-testid="cloud-use-connection"]')]).toHaveLength(1);
        expect(root.container.textContent).toContain('Trial Wasm');
        expect(root.container.textContent).not.toContain('Lake');
        await act(async () => button('cloud-use-connection')!.click());
        await vi.waitFor(() => expect(config!.settings?.cloudConnectionId).toBe('trial'));

        // The installer waits for the connection, the panel offers to log in
        expect(installer()).toBeNull();
        expect(button('cloud-log-in')).not.toBeNull();
        expect(executed).toEqual([]);
        await setHealth('trial', ConnectionHealth.ONLINE);
        expect(button('cloud-log-in')).toBeNull();
        await vi.waitFor(() => expect(installer()?.dataset.state).toBe('missing'), { timeout: 10_000 });
        await act(async () => button('cloud-installer-run')!.click());
        await vi.waitFor(() => expect(installer()?.dataset.state).toBe('current'), { timeout: 10_000 });
        // The statements run on the local cloud connection like on any cloud connection
        expect(executed.length).toBeGreaterThan(0);
        expect(executed.every(sql => sql.startsWith('trial: '))).toBe(true);
        expect(Number((await connection.query(`SELECT version FROM "dashql"."dashql"."cloud_store"`)).get(0)!.version)).toBe(1);

        // A reset drops the tables, the installer starts over
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => button('cloud-reset-local')!.click());
        await vi.waitFor(() => expect(installer()?.dataset.state).toBe('missing'), { timeout: 10_000 });
        vi.restoreAllMocks();

        await act(async () => button('cloud-stop-using')!.click());
        await vi.waitFor(() => expect(config!.settings?.cloudConnectionId).toBeUndefined());
        expect(root.container.textContent).toContain('No cloud connection');
    });

    it('offers the setup without a connection that can be the cloud', async () => {
        await root.render(tree(<CloudPanel onClose={() => {}} />));
        await vi.waitFor(() => expect(config).not.toBeNull());
        expect(root.container.textContent).toContain('No cloud connection');
        expect(root.container.querySelector('[data-testid="cloud-use-connection"]')).toBeNull();
    });
});
