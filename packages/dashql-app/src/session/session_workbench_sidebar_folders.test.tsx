import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../platform/logger/test_logger.js';
import { CompositeStorageBackend } from '../storage/composite_storage_backend.js';
import { SessionTestRegistry } from '../storage/session_test_backend.js';
import { StorageBackendType } from '../storage/storage_backend.js';
import { SessionWorkbenchSidebar, type SessionWorkbenchSidebarDependencies } from './session_workbench_sidebar.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const ROOT_SESSION = '00000000-0000-4000-8000-00000000000a';
const CLIENT_SESSION = '00000000-0000-4000-8000-00000000000b';
const ACME_SESSION = '00000000-0000-4000-8000-00000000000c';
const NEW_SESSION = '00000000-0000-4000-8000-00000000000d';

const state = {
    createSession: vi.fn(),
    sessionScriptsMap: new Map<string, unknown>(),
    registry: new SessionTestRegistry(),
    backend: null as CompositeStorageBackend | null,
};

const references = {
    connectionsOf: () => [],
    sessionsOf: () => [],
    subscribe: () => () => { },
};

const storageReader = {
    get backend() { return state.backend; },
    get sessionFolders() { return state.backend; },
    getSessionLocation: () => ({ type: StorageBackendType.OPFS }),
    getSessionOrder: () => state.backend!.getSessionOrder(),
    getSessionTree: () => state.backend!.getSessionTree(),
};
const storageWriter = { write: vi.fn(), deleteSession: vi.fn(), backend: {}, cancelPendingWritesForSession: vi.fn() };

const dependencies = {
    useRouterNavigate: () => vi.fn(),
    useRouteContext: () => ({ sessionId: ROOT_SESSION, sessionSetupStatus: 0 }),
    useConnectionRegistry: () => [{ connections: new Map() }, vi.fn()],
    useConnectionReferences: () => references,
    useSessionConnections: () => null,
    useDynamicConnectionDispatch: () => [{ connections: new Map(), connectionsByType: [[], [], []] }, vi.fn()],
    useConnectionAllocator: () => vi.fn(),
    ConnectionSettingsOverlay: () => null,
    useSessionScriptsDeletion: () => vi.fn(),
    useSessionScriptsRegistry: () => [{ sessionScriptsMap: state.sessionScriptsMap }],
    useSessionScripts: () => [null, vi.fn()],
    useSessionCreation: () => state.createSession,
    useMergeConnections: () => async () => {},
    useDetachConnection: () => vi.fn(),
    useDeleteConnection: () => vi.fn(),
    useStorageReader: () => storageReader,
    useStorageWriter: () => storageWriter,
    useComputationDispatch: () => vi.fn(),
    SessionStorageOverlay: () => null,
    SessionURLShareOverlay: () => null,
    SessionFileSaveOverlay: () => null,
    useSessionImport: () => ({}),
    useInvalidSessions: () => ({ invalidSessions: new Map(), deleteInvalidSession: vi.fn() }),
    useDashQLCoreSetup: () => vi.fn(),
    usePlatformType: () => 0,
    useLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
    useEmbeddedConnection: () => vi.fn(),
    useNewSessionConnection: () => vi.fn(),
    createConnectionStateFromParams: vi.fn(),
} as unknown as SessionWorkbenchSidebarDependencies;

function addSession(sessionId: string, name: string): void {
    state.sessionScriptsMap.set(sessionId, { sessionId, name, sessionMetadata: {}, scripts: {} });
}

