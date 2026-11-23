import { act, waitForRender } from '@akohn/dashql-react/testing/react_act';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';

import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { workbookPath } from '../../app/router.js';
import { addTestConnection } from '../../tests/test_connections.js';
import { SidebarTestApp } from './workbook_sidebar_test_app.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// The workbook that the page shows
const CURRENT_WORKBOOK = '00000000-0000-4000-8000-000000000101';
/// Another workbook
const OTHER_WORKBOOK = '00000000-0000-4000-8000-000000000102';
/// The embedded Hyper, the connection of the current workbook
const LOCAL = 'local-database';
const EMBEDDED = { hyper: { protocol: 'WASM', endpoint: '' } } as ConnectionParams;
const hyperServer = (endpoint: string) => ({ hyper: { protocol: 'V3_HTTP', endpoint } }) as ConnectionParams;
const trino = (endpoint: string) => ({ trino: { endpoint } }) as ConnectionParams;

describe('WorkbookWorkbenchSidebar workbook creation', () => {
    let app: SidebarTestApp;
    const container = () => app.root.container;

    function render(props: Parameters<SidebarTestApp['render']>[1] = {}): void {
        app.render(CURRENT_WORKBOOK, props);
    }

    /// Add a connection to the runtime
    async function addConnection(connectionId: string, params: ConnectionParams, options: { active?: boolean; health?: ConnectionHealth } = {}): Promise<void> {
        await act(async () => { await addTestConnection(app.runtime, { connectionId, params, ...options }); });
    }

    /// Create a workbook on a connection, with a script on each of the other connections
    function addWorkbook(workbookId: string, name: string, connectionId: string, scriptConnectionIds: string[] = []): void {
        act(() => {
            app.runtime.createWorkbook(connectionId, name, false, undefined, workbookId);
            scriptConnectionIds.forEach((scriptConnectionId, i) => {
                app.runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: 'select 1', base: `${i + 1}`, connectionId: scriptConnectionId } });
            });
            app.runtime.flush();
        });
    }

    /// The workbooks of the runtime
    const workbooks = () => app.runtime.store.all('workbook');

    beforeEach(async () => {
        app = new SidebarTestApp(new WorkbookTestBackend());
        // The sections split the height of the sidebar, the virtualized connection rows need room
        container().style.height = '800px';
        app.render(null);
        await addConnection(LOCAL, EMBEDDED);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        app.unmount();
    });

    function byTestId(testId: string): HTMLElement | null {
        return document.querySelector(`[data-testid="${testId}"]`);
    }

    function click(testId: string): void {
        act(() => {
            (byTestId(testId) as HTMLButtonElement).click();
        });
    }

    function connectionRows(): Element[] {
        return Array.from(container().querySelectorAll('[data-testid="connection-toggle"]'));
    }

    function groups(): (string | null)[] {
        return Array.from(container().querySelectorAll('[data-testid="connection-group"]')).map(group => group.getAttribute('data-group'));
    }

    /// The connector of the open connection settings
    function settingsConnector(): string | null | undefined {
        return byTestId('connector-name')?.textContent;
    }

    function menuItem(connectionId: string, action: string): HTMLButtonElement | null {
        act(() => {
            container().querySelector<HTMLButtonElement>(`[data-connection-id="${connectionId}"] [data-testid="connection-row-menu"]`)!.click();
        });
        return document.querySelector(`[data-testid="connection-menu-item"][data-action="${action}"]`);
    }

    it('lists the local workbooks and the connections of the workbook', async () => {
        await addConnection('attached-database', hyperServer('http://attached'));
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL, ['attached-database']);
        render();

        expect(byTestId('local-workbook-count')?.textContent).toBe('1');
        expect(connectionRows()).toHaveLength(2);
    });

    it('keeps the settings of an online connection open', async () => {
        await addConnection('hyper-server', hyperServer('http://server'), { health: ConnectionHealth.ONLINE });
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', 'hyper-server', ['hyper-server']);
        render();
        const location = app.location.key;
        act(() => menuItem('hyper-server', 'settings')!.click());
        expect(settingsConnector()).toBe(CONNECTOR_INFOS[ConnectorType.HYPER].names.displayLong);
        // The sidebar asks for no completion, the settings of a connection that is online already stay open
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
        expect(settingsConnector()).toBe(CONNECTOR_INFOS[ConnectorType.HYPER].names.displayLong);
        expect(app.location.key).toBe(location);
    });

    it('opens the greeter instead of creating a workbook', async () => {
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL);
        render();
        const connectionCount = app.runtime.store.all('connection').size;
        click('create-workbook');
        // The greeter shows the ephemeral workbook at the root
        const ephemeral = [...workbooks().values()].filter(workbook => workbook.ephemeral);
        expect(ephemeral).toHaveLength(1);
        await waitForRender(() => expect((app.location.state as { workbookId?: string } | null)?.workbookId).toBe(ephemeral[0].workbookId));
        expect(app.location.pathname).toBe('/');
        expect([...workbooks().values()].filter(workbook => !workbook.ephemeral)).toHaveLength(1);
        expect(app.runtime.store.all('connection').size).toBe(connectionCount);
        expect(settingsConnector()).toBeUndefined();
    });

    it('creates a connection that the next script of the current workbook runs on', async () => {
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL);
        render();
        act(() => (container().querySelector('[aria-label="Create connection"]') as HTMLButtonElement).click());
        act(() => {
            Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Connection connector"] button'))
                .find(item => item.textContent === CONNECTOR_INFOS[ConnectorType.TRINO].names.displayShort)!
                .click();
        });
        const created = [...app.runtime.store.all('connection').values()].find(connection => connection.connectorType === ConnectorType.TRINO)!;
        // The Rust connection of the state is created active, a spread over the state would be lost with its next action
        expect(created.active).toBe(true);
        await waitForRender(() => expect(workbooks().get(CURRENT_WORKBOOK)!.pendingConnectionId).toBe(created.connectionId));
        expect(settingsConnector()).toBe(CONNECTOR_INFOS[ConnectorType.TRINO].names.displayLong);
    });

    it.each([ConnectionHealth.NOT_STARTED, ConnectionHealth.CONNECTING, ConnectionHealth.FAILED])('selects a disconnected workbook immediately (%s)', async connectionHealth => {
        await addConnection('trino-database', trino('http://trino'), { health: connectionHealth });
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL);
        addWorkbook(OTHER_WORKBOOK, 'Trino workbook', 'trino-database');
        render();

        act(() => {
            Array.from(container().querySelectorAll('button'))
                .find(button => button.textContent?.includes('Trino workbook'))!
                .click();
        });

        expect(settingsConnector()).toBeUndefined();
        await waitForRender(() => expect(app.location.pathname).toBe(workbookPath(OTHER_WORKBOOK)));
    });

    it('offers URL sharing from the workbook row menu', () => {
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL);
        render();

        click('workbook-row-menu');
        const share = document.querySelector('[data-testid="workbook-menu-item"][data-action="share-url"]') as HTMLButtonElement;
        expect(share).not.toBeNull();

        act(() => share.click());
        expect(document.querySelector('input[aria-label="Workbook share URL"]')).not.toBeNull();
    });

    it('renames a workbook in place from the workbook row menu', async () => {
        addWorkbook(CURRENT_WORKBOOK, 'Untitled', LOCAL);
        render();

        click('workbook-row-menu');
        act(() => (document.querySelector('[data-testid="workbook-menu-item"][data-action="rename"]') as HTMLButtonElement).click());
        const input = container().querySelector('input[aria-label="Workbook name"]') as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe('Untitled');

        // Escape abandons the edit
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(container().querySelector('input[aria-label="Workbook name"]')).toBeNull();
        expect(workbooks().get(CURRENT_WORKBOOK)!.name).toBe('Untitled');

        click('workbook-row-menu');
        act(() => (document.querySelector('[data-testid="workbook-menu-item"][data-action="rename"]') as HTMLButtonElement).click());
        const second = container().querySelector('input[aria-label="Workbook name"]') as HTMLInputElement;
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(second, 'Revenue');
            second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await waitForRender(() => expect(workbooks().get(CURRENT_WORKBOOK)!.name).toBe('Revenue'));
        expect(container().querySelector('input[aria-label="Workbook name"]')).toBeNull();
    });

    it('does not rename a workbook when double-clicking its name', () => {
        addWorkbook(CURRENT_WORKBOOK, 'Untitled', LOCAL);
        render();

        const name = container().querySelector('[aria-label="Workbooks"] button[aria-current]') as HTMLButtonElement;
        act(() => name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        // Renaming is in the row menu, like the rename of a folder
        expect(container().querySelector('input[aria-label="Workbook name"]')).toBeNull();
    });

    it('does not select the workbook while a connection overview is open', () => {
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL);
        const selected = () => document.querySelectorAll('ul[aria-label="Workbooks"] [aria-current="page"]').length;

        render({ openOverviewId: null, onOpenOverview: () => {} });
        expect(selected()).toBe(1);
        render({ openOverviewId: LOCAL, onOpenOverview: () => {} });
        expect(selected()).toBe(0);
    });

    it('opens export settings before saving from the workbook row menu', () => {
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL);
        render();

        click('workbook-row-menu');
        const exportItem = document.querySelector('[data-testid="workbook-menu-item"][data-action="export"]') as HTMLButtonElement;
        expect(exportItem).not.toBeNull();

        act(() => exportItem.click());
        expect(document.querySelector('button[aria-label="Save File"]')).not.toBeNull();
    });

    it('lists the connections of other workbooks', async () => {
        await addConnection('trino-database', trino('http://trino'));
        await addConnection('shell', trino('http://shell'));
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL);
        addWorkbook(OTHER_WORKBOOK, 'Trino workbook', 'trino-database');
        render();

        // The shell connection is not used by a workbook
        expect(connectionRows()).toHaveLength(2);
    });

    it('groups the connections of the workbook and numbers connections of the same connector', async () => {
        await addConnection('trino-database', trino('http://trino'));
        await addConnection('second-hyper', hyperServer('http://second'));
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL);
        addWorkbook(OTHER_WORKBOOK, 'Trino workbook', 'trino-database', ['second-hyper']);
        render();

        expect(groups()).toEqual(['workbook', 'other']);
        const rowLabel = (connectionId: string) => container()
            .querySelector(`[data-connection-id="${connectionId}"] [data-testid="connection-toggle"]`)?.textContent;
        expect(rowLabel(LOCAL)).toContain('#1');
        expect(rowLabel('second-hyper')).toContain('#2');
        expect(rowLabel('trino-database')).not.toContain('#');
    });

    it('groups the active connections that no workbook uses apart', async () => {
        await addConnection('trino-database', trino('http://trino'));
        await addConnection('unused-hyper', hyperServer('http://unused'), { active: true });
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL);
        addWorkbook(OTHER_WORKBOOK, 'Trino workbook', 'trino-database');
        render();

        // The unused connection is listed after the connections of other workbooks
        expect(groups()).toEqual(['workbook', 'other', 'unused']);
        expect(container().textContent).not.toContain('unused-hyper');
    });

    /// A Hyper server that the current workbook creates new scripts on, the scripts named here run on it
    async function attachServer(scriptsOnServer: boolean): Promise<void> {
        await addConnection('hyper-server', hyperServer('http://server'));
        addWorkbook(CURRENT_WORKBOOK, 'Current workbook', LOCAL, scriptsOnServer ? ['hyper-server'] : [LOCAL]);
        act(() => {
            app.runtime.dispatch({ workbook: CURRENT_WORKBOOK }, { kind: 'setPendingConnection', value: { connectionId: 'hyper-server' } });
            app.runtime.flush();
        });
        render();
    }

    it('deletes a connection that workbooks only create new scripts on', async () => {
        await attachServer(false);
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const remove = menuItem('hyper-server', 'delete')!;
        expect(remove.disabled).toBe(false);
        await act(async () => remove.click());
        // The workbook lets go of the connection before it is deleted
        await vi.waitFor(() => expect(app.runtime.connection('hyper-server') ?? null).toBeNull());
        expect(workbooks().get(CURRENT_WORKBOOK)!.pendingConnectionId).not.toBe('hyper-server');
    });

    it('offers no delete of the embedded Hyper that workbooks fall back to', async () => {
        await attachServer(false);
        expect(menuItem(LOCAL, 'delete')).toBeNull();
    });

    it('refuses to delete a connection that scripts use', async () => {
        await attachServer(true);
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        act(() => menuItem('hyper-server', 'delete')!.click());
        expect(confirm).not.toHaveBeenCalled();
        expect(app.runtime.connection('hyper-server') ?? null).not.toBeNull();
    });
});
