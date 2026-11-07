import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import { ConnectionHealth } from '../../connections/connection_state.js';
import { ConnectionRegistry } from '../../connections/connection_registry.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { SessionTestBackend } from '../../storage/session_test_backend.js';
import { SessionScriptsRegistryProvider } from './session_scripts_registry.js';
import { ScriptConnectionPicker, type ScriptConnectionPickerDependencies, type ScriptConnectionView } from './script_connection_picker.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

describe('ScriptConnectionPicker', () => {
    let container: HTMLDivElement;
    let root: Root;
    let overlayProps: { connectionId: string | null; isOpen: boolean; onClose: () => void } | null;
    const dependencies: ScriptConnectionPickerDependencies = {
        ConnectionSettingsOverlay: (props => {
            overlayProps = props;
            return <div data-testid="connection-settings" />;
        }) as ScriptConnectionPickerDependencies['ConnectionSettingsOverlay'],
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        overlayProps = null;
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render(onAttach?: (connector: ConnectorType) => string, connection: ScriptConnectionView | null = null) {
        act(() => root.render(
            <LoggerProvider>
                <StorageProvider backend={new SessionTestBackend()}>
                    <ConnectionRegistry>
                        <SessionScriptsRegistryProvider>
                            <ScriptConnectionPicker
                                sessionId="session"
                                scriptName="query"
                                connection={connection}
                                disabled={false}
                                onPick={vi.fn()}
                                onAttach={onAttach}
                                dependencies={dependencies}
                            />
                        </SessionScriptsRegistryProvider>
                    </ConnectionRegistry>
                </StorageProvider>
            </LoggerProvider>,
        ));
    }

    function attachOptions(): HTMLElement[] {
        return Array.from(document.querySelectorAll('[data-testid="attach-connection-option"]'));
    }

    it('shows the name of the connection without its protocol', () => {
        render(undefined, {
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: null as any, connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
            label: 'Hyper Wasm', labelParts: { name: 'Hyper', connector: 'Hyper', detail: 'Wasm' },
        });
        const trigger = container.querySelector('[data-testid="script-connection-picker"]')!;
        expect(trigger.textContent).toBe('Hyper');
        expect(trigger.querySelector('circle')).not.toBeNull();
    });

    it('offers no new connections without an attach handler', () => {
        render();
        act(() => (container.querySelector('[data-testid="script-connection-picker"]') as HTMLButtonElement).click());
        expect(attachOptions()).toEqual([]);
    });

    it('attaches a new connection and opens its settings', () => {
        const attach = vi.fn(() => 'attached-connection');
        render(attach);
        act(() => (container.querySelector('[data-testid="script-connection-picker"]') as HTMLButtonElement).click());
        expect(attachOptions().map(option => Number(option.getAttribute('data-connector'))))
            .toEqual([ConnectorType.HYPER, ConnectorType.DBCOM, ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.TRINO]);
        expect(document.querySelector('[data-testid="connection-settings"]')).toBeNull();

        act(() => attachOptions().find(option => Number(option.getAttribute('data-connector')) === ConnectorType.TRINO)!.click());
        expect(attach).toHaveBeenCalledWith(ConnectorType.TRINO);
        // The menu closes, the settings of the new connection open
        expect(attachOptions()).toEqual([]);
        expect(overlayProps).toMatchObject({ connectionId: 'attached-connection', isOpen: true });

        act(() => overlayProps!.onClose());
        expect(document.querySelector('[data-testid="connection-settings"]')).toBeNull();
    });
});
