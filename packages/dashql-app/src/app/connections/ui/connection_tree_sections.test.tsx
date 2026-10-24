import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, type ConnectionState } from '../connection_state.js';
import { CONNECTOR_INFOS, ConnectorType, HYPER_CONNECTOR, TRINO_CONNECTOR } from '../connector_info.js';
import { ConnectionTree } from './connection_tree.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

/// A catalog with a single database
const catalog = {
    createSnapshot: () => ({
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
        connectorInfo: CONNECTOR_INFOS[connector],
        details: connector === ConnectorType.HYPER
            ? { type: HYPER_CONNECTOR, value: { proto: { setupParams: { protocol: 'V3_HTTP' } } } }
            : { type: TRINO_CONNECTOR, value: { proto: { setupParams: {} } } },
        catalog,
        catalogUpdates: { currentFullRefresh: null, tasksRunning: new Map() },
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
});
