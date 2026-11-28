import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { WorkbookData } from '@akohn/dashql/platform/storage/storage_backend';
import { LoggerProvider } from '../../host/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { BASE64URL_CODEC } from '@akohn/dashql/platform/utils/base64';
import { WorkbookURLShareOverlay } from './workbook_url_share_overlay.js';
import { createTestHyperDB, withoutTermination } from '../../tests/hyperdb_test_client.js';
import type { HyperDB } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { EmbeddedDatabaseProvider } from '../../host/embedded_database_provider.js';
import { DashQLCoreProvider } from '../../host/core_provider.js';
import { TestRuntime } from '../../tests/test_runtime.js';
import * as core from '@akohn/dashql';
import type { Runtime } from '@akohn/dashql/runtime';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { addTestConnections } from '../../tests/test_connections.js';

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
    params: { hyper: {} },
    details: { setupParams: {}, channel: null, connector: { kind: 'hyper' } },
} as unknown as ConnectionState;

describe('WorkbookURLShareOverlay', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: WorkbookTestBackend;

    function Capture() {
        runtime = useRuntime();
        return null;
    }

    async function render(props: Partial<React.ComponentProps<typeof WorkbookURLShareOverlay>>) {
        const tree = (overlay: boolean) => (
            <LoggerProvider>
                <MemoryRouter>
                    <EmbeddedDatabaseProvider setupDatabase={async () => withoutTermination(database)}>
<DashQLCoreProvider>
                        <StorageProvider backend={backend}>
                            <TestRuntime>
                                <Capture />
                                {overlay && <WorkbookURLShareOverlay isOpen setIsOpen={vi.fn()} workbookId={TEST_WORKBOOK_ID} {...props} />}
                            </TestRuntime>
                        </StorageProvider>
                    </DashQLCoreProvider>
</EmbeddedDatabaseProvider>
                </MemoryRouter>
            </LoggerProvider>
        );
        await root.render(tree(false));
        await act(async () => {
            await addTestConnections(runtime!, [CONNECTION]);
            // The workbook uses the connection without a script
            runtime!.createWorkbook(TEST_CONNECTION_ID, 'Orders', false, undefined, TEST_WORKBOOK_ID);
        });
        await root.render(tree(true));
    }

    beforeEach(async () => {
        root = createTestRoot();
        backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({ name: 'Orders' }));
    });
    afterEach(() => {
        root.unmount();
        vi.restoreAllMocks();
    });

    const urlInput = () => document.querySelector<HTMLInputElement>('input[aria-label="Workbook share URL"]');
    const copyButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy to Clipboard"]')!;
    const toggle = (label: string) => document.querySelector<HTMLButtonElement>(`[role="switch"][aria-labelledby="export-toggle-${label}-label"]`)!;
    const waitForURL = (previous: string = '') => act(async () => {
        await vi.waitFor(() => {
            expect(urlInput()!.value).not.toBe('');
            expect(urlInput()!.value).not.toBe(previous);
        });
    });
    async function sharedWorkbook() {
        const url = new URL(urlInput()!.value);
        const archive = new Blob([BASE64URL_CODEC.decode(url.searchParams.get('zip')!)]);
        // The runtime reads the archive like the import of the link
        const preview = await runtime!.readImport({ archive });
        runtime!.module.dropImport(preview.importId);
        return preview.workbook as WorkbookData;
    }

    it('shares the workbook as a link and copies it', async () => {
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
        await render({});
        await waitForURL();
        const url = urlInput()!.value;
        expect(document.body.textContent).toContain(`${url.length} characters`);
        const shared = await sharedWorkbook();
        expect(shared.name).toBe('Orders');
        expect(shared.workbookId).not.toBe(TEST_WORKBOOK_ID);

        await act(async () => copyButton().click());
        expect(writeText).toHaveBeenCalledWith(url);
    });

    it('generates the link again when the settings change', async () => {
        await render({});
        await waitForURL();
        const before = urlInput()!.value;
        act(() => toggle('preserve-uuids').click());
        await waitForURL(before);
        expect((await sharedWorkbook()).workbookId).toBe(TEST_WORKBOOK_ID);
    });

    it('picks the default view of the workbook that the link opens in', async () => {
        await render({});
        await waitForURL();
        const before = urlInput()!.value;
        expect((await sharedWorkbook()).defaultView).toBeUndefined();
        // The segments in the order of the view switch: feed, dashboard, dataflow
        const segment = (index: number) => document.querySelectorAll<HTMLButtonElement>('[data-testid="export-default-view"] button')[index]!;
        expect(segment(0).getAttribute('aria-current')).toBe('true');
        await act(async () => segment(1).click());
        // The workbook changed, not only the link
        expect(runtime!.store.get('workbook', TEST_WORKBOOK_ID)?.defaultView).toBe('dashboard');
        expect(segment(1).getAttribute('aria-current')).toBe('true');
        await waitForURL(before);
        expect((await sharedWorkbook()).defaultView).toBe('dashboard');
    });

    it('shares nothing for an unknown workbook or a closed overlay', async () => {
        await render({ workbookId: 'unknown' });
        await act(() => new Promise(resolve => setTimeout(resolve, 50)));
        expect(urlInput()!.value).toBe('');
        expect(copyButton().disabled).toBe(true);
        expect(document.body.textContent).toContain('0 characters');

        root.unmount();
        root = createTestRoot();
        await render({ isOpen: false });
        expect(urlInput()).toBeNull();
    });
});
