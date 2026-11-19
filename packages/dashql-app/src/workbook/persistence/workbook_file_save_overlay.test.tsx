import * as React from 'react';
import JSZip from 'jszip';
import { act } from '@akohn/dashql-react/testing/react_act';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { WorkbookData } from '@akohn/dashql/platform/storage/storage_backend';
import { LoggerProvider } from '../../host/logger_provider.js';
import { HostProvider, type DownloadFile } from '@akohn/dashql-react/host';
import { StorageProvider } from '../../storage/storage_provider.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { WorkbookFileSaveOverlay } from './workbook_file_save_overlay.js';
import { QueryResultCacheProvider } from '../../storage/query_result_cache_provider.js';
import type { QueryResultCache } from '@akohn/dashql/platform/query/query_result_cache';
import { memoryQueryResultCache } from '@akohn/dashql/platform/testing/memory_query_result_cache';
import { createTestHyperDB, withoutTermination } from '../../tests/hyperdb_test_client.js';
import type { HyperDB } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { EmbeddedDatabaseProvider } from '../../host/embedded_database_provider.js';
import { DashQLCoreProvider } from '../../host/core_provider.js';
import { TestRuntime } from '../../tests/test_runtime.js';
import * as core from '@akohn/dashql';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { addTestConnections } from '../../tests/test_connections.js';
import { analyzeWorkbook } from '@akohn/dashql/runtime/testing/test_runtime';

let runtime: Runtime | null = null;
declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let database: HyperDB;
let disposeDatabase: (() => Promise<void>) | null = null;
beforeAll(async () => {
    ({ database, dispose: disposeDatabase } = await createTestHyperDB('dashql-export-overlay'));
}, 60_000);
afterAll(async () => {
    await disposeDatabase?.();
});

const CONNECTION = {
    connectionId: TEST_CONNECTION_ID,
    name: 'Warehouse',
    // A Hyper over gRPC, its results have cache keys
    params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } },
    // Online with a channel: the setup params of a Hyper carry no login hint to share, and the results of the
    // connection have cache keys
    connectionHealth: ConnectionHealth.ONLINE,
} as unknown as ConnectionState;

// The workbook uses the connection without a script
const WORKBOOK = {
    workbookId: TEST_WORKBOOK_ID, workbookMetadata: { originalFileName: 'orders' },
    scriptRefs: {}, scriptOrder: [], scriptKeys: [], pendingConnectionId: TEST_CONNECTION_ID, connectionIds: [TEST_CONNECTION_ID],
} as unknown as WorkbookScripts;

