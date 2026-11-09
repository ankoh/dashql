import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../platform/logger/test_logger.js';
import { CompositeStorageBackend } from '../storage/composite_storage_backend.js';
import { SessionTestRegistry } from '../storage/session_test_backend.js';
import { StorageBackendType } from '../storage/storage_backend.js';
import { RENAME_SCRIPT, SELECT_SCRIPT } from './scripts/session_scripts.js';
import { SessionWorkbenchSidebar, type SessionWorkbenchSidebarDependencies } from './session_workbench_sidebar.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const ROOT_SESSION = '00000000-0000-4000-8000-00000000000a';
const CLIENT_SESSION = '00000000-0000-4000-8000-00000000000b';
const ACME_SESSION = '00000000-0000-4000-8000-00000000000c';
const NEW_SESSION = '00000000-0000-4000-8000-00000000000d';

const state = {
    createSession: vi.fn(),
    openGreeter: vi.fn(),
    ensureEphemeralSession: vi.fn(),
    navigate: vi.fn(),
    modifySessionScripts: vi.fn(),
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
const storageWriter = { write: vi.fn(), deleteSession: vi.fn(), backend: {}, cancelPendingWritesForSession: vi.fn(), isSessionPaused: () => false };

const dependencies = {
    useRouterNavigate: () => state.navigate,
    useRouteContext: () => ({ sessionId: ROOT_SESSION, sessionSetupStatus: 0 }),
    useConnectionRegistry: () => [{ connections: new Map() }, vi.fn()],
    useConnectionReferences: () => references,
    useSessionConnections: () => null,
    useDynamicConnectionDispatch: () => [{ connections: new Map(), connectionsByType: [[], [], []] }, vi.fn()],
    useConnectionAllocator: () => vi.fn(),
    ConnectionSettingsOverlay: () => null,
    useSessionScriptsDeletion: () => vi.fn(),
    useSessionScriptsRegistry: () => [{ sessionScriptsMap: state.sessionScriptsMap }],
    useSessionScripts: () => [null, state.modifySessionScripts],
    useSessionCreation: () => state.createSession,
    useOpenGreeter: () => state.openGreeter,
    useEnsureEphemeralSession: () => state.ensureEphemeralSession,
    useMergeConnections: () => async () => {},
    useReplaceConnection: () => async () => ({ removed: false }),
    useDetachConnection: () => vi.fn(),
    useDeleteConnection: () => vi.fn(),
    useStorageReader: () => storageReader,
    useStorageWriter: () => storageWriter,
    useComputationDispatch: () => vi.fn(),
    // The storage overlay renders the storage item of the session menu as its anchor
    SessionStorageOverlay: (props: { renderAnchor: (p: object) => React.ReactElement }) => props.renderAnchor({}),
    SessionURLShareOverlay: () => null,
    SessionFileSaveOverlay: () => null,
    useSessionImport: () => ({}),
    useInvalidSessions: () => ({ invalidSessions: new Map(), deleteInvalidSession: vi.fn() }),
    useDashQLCoreSetup: () => vi.fn(),
    usePlatformType: () => 0,
    useLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
    useNewSessionConnection: () => vi.fn(),
    createConnectionStateFromParams: vi.fn(),
} as unknown as SessionWorkbenchSidebarDependencies;

/// Leave an input. blur() fires no event while the window lacks focus, as in a background window of the test dashboard.
function leaveInput(input: HTMLInputElement): void {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

function addSession(sessionId: string, name: string, scriptOrder: string[] = []): void {
    const scriptRefs = Object.fromEntries(scriptOrder.map((fileName, scriptId) => [fileName, { fileName, scriptId }]));
    state.sessionScriptsMap.set(sessionId, { sessionId, name, sessionMetadata: {}, scripts: {}, scriptRefs, scriptOrder });
}

describe('SessionWorkbenchSidebar folders', () => {
    let container: HTMLDivElement;
    let root: Root;

    function render(currentSessionId: string = ROOT_SESSION, onOpenScript?: (sessionId: string, fileName: string) => void): void {
        act(() => root.render(<SessionWorkbenchSidebar
            sessionScripts={{ sessionId: currentSessionId, instance: {} } as any}
            onOpenScript={onOpenScript}
            dependencies={dependencies}
        />));
    }

    /// The label of a row, the folder name, the session name or the script name
    function rowLabel(row: Element): string {
        const button = row.querySelector(':scope > button');
        if (row.getAttribute('data-testid') === 'session-folder-row') return button?.getAttribute('title')?.split('/').pop() ?? '';
        return button?.textContent ?? '';
    }

    /// The rows of the session list as `<depth>:<label>`, the scripts of a session one level deeper
    function rows(): string[] {
        return Array.from(container.querySelectorAll('ul[aria-label="Sessions"] > li:not([data-testid="session-top-level-drop"], [data-testid="session-ephemeral-row"])')).map(row => {
            // A script row starts below the icon of its session, after the caret column
            const script = row.getAttribute('data-testid') === 'session-script-row';
            const depth = (parseInt((row as HTMLElement).style.paddingLeft, 10) - 8 - (script ? 20 : 0)) / 16 + (script ? 1 : 0);
            return `${depth}:${rowLabel(row)}`;
        });
    }

    function sessionRow(name: string): HTMLElement {
        return Array.from(container.querySelectorAll<HTMLElement>('ul[aria-label="Sessions"] > li'))
            .find(row => row.getAttribute('data-testid') == null && rowLabel(row) === name)!;
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
        state.openGreeter.mockReset();
        state.ensureEphemeralSession.mockReset();
        state.navigate.mockReset();
        state.modifySessionScripts.mockReset();
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

    it('lists the scripts of an expanded session', () => {
        addSession(CLIENT_SESSION, 'Client', ['orders.sql', 'revenue.sql']);
        const onOpenScript = vi.fn();
        render(ROOT_SESSION, onOpenScript);
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);
        // Only a session with scripts can be expanded
        expect(sessionRow('Root').querySelector(':scope > button')?.hasAttribute('aria-expanded')).toBe(false);
        const toggle = sessionRow('Client').querySelector<HTMLButtonElement>(':scope > button')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        // A click on the name only opens the session
        act(() => toggle.click());
        expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ value: CLIENT_SESSION }));
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);

        // A second click, on the name of the open session, lists its scripts
        render(CLIENT_SESSION, onOpenScript);
        state.navigate.mockReset();
        act(() => toggle.click());
        expect(state.navigate).not.toHaveBeenCalled();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '2:orders', '2:revenue', '0:Root']);

        const revenue = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="session-script-row"]'))
            .find(row => rowLabel(row) === 'revenue')!;
        act(() => revenue.querySelector<HTMLButtonElement>('button')!.click());
        expect(state.modifySessionScripts).toHaveBeenCalledWith({ type: SELECT_SCRIPT, value: 'revenue.sql' });
        expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ value: CLIENT_SESSION }));
        expect(onOpenScript).toHaveBeenCalledWith(CLIENT_SESSION, 'revenue.sql');

        // Further clicks on the name of the open session hide and show its scripts again, without a rename
        state.navigate.mockReset();
        act(() => toggle.click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);
        act(() => toggle.click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '2:orders', '2:revenue', '0:Root']);
        expect(state.navigate).not.toHaveBeenCalled();
        expect(container.querySelector('input[aria-label="Session name"]')).toBeNull();
    });

    it('collapses a session when another one is selected', async () => {
        addSession(ROOT_SESSION, 'Root', ['daily.sql']);
        addSession(CLIENT_SESSION, 'Client', ['orders.sql']);
        render();
        const nameButton = (name: string) => sessionRow(name).querySelector<HTMLButtonElement>(':scope > button')!;
        act(() => nameButton('Root').click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root', '1:daily']);

        // A click on another session opens it, the listed scripts go away and the new session stays collapsed
        act(() => nameButton('Client').click());
        expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ value: CLIENT_SESSION }));
        render(CLIENT_SESSION);
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']));

        act(() => nameButton('Client').click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '2:orders', '0:Root']);

        // A selection from outside the sidebar collapses the session too
        render(ACME_SESSION);
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']));
    });

    it('renames a script of an expanded session', async () => {
        addSession(CLIENT_SESSION, 'Client', ['orders.sql', 'revenue.sql']);
        render(CLIENT_SESSION);
        act(() => sessionRow('Client').querySelector<HTMLButtonElement>(':scope > button')!.click());
        const scriptRow = (name: string) => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="session-script-row"]'))
            .find(row => rowLabel(row) === name || row.querySelector('input')?.value === name)!;

        // A double-click on the name edits it, the input shows the name without the extension
        act(() => scriptRow('revenue').querySelector<HTMLButtonElement>(':scope > button')!
            .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        const input = container.querySelector<HTMLInputElement>('input[aria-label="Script name"]')!;
        expect(input.value).toBe('revenue');
        state.modifySessionScripts.mockReset();
        await act(async () => {
            input.value = 'income';
            leaveInput(input);
        });
        expect(state.modifySessionScripts).toHaveBeenCalledWith({ type: RENAME_SCRIPT, value: { fileName: 'revenue.sql', newFileName: 'income' } });
        expect(container.querySelector('input[aria-label="Script name"]')).toBeNull();

        // The rename action of the menu edits the name too, an unchanged name renames nothing
        act(() => scriptRow('orders').querySelector<HTMLButtonElement>('[data-testid="script-row-menu"]')!.click());
        await act(async () => {
            document.querySelector<HTMLElement>('[data-testid="script-menu-item"][data-action="rename"]')!.click();
        });
        const menuInput = container.querySelector<HTMLInputElement>('input[aria-label="Script name"]')!;
        expect(menuInput.value).toBe('orders');
        state.modifySessionScripts.mockReset();
        await act(async () => {
            leaveInput(menuInput);
        });
        expect(state.modifySessionScripts).not.toHaveBeenCalled();
        expect(container.querySelector('input[aria-label="Script name"]')).toBeNull();
    });

    it('creates a session in a folder', async () => {
        render();
        addSession(NEW_SESSION, 'New');
        await folderMenu('acme', 'new-session');
        await vi.waitFor(() => expect(state.registry.tree.folders[0].folders[0].sessions.map(entry => entry.path)).toEqual([ACME_SESSION, NEW_SESSION]));
        expect(state.createSession).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '2:New', '1:Client', '0:Root']));
    });

    describe('the ephemeral session', () => {
        const GREETER_SESSION = '00000000-0000-4000-8000-00000000000e';
        const NEXT_GREETER_SESSION = '00000000-0000-4000-8000-00000000000f';

        function addEphemeralSession(sessionId: string): void {
            state.sessionScriptsMap.set(sessionId, {
                sessionId, name: 'New Session', sessionMetadata: { ephemeral: true }, scripts: {}, scriptRefs: {}, scriptOrder: [],
            });
        }
        function ephemeralRow(): HTMLElement | null {
            return container.querySelector('[data-testid="session-ephemeral-row"]');
        }
        function sessionCount(): string | null | undefined {
            return container.querySelector('[data-testid="session-count"]')?.textContent;
        }
        async function registerInTree(sessionId: string, atStartOfRootSessions: boolean = false): Promise<void> {
            await state.registry.upsertSessionEntry({ path: sessionId });
            if (atStartOfRootSessions) await state.registry.moveSession(sessionId, [], 0);
            await state.backend!.initialize();
        }

        it('shows the row at the end of the list, without a menu and outside the count', async () => {
            await registerInTree(GREETER_SESSION, true);
            addEphemeralSession(GREETER_SESSION);
            render(GREETER_SESSION);
            expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);
            const row = ephemeralRow()!;
            // The last session, the same row as the others directly below them
            const sessionRows = Array.from(row.parentElement!.children).filter(child => child.getAttribute('data-testid') !== 'session-top-level-drop');
            expect(sessionRows[sessionRows.length - 1]).toBe(row);
            expect(row.previousElementSibling).toBe(sessionRow('Root'));
            expect(row.style.paddingLeft).toBe(sessionRow('Root').style.paddingLeft);
            expect(row.querySelector('button')!.className).toBe(sessionRow('Root').querySelector(':scope > button')!.className);
            expect(row.textContent).toBe('New Session');
            expect(getComputedStyle(row.querySelector('button > span:last-child')!).fontStyle).toBe('italic');
            expect(row.querySelector('[data-testid="session-row-menu"]')).toBeNull();
            expect(sessionCount()).toBe('3');
            expect(row.querySelector('button')!.getAttribute('aria-current')).toBe('page');

            render(ROOT_SESSION);
            expect(ephemeralRow()!.querySelector('button')!.getAttribute('aria-current')).toBeNull();
            act(() => ephemeralRow()!.querySelector('button')!.click());
            expect(state.openGreeter).toHaveBeenCalledTimes(1);
        });

        it('disables the create button while the ephemeral session is selected', async () => {
            addEphemeralSession(GREETER_SESSION);
            const createButton = () => container.querySelector<HTMLButtonElement>('[data-testid="create-session"]')!;
            render(GREETER_SESSION);
            expect(createButton().disabled).toBe(true);

            render(ROOT_SESSION);
            expect(createButton().disabled).toBe(false);
            act(() => createButton().click());
            expect(state.openGreeter).toHaveBeenCalledTimes(1);
        });

        it('opens the greeter when the last session is deleted', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            state.sessionScriptsMap.clear();
            addSession(ROOT_SESSION, 'Root');
            addEphemeralSession(GREETER_SESSION);
            render();
            act(() => (sessionRow('Root').querySelector('[data-testid="session-row-menu"]') as HTMLButtonElement).click());
            await act(async () => {
                (document.querySelector('[data-testid="session-menu-item"][data-action="delete"]') as HTMLElement).click();
            });
            await vi.waitFor(() => expect(state.openGreeter).toHaveBeenCalledTimes(1));
        });

        it('moves a promoted session to the end of the root and asks for the next ephemeral session', async () => {
            await registerInTree(GREETER_SESSION, true);
            addEphemeralSession(GREETER_SESSION);
            render(GREETER_SESSION);
            expect(state.ensureEphemeralSession).not.toHaveBeenCalled();

            addSession(GREETER_SESSION, 'Untitled', ['1.sql']);
            addEphemeralSession(NEXT_GREETER_SESSION);
            render(GREETER_SESSION);
            await vi.waitFor(() => expect(state.registry.tree.sessions.map(entry => entry.path)).toEqual([ROOT_SESSION, GREETER_SESSION]));
            expect(state.ensureEphemeralSession).toHaveBeenCalledTimes(1);
            await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root', '0:Untitled']));
            expect(ephemeralRow()).not.toBeNull();
        });
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
            input.value = 'reports';
            leaveInput(input);
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

    it('lists the actions of a session in order, without moving a session of a folder to the top level', () => {
        render();
        act(() => (sessionRow('Client').querySelector('[data-testid="session-row-menu"]') as HTMLButtonElement).click());
        const actions = Array.from(document.querySelectorAll('[data-testid="session-menu-item"]')).map(item => item.getAttribute('data-action'));
        expect(actions).toEqual(['storage', 'rename', 'duplicate', 'share-url', 'export', 'delete']);
    });
});
