import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { WorkbookSetupStatus } from '../../app/loading/workbook_setup_status.js';
import { SELECT_WORKBOOK } from '../../app/router.js';
import { WorkbookWorkbenchSidebar, type WorkbookWorkbenchSidebarDependencies } from './workbook_workbench_sidebar.js';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { RuntimeContextProvider } from '@akohn/dashql-react/hooks';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const state = {
    navigate: vi.fn(),
    dispatchDatabase: vi.fn(),
    createWorkbook: vi.fn(),
    openGreeter: vi.fn(),
    ensureEphemeralWorkbook: vi.fn(),
    modifyWorkbookScripts: vi.fn(),
    refreshCatalog: vi.fn(),
    newConnectionFromParams: vi.fn(),
    deleteWorkbook: vi.fn(),
    allocateConnection: vi.fn(),
    resolveNewWorkbookConnection: vi.fn(),
    detachConnection: vi.fn<() => Promise<void>>(),
    deleteConnection: vi.fn<() => Promise<void>>(),
    local: null as ConnectionState | null,
    overlayProps: null as { connectionId: string | null; headerTitle?: string; isOpen: boolean; onClose: () => void; onConnected?: (database: ConnectionState) => void } | null,
    shareProps: null as { isOpen: boolean; workbookId?: string } | null,
    fileSaveProps: null as { isOpen: boolean; workbookScripts?: { workbookId: string }; fileName?: string } | null,
    connections: new Map<string, ConnectionState>(),
    attachedDatabasesByWorkbook: new Map<string, { mainDatabaseId: string; attachedDatabaseIds: string[] }>(),
    workbookScriptsMap: new Map<string, unknown>(),
    workbookAttachedDatabases: null as { main: ConnectionState; attached: ConnectionState[] } | null,
};

/// The connections that the workbooks of the fake scripts registry use
const references = {
    connectionsOf: (workbookId: string) => {
        const mapping = state.attachedDatabasesByWorkbook.get(workbookId);
        return mapping == null || !state.workbookScriptsMap.has(workbookId) ? [] : [mapping.mainDatabaseId, ...mapping.attachedDatabaseIds];
    },
    workbooksOf: (connectionId: string) => [...state.attachedDatabasesByWorkbook.keys()]
        .filter(workbookId => references.connectionsOf(workbookId).includes(connectionId)),
    subscribe: () => () => { },
};

/// The connection ids of the fake registry by connector type
function connectionsByType(): string[][] {
    const byType: string[][] = [[], [], []];
    for (const database of state.connections.values()) (byType[database.connectorType ?? 0] ??= []).push(database.connectionId);
    return byType;
}

/// The views of the fake connections, with the workbooks that use them
function connectionViews(): Map<string, ConnectionState> {
    return new Map([...state.connections].map(([connectionId, connection]) =>
        [connectionId, { ...connection, workbooks: references.workbooksOf(connectionId) } as ConnectionState]));
}

/// The list of the fake connections: connections that workbooks use are listed, as are active ones, and the listed
/// connections of a connector are numbered and labeled so when there are several
function connectionList() {
    const entries = [...state.connections.values()].map(connection => ({
        connectionId: connection.connectionId,
        connectorType: connection.connectorType,
        active: connection.active ?? false,
        listed: references.workbooksOf(connection.connectionId).length > 0 || (connection.active ?? false),
        ordinal: null as number | null,
        label: { name: 'Connection', connector: '', detail: '', text: 'Connection' },
    }));
    for (const ids of connectionsByType()) {
        const listed = entries.filter(entry => ids.includes(entry.connectionId) && entry.listed);
        if (listed.length > 1) listed.forEach((entry, index) => { entry.ordinal = index + 1; });
    }
    for (const entry of entries) {
        const connector = CONNECTOR_INFOS[entry.connectorType as ConnectorType].names.displayLong;
        const name = entry.ordinal == null ? connector : `${connector} #${entry.ordinal}`;
        entry.label = { name, connector, detail: '', text: name };
    }
    return { connections: entries, connectionsByType: connectionsByType() };
}

