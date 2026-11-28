import * as arrow from 'apache-arrow';
import * as dashql from '@akohn/dashql';
import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRuntime } from '@akohn/dashql-react/hooks';
import { AppConfigProvider, useAppReconfigure, type AppConfig } from '../../config/app_config.js';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import type { Runtime } from '@akohn/dashql/runtime';
import { addTestConnection, runTestQuery } from '../../tests/test_connections.js';
import { type TestQueryExecutorFunctions, TestRuntime } from '../../tests/test_runtime.js';
import { loadClientFunctionSpec } from '@akohn/dashql/platform/connections/clfn_specs';
import { EmbeddedDatabaseProvider } from '../../host/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '@akohn/dashql/platform/embedded_database';
import { LoggerProvider } from '../../host/logger_provider.js';
import { QueryType } from '@akohn/dashql/platform/query/query_execution_state';
import { DashQLCoreProvider } from '../../host/core_provider.js';
import { DashQLShell, type DashQLShellOptions } from '../../shell/terminal/api.js';
import { ShellFileRegistry } from '../../shell/terminal/shell_files.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { WorkbookViewMode, WorkbookViewModeProvider, useWorkbookViewMode } from '../workbook_view_mode.js';
import { resolveClientFunctionCall } from './workbook_shell_environment.js';
import { WorkbookShellPage, type WorkbookShellPageDependencies } from './workbook_shell_page.js';
import { ShellQueryResultOverlay } from './shell_query_result_overlay.js';
import { queryModelOf } from '../../tests/result_tables.js';
import { ProfileExecutionState } from '@akohn/dashql/platform/query/profile_execution_state';
import * as completionListStyles from '../editor/completion/completion_list.module.css';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const WAIT = { timeout: 8000 };
const WORKBOOK_ID = 'workbook';
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

/// A connection of a test: online, its catalog describes it
interface TestShellConnection {
    connectionId: string;
    /// The catalog of the connection, once the runtime of the test holds it. It reads only.
    readonly catalog: dashql.DashQLCatalog;
    /// Write the catalog of the connection as the catalog loader would
    write(write: (catalog: dashql.DashQLCatalog) => void): void;
    /// Create it in the runtime of the test, the runtime sets it up
    create(runtime: Runtime): Promise<void>;
}

