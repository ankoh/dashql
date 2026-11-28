import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkbookConnectionButtons, type WorkbookConnectionButtonsDependencies } from './workbook_connection_buttons.js';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function trino(connectionId: string, health: ConnectionHealth): ConnectionState {
    return {
        connectionId,
        connectionHealth: health,
        connectorType: ConnectorType.TRINO,
        label: { name: 'Trino', connector: 'Trino', detail: 'Http', text: 'Trino Http' },
        params: { trino: { endpoint: 'https://trino.example' } },
        details: { setupParams: { endpoint: 'https://trino.example' }, channel: null, connector: { kind: 'trino' } },
    } as unknown as ConnectionState;
}

describe('WorkbookConnectionButtons', () => {
    let container: HTMLDivElement;
    let root: Root;
    type OverlayProps = React.ComponentProps<WorkbookConnectionButtonsDependencies['ConnectionSettingsOverlay']>;
    let settingsProps: OverlayProps | null;
    const dependencies: WorkbookConnectionButtonsDependencies = {
        ConnectionSettingsOverlay: (props: OverlayProps) => {
            settingsProps = props;
            React.useEffect(() => () => { settingsProps = null; }, []);
            return null;
        },
    };

    beforeEach(() => {
        settingsProps = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('is hidden for a workbook without scripts', () => {
        act(() => root.render(<WorkbookConnectionButtons connections={[]} attention={false} dependencies={dependencies} />));
        expect(container.querySelector('[data-testid="workbook-connections"]')).toBeNull();
    });

    it('shows the health of every connection and opens its settings only when asked', () => {
        const connections = [trino('lake', ConnectionHealth.ONLINE), trino('warehouse', ConnectionHealth.NOT_STARTED)];
        act(() => root.render(<WorkbookConnectionButtons connections={connections} attention={false} dependencies={dependencies} />));
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-connection"]');
        expect([...buttons].map(button => button.dataset.health)).toEqual(['ONLINE', 'NOT_STARTED']);
        expect(buttons[1].getAttribute('aria-label')).toContain('Disconnected');
        // Nothing connects by itself
        expect(settingsProps).toBeNull();
        act(() => buttons[1].click());
        expect(settingsProps!.connectionId).toBe('warehouse');
        act(() => settingsProps!.onClose());
        expect(settingsProps).toBeNull();
    });

    it('draws attention to the connections that are not connected', () => {
        const connections = [trino('lake', ConnectionHealth.ONLINE), trino('warehouse', ConnectionHealth.FAILED)];
        act(() => root.render(<WorkbookConnectionButtons connections={connections} attention dependencies={dependencies} />));
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-connection"]');
        expect([...buttons].map(button => button.hasAttribute('data-attention'))).toEqual([false, true]);
    });
});
