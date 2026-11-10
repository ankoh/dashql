import * as React from 'react';
import JSZip from 'jszip';
import { act } from '@dashql/browser-test-act';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionReferencesProvider, ConnectionRegistry, NO_CONNECTION_REFERENCES, useConnectionRegistry, type ConnectionReferences } from '../../connections/connection_registry.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { WebFileDownloader } from '../../platform/file/web_file_downloader.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { SessionTestBackend, TEST_CONNECTION_ID, TEST_SESSION_ID, testSession } from '../../storage/session_test_backend.js';
import { createTestRoot } from '../../tests/react_root.js';
import type { SessionScripts } from '../scripts/session_scripts.js';
import { SessionFileSaveOverlay } from './session_file_save_overlay.js';
import { QueryResultCacheProvider } from '../../storage/query_result_cache_provider.js';
import type { QueryResultCache } from '../../query/query_result_cache.js';
import { memoryQueryResultCache } from '../../tests/memory_query_result_cache.js';
import { registerScriptRunServices } from '../scripts/script_run.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

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
    connectionsOf: sessionId => sessionId === TEST_SESSION_ID ? [TEST_CONNECTION_ID] : [],
};

const SESSION = { sessionId: TEST_SESSION_ID, sessionMetadata: { originalFileName: 'orders' } } as unknown as SessionScripts;

describe('SessionFileSaveOverlay', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: SessionTestBackend;
    let registry: Registry | null;
    let download: ReturnType<typeof vi.spyOn>;

    function Capture() {
        registry = useConnectionRegistry();
        return null;
    }

    async function render(props: Partial<React.ComponentProps<typeof SessionFileSaveOverlay>>, references = REFERENCES, cache?: QueryResultCache) {
        const withCache = (children: React.ReactElement) => cache != null ? <QueryResultCacheProvider cache={cache}>{children}</QueryResultCacheProvider> : children;
        const tree = (overlay: boolean) => withCache(
            <LoggerProvider>
                <StorageProvider backend={backend}>
                    <ConnectionRegistry>
                        <ConnectionReferencesProvider value={references}>
                            <Capture />
                            {overlay && <SessionFileSaveOverlay isOpen setIsOpen={vi.fn()} sessionScripts={SESSION} {...props} />}
                        </ConnectionReferencesProvider>
                    </ConnectionRegistry>
                </StorageProvider>
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
        backend = new SessionTestBackend();
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession({ name: 'Orders' }));
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
    async function savedSession() {
        const saves = download.mock.calls.length;
        await act(async () => {
            saveButton()!.click();
            // A save with the results packs them first
            await vi.waitFor(() => expect(download.mock.calls.length).toBe(saves + 1));
        });
        const [bytes, fileName] = download.mock.calls.at(-1)! as [Blob, string];
        const archive = await JSZip.loadAsync(bytes);
        return { fileName, bytes, session: JSON.parse(await archive.file('dashql-session.json')!.async('text')) };
    }

    it('packs the session into a file of the original name and saves it', async () => {
        await render({});
        expect(document.body.textContent).toContain('orders.dashql');
        await waitForFile();
        expect(document.body.textContent).not.toContain('~ 0 bytes');

        const saved = await savedSession();
        expect(saved.fileName).toBe('orders.dashql');
        expect(saved.session.name).toBe('Orders');
        // The shared copy gets a fresh session id
        expect(saved.session.sessionId).not.toBe(TEST_SESSION_ID);
        // Without a login hint the toggle is off and disabled
        expect(toggle('login-hint').disabled).toBe(true);
        expect(toggle('login-hint').getAttribute('aria-checked')).toBe('false');
    });

    it('packs the file again when the settings change', async () => {
        await render({ fileName: 'export' });
        await waitForFile();
        expect((await savedSession()).fileName).toBe('export.dashql');

        expect(toggle('preserve-uuids').getAttribute('aria-checked')).toBe('false');
        act(() => toggle('preserve-uuids').click());
        expect(toggle('preserve-uuids').getAttribute('aria-checked')).toBe('true');
        await waitForFile();
        expect((await savedSession()).session.sessionId).toBe(TEST_SESSION_ID);
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
        const session = {
            ...SESSION, instance, scriptOrder: ['1.sql', '2.sql'],
            scriptRefs: { '1.sql': { scriptId: 1 }, '2.sql': { scriptId: 2 } }, scripts: { 1: script('1.sql'), 2: script('2.sql') },
        } as unknown as SessionScripts;
        try {
            await render({ sessionScripts: session }, REFERENCES, cache);
            await waitForFile();
            expect(toggle('query-results').getAttribute('aria-checked')).toBe('false');
            await act(async () => {
                await vi.waitFor(() => expect(document.querySelector('[data-testid="export-query-results-hint"]')?.textContent)
                    .toBe('1 of 2 scripts have a cached result. Results contain query data.'));
            });
            let archive = await JSZip.loadAsync((await savedSession()).bytes);
            expect(archive.file(/^results\//)).toEqual([]);

            act(() => toggle('query-results').click());
            await waitForFile();
            // The results are read when the file is saved, not before. The size counts them already.
            expect(cache.retain).not.toHaveBeenCalled();
            expect(document.body.textContent).toMatch(/~\s20\d(\.\d+)? kB/);
            const saved = await savedSession();
            expect(cache.retain).toHaveBeenCalledWith(key);
            expect(saved.bytes.size).toBeGreaterThan(bytes.length);
            archive = await JSZip.loadAsync(saved.bytes);
            expect(archive.file(/^results\//).map(file => file.name)).toEqual([`results/${key}.parquet`]);
            expect(await archive.file(`results/${key}.parquet`)!.async('uint8array')).toEqual(bytes);
        } finally {
            registerScriptRunServices(instance as never, null);
        }
    });

    it('packs nothing while the connections of the session are unknown or the overlay is closed', async () => {
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
        await render({ sessionScripts: null });
        // Without scripts the file is named after the session
        expect(document.body.textContent).toContain('session.dashql');
        expect(saveButton()!.disabled).toBe(true);
    });
});