describe('WorkbookFileSaveOverlay', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: WorkbookTestBackend;
    const download = vi.fn<DownloadFile>();
    // The host of the overlay saves into the spy, the core provider keeps it
    const withHost = (children: React.ReactElement) => <HostProvider value={{ setupCore: null, downloadFile: download }}>{children}</HostProvider>;

    function Capture() {
        runtime = useRuntime();
        return null;
    }

    /// Render the overlay over a runtime that holds the workbook on its connection
    async function render(props: Partial<React.ComponentProps<typeof WorkbookFileSaveOverlay>>, cache?: QueryResultCache) {
        const withCache = (children: React.ReactElement) => cache != null ? <QueryResultCacheProvider cache={cache}>{children}</QueryResultCacheProvider> : children;
        const tree = (overlay: boolean) => withHost(withCache(
            <LoggerProvider>
                <EmbeddedDatabaseProvider setupDatabase={async () => withoutTermination(database)}>
<DashQLCoreProvider>
                    <StorageProvider backend={backend}>
                        <TestRuntime>
                            <Capture />
                            {overlay && <WorkbookFileSaveOverlay isOpen setIsOpen={vi.fn()} workbookScripts={WORKBOOK} {...props} />}
                        </TestRuntime>
                    </StorageProvider>
                </DashQLCoreProvider>
</EmbeddedDatabaseProvider>
            </LoggerProvider>,
        ));
        await root.render(tree(false));
        await act(async () => {
            await addTestConnections(runtime!, [CONNECTION]);
            runtime!.createWorkbook(TEST_CONNECTION_ID, 'Orders', false, 'orders', TEST_WORKBOOK_ID);
        });
        await root.render(tree(true));
    }

    beforeEach(async () => {
        root = createTestRoot();
        backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({ name: 'Orders' }));
        download.mockReset().mockResolvedValue();
    });
    afterEach(() => {
        root.unmount();
        vi.restoreAllMocks();
    });

    const saveButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Save File"]');
    const toggle = (label: string) => document.querySelector<HTMLButtonElement>(`[role="switch"][aria-labelledby="export-toggle-${label}-label"]`)!;
    const waitForFile = () => act(async () => {
        await vi.waitFor(() => expect(saveButton()!.disabled).toBe(false));
    });
    async function savedWorkbook() {
        const saves = download.mock.calls.length;
        await act(async () => {
            saveButton()!.click();
            // A save with the results packs them first
            await vi.waitFor(() => expect(download.mock.calls.length).toBe(saves + 1));
        });
        const [bytes, fileName] = download.mock.calls.at(-1)! as [Blob, string];
        return { fileName, bytes, ...await readArchive(bytes) };
    }
    /// The workbook and the number of cached results of an archive, as an import of the runtime reads them
    async function readArchive(bytes: Blob): Promise<{ workbook: WorkbookData; results: number }> {
        const preview = await runtime!.readImport({ archive: bytes });
        runtime!.module.dropImport(preview.importId);
        return { workbook: preview.workbook as WorkbookData, results: preview.results.count };
    }

    it('packs the workbook into a file of the original name and saves it', async () => {
        await render({});
        expect(document.body.textContent).toContain('orders.dashql');
        await waitForFile();
        expect(document.body.textContent).not.toContain('~ 0 bytes');

        const saved = await savedWorkbook();
        expect(saved.fileName).toBe('orders.dashql');
        expect(saved.workbook.name).toBe('Orders');
        // The shared copy gets a fresh workbook id
        expect(saved.workbook.workbookId).not.toBe(TEST_WORKBOOK_ID);
        // Without a login hint the toggle is off and disabled
        expect(toggle('login-hint').disabled).toBe(true);
        expect(toggle('login-hint').getAttribute('aria-checked')).toBe('false');
    });

    it('packs the file again when the settings change', async () => {
        await render({ fileName: 'export' });
        await waitForFile();
        expect((await savedWorkbook()).fileName).toBe('export.dashql');

        expect(toggle('preserve-uuids').getAttribute('aria-checked')).toBe('false');
        act(() => toggle('preserve-uuids').click());
        expect(toggle('preserve-uuids').getAttribute('aria-checked')).toBe('true');
        await waitForFile();
        expect((await savedWorkbook()).workbook.workbookId).toBe(TEST_WORKBOOK_ID);
    });

    it('carries the cached query results of the scripts only when asked to', async () => {
        // A result of 200 kB, the size of the file shows it
        const bytes = new Uint8Array(200_000);
        bytes.set([80, 65, 82, 49]);
        const cache = memoryQueryResultCache();
        await render({ isOpen: false }, cache);
        // Two scripts on a connection that caches its results, one of them with a cached result. The runtime plans
        // them and derives their keys from their signatures.
        let key: string | null = null;
        await act(async () => {
            runtime!.dispatch({ connection: TEST_CONNECTION_ID }, { kind: 'setQueryResultCaching', value: { caching: true } });
            runtime!.dispatch({ workbook: TEST_WORKBOOK_ID }, { kind: 'createScript', value: { text: 'select 1 as a', base: '1' } });
            runtime!.dispatch({ workbook: TEST_WORKBOOK_ID }, { kind: 'createScript', value: { text: 'select 2 as b', base: '2' } });
            analyzeWorkbook(runtime!, TEST_WORKBOOK_ID);
            const keys = await runtime!.module.resultKeys(TEST_WORKBOOK_ID);
            expect(keys).toHaveLength(2);
            key = keys[0];
        });
        expect(key).not.toBeNull();
        cache.put(key!, null, bytes);
        const workbook = runtime!.store.get('workbook', TEST_WORKBOOK_ID)!;
        await root.render(withHost(
            <QueryResultCacheProvider cache={cache}>
                <LoggerProvider>
                    <EmbeddedDatabaseProvider setupDatabase={async () => withoutTermination(database)}>
                        <DashQLCoreProvider>
                            <StorageProvider backend={backend}>
                                <TestRuntime>
                                    <Capture />
                                    <WorkbookFileSaveOverlay isOpen setIsOpen={vi.fn()} workbookScripts={workbook} />
                                </TestRuntime>
                            </StorageProvider>
                        </DashQLCoreProvider>
                    </EmbeddedDatabaseProvider>
                </LoggerProvider>
            </QueryResultCacheProvider>,
        ));
        await waitForFile();
        expect(toggle('query-results').getAttribute('aria-checked')).toBe('false');
        await act(async () => {
            await vi.waitFor(() => expect(document.querySelector('[data-testid="export-query-results-hint"]')?.textContent)
                .toBe('1 of 2 scripts have a cached result. Results contain query data.'));
        });
        let saved = await savedWorkbook();
        expect(saved.results).toBe(0);
        let archive = await JSZip.loadAsync(saved.bytes);
        expect(archive.file(/^workbook_result/)).toEqual([]);

        act(() => toggle('query-results').click());
        await waitForFile();
        // The results are read when the file is saved, not before. The size counts them already.
        expect(cache.retain).not.toHaveBeenCalled();
        expect(document.body.textContent).toMatch(/~\s20\d(\.\d+)? kB/);
        saved = await savedWorkbook();
        expect(cache.retain).toHaveBeenCalledWith(key);
        expect(saved.bytes.size).toBeGreaterThan(bytes.length);
        archive = await JSZip.loadAsync(saved.bytes);
        const resultTables = archive.file(/^workbook_result_/);
        expect(resultTables).toHaveLength(1);
        expect(await resultTables[0].async('uint8array')).toEqual(bytes);
        expect(saved.results).toBe(1);
    });

    it('packs nothing while the overlay is closed or without a workbook', async () => {
        await render({ isOpen: false });
        expect(saveButton()).toBeNull();

        root.unmount();
        root = createTestRoot();
        await render({ workbookScripts: null });
        // Without scripts the file is named after the workbook
        expect(document.body.textContent).toContain('workbook.dashql');
        expect(saveButton()!.disabled).toBe(true);
    });
});
