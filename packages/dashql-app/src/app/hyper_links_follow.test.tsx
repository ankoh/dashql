import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHyperLinks } from './hyper_links.js';
import { sessionPath } from './router/router.js';
import {
    ConnectionReferencesProvider,
    ConnectionRegistry as ConnectionRegistryProvider,
    NO_CONNECTION_REFERENCES,
    useConnectionRegistry,
    type ConnectionRegistry,
} from '../connections/connection_registry.js';
import { ConnectionPersistenceProvider } from '../connections/connection_persistence.js';
import { getHyperLinkTabState } from '../connections/hyper/hyper_link.js';
import { PlatformEventListenerProvider, usePlatformEventListener } from '../platform/events/event_listener_provider.js';
import type { PlatformEventListener } from '../platform/events/event_listener.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { DashQLCoreProvider } from '../runtime/core_provider.js';
import { SessionScriptsRegistryProvider, useSessionScriptsRegistry, type SessionScriptsRegistry } from '../session/scripts/session_scripts_registry.js';
import { sessionConnectionIds } from '../session/scripts/session_scripts.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { SessionTestBackend } from '../storage/session_test_backend.js';

const LOCAL_LINK = { endpoint: 'http://127.0.0.1:7484', token: 'first' };
const REMOTE_LINK = { endpoint: 'https://hyper.example.com:7484', token: 'remote' };
const MOVED_LINK = { endpoint: 'https://hyper.example.com:7485', token: 'moved' };

describe('following Hyper links', () => {
    let root: Root;
    let listener!: PlatformEventListener;
    let connections!: ConnectionRegistry;
    let sessions!: SessionScriptsRegistry;
    let pathname = '/';
    let markOpened!: () => void;
    let confirm: ReturnType<typeof vi.fn>;

    function Harness(props: { opened: Promise<void> }) {
        useHyperLinks(props.opened);
        listener = usePlatformEventListener();
        [connections] = useConnectionRegistry();
        [sessions] = useSessionScriptsRegistry();
        pathname = useLocation().pathname;
        return null;
    }

    beforeEach(async () => {
        sessionStorage.removeItem('dashql.hyper_links');
        confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const opened = new Promise<void>(resolve => { markOpened = resolve; });
        root = createRoot(document.createElement('div'));
        await act(async () => root.render(
            <LoggerProvider>
                <StorageProvider backend={new SessionTestBackend()}>
                    <MemoryRouter initialEntries={['/']}>
                        <PlatformEventListenerProvider>
                            <DashQLCoreProvider>
                                <ConnectionReferencesProvider value={NO_CONNECTION_REFERENCES}>
                                    <ConnectionRegistryProvider>
                                        <ConnectionPersistenceProvider>
                                            <SessionScriptsRegistryProvider>
                                                <Harness opened={opened} />
                                            </SessionScriptsRegistryProvider>
                                        </ConnectionPersistenceProvider>
                                    </ConnectionRegistryProvider>
                                </ConnectionReferencesProvider>
                            </DashQLCoreProvider>
                        </PlatformEventListenerProvider>
                    </MemoryRouter>
                </StorageProvider>
            </LoggerProvider>,
        ));
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.unstubAllGlobals();
        sessionStorage.removeItem('dashql.hyper_links');
    });

    /// Wait until a rendered state holds.
    /// The development React of the dev server renders the updates of an act scope when the scope ends, a wait inside
    /// one scope would never see them. So every attempt gets a scope of its own, and the wait stays inside the scopes:
    /// an update between two of them would warn that it was not wrapped in act.
    async function waitForRender(rendered: () => void) {
        for (let attempt = 1; ; ++attempt) {
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
            try {
                rendered();
                return;
            } catch (error) {
                if (attempt >= 1000) throw error;
            }
        }
    }

    /// Receive a link and wait until the app followed it
    async function receive(link: { endpoint: string; token: string }, followed: () => void) {
        act(() => listener.dispatchAppEvent({ hyperLink: link }));
        await waitForRender(followed);
    }

    function linkConnections() {
        return [...connections.connections.values()].filter(connection => 'hyper' in connection.params
            && connection.params.hyper.protocol === 'V3_HTTP_LINK');
    }

    it('opens a session on a new connection once the app opened', async () => {
        act(() => listener.dispatchAppEvent({ hyperLink: LOCAL_LINK }));
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(linkConnections()).toEqual([]);

        markOpened();
        await waitForRender(() => expect(pathname).not.toBe('/'));
        const [connection] = linkConnections();
        expect(connection.params).toMatchObject({ hyper: { endpoint: LOCAL_LINK.endpoint } });
        expect(getHyperLinkTabState().current).toBe(connection.connectionId);
        expect(getHyperLinkTabState().tokens[connection.connectionId]).toBe('first');
        const sessionIds = [...sessions.sessionScriptsMap.entries()]
            .filter(([, scripts]) => sessionConnectionIds(scripts).includes(connection.connectionId))
            .map(([sessionId]) => sessionId);
        expect(sessionIds.length).toBe(1);
        expect(pathname).toBe(sessionPath(sessionIds[0]));
        // A loopback link needs no confirmation
        expect(confirm).not.toHaveBeenCalled();

        // A second link to the same Hyper reuses the connection and stays in the session
        await receive({ ...LOCAL_LINK, token: 'second' }, () => expect(getHyperLinkTabState().tokens[connection.connectionId]).toBe('second'));
        expect(linkConnections().length).toBe(1);
        expect(sessions.sessionScriptsMap.size).toBe(1);
        expect(pathname).toBe(sessionPath(sessionIds[0]));
    });

    it('ignores a link to another machine unless the user confirms it', async () => {
        markOpened();
        await receive(REMOTE_LINK, () => expect(confirm).toHaveBeenCalledTimes(1));
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(confirm.mock.calls[0][0]).toContain(REMOTE_LINK.endpoint);
        expect(linkConnections()).toEqual([]);
        expect(pathname).toBe('/');

        confirm.mockReturnValue(true);
        await receive(REMOTE_LINK, () => expect(pathname).not.toBe('/'));
        expect(linkConnections().map(connection => connection.params)).toMatchObject([{ hyper: { endpoint: REMOTE_LINK.endpoint } }]);
        const sessionPathname = pathname;

        // A link to another port may reuse the connection of the earlier link, which then moves to the new endpoint
        const [connection] = linkConnections();
        confirm.mockClear();
        await receive(MOVED_LINK, () => expect(getHyperLinkTabState().tokens[connection.connectionId]).toBe('moved'));
        expect(confirm.mock.calls.map(call => call[0])).toEqual([
            expect.stringContaining(`Run new sessions on the Hyper at ${MOVED_LINK.endpoint}`),
            expect.stringContaining(`to ${REMOTE_LINK.endpoint} for the Hyper at ${MOVED_LINK.endpoint}`),
        ]);
        await waitForRender(() => expect(linkConnections().map(c => c.params))
            .toMatchObject([{ hyper: { endpoint: MOVED_LINK.endpoint } }]));
        expect(pathname).toBe(sessionPathname);
    });
});
