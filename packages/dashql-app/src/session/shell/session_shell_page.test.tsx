import * as arrow from 'apache-arrow';
import * as dashql from '@ankoh/dashql-core';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputationRegistry, useComputationRegistry } from '../../compute/computation_registry.js';
import { ComputeConnectionProvider } from '../../compute/compute_connection_provider.js';
import { COMPUTATION_FROM_QUERY_RESULT } from '../../compute/computation_state.js';
import { AppConfigProvider, useAppReconfigure, type AppConfig } from '../../config/app_config.js';
import { ConnectionRegistry, useConnectionRegistry } from '../../connections/connection_registry.js';
import { ConnectionHealth, createConnectionMetrics, type ConnectionState } from '../../connections/connection_state.js';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType, HYPER_CONNECTOR } from '../../connections/connector_info.js';
import { EXECUTOR_CTX, type QueryExecutorContextValue } from '../../connections/query_executor.js';
import { SALESFORCE_CLIENT_FUNCTIONS } from '../../connections/salesforce/salesforce_client_functions.js';
import { EmbeddedDatabaseProvider } from '../../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '../../platform/database/embedded_database.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { QueryExecutionStatus } from '../../query/query_execution_state.js';
import { DashQLCoreProvider } from '../../runtime/core_provider.js';
import { DashQLShell, type DashQLShellOptions } from '../../shell/api.js';
import { ShellFileRegistry } from '../../shell/shell_files.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { SessionTestBackend } from '../../storage/session_test_backend.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';
import { SessionViewMode, SessionViewModeProvider, useSessionViewMode } from '../session_view_mode.js';
import { resolveClientFunctionCall } from './session_shell_environment.js';
import { SessionShellPage, type SessionShellPageDependencies } from './session_shell_page.js';
import * as completionListStyles from '../../views/completion_list/completion_list.module.css';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const WAIT = { timeout: 8000 };
const SESSION_ID = 'session';
const MAIN = 'main';
const OTHER = 'other';

let core: dashql.DashQL;

/// Load relations into the catalog of a connection
function loadRelations(catalog: dashql.DashQLCatalog, sql: string): void {
    const script = core.createScript(catalog);
    script.replaceText(sql);
    script.analyze();
    catalog.loadScript(script, dashql.buffers.catalog.CatalogLayer.CONNECTION);
}

function createConnection(connectionId: string, options: {
    setupParams?: object;
    relationsSql?: string;
    queriesFinished?: Map<number, unknown>;
} = {}): ConnectionState {
    const catalog = core.createCatalog();
    if (options.relationsSql != null) loadRelations(catalog, options.relationsSql);
    return {
        connectionId,
        active: false,
        connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
        connectionHealth: ConnectionHealth.ONLINE,
        metrics: createConnectionMetrics(),
        params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } },
        details: { type: HYPER_CONNECTOR, value: { proto: { setupParams: options.setupParams ?? { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } } },
        catalog,
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: options.queriesFinished ?? new Map(),
        queriesFinishedOrdered: [],
    } as unknown as ConnectionState;
}

function finishedQuery(queryId: number, resultTable: arrow.Table) {
    return { queryId, status: QueryExecutionStatus.SUCCEEDED, resultTable, queryMetadata: { sessionId: SESSION_ID } };
}

/// What the tests reach through the providers
interface Api {
    setConnections(connections: ConnectionState[]): void;
    computations(): number[];
    createComputation(queryId: number, table: arrow.Table): void;
    mode(): SessionViewMode;
    reconfigure(settings: AppConfig['settings']): void;
}

