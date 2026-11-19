import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionTree } from './connection_tree.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

/// A catalog with a single database
const catalog = {
    flatten: () => ({
        read: () => ({
            readName: () => 'hyper',
            catalogReader: {
                databasesLength: () => 1,
                schemasLength: () => 0,
                databases: () => ({ nameId: () => 0, childBegin: () => 0, childCount: () => 0 }),
            },
        }),
    }),
};

function connection(connectionId: string, connector: ConnectorType.HYPER | ConnectorType.TRINO): ConnectionState {
    return {
        connectionId,
        connectionHealth: ConnectionHealth.ONLINE,
        connectorType: connector,
        label: connector === ConnectorType.HYPER
            ? { name: 'Hyper', connector: 'Hyper', detail: 'Http', text: 'Hyper Http' }
            : { name: 'Trino', connector: 'Trino', detail: 'Http', text: 'Trino Http' },
        supportsOverview: connector === ConnectorType.HYPER,
        details: connector === ConnectorType.HYPER
            ? { setupParams: { protocol: 'V3_HTTP' }, channel: null, connector: { kind: 'hyper' } }
            : { setupParams: {}, channel: null, connector: { kind: 'trino' } },
        catalogUpdates: { currentFullRefresh: null, tasksRunning: [], refreshRunning: false, outOfDate: false },
        canRefresh: true,
    } as unknown as ConnectionState;
}

