import * as React from 'react';
import type * as arrow from 'apache-arrow';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionRegistry, useConnectionRegistry } from './connection_registry.js';
import { ConnectionHealth, ConnectionStatus, RESET_CONNECTION, type ConnectionState } from './connection_state.js';
import { CONNECTOR_INFOS, ConnectorType } from './connector_info.js';
import { createDefaultConnectionParamsForConnector, getConnectionStateDetailsFromParams, type ConnectionParams } from './connection_params.js';
import { EXECUTOR_CTX, type QueryExecutor, type QueryExecutorContextValue } from './query_executor.js';
import { SETUP_CTX as HYPER_SETUP_CTX, type HyperSetupApi } from './hyper/hyper_connection_setup.js';
import { HYPER_CHANNEL_SETUP_STARTED } from './hyper/hyper_connection_state.js';
import { HyperDatabaseClientProvider } from './hyper/hyperdb_grpc_client_provider.js';
import type { HyperDatabaseChannel } from './hyper/hyperdb_grpc_client.js';
import { HYPERDB_WASM_ENGINE_SETTING_ELEMENTS, HyperConnectorSettings } from './hyper_connection_settings.js';
import { HttpClientProvider } from '../platform/http/http_client_provider.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { SessionTestBackend } from '../storage/session_test_backend.js';

const CONNECTION_ID = 'hyper-settings-test';

type Registry = ReturnType<typeof useConnectionRegistry>;

function hyperDatabase(params: connection.HyperConnectionParams, health = ConnectionHealth.NOT_STARTED): ConnectionState {
    const connectionParams: ConnectionParams = { hyper: params };
    return {
        connectionId: CONNECTION_ID,
        connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
        params: connectionParams,
        active: false,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: health,
        details: getConnectionStateDetailsFromParams(connectionParams),
        catalog: { clear: vi.fn() },
        catalogUpdates: { tasksRunning: new Map() },
        queriesActive: new Map(),
    } as unknown as ConnectionState;
}

function embeddedParams(): connection.HyperConnectionParams {
    const params = createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.HYPER]);
    if (!('hyper' in params)) throw new Error('no hyper params');
    return params.hyper as connection.HyperConnectionParams;
}

const HTTP: connection.HyperConnectionParams = {
    protocol: 'V3_HTTP',
    endpoint: 'https://hyper.example.com',
    tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
    attachedDatabases: [{ path: '/data/a.hyper', alias: 'a' }],
    metadata: { 'x-tenant': 'acme' },
    queryParameters: { lc_time: 'de_DE' },
} as connection.HyperConnectionParams;

