import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudSetupPage, cloudSetupStep, type CloudSetupPageDependencies } from './cloud_setup_page.js';
import { CloudStateProvider, useClouds, type CloudsApi } from './cloud_state.js';
import { CLOUD_DATABASE, CLOUD_MIGRATIONS, installCloudStore } from './cloud_store_schema.js';
import { createCloudFolder, deleteCloudFolder } from './cloud_folders.js';
import { describeCloudCleanup } from './cloud_cleanup.js';
import { isCloudLink, useCloudSetupGate } from '../app/loading/cloud_setup_gate.js';
import { AppConfigProvider, useAppConfig, useAppReconfigure, type AppConfig } from '../config/app_config.js';
import { FlavorProvider } from '../config/flavor_provider.js';
import { ConnectionHealth, ConnectionStatus, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import type { QueryExecutor } from '@akohn/dashql/platform/connections/query_execution_args';
import { TestRuntime } from '../tests/test_runtime.js';
import { LoggerProvider } from '../platform/logger_provider.js';
import type { HyperDB, HyperDBConnection } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { StorageProvider } from '../storage/storage_provider.js';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { createTestHyperDB, testDatabasePath } from '../tests/hyperdb_test_client.js';
import { createLocalCloudParams } from '../connections/cloud_connection.js';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import * as core from '@akohn/dashql';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { useConnections, useRuntime } from '@akohn/dashql-react/hooks';
import { addTestConnection, setTestConnectionHealth } from '../tests/test_connections.js';

// The page of the cloud setup on the embedded Hyper of the tests: a Hyper server and a local cloud, each with a session
// that the query executor runs their statements on, with a database attached as "dashql".

type Registry = ReadonlyMap<string, ConnectionState>;
let appRuntime: Runtime | null = null;

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let database: HyperDB;
let dispose: () => Promise<void>;
/// The session of the Hyper server
let connection: HyperDBConnection;
/// The session of the local cloud, it attaches only the database of the local cloud
let localCloud: HyperDBConnection;

beforeAll(async () => {
    await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    const test = await createTestHyperDB('dashql-cloud-setup');
    database = test.database;
    dispose = test.dispose;
    connection = await database.connect();
    const path = await testDatabasePath(`dashql-cloud-setup-${crypto.randomUUID()}.hyper`);
    await connection.execute(`CREATE DATABASE "${path}"`);
    await connection.execute(`ATTACH DATABASE "${path}" AS "${CLOUD_DATABASE}"`);
    const localPath = await testDatabasePath(`dashql-cloud-setup-local-${crypto.randomUUID()}.hyper`);
    localCloud = await database.connect({ defaultDatabase: null, attachedDatabases: [{ path: localPath, alias: CLOUD_DATABASE }] });
}, 60_000);
afterAll(async () => {
    await connection?.close();
    await localCloud?.close();
    await dispose?.();
});

/// A Hyper connection of the runtime, a server unless a local cloud
function hyperConnection(connectionId: string, health: ConnectionHealth, local = false, setupError?: string): ConnectionState {
    const params = local
        ? createLocalCloudParams() as unknown as { hyper: Record<string, unknown> }
        : { hyper: { protocol: 'V3_HTTP', endpoint: 'http://localhost:7484' } };
    return {
        connectionId,
        name: local ? 'Trial' : 'Server',
        connectorType: ConnectorType.HYPER,
        details: { setupParams: params.hyper, channel: null, healthCheckError: setupError ? { message: setupError } : null, connector: { kind: 'hyper' } },
        params,
        active: true,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: health,
        catalog: { clear: vi.fn() },
        catalogUpdates: { tasksRunning: [] },
        queriesFinishedOrdered: [],
        queriesActiveOrdered: [],
    } as unknown as ConnectionState;
}

describe('cloud setup page', () => {
    let root: ReturnType<typeof createTestRoot>;
    let registry: Registry | null;
    let config: AppConfig | null;
    let reconfigure: ReturnType<typeof useAppReconfigure> | null;
    let clouds: CloudsApi | null;
    let logins: string[];

    function Capture() {
        registry = useConnections();
        appRuntime = useRuntime();
        config = useAppConfig();
        reconfigure = useAppReconfigure();
        clouds = useClouds();
        return null;
    }

    // A connection of the embedded Hyper runs one statement at a time, the app opens a session per statement
    let statements: Promise<unknown> = Promise.resolve();
    const execute: QueryExecutor = (connectionId, args) => {
        const session = connectionId === 'trial' ? localCloud : connection;
        const result = statements.then(() => session.query(args.query, args.abortSignal));
        statements = result.catch(() => {});
        return [0, result];
    };

    const setHealth = async (connectionId: string, health: ConnectionHealth) => await act(async () => {
        await setTestConnectionHealth(appRuntime!, connectionId, health);
    });

    /// Logging in brings the connection online
    const dependencies: CloudSetupPageDependencies = {
        useCloudLogin: (connectionId: string | null) => ({
            available: true,
            cancel: () => {},
            login: async () => {
                logins.push(connectionId!);
                await setHealth(connectionId!, ConnectionHealth.ONLINE);
            },
        }),
        CompactNavBar: () => null,
    };

    beforeEach(async () => {
        await statements;
        await connection.execute(`DROP SCHEMA IF EXISTS "${CLOUD_DATABASE}"."dashql" CASCADE`);
        root = createTestRoot();
        registry = null;
        config = null;
        reconfigure = null;
        clouds = null;
        logins = [];
    });
    afterEach(async () => {
        root.unmount();
        await statements;
    });

    const tree = (content: React.ReactElement | null) => (
        <LoggerProvider>
            <FlavorProvider requested={null}>
                <AppConfigProvider>
                    <MemoryRouter>
                        <StorageProvider backend={new WorkbookTestBackend()}>
                            <TestRuntime execute={execute}>
                                <CloudStateProvider>
                                    <Capture />
                                    {content}
                                </CloudStateProvider>
                            </TestRuntime>
                        </StorageProvider>
                    </MemoryRouter>
                </AppConfigProvider>
            </FlavorProvider>
        </LoggerProvider>
    );

    /// Render the providers, add the connections and name the cloud connection
    async function prepare(connections: ConnectionState[], cloudConnectionId: string | null) {
        await root.render(tree(null));
        await vi.waitFor(() => expect(config).not.toBeNull());
        await act(async () => {
            for (const c of connections) {
                await addTestConnection(appRuntime!, {
                    connectionId: c.connectionId, params: c.params, name: c.name ?? undefined, active: true,
                    health: c.connectionHealth, error: c.details.healthCheckError?.message,
                });
            }
        });
        if (cloudConnectionId != null) {
            await act(async () => reconfigure!(value => value == null ? null : { ...value, settings: { ...value.settings, cloudConnectionIds: [cloudConnectionId] } }));
        }
    }

    /// The page with the cloud it sets up, choosing a cloud sets up that one
    function Page(props: { initial: string | null; startup: boolean; onDone: () => void }) {
        const [target, setTarget] = React.useState(props.initial);
        return <CloudSetupPage startup={props.startup} connectionId={target} onChoose={setTarget} onDone={props.onDone} dependencies={dependencies} />;
    }

    const page = () => root.container.querySelector<HTMLElement>('[data-testid="cloud-setup-page"]');
    const button = (testId: string) => root.container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    const installerState = () => root.container.querySelector<HTMLElement>('[data-testid="cloud-installer"]')?.dataset.state;

    it('derives its step from the cloud connection', () => {
        expect(cloudSetupStep(null, false)).toBe('choose');
        expect(cloudSetupStep(hyperConnection('c', ConnectionHealth.NOT_STARTED), false)).toBe('login');
        expect(cloudSetupStep(hyperConnection('c', ConnectionHealth.FAILED), true)).toBe('configure');
        expect(cloudSetupStep(hyperConnection('c', ConnectionHealth.ONLINE), true)).toBe('install');
    });

    it('chooses the cloud connection, logs in, installs DashQL and counts the workbooks', async () => {
        await prepare([hyperConnection('server', ConnectionHealth.NOT_STARTED)], null);
        const onDone = vi.fn();
        await root.render(tree(<Page initial={null} startup={false} onDone={onDone} />));
        expect(page()!.dataset.step).toBe('choose');
        expect(root.container.textContent).toContain('Server Http');

        await act(async () => button('cloud-use-connection')!.click());
        await vi.waitFor(() => expect(page()!.dataset.step).toBe('login'));
        expect(config!.settings?.cloudConnectionIds).toEqual(['server']);
        expect(button('cloud-setup-login')!.textContent).toContain('Server Http');
        expect(button('cloud-setup-done')!.textContent).toBe('Close');

        await act(async () => button('cloud-setup-login-button')!.click());
        expect(logins).toEqual(['server']);
        await vi.waitFor(() => expect(installerState()).toBe('missing'), { timeout: 10_000 });
        await act(async () => button('cloud-installer-run')!.click());
        await vi.waitFor(() => expect(installerState()).toBe('current'), { timeout: 10_000 });
        await vi.waitFor(() => expect(root.container.querySelector('[data-testid="cloud-setup-workbooks"]')?.textContent).toBe('0 workbooks'));
        expect(clouds!.clouds[0].installation?.state).toBe('current');
        expect(clouds!.clouds[0].stats).toEqual({ workbooks: 0, folders: 0, versions: 0, lastPublishedAt: null });

        expect(button('cloud-setup-done')!.textContent).toBe('Continue');
        await act(async () => button('cloud-setup-done')!.click());
        expect(onDone).toHaveBeenCalledOnce();
    });

    it('goes on by itself at the start of the app when the cloud needs nothing', async () => {
        await installCloudStore(async (sql, signal) => await connection.query(sql, signal));
        await createCloudFolder(async (sql, signal) => await connection.query(sql, signal), 'Reports', null);
        await prepare([hyperConnection('server', ConnectionHealth.ONLINE)], 'server');
        const onDone = vi.fn();
        await root.render(tree(<Page initial="server" startup onDone={onDone} />));
        await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce(), { timeout: 10_000 });
        await vi.waitFor(() => expect(clouds!.clouds[0].stats?.folders).toBe(1));
    });

    it('skips the cloud at the start of the app', async () => {
        await prepare([hyperConnection('server', ConnectionHealth.FAILED, false, 'connection refused')], 'server');
        const onDone = vi.fn();
        await root.render(tree(<Page initial="server" startup onDone={onDone} />));
        expect(page()!.dataset.step).toBe('login');
        expect(root.container.querySelector('[role="alert"]')!.textContent).toBe('connection refused');
        expect(button('cloud-setup-done')!.textContent).toBe('Continue Without Cloud');
        await act(async () => button('cloud-setup-done')!.click());
        expect(onDone).toHaveBeenCalledOnce();
        expect(logins).toEqual([]);
        expect(config!.settings?.cloudConnectionIds).toEqual(['server']);
    });

    it('cleans up a cloud with current tables on request', async () => {
        const query = async (sql: string, signal?: AbortSignal) => await connection.query(sql, signal);
        await installCloudStore(query);
        const kept = await createCloudFolder(query, 'Kept', null);
        const old = await createCloudFolder(query, 'Old', null);
        await deleteCloudFolder(query, kept.folderId);
        await deleteCloudFolder(query, old.folderId);
        // Deleted more than 30 days ago
        await connection.execute(`UPDATE "${CLOUD_DATABASE}"."dashql"."workbook_folders" SET deleted_at = now() - INTERVAL '31 days' WHERE folder_id = '${old.folderId}'`);
        await prepare([hyperConnection('server', ConnectionHealth.ONLINE)], 'server');
        await root.render(tree(<Page initial="server" startup={false} onDone={() => {}} />));
        await vi.waitFor(() => expect(installerState()).toBe('current'), { timeout: 10_000 });
        const summary = () => root.container.querySelector('[data-testid="cloud-cleanup-summary"]')?.textContent;
        expect(summary()).toBe('Removes what was deleted more than 30 days ago');

        await act(async () => button('cloud-cleanup-run')!.click());
        await vi.waitFor(() => expect(summary()).toBe('Removed 1 folder'), { timeout: 10_000 });
        // After the statements of the page, the session runs one at a time
        const [, read] = execute('server', { query: `SELECT CAST(folder_id AS text) AS folder_id FROM "${CLOUD_DATABASE}"."dashql"."workbook_folders"` } as never);
        const folders = (await read)!;
        expect([...folders].map(row => String(row.folder_id))).toEqual([kept.folderId]);
        await act(async () => button('cloud-cleanup-run')!.click());
        await vi.waitFor(() => expect(summary()).toBe('Nothing to remove'), { timeout: 10_000 });
    });

    it('describes what a cleanup did', () => {
        const key = { workbookId: 'w', versionId: 'v' };
        expect(describeCloudCleanup({ versions: [], workbooks: [], folders: [], rerooted: [] })).toBe('Nothing to remove');
        expect(describeCloudCleanup({ versions: [key, key], workbooks: ['w'], folders: [], rerooted: [] })).toBe('Removed 1 workbook and 2 versions');
        expect(describeCloudCleanup({ versions: [key], workbooks: ['w', 'x'], folders: ['f'], rerooted: ['g'] }))
            .toBe('Removed 2 workbooks, 1 folder and 1 version, moved 1 folder of a loop to the top');
        expect(describeCloudCleanup({ versions: [], workbooks: [], folders: [], rerooted: ['g', 'h'] })).toBe('Moved 2 folders of a loop to the top');
    });

    it('logs in to the local cloud without asking and installs DashQL in it', async () => {
        await prepare([hyperConnection('trial', ConnectionHealth.NOT_STARTED, true)], 'trial');
        await root.render(tree(<Page initial="trial" startup={false} onDone={() => {}} />));
        await vi.waitFor(() => expect(logins).toEqual(['trial']));
        await vi.waitFor(() => expect(installerState()).toBe('missing'), { timeout: 10_000 });
        await act(async () => button('cloud-installer-run')!.click());
        await vi.waitFor(() => expect(installerState()).toBe('current'), { timeout: 10_000 });
        await statements;
        expect(Number((await localCloud.query(`SELECT version FROM "dashql"."dashql"."cloud_store"`)).get(0)!.version)).toBe(CLOUD_MIGRATIONS.length);
        await localCloud.execute(`DROP SCHEMA "dashql"."dashql" CASCADE`);
    });

    it('shows when the app asks for it', async () => {
        const setupDone = Promise.resolve();
        function Gate() {
            return useCloudSetupGate(setupDone, false, dependencies) ?? <div data-testid="workbench" />;
        }
        await prepare([], null);
        await root.render(tree(<Gate />));
        await vi.waitFor(() => expect(button('workbench')).not.toBeNull());
        expect(page()).toBeNull();

        await act(async () => clouds!.openSetup());
        await vi.waitFor(() => expect(page()).not.toBeNull());
        expect(page()!.dataset.step).toBe('choose');
        await act(async () => root.container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
        expect(page()).toBeNull();
    });

    it('skips the page at the start of the app without a cloud link', async () => {
        const setupDone = Promise.resolve();
        function Gate() {
            return useCloudSetupGate(setupDone, false, dependencies) ?? <div data-testid="workbench" />;
        }
        await prepare([hyperConnection('server', ConnectionHealth.NOT_STARTED)], 'server');
        await root.render(tree(<Gate />));
        await vi.waitFor(() => expect(button('workbench')).not.toBeNull());
        await act(async () => await setupDone);
        expect(page()).toBeNull();
        expect(logins).toEqual([]);
    });

    it('reads a cloud link from the query of the document', () => {
        expect(isCloudLink('?cloud')).toBe(true);
        expect(isCloudLink('?flavor=dbcom&cloud=1')).toBe(true);
        expect(isCloudLink('')).toBe(false);
        expect(isCloudLink('?zip=abc')).toBe(false);
    });

    it('shows at the start of the app with a cloud link until the cloud needs nothing', async () => {
        let finishSetup!: () => void;
        const setupDone = new Promise<void>(resolve => { finishSetup = resolve; });
        function Gate() {
            return useCloudSetupGate(setupDone, true, dependencies) ?? <div data-testid="workbench" />;
        }
        await prepare([hyperConnection('server', ConnectionHealth.NOT_STARTED)], 'server');
        await root.render(tree(<Gate />));
        // The page waits for the setup of the app
        expect(page()).toBeNull();
        await act(async () => finishSetup());
        await vi.waitFor(() => expect(page()?.dataset.step).toBe('login'));

        await act(async () => button('cloud-setup-login-button')!.click());
        await vi.waitFor(() => expect(installerState()).toBe('missing'), { timeout: 10_000 });
        await act(async () => button('cloud-installer-run')!.click());
        // Once the tables are current the workbench shows
        await vi.waitFor(() => expect(button('workbench')).not.toBeNull(), { timeout: 10_000 });
        expect(page()).toBeNull();
    });
});