describe('ConnectionTree sections', () => {
    let container: HTMLDivElement;
    let root: Root;
    const hyper = connection('hyper-1', ConnectorType.HYPER);
    const trino = connection('trino-1', ConnectorType.TRINO);

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render(props: Partial<React.ComponentProps<typeof ConnectionTree>> = {}): void {
        act(() => root.render(
            <ConnectionTree
                databases={[hyper, trino]}
                catalogOf={() => catalog as never}
                onOpenSettings={vi.fn()}
                initiallyExpanded={() => true}
                {...props}
            />,
        ));
    }

    function query(connectionId: string, testId: string): HTMLButtonElement | null {
        return container.querySelector(`[data-connection-id="${connectionId}"] [data-testid="${testId}"]`);
    }

    it('offers an overview for Hyper connections only and refreshes the catalog from the catalog row', () => {
        const onOpenOverview = vi.fn();
        render({ onOpenOverview });

        expect(query('hyper-1', 'connection-overview')).not.toBeNull();
        expect(query('trino-1', 'connection-overview')).toBeNull();
        expect(query('hyper-1', 'connection-catalog-toggle')).not.toBeNull();
        expect(query('trino-1', 'connection-catalog-toggle')).not.toBeNull();

        // The refresh button moved from the connection row to the catalog row
        const refresh = query('hyper-1', 'connection-refresh')!;
        expect(refresh.closest('[data-connection-id]')!.querySelector('[data-testid="connection-catalog-toggle"]')).not.toBeNull();

        act(() => query('hyper-1', 'connection-overview')!.click());
        expect(onOpenOverview).toHaveBeenCalledWith('hyper-1');
    });

    it('marks the open overview and hides overviews without a handler', () => {
        render({ onOpenOverview: vi.fn(), openOverviewId: 'hyper-1' });
        expect(query('hyper-1', 'connection-overview')!.getAttribute('aria-current')).toBe('page');

        render();
        expect(query('hyper-1', 'connection-overview')).toBeNull();
    });

    it('collapses the catalog tree below the catalog row', () => {
        render();
        const catalogNodes = () => container.querySelectorAll('[data-testid="catalog-node"]').length;
        expect(catalogNodes()).toBe(2);

        const catalogToggle = () => query('hyper-1', 'connection-catalog-toggle');
        act(() => catalogToggle()!.click());
        expect(catalogNodes()).toBe(1);
        expect(catalogToggle()!.getAttribute('aria-expanded')).toBe('false');

        act(() => query('hyper-1', 'connection-toggle')!.click());
        expect(catalogToggle()).toBeNull();
    });

    describe('renaming', () => {
        const nameInput = () => container.querySelector<HTMLInputElement>('input[aria-label="Connection name"]');

        function doubleClickName(connectionId: string): void {
            act(() => query(connectionId, 'connection-toggle')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        }

        function pressKey(input: HTMLInputElement, key: string): void {
            act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
        }

        it('renames a connection after double-clicking its name', () => {
            const onRename = vi.fn();
            render({ onRename });
            doubleClickName('hyper-1');

            const input = nameInput()!;
            expect(document.activeElement).toBe(input);
            expect(input.placeholder).toBe('Hyper');
            input.value = 'Production';
            pressKey(input, 'Enter');

            expect(onRename).toHaveBeenCalledWith('hyper-1', 'Production');
            expect(nameInput()).toBeNull();
        });

        it('abandons the rename with Escape', () => {
            const onRename = vi.fn();
            render({ onRename });
            doubleClickName('trino-1');

            const input = nameInput()!;
            input.value = 'Production';
            pressKey(input, 'Escape');

            expect(onRename).not.toHaveBeenCalled();
            expect(nameInput()).toBeNull();
        });

        it('renames a connection from the row menu', () => {
            const onRename = vi.fn();
            render({ onRename });
            act(() => query('hyper-1', 'connection-row-menu')!.click());
            act(() => document.querySelector<HTMLElement>('[data-testid="connection-menu-item"][data-action="rename"]')!.click());

            // Closing the menu must not take the focus from the input
            expect(nameInput()).not.toBeNull();
            expect(document.activeElement).toBe(nameInput());
        });

        it('offers no rename without a handler', () => {
            render();
            doubleClickName('hyper-1');

            expect(nameInput()).toBeNull();
        });
    });

    describe('cloud connection', () => {
        const cloud = { ...connection('hyper-cloud', ConnectorType.HYPER), params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://localhost:7484' } }, cloudCapable: true } as unknown as ConnectionState;
        const rowIds = () => [...container.querySelectorAll('[data-testid="connection-toggle"]')]
            .map(row => row.closest('[data-connection-id]')!.getAttribute('data-connection-id'));
        const menuItem = () => document.querySelector<HTMLElement>('[data-testid="connection-menu-item"][data-action="cloud"]');

        it('lists the clouds first with a badge', () => {
            render({ databases: [hyper, trino, cloud], cloudConnectionIds: ['hyper-cloud'] });
            expect(rowIds()).toEqual(['hyper-cloud', 'hyper-1', 'trino-1']);
            expect(query('hyper-cloud', 'connection-cloud-badge')).not.toBeNull();
            expect(query('hyper-1', 'connection-cloud-badge')).toBeNull();
        });

        it('uses a connection that can be one as cloud connection from the row menu', () => {
            const onSetCloud = vi.fn();
            render({ databases: [hyper, trino, cloud], onSetCloud });
            act(() => query('hyper-cloud', 'connection-row-menu')!.click());
            expect(menuItem()!.textContent).toBe('Use as Cloud');
            act(() => menuItem()!.click());
            expect(onSetCloud).toHaveBeenCalledWith('hyper-cloud', true);

            // Trino doesn't write, it can't be the cloud connection
            act(() => query('trino-1', 'connection-row-menu')!.click());
            expect(menuItem()).toBeNull();
        });

        it('stops using the cloud connection from the row menu', () => {
            const onSetCloud = vi.fn();
            render({ databases: [hyper, trino, cloud], cloudConnectionIds: ['hyper-cloud'], onSetCloud });
            act(() => query('hyper-cloud', 'connection-row-menu')!.click());
            expect(menuItem()!.textContent).toBe('Stop Using as Cloud');
            act(() => menuItem()!.click());
            expect(onSetCloud).toHaveBeenCalledWith('hyper-cloud', false);
        });
    });
});
