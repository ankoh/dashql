import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@ankoh/dashql-core';
import { createTestConnection, reduceTestConnection } from '@ankoh/dashql-runtime/testing/connection_fixtures';
import { testCoreRuntime } from '@ankoh/dashql-runtime/testing/mocks/connector_state';
import type { CoreRuntime } from '@ankoh/dashql-runtime/core_runtime';
import { useCoreRuntime } from '../runtime/runtime_hooks.js';
import { ConnectionHealth, ConnectionStatus, setupStepAction, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { useConnectionById, useConnectionDraftForm } from './connection_registry.js';
import { ConnectorType, CONNECTOR_INFOS } from '@ankoh/dashql-runtime/connections/connector_info';
import { createDefaultConnectionParamsForConnector, type ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import { buildHyperConnectionPageState, buildHyperConnectionSetupParams, type HyperConnectionPageState } from './hyper_connection_settings.js';
import { buildPageStateFromParams } from './trino_connection_settings.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { StorageProvider, useStorageWriter } from '../storage/storage_provider.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import type { StorageWriter } from '@ankoh/dashql-runtime/storage/storage_writer';
import { TestRuntime } from '../tests/test_runtime.js';
import { useWorkbookScriptsRegistry, type WorkbookScriptsRegistry } from '../workbook/scripts/workbook_scripts_registry.js';
import type { WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';

/// The draft of the test connection in the app manifest
function globalDraft(backend: WorkbookTestBackend): ConnectionParams | undefined {
    return backend.connections?.find(entry => entry.id === TEST_CONNECTION_ID)?.paramsDraft;
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// The runtime of the last connection of `database`, the actions of `reduce` go to it
let runtime: CoreRuntime;

/// A new connection of a connector in a runtime, by default a new one
function database(type: ConnectorType, active = false, into: CoreRuntime = testCoreRuntime(dql)): ConnectionState {
    runtime = into;
    const params = createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[type]);
    const state = createTestConnection(runtime, { connectionId: TEST_CONNECTION_ID, params, active });
    expect(state.connectionStatus).toBe(ConnectionStatus.NOT_STARTED);
    expect(state.connectionHealth).toBe(ConnectionHealth.NOT_STARTED);
    return state;
}

/// A workbook that uses the connection without a script, the registry of the connections reads which workbooks use it
function withWorkbookOnConnection(registry: WorkbookScriptsRegistry): WorkbookScriptsRegistry {
    const workbook = {
        workbookId: TEST_WORKBOOK_ID, scripts: {}, scriptRefs: {}, scriptOrder: [], instance: {},
        pendingConnection: { connectionId: TEST_CONNECTION_ID },
    } as unknown as WorkbookScripts;
    return {
        ...registry,
        workbookScriptsMap: new Map([[TEST_WORKBOOK_ID, workbook]]),
        workbookScriptsByConnection: new Map([[TEST_CONNECTION_ID, [TEST_WORKBOOK_ID]]]),
    };
}

function reduce(state: ConnectionState, action: core.RuntimeAction) {
    return reduceTestConnection(runtime, state, action);
}
/// Set the draft of the params
function setDraft(params: ConnectionParams): core.RuntimeAction {
    return { kind: 'setDraft', value: { params: params as unknown as core.JsonParams } };
}
const DISCARD_DRAFT: core.RuntimeAction = { kind: 'discardDraft' };
const HEALTH_CHECK_SUCCEEDED = setupStepAction('HEALTH_CHECK_SUCCEEDED');
function edited(params: ConnectionParams, endpoint: string): ConnectionParams {
    if ('hyper' in params) return { hyper: { ...params.hyper, protocol: 'V3_HTTP', endpoint } };
    if ('trino' in params) return { trino: { ...params.trino, endpoint } };
    if ('dbcom' in params) return { dbcom: { ...params.dbcom, instanceUrl: endpoint } };
    return { salesforce: { ...params.salesforce, instanceUrl: endpoint } };
}
function start(params: ConnectionParams): core.RuntimeAction {
    if ('hyper' in params) return setupStepAction('HYPER_CHANNEL_SETUP_STARTED', params.hyper);
    if ('trino' in params) return setupStepAction('TRINO_CHANNEL_SETUP_STARTED', params.trino);
    if ('dbcom' in params) return setupStepAction('SETUP_STARTED', params.dbcom);
    return setupStepAction('SETUP_STARTED', params.salesforce);
}

describe('durable connection drafts', () => {
    it.each([ConnectorType.HYPER, ConnectorType.TRINO, ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.DBCOM])('keeps %s committed until health check succeeds', type => {
        let state = database(type);
        const committed = state.params;
        const draft = edited(committed, 'invalid endpoint');
        state = reduce(state, setDraft(draft));
        state = reduce(state, start(draft));
        expect(state.params).toEqual(committed);
        expect(state.paramsDraft).toEqual(draft);
        // A discard while the setup runs keeps the draft
        expect(reduce(state, DISCARD_DRAFT)).toEqual(state);
        const newer = edited(committed, 'newer incomplete edit');
        state = reduce(state, setDraft(newer));
        state = reduce(state, HEALTH_CHECK_SUCCEEDED);
        expect(state.params).toEqual(draft);
        expect(state.paramsDraft).toEqual(newer);
        state = reduce(state, start(newer));
        state = reduce(state, HEALTH_CHECK_SUCCEEDED);
        expect(state.params).toEqual(newer);
        expect(state.paramsDraft).toBeNull();
    });

    it.each([ConnectorType.HYPER, ConnectorType.TRINO, ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.DBCOM])('preserves %s draft and committed parameters on failure, cancellation and reset', type => {
        const initial = database(type);
        const draft = edited(initial.params, 'invalid incomplete endpoint');
        let state = reduce(initial, setDraft(draft));
        state = reduce(state, start(draft));
        const setupFailed = type === ConnectorType.HYPER ? 'HYPER_CHANNEL_SETUP_FAILED'
            : type === ConnectorType.TRINO ? 'TRINO_CHANNEL_SETUP_FAILED' : 'SETUP_FAILED';
        const setupCancelled = type === ConnectorType.HYPER ? 'HYPER_CHANNEL_SETUP_CANCELLED'
            : type === ConnectorType.TRINO ? 'TRINO_CHANNEL_SETUP_CANCELLED' : 'SETUP_CANCELLED';
        for (const action of [
            setupStepAction(setupFailed, { message: 'setup failed' }),
            setupStepAction(setupCancelled, { message: 'setup cancelled' }),
            setupStepAction('HEALTH_CHECK_FAILED', { message: 'failed' }),
            setupStepAction('HEALTH_CHECK_CANCELLED'),
            { kind: 'resetConnection' } as core.RuntimeAction,
        ]) {
            const next = reduce(state, action);
            expect(next.params).toEqual(initial.params);
            expect(next.paramsDraft).toEqual(draft);
            expect(next.setupAttemptParams).toBeNull();
            expect(next.details.setupParams).not.toEqual(
                'hyper' in initial.params ? initial.params.hyper : 'trino' in initial.params ? initial.params.trino : 'dbcom' in initial.params ? initial.params.dbcom : initial.params.salesforce,
            );
        }
        state = reduce(state, setupStepAction('HEALTH_CHECK_FAILED', { message: 'failed' }));
        state = reduce(state, DISCARD_DRAFT);
        expect(state.paramsDraft).toBeNull();
        expect(state.params).toEqual(initial.params);
        expect(state.details.healthCheckError).toBeNull();
    });

    it('promotes embedded Hyper when its local channel becomes ready', () => {
        let state = database(ConnectorType.HYPER);
        state = reduce(state, setDraft(state.params));
        state = reduce(state, start(state.params));
        state = reduce(state, setupStepAction('HYPER_CHANNEL_READY', 'hyper' in state.params ? state.params.hyper : undefined, runtime.handles.register({})));
        expect(state.connectionHealth).toBe(ConnectionHealth.ONLINE);
        expect(state.paramsDraft).toBeNull();
        expect(state.active).toBe(true);
    });

    it.each([false, true])('saves invalid edits with active=%s into the app manifest and does not resurrect a discarded draft', async active => {
        const backend = new WorkbookTestBackend();
        let coreRuntime!: CoreRuntime;
        let setWorkbooks!: ReturnType<typeof useWorkbookScriptsRegistry>[1];
        let edit!: React.Dispatch<React.SetStateAction<string>>;
        let dispatch!: ReturnType<typeof useConnectionById>[1];
        let writer!: StorageWriter;
        let current!: ConnectionState;
        let value = '';
        function Harness() {
            coreRuntime = useCoreRuntime();
            [, setWorkbooks] = useWorkbookScriptsRegistry();
            [current, dispatch] = useConnectionById(TEST_CONNECTION_ID) as [ConnectionState, typeof dispatch];
            [value, edit] = useConnectionDraftForm(TEST_CONNECTION_ID,
                params => params && 'trino' in params ? params.trino.endpoint : '',
                endpoint => edited(current.params, endpoint));
            writer = useStorageWriter();
            return null;
        }
        const root = createRoot(document.createElement('div'));
        try {
            await act(async () => root.render(<LoggerProvider><StorageProvider backend={backend}><TestRuntime><Harness /></TestRuntime></StorageProvider></LoggerProvider>));
            await act(async () => {
                setWorkbooks(withWorkbookOnConnection);
                database(ConnectorType.TRINO, active, coreRuntime);
            });
            await act(async () => edit('not a URL'));
            expect(current.active).toBe(active);
            expect(value).toBe('not a URL');
            await writer.flush();
            expect(globalDraft(backend)).toEqual(edited(current.params, 'not a URL'));
            // Drafts are never replicated into the workbook
            expect(backend.workbooks.has(TEST_WORKBOOK_ID)).toBe(false);
            await act(async () => edit('newer unfinished value'));
            await act(async () => dispatch(DISCARD_DRAFT));
            await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            expect(value).toBe('');
            await writer.flush();
            expect(globalDraft(backend)).toBeUndefined();
            expect(backend.connections?.map(entry => entry.id)).toEqual([TEST_CONNECTION_ID]);
            await act(async () => { await Promise.resolve(); });
            expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toEqual([]);
            expect(writer.getPendingKeys()).toEqual([]);
            expect(current.connectionHealth).toBe(ConnectionHealth.NOT_STARTED);
        } finally {
            act(() => root.unmount());
        }
    });

    it('persists and rehydrates incomplete duplicate header rows without flattening the form', async () => {
        const backend = new WorkbookTestBackend();
        let coreRuntime!: CoreRuntime;
        let setWorkbooks!: ReturnType<typeof useWorkbookScriptsRegistry>[1];
        let edit!: React.Dispatch<React.SetStateAction<HyperConnectionPageState>>;
        let dispatch!: ReturnType<typeof useConnectionById>[1];
        let form!: HyperConnectionPageState;
        let writer!: StorageWriter;
        function Harness() {
            coreRuntime = useCoreRuntime();
            [, setWorkbooks] = useWorkbookScriptsRegistry();
            [, dispatch] = useConnectionById(TEST_CONNECTION_ID);
            [form, edit] = useConnectionDraftForm(TEST_CONNECTION_ID,
                params => buildHyperConnectionPageState(params && 'hyper' in params ? params.hyper as any : undefined),
                value => ({ hyper: { ...buildHyperConnectionSetupParams(value), draftRows: { metadata: value.gRPCMetadata, queryParameters: value.queryParameters } } }));
            writer = useStorageWriter();
            return null;
        }
        const root = createRoot(document.createElement('div'));
        try {
            await act(async () => root.render(<LoggerProvider><StorageProvider backend={backend}><TestRuntime><Harness /></TestRuntime></StorageProvider></LoggerProvider>));
            await act(async () => {
                setWorkbooks(withWorkbookOnConnection);
                database(ConnectorType.HYPER, false, coreRuntime);
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

    it('reloads ordered incomplete Trino metadata and Hyper query rows and strips them on successful promotion', () => {
        const rows = [{ key: '', value: 'partial' }, { key: '', value: '' }, { key: 'duplicate', value: 'one' }, { key: 'duplicate', value: 'two' }];
        const trino = database(ConnectorType.TRINO);
        const params = { trino: { ...('trino' in trino.params ? trino.params.trino : {}), endpoint: 'invalid', draftRows: { metadata: rows } } } as ConnectionParams;
        const reloaded = JSON.parse(JSON.stringify(params));
        expect(buildPageStateFromParams(reloaded.trino).newParamsMetadata).toEqual(rows);
        let hyper = database(ConnectorType.HYPER);
        const draft = { hyper: { ...('hyper' in hyper.params ? hyper.params.hyper : {}), draftRows: { queryParameters: rows } } } as ConnectionParams;
        expect(buildHyperConnectionPageState(JSON.parse(JSON.stringify(draft)).hyper).queryParameters).toEqual(rows);
        hyper = reduce(hyper, setDraft(draft));
        hyper = reduce(hyper, start(draft));
        hyper = reduce(hyper, HEALTH_CHECK_SUCCEEDED);
        expect(hyper.paramsDraft).toBeNull();
        expect(JSON.stringify(hyper.params)).not.toContain('draftRows');
    });

    it('keeps edits to raw duplicate rows made during setup even when their flattened parameters are unchanged', () => {
        let state = database(ConnectorType.HYPER);
        const initial = { hyper: {
            ...('hyper' in state.params ? state.params.hyper : {}),
            metadata: { duplicate: 'same' },
            draftRows: { metadata: [{ key: 'duplicate', value: 'same' }] },
        } } as ConnectionParams;
        state = reduce(state, setDraft(initial));
        state = reduce(state, start(initial));
        const newer = { hyper: {
            ...('hyper' in initial ? initial.hyper : {}),
            draftRows: { metadata: [{ key: 'duplicate', value: 'unfinished' }, { key: 'duplicate', value: 'same' }] },
        } } as ConnectionParams;
        state = reduce(state, setDraft(newer));
        state = reduce(state, HEALTH_CHECK_SUCCEEDED);
        expect(state.paramsDraft).toEqual(newer);
        expect(JSON.stringify(state.params)).not.toContain('draftRows');
    });
});
