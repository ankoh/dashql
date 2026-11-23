import { act, waitForRender } from '@akohn/dashql-react/testing/react_act';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';

import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { CompositeStorageBackend } from '@akohn/dashql/platform/storage/composite_storage_backend';
import { WorkbookTestRegistry } from '@akohn/dashql/platform/testing/workbook_test_backend';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { EPHEMERAL_WORKBOOK_NAME } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { workbookPath } from '../../app/router.js';
import { addTestConnection } from '../../tests/test_connections.js';
import { scriptSelectionOf } from '../scripts/script_selection.js';
import { WORKBOOK_LIST_CARET_COLUMN, workbookListRowPadding } from './workbook_folder_row.js';
import { SidebarTestApp } from './workbook_sidebar_test_app.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
/// The core of the storage, the runtime of the app takes the same
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

const ROOT_WORKBOOK = '00000000-0000-4000-8000-00000000000a';
const CLIENT_WORKBOOK = '00000000-0000-4000-8000-00000000000b';
const ACME_WORKBOOK = '00000000-0000-4000-8000-00000000000c';
/// The embedded Hyper that the workbooks of the tests run on
const CONNECTION_ID = 'hyper';
const EMBEDDED = { hyper: { protocol: 'WASM', endpoint: '' } } as ConnectionParams;

/// The rows of the workbook tree of the tests with all folders expanded and no workbook expanded
const TREE = ['0:clients', '1:acme', '2:Acme report', '1:Client', '0:Root'];