const GRPC: connection.HyperConnectionParams = {
    ...HTTP,
    protocol: 'V3_GRPC',
    tls: { clientKeyPath: '/certs/client.key', clientCertPath: '/certs/client.pem', caCertsPath: '/certs/ca.pem' },
};

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('HyperConnectorSettings', () => {
    let container: HTMLDivElement;
    let root: Root;
    let registry: Registry | null;
    let execute: ReturnType<typeof vi.fn<QueryExecutor>>;
    let executor: QueryExecutorContextValue;
    let setup: ReturnType<typeof vi.fn<HyperSetupApi['setup']>>;
    let reset: ReturnType<typeof vi.fn<HyperSetupApi['reset']>>;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    function Capture() {
        registry = useConnectionRegistry();
        return null;
    }

    interface RenderOptions {
        /// Provide the gRPC and HTTP clients of Hyper
        clients?: boolean;
        hyperSetup?: HyperSetupApi | null;
    }

    async function render(database: ConnectionState | null, options: RenderOptions = {}) {
        const hyperSetup = options.hyperSetup === undefined ? { setup, reset } : options.hyperSetup;
        const tree = (showSettings: boolean) => {
            const settings = (
                <HYPER_SETUP_CTX.Provider value={hyperSetup}>
                    <>
                        <Capture />
                        {showSettings && <HyperConnectorSettings connectionId={CONNECTION_ID} onClose={onClose} />}
                    </>
                </HYPER_SETUP_CTX.Provider>
            );
            return (
                <LoggerProvider>
                    <StorageProvider backend={new SessionTestBackend()}>
                        <ConnectionRegistry>
                            <EXECUTOR_CTX.Provider value={executor}>
                                {options.clients
                                    ? <HttpClientProvider><HyperDatabaseClientProvider>{settings}</HyperDatabaseClientProvider></HttpClientProvider>
                                    : settings}
                            </EXECUTOR_CTX.Provider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </LoggerProvider>
            );
        };
        await act(async () => root.render(tree(false)));
        if (database != null) {
            await act(async () => registry![1](reg => {
                reg.connections.set(CONNECTION_ID, database);
                return { ...reg };
            }));
        }
        await act(async () => root.render(tree(true)));
    }

    function current(): ConnectionState {
        return registry![0].connections.get(CONNECTION_ID)!;
    }
    function draft(): connection.HyperConnectionParams {
        const params = current().paramsDraft;
        if (params == null || !('hyper' in params)) throw new Error('no hyper draft');
        return params.hyper as connection.HyperConnectionParams;
    }
    function maybeInput(label: string): HTMLInputElement | null {
        return container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    }
    function input(label: string): HTMLInputElement {
        const element = maybeInput(label);
        if (element == null) throw new Error(`no input ${label}`);
        return element;
    }
    function validation(label: string): string | null {
        const id = input(label).getAttribute('aria-describedby');
        return id == null ? null : document.getElementById(id)?.textContent ?? null;
    }
    function testId(id: string): HTMLButtonElement | null {
        return container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
    }
    function protocolOptions(): string[] {
        return [...container.querySelectorAll<HTMLButtonElement>('[data-testid="protocol-option"]')].map(b => b.dataset.protocol!);
    }
    async function type(label: string, value: string) {
        await act(async () => setInputValue(input(label), value));
    }
    async function click(element: HTMLElement | null) {
        if (element == null) throw new Error('nothing to click');
        await act(async () => element.click());
    }
    async function settle() {
        await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
    }
    /// Run as the desktop app, it speaks gRPC. The storage registers its flush with the bridge.
    function asDesktop() {
        (globalThis as { dashqlElectron?: unknown }).dashqlElectron = { onFlush: () => () => { } };
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        registry = null;
        execute = vi.fn<QueryExecutor>(() => [1, Promise.resolve({} as arrow.Table)]);
        executor = { execute, cancel: vi.fn(async () => { }), watchProfile: vi.fn(() => () => { }) };
        setup = vi.fn<HyperSetupApi['setup']>(async () => null);
        reset = vi.fn<HyperSetupApi['reset']>(async () => { });
        onClose = vi.fn<() => void>();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        delete (globalThis as { dashqlElectron?: unknown }).dashqlElectron;
    });

    describe('embedded engine', () => {
        it('shows the immutable engine settings and no server fields', async () => {
            await render(hyperDatabase(embeddedParams()));
            expect(testId('embedded-engine-label')).not.toBeNull();
            expect(testId('connection-status')).toBeNull();
            expect(maybeInput('HTTP Endpoint')).toBeNull();
            expect(container.textContent).toContain('Engine Settings');
            const first = HYPERDB_WASM_ENGINE_SETTING_ELEMENTS[0];
            const name = input('Engine Settings name 1');
            expect(name.value).toBe(first.key);
            expect(name.disabled).toBe(true);
            expect(input('Engine Settings value 1').value).toBe(first.value);
            expect(maybeInput(`Engine Settings name ${HYPERDB_WASM_ENGINE_SETTING_ELEMENTS.length}`)).not.toBeNull();
            expect(maybeInput(`Engine Settings name ${HYPERDB_WASM_ENGINE_SETTING_ELEMENTS.length + 1}`)).toBeNull();
            // The embedded connection does not switch to a server
            expect(protocolOptions()).toEqual([]);
        });

        it('selects the embedded engine without a health check', async () => {
            setup.mockImplementation(async () => ({} as HyperDatabaseChannel));
            await render(hyperDatabase(embeddedParams()));
            const select = testId('connection-setup');
            expect(select?.textContent).toBe('Select');
            await click(select);
            await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce());
            const [dispatch, params, signal, connectionId] = setup.mock.calls[0];
            expect(typeof dispatch).toBe('function');
            expect(params.protocol).toBe('WASM');
            expect(signal.aborted).toBe(false);
            expect(connectionId).toBe(CONNECTION_ID);
            await settle();
            expect(execute).not.toHaveBeenCalled();
        });
    });

    describe('HTTP', () => {
        it('restores the params of the connection', async () => {
            await render(hyperDatabase(HTTP));
            expect(input('HTTP Endpoint').value).toBe('https://hyper.example.com');
            expect(input('HTTP Endpoint').placeholder).toBe('HTTP endpoint url');
            expect(input('Attached Databases name 1').value).toBe('/data/a.hyper');
            expect(input('Attached Databases value 1').value).toBe('a');
            expect(input('HTTP Headers name 1').value).toBe('x-tenant');
            expect(input('HTTP Headers value 1').value).toBe('acme');
            expect(input('Query Settings name 1').value).toBe('lc_time');
            expect(input('Query Settings value 1').value).toBe('de_DE');
            // TLS paths are a gRPC feature
            expect(maybeInput('mTLS Client Key')).toBeNull();
            expect(maybeInput('mTLS CA certificates')).toBeNull();
            // The web app speaks only HTTP to a server
            expect(protocolOptions()).toEqual([]);
            expect(testId('connection-setup')?.textContent).toContain('Connect');
            expect(testId('connection-setup')?.disabled).toBe(false);
            expect(current().paramsDraft).toBeUndefined();
        });

        it('writes edits of the endpoint and the lists into the draft', async () => {
            await render(hyperDatabase({ ...HTTP, attachedDatabases: [], metadata: {}, queryParameters: {} }));
            await type('HTTP Endpoint', 'http://localhost:7484');
            expect(draft().endpoint).toBe('http://localhost:7484');
            expect(draft().protocol).toBe('V3_HTTP');

            await click(container.querySelector<HTMLButtonElement>('button[aria-label="Add Database"]'));
            await type('Attached Databases name 1', '/data/b.hyper');
            await type('Attached Databases value 1', 'b');
            expect(draft().attachedDatabases).toHaveLength(1);
            expect(draft().attachedDatabases![0]).toMatchObject({ path: '/data/b.hyper', alias: 'b' });

            await click(container.querySelector<HTMLButtonElement>('button[aria-label="Add Header"]'));
            await type('HTTP Headers name 1', 'authorization');
            await type('HTTP Headers value 1', 'Bearer t');
            expect(draft().metadata).toEqual({ authorization: 'Bearer t' });
            expect(draft().draftRows?.metadata).toEqual([{ key: 'authorization', value: 'Bearer t' }]);

            await click(container.querySelector<HTMLButtonElement>('button[aria-label="Add Setting"]'));
            await type('Query Settings name 1', 'search_path');
            expect(draft().queryParameters).toEqual({ search_path: '' });
            expect(draft().draftRows?.queryParameters).toEqual([{ key: 'search_path', value: '' }]);

            // Removing the database row drops it from the draft
            const databaseRow = input('Attached Databases name 1').closest('span')!.parentElement!;
            await click(databaseRow.querySelector<HTMLButtonElement>('button[aria-label="Clear input"]'));
            expect(draft().attachedDatabases).toEqual([]);
        });

        it('does not connect without a Hyper client', async () => {
            await render(hyperDatabase(HTTP));
            await click(testId('connection-setup'));
            await settle();
            expect(setup).not.toHaveBeenCalled();
        });

        it('does not connect without a Hyper setup', async () => {
            await render(hyperDatabase(HTTP), { clients: true, hyperSetup: null });
            await click(testId('connection-setup'));
            await settle();
            expect(execute).not.toHaveBeenCalled();
        });

        it('connects with the edited params and runs the health check on the channel', async () => {
            const channel = {} as HyperDatabaseChannel;
            setup.mockImplementation(async () => channel);
            await render(hyperDatabase(HTTP), { clients: true });
            await type('HTTP Endpoint', 'http://edited:7484');
            await click(testId('connection-setup'));
            await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce());
            const params = setup.mock.calls[0][1];
            expect(params.protocol).toBe('V3_HTTP');
            expect(params.endpoint).toBe('http://edited:7484');
            expect(params.metadata).toEqual({ 'x-tenant': 'acme' });
            expect(params.queryParameters).toEqual({ lc_time: 'de_DE' });
            expect(params.attachedDatabases![0]).toMatchObject({ path: '/data/a.hyper', alias: 'a' });
            await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
            const [connectionId, args] = execute.mock.calls[0];
            expect(connectionId).toBe(CONNECTION_ID);
            expect(args.query).toBe('select 1 as healthy');
            expect(args.channelOverride).toEqual({ type: 'hyper', channel });
            await vi.waitFor(() => expect(current().connectionHealth).toBe(ConnectionHealth.ONLINE));
        });

        it('swallows setup errors', async () => {
            setup.mockImplementation(async () => { throw new Error('unreachable'); });
            await render(hyperDatabase(HTTP), { clients: true });
            await click(testId('connection-setup'));
            await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce());
            await settle();
            expect(execute).not.toHaveBeenCalled();
        });

        it('freezes the form while connecting and cancels the setup', async () => {
            let setupSignal: AbortSignal | null = null;
            setup.mockImplementation((dispatch, params, signal) => {
                setupSignal = signal;
                dispatch({ type: HYPER_CHANNEL_SETUP_STARTED, value: params });
                return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
            });
            await render(hyperDatabase(HTTP), { clients: true });
            await click(testId('connection-setup'));
            await vi.waitFor(() => expect(current().connectionHealth).toBe(ConnectionHealth.CONNECTING));
            expect(input('HTTP Endpoint').disabled).toBe(true);
            expect(input('Attached Databases name 1').disabled).toBe(true);
            // Read-only lists offer no rows to add or remove
            expect(container.querySelector('button[aria-label="Add Header"]')).toBeNull();
            expect(container.querySelector('button[aria-label="Clear input"]')).toBeNull();
            await click(testId('connection-cancel'));
            expect(setupSignal!.aborted).toBe(true);
            await settle();
            expect(execute).not.toHaveBeenCalled();
        });

        it('resets an online connection on disconnect', async () => {
            await render(hyperDatabase(HTTP, ConnectionHealth.ONLINE), { clients: true });
            await click(testId('connection-reset'));
            expect(reset).toHaveBeenCalledOnce();
            await act(async () => reset.mock.calls[0][0]({ type: RESET_CONNECTION, value: null }));
            expect(current().connectionHealth).toBe(ConnectionHealth.NOT_STARTED);
        });

        it('closes through the header', async () => {
            await render(hyperDatabase(HTTP));
            await click(testId('connection-close'));
            expect(onClose).toHaveBeenCalledOnce();
        });
    });

    describe('HTTP link', () => {
        it('shows the endpoint of the link read-only', async () => {
            await render(hyperDatabase({ ...HTTP, protocol: 'V3_HTTP_LINK', endpoint: 'http://127.0.0.1:7483' }));
            const endpoint = input('HTTP Endpoint');
            expect(endpoint.value).toBe('http://127.0.0.1:7483');
            expect(endpoint.readOnly).toBe(true);
            expect(endpoint.disabled).toBe(true);
            expect(endpoint.placeholder).toBe('Open a link to connect');
            expect(protocolOptions()).toEqual([]);
        });
    });

    describe('gRPC', () => {
        it('is unavailable in the browser', async () => {
            await render(hyperDatabase(GRPC), { clients: true });
            expect(testId('connection-setup')?.disabled).toBe(true);
            expect(testId('connection-status')?.textContent).toContain('Connector is unavailable on this platform');
        });

        it('switches between gRPC and HTTP on the desktop', async () => {
            asDesktop();
            await render(hyperDatabase(HTTP), { clients: true });
            expect(protocolOptions()).toEqual(['V3_GRPC', 'V3_HTTP']);
            expect(maybeInput('mTLS Client Key')).toBeNull();
            expect(container.textContent).toContain('HTTP Headers');

            await click(container.querySelector<HTMLButtonElement>('[data-protocol="V3_GRPC"]'));
            expect(draft().protocol).toBe('V3_GRPC');
            expect(input('gRPC Endpoint').value).toBe('https://hyper.example.com');
            expect(input('gRPC Endpoint').placeholder).toBe('gRPC endpoint url');
            expect(input('gRPC Metadata name 1').value).toBe('x-tenant');
            expect(testId('connection-setup')?.disabled).toBe(false);

            await type('mTLS Client Key', '/k.key');
            await type('mTLS Client Certificate', '/k.pem');
            await type('mTLS CA certificates', '/ca.pem');
            expect(draft().tls).toEqual({ clientKeyPath: '/k.key', clientCertPath: '/k.pem', caCertsPath: '/ca.pem' });

            await click(container.querySelector<HTMLButtonElement>('[data-protocol="V3_HTTP"]'));
            expect(draft().protocol).toBe('V3_HTTP');
            expect(maybeInput('mTLS Client Key')).toBeNull();
        });

        it('requires an https endpoint for TLS paths', async () => {
            asDesktop();
            await render(hyperDatabase({ ...GRPC, endpoint: 'http://hyper:7484' }), { clients: true });
            expect(validation('gRPC Endpoint')).toBeNull();
            await click(testId('connection-setup'));
            expect(validation('gRPC Endpoint')).toBe('TLS certificate paths require an https:// endpoint');
            expect(input('gRPC Endpoint').getAttribute('aria-invalid')).toBe('true');
            expect(setup).not.toHaveBeenCalled();
            // Editing the endpoint clears the error
            await type('gRPC Endpoint', 'https://hyper:7484');
            expect(validation('gRPC Endpoint')).toBeNull();
        });

        it('requires both client key and certificate paths', async () => {
            asDesktop();
            await render(hyperDatabase({ ...GRPC, tls: { clientKeyPath: '/k.key', clientCertPath: '', caCertsPath: '' } }), { clients: true });
            await click(testId('connection-setup'));
            expect(validation('mTLS Client Key')).toBe('Client key and certificate paths must both be provided');
            expect(setup).not.toHaveBeenCalled();
            await type('mTLS Client Certificate', '/k.pem');
            expect(validation('mTLS Client Key')).toBeNull();
            await click(testId('connection-setup'));
            await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce());
            expect(setup.mock.calls[0][1].tls).toEqual({ clientKeyPath: '/k.key', clientCertPath: '/k.pem', caCertsPath: '' });
        });

        it('locks the protocol of an online connection', async () => {
            asDesktop();
            await render(hyperDatabase(GRPC, ConnectionHealth.ONLINE), { clients: true });
            const http = container.querySelector<HTMLButtonElement>('[data-protocol="V3_HTTP"]')!;
            expect(http.disabled).toBe(true);
            await click(http);
            expect(current().paramsDraft).toBeUndefined();
        });
    });
});
