import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { CompositeStorageBackend } from '../storage/composite_storage_backend.js';
import { WorkbookTestRegistry } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { StorageBackendType } from '@akohn/dashql/platform/storage/storage_backend';
import { scriptSelectionOf } from './scripts/script_selection.js';
import { WorkbookWorkbenchSidebar, type WorkbookWorkbenchSidebarDependencies } from './workbook_workbench_sidebar.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const ROOT_WORKBOOK = '00000000-0000-4000-8000-00000000000a';
const CLIENT_WORKBOOK = '00000000-0000-4000-8000-00000000000b';
const ACME_WORKBOOK = '00000000-0000-4000-8000-00000000000c';
const NEW_WORKBOOK = '00000000-0000-4000-8000-00000000000d';

const state = {
    createWorkbook: vi.fn(),
    openGreeter: vi.fn(),
    ensureEphemeralWorkbook: vi.fn(),
    navigate: vi.fn(),
    modifyWorkbookScripts: vi.fn(),
    workbookScriptsMap: new Map<string, unknown>(),
    registry: new WorkbookTestRegistry(),
    backend: null as CompositeStorageBackend | null,
};

const storageReader = {
    get backend() { return state.backend; },
    get workbookFolders() { return state.backend; },
    getWorkbookLocation: () => ({ type: StorageBackendType.OPFS }),
    getWorkbookOrder: () => state.backend!.getWorkbookOrder(),
    getWorkbookTree: () => state.backend!.getWorkbookTree(),
};
const storageWriter = { deleteWorkbook: vi.fn(), backend: {}, isWorkbookHeld: () => false };
/// The runtime as the sidebar uses it, without connections
const runtime = { storage: storageWriter, dispatch: vi.fn(), createConnection: vi.fn(), store: { get: () => null } };
const NO_CONNECTIONS = new Map();
const NO_CONNECTION_LIST = { connections: [], connectionsByType: [[], [], [], []] };

const dependencies = {
    useRouterNavigate: () => state.navigate,
    useRouteContext: () => ({ workbookId: ROOT_WORKBOOK, workbookSetupStatus: 0 }),
    useRuntime: () => runtime,
    useDispatch: () => state.modifyWorkbookScripts,
    useConnections: () => NO_CONNECTIONS,
    useConnectionList: () => NO_CONNECTION_LIST,
    useConnectionViews: () => null,
    ConnectionSettingsOverlay: () => null,
    useDeleteWorkbook: () => vi.fn(),
    useWorkbooks: () => state.workbookScriptsMap,
    useWorkbookCreation: () => state.createWorkbook,
    useOpenGreeter: () => state.openGreeter,
    useEnsureEphemeralWorkbook: () => state.ensureEphemeralWorkbook,
    useMergeConnections: () => async () => {},
    useReplaceConnection: () => async () => ({ removed: false }),
    useDetachConnection: () => vi.fn(),
    useDeleteConnection: () => vi.fn(),
    useStorageReader: () => storageReader,
    // The storage overlay renders the storage item of the workbook menu as its anchor
    WorkbookStorageOverlay: (props: { renderAnchor: (p: object) => React.ReactElement }) => props.renderAnchor({}),
    WorkbookURLShareOverlay: () => null,
    WorkbookFileSaveOverlay: () => null,
    useWorkbookImport: () => ({}),
    useInvalidWorkbooks: () => ({ invalidWorkbooks: new Map(), deleteInvalidWorkbook: vi.fn() }),
    useDashQLCoreSetup: () => vi.fn(),
    usePlatformType: () => 0,
    useLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
    useNewWorkbookConnection: () => vi.fn(),
    createConnectionStateFromParams: vi.fn(),
    useClouds: () => ({ clouds: [], openSetup: vi.fn(), setupRequest: null }),
    CloudsFolder: () => null,
} as unknown as WorkbookWorkbenchSidebarDependencies;