function createConnection(connectionId: string, options: {
    setupParams?: object;
    relationsSql?: string;
    clientFunctions?: string;
} = {}): TestShellConnection {
    let runtime: Runtime | null = null;
    return {
        connectionId,
        get catalog() {
            const catalog = runtime?.catalog(connectionId) ?? null;
            if (catalog == null) throw new Error(`the runtime holds no connection ${connectionId}`);
            return catalog;
        },
        write(write: (catalog: dashql.DashQLCatalog) => void) {
            const catalog = runtime?.module != null ? runtime.core?.runtimeTestCatalog(runtime.module, connectionId) ?? null : null;
            if (catalog == null) throw new Error(`the runtime holds no connection ${connectionId}`);
            try {
                write(catalog);
            } finally {
                catalog.destroy();
            }
        },
        async create(into: Runtime) {
            runtime = into;
            if (into.connection(connectionId) != null) return;
            await addTestConnection(into, {
                connectionId,
                params: { hyper: options.setupParams ?? { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as never,
                active: false,
                health: ConnectionHealth.ONLINE,
            });
            // The catalog of the test is loaded by the test, the catalog loader doesn't describe the connection
            into.module.runCatalogLoader(false);
            into.flush();
            if (options.relationsSql != null) this.write(catalog => loadRelations(catalog, options.relationsSql!));
            if (options.clientFunctions != null) this.write(catalog => catalog.registerClientFunctions(options.clientFunctions!));
        },
    };
}

/// A finished query of a workbook on a connection
function finishedQuery(runtime: Runtime, connectionId: string): number {
    return runTestQuery(runtime, connectionId, 'select * from t;', {
        queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true, workbookId: WORKBOOK_ID,
    }, true);
}

/// What the tests reach through the providers
interface Api {
    runtime: Runtime;
    setConnections(connections: TestShellConnection[]): Promise<void>;
    computations(): number[];
    createComputation(queryId: number, table: arrow.Table): void;
    mode(): WorkbookViewMode;
    reconfigure(settings: AppConfig['settings']): void;
}

function Capture(props: { capture: (api: Api) => void; children: React.ReactElement }) {
    const runtime = useRuntime();
    const { mode } = useWorkbookViewMode();
    const reconfigure = useAppReconfigure();
    props.capture({
        runtime,
        setConnections: async connections => {
            for (const connection of connections) await connection.create(runtime);
        },
        computations: () => runtime.store.ids('computation'),
        // The analysis starts the computation of the result, without a compute database it stops after that
        createComputation: (queryId, table) => {
            void runtime.analyzeTable(queryId, table).catch(() => { });
        },
        mode: () => mode,
        reconfigure: settings => reconfigure(config => ({ ...(config ?? {}), settings } as AppConfig)),
    });
    return props.children;
}

/// Does the content of the overlay fail to render?
let resultFails = false;

/// The overlay has its own tests, this shows which result the page opens
const dependencies: WorkbookShellPageDependencies = {
    ShellQueryResultOverlay: props => resultFails ? (
        <ShellQueryResultOverlay
            {...props}
            dependencies={{
                QueryResultDetails: () => { throw new Error('boom'); },
                QueryProfileView: () => <></>,
                useQueryProfile: () => ({ plan: null, execution: ProfileExecutionState.EMPTY, rejected: false }),
                useResultModel: queryModelOf,
            }}
        />
    ) : (
        <div role="dialog" data-query-id={props.query.queryId}>
            <button type="button" aria-label="Close shell query results" onClick={props.onClose} />
        </div>
    ),
};

describe('WorkbookShellPage', () => {
    let container: HTMLDivElement;
    let root: Root;
    let api: Api;
    let created: DashQLShell[];
    let destroyed: Set<DashQLShell>;
    let nextQueryId: number;
    let execute: ReturnType<typeof vi.fn>;
    let cancel: ReturnType<typeof vi.fn>;
    let executor: TestQueryExecutorFunctions;
    let database: EmbeddedComputeDatabase | null;
    let backend: WorkbookTestBackend;
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
        backend = new WorkbookTestBackend();
        nextQueryId = 100;
        execute = vi.fn((_connectionId: string, _args: unknown) => [
            nextQueryId++,
            Promise.resolve(tableFromArrays({ answer: [42] })),
        ]);
        cancel = vi.fn();
        executor = { execute, cancel, watchProfile: vi.fn() } as unknown as TestQueryExecutorFunctions;
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
        // Shells that a page loaded and no longer needs are destroyed once their load ends, the spies count them
        await vi.waitFor(() => expect(created.filter(shell => !destroyed.has(shell))).toEqual([]), WAIT);
        vi.unstubAllGlobals();
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        vi.restoreAllMocks();
        resultFails = false;
    });

    interface PageProps {
        connectionId?: string;
        workbookName?: string | null;
        ordinal?: number | null;
        active?: boolean;
    }

    /// The label of the connection in the list of the connections, numbered by its ordinal
    const labelOf = (ordinal: number | null) => ordinal == null
        ? null
        : { name: `Hyper #${ordinal}`, connector: 'Hyper', detail: 'gRPC', text: `Hyper #${ordinal} gRPC` };

    function tree(props: PageProps = {}) {
        return (
            <LoggerProvider>
                <StorageProvider backend={backend}>
                    <AppConfigProvider>
                        <EmbeddedDatabaseProvider setupDatabase={async () => database ?? ({} as EmbeddedComputeDatabase)}>
                            <TestRuntime {...executor}>
                                <MemoryRouter initialEntries={['/?view=dashboard']}>
                                    <WorkbookViewModeProvider>
                                        <DashQLCoreProvider>
                                            <Capture capture={next => { api = next; }}>
                                                <WorkbookShellPage
                                                    dependencies={dependencies}
                                                    workbookId={WORKBOOK_ID}
                                                    workbookName={props.workbookName === undefined ? 'My workbook' : props.workbookName}
                                                    connectionId={props.connectionId ?? MAIN}
                                                    ordinal={props.ordinal === undefined ? 2 : props.ordinal}
                                                    label={labelOf(props.ordinal === undefined ? 2 : props.ordinal)}
                                                    active={props.active ?? true}
                                                />
                                            </Capture>
                                        </DashQLCoreProvider>
                                    </WorkbookViewModeProvider>
                                </MemoryRouter>
                            </TestRuntime>
                        </EmbeddedDatabaseProvider>
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
    /// The editable element of the prompt
    const input = () => container.querySelector<HTMLElement>('[data-testid="shell-prompt"] .cm-content');
    const editor = () => EditorView.findFromDOM(input()!)!;
    /// The text of the prompt
    const promptText = () => editor().state.doc.toString();
    /// The feed of the shell and its prompt, one line per entry
    const screen = () => {
        const feed = container.querySelector('[role="log"]');
        const entries = Array.from(feed?.children ?? [], entry => entry.textContent ?? '');
        const label = container.querySelector('[data-testid="shell-prompt"]')?.previousElementSibling?.textContent ?? '';
        return [...entries, `${label} ${input() == null ? '' : promptText()}`].join('\n');
    };
    /// The names in the completion list of the prompt, the list mounts outside of the page
    const completionNames = () => Array.from(
        document.querySelectorAll(`[data-dashql-completion-list] .${completionListStyles.candidate_name}`),
        name => name.textContent,
    );

    /// Mount the page and wait until its shell is ready
    async function open(connections: TestShellConnection[] = [createConnection(MAIN)], props: PageProps = {}, prompt = 'hyper#2> ') {
        render(props);
        await act(async () => api.setConnections(connections));
        await vi.waitFor(() => expect(screen()).toContain(prompt), WAIT);
        await vi.waitFor(() => expect(status()).toBeNull(), WAIT);
    }

    /// Type into the prompt, one character after another
    function type(text: string) {
        const view = editor();
        for (const character of text) {
            act(() => view.dispatch({ ...view.state.replaceSelection(character), userEvent: 'input.type' }));
        }
    }

    function press(key: string, init: KeyboardEventInit = {}) {
        act(() => { input()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
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
        it('names the connection and the workbook in the greeter', async () => {
            await open();
            expect(screen()).toContain('Hyper #2');
            expect(screen()).toContain('My workbook');
            expect(page()?.getAttribute('aria-label')).toContain('Hyper #2');
            expect(page()?.getAttribute('aria-label')).toContain('Shell');
        });

        it('leaves out the workbook and the ordinal when there are none', async () => {
            await open([createConnection(MAIN)], { workbookName: null, ordinal: null }, 'hyper> ');
            expect(screen()).not.toContain('Workbook:');
            expect(screen()).not.toContain('#');
        });

        it('waits for its connection', async () => {
            render();
            expect(status()).toContain('Instantiating Shell');
            expect(page()?.getAttribute('aria-label')).toBe('Shell');
            expect(input()).toBeNull();
            expect(DashQLShell.create).not.toHaveBeenCalled();
            await act(async () => api.setConnections([createConnection(MAIN)]));
            await vi.waitFor(() => expect(screen()).toContain('hyper#2> '), WAIT);
        });

        it('reports a shell that cannot load', async () => {
            vi.mocked(DashQLShell.create).mockRejectedValueOnce(new Error('shell is broken'));
            render();
            await act(async () => api.setConnections([createConnection(MAIN)]));
            await vi.waitFor(() => expect(status()).toContain('Failed to load shell: shell is broken'), WAIT);
            // There is no prompt without a shell
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
            await act(async () => api.setConnections([createConnection(MAIN)]));
            await vi.waitFor(() => expect(DashQLShell.create).toHaveBeenCalled(), WAIT);
            act(() => root.render(<div />));
            finish();
            await vi.waitFor(() => expect(created).toHaveLength(1), WAIT);
            await vi.waitFor(() => expect(destroyed.has(created[0])).toBe(true), WAIT);
        });
    });

    describe('with queries', () => {
        it('runs a query on its connection and prints a status line', async () => {
            await open();
            run('select 42 as answer;');
            await vi.waitFor(() => expect(screen()).toContain('1 row'), WAIT);
            expect(execute).toHaveBeenCalledTimes(1);
            const [connectionId, args] = execute.mock.calls[0] as [string, { query: string; metadata: { workbookId: string } }];
            expect(connectionId).toBe(MAIN);
            expect(args.query).toContain('select 42 as answer');
            expect(args.metadata.workbookId).toBe(WORKBOOK_ID);
        });

        it('prints a failed query and stays usable', async () => {
            execute.mockImplementationOnce(() => [nextQueryId++, Promise.reject(new Error('table is gone'))]);
            await open();
            run('select 1;');
            await vi.waitFor(() => expect(screen()).toContain('table is gone'), WAIT);
            run('select 42 as answer;');
            await vi.waitFor(() => expect(screen()).toContain('1 row'), WAIT);
            expect(execute).toHaveBeenCalledTimes(2);
        });

        /// Run a query that the overlay shows
        async function showResult(table: arrow.Table): Promise<number> {
            const queryId = finishedQuery(api.runtime, MAIN);
            act(() => api.createComputation(queryId, table));
            execute.mockImplementationOnce(() => [queryId, Promise.resolve(table)]);
            run('select * from t;');
            return queryId;
        }
        const overlay = () => document.querySelector('[role="dialog"]');
        const closeOverlay = () => document.querySelector<HTMLButtonElement>('[aria-label="Close shell query results"]');

        it('opens the result in the overlay and again with .last after it closed', async () => {
            const connection = createConnection(MAIN);
            const table = tableFromArrays({ answer: [42] });
            await open([connection]);

            const queryId = await showResult(table);
            await vi.waitFor(() => expect(overlay()).not.toBeNull(), WAIT);
            expect(screen()).toContain('1 row');
            expect(api.computations()).toContain(queryId);

            act(() => closeOverlay()!.click());
            expect(overlay()).toBeNull();
            expect(api.computations()).toContain(queryId);

            run('.last');
            await vi.waitFor(() => expect(overlay()?.getAttribute('data-query-id')).toBe(String(queryId)), WAIT);
        });

        it('has no result to show with .last before the first query', async () => {
            await open();
            run('.last');
            await vi.waitFor(() => expect(screen()).toContain('No result to show'), WAIT);
            expect(overlay()).toBeNull();
        });

        it('keeps the shell when a result fails to render', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => { });
            const connection = createConnection(MAIN);
            const table = tableFromArrays({ answer: [42] });
            await open([connection]);

            resultFails = true;
            const failed = await showResult(table);
            await vi.waitFor(() => expect(screen()).toContain('Failed to show the result: boom'), WAIT);
            expect(overlay()).toBeNull();
            await vi.waitFor(() => expect(api.computations()).not.toContain(failed), WAIT);
            run('.last');
            await vi.waitFor(() => expect(screen()).toContain('No result to show'), WAIT);

            // The next result opens again
            resultFails = false;
            await showResult(table);
            await vi.waitFor(() => expect(overlay()).not.toBeNull(), WAIT);
        });

        it('releases the shown result when another one replaces it', async () => {
            const connection = createConnection(MAIN);
            const table = tableFromArrays({ answer: [42] });
            await open([connection]);

            const first = await showResult(table);
            await vi.waitFor(() => expect(overlay()).not.toBeNull(), WAIT);
            const second = await showResult(table);
            await vi.waitFor(() => expect(api.computations()).not.toContain(first), WAIT);
            expect(api.computations()).toContain(second);
        });
    });

    describe('with commands', () => {
        it('leaves the shell with Ctrl+D', async () => {
            await open();
            expect(api.mode()).toBe(WorkbookViewMode.Dashboard);
            press('d', { ctrlKey: true });
            await vi.waitFor(() => expect(api.mode()).toBe(WorkbookViewMode.Workbook), WAIT);
        });

        it('offers .fs only for a connection on the embedded database', async () => {
            await open();
            run('.help');
            await vi.waitFor(() => expect(screen()).toContain('.last'), WAIT);
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
            const submit = vi.spyOn(DashQLShell.prototype, 'submit');
            await open();
            run('.examples');
            await vi.waitFor(() => expect(document.querySelector('[data-testid="snippets-overlay"]')).not.toBeNull(), WAIT);
            await click('[data-testid="snippet"]');
            await click('[data-testid="snippet-apply"]');
            await vi.waitFor(() => expect(document.querySelector('[data-testid="snippets-overlay"]')).toBeNull(), WAIT);
            await act(async () => { await submit.mock.results[0]?.value; });
            await vi.waitFor(() => expect(promptText()).not.toBe(''), WAIT);
            // Inserting never runs a statement
            expect(execute).not.toHaveBeenCalled();
            press('Enter');
            await vi.waitFor(() => expect(execute).toHaveBeenCalled(), WAIT);
        });

        it('leaves the prompt empty when the snippets are closed', async () => {
            const submit = vi.spyOn(DashQLShell.prototype, 'submit');
            await open();
            run('.examples');
            await click('[data-testid="snippets-close"]');
            await act(async () => { await submit.mock.results[0]?.value; });
            expect(promptText()).toBe('');
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
            const connection = createConnection(MAIN, { clientFunctions: JSON.stringify(await loadClientFunctionSpec('d360-api')) });
            await open([connection]);
        }
        const lastArgs = () => execute.mock.calls[execute.mock.calls.length - 1][1] as { query: string; clientFunctionCall?: unknown };

        it('runs a call in the namespace as a client function', async () => {
            await openWithSpec();
            run("call d360.segment_list (dataspace => 'default');");
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
            expect(execute.mock.calls[0][0]).toBe(MAIN);
            expect(lastArgs().query).toContain('call d360.segment_list');
            expect(lastArgs().clientFunctionCall).toEqual({
                namespace: 'd360',
                function: 'segment_list',
                explain: false,
                options: { dataspace: 'default' },
            });
        });

        it('explains a call as a client function', async () => {
            await openWithSpec();
            run('explain call d360.segment_list ();');
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
            run('call d360.segment_list ();');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
            expect(lastArgs().clientFunctionCall).toBeUndefined();
        });

        it('fails a call that the spec does not know without running anything', async () => {
            await openWithSpec();
            run('call d360.segment_lisst ();');
            await vi.waitFor(() => expect(screen()).toContain('segment_lisst'), WAIT);
            await vi.waitFor(() => expect(screen()).toMatch(/segment_list/), WAIT);
            expect(execute).not.toHaveBeenCalled();
        });

        it('fails a parameter without a value without running anything', async () => {
            await openWithSpec();
            run('call d360.segment_list (dataspace => :space);');
            await vi.waitFor(() => expect(screen()).toContain('input :space has no value'), WAIT);
            expect(execute).not.toHaveBeenCalled();
        });

        it('fails a call that does not parse without running anything', async () => {
            await openWithSpec();
            run('call d360.segment_list (dataspace => );');
            await vi.waitFor(() => expect(screen()).toMatch(/syntax error/i), WAIT);
            expect(execute).not.toHaveBeenCalled();
        });

        it('fails an EXPLAIN with options of a call without running anything', async () => {
            await openWithSpec();
            run('explain (analyze) call d360.segment_list ();');
            await vi.waitFor(() => expect(screen()).toMatch(/syntax error/i), WAIT);
            expect(execute).not.toHaveBeenCalled();
        });

        it('fails a call next to another statement', async () => {
            const catalog = core.createCatalog();
            catalog.registerClientFunctions(JSON.stringify(await loadClientFunctionSpec('d360-api')));
            expect(() => resolveClientFunctionCall(catalog, 'select 1; call d360.segment_list ();')).toThrow('statement of its own');
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
            connection.write(catalog => loadRelations(catalog, 'create table items (id integer);'));
        });

        it('completes what the catalog gets after the shell opened, on the same shell', async () => {
            const connection = createConnection(MAIN, { relationsSql: 'create table orders (id integer);' });
            await open([connection]);
            connection.write(catalog => loadRelations(catalog, 'create table items (id integer);'));
            type('select * from ite');
            press('Tab');
            await vi.waitFor(() => expect(screen()).toContain('items'), WAIT);
            expect(created).toHaveLength(1);
        });

        it('completes client functions that are registered after the shell opened', async () => {
            const connection = createConnection(MAIN);
            await open([connection]);
            const spec = JSON.stringify(await loadClientFunctionSpec('d360-api'));
            connection.write(catalog => catalog.registerClientFunctions(spec));
            type('call d360.access_policy_g');
            press('Tab');
            await vi.waitFor(() => expect(screen()).toContain('access_policy_get'), WAIT);
            expect(created).toHaveLength(1);
        });

        it('keeps the history when the shell is replaced', async () => {
            await open([createConnection(MAIN), createConnection(OTHER)]);
            run('select 42 as answer;');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
            await vi.waitFor(() => expect(screen()).toContain('1 row'), WAIT);

            render({ connectionId: OTHER });
            await vi.waitFor(() => expect(created).toHaveLength(2), WAIT);
            await vi.waitFor(() => expect(destroyed.has(created[0])).toBe(true), WAIT);
            expect(destroyed.has(created[1])).toBe(false);
            await vi.waitFor(() => expect(status()).toBeNull(), WAIT);

            press('ArrowUp');
            await vi.waitFor(() => expect(promptText()).toBe('select 42 as answer;'), WAIT);
            // The feed stays
            expect(screen()).toContain('1 row');
        });

        it('keeps the shell and its running query when the names change', async () => {
            let finish = (_table: arrow.Table) => { };
            execute.mockImplementationOnce(() => [nextQueryId++, new Promise<arrow.Table>(resolve => { finish = resolve; })]);
            await open();
            run('select 42 as answer;');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);

            render({ workbookName: 'Renamed workbook', ordinal: 1 });
            await new Promise(resolve => setTimeout(resolve, 200));
            expect(created).toHaveLength(1);
            expect(destroyed.has(created[0])).toBe(false);

            finish(tableFromArrays({ answer: [42] }));
            await vi.waitFor(() => expect(screen()).toContain('1 row'), WAIT);
            expect(cancel).not.toHaveBeenCalled();
        });

        it('takes the prompt of a new ordinal with the next shell', async () => {
            await open([createConnection(MAIN), createConnection(OTHER)]);
            render({ ordinal: 1 });
            render({ connectionId: OTHER, ordinal: 1 });
            await vi.waitFor(() => expect(created).toHaveLength(2), WAIT);
            await vi.waitFor(() => expect(status()).toBeNull(), WAIT);
            await vi.waitFor(() => expect(screen()).toContain('hyper#1> '), WAIT);
        });

        it('destroys a shell that is out of date when it finishes loading', async () => {
            await open([createConnection(MAIN), createConnection(OTHER)]);
            render({ connectionId: OTHER, ordinal: 1 });
            render({ ordinal: 3 });
            await vi.waitFor(() => expect(status()).toBeNull(), WAIT);
            await vi.waitFor(() => expect(created.length).toBeGreaterThanOrEqual(2), WAIT);
            await vi.waitFor(() => expect(screen()).toContain('hyper#3> '), WAIT);
        });

        it('prints a shell that failed to load into the feed it keeps', async () => {
            await open([createConnection(MAIN), createConnection(OTHER)]);
            vi.mocked(DashQLShell.create).mockRejectedValueOnce(new Error('shell is broken'));
            render({ connectionId: OTHER });
            await vi.waitFor(() => expect(screen()).toContain('Failed to load shell: shell is broken'), WAIT);
            // The feed gets the message right away, the status line with the next render
            await vi.waitFor(() => expect(status()).toContain('shell is broken'), WAIT);
            // The shell that is there still runs queries
            run('select 42 as answer;');
            await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), WAIT);
        });

        it('closes the result when the connection changes', async () => {
            const connections = [createConnection(MAIN), createConnection(OTHER)];
            await open(connections);
            const table = tableFromArrays({ answer: [42] });
            const queryId = finishedQuery(api.runtime, MAIN);
            execute.mockImplementationOnce(() => [queryId, Promise.resolve(table)]);
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

        it('focuses the prompt when it becomes active', async () => {
            await open();
            await vi.waitFor(() => expect(document.activeElement).toBe(input()), WAIT);
            input()!.blur();
            render({ active: false });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(document.activeElement).not.toBe(input());
            render({ active: true });
            await vi.waitFor(() => expect(document.activeElement).toBe(input()), WAIT);
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