/// Leave an input. blur() fires no event while the window lacks focus, as in a background window of the test dashboard.
function leaveInput(input: HTMLInputElement): void {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

describe('WorkbookWorkbenchSidebar folders', () => {
    let registry: WorkbookTestRegistry;
    let backend: CompositeStorageBackend;
    let app: SidebarTestApp;
    const container = () => app.root.container;

    function render(currentWorkbookId: string = ROOT_WORKBOOK, onOpenScript?: (workbookId: string, fileName: string) => void): void {
        app.render(currentWorkbookId, { onOpenScript });
    }

    /// Create a workbook in the runtime
    function addWorkbook(workbookId: string, name: string, ephemeral: boolean = false): void {
        act(() => {
            app.runtime.createWorkbook(CONNECTION_ID, name, ephemeral, undefined, workbookId);
            app.runtime.flush();
        });
    }

    /// Add scripts to a workbook, by the bases of their file names
    function addScripts(workbookId: string, bases: string[]): void {
        act(() => {
            for (const base of bases) {
                app.runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: 'select 1', base } });
            }
            app.runtime.flush();
        });
    }

    /// The label of a row, the folder name, the workbook name or the script name
    function rowLabel(row: Element): string {
        const button = row.querySelector(':scope > button');
        if (row.getAttribute('data-testid') === 'workbook-folder-row') return button?.getAttribute('title')?.split('/').pop() ?? '';
        return button?.textContent ?? '';
    }

    /// The rows of the workbook list below Local as `<depth>:<label>`, the scripts of a workbook one level deeper
    function rows(): string[] {
        return Array.from(container().querySelectorAll('ul[aria-label="Workbooks"] > li:not([data-testid="workbook-top-level-drop"], [data-testid="workbook-ephemeral-row"], [data-testid="local-folder"], [data-testid="clouds-folder"])')).map(row => {
            // A script row starts below the icon of its workbook, after the caret column
            const script = row.getAttribute('data-testid') === 'workbook-script-row';
            const padding = parseInt((row as HTMLElement).style.paddingLeft, 10) - (script ? WORKBOOK_LIST_CARET_COLUMN : 0);
            const indent = workbookListRowPadding(1) - workbookListRowPadding(0);
            const depth = (padding - workbookListRowPadding(0)) / indent + (script ? 1 : 0) - 1;
            return `${depth}:${rowLabel(row)}`;
        });
    }

    function workbookRow(name: string): HTMLElement {
        return Array.from(container().querySelectorAll<HTMLElement>('ul[aria-label="Workbooks"] > li'))
            .find(row => row.getAttribute('data-testid') == null && rowLabel(row) === name)!;
    }

    function folderRow(name: string): HTMLElement {
        return Array.from(container().querySelectorAll<HTMLElement>('[data-testid="workbook-folder-row"]'))
            .find(row => rowLabel(row) === name)!;
    }

    async function folderMenu(name: string, action: string): Promise<void> {
        act(() => (folderRow(name).querySelector('[data-testid="workbook-folder-menu"]') as HTMLButtonElement).click());
        await act(async () => {
            (document.querySelector(`[data-testid="workbook-folder-menu-item"][data-action="${action}"]`) as HTMLElement).click();
        });
    }

    /// The workbooks of the runtime, by id
    function workbooks() {
        return app.runtime.store.all('workbook');
    }

    beforeEach(async () => {
        registry = new WorkbookTestRegistry(dql);
        await registry.createFolder(['clients']);
        await registry.createFolder(['clients', 'acme']);
        await registry.upsertWorkbookEntry({ path: ROOT_WORKBOOK });
        await registry.upsertWorkbookEntry({ path: CLIENT_WORKBOOK }, ['clients']);
        await registry.upsertWorkbookEntry({ path: ACME_WORKBOOK }, ['clients', 'acme']);
        backend = new CompositeStorageBackend(dql, registry, new TestLogger());
        await backend.initialize();
        app = new SidebarTestApp(backend);
        app.render(null);
        await act(async () => { await addTestConnection(app.runtime, { connectionId: CONNECTION_ID, params: EMBEDDED }); });
        addWorkbook(ROOT_WORKBOOK, 'Root');
        addWorkbook(CLIENT_WORKBOOK, 'Client');
        addWorkbook(ACME_WORKBOOK, 'Acme report');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        app.unmount();
    });

    it('shows the folders before the workbooks with an indent per level', () => {
        render();
        expect(rows()).toEqual(TREE);
    });

    it('collapses a folder and expands the folders of an opened workbook', async () => {
        render();
        act(() => (folderRow('clients').querySelector(':scope > button') as HTMLButtonElement).click());
        expect(rows()).toEqual(['0:clients', '0:Root']);
        expect(folderRow('clients').querySelector(':scope > button')?.getAttribute('aria-expanded')).toBe('false');

        render(ACME_WORKBOOK);
        await vi.waitFor(() => expect(rows()).toEqual(TREE));
    });

    it('lists the scripts of an expanded workbook', async () => {
        addScripts(CLIENT_WORKBOOK, ['orders', 'revenue']);
        const onOpenScript = vi.fn();
        render(ROOT_WORKBOOK, onOpenScript);
        expect(rows()).toEqual(TREE);
        // Only a workbook with scripts can be expanded
        expect(workbookRow('Root').querySelector(':scope > button')?.hasAttribute('aria-expanded')).toBe(false);
        const toggle = workbookRow('Client').querySelector<HTMLButtonElement>(':scope > button')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        // A click on the name only opens the workbook
        act(() => toggle.click());
        await waitForRender(() => expect(app.location.pathname).toBe(workbookPath(CLIENT_WORKBOOK)));
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(rows()).not.toContain('2:orders');

        // A second click, on the name of the open workbook, lists its scripts
        render(CLIENT_WORKBOOK, onOpenScript);
        const opened = app.location.key;
        act(() => toggle.click());
        expect(app.location.key).toBe(opened);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '2:orders', '2:revenue', '0:Root']);

        const revenue = Array.from(container().querySelectorAll<HTMLElement>('[data-testid="workbook-script-row"]'))
            .find(row => rowLabel(row) === 'revenue')!;
        act(() => revenue.querySelector<HTMLButtonElement>('button')!.click());
        // The script is selected
        expect(scriptSelectionOf(app.runtime).store.current.get(CLIENT_WORKBOOK)).toBe(workbooks().get(CLIENT_WORKBOOK)!.scriptRefs['revenue.sql'].scriptId);
        await waitForRender(() => expect(app.location.pathname).toBe(workbookPath(CLIENT_WORKBOOK)));
        expect(onOpenScript).toHaveBeenCalledWith(CLIENT_WORKBOOK, 'revenue.sql');

        // Further clicks on the name of the open workbook hide and show its scripts again, without a rename
        const selected = app.location.key;
        act(() => toggle.click());
        expect(rows()).not.toContain('2:orders');
        act(() => toggle.click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '2:orders', '2:revenue', '0:Root']);
        expect(app.location.key).toBe(selected);
        expect(container().querySelector('input[aria-label="Workbook name"]')).toBeNull();
    });

    it('collapses a workbook when another one is selected', async () => {
        addScripts(ROOT_WORKBOOK, ['daily']);
        addScripts(CLIENT_WORKBOOK, ['orders']);
        render();
        const nameButton = (name: string) => workbookRow(name).querySelector<HTMLButtonElement>(':scope > button')!;
        act(() => nameButton('Root').click());
        expect(rows()).toEqual([...TREE, '1:daily']);

        // A click on another workbook opens it, the listed scripts go away and the new workbook stays collapsed
        act(() => nameButton('Client').click());
        await waitForRender(() => expect(app.location.pathname).toBe(workbookPath(CLIENT_WORKBOOK)));
        render(CLIENT_WORKBOOK);
        await vi.waitFor(() => expect(rows()).not.toContain('1:daily'));

        act(() => nameButton('Client').click());
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '2:orders', '0:Root']);

        // A selection from outside the sidebar collapses the workbook too
        render(ACME_WORKBOOK);
        await vi.waitFor(() => expect(rows()).not.toContain('2:orders'));
    });

    it('renames a script of an expanded workbook', async () => {
        addScripts(CLIENT_WORKBOOK, ['orders', 'revenue']);
        render(CLIENT_WORKBOOK);
        act(() => workbookRow('Client').querySelector<HTMLButtonElement>(':scope > button')!.click());
        const scriptRow = (name: string) => Array.from(container().querySelectorAll<HTMLElement>('[data-testid="workbook-script-row"]'))
            .find(row => rowLabel(row) === name || row.querySelector('input')?.value === name)!;
        const scripts = () => workbooks().get(CLIENT_WORKBOOK)!.scriptOrder;

        // A double-click on the name edits it, the input shows the name without the extension
        act(() => scriptRow('revenue').querySelector<HTMLButtonElement>(':scope > button')!
            .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        const input = container().querySelector<HTMLInputElement>('input[aria-label="Script name"]')!;
        expect(input.value).toBe('revenue');
        await act(async () => {
            input.value = 'income';
            leaveInput(input);
        });
        await vi.waitFor(() => expect(scripts()).toEqual(['orders.sql', 'income.sql']));
        expect(container().querySelector('input[aria-label="Script name"]')).toBeNull();

        // The rename action of the menu edits the name too, an unchanged name renames nothing
        act(() => scriptRow('orders').querySelector<HTMLButtonElement>('[data-testid="script-row-menu"]')!.click());
        await act(async () => {
            document.querySelector<HTMLElement>('[data-testid="script-menu-item"][data-action="rename"]')!.click();
        });
        const menuInput = container().querySelector<HTMLInputElement>('input[aria-label="Script name"]')!;
        expect(menuInput.value).toBe('orders');
        const unchanged = workbooks().get(CLIENT_WORKBOOK);
        await act(async () => {
            leaveInput(menuInput);
        });
        expect(workbooks().get(CLIENT_WORKBOOK)).toBe(unchanged);
        expect(container().querySelector('input[aria-label="Script name"]')).toBeNull();
    });

    it('creates a workbook in a folder', async () => {
        render();
        await folderMenu('acme', 'new-workbook');
        const created = [...workbooks().values()].find(workbook => ![ROOT_WORKBOOK, CLIENT_WORKBOOK, ACME_WORKBOOK].includes(workbook.workbookId))!;
        expect(created).toBeDefined();
        await waitForRender(() => expect(app.location.pathname).toBe(workbookPath(created.workbookId)));
        await vi.waitFor(() => expect(registry.tree.folders[0].folders[0].workbooks.map(entry => entry.path)).toEqual([ACME_WORKBOOK, created.workbookId]));
        await vi.waitFor(() => expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', `2:${created.name}`, '1:Client', '0:Root']));
    });

    describe('the ephemeral workbook', () => {
        const GREETER_WORKBOOK = '00000000-0000-4000-8000-00000000000e';

        function addEphemeralWorkbook(workbookId: string): void {
            addWorkbook(workbookId, EPHEMERAL_WORKBOOK_NAME, true);
        }
        function ephemeralRow(): HTMLElement | null {
            return container().querySelector('[data-testid="workbook-ephemeral-row"]');
        }
        function workbookCount(): string | null | undefined {
            return container().querySelector('[data-testid="local-workbook-count"]')?.textContent;
        }
        /// The workbook that the greeter shows
        function greeterWorkbookId(): string | undefined {
            return app.location.pathname === '/' ? (app.location.state as { workbookId?: string } | null)?.workbookId : undefined;
        }
        async function registerInTree(workbookId: string, atStartOfRootWorkbooks: boolean = false): Promise<void> {
            await registry.upsertWorkbookEntry({ path: workbookId });
            if (atStartOfRootWorkbooks) await registry.moveWorkbook(workbookId, [], 0);
            await act(async () => { await backend.initialize(); });
        }

        it('shows the row at the end of the list, without a menu and outside the count', async () => {
            await registerInTree(GREETER_WORKBOOK, true);
            addEphemeralWorkbook(GREETER_WORKBOOK);
            render(GREETER_WORKBOOK);
            expect(rows()).toEqual(TREE);
            const row = ephemeralRow()!;
            // The last workbook, the same row as the others directly below them
            const workbookRows = Array.from(row.parentElement!.children).filter(child => child.getAttribute('data-testid') !== 'workbook-top-level-drop');
            expect(workbookRows[workbookRows.length - 1]).toBe(row);
            expect(row.previousElementSibling).toBe(workbookRow('Root'));
            expect(row.style.paddingLeft).toBe(workbookRow('Root').style.paddingLeft);
            expect(row.querySelector('button')!.className).toBe(workbookRow('Root').querySelector(':scope > button')!.className);
            expect(row.textContent).toBe(EPHEMERAL_WORKBOOK_NAME);
            expect(row.querySelector('[data-testid="workbook-row-menu"]')).toBeNull();
            expect(workbookCount()).toBe('3');
            expect(row.querySelector('button')!.getAttribute('aria-current')).toBe('page');

            render(ROOT_WORKBOOK);
            expect(ephemeralRow()!.querySelector('button')!.getAttribute('aria-current')).toBeNull();
            act(() => ephemeralRow()!.querySelector('button')!.click());
            await waitForRender(() => expect(greeterWorkbookId()).toBe(GREETER_WORKBOOK));
        });

        it('disables the create button while the ephemeral workbook is selected', async () => {
            addEphemeralWorkbook(GREETER_WORKBOOK);
            const createButton = () => container().querySelector<HTMLButtonElement>('[data-testid="create-workbook"]')!;
            render(GREETER_WORKBOOK);
            expect(createButton().disabled).toBe(true);

            render(ROOT_WORKBOOK);
            expect(createButton().disabled).toBe(false);
            act(() => createButton().click());
            await waitForRender(() => expect(greeterWorkbookId()).toBe(GREETER_WORKBOOK));
        });

        it('opens the greeter when the last workbook is deleted', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            act(() => {
                app.runtime.deleteWorkbook(CLIENT_WORKBOOK);
                app.runtime.deleteWorkbook(ACME_WORKBOOK);
                app.runtime.flush();
            });
            addEphemeralWorkbook(GREETER_WORKBOOK);
            render();
            act(() => (workbookRow('Root').querySelector('[data-testid="workbook-row-menu"]') as HTMLButtonElement).click());
            await act(async () => {
                (document.querySelector('[data-testid="workbook-menu-item"][data-action="delete"]') as HTMLElement).click();
            });
            await vi.waitFor(() => expect(greeterWorkbookId()).toBe(GREETER_WORKBOOK));
            expect(workbooks().has(ROOT_WORKBOOK)).toBe(false);
        });

        it('moves a promoted workbook to the end of the root and asks for the next ephemeral workbook', async () => {
            await registerInTree(GREETER_WORKBOOK, true);
            addEphemeralWorkbook(GREETER_WORKBOOK);
            render(GREETER_WORKBOOK);
            expect(rows()).toEqual(TREE);

            // The first script promotes the workbook, the app creates the next ephemeral workbook
            addScripts(GREETER_WORKBOOK, ['1']);
            const promoted = workbooks().get(GREETER_WORKBOOK)!;
            expect(promoted.ephemeral).toBe(false);
            await vi.waitFor(() => expect([...workbooks().values()].some(workbook => workbook.ephemeral)).toBe(true));
            const next = [...workbooks().values()].find(workbook => workbook.ephemeral)!;
            expect(next.workbookId).not.toBe(GREETER_WORKBOOK);
            // The next ephemeral workbook is stored at the end of the root too
            await vi.waitFor(() => expect(registry.tree.workbooks.map(entry => entry.path).filter(path => path !== next.workbookId))
                .toEqual([ROOT_WORKBOOK, GREETER_WORKBOOK]));
            await vi.waitFor(() => expect(rows()).toEqual([...TREE, `0:${promoted.name}`]));
            expect(ephemeralRow()).not.toBeNull();
        });
    });

    it('creates a folder and edits its name', async () => {
        render();
        await act(async () => {
            (container().querySelector('[data-testid="create-folder"]') as HTMLButtonElement).click();
        });
        await vi.waitFor(() => expect(registry.tree.folders.map(folder => folder.name)).toEqual(['clients', 'New folder']));
        await vi.waitFor(() => expect(container().querySelector('input[aria-label="Folder name"]')).not.toBeNull());
        const input = container().querySelector<HTMLInputElement>('input[aria-label="Folder name"]')!;
        expect(input.value).toBe('New folder');
        await act(async () => {
            input.value = 'reports';
            leaveInput(input);
        });
        await vi.waitFor(() => expect(registry.tree.folders.map(folder => folder.name)).toEqual(['clients', 'reports']));
        await vi.waitFor(() => expect(rows()).toContain('0:reports'));
    });

    it('follows the changes of the workbook tree that another sidebar writes', async () => {
        render();
        // The sidebar of the drawer creates a folder and moves a workbook into it
        await act(async () => {
            await backend.createFolder(['New folder']);
            await backend.moveWorkbook(ROOT_WORKBOOK, ['New folder'], 0);
        });
        expect(rows()).toEqual(['0:clients', '1:acme', '2:Acme report', '1:Client', '0:New folder', '1:Root']);

        // A new folder takes a name that the stored tree leaves free
        await act(async () => {
            (container().querySelector('[data-testid="create-folder"]') as HTMLButtonElement).click();
        });
        await vi.waitFor(() => expect(registry.tree.folders.map(folder => folder.name)).toEqual(['clients', 'New folder', 'New folder 2']));
    });

    it('moves the workbooks of a deleted folder to its parent', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render();
        await folderMenu('clients', 'delete');
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('"clients"'));
        await vi.waitFor(() => expect(rows()).toEqual(['0:Root', '0:Acme report', '0:Client']));
        expect(registry.tree.folders).toEqual([]);
    });

    it('lists the actions of a workbook in order, without moving a workbook of a folder to the top level', () => {
        render();
        act(() => (workbookRow('Client').querySelector('[data-testid="workbook-row-menu"]') as HTMLButtonElement).click());
        const actions = Array.from(document.querySelectorAll('[data-testid="workbook-menu-item"]')).map(item => item.getAttribute('data-action'));
        expect(actions).toEqual(['storage', 'rename', 'duplicate', 'share-url', 'export', 'delete']);
    });
});
