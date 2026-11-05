import * as React from 'react';
import JSZip from 'jszip';
import { act } from '@dashql/browser-test-act';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionReferencesProvider, ConnectionRegistry, NO_CONNECTION_REFERENCES, useConnectionRegistry, type ConnectionReferences } from '../../connections/connection_registry.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { SessionTestBackend, TEST_CONNECTION_ID, TEST_SESSION_ID, testSession } from '../../storage/session_test_backend.js';
import { createTestRoot } from '../../tests/react_root.js';
import { BASE64URL_CODEC } from '../../utils/base64.js';
import type { SessionScripts } from '../scripts/session_scripts.js';
import { SessionScriptsRegistryProvider, useSessionScriptsRegistry } from '../scripts/session_scripts_registry.js';
import { SessionURLShareOverlay } from './session_url_share_overlay.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const CONNECTION = {
    connectionId: TEST_CONNECTION_ID,
    name: 'Warehouse',
    params: { hyper: {} },
    details: { value: { proto: { setupParams: null } } },
} as unknown as ConnectionState;

const REFERENCES: ConnectionReferences = {
    ...NO_CONNECTION_REFERENCES,
    connectionsOf: sessionId => sessionId === TEST_SESSION_ID ? [TEST_CONNECTION_ID] : [],
};

const SESSION = { sessionId: TEST_SESSION_ID, scripts: {}, scriptRefs: {}, scriptOrder: [] } as unknown as SessionScripts;

describe('SessionURLShareOverlay', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: SessionTestBackend;
    let connections: ReturnType<typeof useConnectionRegistry> | null;
    let sessions: ReturnType<typeof useSessionScriptsRegistry> | null;

    function Capture() {
        connections = useConnectionRegistry();
        sessions = useSessionScriptsRegistry();
        return null;
    }

    async function render(props: Partial<React.ComponentProps<typeof SessionURLShareOverlay>>) {
        const tree = (overlay: boolean) => (
            <LoggerProvider>
                <MemoryRouter>
                    <StorageProvider backend={backend}>
                        <ConnectionRegistry>
                            <SessionScriptsRegistryProvider>
                                <ConnectionReferencesProvider value={REFERENCES}>
                                    <Capture />
                                    {overlay && <SessionURLShareOverlay isOpen setIsOpen={vi.fn()} sessionId={TEST_SESSION_ID} {...props} />}
                                </ConnectionReferencesProvider>
                            </SessionScriptsRegistryProvider>
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
            sessions![1](reg => ({ ...reg, sessionScriptsMap: new Map([[TEST_SESSION_ID, SESSION]]) }));
        });
        await root.render(tree(true));
    }

    beforeEach(async () => {
        root = createTestRoot();
        backend = new SessionTestBackend();
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession({ name: 'Orders' }));
        connections = null;
        sessions = null;
    });
    afterEach(() => {
        root.unmount();
        vi.restoreAllMocks();
    });

    const urlInput = () => document.querySelector<HTMLInputElement>('input[aria-label="Session share URL"]');
    const copyButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy to Clipboard"]')!;
    const toggle = (label: string) => document.querySelector<HTMLButtonElement>(`[role="switch"][aria-labelledby="export-toggle-${label}-label"]`)!;
    const waitForURL = (previous: string = '') => act(async () => {
        await vi.waitFor(() => {
            expect(urlInput()!.value).not.toBe('');
            expect(urlInput()!.value).not.toBe(previous);
        });
    });
    async function sharedSession() {
        const url = new URL(urlInput()!.value);
        const event = JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(url.searchParams.get('data')!)));
        const archive = await JSZip.loadAsync(BASE64URL_CODEC.decode(event.session));
        return JSON.parse(await archive.file('dashql-session.json')!.async('text'));
    }

    it('shares the session as a link and copies it', async () => {
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
        await render({});
        await waitForURL();
        const url = urlInput()!.value;
        expect(document.body.textContent).toContain(`${url.length} characters`);
        const shared = await sharedSession();
        expect(shared.name).toBe('Orders');
        expect(shared.sessionId).not.toBe(TEST_SESSION_ID);

        await act(async () => copyButton().click());
        expect(writeText).toHaveBeenCalledWith(url);
    });

    it('generates the link again when the settings change', async () => {
        await render({});
        await waitForURL();
        const before = urlInput()!.value;
        act(() => toggle('preserve-uuids').click());
        await waitForURL(before);
        expect((await sharedSession()).sessionId).toBe(TEST_SESSION_ID);
    });

    it('shares nothing for an unknown session or a closed overlay', async () => {
        await render({ sessionId: 'unknown' });
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
