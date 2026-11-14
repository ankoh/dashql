import * as React from 'react';
import { act, waitForRender } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHyperLinks } from './hyper_links.js';
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
import { WorkbookScriptsRegistryProvider, useWorkbookScriptsRegistry, type WorkbookScriptsRegistry } from '../workbook/scripts/workbook_scripts_registry.js';
import { isEphemeralWorkbook, workbookConnectionIds } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import { StorageProvider } from '../storage/storage_provider.js';
import { WorkbookTestBackend } from '../storage/workbook_test_backend.js';

const LOCAL_LINK = { endpoint: 'http://127.0.0.1:7484', token: 'first' };
const REMOTE_LINK = { endpoint: 'https://hyper.example.com:7484', token: 'remote' };
const MOVED_LINK = { endpoint: 'https://hyper.example.com:7485', token: 'moved' };

describe('following Hyper links', () => {
    let root: Root;
    let listener!: PlatformEventListener;
    let connections!: ConnectionRegistry;
    let workbooks!: WorkbookScriptsRegistry;
    let pathname = '/';
    let markOpened!: () => void;
    let confirm: ReturnType<typeof vi.fn>;

    function Harness(props: { opened: Promise<void> }) {
        useHyperLinks(props.opened);
        listener = usePlatformEventListener();
        [connections] = useConnectionRegistry();
        [workbooks] = useWorkbookScriptsRegistry();
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
                <StorageProvider backend={new WorkbookTestBackend()}>
                    <MemoryRouter initialEntries={['/']}>
                        <PlatformEventListenerProvider>
                            <DashQLCoreProvider>
                                <ConnectionReferencesProvider value={NO_CONNECTION_REFERENCES}>
                                    <ConnectionRegistryProvider>
                                        <ConnectionPersistenceProvider>
                                            <WorkbookScriptsRegistryProvider>
                                                <Harness opened={opened} />
                                            </WorkbookScriptsRegistryProvider>
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

    /// Receive a link and wait until the app followed it
    async function receive(link: { endpoint: string; token: string }, followed: () => void) {
        act(() => listener.dispatchAppEvent({ hyperLink: link }));
        await waitForRender(followed);
    }

    function linkConnections() {
        return [...connections.connections.values()].filter(connection => 'hyper' in connection.params
            && connection.params.hyper.protocol === 'V3_HTTP_LINK');
    }

    it('opens the greeter on a new connection once the app opened', async () => {
        act(() => listener.dispatchAppEvent({ hyperLink: LOCAL_LINK }));
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(linkConnections()).toEqual([]);

        markOpened();
        await waitForRender(() => expect(workbooks.workbookScriptsMap.size).toBe(1));
        const [connection] = linkConnections();
        expect(connection.params).toMatchObject({ hyper: { endpoint: LOCAL_LINK.endpoint } });
        expect(getHyperLinkTabState().current).toBe(connection.connectionId);
        expect(getHyperLinkTabState().tokens[connection.connectionId]).toBe('first');
        const workbookIds = [...workbooks.workbookScriptsMap.entries()]
            .filter(([, scripts]) => workbookConnectionIds(scripts).includes(connection.connectionId))
            .map(([workbookId]) => workbookId);
        expect(workbookIds.length).toBe(1);
        expect(isEphemeralWorkbook(workbooks.workbookScriptsMap.get(workbookIds[0])!)).toBe(true);
        expect(pathname).toBe('/');
        // A loopback link needs no confirmation
        expect(confirm).not.toHaveBeenCalled();

        // A second link to the same Hyper reuses the connection and stays in the workbook
        await receive({ ...LOCAL_LINK, token: 'second' }, () => expect(getHyperLinkTabState().tokens[connection.connectionId]).toBe('second'));
        expect(linkConnections().length).toBe(1);
        expect(workbooks.workbookScriptsMap.size).toBe(1);
        expect(pathname).toBe('/');
    });

    it('ignores a link to another machine unless the user confirms it', async () => {
        markOpened();
        await receive(REMOTE_LINK, () => expect(confirm).toHaveBeenCalledTimes(1));
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(confirm.mock.calls[0][0]).toContain(REMOTE_LINK.endpoint);
        expect(linkConnections()).toEqual([]);
        expect(pathname).toBe('/');

        confirm.mockReturnValue(true);
        await receive(REMOTE_LINK, () => expect(workbooks.workbookScriptsMap.size).toBe(1));
        expect(linkConnections().map(connection => connection.params)).toMatchObject([{ hyper: { endpoint: REMOTE_LINK.endpoint } }]);
        const workbookPathname = pathname;

        // A link to another port may reuse the connection of the earlier link, which then moves to the new endpoint
        const [connection] = linkConnections();
        confirm.mockClear();
        await receive(MOVED_LINK, () => expect(getHyperLinkTabState().tokens[connection.connectionId]).toBe('moved'));
        expect(confirm.mock.calls.map(call => call[0])).toEqual([
            expect.stringContaining(`Run new workbooks on the Hyper at ${MOVED_LINK.endpoint}`),
            expect.stringContaining(`to ${REMOTE_LINK.endpoint} for the Hyper at ${MOVED_LINK.endpoint}`),
        ]);
        await waitForRender(() => expect(linkConnections().map(c => c.params))
            .toMatchObject([{ hyper: { endpoint: MOVED_LINK.endpoint } }]));
        expect(pathname).toBe(workbookPathname);
    });
});
