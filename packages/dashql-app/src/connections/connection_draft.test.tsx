import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';
import { testRuntime } from '@akohn/dashql/runtime/testing/connector_state';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { useConnection, useDispatch, useRuntime } from '../runtime/runtime_hooks.js';
import { ConnectionHealth, ConnectionStatus, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useConnectionDraftForm } from './connection_draft.js';
import { ConnectorType, CONNECTOR_INFOS } from '@akohn/dashql/platform/connections/connector_info';
import { createDefaultConnectionParamsForConnector, newConnectionFromParams, type ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { buildHyperConnectionPageState, buildHyperConnectionSetupParams, type HyperConnectionPageState } from './hyper_connection_settings.js';
import { buildPageStateFromParams } from './trino_connection_settings.js';
import { LoggerProvider } from '../platform/logger_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID } from '@akohn/dashql/platform/testing/workbook_test_backend';
import type { StorageCommands } from '@akohn/dashql/runtime/runtime_storage';
import { TestRuntime } from '../tests/test_runtime.js';

/// The draft of the test connection in the app manifest
function globalDraft(backend: WorkbookTestBackend): ConnectionParams | undefined {
    return backend.connections?.find(entry => entry.id === TEST_CONNECTION_ID)?.paramsDraft;
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// A new connection of a connector in a runtime, by default a new one
function database(type: ConnectorType, active = false, into: Runtime = testRuntime(dql)): ConnectionState {
    const params = createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[type]);
    const state = into.createConnection(newConnectionFromParams(params, { active }), TEST_CONNECTION_ID);
    expect(state.connectionStatus).toBe(ConnectionStatus.NOT_STARTED);
    expect(state.connectionHealth).toBe(ConnectionHealth.NOT_STARTED);
    return state;
}

/// A workbook of the runtime that uses the connection without a script, the connection knows which workbooks use it
function workbookOnConnection(appRuntime: Runtime): void {
    appRuntime.createWorkbook(TEST_CONNECTION_ID, null, false, undefined, TEST_WORKBOOK_ID);
}

/// Set the draft of the params
function setDraft(params: ConnectionParams): core.ConnectionAction {
    return { kind: 'setDraft', value: { params: params as unknown as core.JsonParams } };
}
const DISCARD_DRAFT: core.ConnectionAction = { kind: 'discardDraft' };
function edited(params: ConnectionParams, endpoint: string): ConnectionParams {
    if ('hyper' in params) return { hyper: { ...params.hyper, protocol: 'V3_HTTP', endpoint } };
    if ('trino' in params) return { trino: { ...params.trino, endpoint } };
    if ('dbcom' in params) return { dbcom: { ...params.dbcom, instanceUrl: endpoint } };
    return { salesforce: { ...params.salesforce, instanceUrl: endpoint } };
}

// The drafts of the setups of every connector are tested in the runtime crate (`tests/connections_test.rs`), these are
// the forms of the app over them
describe('durable connection drafts', () => {
    it.each([false, true])('saves invalid edits with active=%s into the app manifest and does not resurrect a discarded draft', async active => {
        const backend = new WorkbookTestBackend();
        let appRuntime!: Runtime;
        let edit!: React.Dispatch<React.SetStateAction<string>>;
        let dispatch!: (action: core.ConnectionAction) => core.DispatchOutcome;
        let writer!: StorageCommands;
        let current!: ConnectionState;
        let value = '';
        function Harness() {
            appRuntime = useRuntime();
            current = useConnection(TEST_CONNECTION_ID) as ConnectionState;
            dispatch = useDispatch({ connection: TEST_CONNECTION_ID });
            [value, edit] = useConnectionDraftForm(TEST_CONNECTION_ID,
                params => params && 'trino' in params ? params.trino.endpoint : '',
                endpoint => edited(current.params, endpoint));
            writer = useRuntime().storage;
            return null;
        }
        const root = createRoot(document.createElement('div'));
        try {
            await act(async () => root.render(<LoggerProvider><StorageProvider backend={backend}><TestRuntime><Harness /></TestRuntime></StorageProvider></LoggerProvider>));
            await act(async () => {
                database(ConnectorType.TRINO, active, appRuntime);
                workbookOnConnection(appRuntime);
            });
            await act(async () => edit('not a URL'));
            expect(current.active).toBe(active);
            expect(value).toBe('not a URL');
            await writer.flush();
            expect(globalDraft(backend)).toEqual(edited(current.params, 'not a URL'));
            // Drafts are never replicated into the workbook
            expect(backend.workbooks.get(TEST_WORKBOOK_ID)?.connections.map(copy => copy.params)).toEqual([current.params]);
            await act(async () => edit('newer unfinished value'));
            await act(async () => dispatch(DISCARD_DRAFT));
            await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            expect(value).toBe('');
            await writer.flush();
            expect(globalDraft(backend)).toBeUndefined();
            expect(backend.connections?.map(entry => entry.id)).toEqual([TEST_CONNECTION_ID]);
            await act(async () => { await Promise.resolve(); });
            // Nothing of the workbook waits, is held or failed
            expect(await writer.flushWorkbook(TEST_WORKBOOK_ID)).toBe(true);
            expect(current.connectionHealth).toBe(ConnectionHealth.NOT_STARTED);
        } finally {
            act(() => root.unmount());
        }
    });

    it('persists and rehydrates incomplete duplicate header rows without flattening the form', async () => {
        const backend = new WorkbookTestBackend();
        let appRuntime!: Runtime;
        let edit!: React.Dispatch<React.SetStateAction<HyperConnectionPageState>>;
        let dispatch!: (action: core.ConnectionAction) => core.DispatchOutcome;
        let form!: HyperConnectionPageState;
        let writer!: StorageCommands;
        function Harness() {
            appRuntime = useRuntime();
            dispatch = useDispatch({ connection: TEST_CONNECTION_ID });
            [form, edit] = useConnectionDraftForm(TEST_CONNECTION_ID,
                params => buildHyperConnectionPageState(params && 'hyper' in params ? params.hyper as any : undefined),
                value => ({ hyper: { ...buildHyperConnectionSetupParams(value), draftRows: { metadata: value.gRPCMetadata, queryParameters: value.queryParameters } } }));
            writer = useRuntime().storage;
            return null;
        }
        const root = createRoot(document.createElement('div'));
        try {
            await act(async () => root.render(<LoggerProvider><StorageProvider backend={backend}><TestRuntime><Harness /></TestRuntime></StorageProvider></LoggerProvider>));
            await act(async () => {
                database(ConnectorType.HYPER, false, appRuntime);
                workbookOnConnection(appRuntime);
            });
            const rows = [{ key: '', value: 'unfinished' }, { key: '', value: '' }];
            await act(async () => edit(prev => ({ ...prev, endpoint: 'invalid', gRPCMetadata: rows })));
            await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            expect(form.gRPCMetadata).toEqual(rows);
            expect(form.endpoint).toBe('invalid');
            await writer.flush();
            const persisted = JSON.parse(JSON.stringify(globalDraft(backend)));
            expect(buildHyperConnectionPageState(persisted.hyper).gRPCMetadata).toEqual(rows);
            expect(buildHyperConnectionPageState(persisted.hyper).endpoint).toBe('invalid');
            // The draft comes back as the app reads it from its manifest
            await act(async () => dispatch(setDraft(persisted)));
            expect(form.gRPCMetadata).toEqual(rows);
            expect(form.endpoint).toBe('invalid');
            await act(async () => dispatch(DISCARD_DRAFT));
            await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            expect(form.gRPCMetadata).toEqual([]);
            expect(form.endpoint).toBe('');
            await writer.flush();
            expect(globalDraft(backend)).toBeUndefined();
        } finally {
            act(() => root.unmount());
        }
    });

    it('reloads ordered incomplete Trino metadata and Hyper query rows', () => {
        const rows = [{ key: '', value: 'partial' }, { key: '', value: '' }, { key: 'duplicate', value: 'one' }, { key: 'duplicate', value: 'two' }];
        const trino = database(ConnectorType.TRINO);
        const params = { trino: { ...('trino' in trino.params ? trino.params.trino : {}), endpoint: 'invalid', draftRows: { metadata: rows } } } as ConnectionParams;
        const reloaded = JSON.parse(JSON.stringify(params));
        expect(buildPageStateFromParams(reloaded.trino).newParamsMetadata).toEqual(rows);
        const hyper = database(ConnectorType.HYPER);
        const draft = { hyper: { ...('hyper' in hyper.params ? hyper.params.hyper : {}), draftRows: { queryParameters: rows } } } as ConnectionParams;
        expect(buildHyperConnectionPageState(JSON.parse(JSON.stringify(draft)).hyper).queryParameters).toEqual(rows);
    });
});
