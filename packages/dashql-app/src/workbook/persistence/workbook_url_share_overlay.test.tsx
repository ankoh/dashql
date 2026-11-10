import * as React from 'react';
import JSZip from 'jszip';
import { act } from '@dashql/browser-test-act';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionReferencesProvider, ConnectionRegistry, NO_CONNECTION_REFERENCES, useConnectionRegistry, type ConnectionReferences } from '../../connections/connection_registry.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '../../storage/workbook_test_backend.js';
import { createTestRoot } from '../../tests/react_root.js';
import { BASE64URL_CODEC } from '../../utils/base64.js';
import type { WorkbookScripts } from '../scripts/workbook_scripts.js';
import { WorkbookScriptsRegistryProvider, useWorkbookScriptsRegistry } from '../scripts/workbook_scripts_registry.js';
import { WorkbookURLShareOverlay } from './workbook_url_share_overlay.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const CONNECTION = {
    connectionId: TEST_CONNECTION_ID,
    name: 'Warehouse',
    params: { hyper: {} },
    details: { value: { proto: { setupParams: null } } },
} as unknown as ConnectionState;

const REFERENCES: ConnectionReferences = {
    ...NO_CONNECTION_REFERENCES,
    connectionsOf: workbookId => workbookId === TEST_WORKBOOK_ID ? [TEST_CONNECTION_ID] : [],
};

const WORKBOOK = { workbookId: TEST_WORKBOOK_ID, scripts: {}, scriptRefs: {}, scriptOrder: [] } as unknown as WorkbookScripts;

describe('WorkbookURLShareOverlay', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: WorkbookTestBackend;
    let connections: ReturnType<typeof useConnectionRegistry> | null;
    let workbooks: ReturnType<typeof useWorkbookScriptsRegistry> | null;

    function Capture() {
        connections = useConnectionRegistry();
        workbooks = useWorkbookScriptsRegistry();
        return null;
    }

    async function render(props: Partial<React.ComponentProps<typeof WorkbookURLShareOverlay>>) {
        const tree = (overlay: boolean) => (
            <LoggerProvider>
                <MemoryRouter>
                    <StorageProvider backend={backend}>
                        <ConnectionRegistry>
                            <WorkbookScriptsRegistryProvider>
                                <ConnectionReferencesProvider value={REFERENCES}>
                                    <Capture />
                                    {overlay && <WorkbookURLShareOverlay isOpen setIsOpen={vi.fn()} workbookId={TEST_WORKBOOK_ID} {...props} />}
                                </ConnectionReferencesProvider>
                            </WorkbookScriptsRegistryProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </MemoryRouter>
            </LoggerProvider>
        );
        await root.render(tree(false));
        await act(async () => {
            connections![1](reg => {
                reg.connections.set(TEST_CONNECTION_ID, CONNECTION);
                return { ...reg };
            });
            workbooks![1](reg => ({ ...reg, workbookScriptsMap: new Map([[TEST_WORKBOOK_ID, WORKBOOK]]) }));
        });
        await root.render(tree(true));
    }

    beforeEach(async () => {
        root = createTestRoot();
        backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({ name: 'Orders' }));
        connections = null;
        workbooks = null;
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
        const event = JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(url.searchParams.get('data')!)));
        const archive = await JSZip.loadAsync(BASE64URL_CODEC.decode(event.session));
        return JSON.parse(await archive.file('dashql-workbook.json')!.async('text'));
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