/// The views of the fake workbooks, with the connections they use
function workbookViews(): Map<string, unknown> {
    return new Map([...state.workbookScriptsMap].map(([workbookId, workbook]) =>
        [workbookId, { ...(workbook as object), connectionIds: references.connectionsOf(workbookId) }]));
}

/// Stable like the storage contexts
const storageReader = {
    backend: {},
    getWorkbookLocation: () => ({ type: 'opfs' }),
    getWorkbookOrder: () => [],
    getWorkbookTree: () => ({ name: '', path: [], folders: [], workbooks: [] }),
};
const storageWriter = {
    deleteWorkbook: state.deleteWorkbook,
    backend: {},
    isWorkbookHeld: () => false,
};

/// The runtime as the sidebar uses it: the storage writer, the actions of the connections and the creation of one
const runtime = {
    storage: storageWriter,
    dispatch: (target: { connection?: string }, action: unknown) => state.dispatchDatabase(target.connection, action),
    createConnection: (...args: unknown[]) => state.allocateConnection(...args),
    store: { get: () => null },
    // The params of a new connection come from the core
    core: { defaultConnectionParams: () => ({ trino: { endpoint: '' } }), connectionParamsShareEqual: () => false },
};

const dependencies = {
    useRouterNavigate: () => state.navigate,
    useRouteContext: () => ({ workbookId: 'current-workbook', workbookSetupStatus: WorkbookSetupStatus.NONE }),
    useRuntime: () => runtime,
    useDispatch: () => state.modifyWorkbookScripts,
    useConnections: connectionViews,
    useConnectionList: connectionList,
    useConnectionViews: () => state.workbookAttachedDatabases == null ? null
        : [state.workbookAttachedDatabases.main, ...state.workbookAttachedDatabases.attached],
    ConnectionSettingsOverlay: (props: typeof state.overlayProps) => {
        state.overlayProps = props;
        return props?.isOpen ? <button onClick={() => props.onConnected?.(state.local!)}>Complete setup</button> : null;
    },
    useDeleteWorkbook: () => vi.fn(),
    useWorkbooks: workbookViews,
    useWorkbookCreation: () => state.createWorkbook,
    useOpenGreeter: () => state.openGreeter,
    useEnsureEphemeralWorkbook: () => state.ensureEphemeralWorkbook,
    useMergeConnections: () => async () => {},
    useReplaceConnection: () => async () => ({ removed: false }),
    useDetachConnection: () => state.detachConnection,
    useDeleteConnection: () => state.deleteConnection,
    useStorageReader: () => storageReader,
    WorkbookStorageOverlay: () => null,
    WorkbookURLShareOverlay: (props: typeof state.shareProps) => {
        state.shareProps = props;
        return props?.isOpen ? <div data-testid="share-url-overlay" /> : null;
    },
    WorkbookFileSaveOverlay: (props: typeof state.fileSaveProps) => {
        state.fileSaveProps = props;
        return props?.isOpen ? <div data-testid="file-save-overlay" /> : null;
    },
    useWorkbookImport: () => ({}),
    useInvalidWorkbooks: () => ({ invalidWorkbooks: new Map(), deleteInvalidWorkbook: vi.fn() }),
    useDashQLCoreSetup: () => vi.fn(),
    usePlatformType: () => 0,
    useLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
    useNewWorkbookConnection: () => state.resolveNewWorkbookConnection,
    newConnectionFromParams: (...args: unknown[]) => state.newConnectionFromParams(...args),
    useClouds: () => ({ clouds: [], openSetup: vi.fn(), setupRequest: null }),
    CloudsFolder: () => null,
} as unknown as WorkbookWorkbenchSidebarDependencies;

/// The scripts run on the catalogs of the connections, a runtime of the module that has one for every connection
const CATALOGS = { catalog: () => EMPTY_CATALOG.catalog } as unknown as Runtime;
function WithCatalogs(props: { children: React.ReactNode }) {
    return <RuntimeContextProvider value={CATALOGS}>{props.children}</RuntimeContextProvider>;
}

