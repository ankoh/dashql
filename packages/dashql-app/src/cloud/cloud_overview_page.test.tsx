import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudOverviewPage } from './cloud_overview_page.js';
import { CloudStateProvider, useCloudState } from './cloud_state.js';
import type { CloudWorkbooks } from './cloud_workbooks.js';
import {
    createCloudFolder,
    deleteCloudFolder,
    listCloudEntries,
    moveCloudFolder,
    moveCloudWorkbook,
    readCloudFolderPath,
    renameCloudFolder,
    CLOUD_PAGE_SIZE,
} from './cloud_folders.js';
import { listCloudWorkbookVersions, publishCloudWorkbook } from './cloud_store.js';
import { CLOUD_DATABASE, CLOUD_MIGRATIONS, installCloudStore, type CloudQuery } from './cloud_store_schema.js';
import { AppConfigProvider, useAppConfig, useAppReconfigure, type AppConfig } from '../config/app_config.js';
import { FlavorProvider } from '../config/flavor_provider.js';
import { ConnectionHealth, ConnectionStatus, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import type { QueryExecutor } from '@akohn/dashql/platform/connections/query_execution_args';
import { TestRuntime } from '../tests/test_runtime.js';
import { LoggerProvider } from '../host/logger_provider.js';
import type { HyperDB, HyperDBConnection } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { StorageProvider } from '../storage/storage_provider.js';
import { TEST_CONNECTION_ID, testWorkbook, WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { testWorkbookTables } from './cloud_test_tables.js';
import { createTestHyperDB, testDatabasePath } from '../tests/hyperdb_test_client.js';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { quoteLiteral } from '@akohn/dashql/platform/utils/sql_quote';
import * as core from '@akohn/dashql';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { useConnections, useRuntime } from '@akohn/dashql-react/hooks';
import { addTestConnection } from '../tests/test_connections.js';

// The overview of a local cloud on the embedded Hyper of the tests: the statements of the cloud state go through the
// query executor to the session of the local cloud, the listings of the page run against the same tables

type Registry = ReadonlyMap<string, ConnectionState>;
let appRuntime: Runtime | null = null;
declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let database: HyperDB;
let dispose: () => Promise<void>;
let connection: HyperDBConnection;

beforeAll(async () => {
    await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    const test = await createTestHyperDB('dashql-cloud-overview');
    database = test.database;
    dispose = test.dispose;
    const path = await testDatabasePath(`dashql-cloud-overview-${crypto.randomUUID()}.hyper`);
    connection = await database.connect({ defaultDatabase: null, attachedDatabases: [{ path, alias: CLOUD_DATABASE }] });
}, 60_000);
afterAll(async () => {
    await connection?.close();
    await dispose?.();
});

// The session runs one statement at a time
let statements: Promise<unknown> = Promise.resolve();
const query: CloudQuery = (sql, signal) => {
    const result = statements.then(() => connection.query(sql, signal));
    statements = result.catch(() => {});
    return result;
};

/// Publish a workbook with one script
async function publish(name: string, folderId: string | null = null, sql = 'select 1') {
    const tables = testWorkbookTables({
        workbook: testWorkbook({ name, scripts: [{ name: 'a.sql', connectionId: TEST_CONNECTION_ID }] }),
        scripts: { 'a.sql': sql },
    });
    return await publishCloudWorkbook(query, database, tables, { folderId: folderId ?? undefined });
}

/// The local cloud as a connection of the runtime
async function cloudConnection(runtime: Runtime, health: ConnectionHealth): Promise<void> {
    await addTestConnection(runtime, { connectionId: 'trial', name: 'Trial', params: runtime.core.localCloudParams(), active: true, health });
}

/// The published workbooks of the cloud on the session of the test, every change looks at the cloud again
function useTestWorkbooks(): CloudWorkbooks {
    const refresh = useCloudState('trial')?.refresh;
    return React.useMemo(() => {
        const change = async <T,>(run: () => Promise<T>) => {
            try {
                return await run();
            } finally {
                await refresh?.();
            }
        };
        const refused = async (): Promise<never> => { throw new Error('Not in this test'); };
        return {
            isReady: () => true,
            open: refused,
            importPreview: refused,
            discardPreview: refused,
            publish: refused,
            remove: refused,
            list: (_cloudId, request, signal) => listCloudEntries(query, request, { signal }),
            folderPath: (_cloudId, folderId, signal) => readCloudFolderPath(query, folderId, { signal }),
            listVersions: (_cloudId, workbookId, signal) => listCloudWorkbookVersions(query, workbookId, { signal }),
            createFolder: (_cloudId, name, parentId) => change(() => createCloudFolder(query, name, parentId)),
            renameFolder: (_cloudId, folderId, name) => change(() => renameCloudFolder(query, folderId, name)),
            deleteFolder: (_cloudId, folderId) => change(() => deleteCloudFolder(query, folderId)),
            move: (_cloudId, workbookId, folderId) => change(() => moveCloudWorkbook(query, workbookId, folderId)),
            moveFolder: (_cloudId, folderId, parentId) => change(() => moveCloudFolder(query, folderId, parentId)),
        };
    }, [refresh]);
}

describe('CloudOverviewPage', () => {
    let root: ReturnType<typeof createTestRoot>;
    let registry: Registry | null;
    let config: AppConfig | null;
    let reconfigure: ReturnType<typeof useAppReconfigure> | null;

    function Capture() {
        registry = useConnections();
        appRuntime = useRuntime();
        config = useAppConfig();
        reconfigure = useAppReconfigure();
        return null;
    }

    const execute: QueryExecutor = (_connectionId, args) => [0, query(args.query, args.abortSignal)];

    beforeEach(async () => {
        await statements;
        await connection.execute(`DROP SCHEMA IF EXISTS "${CLOUD_DATABASE}"."dashql" CASCADE`);
        root = createTestRoot();
        registry = null;
        config = null;
        reconfigure = null;
    });
    afterEach(async () => {
        root.unmount();
        await statements;
    });

    const onClose = vi.fn();
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
    const page = <CloudOverviewPage connectionId="trial" onClose={onClose} dependencies={{ useCloudWorkbooks: useTestWorkbooks }} />;

    /// Render the page of the local cloud
    async function renderCloud(health: ConnectionHealth) {
        await root.render(tree(null));
        await vi.waitFor(() => expect(config).not.toBeNull());
        await act(async () => { await cloudConnection(appRuntime!, health); });
        await act(async () => reconfigure!(value => value == null ? null : { ...value, settings: { ...value.settings, cloudConnectionIds: ['trial'] } }));
        await root.render(tree(page));
    }

    const find = (testId: string) => root.container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    const findAll = (testId: string) => [...root.container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
    /// The names of the listed folders and workbooks
    const entryNames = () => [...root.container.querySelectorAll<HTMLElement>('[data-testid="cloud-entries"] > li:not([data-testid="cloud-version-entry"]) [data-testid="cloud-entry-name"]')]
        .map(button => button.firstChild?.textContent ?? '');
    const path = () => findAll('cloud-path-segment').map(segment => segment.textContent);
    const click = async (element: HTMLElement | null | undefined) => await act(async () => element!.click());

    it('offers to log in while the cloud is not online', async () => {
        await renderCloud(ConnectionHealth.NOT_STARTED);
        expect(find('cloud-overview-login')).not.toBeNull();
        expect(find('cloud-log-in')).not.toBeNull();
        expect(find('cloud-browser')).toBeNull();
        expect(find('cloud-overview-facts')).toBeNull();
    });

    it('shows the counts of the cloud and browses its folders', async () => {
        await installCloudStore(query);
        const reports = await createCloudFolder(query, 'Reports', null);
        const quarter = await createCloudFolder(query, 'Q1', reports.folderId);
        await publish('Alpha');
        await publish('Beta', reports.folderId);
        await publish('Gamma', quarter.folderId, 'select needle from haystack');
        await renderCloud(ConnectionHealth.ONLINE);

        await vi.waitFor(() => expect(find('cloud-fact-workbooks')?.textContent).toBe('3'), { timeout: 10_000 });
        expect(find('cloud-fact-folders')!.textContent).toBe('2');
        expect(find('cloud-fact-versions')!.textContent).toBe('3');
        expect(find('cloud-fact-version')!.textContent).toBe(String(CLOUD_MIGRATIONS.length));

        // The top: the folders first, then the workbooks
        await vi.waitFor(() => expect(entryNames()).toEqual(['Reports', 'Alpha']));
        expect(findAll('cloud-folder-entry')[0].textContent).toContain('1 folder, 1 workbook');
        expect(path()).toEqual(['Trial Wasm']);

        // Into a folder and into its folder, the path leads back
        await click(findAll('cloud-folder-entry')[0].querySelector<HTMLElement>('[data-testid="cloud-entry-name"]'));
        await vi.waitFor(() => expect(entryNames()).toEqual(['Q1', 'Beta']));
        await vi.waitFor(() => expect(path()).toEqual(['Trial Wasm', 'Reports']));
        await click(findAll('cloud-folder-entry')[0].querySelector<HTMLElement>('[data-testid="cloud-entry-name"]'));
        await vi.waitFor(() => expect(entryNames()).toEqual(['Gamma']));
        await vi.waitFor(() => expect(path()).toEqual(['Trial Wasm', 'Reports', 'Q1']));
        await click(findAll('cloud-path-segment')[0]);
        await vi.waitFor(() => expect(entryNames()).toEqual(['Reports', 'Alpha']));

        // The search finds the workbooks of every folder by the text of their scripts and names their folders
        const search = root.container.querySelector<HTMLInputElement>('[data-testid="cloud-search"] input, input[data-testid="cloud-search"]')!;
        await act(async () => {
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setValue.call(search, 'NEEDLE');
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await vi.waitFor(() => expect(entryNames()).toEqual(['Gamma']));
        expect(findAll('cloud-workbook-entry')[0].textContent).toContain('Q1');
        expect(find('cloud-path')!.textContent).toContain('NEEDLE');
    });

    it('reads a large folder a page at a time', async () => {
        await installCloudStore(query);
        // More folders than a page, written at once
        const count = CLOUD_PAGE_SIZE + 20;
        const rows = Array.from({ length: count }, (_, i) =>
            `(${quoteLiteral(crypto.randomUUID())}, ${quoteLiteral(`Folder ${String(i).padStart(3, '0')}`)}, now(), now())`);
        await query(`INSERT INTO "${CLOUD_DATABASE}"."dashql"."workbook_folders" (folder_id, name, created_at, updated_at) `
            + `SELECT CAST(v.c0 AS uuid), v.c1, v.c2, v.c3 FROM (VALUES ${rows.join(', ')}) v(c0, c1, c2, c3)`);
        await publish('Last');
        await renderCloud(ConnectionHealth.ONLINE);

        await vi.waitFor(() => expect(findAll('cloud-folder-entry')).toHaveLength(CLOUD_PAGE_SIZE), { timeout: 10_000 });
        expect(find('cloud-fact-folders')!.textContent).toBe(String(count));
        // The next page is read on request, or when the end of the list comes into view
        await vi.waitFor(() => expect(findAll('cloud-folder-entry').length === count || find('cloud-load-more') != null).toBe(true));
        if (find('cloud-load-more') != null) await click(find('cloud-load-more'));
        await vi.waitFor(() => expect(findAll('cloud-folder-entry')).toHaveLength(count));
        await vi.waitFor(() => expect(findAll('cloud-workbook-entry')).toHaveLength(1));
        expect(entryNames()[0]).toBe('Folder 000');
        expect(entryNames()[count]).toBe('Last');
        expect(find('cloud-load-more')).toBeNull();
    });

    it('creates a folder in the folder that is shown and names it', async () => {
        await installCloudStore(query);
        const reports = await createCloudFolder(query, 'Reports', null);
        await renderCloud(ConnectionHealth.ONLINE);
        await vi.waitFor(() => expect(entryNames()).toEqual(['Reports']), { timeout: 10_000 });
        await click(findAll('cloud-folder-entry')[0].querySelector<HTMLElement>('[data-testid="cloud-entry-name"]'));
        await vi.waitFor(() => expect(path()).toEqual(['Trial Wasm', 'Reports']));

        await click(find('cloud-new-folder'));
        const nameInput = () => root.container.querySelector<HTMLInputElement>('input[aria-label="Folder name"]');
        await vi.waitFor(() => expect(nameInput()).not.toBeNull());
        const input = nameInput()!;
        await act(async () => {
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setValue.call(input, 'Drafts');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await vi.waitFor(() => expect(entryNames()).toEqual(['Drafts']));
        const page = await listCloudEntries(query, { folderId: reports.folderId });
        expect(page.entries.map(entry => entry.kind === 'folder' ? entry.folder.name : '')).toEqual(['Drafts']);
        await vi.waitFor(() => expect(find('cloud-fact-folders')!.textContent).toBe('2'));
    });

    it('closes itself when the connection is no cloud anymore', async () => {
        onClose.mockClear();
        await installCloudStore(query);
        await renderCloud(ConnectionHealth.ONLINE);
        await vi.waitFor(() => expect(find('cloud-overview')).not.toBeNull());
        // A local cloud is deleted rather than no longer used
        expect(find('cloud-stop-using')).toBeNull();
        expect(find('cloud-delete')!.getAttribute('aria-label')).toBe('Delete local cloud');
        await act(async () => reconfigure!(value => value == null ? null : { ...value, settings: { ...value.settings, cloudConnectionIds: [] } }));
        await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});
