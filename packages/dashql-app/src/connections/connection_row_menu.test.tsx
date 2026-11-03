import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, type ConnectionState } from './connection_state.js';
import { HYPER_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';

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
        details: { type: connector, value: { proto: { setupParams: {} } } },
        params: connector === TRINO_CONNECTOR ? { trino: { endpoint: 'https://trino.example' } } : { hyper: {} },
        catalogUpdates: {
            currentFullRefresh: null,
            tasksRunning: new Map(),
        },
    } as ConnectionState;
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
