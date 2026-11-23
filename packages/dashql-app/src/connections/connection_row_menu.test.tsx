import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';

import { ConnectionRefreshButton, ConnectionRowMenu, type ConnectionTreeActions } from './connection_tree.js';
import { testConnectionTreeActions } from './connection_tree_test_actions.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

function database(connectorType: ConnectorType = ConnectorType.HYPER): ConnectionState {
    const trino = connectorType === ConnectorType.TRINO;
    return {
        connectionId: 'database-1',
        connectionHealth: ConnectionHealth.ONLINE,
        connectorType,
        label: trino ? { name: 'Trino', connector: 'Trino', detail: 'Http', text: 'Trino Http' } : { name: 'Hyper', connector: 'Hyper', detail: 'Wasm', text: 'Hyper Wasm' },
        embedded: !trino,
        details: { setupParams: {}, channel: null, connector: { kind: trino ? 'trino' : 'hyper' } },
        params: trino ? { trino: { endpoint: 'https://trino.example' } } : { hyper: {} },
        catalogUpdates: {
            currentFullRefresh: null,
            tasksRunning: [],
            refreshRunning: false,
            outOfDate: false,
        },
        canRefresh: true,
    } as unknown as ConnectionState;
}

describe('ConnectionRowMenu', () => {
    let container: HTMLDivElement;
    let root: Root;
    let actions: ConnectionTreeActions;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        actions = testConnectionTreeActions();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function renderMenu(onRename = vi.fn(), connection = database()) {
        act(() => root.render(
            <ConnectionRowMenu
                database={connection}
                label="Hyper / WASM"
                actions={actions}
                onRename={onRename}
            />,
        ));
        act(() => {
            (container.querySelector('[data-testid="connection-row-menu"]') as HTMLButtonElement).click();
        });
    }

    function clickAction(action: string): void {
        act(() => {
            document.querySelector<HTMLButtonElement>(`[data-testid="connection-menu-item"][data-action="${action}"]`)!.click();
        });
    }

    it('opens connection settings from the intermediary menu', () => {
        renderMenu();
        clickAction('settings');

        expect(actions.openSettings).toHaveBeenCalledWith('database-1', expect.any(HTMLButtonElement));
    });

    it('renames the connection from the intermediary menu', () => {
        const onRename = vi.fn();
        renderMenu(onRename);
        clickAction('rename');

        expect(onRename).toHaveBeenCalledOnce();
    });

    it('offers no link to the embedded Hyper', () => {
        renderMenu();

        expect(document.querySelector('[data-testid="connection-menu-item"][data-action="share-url"]')).toBeNull();
    });

    it('opens the link of a connection from the intermediary menu', () => {
        renderMenu(vi.fn(), database(ConnectorType.TRINO));
        clickAction('share-url');

        expect(document.querySelector('[data-testid="connection-share-overlay"]')).not.toBeNull();
    });

    it('forces a catalog refresh from the intermediary menu', () => {
        renderMenu();
        clickAction('refresh');

        expect(actions.refreshCatalog).toHaveBeenCalledWith('database-1');
    });

    it('offers no delete of the embedded Hyper', () => {
        renderMenu();

        expect(document.querySelector('[data-testid="connection-menu-item"][data-action="delete"]')).toBeNull();
    });

    it('also exposes the inline catalog refresh action', () => {
        const onRefresh = vi.fn();
        act(() => root.render(
            <ConnectionRefreshButton database={database()} label="Hyper / WASM" onRefresh={onRefresh} />,
        ));
        act(() => {
            (container.querySelector('[data-testid="connection-refresh"]') as HTMLButtonElement).click();
        });

        expect(onRefresh).toHaveBeenCalledOnce();
    });
});