describe('SessionWorkbenchSidebar folders', () => {
    let container: HTMLDivElement;
    let root: Root;

    function render(currentSessionId: string = ROOT_SESSION): void {
        act(() => root.render(<SessionWorkbenchSidebar
            sessionScripts={{ sessionId: currentSessionId, instance: {} } as any}
            dependencies={dependencies}
        />));
    }

    /// The label of a row, the folder name or the session name
    function rowLabel(row: Element): string {
        const button = row.querySelector(':scope > button');
        if (row.getAttribute('data-testid') === 'session-folder-row') return button?.getAttribute('title')?.split('/').pop() ?? '';
        return button?.textContent ?? '';
    }

    /// The rows of the session list as `<depth>:<label>`
    function rows(): string[] {
        return Array.from(container.querySelectorAll('ul[aria-label="Sessions"] > li:not([data-testid="session-top-level-drop"])')).map(row => {
            const caret = row.getAttribute('data-testid') === 'session-folder-row' ? 0 : 20;
            const depth = (parseInt((row as HTMLElement).style.paddingLeft, 10) - 8 - caret) / 16;
            return `${depth}:${rowLabel(row)}`;
        });
    }

    function folderRow(name: string): HTMLElement {
        return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="session-folder-row"]'))
            .find(row => rowLabel(row) === name)!;
    }

    async function folderMenu(name: string, action: string): Promise<void> {
        act(() => (folderRow(name).querySelector('[data-testid="session-folder-menu"]') as HTMLButtonElement).click());
        await act(async () => {
            (document.querySelector(`[data-testid="session-folder-menu-item"][data-action="${action}"]`) as HTMLElement).click();
        });
    }

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        state.createSession.mockReset().mockReturnValue({ sessionId: NEW_SESSION });
        state.sessionScriptsMap.clear();
        state.registry = new SessionTestRegistry();
        await state.registry.createFolder(['clients']);
        await state.registry.createFolder(['clients', 'acme']);
        await state.registry.upsertSessionEntry({ path: ROOT_SESSION });
        await state.registry.upsertSessionEntry({ path: CLIENT_SESSION }, ['clients']);
        await state.registry.upsertSessionEntry({ path: ACME_SESSION }, ['clients', 'acme']);
        state.backend = new CompositeStorageBackend(state.registry, new TestLogger());
        await state.backend.initialize();
        addSession(ROOT_SESSION, 'Root');
        addSession(CLIENT_SESSION, 'Client');
        addSession(ACME_SESSION, 'Acme report');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        act(() => root.unmount());
        container.remove();
    });

    it('shows the folders before the sessions with an indent per level', () => {
        render();
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);
    });

    it('collapses a folder and expands the folders of an opened session', async () => {
        render();
        act(() => (folderRow('clients').querySelector(':scope > button') as HTMLButtonElement).click());
        expect(rows()).toEqual(['0:clients', '0:Root']);
        expect(folderRow('clients').querySelector(':scope > button')?.getAttribute('aria-expanded')).toBe('false');

        render(ACME_SESSION);
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']));
    });

    it('creates a session in a folder', async () => {
        render();
        addSession(NEW_SESSION, 'New');
        await folderMenu('acme', 'new-session');
        await vi.waitFor(() => expect(state.registry.tree.folders[0].folders[0].sessions.map(entry => entry.path)).toEqual([ACME_SESSION, NEW_SESSION]));
        expect(state.createSession).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '2:New', '1:Client', '0:Root']));
    });

    it('creates a folder and edits its name', async () => {
        render();
        await act(async () => {
            (container.querySelector('[data-testid="create-folder"]') as HTMLButtonElement).click();
        });
        await vi.waitFor(() => expect(state.registry.tree.folders.map(folder => folder.name)).toEqual(['clients', 'New folder']));
        await vi.waitFor(() => expect(container.querySelector('input[aria-label="Folder name"]')).not.toBeNull());
        const input = container.querySelector<HTMLInputElement>('input[aria-label="Folder name"]')!;
        expect(input.value).toBe('New folder');
        await act(async () => {
            input.focus();
            input.value = 'reports';
            input.blur();
        });
        await vi.waitFor(() => expect(state.registry.tree.folders.map(folder => folder.name)).toEqual(['clients', 'reports']));
        await vi.waitFor(() => expect(rows()).toContain('0:reports'));
    });

    it('moves the sessions of a deleted folder to its parent', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render();
        await folderMenu('clients', 'delete');
        expect(window.confirm).toHaveBeenCalledWith('Delete the folder "clients"? Its 2 sessions move to the top level.');
        await vi.waitFor(() => expect(rows()).toEqual(['0:Root', '0:Acme report', '0:Client']));
        expect(state.registry.tree.folders).toEqual([]);
    });

    it('moves a session of a folder to the top level', async () => {
        render();
        const client = Array.from(container.querySelectorAll('ul[aria-label="Sessions"] > li'))
            .find(row => rowLabel(row) === 'Client')!;
        act(() => (client.querySelector('[data-testid="session-row-menu"]') as HTMLButtonElement).click());
        await act(async () => {
            (document.querySelector('[data-testid="session-menu-item"][data-action="move-to-top-level"]') as HTMLElement).click();
        });
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '0:Root', '0:Client']));
        expect(state.registry.tree.sessions.map(entry => entry.path)).toEqual([ROOT_SESSION, CLIENT_SESSION]);
    });
});
