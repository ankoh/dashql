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

    async function render(props: Partial<React.ComponentProps<typeof SessionFileSaveOverlay>>, references = REFERENCES) {
        const tree = (overlay: boolean) => (
            <LoggerProvider>
                <StorageProvider backend={backend}>
                    <ConnectionRegistry>
                        <ConnectionReferencesProvider value={references}>
                            <Capture />
                            {overlay && <SessionFileSaveOverlay isOpen setIsOpen={vi.fn()} sessionScripts={SESSION} {...props} />}
                        </ConnectionReferencesProvider>
                    </ConnectionRegistry>
                </StorageProvider>
            </LoggerProvider>
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
        await act(async () => saveButton()!.click());
        const [bytes, fileName] = download.mock.calls.at(-1)! as [Uint8Array, string];
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
