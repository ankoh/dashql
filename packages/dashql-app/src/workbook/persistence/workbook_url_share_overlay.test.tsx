import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionRegistry } from '../../connections/connection_registry.js';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import type { WorkbookData } from '@ankoh/dashql-runtime/storage/storage_backend';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { createTestRoot } from '../../tests/react_root.js';
import { BASE64URL_CODEC } from '@ankoh/dashql-runtime/utils/base64';
import { WorkbookURLShareOverlay } from './workbook_url_share_overlay.js';
import { createTestHyperDB, withoutTermination } from '../../tests/hyperdb_test_client.js';
import type { HyperDB } from '../../platform/hyperdb/hyperdb_wasm.js';
import { EmbeddedDatabaseProvider } from '../../platform/database/embedded_database_provider.js';
import { DashQLCoreProvider } from '../../runtime/core_provider.js';
import { TestRuntime } from '../../tests/test_runtime.js';
import { HYPER_CONNECTOR } from '@ankoh/dashql-runtime/connections/connector_info';
import * as core from '@ankoh/dashql-core';
import type { CoreRuntime } from '@ankoh/dashql-runtime/core_runtime';
import { useCoreRuntime } from '../../runtime/runtime_hooks.js';
import { addTestConnections } from '../../tests/test_connections.js';

let coreRuntime: CoreRuntime | null = null;
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
    details: { type: HYPER_CONNECTOR, value: { proto: { setupParams: null } } },
} as unknown as ConnectionState;

describe('WorkbookURLShareOverlay', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: WorkbookTestBackend;
    let connections: ReturnType<typeof useConnectionRegistry> | null;

    function Capture() {
        connections = useConnectionRegistry();
        coreRuntime = useCoreRuntime();
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
            addTestConnections(coreRuntime!, [CONNECTION]);
            // The workbook uses the connection without a script
            coreRuntime!.createWorkbook(TEST_CONNECTION_ID, 'Orders', false, undefined, TEST_WORKBOOK_ID);
        });
        await root.render(tree(true));
    }

    beforeEach(async () => {
        root = createTestRoot();
        backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({ name: 'Orders' }));
        connections = null;
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
        const preview = await coreRuntime!.readImport({ archive });
        coreRuntime!.dropImport(preview.importId);
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