function Capture(props: { capture: (api: Api) => void; children: React.ReactElement }) {
    const [, setRegistry] = useConnectionRegistry();
    const [computations, dispatch] = useComputationRegistry();
    const { mode } = useSessionViewMode();
    const reconfigure = useAppReconfigure();
    props.capture({
        setConnections: connections => setRegistry(prev => {
            const next = { ...prev, connections: new Map(prev.connections), connectionsByType: CONNECTOR_TYPES.map(() => [] as string[]) };
            for (const connection of connections) {
                next.connections.set(connection.connectionId, connection);
                next.connectionsByType[connection.connectorInfo.connectorType].push(connection.connectionId);
            }
            return next;
        }),
        computations: () => Object.keys(computations.tableComputations).map(Number),
        createComputation: (queryId, table) => dispatch({
            type: COMPUTATION_FROM_QUERY_RESULT,
            value: [queryId, table, [], new AbortController()],
        }),
        mode: () => mode,
        reconfigure: settings => reconfigure(config => ({ ...(config ?? {}), settings } as AppConfig)),
    });
    return props.children;
}

/// The overlay has its own tests, this shows which result the page opens
const dependencies: SessionShellPageDependencies = {
    ShellQueryResultOverlay: ({ query, onClose }) => (
        <div role="dialog" data-query-id={query.queryId}>
            <button type="button" aria-label="Close shell query results" onClick={onClose} />
        </div>
    ),
};

