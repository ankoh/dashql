import * as React from 'react';
import type * as arrow from 'apache-arrow';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionRegistry, useConnectionRegistry } from './connection_registry.js';
import { ConnectionHealth, ConnectionStatus, RESET_CONNECTION, type ConnectionState } from './connection_state.js';
import { CONNECTOR_INFOS, ConnectorType } from './connector_info.js';
import { getConnectionStateDetailsFromParams, type ConnectionParams } from './connection_params.js';
import { EXECUTOR_CTX, type QueryExecutor, type QueryExecutorContextValue } from './query_executor.js';
import { SETUP_CTX as TRINO_SETUP_CTX } from './trino/trino_connector.js';
import type { TrinoSetupApi } from './trino/trino_connection_setup.js';
import type { TrinoChannelInterface } from './trino/trino_channel.js';
import { TRINO_CHANNEL_SETUP_STARTED } from './trino/trino_connection_state.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { SessionTestBackend } from '../storage/session_test_backend.js';

const CONNECTION_ID = 'trino-settings-test';

type Registry = ReturnType<typeof useConnectionRegistry>;

function trinoDatabase(params: connection.TrinoConnectionParams, health = ConnectionHealth.NOT_STARTED): ConnectionState {
    const connectionParams: ConnectionParams = { trino: params };
    return {
        connectionId: CONNECTION_ID,
        connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO],
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

const RESTORED: connection.TrinoConnectionParams = {
    endpoint: 'https://trino.example.com:8443',
    auth: { authType: 'AUTH_BASIC', basic: { username: 'alice', secret: 'hunter2' } },
    metadata: { 'x-tenant': 'acme' },
    defaultCatalog: 'tpch',
    defaultSchema: 'sf1',
    catalogs: ['tpch.sf1', 'system'],
};

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('TrinoConnectorSettings', () => {
    let container: HTMLDivElement;
    let root: Root;
    let registry: Registry | null;
    let execute: ReturnType<typeof vi.fn<QueryExecutor>>;
    let executor: QueryExecutorContextValue;
    let setup: ReturnType<typeof vi.fn<TrinoSetupApi['setup']>>;
    let reset: ReturnType<typeof vi.fn<TrinoSetupApi['reset']>>;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    function Capture() {
        registry = useConnectionRegistry();
        return null;
    }

    async function render(database: ConnectionState | null, trinoSetup: TrinoSetupApi | null = { setup, reset }) {
        const tree = (showSettings: boolean) => (
            <LoggerProvider>
                <StorageProvider backend={new SessionTestBackend()}>
                    <ConnectionRegistry>
                        <EXECUTOR_CTX.Provider value={executor}>
                            <TRINO_SETUP_CTX.Provider value={trinoSetup}>
                                <>
                                    <Capture />
                                    {showSettings && <TrinoConnectorSettings connectionId={CONNECTION_ID} onClose={onClose} />}
                                </>
                            </TRINO_SETUP_CTX.Provider>
                        </EXECUTOR_CTX.Provider>
                    </ConnectionRegistry>
                </StorageProvider>
            </LoggerProvider>
        );
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
    function draft(): connection.TrinoConnectionParams {
        const params = current().paramsDraft;
        if (params == null || !('trino' in params)) throw new Error('no trino draft');
        return params.trino as connection.TrinoConnectionParams;
    }
    function input(label: string): HTMLInputElement {
        const element = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
        if (element == null) throw new Error(`no input ${label}`);
        return element;
    }
    function warning(label: string): string | null {
        const id = input(label).getAttribute('aria-describedby');
        return id == null ? null : document.getElementById(id)?.textContent ?? null;
    }
    function field(label: string): HTMLElement {
        return input(label).closest<HTMLElement>('[style]') ?? input(label).parentElement!.parentElement!;
    }
    function button(text: string): HTMLButtonElement {
        const element = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text);
        if (element == null) throw new Error(`no button ${text}`);
        return element;
    }
    function valueList(title: string): HTMLElement {
        const name = [...container.querySelectorAll<HTMLElement>('div')].find(d => d.childElementCount === 0 && d.textContent === title);
        if (name == null) throw new Error(`no list ${title}`);
        return name.parentElement!;
    }
    async function type(label: string, value: string) {
        await act(async () => setInputValue(input(label), value));
    }
    async function click(element: HTMLElement) {
        await act(async () => element.click());
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        registry = null;
        execute = vi.fn<QueryExecutor>(() => [1, Promise.resolve({} as arrow.Table)]);
        executor = { execute, cancel: vi.fn(async () => { }), watchProfile: vi.fn(() => () => { }) };
        setup = vi.fn<TrinoSetupApi['setup']>(async () => null);
        reset = vi.fn<TrinoSetupApi['reset']>(async () => { });
        onClose = vi.fn<() => void>();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('renders the defaults of a form without connection', async () => {
        await render(null);
        expect(container.querySelector('[data-testid="connector-name"]')?.textContent).toBe(CONNECTOR_INFOS[ConnectorType.TRINO].names.displayLong);
        expect(input('Endpoint').value).toBe('http://localhost:8080');
        expect(input('Username').value).toBe('');
        expect(input('Secret').value).toBe('');
        expect(input('Default Catalog').value).toBe('');
        expect(input('Default Schema').value).toBe('');
        expect(warning('Username')).toBe('Username is empty');
        expect(warning('Secret')).toBe('Secret is empty');
        expect(warning('Endpoint')).toBeNull();
        // Without a connection there is nothing to connect
        expect(container.querySelector('[data-testid="connection-setup"]')).toBeNull();
    });

    it('restores the params of the connection', async () => {
        await render(trinoDatabase(RESTORED));
        expect(input('Endpoint').value).toBe('https://trino.example.com:8443');
        expect(input('Username').value).toBe('alice');
        // The secret is concealed
        expect(input('Secret').type).toBe('password');
        expect(input('Secret').value).toBe('hunter2');
        expect(input('Default Catalog').value).toBe('tpch');
        expect(input('Default Schema').value).toBe('sf1');
        expect(input('Additional Metadata name 1').value).toBe('x-tenant');
        expect(input('Additional Metadata value 1').value).toBe('acme');
        const catalogs = [...valueList('Catalogs').querySelectorAll('input')].map(i => i.value);
        expect(catalogs).toEqual(['tpch.sf1', 'system']);
        expect(warning('Username')).toBeNull();
        expect(warning('Secret')).toBeNull();
        expect(container.querySelector('[data-testid="connection-setup"]')?.textContent).toContain('Connect');
        // Nothing is edited yet
        expect(current().paramsDraft).toBeUndefined();
    });

    it('restores the legacy catalog name and schema names as catalogs', async () => {
        await render(trinoDatabase({ ...RESTORED, defaultCatalog: undefined, catalogs: undefined, catalogName: 'hive', schemaNames: ['a', 'b'] }));
        expect(input('Default Catalog').value).toBe('hive');
        const catalogs = [...valueList('Catalogs').querySelectorAll('input')].map(i => i.value);
        expect(catalogs).toEqual(['hive.a', 'hive.b']);
    });

    it('writes edits of the endpoint and the basic credentials into the draft', async () => {
        await render(trinoDatabase(RESTORED));
        await type('Endpoint', '');
        expect(draft().endpoint).toBe('');
        expect(warning('Endpoint')).toBe('Endpoint is empty');
        await type('Endpoint', 'http://other:8080');
        expect(draft().endpoint).toBe('http://other:8080');
        expect(warning('Endpoint')).toBeNull();
        await type('Username', 'bob');
        expect(draft().auth).toEqual({ authType: 'AUTH_BASIC', basic: { username: 'bob', secret: 'hunter2' } });
        await type('Secret', 'pw');
        expect(draft().auth).toEqual({ authType: 'AUTH_BASIC', basic: { username: 'bob', secret: 'pw' } });
        // The committed params stay untouched
        expect(current().params).toEqual({ trino: RESTORED });
    });

    it('appends the typed characters to the concealed secret', async () => {
        await render(trinoDatabase(RESTORED));
        await type('Secret', '');
        // Every key appends to the value that the input shows
        for (const key of 'abc') await type('Secret', input('Secret').value + key);
        expect(draft().auth?.basic?.secret).toBe('abc');
    });

    it('keeps the basic credentials when the selected auth type is clicked again', async () => {
        await render(trinoDatabase(RESTORED));
        await click(button('Basic'));
        expect(input('Username').value).toBe('alice');
        expect(current().paramsDraft).toBeUndefined();
    });

    it('switches between basic and OAuth and writes the OAuth fields', async () => {
        await render(trinoDatabase(RESTORED));
        expect(field('Username').style.display).toBe('block');
        expect(field('Client ID').style.display).toBe('none');

        await click(button('OAuth 2.0'));
        expect(draft().auth).toEqual({ authType: 'AUTH_OAUTH' });
        expect(field('Username').style.display).toBe('none');
        expect(field('Client ID').style.display).toBe('block');
        expect(warning('Authorization Url')).toBe('Authorization Url is empty');
        expect(warning('Token Url')).toBe('Token Endpoint is empty');
        expect(warning('Client ID')).toBe('Client ID is empty');
        expect(warning('Redirect URL')).toBe('Redirect URL is empty');

        await type('Authorization Url', 'https://idp/authorize');
        await type('Token Url', 'https://idp/token');
        await type('Client ID', 'client-1');
        await type('Redirect URL', 'https://app/callback');
        expect(draft().auth).toEqual({
            authType: 'AUTH_OAUTH',
            oauth: {
                authorizationUrl: 'https://idp/authorize',
                tokenUrl: 'https://idp/token',
                clientId: 'client-1',
                callbackUrl: 'https://app/callback',
                scopes: [],
            },
        });
        for (const label of ['Authorization Url', 'Token Url', 'Client ID', 'Redirect URL']) {
            expect(warning(label)).toBeNull();
        }

        // Scopes
        const scopes = valueList('Scope');
        await click(scopes.querySelector<HTMLButtonElement>('button[aria-label="Add Entry"]')!);
        await click(scopes.querySelector<HTMLButtonElement>('button[aria-label="Add Entry"]')!);
        const scopeInputs = scopes.querySelectorAll('input');
        expect(scopeInputs.length).toBe(2);
        await act(async () => setInputValue(scopeInputs[0], 'openid'));
        await act(async () => setInputValue(scopes.querySelectorAll('input')[1], 'profile'));
        expect(draft().auth?.oauth?.scopes).toEqual(['openid', 'profile']);
        await click(scopes.querySelectorAll<HTMLButtonElement>('button[aria-label="Clear input"]')[0]);
        expect(draft().auth?.oauth?.scopes).toEqual(['profile']);
        expect(draft().auth?.oauth?.clientId).toBe('client-1');

        // Switching back starts basic auth from scratch
        await click(button('Basic'));
        expect(draft().auth).toEqual({ authType: 'AUTH_BASIC' });
        expect(input('Username').value).toBe('');
        await type('Secret', 's');
        expect(draft().auth).toEqual({ authType: 'AUTH_BASIC', basic: { username: '', secret: 's' } });
    });

    it('writes the catalogs and the default catalog and schema', async () => {
        await render(trinoDatabase({ ...RESTORED, defaultCatalog: '', defaultSchema: '', catalogs: [] }));
        const catalogs = valueList('Catalogs');
        await click(catalogs.querySelector<HTMLButtonElement>('button[aria-label="Add Entry"]')!);
        expect(draft().catalogs).toEqual(['']);
        await act(async () => setInputValue(catalogs.querySelector('input')!, 'hive.web'));
        expect(draft().catalogs).toEqual(['hive.web']);

        await type('Default Schema', 'web');
        expect(draft().defaultSchema).toBe('web');
        expect(warning('Default Schema')).toBe('A default schema needs a default catalog');
        await type('Default Catalog', 'hive');
        expect(draft().defaultCatalog).toBe('hive');
        expect(warning('Default Schema')).toBeNull();

        await click(catalogs.querySelector<HTMLButtonElement>('button[aria-label="Clear input"]')!);
        expect(draft().catalogs).toEqual([]);
    });

    it('writes the metadata as headers and keeps the raw rows', async () => {
        await render(trinoDatabase({ ...RESTORED, metadata: {} }));
        await click(container.querySelector<HTMLButtonElement>('button[aria-label="Add Header"]')!);
        await type('Additional Metadata name 1', 'x-a');
        await type('Additional Metadata value 1', '1');
        await click(container.querySelector<HTMLButtonElement>('button[aria-label="Add Header"]')!);
        await type('Additional Metadata name 2', 'x-a');
        await type('Additional Metadata value 2', '2');
        // Duplicate keys flatten to the last value, the rows keep both
        expect(draft().metadata).toEqual({ 'x-a': '2' });
        expect(draft().draftRows?.metadata).toEqual([{ key: 'x-a', value: '1' }, { key: 'x-a', value: '2' }]);
    });

    it('connects with the edited params and runs the health check on the channel', async () => {
        const channel = {} as TrinoChannelInterface;
        setup.mockImplementation(async () => channel);
        await render(trinoDatabase(RESTORED));
        await type('Endpoint', 'http://edited:8080');
        await click(container.querySelector<HTMLButtonElement>('[data-testid="connection-setup"]')!);
        await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce());
        const [dispatch, params, signal] = setup.mock.calls[0];
        expect(typeof dispatch).toBe('function');
        expect(params.endpoint).toBe('http://edited:8080');
        expect(params.auth?.basic?.username).toBe('alice');
        expect(signal.aborted).toBe(false);
        await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
        const [connectionId, args] = execute.mock.calls[0];
        expect(connectionId).toBe(CONNECTION_ID);
        expect(args.query).toBe('select 1');
        expect(args.channelOverride).toEqual({ type: 'trino', channel });
    });

    it('skips the health check without a channel', async () => {
        await render(trinoDatabase(RESTORED));
        await click(container.querySelector<HTMLButtonElement>('[data-testid="connection-setup"]')!);
        await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce());
        await act(async () => { await Promise.resolve(); });
        expect(execute).not.toHaveBeenCalled();
    });

    it('swallows setup errors', async () => {
        setup.mockImplementation(async () => { throw new Error('unreachable'); });
        await render(trinoDatabase(RESTORED));
        await click(container.querySelector<HTMLButtonElement>('[data-testid="connection-setup"]')!);
        await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce());
        expect(execute).not.toHaveBeenCalled();
    });

    it('does not connect without a Trino setup', async () => {
        await render(trinoDatabase(RESTORED), null);
        await click(container.querySelector<HTMLButtonElement>('[data-testid="connection-setup"]')!);
        expect(execute).not.toHaveBeenCalled();
    });

    it('freezes the form while connecting and cancels the setup', async () => {
        let setupSignal: AbortSignal | null = null;
        setup.mockImplementation((dispatch, params, signal) => {
            setupSignal = signal;
            dispatch({ type: TRINO_CHANNEL_SETUP_STARTED, value: params });
            return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
        });
        await render(trinoDatabase(RESTORED));
        await click(container.querySelector<HTMLButtonElement>('[data-testid="connection-setup"]')!);
        await vi.waitFor(() => expect(current().connectionHealth).toBe(ConnectionHealth.CONNECTING));
        expect(input('Endpoint').disabled).toBe(true);
        expect(input('Username').readOnly).toBe(true);
        expect(button('OAuth 2.0').disabled).toBe(true);
        // A frozen auth type is not switched
        await click(button('OAuth 2.0'));
        expect(current().paramsDraft).toBeUndefined();

        await click(container.querySelector<HTMLButtonElement>('[data-testid="connection-cancel"]')!);
        expect(setupSignal!.aborted).toBe(true);
        await act(async () => { await Promise.resolve(); });
        expect(execute).not.toHaveBeenCalled();
    });

    it('resets an online connection on disconnect', async () => {
        await render(trinoDatabase(RESTORED, ConnectionHealth.ONLINE));
        const disconnect = container.querySelector<HTMLButtonElement>('[data-testid="connection-reset"]')!;
        expect(disconnect.textContent).toContain('Disconnect');
        await click(disconnect);
        expect(reset).toHaveBeenCalledOnce();
        // The setup receives the dispatch of the connection
        await act(async () => reset.mock.calls[0][0]({ type: RESET_CONNECTION, value: null }));
        expect(current().connectionHealth).toBe(ConnectionHealth.NOT_STARTED);
    });

    it('brings the connection online when the health check succeeds', async () => {
        setup.mockImplementation(async () => ({} as TrinoChannelInterface));
        await render(trinoDatabase(RESTORED));
        await click(container.querySelector<HTMLButtonElement>('[data-testid="connection-setup"]')!);
        await vi.waitFor(() => expect(current().connectionHealth).toBe(ConnectionHealth.ONLINE));
        expect(container.querySelector('[data-testid="connection-reset"]')).not.toBeNull();
    });

    it('closes through the header', async () => {
        await render(trinoDatabase(RESTORED));
        await click(container.querySelector<HTMLButtonElement>('[data-testid="connection-close"]')!);
        expect(onClose).toHaveBeenCalledOnce();
    });
});
