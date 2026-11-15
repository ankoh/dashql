import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import * as core from '@ankoh/dashql-core';

import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { StorageProvider, useStorageWriter } from '../storage/storage_provider.js';
import type { StorageWriter } from '@ankoh/dashql-runtime/storage/storage_writer';
import { WorkbookTestBackend, TEST_CONNECTION_ID } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { useWorkbookScriptsRegistry, type WorkbookScriptsRegistry } from './scripts/workbook_scripts_registry.js';
import { freeWorkbookName, isEphemeralWorkbook } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { useEphemeralWorkbook, useWorkbookCreation, type WorkbookCreation } from './workbook_creation.js';
import { setHyperLinkToken } from '../connections/hyper/hyper_link_tab.js';
import { TestRuntime } from '../tests/test_runtime.js';
import type { CoreRuntime } from '@ankoh/dashql-runtime/core_runtime';
import { createTestConnection } from '@ankoh/dashql-runtime/testing/connection_fixtures';
import { useCoreRuntime } from '../runtime/runtime_hooks.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

describe('workbook creation', () => {
    it('picks the first workbook name no other workbook has', () => {
        expect(freeWorkbookName([])).toBe('Untitled');
        expect(freeWorkbookName(['Default', null])).toBe('Untitled');
        expect(freeWorkbookName(['untitled', ' Untitled 2 ', 'Untitled 4'])).toBe('Untitled 3');
    });

    it('registers the scripts of a new workbook and writes its workbook file with the default connection', async () => {
        const backend = new WorkbookTestBackend();
        const params = { hyper: { protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } } as const;
        let coreRuntime!: CoreRuntime;
        let createWorkbook!: WorkbookCreation;
        let registry!: WorkbookScriptsRegistry;
        let writer!: StorageWriter;
        function Harness() {
            coreRuntime = useCoreRuntime();
            createWorkbook = useWorkbookCreation();
            [registry] = useWorkbookScriptsRegistry();
            writer = useStorageWriter();
            return null;
        }
        const root = createRoot(document.createElement('div'));
        try {
            await act(async () => root.render(
                <LoggerProvider><StorageProvider backend={backend}><TestRuntime><Harness /></TestRuntime></StorageProvider></LoggerProvider>,
            ));
            // The embedded database of the runtime of the test
            const database = createTestConnection(coreRuntime, { connectionId: TEST_CONNECTION_ID, params });
            let workbookId = '';
            await act(async () => { workbookId = createWorkbook(database, 'Default').workbookId; });
            expect(registry.workbookScriptsMap.get(workbookId)?.name).toBe('Default');
            // Workbooks without a name get free ones, also when created back to back
            let firstId = '';
            let secondId = '';
            await act(async () => {
                firstId = createWorkbook(database).workbookId;
                secondId = createWorkbook(database).workbookId;
            });
            expect(registry.workbookScriptsMap.get(firstId)?.name).toBe('Untitled');
            expect(registry.workbookScriptsMap.get(secondId)?.name).toBe('Untitled 2');
            expect(registry.workbookScriptsByConnection.get(TEST_CONNECTION_ID)).toEqual([workbookId, firstId, secondId]);
            await writer.flush();
            const workbook = backend.workbooks.get(workbookId)!;
            expect(workbook.connections).toEqual([{ connectionId: TEST_CONNECTION_ID, params }]);
            expect(workbook.metadata.ephemeral).toBeUndefined();
        } finally {
            act(() => root.unmount());
        }
    });

    it('holds a single ephemeral workbook that gives up its name and writes its marker', async () => {
        sessionStorage.removeItem('dashql.hyper_links');
        const backend = new WorkbookTestBackend();
        const params = { hyper: { protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } } as const;
        let coreRuntime!: CoreRuntime;
        /// A connection of the runtime of the test
        const connection = (connectionId: string): ConnectionState => createTestConnection(coreRuntime, { connectionId, params });
        let createWorkbook!: WorkbookCreation;
        let ephemeralWorkbook!: ReturnType<typeof useEphemeralWorkbook>;
        let registry!: WorkbookScriptsRegistry;
        let writer!: StorageWriter;
        function Harness() {
            coreRuntime = useCoreRuntime();
            createWorkbook = useWorkbookCreation();
            ephemeralWorkbook = useEphemeralWorkbook();
            [registry] = useWorkbookScriptsRegistry();
            writer = useStorageWriter();
            return null;
        }
        const root = createRoot(document.createElement('div'));
        try {
            await act(async () => root.render(
                <LoggerProvider><StorageProvider backend={backend}><TestRuntime><Harness /></TestRuntime></StorageProvider></LoggerProvider>,
            ));
            const database = connection(TEST_CONNECTION_ID);
            let firstId = '';
            let secondId = '';
            let namedId = '';
            await act(async () => {
                firstId = ephemeralWorkbook(database).workbookId;
                secondId = ephemeralWorkbook(database).workbookId;
                namedId = createWorkbook(database).workbookId;
            });
            expect(secondId).toBe(firstId);
            expect(isEphemeralWorkbook(registry.workbookScriptsMap.get(firstId)!)).toBe(true);
            expect(registry.workbookScriptsMap.get(firstId)?.name).toBe('New Workbook');
            expect(registry.workbookScriptsMap.get(namedId)?.name).toBe('Untitled');
            await writer.flush();
            expect(backend.workbooks.get(firstId)!.metadata.ephemeral).toBe(true);

            // Only the connection of a link moves the workbook
            await act(async () => { ephemeralWorkbook(connection('other')); });
            expect(registry.workbookScriptsMap.get(firstId)?.pendingConnection?.connectionId).toBe(TEST_CONNECTION_ID);
            setHyperLinkToken('linked', 'token');
            await act(async () => { ephemeralWorkbook(connection('linked')); });
            expect(registry.workbookScriptsMap.get(firstId)?.pendingConnection?.connectionId).toBe('linked');
        } finally {
            sessionStorage.removeItem('dashql.hyper_links');
            act(() => root.unmount());
        }
    });
});