describe('SessionShellPage', () => {
    let container: HTMLDivElement;
    let root: Root;
    let api: Api;
    let created: DashQLShell[];
    let destroyed: Set<DashQLShell>;
    let nextQueryId: number;
    let execute: ReturnType<typeof vi.fn>;
    let cancel: ReturnType<typeof vi.fn>;
    let executor: QueryExecutorContextValue;
    let database: EmbeddedComputeDatabase | null;
    let transcript: string[];
    let backend: SessionTestBackend;
    let createShell: (options: DashQLShellOptions) => Promise<DashQLShell>;

    beforeEach(async () => {
        core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        created = [];
        destroyed = new Set();
        createShell = DashQLShell.create.bind(DashQLShell);
        vi.spyOn(DashQLShell, 'create').mockImplementation(async options => {
            const shell = await createShell(options);
            created.push(shell);
            return shell;
        });
        const destroy = DashQLShell.prototype.destroy;
        vi.spyOn(DashQLShell.prototype, 'destroy').mockImplementation(function (this: DashQLShell) {
            destroyed.add(this);
            destroy.call(this);
        });
        transcript = [];
        backend = new SessionTestBackend();
        const { Terminal } = await import('@xterm/xterm');
        const write = Terminal.prototype.write;
        vi.spyOn(Terminal.prototype, 'write').mockImplementation(function (this: InstanceType<typeof Terminal>, data: string | Uint8Array, callback?: () => void) {
            transcript.push(String(data));
            write.call(this, data, callback);
        });
        nextQueryId = 100;
        execute = vi.fn((_connectionId: string, _args: unknown) => [
            nextQueryId++,
            Promise.resolve(tableFromArrays({ answer: [42] })),
        ]);
        cancel = vi.fn();
        executor = { execute, cancel, watchProfile: vi.fn() } as unknown as QueryExecutorContextValue;
        database = null;
        // The app config has no settings until a test sets them
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
        container = document.createElement('div');
        container.style.width = '1000px';
        container.style.height = '500px';
        container.style.display = 'flex';
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
        vi.unstubAllGlobals();
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        vi.restoreAllMocks();
        // Shells that a page loaded and no longer needs are destroyed once their load ends
        await vi.waitFor(() => expect(created.filter(shell => !destroyed.has(shell))).toEqual([]), WAIT);
    });

    interface PageProps {
        connectionId?: string;
        sessionName?: string | null;
        ordinal?: number | null;
        active?: boolean;
    }

    function tree(props: PageProps = {}) {
        return (
            <LoggerProvider>
                <StorageProvider backend={backend}>
                    <AppConfigProvider>
                        <ConnectionRegistry>
                            <ComputationRegistry>
                                <EmbeddedDatabaseProvider setupDatabase={async () => database ?? ({} as EmbeddedComputeDatabase)}>
                                    <ComputeConnectionProvider>
                                        <EXECUTOR_CTX.Provider value={executor}>
                                            <MemoryRouter initialEntries={['/?view=dashboard']}>
                                                <SessionViewModeProvider>
                                                    <DashQLCoreProvider>
                                                        <Capture capture={next => { api = next; }}>
                                                            <SessionShellPage
                                                                dependencies={dependencies}
                                                                sessionId={SESSION_ID}
                                                                sessionName={props.sessionName === undefined ? 'My session' : props.sessionName}
                                                                connectionId={props.connectionId ?? MAIN}
                                                                ordinal={props.ordinal === undefined ? 2 : props.ordinal}
                                                                active={props.active ?? true}
                                                            />
                                                        </Capture>
                                                    </DashQLCoreProvider>
                                                </SessionViewModeProvider>
                                            </MemoryRouter>
                                        </EXECUTOR_CTX.Provider>
                                    </ComputeConnectionProvider>
                                </EmbeddedDatabaseProvider>
                            </ComputationRegistry>
                        </ConnectionRegistry>
                    </AppConfigProvider>
                </StorageProvider>
            </LoggerProvider>
        );
    }

    function render(props: PageProps = {}) {
        act(() => root.render(tree(props)));
    }

    const status = () => container.querySelector('[role="status"]')?.textContent ?? null;
    const page = () => container.querySelector('main');
    const input = () => container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    /// What the page wrote to the terminal without its escape sequences. The renderer of xterm pauses in a test frame,
    /// so the rows of the terminal go stale.
    const screen = () => transcript.join('').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
    /// The names in the completion list over the terminal
    const completionNames = () => Array.from(
        container.querySelectorAll(`[data-dashql-completion-list] .${completionListStyles.candidate_name}`),
        name => name.textContent,
    );

    /// Mount the page and wait until its terminal shows the prompt
    async function open(connections: ConnectionState[] = [createConnection(MAIN)], props: PageProps = {}, prompt = 'hyper#2> ') {
        render(props);
        act(() => api.setConnections(connections));
        await vi.waitFor(() => expect(screen()).toContain(prompt), WAIT);
        await vi.waitFor(() => expect(status()).toBeNull(), WAIT);
    }

    /// Paste into the terminal, Firefox does not take clipboard data when constructing a ClipboardEvent
    function type(text: string) {
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
        input()!.dispatchEvent(event);
    }

    function press(key: string, init: KeyboardEventInit = {}) {
        input()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    }

    function run(text: string) {
        type(text);
        press('Enter');
    }

    /// Click an element of the page or its dialogs once it is there
    async function click(selector: string) {
        await vi.waitFor(() => expect(document.querySelector(selector)).not.toBeNull(), WAIT);
        act(() => document.querySelector<HTMLElement>(selector)!.click());
    }

    describe('while it starts', () => {
        it('names the connection and the session in the greeter', async () => {
            await open();
            expect(screen()).toContain('Hyper #2');
            expect(screen()).toContain('Session: My session');
            expect(screen()).toContain('Enter .help for usage hints.');
            expect(page()?.getAttribute('aria-label')).toContain('Hyper #2');
            expect(page()?.getAttribute('aria-label')).toContain('Shell');
        });

        it('leaves out the session and the ordinal when there are none', async () => {
            await open([createConnection(MAIN)], { sessionName: null, ordinal: null }, 'hyper> ');
            expect(screen()).not.toContain('Session:');
            expect(screen()).not.toContain('#');
        });

        it('waits for its connection', async () => {
            render();
            expect(status()).toContain('Instantiating Shell');
            expect(page()?.getAttribute('aria-label')).toBe('Shell');
            expect(input()).toBeNull();
            expect(DashQLShell.create).not.toHaveBeenCalled();
            act(() => api.setConnections([createConnection(MAIN)]));
            await vi.waitFor(() => expect(screen()).toContain('hyper#2> '), WAIT);
        });

        it('reports a shell that cannot load', async () => {
            vi.mocked(DashQLShell.create).mockRejectedValueOnce(new Error('shell is broken'));
            render();
            act(() => api.setConnections([createConnection(MAIN)]));
            await vi.waitFor(() => expect(status()).toContain('Failed to load shell: shell is broken'), WAIT);
            expect(input()).toBeNull();
        });

        it('destroys a shell that finishes loading after the page closed', async () => {
            let finish = () => { };
            vi.mocked(DashQLShell.create).mockImplementationOnce(async options => {
                await new Promise<void>(resolve => { finish = resolve; });
                const shell = await createShell(options);
                created.push(shell);
                return shell;
            });
            render();
            act(() => api.setConnections([createConnection(MAIN)]));
            await vi.waitFor(() => expect(DashQLShell.create).toHaveBeenCalled(), WAIT);
            act(() => root.render(<div />));
            finish();
            await vi.waitFor(() => expect(created).toHaveLength(1), WAIT);
            await vi.waitFor(() => expect(destroyed.has(created[0])).toBe(true), WAIT);
        });
    });

    describe('with queries', () => {
        it('runs a query on its connection and prints the result', async () => {
            await open();
            run('select 42 as answer;');
            await vi.waitFor(() => expect(screen()).toContain('answer'), WAIT);
            await vi.waitFor(() => expect(screen()).toMatch(/42\s/), WAIT);
            expect(execute).toHaveBeenCalledTimes(1);
            const [connectionId, args] = execute.mock.calls[0] as [string, { query: string; metadata: { sessionId: string } }];
            expect(connectionId).toBe(MAIN);
            expect(args.query).toContain('select 42 as answer');
            expect(args.metadata.sessionId).toBe(SESSION_ID);
        });

        it('prints a failed query and stays usable', async () => {
            execute.mockImplementationOnce(() => [nextQueryId++, Promise.reject(new Error('table is gone'))]);
            await open();
            run('select 1;');
            await vi.waitFor(() => expect(screen()).toContain('table is gone'), WAIT);
            run('select 42 as answer;');
            await vi.waitFor(() => expect(screen()).toContain('answer'), WAIT);
            expect(execute).toHaveBeenCalledTimes(2);
        });

        /// Run a query that the overlay shows
        async function showResult(table: arrow.Table, connections: ConnectionState[]): Promise<number> {
            const queryId = nextQueryId;
            for (const connection of connections) {
                connection.queriesFinished.set(queryId, finishedQuery(queryId, table) as never);
            }
            act(() => api.createComputation(queryId, table));
            execute.mockImplementationOnce(() => [nextQueryId++, Promise.resolve(table)]);
            run('select * from t;');
            return queryId;
        }
        const overlay = () => document.querySelector('[role="dialog"]');
        const closeOverlay = () => document.querySelector<HTMLButtonElement>('[aria-label="Close shell query results"]');

        it('opens the overlay with .output ui and releases the result when it closes', async () => {
            const connection = createConnection(MAIN);
            const table = tableFromArrays({ answer: [42] });
            await open([connection]);
            run('.output ui');
            await vi.waitFor(() => expect(screen()).toContain('Query output: ui'), WAIT);

            const queryId = await showResult(table, [connection]);
            await vi.waitFor(() => expect(overlay()).not.toBeNull(), WAIT);
            expect(api.computations()).toContain(queryId);

            act(() => closeOverlay()!.click());
            expect(overlay()).toBeNull();
            await vi.waitFor(() => expect(api.computations()).not.toContain(queryId), WAIT);
        });

        it('releases the shown result when another one replaces it', async () => {
            const connection = createConnection(MAIN);
            const table = tableFromArrays({ answer: [42] });
            await open([connection]);
            run('.output ui');
            await vi.waitFor(() => expect(screen()).toContain('Query output: ui'), WAIT);

            const first = await showResult(table, [connection]);
            await vi.waitFor(() => expect(overlay()).not.toBeNull(), WAIT);
            const second = await showResult(table, [connection]);
            await vi.waitFor(() => expect(api.computations()).not.toContain(first), WAIT);
            expect(api.computations()).toContain(second);
        });

        it('opens the overlay when a result does not fit the terminal', async () => {
            const connection = createConnection(MAIN);
            const columns = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`long_column_name_${i}`, [i]]));
            await open([connection]);
            await showResult(tableFromArrays(columns), [connection]);
            await vi.waitFor(() => expect(overlay()).not.toBeNull(), WAIT);
        });

        it('sizes the results by the width of the terminal', async () => {
            const connection = createConnection(MAIN);
            const resize = vi.spyOn(DashQLShell.prototype, 'resize');
            const table = tableFromArrays(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`column_${i}`, [i]])));

            await open([connection]);
            await vi.waitFor(() => expect(resize).toHaveBeenCalled(), WAIT);
            await showResult(table, [connection]);
            await vi.waitFor(() => expect(screen()).toContain('column_4'), WAIT);
            expect(overlay()).toBeNull();

            // The terminal gets too narrow for the same result
            resize.mockClear();
            container.style.width = '220px';
            await vi.waitFor(() => expect(resize).toHaveBeenCalled(), WAIT);
            await showResult(table, [connection]);
            await vi.waitFor(() => expect(overlay()).not.toBeNull(), WAIT);
        });
    });

    describe('with commands', () => {
        it('leaves the shell with Ctrl+D', async () => {
            await open();
            expect(api.mode()).toBe(SessionViewMode.Dashboard);
            press('d', { ctrlKey: true });
            await vi.waitFor(() => expect(api.mode()).toBe(SessionViewMode.Session), WAIT);
        });

        it('offers .fs only for a connection on the embedded database', async () => {
            await open();
            run('.help');
            await vi.waitFor(() => expect(screen()).toContain('.output'), WAIT);
            expect(screen()).toContain('.examples');
            expect(screen()).not.toContain('.fs');
        });

        it('mounts files for a connection on the embedded database and drops them with the page', async () => {
            const dispose = vi.spyOn(ShellFileRegistry.prototype, 'dispose');
            database = {} as EmbeddedComputeDatabase;
            await open([createConnection(MAIN, { setupParams: { protocol: 'WASM' } })]);
            run('.help');
            await vi.waitFor(() => expect(screen()).toContain('.fs'), WAIT);
            expect(dispose).not.toHaveBeenCalled();
            act(() => root.render(<div />));
            expect(dispose).toHaveBeenCalled();
        });

        it('fills the prompts of a snippet and runs them one by one', async () => {
            const finished = vi.spyOn(DashQLShell.prototype, 'finishTerminalQuery');
            await open();
            run('.examples');
            await vi.waitFor(() => expect(document.querySelector('[data-testid="snippets-overlay"]')).not.toBeNull(), WAIT);
            await click('[data-testid="snippet"]');
            await click('[data-testid="snippet-apply"]');
            await vi.waitFor(() => expect(document.querySelector('[data-testid="snippets-overlay"]')).toBeNull(), WAIT);
            await vi.waitFor(() => expect(finished).toHaveBeenCalled(), WAIT);
            // Inserting never runs a statement
            expect(execute).not.toHaveBeenCalled();
            press('Enter');
            await vi.waitFor(() => expect(execute).toHaveBeenCalled(), WAIT);
        });

        it('leaves the prompt empty when the snippets are closed', async () => {
            const finished = vi.spyOn(DashQLShell.prototype, 'finishTerminalQuery');
            await open();
            run('.examples');
            await click('[data-testid="snippets-close"]');
            await vi.waitFor(() => expect(finished).toHaveBeenCalled(), WAIT);
            press('Enter');
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(execute).not.toHaveBeenCalled();
            run('select 42 as answer;');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
        });
    });

    describe('with client functions', () => {
        /// A connection whose catalog has the Data 360 client functions
        async function openWithSpec() {
            const connection = createConnection(MAIN);
            connection.catalog.registerClientFunctions(JSON.stringify(await SALESFORCE_CLIENT_FUNCTIONS.loadSpec()));
            await open([connection]);
        }
        const lastArgs = () => execute.mock.calls[execute.mock.calls.length - 1][1] as { query: string; clientFunctionCall?: unknown };

        it('runs a call in the namespace as a client function', async () => {
            await openWithSpec();
            run("call cdp.segment_list (dataspace => 'default');");
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
            expect(execute.mock.calls[0][0]).toBe(MAIN);
            expect(lastArgs().query).toContain('call cdp.segment_list');
            expect(lastArgs().clientFunctionCall).toEqual({
                namespace: 'cdp',
                function: 'segment_list',
                effect: 'read',
                explain: false,
                options: { dataspace: 'default' },
            });
        });

        it('explains a call as a client function', async () => {
            await openWithSpec();
            run('explain call cdp.segment_list ();');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
            expect(lastArgs().clientFunctionCall).toMatchObject({ function: 'segment_list', explain: true });
        });

        it('leaves a statement without a call to the backend', async () => {
            await openWithSpec();
            run('select 42 as answer;');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
            expect(lastArgs().clientFunctionCall).toBeUndefined();
        });

        it('leaves a call to the backend on a connection without the spec', async () => {
            await open();
            run('call cdp.segment_list ();');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
            expect(lastArgs().clientFunctionCall).toBeUndefined();
        });

        it('fails a call that the spec does not know without running anything', async () => {
            await openWithSpec();
            run('call cdp.segment_lisst ();');
            await vi.waitFor(() => expect(screen()).toContain('segment_lisst'), WAIT);
            await vi.waitFor(() => expect(screen()).toMatch(/segment_list/), WAIT);
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(execute).not.toHaveBeenCalled();
        });

        it('fails a parameter without a value without running anything', async () => {
            await openWithSpec();
            run('call cdp.segment_list (dataspace => :space);');
            await vi.waitFor(() => expect(screen()).toContain('input :space has no value'), WAIT);
            expect(execute).not.toHaveBeenCalled();
        });

        it('fails a call that does not parse without running anything', async () => {
            await openWithSpec();
            run('call cdp.segment_list (dataspace => );');
            await vi.waitFor(() => expect(screen()).toMatch(/syntax error/i), WAIT);
            expect(execute).not.toHaveBeenCalled();
        });

        it('fails an EXPLAIN with options of a call without running anything', async () => {
            await openWithSpec();
            run('explain (analyze) call cdp.segment_list ();');
            await vi.waitFor(() => expect(screen()).toMatch(/syntax error/i), WAIT);
            expect(execute).not.toHaveBeenCalled();
        });

        it('fails a call next to another statement', async () => {
            const catalog = core.createCatalog();
            catalog.registerClientFunctions(JSON.stringify(await SALESFORCE_CLIENT_FUNCTIONS.loadSpec()));
            expect(() => resolveClientFunctionCall(catalog, 'select 1; call cdp.segment_list ();')).toThrow('statement of its own');
        });
    });

    describe('when its inputs change', () => {
        it('completes names of the catalog', async () => {
            await open([createConnection(MAIN, { relationsSql: 'create table orders (id integer);' })]);
            type('select * from ord');
            await vi.waitFor(() => expect(completionNames()).toContain('orders'), WAIT);
            for (let i = 0; i < completionNames().indexOf('orders'); ++i) press('ArrowDown');
            press('Tab');
            await vi.waitFor(() => expect(screen()).toContain('orders'), WAIT);
        });

        it('runs on the catalog of its connection', async () => {
            const connection = createConnection(MAIN);
            await open([connection]);
            expect(created[0].catalog).toBe(connection.catalog);
        });

        it('leaves the catalog to its connection when it closes', async () => {
            const connection = createConnection(MAIN, { relationsSql: 'create table orders (id integer);' });
            await open([connection]);
            act(() => root.render(<div />));
            await vi.waitFor(() => expect(destroyed.has(created[0])).toBe(true), WAIT);
            loadRelations(connection.catalog, 'create table items (id integer);');
        });

        it('completes what the catalog gets after the shell opened, on the same shell', async () => {
            const connection = createConnection(MAIN, { relationsSql: 'create table orders (id integer);' });
            await open([connection]);
            loadRelations(connection.catalog, 'create table items (id integer);');
            type('select * from ite');
            press('Tab');
            await vi.waitFor(() => expect(screen()).toContain('items'), WAIT);
            expect(created).toHaveLength(1);
        });

        it('completes client functions that are registered after the shell opened', async () => {
            const connection = createConnection(MAIN);
            await open([connection]);
            connection.catalog.registerClientFunctions(JSON.stringify(await SALESFORCE_CLIENT_FUNCTIONS.loadSpec()));
            type('call cdp.access_policy_g');
            press('Tab');
            await vi.waitFor(() => expect(screen()).toContain('access_policy_get'), WAIT);
            expect(created).toHaveLength(1);
        });

        it('keeps the history when the shell is replaced', async () => {
            await open();
            run('select 42 as answer;');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
            await vi.waitFor(() => expect(screen()).toContain('answer'), WAIT);

            render({ ordinal: 1 });
            await vi.waitFor(() => expect(created).toHaveLength(2), WAIT);
            await vi.waitFor(() => expect(destroyed.has(created[0])).toBe(true), WAIT);
            expect(destroyed.has(created[1])).toBe(false);
            await vi.waitFor(() => expect(status()).toBeNull(), WAIT);

            transcript.length = 0;
            press('ArrowUp');
            await vi.waitFor(() => expect(screen()).toContain('select 42 as answer'), WAIT);
        });

        it('takes the prompt of a new ordinal', async () => {
            const connection = createConnection(MAIN);
            await open([connection]);
            render({ ordinal: 1 });
            await vi.waitFor(() => expect(created).toHaveLength(2), WAIT);
            await vi.waitFor(() => expect(status()).toBeNull(), WAIT);
            await vi.waitFor(() => expect(screen()).toContain('hyper#1> '), WAIT);
        });

        it('destroys a shell that is out of date when it finishes loading', async () => {
            await open();
            render({ ordinal: 1 });
            render({ ordinal: 3 });
            await vi.waitFor(() => expect(status()).toBeNull(), WAIT);
            await vi.waitFor(() => expect(created.length).toBeGreaterThanOrEqual(2), WAIT);
            await vi.waitFor(() => expect(screen()).toContain('hyper#3> '), WAIT);
        });

        /// Run a function when the page opens its first terminal, which takes a while
        async function whileTerminalOpens(run: () => void) {
            const { Terminal } = await import('@xterm/xterm');
            const realOpen = Terminal.prototype.open;
            const open = vi.spyOn(Terminal.prototype, 'open');
            open.mockImplementationOnce(function (this: InstanceType<typeof Terminal>, parent: HTMLElement) {
                realOpen.call(this, parent);
                run();
            });
            return { Terminal };
        }

        it('shows one terminal when the inputs change while the terminal opens', async () => {
            await whileTerminalOpens(() => render({ ordinal: 1 }));
            render();
            act(() => api.setConnections([createConnection(MAIN)]));
            await vi.waitFor(() => expect(created.length).toBe(2), WAIT);
            await vi.waitFor(() => expect(status()).toBeNull(), WAIT);
            await new Promise(resolve => setTimeout(resolve, 200));
            expect(container.querySelectorAll('.xterm')).toHaveLength(1);
            expect(destroyed.has(created[0])).toBe(true);
            await vi.waitFor(() => expect(screen()).toContain('hyper#1> '), WAIT);
        });

        it('closes the terminal and its shell when the page closes while the terminal opens', async () => {
            const { Terminal } = await whileTerminalOpens(() => act(() => root.render(<div />)));
            const dispose = vi.spyOn(Terminal.prototype, 'dispose');
            render();
            act(() => api.setConnections([createConnection(MAIN)]));
            await vi.waitFor(() => expect(created).toHaveLength(1), WAIT);
            await vi.waitFor(() => expect(destroyed.has(created[0])).toBe(true), WAIT);
            await vi.waitFor(() => expect(dispose).toHaveBeenCalled(), WAIT);
        });

        it('destroys the shell when the terminal cannot open', async () => {
            const { Terminal } = await import('@xterm/xterm');
            vi.spyOn(Terminal.prototype, 'open').mockImplementationOnce(() => { throw new Error('no terminal'); });
            render();
            act(() => api.setConnections([createConnection(MAIN)]));
            await vi.waitFor(() => expect(status()).toContain('Failed to load shell: no terminal'), WAIT);
            expect(destroyed.has(created[0])).toBe(true);
        });

        it('prints a shell that failed to load into the terminal it keeps', async () => {
            await open();
            vi.mocked(DashQLShell.create).mockRejectedValueOnce(new Error('shell is broken'));
            render({ ordinal: 1 });
            await vi.waitFor(() => expect(screen()).toContain('Failed to load shell: shell is broken'), WAIT);
            expect(status()).toContain('shell is broken');
            // The shell that is there still runs queries
            run('select 42 as answer;');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
        });

        it('closes the result when the connection changes', async () => {
            const connections = [createConnection(MAIN), createConnection(OTHER)];
            await open(connections);
            run('.output ui');
            await vi.waitFor(() => expect(screen()).toContain('Query output: ui'), WAIT);
            const table = tableFromArrays({ answer: [42] });
            const queryId = nextQueryId;
            connections[0].queriesFinished.set(queryId, finishedQuery(queryId, table) as never);
            execute.mockImplementationOnce(() => [nextQueryId++, Promise.resolve(table)]);
            run('select * from t;');
            await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull(), WAIT);

            render({ connectionId: OTHER });
            await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull(), WAIT);
            await vi.waitFor(() => expect(status()).toBeNull(), WAIT);
            await vi.waitFor(() => expect(created.length).toBeGreaterThanOrEqual(2), WAIT);
            run('select 42 as answer;');
            await vi.waitFor(() => expect(execute.mock.calls[execute.mock.calls.length - 1]?.[0]).toBe(OTHER), WAIT);
        });

        it('applies the keyword case of the settings', async () => {
            await open();
            type('sel');
            press('Tab');
            await vi.waitFor(() => expect(screen()).toContain('select'), WAIT);
            press('c', { ctrlKey: true });
            act(() => api.reconfigure({ keywordCase: 'upper' } as AppConfig['settings']));
            type('sel');
            press('Tab');
            await vi.waitFor(() => expect(screen()).toContain('SELECT'), WAIT);
        });

        it('focuses the terminal when it becomes active', async () => {
            await open();
            await vi.waitFor(() => expect(document.activeElement).toBe(input()), WAIT);
            // The terminal also takes the focus in the first frame after it opened
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
            input()!.blur();
            render({ active: false });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(document.activeElement).not.toBe(input());
            render({ active: true });
            await vi.waitFor(() => expect(document.activeElement).toBe(input()), WAIT);
        });

        it('leaves the focus alone when the page goes to the background while the terminal opens', async () => {
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            outside.focus();
            await whileTerminalOpens(() => act(() => root.render(tree({ active: false }))));
            await open([createConnection(MAIN)]);
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
            expect(document.activeElement).toBe(outside);
            outside.remove();
        });

        it('leaves the focus alone when a shell of a hidden page starts', async () => {
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            outside.focus();
            await open([createConnection(MAIN)], { active: false });
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
            expect(document.activeElement).toBe(outside);
            outside.remove();
        });
    });
});
