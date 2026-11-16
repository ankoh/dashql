import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import * as core from '@ankoh/dashql';

import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import type { StorageWriter } from '@ankoh/dashql/runtime/storage/runtime_storage';
import { WorkbookTestBackend, TEST_CONNECTION_ID } from '@ankoh/dashql/platform/testing/workbook_test_backend';
import type { WorkbookScripts } from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';
import { isEphemeralWorkbook } from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';
import { useEphemeralWorkbook, useWorkbookCreation, type WorkbookCreation } from './workbook_creation.js';
import { setHyperLinkToken } from '../connections/hyper/hyper_link_tab.js';
import { TestRuntime } from '../tests/test_runtime.js';
import type { Runtime } from '@ankoh/dashql/runtime/runtime';
import { newConnectionFromParams } from '@ankoh/dashql/platform/connections/connection_params';
import { useRuntime, useWorkbooks } from '../runtime/runtime_hooks.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

describe('workbook creation', () => {
    it('registers the scripts of a new workbook and writes its workbook file with the default connection', async () => {
        const backend = new WorkbookTestBackend();
        const params = { hyper: { protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } } as const;
        let runtime!: Runtime;
        let createWorkbook!: WorkbookCreation;
        let workbooks!: ReadonlyMap<string, WorkbookScripts>;
        let writer!: StorageWriter;
        function Harness() {
            runtime = useRuntime();
            createWorkbook = useWorkbookCreation();
            workbooks = useWorkbooks();
            writer = runtime.storage;
            return null;
        }
        const root = createRoot(document.createElement('div'));
        try {
            await act(async () => root.render(
                <LoggerProvider><StorageProvider backend={backend}><TestRuntime><Harness /></TestRuntime></StorageProvider></LoggerProvider>,
            ));
            // The embedded database of the runtime of the test
            const database = runtime.createConnection(newConnectionFromParams(params), TEST_CONNECTION_ID);
            let workbookId = '';
            await act(async () => { workbookId = createWorkbook(database, 'Default').workbookId; });
            expect(workbooks.get(workbookId)?.name).toBe('Default');
            // Workbooks without a name get free ones, also when created back to back
            let firstId = '';
            let secondId = '';
            await act(async () => {
                firstId = createWorkbook(database).workbookId;
                secondId = createWorkbook(database).workbookId;
            });
            expect(workbooks.get(firstId)?.name).toBe('Untitled');
            expect(workbooks.get(secondId)?.name).toBe('Untitled 2');
            expect(runtime.connection(TEST_CONNECTION_ID)?.workbooks).toEqual([workbookId, firstId, secondId]);
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
        let runtime!: Runtime;
        /// A connection of the runtime of the test
        const connection = (connectionId: string): ConnectionState => runtime.createConnection(newConnectionFromParams(params), connectionId);
        let createWorkbook!: WorkbookCreation;
        let ephemeralWorkbook!: ReturnType<typeof useEphemeralWorkbook>;
        let workbooks!: ReadonlyMap<string, WorkbookScripts>;
        let writer!: StorageWriter;
        function Harness() {
            runtime = useRuntime();
            createWorkbook = useWorkbookCreation();
            ephemeralWorkbook = useEphemeralWorkbook();
            workbooks = useWorkbooks();
            writer = runtime.storage;
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
            expect(isEphemeralWorkbook(workbooks.get(firstId)!)).toBe(true);
            expect(workbooks.get(firstId)?.name).toBe('New Workbook');
            expect(workbooks.get(namedId)?.name).toBe('Untitled');
            await writer.flush();
            expect(backend.workbooks.get(firstId)!.metadata.ephemeral).toBe(true);

            // Only the connection of a link moves the workbook
            await act(async () => { ephemeralWorkbook(connection('other')); });
            expect(workbooks.get(firstId)?.pendingConnectionId).toBe(TEST_CONNECTION_ID);
            setHyperLinkToken('linked', 'token');
            await act(async () => { ephemeralWorkbook(connection('linked')); });
            expect(workbooks.get(firstId)?.pendingConnectionId).toBe('linked');
        } finally {
            sessionStorage.removeItem('dashql.hyper_links');
            act(() => root.unmount());
        }
    });
});
