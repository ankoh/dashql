import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';

import { LoggerProvider } from '../../platform/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';

import { ScriptConnectionPicker, type ScriptConnectionView } from './script_connection_picker.js';
import { TestRuntime } from '../../tests/test_runtime.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

describe('ScriptConnectionPicker', () => {
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

    function render(connection: ScriptConnectionView | null = null) {
        act(() => root.render(
            <LoggerProvider>
                <StorageProvider backend={new WorkbookTestBackend()}>
                    <TestRuntime>
                        <ScriptConnectionPicker
                            workbookId="workbook"
                            scriptName="query"
                            connection={connection}
                            disabled={false}
                            onPick={vi.fn()}
                        />
                    </TestRuntime>
                </StorageProvider>
            </LoggerProvider>,
        ));
    }

    it('shows the name of the connection without its protocol', () => {
        render({
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: null as any, connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
            label: 'Hyper Wasm', labelParts: { name: 'Hyper', connector: 'Hyper', detail: 'Wasm' },
        });
        const trigger = container.querySelector('[data-testid="script-connection-picker"]')!;
        expect(trigger.textContent).toBe('Hyper');
        expect(trigger.querySelector('circle')).not.toBeNull();
    });
});
