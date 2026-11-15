import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputeConnectionProvider, useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '@ankoh/dashql-runtime/platform/database/embedded_database';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { createQueryResponseStreamMetrics, QueryType, type QueryExecutionResponseStream } from '@ankoh/dashql-runtime/query/query_execution_state';
import { useConnectionRegistry } from '../../connections/connection_registry.js';
import { ConnectionHealth, createConnectionMetrics, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { CONNECTOR_INFOS, ConnectorType, HYPER_CONNECTOR } from '@ankoh/dashql-runtime/connections/connector_info';
import { WorkbookTestBackend } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { StorageProvider } from '../../storage/storage_provider.js';
import { useWorkbookExecution } from './use_workbook_execution.js';
import { workbookExecutionIsBusy } from '@ankoh/dashql-runtime/workbook/scripts/workbook_execution_service';
import { isWorkbookExecutionRunning, type WorkbookExecutionState } from '@ankoh/dashql-runtime/workbook/scripts/workbook_execution';
import { REGISTER_QUERY, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { scriptRunServices } from '@ankoh/dashql-runtime/workbook/scripts/script_run';
import { useWorkbookScriptsRegistry, type ModifyWorkbookScripts } from './workbook_scripts_registry.js';
import { TestRuntime } from '../../tests/test_runtime.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}

function fixture(workbookId: string, deferStream = false) {
    const acquisition = deferred();
    if (!deferStream) acquisition.resolve();
    const execution = deferred();
    const cancellation = deferred();
    let signal: AbortSignal | undefined;
    const aborted = vi.fn();
    const stream: QueryExecutionResponseStream = {
        cancel: vi.fn(() => cancellation.promise),
        getMetrics: createQueryResponseStreamMetrics,
        getSchema: async () => null,
        produce: vi.fn<QueryExecutionResponseStream['produce']>(async (_batches, _progress, abort) => {
            signal = abort;
            abort?.addEventListener('abort', aborted, { once: true });
            await execution.promise;
            abort?.removeEventListener('abort', aborted);
            abort?.throwIfAborted();
        }),
    };
    const executeQuery = vi.fn(async (_query: unknown, abort?: AbortSignal) => {
        signal = abort;
        await acquisition.promise;
        return stream;
    });
    const scriptSession = {
        analyze: vi.fn(() => ({ status: core.buffers.editor.EditorUpdateStatus.OK, analysisAvailable: true })),
        loadIntoCatalog: vi.fn(),
        getCatalogEntryId: () => 1,
        getTextVersion: () => 1n,
        getCatalogRevision: () => 1n,
    };
    const plan = vi.fn(() => ({ unpack: () => ({
        valid: true,
        scripts: [{ scriptId: 1, textVersion: 1n, analyzedTextVersion: 1n, analyzedCatalogRevision: 1n, planned: true }],
        // Command-only nodes avoid exercising result computation in lifecycle tests.
        nodes: [0, 1].map(statementId => ({ script: 0, statementId, producesOutput: false, sql: `command ${statementId}`, connection: 0, materialization: 0xffffffff })),
        edges: [], diagnostics: [], materializations: [],
    }) }));
    const workbook = {
        workbookId, pendingConnection: null, instance: { planSession: plan },
        scriptRefs: { '1_commands.sql': { scriptId: 1, fileName: '1_commands.sql' } },
        scriptOrder: ['1_commands.sql'],
        scripts: { 1: { scriptKey: 1, fileName: '1_commands.sql', scriptSession, latestQueryId: null,
            connection: { connectionId: `${workbookId}-database` } } },
    } as unknown as WorkbookScripts;
    const database = {
        connectionId: `${workbookId}-database`, active: false,
        connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
        connectionHealth: ConnectionHealth.ONLINE, metrics: createConnectionMetrics(),
        params: { hyper: {} },
        catalogUpdates: { described: true },
        details: { type: HYPER_CONNECTOR, value: { proto: {}, channel: { executeQuery } } },
        queriesActive: new Map(), queriesActiveOrdered: [],
        queriesFinished: new Map(), queriesFinishedOrdered: [], snapshotQueriesActiveFinished: 0,
    } as unknown as ConnectionState;
    const modify = vi.fn<ModifyWorkbookScripts>(action => {
        if (action.type === REGISTER_QUERY) workbook.scripts[action.value[0]].latestQueryId = action.value[1];
    });
    return { workbook, database, plan, stream, executeQuery, modify, acquisition, execution, cancellation, aborted,
        get signal() { return signal; } };
}

type Fixture = ReturnType<typeof fixture>;
type Execution = ReturnType<typeof useWorkbookExecution>;

function Consumer(props: { workbookId: string; capture: (execution: Execution) => void }) {
    const execution = useWorkbookExecution(props.workbookId);
    const database = useComputeDatabase();
    React.useLayoutEffect(() => { if (database) props.capture(execution); });
    return null;
}

/// Captures the run of a workbook also before the compute database is set up
function EarlyConsumer(props: { capture: (execution: Execution) => void }) {
    const execution = useWorkbookExecution('first');
    React.useLayoutEffect(() => props.capture(execution));
    return null;
}

/// Reads the run services in a passive effect whenever its workbook changes, like the cache indicator of a card
function RunServicesProbe(props: { workbookId: string; capture: (registered: boolean) => void; expose: (bump: () => void) => void }) {
    const [registry, setWorkbooks] = useWorkbookScriptsRegistry();
    const workbook = registry.workbookScriptsMap.get(props.workbookId);
    React.useEffect(() => {
        props.expose(() => setWorkbooks(registry => {
            const workbooks = new Map(registry.workbookScriptsMap);
            const workbook = workbooks.get(props.workbookId)!;
            workbooks.set(props.workbookId, { ...workbook });
            return { ...registry, workbookScriptsMap: workbooks };
        }));
    });
    React.useEffect(() => {
        // Only the services of the runtime read the live workbook
        if (workbook != null) props.capture(scriptRunServices(workbook.instance).liveWorkbook != null);
    }, [workbook]);
    return null;
}

/// Changes the connections of the registry, e.g. a connection that drops
let setConnections: ReturnType<typeof useConnectionRegistry>[1] = () => {};

function SeedRegistries(props: { fixtures: Fixture[]; children: React.ReactNode }) {
    const [, setWorkbooks] = useWorkbookScriptsRegistry();
    const [, setRegistryConnections] = useConnectionRegistry();
    setConnections = setRegistryConnections;
    const [ready, setReady] = React.useState(false);
    React.useEffect(() => {
        setWorkbooks(registry => ({ ...registry,
            workbookScriptsMap: new Map(props.fixtures.map(f => [f.workbook.workbookId, f.workbook])),
        }));
        setRegistryConnections(registry => ({ ...registry,
            connections: new Map(props.fixtures.map(f => [f.database.connectionId, f.database])),
            attachedDatabasesByWorkbook: new Map(props.fixtures.map(f => [f.workbook.workbookId, {
                mainDatabaseId: f.database.connectionId, attachedDatabaseIds: [],
            }])),
        }));
        setReady(true);
    }, [props.fixtures, setWorkbooks, setRegistryConnections]);
    return ready ? props.children : null;
}

// The runs themselves are tested in the runtime (workbook/scripts/workbook_execution_service.test.ts), these are the
// runtime of the app and the hook on it
describe('the runs of workbooks in the app', () => {
    let container: HTMLDivElement;
    let root: Root;
    let fixtures: Fixture[];
    let current: Execution;
    let observer: Execution;
    let early: Execution | null = null;
    let observerCommits = 0;
    let backend: WorkbookTestBackend;
    let setupDatabase: () => Promise<EmbeddedComputeDatabase>;
    let servicesRegistered: boolean[] = [];
    let bumpWorkbook: () => void = () => {};
    const captureServices = (registered: boolean) => { servicesRegistered.push(registered); };
    const capture = (execution: Execution) => { current = execution; };
    const captureObserver = (execution: Execution) => { observer = execution; observerCommits += 1; };

    beforeEach(() => {
        fixtures = [fixture('first'), fixture('second')];
        servicesRegistered = [];
        early = null;
        backend = new WorkbookTestBackend();
        setupDatabase = async () => ({ terminate: vi.fn() }) as unknown as EmbeddedComputeDatabase;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        act(() => root.unmount());
        await act(async () => {
            fixtures.forEach(f => { f.acquisition.resolve(); f.execution.resolve(); f.cancellation.resolve(); });
            await vi.waitFor(() => {
                for (const f of fixtures) expect(isWorkbookExecutionRunning(f.workbook)).toBe(false);
            });
        });
        container.remove();
    });

    async function render(workbookId = 'first', showConsumer = true, showRuntime = true) {
        // The execution value is memoized, count the observer commits instead of comparing identities.
        const previousObserverCommits = observerCommits;
        await act(async () => {
            root.render(<LoggerProvider>
                <StorageProvider backend={backend}>
                    <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                        <ComputeConnectionProvider>
                            {showRuntime ? <TestRuntime>
                                <SeedRegistries fixtures={fixtures}>
                                    {showConsumer ? <Consumer key={workbookId} workbookId={workbookId} capture={capture} /> : null}
                                    <Consumer workbookId="first" capture={captureObserver} />
                                    <EarlyConsumer capture={execution => { early = execution; }} />
                                    <RunServicesProbe workbookId="first" capture={captureServices} expose={bump => { bumpWorkbook = bump; }} />
                                </SeedRegistries>
                            </TestRuntime> : <></>}
                        </ComputeConnectionProvider>
                    </EmbeddedDatabaseProvider>
                </StorageProvider>
            </LoggerProvider>);
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        // A timer turn does not guarantee that async database setup and React commits have finished.
        if (showRuntime) await vi.waitFor(() => expect(observerCommits).toBeGreaterThan(previousObserverCommits));
    }

    async function start(f = fixtures[0]) {
        act(() => current.start(f.modify));
        await vi.waitFor(() => {
            expect(f.stream.produce).toHaveBeenCalledTimes(1);
            expect(current.state?.phase).toBe('running');
        });
        expect(current.busy).toBe(true);
        expect(current.state?.phase).toBe('running');
    }

    it('registers the run services before the effects of the components read them', async () => {
        await render();
        // A change of the workbook re-registers the services, e.g. a run that registers its query
        act(() => bumpWorkbook());
        act(() => bumpWorkbook());
        expect(servicesRegistered.length).toBeGreaterThanOrEqual(3);
        expect(servicesRegistered.every(registered => registered)).toBe(true);
    });

    it('waits for delayed compute database setup before starting execution', async () => {
        const setup = deferred();
        setupDatabase = vi.fn(async () => {
            await setup.promise;
            return { terminate: vi.fn() } as unknown as EmbeddedComputeDatabase;
        });
        const rendering = render();
        await vi.waitFor(() => expect(setupDatabase).toHaveBeenCalledTimes(1));
        expect(fixtures[0].executeQuery).not.toHaveBeenCalled();
        setup.resolve();
        await rendering;
        await start();
    });

    it('starts no run before the compute database that reads the cached results is set up', async () => {
        const setup = deferred();
        setupDatabase = vi.fn(async () => {
            await setup.promise;
            return { terminate: vi.fn() } as unknown as EmbeddedComputeDatabase;
        });
        // A run without a connection would find no cached result, it doesn't start
        fixtures[0].database.connectionHealth = ConnectionHealth.NOT_STARTED;
        const rendering = render();
        await vi.waitFor(() => expect(early).not.toBeNull());
        expect(early!.ready).toBe(false);
        act(() => early!.start(fixtures[0].modify));
        expect(fixtures[0].plan).not.toHaveBeenCalled();
        expect(early!.state).toBeNull();
        setup.resolve();
        await rendering;
        expect(current.ready).toBe(true);
        act(() => current.start(fixtures[0].modify));
        await vi.waitFor(() => expect(current.state?.phase).toBe('succeeded'));
        expect(fixtures[0].plan).toHaveBeenCalled();
    });

    it('retains per-workbook state when route consumers switch ids and remount', async () => {
        await render();
        await start();
        await render('second');
        expect(current.state).toBeNull();
        expect(current.busy).toBe(false);
        expect(observer.state?.phase).toBe('running');
        expect(observer.busy).toBe(true);
        expect(fixtures[0].signal?.aborted).toBe(false);
        await start(fixtures[1]);
        expect(fixtures[1].plan).toHaveBeenCalledTimes(1);

        await render('second', false);
        await act(async () => {
            fixtures[0].execution.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(observer.state?.phase).toBe('succeeded'));
        const completed = observer.state;
        await render('first');
        expect(current.state).toBe(completed);
        expect(current.busy).toBe(false);
        expect(fixtures[0].plan).toHaveBeenCalledTimes(1);
        await render('second');
        expect(current.state?.phase).toBe('running');
        expect(current.busy).toBe(true);
        expect(fixtures[1].signal?.aborted).toBe(false);
    });

    it('aborts every active run when the runtime unmounts, not when route consumers unmount', async () => {
        await render();
        await start();
        await render('second');
        await start(fixtures[1]);
        await render('second', false, false);
        for (const f of fixtures) {
            expect(f.signal?.aborted).toBe(true);
            expect(f.aborted).toHaveBeenCalledTimes(1);
            expect(f.stream.cancel).toHaveBeenCalledTimes(1);
            expect(f.executeQuery).toHaveBeenCalledTimes(1);
        }
    });

});