/// Leave an input. blur() fires no event while the window lacks focus, as in a background window of the test dashboard.
function leaveInput(input: HTMLInputElement): void {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

function addWorkbook(workbookId: string, name: string, scriptOrder: string[] = []): void {
    const scriptRefs = Object.fromEntries(scriptOrder.map((fileName, scriptId) => [fileName, { fileName, scriptId }]));
    // A new map, like the store hands out when a workbook changes
    state.workbookScriptsMap = new Map(state.workbookScriptsMap).set(workbookId, { workbookId, name, ephemeral: false, workbookMetadata: {}, scriptRefs, scriptOrder, connectionIds: [] });
}

describe('WorkbookWorkbenchSidebar folders', () => {
    let container: HTMLDivElement;
    let root: Root;

    function render(currentWorkbookId: string = ROOT_WORKBOOK, onOpenScript?: (workbookId: string, fileName: string) => void): void {
        act(() => root.render(<WorkbookWorkbenchSidebar
            workbookScripts={{ workbookId: currentWorkbookId, instance: {} } as any}
            onOpenScript={onOpenScript}
            dependencies={dependencies}
        />));
    }

    /// The label of a row, the folder name, the workbook name or the script name
    function rowLabel(row: Element): string {
        const button = row.querySelector(':scope > button');
        if (row.getAttribute('data-testid') === 'workbook-folder-row') return button?.getAttribute('title')?.split('/').pop() ?? '';
        return button?.textContent ?? '';
    }

    /// The rows of the workbook list below Local as `<depth>:<label>`, the scripts of a workbook one level deeper
    function rows(): string[] {
        return Array.from(container.querySelectorAll('ul[aria-label="Workbooks"] > li:not([data-testid="workbook-top-level-drop"], [data-testid="workbook-ephemeral-row"], [data-testid="local-folder"])')).map(row => {
            // A script row starts below the icon of its workbook, after the caret column
            const script = row.getAttribute('data-testid') === 'workbook-script-row';
            const depth = (parseInt((row as HTMLElement).style.paddingLeft, 10) - 8 - (script ? 20 : 0)) / 16 + (script ? 1 : 0) - 1;
            return `${depth}:${rowLabel(row)}`;
        });
    }

    function workbookRow(name: string): HTMLElement {
        return Array.from(container.querySelectorAll<HTMLElement>('ul[aria-label="Workbooks"] > li'))
            .find(row => row.getAttribute('data-testid') == null && rowLabel(row) === name)!;
    }

    function folderRow(name: string): HTMLElement {
        return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="workbook-folder-row"]'))
            .find(row => rowLabel(row) === name)!;
    }

    async function folderMenu(name: string, action: string): Promise<void> {
        act(() => (folderRow(name).querySelector('[data-testid="workbook-folder-menu"]') as HTMLButtonElement).click());
        await act(async () => {
            (document.querySelector(`[data-testid="workbook-folder-menu-item"][data-action="${action}"]`) as HTMLElement).click();
        });
    }

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        state.createWorkbook.mockReset().mockReturnValue({ workbookId: NEW_WORKBOOK });
        state.openGreeter.mockReset();
        state.ensureEphemeralWorkbook.mockReset();
        state.navigate.mockReset();
        state.modifyWorkbookScripts.mockReset();
        state.workbookScriptsMap.clear();
        state.registry = new WorkbookTestRegistry();
        await state.registry.createFolder(['clients']);
        await state.registry.createFolder(['clients', 'acme']);
        await state.registry.upsertWorkbookEntry({ path: ROOT_WORKBOOK });
        await state.registry.upsertWorkbookEntry({ path: CLIENT_WORKBOOK }, ['clients']);
        await state.registry.upsertWorkbookEntry({ path: ACME_WORKBOOK }, ['clients', 'acme']);
        state.backend = new CompositeStorageBackend(state.registry, new TestLogger());
        await state.backend.initialize();
        addWorkbook(ROOT_WORKBOOK, 'Root');
        addWorkbook(CLIENT_WORKBOOK, 'Client');
        addWorkbook(ACME_WORKBOOK, 'Acme report');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        act(() => root.unmount());
        container.remove();
    });

    it('shows the folders before the workbooks with an indent per level', () => {
        render();
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);
    });

    it('collapses a folder and expands the folders of an opened workbook', async () => {
        render();
        act(() => (folderRow('clients').querySelector(':scope > button') as HTMLButtonElement).click());
        expect(rows()).toEqual(['0:clients', '0:Root']);
        expect(folderRow('clients').querySelector(':scope > button')?.getAttribute('aria-expanded')).toBe('false');

        render(ACME_WORKBOOK);
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']));
    });

    it('lists the scripts of an expanded workbook', () => {
        addWorkbook(CLIENT_WORKBOOK, 'Client', ['orders.sql', 'revenue.sql']);
        const onOpenScript = vi.fn();
        render(ROOT_WORKBOOK, onOpenScript);
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);
        // Only a workbook with scripts can be expanded
        expect(workbookRow('Root').querySelector(':scope > button')?.hasAttribute('aria-expanded')).toBe(false);
        const toggle = workbookRow('Client').querySelector<HTMLButtonElement>(':scope > button')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        // A click on the name only opens the workbook
        act(() => toggle.click());
        expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ value: CLIENT_WORKBOOK }));
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);

        // A second click, on the name of the open workbook, lists its scripts
        render(CLIENT_WORKBOOK, onOpenScript);
        state.navigate.mockReset();
        act(() => toggle.click());
        expect(state.navigate).not.toHaveBeenCalled();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '2:orders', '2:revenue', '0:Root']);

        const revenue = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="workbook-script-row"]'))
            .find(row => rowLabel(row) === 'revenue')!;
        act(() => revenue.querySelector<HTMLButtonElement>('button')!.click());
        // The second script of the workbook is selected
        expect(scriptSelectionOf(null).store.current.get(CLIENT_WORKBOOK)).toBe(1);
        expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ value: CLIENT_WORKBOOK }));
        expect(onOpenScript).toHaveBeenCalledWith(CLIENT_WORKBOOK, 'revenue.sql');

        // Further clicks on the name of the open workbook hide and show its scripts again, without a rename
        state.navigate.mockReset();
        act(() => toggle.click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);
        act(() => toggle.click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '2:orders', '2:revenue', '0:Root']);
        expect(state.navigate).not.toHaveBeenCalled();
        expect(container.querySelector('input[aria-label="Workbook name"]')).toBeNull();
    });

    it('collapses a workbook when another one is selected', async () => {
        addWorkbook(ROOT_WORKBOOK, 'Root', ['daily.sql']);
        addWorkbook(CLIENT_WORKBOOK, 'Client', ['orders.sql']);
        render();
        const nameButton = (name: string) => workbookRow(name).querySelector<HTMLButtonElement>(':scope > button')!;
        act(() => nameButton('Root').click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root', '1:daily']);

        // A click on another workbook opens it, the listed scripts go away and the new workbook stays collapsed
        act(() => nameButton('Client').click());
        expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ value: CLIENT_WORKBOOK }));
        render(CLIENT_WORKBOOK);
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']));

        act(() => nameButton('Client').click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '2:orders', '0:Root']);

        // A selection from outside the sidebar collapses the workbook too
        render(ACME_WORKBOOK);
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']));
    });

    it('renames a script of an expanded workbook', async () => {
        addWorkbook(CLIENT_WORKBOOK, 'Client', ['orders.sql', 'revenue.sql']);
        render(CLIENT_WORKBOOK);
        act(() => workbookRow('Client').querySelector<HTMLButtonElement>(':scope > button')!.click());
        const scriptRow = (name: string) => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="workbook-script-row"]'))
            .find(row => rowLabel(row) === name || row.querySelector('input')?.value === name)!;

        // A double-click on the name edits it, the input shows the name without the extension
        act(() => scriptRow('revenue').querySelector<HTMLButtonElement>(':scope > button')!
            .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        const input = container.querySelector<HTMLInputElement>('input[aria-label="Script name"]')!;
        expect(input.value).toBe('revenue');
        state.modifyWorkbookScripts.mockReset();
        await act(async () => {
            input.value = 'income';
            leaveInput(input);
        });
        expect(state.modifyWorkbookScripts).toHaveBeenCalledWith({ kind: 'renameScript', value: { fileName: 'revenue.sql', newName: 'income' } });
        expect(container.querySelector('input[aria-label="Script name"]')).toBeNull();

        // The rename action of the menu edits the name too, an unchanged name renames nothing
        act(() => scriptRow('orders').querySelector<HTMLButtonElement>('[data-testid="script-row-menu"]')!.click());
        await act(async () => {
            document.querySelector<HTMLElement>('[data-testid="script-menu-item"][data-action="rename"]')!.click();
        });
        const menuInput = container.querySelector<HTMLInputElement>('input[aria-label="Script name"]')!;
        expect(menuInput.value).toBe('orders');
        state.modifyWorkbookScripts.mockReset();
        await act(async () => {
            leaveInput(menuInput);
        });
        expect(state.modifyWorkbookScripts).not.toHaveBeenCalled();
        expect(container.querySelector('input[aria-label="Script name"]')).toBeNull();
    });

    it('creates a workbook in a folder', async () => {
        render();
        addWorkbook(NEW_WORKBOOK, 'New');
        await folderMenu('acme', 'new-workbook');
        await vi.waitFor(() => expect(state.registry.tree.folders[0].folders[0].workbooks.map(entry => entry.path)).toEqual([ACME_WORKBOOK, NEW_WORKBOOK]));
        expect(state.createWorkbook).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '2:New', '1:Client', '0:Root']));
    });

    describe('the ephemeral workbook', () => {
        const GREETER_WORKBOOK = '00000000-0000-4000-8000-00000000000e';
        const NEXT_GREETER_WORKBOOK = '00000000-0000-4000-8000-00000000000f';

        function addEphemeralWorkbook(workbookId: string): void {
            state.workbookScriptsMap = new Map(state.workbookScriptsMap).set(workbookId, {
                workbookId, name: 'New Workbook', ephemeral: true, workbookMetadata: { ephemeral: true }, scriptRefs: {}, scriptOrder: [], connectionIds: [],
            });
        }
        function ephemeralRow(): HTMLElement | null {
            return container.querySelector('[data-testid="workbook-ephemeral-row"]');
        }
        function workbookCount(): string | null | undefined {
            return container.querySelector('[data-testid="workbook-count"]')?.textContent;
        }
        async function registerInTree(workbookId: string, atStartOfRootWorkbooks: boolean = false): Promise<void> {
            await state.registry.upsertWorkbookEntry({ path: workbookId });
            if (atStartOfRootWorkbooks) await state.registry.moveWorkbook(workbookId, [], 0);
            await state.backend!.initialize();
        }

        it('shows the row at the end of the list, without a menu and outside the count', async () => {
            await registerInTree(GREETER_WORKBOOK, true);
            addEphemeralWorkbook(GREETER_WORKBOOK);
            render(GREETER_WORKBOOK);
            expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root']);
            const row = ephemeralRow()!;
            // The last workbook, the same row as the others directly below them
            const workbookRows = Array.from(row.parentElement!.children).filter(child => child.getAttribute('data-testid') !== 'workbook-top-level-drop');
            expect(workbookRows[workbookRows.length - 1]).toBe(row);
            expect(row.previousElementSibling).toBe(workbookRow('Root'));
            expect(row.style.paddingLeft).toBe(workbookRow('Root').style.paddingLeft);
            expect(row.querySelector('button')!.className).toBe(workbookRow('Root').querySelector(':scope > button')!.className);
            expect(row.textContent).toBe('New Workbook');
            expect(getComputedStyle(row.querySelector('button > span:last-child')!).fontStyle).toBe('italic');
            expect(row.querySelector('[data-testid="workbook-row-menu"]')).toBeNull();
            expect(workbookCount()).toBe('3');
            expect(row.querySelector('button')!.getAttribute('aria-current')).toBe('page');

            render(ROOT_WORKBOOK);
            expect(ephemeralRow()!.querySelector('button')!.getAttribute('aria-current')).toBeNull();
            act(() => ephemeralRow()!.querySelector('button')!.click());
            expect(state.openGreeter).toHaveBeenCalledTimes(1);
        });

        it('disables the create button while the ephemeral workbook is selected', async () => {
            addEphemeralWorkbook(GREETER_WORKBOOK);
            const createButton = () => container.querySelector<HTMLButtonElement>('[data-testid="create-workbook"]')!;
            render(GREETER_WORKBOOK);
            expect(createButton().disabled).toBe(true);

            render(ROOT_WORKBOOK);
            expect(createButton().disabled).toBe(false);
            act(() => createButton().click());
            expect(state.openGreeter).toHaveBeenCalledTimes(1);
        });

        it('opens the greeter when the last workbook is deleted', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            state.workbookScriptsMap.clear();
            addWorkbook(ROOT_WORKBOOK, 'Root');
            addEphemeralWorkbook(GREETER_WORKBOOK);
            render();
            act(() => (workbookRow('Root').querySelector('[data-testid="workbook-row-menu"]') as HTMLButtonElement).click());
            await act(async () => {
                (document.querySelector('[data-testid="workbook-menu-item"][data-action="delete"]') as HTMLElement).click();
            });
            await vi.waitFor(() => expect(state.openGreeter).toHaveBeenCalledTimes(1));
        });

        it('moves a promoted workbook to the end of the root and asks for the next ephemeral workbook', async () => {
            await registerInTree(GREETER_WORKBOOK, true);
            addEphemeralWorkbook(GREETER_WORKBOOK);
            render(GREETER_WORKBOOK);
            expect(state.ensureEphemeralWorkbook).not.toHaveBeenCalled();

            addWorkbook(GREETER_WORKBOOK, 'Untitled', ['1.sql']);
            addEphemeralWorkbook(NEXT_GREETER_WORKBOOK);
            render(GREETER_WORKBOOK);
            await vi.waitFor(() => expect(state.registry.tree.workbooks.map(entry => entry.path)).toEqual([ROOT_WORKBOOK, GREETER_WORKBOOK]));
            expect(state.ensureEphemeralWorkbook).toHaveBeenCalledTimes(1);
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

    it('moves the workbooks of a deleted folder to its parent', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render();
        await folderMenu('clients', 'delete');
        expect(window.confirm).toHaveBeenCalledWith('Delete the folder "clients"? Its 2 workbooks move to the top level.');
        await vi.waitFor(() => expect(rows()).toEqual(['0:Root', '0:Acme report', '0:Client']));
        expect(state.registry.tree.folders).toEqual([]);
    });

    it('lists the actions of a workbook in order, without moving a workbook of a folder to the top level', () => {
        render();
        act(() => (workbookRow('Client').querySelector('[data-testid="workbook-row-menu"]') as HTMLButtonElement).click());
        const actions = Array.from(document.querySelectorAll('[data-testid="workbook-menu-item"]')).map(item => item.getAttribute('data-action'));
        expect(actions).toEqual(['storage', 'rename', 'duplicate', 'share-url', 'export', 'delete']);
    });
});
