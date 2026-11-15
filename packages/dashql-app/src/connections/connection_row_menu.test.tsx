import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { ConnectorType, HYPER_CONNECTOR, TRINO_CONNECTOR } from '@ankoh/dashql-runtime/connections/connector_info';

const refreshCatalog = vi.fn();

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

import {
    ConnectionRefreshButton,
    ConnectionRowMenu,
    type ConnectionRefreshDependencies,
} from './connection_tree.js';

const dependencies: ConnectionRefreshDependencies = {
    useCatalogLoaderQueue: () => refreshCatalog,
};

function database(connector: symbol = HYPER_CONNECTOR): ConnectionState {
    return {
        connectionId: 'database-1',
        connectionHealth: ConnectionHealth.ONLINE,
        connectorType: connector === TRINO_CONNECTOR ? ConnectorType.TRINO : ConnectorType.HYPER,
        details: { setupParams: {}, channel: null, connector: { kind: connector === TRINO_CONNECTOR ? 'trino' : 'hyper' } },
        params: connector === TRINO_CONNECTOR ? { trino: { endpoint: 'https://trino.example' } } : { hyper: {} },
        catalogUpdates: {
            currentFullRefresh: null,
            tasksRunning: [],
        },
    } as unknown as ConnectionState;
}

describe('ConnectionRowMenu', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        refreshCatalog.mockReset();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function renderMenu(onOpenSettings = vi.fn(), onRename?: () => void, connection = database()) {
        act(() => root.render(
            <ConnectionRowMenu
                database={connection}
                label="Hyper / WASM"
                onOpenSettings={onOpenSettings}
                onRename={onRename}
                dependencies={dependencies}
            />,
        ));
        act(() => {
            (container.querySelector('[data-testid="connection-row-menu"]') as HTMLButtonElement).click();
        });
        return onOpenSettings;
    }

    function clickAction(action: string): void {
        act(() => {
            document.querySelector<HTMLButtonElement>(`[data-testid="connection-menu-item"][data-action="${action}"]`)!.click();
        });
    }

    it('opens connection settings from the intermediary menu', () => {
        const onOpenSettings = renderMenu();
        clickAction('settings');

        expect(onOpenSettings).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
    });

    it('renames the connection from the intermediary menu', () => {
        const onRename = vi.fn();
        renderMenu(vi.fn(), onRename);
        clickAction('rename');

        expect(onRename).toHaveBeenCalledOnce();
    });

    it('offers no rename without a handler', () => {
        renderMenu();

        expect(document.querySelector('[data-testid="connection-menu-item"][data-action="rename"]')).toBeNull();
    });

    it('offers no link to the embedded Hyper', () => {
        renderMenu();

        expect(document.querySelector('[data-testid="connection-menu-item"][data-action="share-url"]')).toBeNull();
    });

    it('opens the link of a connection from the intermediary menu', () => {
        renderMenu(vi.fn(), undefined, database(TRINO_CONNECTOR));
        clickAction('share-url');

        expect(document.querySelector('[data-testid="connection-share-overlay"]')).not.toBeNull();
    });

    it('forces a catalog refresh from the intermediary menu', () => {
        renderMenu();
        clickAction('refresh');

        expect(refreshCatalog).toHaveBeenCalledWith('database-1', true);
    });

    it('also exposes the inline catalog refresh action', () => {
        act(() => root.render(
            <ConnectionRefreshButton database={database()} label="Hyper / WASM" dependencies={dependencies} />,
        ));
        act(() => {
            (container.querySelector('[data-testid="connection-refresh"]') as HTMLButtonElement).click();
        });

        expect(refreshCatalog).toHaveBeenCalledWith('database-1', true);
    });
});
