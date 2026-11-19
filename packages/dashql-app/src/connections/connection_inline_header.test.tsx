import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';

import { LoggerProvider } from '../platform/logger_provider.js';
import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionHealth, ConnectionStatus, connectorInfoOf, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectionInlineHeader } from './connection_inline_header.js';

describe('ConnectionInlineHeader', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('offers selection with an embedded engine label instead of health status', () => {
        const connection = {
            connectorType: ConnectorType.HYPER,
            connectionHealth: ConnectionHealth.NOT_STARTED,
            connectionStatus: ConnectionStatus.NOT_STARTED,
            details: { type: Symbol('test'), value: null },
        } as unknown as ConnectionState;
        const setupConnection = vi.fn();

        act(() => root.render(
            <LoggerProvider>
                <ConnectionInlineHeader
                    connector={connectorInfoOf(connection)}
                    connection={connection}
                    wrongPlatform={false}
                    setupConnection={setupConnection}
                    embedded
                />
            </LoggerProvider>,
        ));

        expect(container.querySelector('[data-testid="embedded-engine-label"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="connection-status"]')).toBeNull();
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="connection-setup"]')!.click());
        expect(setupConnection).toHaveBeenCalledOnce();
    });

    it('keeps connect and health status for remote connectors', () => {
        const connection = {
            connectorType: ConnectorType.TRINO,
            connectionHealth: ConnectionHealth.NOT_STARTED,
            connectionStatus: ConnectionStatus.NOT_STARTED,
            details: { type: Symbol('test'), value: null },
        } as unknown as ConnectionState;

        act(() => root.render(
            <LoggerProvider>
                <ConnectionInlineHeader
                    connector={connectorInfoOf(connection)}
                    connection={connection}
                    wrongPlatform={false}
                    setupConnection={() => {}}
                />
            </LoggerProvider>,
        ));

        expect(container.querySelector('[data-testid="connection-setup"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="connection-status"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="embedded-engine-label"]')).toBeNull();
    });

    it('renders an optional action immediately after the connector name', () => {
        const connector = CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
        act(() => root.render(
            <LoggerProvider>
                <ConnectionInlineHeader
                    connector={connector}
                    connection={null}
                    wrongPlatform={false}
                    setupConnection={() => {}}
                    connectorNameAction={<button type="button" data-testid="history">History</button>}
                />
            </LoggerProvider>,
        ));

        const name = container.querySelector('[data-testid="connector-name"]')!;
        expect(name.nextElementSibling).toBe(container.querySelector('[data-testid="history"]'));
    });

    it.each([
        [ConnectionHealth.NOT_STARTED, false],
        [ConnectionHealth.FAILED, false],
        [ConnectionHealth.CONNECTING, true],
        [ConnectionHealth.ONLINE, true],
    ] as const)('locks the protocol with health %s: %s', (health, locked) => {
        const connection = {
            connectorType: ConnectorType.HYPER,
            connectionHealth: health,
            connectionStatus: ConnectionStatus.NOT_STARTED,
            details: { type: Symbol('test'), value: null },
            // The runtime decides whether a connection is open
            open: health === ConnectionHealth.CONNECTING || health === ConnectionHealth.ONLINE,
        } as unknown as ConnectionState;
        const changes: string[] = [];

        act(() => root.render(
            <LoggerProvider>
                <ConnectionInlineHeader
                    connector={connectorInfoOf(connection)}
                    connection={connection}
                    wrongPlatform={false}
                    protocol="WASM"
                    protocols={["WASM", "V3_HTTP"]}
                    onProtocolChange={p => changes.push(p)}
                />
            </LoggerProvider>,
        ));

        const http = container.querySelector<HTMLButtonElement>('[data-testid="protocol-option"][data-protocol="V3_HTTP"]')!;
        expect(http.disabled).toBe(locked);
        act(() => http.click());
        expect(changes).toEqual(locked ? [] : ['V3_HTTP']);
    });
});
