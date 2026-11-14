import * as React from 'react';
import JSZip from 'jszip';
import { act } from '@dashql/browser-test-act';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionReferencesProvider, ConnectionRegistry, NO_CONNECTION_REFERENCES, useConnectionRegistry, type ConnectionReferences } from '../../connections/connection_registry.js';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { WebFileDownloader } from '../../platform/file/web_file_downloader.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { createTestRoot } from '../../tests/react_root.js';
import type { WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { WorkbookFileSaveOverlay } from './workbook_file_save_overlay.js';
import { QueryResultCacheProvider } from '../../storage/query_result_cache_provider.js';
import type { QueryResultCache } from '@ankoh/dashql-runtime/query/query_result_cache';
import { memoryQueryResultCache } from '../../tests/memory_query_result_cache.js';
import { registerScriptRunServices } from '@ankoh/dashql-runtime/workbook/scripts/script_run';
import { createTestHyperDB, withoutTermination } from '../../tests/hyperdb_test_client.js';
import type { HyperDB } from '../../platform/hyperdb/hyperdb_wasm.js';
import { EmbeddedDatabaseProvider } from '../../platform/database/embedded_database_provider.js';
import { DashQLCoreProvider } from '../../runtime/core_provider.js';
import { readWorkbookBundleFromZip } from './workbook_import.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let database: HyperDB;
let disposeDatabase: (() => Promise<void>) | null = null;
beforeAll(async () => {
    ({ database, dispose: disposeDatabase } = await createTestHyperDB('dashql-export-overlay'));
}, 60_000);
afterAll(async () => {
    await disposeDatabase?.();
});

type Registry = ReturnType<typeof useConnectionRegistry>;

const CONNECTION = {
    connectionId: TEST_CONNECTION_ID,
    name: 'Warehouse',
    params: { hyper: {} },
    // The connection carries no setup params, so there is no login hint to share
    details: { value: { proto: { setupParams: null } } },
} as unknown as ConnectionState;

const REFERENCES: ConnectionReferences = {
    ...NO_CONNECTION_REFERENCES,
    connectionsOf: workbookId => workbookId === TEST_WORKBOOK_ID ? [TEST_CONNECTION_ID] : [],
};

const WORKBOOK = { workbookId: TEST_WORKBOOK_ID, workbookMetadata: { originalFileName: 'orders' } } as unknown as WorkbookScripts;

describe('WorkbookFileSaveOverlay', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: WorkbookTestBackend;
    let registry: Registry | null;
    let download: ReturnType<typeof vi.spyOn>;

    function Capture() {
        registry = useConnectionRegistry();
        return null;
    }

    async function render(props: Partial<React.ComponentProps<typeof WorkbookFileSaveOverlay>>, references = REFERENCES, cache?: QueryResultCache) {
        const withCache = (children: React.ReactElement) => cache != null ? <QueryResultCacheProvider cache={cache}>{children}</QueryResultCacheProvider> : children;
        const tree = (overlay: boolean) => withCache(
            <LoggerProvider>
                <EmbeddedDatabaseProvider setupDatabase={async () => withoutTermination(database)}>
<DashQLCoreProvider>
                    <StorageProvider backend={backend}>
                        <ConnectionRegistry>
                            <ConnectionReferencesProvider value={references}>
                                <Capture />
                                {overlay && <WorkbookFileSaveOverlay isOpen setIsOpen={vi.fn()} workbookScripts={WORKBOOK} {...props} />}
                            </ConnectionReferencesProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </DashQLCoreProvider>
</EmbeddedDatabaseProvider>
            </LoggerProvider>,
        );
        await root.render(tree(false));
        await act(async () => registry![1](reg => {
            reg.connections.set(TEST_CONNECTION_ID, CONNECTION);
            return { ...reg };
        }));
        await root.render(tree(true));
    }

    beforeEach(async () => {
        root = createTestRoot();
        backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({ name: 'Orders' }));
        registry = null;
        download = vi.spyOn(WebFileDownloader.prototype, 'downloadBufferAsFile').mockResolvedValue();
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
        return { fileName, bytes, workbook: (await readWorkbookBundleFromZip(bytes, database)).workbook };
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
        const key = 'a'.repeat(64);
        // A result of 200 kB, the size of the file shows it
        const bytes = new Uint8Array(200_000);
        bytes.set([80, 65, 82, 49]);
        const cache = memoryQueryResultCache();
        cache.put(key, null, bytes);
        // Two scripts, one with a cached result
        const instance = { planSession: () => ({ unpack: () => ({
            valid: true, nodes: [], edges: [], diagnostics: [], materializations: [],
            scripts: ['cached', 'missing'].map(signature => ({ planned: true, cacheable: true, signature, referencedScripts: [] })),
        }) }) };
        registerScriptRunServices(instance as never, {
            createMounts: () => null, cachesResults: () => true, cache, maxConcurrentQueries: () => 1,
            cacheKey: async (_connectionId, signature) => signature === 'cached' ? key : 'b'.repeat(64),
        });
        const script = (fileName: string) => ({ fileName, connection: { connectionId: TEST_CONNECTION_ID }, scriptSession: {} });
        const workbook = {
            ...WORKBOOK, instance, scriptOrder: ['1.sql', '2.sql'],
            scriptRefs: { '1.sql': { scriptId: 1 }, '2.sql': { scriptId: 2 } }, scripts: { 1: script('1.sql'), 2: script('2.sql') },
        } as unknown as WorkbookScripts;
        try {
            await render({ workbookScripts: workbook }, REFERENCES, cache);
            await waitForFile();
            expect(toggle('query-results').getAttribute('aria-checked')).toBe('false');
            await act(async () => {
                await vi.waitFor(() => expect(document.querySelector('[data-testid="export-query-results-hint"]')?.textContent)
                    .toBe('1 of 2 scripts have a cached result. Results contain query data.'));
            });
            let archive = await JSZip.loadAsync((await savedWorkbook()).bytes);
            expect(archive.file(/^workbook_result/)).toEqual([]);

            act(() => toggle('query-results').click());
            await waitForFile();
            // The results are read when the file is saved, not before. The size counts them already.
            expect(cache.retain).not.toHaveBeenCalled();
            expect(document.body.textContent).toMatch(/~\s20\d(\.\d+)? kB/);
            const saved = await savedWorkbook();
            expect(cache.retain).toHaveBeenCalledWith(key);
            expect(saved.bytes.size).toBeGreaterThan(bytes.length);
            archive = await JSZip.loadAsync(saved.bytes);
            const resultTables = archive.file(/^workbook_result_/);
            expect(resultTables).toHaveLength(1);
            expect(await resultTables[0].async('uint8array')).toEqual(bytes);
            const imported = await readWorkbookBundleFromZip(saved.bytes, database);
            expect(imported.results!.map(result => result.key)).toEqual([key]);
        } finally {
            registerScriptRunServices(instance as never, null);
        }
    });

    it('packs nothing while the connections of the workbook are unknown or the overlay is closed', async () => {
        await render({}, NO_CONNECTION_REFERENCES);
        await act(() => new Promise(resolve => setTimeout(resolve, 50)));
        expect(saveButton()!.disabled).toBe(true);
        expect(document.body.textContent).toContain('~ 0 bytes');

        root.unmount();
        root = createTestRoot();
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
