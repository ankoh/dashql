import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { CONNECTOR_INFOS, ConnectorType } from '../connections/connector_info.js';
import type { ConnectionState } from '../connections/connection_state.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { StorageProvider, useStorageWriter } from '../storage/storage_provider.js';
import type { StorageWriter } from '../storage/storage_writer.js';
import { SessionTestBackend, TEST_CONNECTION_ID } from '../storage/session_test_backend.js';
import { SessionScriptsRegistryProvider, useSessionScriptsRegistry, type SessionScriptsRegistry } from './scripts/session_scripts_registry.js';
import { freeSessionName, useSessionCreation, type SessionCreation } from './session_creation.js';

describe('session creation', () => {
    it('picks the first session name no other session has', () => {
        expect(freeSessionName([])).toBe('Untitled');
        expect(freeSessionName(['Default', null])).toBe('Untitled');
        expect(freeSessionName(['untitled', ' Untitled 2 ', 'Untitled 4'])).toBe('Untitled 3');
    });

    it('registers the scripts of a new session and writes its session file with the default connection', async () => {
        const backend = new SessionTestBackend();
        const params = { hyper: { protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } } as const;
        const database = {
            connectionId: TEST_CONNECTION_ID,
            connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
            instance: {},
            catalog: {},
            catalogFunctionScript: { toString: () => '' },
            params,
        } as unknown as ConnectionState;
        let createSession!: SessionCreation;
        let registry!: SessionScriptsRegistry;
        let writer!: StorageWriter;
        function Harness() {
            createSession = useSessionCreation();
            [registry] = useSessionScriptsRegistry();
            writer = useStorageWriter();
            return null;
        }
        const root = createRoot(document.createElement('div'));
        try {
            await act(async () => root.render(
                <LoggerProvider><StorageProvider backend={backend}><SessionScriptsRegistryProvider><Harness /></SessionScriptsRegistryProvider></StorageProvider></LoggerProvider>,
            ));
            let sessionId = '';
            await act(async () => { sessionId = createSession(database, 'Default').sessionId; });
            expect(registry.sessionScriptsMap.get(sessionId)?.name).toBe('Default');
            // Sessions without a name get free ones, also when created back to back
            let firstId = '';
            let secondId = '';
            await act(async () => {
                firstId = createSession(database).sessionId;
                secondId = createSession(database).sessionId;
            });
            expect(registry.sessionScriptsMap.get(firstId)?.name).toBe('Untitled');
            expect(registry.sessionScriptsMap.get(secondId)?.name).toBe('Untitled 2');
            expect(registry.sessionScriptsByConnection.get(TEST_CONNECTION_ID)).toEqual([sessionId, firstId, secondId]);
            await writer.flush();
            const session = backend.sessions.get(sessionId)!;
            expect(session.connections).toEqual([{ connectionId: TEST_CONNECTION_ID, params }]);
        } finally {
            act(() => root.unmount());
        }
    });
});