/// The catalog of a connection without relations
const EMPTY_CATALOG = {
    catalog: {
        flatten: () => ({
            read: () => ({ catalogReader: { databasesLength: () => 0 } }),
        }),
    },
    catalogUpdates: { currentFullRefresh: null, tasksRunning: [], refreshRunning: false, outOfDate: false },
};

describe('WorkbookWorkbenchSidebar workbook creation', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        // The sections split the height of the sidebar, the virtualized connection rows need room
        container.style.height = '800px';
        document.body.appendChild(container);
        root = createRoot(container);
        state.navigate.mockReset();
        state.modifyWorkbookScripts.mockReset();
        state.dispatchDatabase.mockReset();
        state.createWorkbook.mockReset().mockReturnValue({ workbookId: '00000000-0000-4000-8000-000000000001' });
        state.openGreeter.mockReset();
        state.ensureEphemeralWorkbook.mockReset();
        state.refreshCatalog.mockReset();
        state.newConnectionFromParams.mockReset().mockReturnValue({ type: 'remote' });
        state.deleteWorkbook.mockReset();
        state.overlayProps = null;
        state.shareProps = null;
        state.fileSaveProps = null;
        state.connections.clear();
        state.attachedDatabasesByWorkbook.clear();
        state.workbookScriptsMap.clear();
        state.workbookAttachedDatabases = null;
        state.local = { connectionId: 'local-database' } as unknown as ConnectionState;
        state.local = {
            connectionId: 'local-database',
            connectorType: ConnectorType.HYPER,
            label: { name: 'Hyper', connector: 'Hyper', detail: 'Wasm', text: 'Hyper Wasm' },
            embedded: true,
            details: { setupParams: { protocol: 'WASM' }, channel: null, connector: { kind: 'hyper' } },
            params: { hyper: { protocol: 'WASM' } },
            queriesActiveOrdered: [],
            ...EMPTY_CATALOG,
        } as unknown as ConnectionState;
        state.allocateConnection.mockReset().mockReturnValue(state.local);
        state.resolveNewWorkbookConnection.mockReset().mockReturnValue(state.local);
        state.detachConnection.mockReset().mockResolvedValue();
        state.deleteConnection.mockReset().mockResolvedValue();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId: 'current-workbook',
            instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        act(() => root.unmount());
        container.remove();
    });

    function byTestId(testId: string): HTMLElement | null {
        return document.querySelector(`[data-testid="${testId}"]`);
    }

    function click(testId: string): void {
        act(() => {
            (byTestId(testId) as HTMLButtonElement).click();
        });
    }

    function groups(): (string | null)[] {
        return Array.from(container.querySelectorAll('[data-testid="connection-group"]')).map(group => group.getAttribute('data-group'));
    }

    it('shows workbook and connection counts', () => {
        const main = {
            ...state.local!,
            connectorType: ConnectorType.HYPER,
            catalog: {
                flatten: () => ({
                    read: () => ({ catalogReader: { databasesLength: () => 0 } }),
                }),
            },
            catalogUpdates: { currentFullRefresh: null, tasksRunning: [], refreshRunning: false, outOfDate: false },
        } as unknown as ConnectionState;
        const attached = { ...main, connectionId: 'attached-database' };
        state.connections.set(main.connectionId, main);
        state.connections.set(attached.connectionId, attached);
        state.attachedDatabasesByWorkbook.set('current-workbook', {
            mainDatabaseId: main.connectionId,
            attachedDatabaseIds: [attached.connectionId],
        });
        state.workbookScriptsMap.set('current-workbook', {
            workbookId: 'current-workbook',
            name: 'Current workbook',
            workbookMetadata: {},
            scriptConnections: [],
        });
        state.workbookAttachedDatabases = { main, attached: [attached] };

        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId: 'current-workbook',
            instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));

        expect(byTestId('workbook-count')?.textContent).toBe('1');
        expect(byTestId('connection-count')?.textContent).toBe('2');
    });

    it('keeps ordinary settings open for an online database without a completion callback', () => {
        const main = {
            ...state.local!,
            connectionHealth: ConnectionHealth.ONLINE,
            connectorType: ConnectorType.HYPER,
            catalog: { flatten: () => ({
                read: () => ({ catalogReader: { databasesLength: () => 0 } }),
            }) },
            catalogUpdates: { currentFullRefresh: null, tasksRunning: [], refreshRunning: false, outOfDate: false },
        } as unknown as ConnectionState;
        state.workbookAttachedDatabases = { main, attached: [] };
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId: 'current-workbook', instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));
        click('connection-row-menu');
        act(() => {
            (document.querySelector('[data-testid="connection-menu-item"][data-action="settings"]') as HTMLButtonElement).click();
        });
        expect(state.overlayProps).toMatchObject({ connectionId: main.connectionId, isOpen: true });
        expect(state.overlayProps?.onConnected).toBeUndefined();
        act(() => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Complete setup')!.click();
        });
        expect(state.overlayProps?.isOpen).toBe(true);
        expect(state.navigate).not.toHaveBeenCalled();
    });

    it('opens the greeter instead of creating a workbook', () => {
        click('create-workbook');
        expect(state.openGreeter).toHaveBeenCalledTimes(1);
        expect(state.createWorkbook).not.toHaveBeenCalled();
        expect(state.allocateConnection).not.toHaveBeenCalled();
        expect(state.newConnectionFromParams).not.toHaveBeenCalled();
        expect(state.overlayProps?.isOpen).toBe(false);
    });

    it('creates a connection that the next script of the current workbook runs on', () => {
        const trino = { ...state.local!, connectionId: 'trino-database', connectorType: ConnectorType.TRINO, embedded: false,
            details: { setupParams: {}, channel: null, connector: { kind: 'trino' } }, params: { trino: {} } } as unknown as ConnectionState;
        state.allocateConnection.mockReturnValue(trino);
        act(() => (container.querySelector('[aria-label="Create connection"]') as HTMLButtonElement).click());
        act(() => {
            Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Connection connector"] button'))
                .find(item => item.textContent === CONNECTOR_INFOS[ConnectorType.TRINO].names.displayShort)!
                .click();
        });
        // The Rust connection of the state is created active, a spread over the state would be lost with its next action
        expect(state.newConnectionFromParams).toHaveBeenCalledWith(expect.anything(), { active: true });
        expect(state.allocateConnection).toHaveBeenCalledWith(state.newConnectionFromParams.mock.results[0].value);
        expect(state.modifyWorkbookScripts).toHaveBeenCalledWith({
            kind: 'setPendingConnection',
            value: { connectionId: trino.connectionId },
        });
        expect(state.overlayProps).toMatchObject({ connectionId: trino.connectionId, isOpen: true });
    });

    it.each([ConnectionHealth.NOT_STARTED, ConnectionHealth.CONNECTING, ConnectionHealth.FAILED, ConnectionHealth.CANCELLED])('selects a disconnected workbook immediately (%s)', async connectionHealth => {
        const database = {
            connectionId: 'salesforce-database',
            connectionHealth,
            connectorType: ConnectorType.SALESFORCE_DATA_CLOUD,
            details: { setupParams: {}, channel: null, connector: { kind: 'salesforce' } },
            ...EMPTY_CATALOG,
        } as unknown as ConnectionState;
        state.connections.set(database.connectionId, database);
        state.attachedDatabasesByWorkbook.set('salesforce-workbook', {
            mainDatabaseId: database.connectionId,
            attachedDatabaseIds: [],
        });
        state.workbookScriptsMap.set('salesforce-workbook', {
            workbookId: 'salesforce-workbook',
            name: 'Salesforce workbook',
            workbookMetadata: {},
            scriptConnections: [],
        });
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId: 'current-workbook',
            instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));

        act(() => {
            Array.from(container.querySelectorAll('button'))
                .find(button => button.textContent?.includes('Salesforce workbook'))!
                .click();
        });

        expect(state.overlayProps?.isOpen).toBe(false);
        expect(state.navigate).toHaveBeenCalledWith({
            type: SELECT_WORKBOOK,
            value: 'salesforce-workbook',
        });
    });

    it('offers URL sharing from the workbook row menu', () => {
        const workbookId = 'current-workbook';
        state.connections.set('local-database', state.local!);
        state.attachedDatabasesByWorkbook.set(workbookId, {
            mainDatabaseId: 'local-database',
            attachedDatabaseIds: [],
        });
        state.workbookScriptsMap.set(workbookId, {
            workbookId,
            name: 'Current workbook',
            workbookMetadata: { originalFileName: 'current' },
            scriptConnections: [],
        });
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId,
            instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));

        click('workbook-row-menu');
        const share = document.querySelector('[data-testid="workbook-menu-item"][data-action="share-url"]') as HTMLButtonElement;
        expect(share).not.toBeNull();

        act(() => share.click());
        expect(state.shareProps).toMatchObject({ isOpen: true, workbookId });
        expect(document.querySelector('[data-testid="share-url-overlay"]')).not.toBeNull();
    });

    it('renames a workbook in place from the workbook row menu', () => {
        const workbookId = 'current-workbook';
        state.connections.set('local-database', state.local!);
        state.attachedDatabasesByWorkbook.set(workbookId, {
            mainDatabaseId: 'local-database',
            attachedDatabaseIds: [],
        });
        state.workbookScriptsMap.set(workbookId, {
            workbookId,
            name: 'Untitled',
            workbookMetadata: { originalFileName: 'current' },
            scriptConnections: [],
        });
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId,
            instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));

        click('workbook-row-menu');
        act(() => (document.querySelector('[data-testid="workbook-menu-item"][data-action="rename"]') as HTMLButtonElement).click());
        const input = container.querySelector('input[aria-label="Workbook name"]') as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe('Untitled');

        // Escape abandons the edit
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(container.querySelector('input[aria-label="Workbook name"]')).toBeNull();
        expect(state.modifyWorkbookScripts).not.toHaveBeenCalled();

        click('workbook-row-menu');
        act(() => (document.querySelector('[data-testid="workbook-menu-item"][data-action="rename"]') as HTMLButtonElement).click());
        const second = container.querySelector('input[aria-label="Workbook name"]') as HTMLInputElement;
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(second, 'Revenue');
            second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(state.modifyWorkbookScripts).toHaveBeenCalledOnce();
        expect(state.modifyWorkbookScripts.mock.calls[0][0]).toMatchObject({ kind: 'renameWorkbook', value: { name: 'Revenue' } });
        expect(container.querySelector('input[aria-label="Workbook name"]')).toBeNull();
    });

    it('does not rename a workbook when double-clicking its name', () => {
        const workbookId = 'current-workbook';
        state.connections.set('local-database', state.local!);
        state.attachedDatabasesByWorkbook.set(workbookId, {
            mainDatabaseId: 'local-database',
            attachedDatabaseIds: [],
        });
        state.workbookScriptsMap.set(workbookId, {
            workbookId,
            name: 'Untitled',
            workbookMetadata: { originalFileName: 'current' },
            scriptConnections: [],
        });
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId,
            instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));

        const name = container.querySelector('[aria-label="Workbooks"] button[aria-current]') as HTMLButtonElement;
        act(() => name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        // Renaming is in the row menu, like the rename of a folder
        expect(container.querySelector('input[aria-label="Workbook name"]')).toBeNull();
    });

    it('does not select the workbook while a connection overview is open', () => {
        const workbookId = 'current-workbook';
        state.connections.set('local-database', state.local!);
        state.attachedDatabasesByWorkbook.set(workbookId, {
            mainDatabaseId: 'local-database',
            attachedDatabaseIds: [],
        });
        state.workbookScriptsMap.set(workbookId, {
            workbookId,
            name: 'Current workbook',
            workbookMetadata: { originalFileName: 'current' },
            scriptConnections: [],
        });
        const render = (openOverviewId: string | null) => act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId,
            instance: {},
        } as any} openOverviewId={openOverviewId} onOpenOverview={() => {}} dependencies={dependencies} /></WithCatalogs>));
        const selected = () => document.querySelectorAll('ul[aria-label="Workbooks"] [aria-current="page"]').length;

        render(null);
        expect(selected()).toBe(1);
        render('local-database');
        expect(selected()).toBe(0);
    });

    it('opens export settings before saving from the workbook row menu', () => {
        const workbookId = 'current-workbook';
        state.connections.set('local-database', state.local!);
        state.attachedDatabasesByWorkbook.set(workbookId, {
            mainDatabaseId: 'local-database',
            attachedDatabaseIds: [],
        });
        state.workbookScriptsMap.set(workbookId, {
            workbookId,
            name: 'Current workbook',
            workbookMetadata: { originalFileName: 'current' },
            scriptConnections: [],
        });
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId,
            instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));

        click('workbook-row-menu');
        const exportItem = document.querySelector('[data-testid="workbook-menu-item"][data-action="export"]') as HTMLButtonElement;
        expect(exportItem).not.toBeNull();

        act(() => exportItem.click());
        expect(state.fileSaveProps).toMatchObject({
            isOpen: true,
            workbookScripts: { workbookId },
            fileName: 'Current workbook',
        });
        expect(document.querySelector('[data-testid="file-save-overlay"]')).not.toBeNull();
    });

    it('lists the connections of other workbooks', () => {
        const other = { ...state.local!, connectionId: 'trino-database', connectorType: ConnectorType.TRINO, embedded: false,
            details: { setupParams: {}, channel: null, connector: { kind: 'trino' } } } as unknown as ConnectionState;
        state.connections.set(state.local!.connectionId, state.local!);
        state.connections.set(other.connectionId, other);
        state.attachedDatabasesByWorkbook.set('current-workbook', { mainDatabaseId: state.local!.connectionId, attachedDatabaseIds: [] });
        state.attachedDatabasesByWorkbook.set('trino-session', { mainDatabaseId: other.connectionId, attachedDatabaseIds: [] });
        state.attachedDatabasesByWorkbook.set('shell', { mainDatabaseId: 'shell', attachedDatabaseIds: [] });
        state.connections.set('shell', { ...other, connectionId: 'shell' } as ConnectionState);
        for (const workbookId of ['current-workbook', 'trino-session']) {
            state.workbookScriptsMap.set(workbookId, { workbookId, name: workbookId, workbookMetadata: {}, scriptConnections: [] });
        }
        state.workbookAttachedDatabases = { main: state.local!, attached: [] };
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId: 'current-workbook', instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));

        // The shell connection is not referenced by a workbook of the registry
        expect(byTestId('connection-count')?.textContent).toBe('2');
    });

    it('groups the connections of the workbook and numbers connections of the same connector', () => {
        const trino = { ...state.local!, connectionId: 'trino-database', connectorType: ConnectorType.TRINO, embedded: false,
            details: { setupParams: {}, channel: null, connector: { kind: 'trino' } } } as unknown as ConnectionState;
        const secondHyper = { ...state.local!, connectionId: 'second-hyper' } as unknown as ConnectionState;
        for (const database of [state.local!, trino, secondHyper]) state.connections.set(database.connectionId, database);
        state.attachedDatabasesByWorkbook.set('current-workbook', { mainDatabaseId: state.local!.connectionId, attachedDatabaseIds: [] });
        state.attachedDatabasesByWorkbook.set('trino-session', { mainDatabaseId: trino.connectionId, attachedDatabaseIds: [secondHyper.connectionId] });
        for (const workbookId of ['current-workbook', 'trino-session']) {
            state.workbookScriptsMap.set(workbookId, { workbookId, name: workbookId, workbookMetadata: {}, scriptConnections: [] });
        }
        state.workbookAttachedDatabases = { main: state.local!, attached: [] };
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId: 'current-workbook', instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));

        expect(groups()).toEqual(['workbook', 'other']);
        const rowLabel = (connectionId: string) => container
            .querySelector(`[data-connection-id="${connectionId}"] [data-testid="connection-toggle"]`)?.textContent;
        expect(rowLabel(state.local!.connectionId)).toContain('Hyper #1');
        expect(rowLabel(secondHyper.connectionId)).toContain('Hyper #2');
    });

    it('groups the active connections that no workbook uses apart', () => {
        const trino = { ...state.local!, connectionId: 'trino-database', connectorType: ConnectorType.TRINO, embedded: false,
            details: { setupParams: {}, channel: null, connector: { kind: 'trino' } } } as unknown as ConnectionState;
        const unused = { ...state.local!, connectionId: 'unused-hyper', active: true } as unknown as ConnectionState;
        for (const database of [state.local!, unused, trino]) state.connections.set(database.connectionId, database);
        state.attachedDatabasesByWorkbook.set('current-workbook', { mainDatabaseId: state.local!.connectionId, attachedDatabaseIds: [] });
        state.attachedDatabasesByWorkbook.set('trino-session', { mainDatabaseId: trino.connectionId, attachedDatabaseIds: [] });
        for (const workbookId of ['current-workbook', 'trino-session']) {
            state.workbookScriptsMap.set(workbookId, { workbookId, name: workbookId, workbookMetadata: {}, scriptConnections: [] });
        }
        state.workbookAttachedDatabases = { main: state.local!, attached: [] };
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId: 'current-workbook', instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));

        // The unused connection is listed after the connections of other workbooks
        expect(groups()).toEqual(['workbook', 'other', 'unused']);
        expect(container.textContent).not.toContain('unused');
    });
    /// A Hyper server that the current workbook attached through the composer, the scripts named here run on it
    function attachServer(scriptConnections: Record<string, string> = {}): ConnectionState {
        const server = {
            ...state.local!,
            connectionId: 'hyper-server',
            embedded: false,
            details: { setupParams: { protocol: 'V3_HTTP' }, channel: null, connector: { kind: 'hyper' } },
            params: { hyper: { protocol: 'V3_HTTP' } },
        } as unknown as ConnectionState;
        for (const database of [state.local!, server]) state.connections.set(database.connectionId, database);
        const usesLocal = Object.values(scriptConnections).includes(state.local!.connectionId);
        state.attachedDatabasesByWorkbook.set('current-workbook', {
            mainDatabaseId: server.connectionId,
            attachedDatabaseIds: usesLocal ? [state.local!.connectionId] : [],
        });
        state.workbookScriptsMap.set('current-workbook', {
            workbookId: 'current-workbook', name: 'Current', workbookMetadata: {}, scriptConnections: Object.values(scriptConnections),
        });
        state.workbookAttachedDatabases = { main: server, attached: usesLocal ? [state.local!] : [] };
        act(() => root.render(<WithCatalogs><WorkbookWorkbenchSidebar workbookScripts={{
            workbookId: 'current-workbook', instance: {},
        } as any} dependencies={dependencies} /></WithCatalogs>));
        return server;
    }

    function menuItem(connectionId: string, action: string): HTMLButtonElement | null {
        act(() => {
            container.querySelector<HTMLButtonElement>(`[data-connection-id="${connectionId}"] [data-testid="connection-row-menu"]`)!.click();
        });
        return document.querySelector(`[data-testid="connection-menu-item"][data-action="${action}"]`);
    }

    it('deletes a connection that workbooks only create new scripts on', async () => {
        const server = attachServer();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const remove = menuItem(server.connectionId, 'delete')!;
        expect(remove.disabled).toBe(false);
        await act(async () => remove.click());
        expect(state.detachConnection).toHaveBeenCalledWith(server.connectionId);
        expect(state.deleteConnection).toHaveBeenCalledWith(server.connectionId);
        expect(state.detachConnection.mock.invocationCallOrder[0]).toBeLessThan(state.deleteConnection.mock.invocationCallOrder[0]);
    });

    it('offers no delete of the embedded Hyper that workbooks fall back to', () => {
        attachServer({ '1_alpha.sql': 'local-database' });
        expect(menuItem(state.local!.connectionId, 'delete')).toBeNull();
    });

    it('refuses to delete a connection that scripts use', () => {
        const server = attachServer({ '1_alpha.sql': 'hyper-server' });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        act(() => menuItem(server.connectionId, 'delete')!.click());
        expect(confirm).not.toHaveBeenCalled();
        expect(state.deleteConnection).not.toHaveBeenCalled();
    });
});
