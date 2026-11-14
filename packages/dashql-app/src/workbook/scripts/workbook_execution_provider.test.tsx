import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputationRegistry } from '../../compute/computation_registry.js';
import { ComputeConnectionProvider, useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '@ankoh/dashql-sdk/platform/database/embedded_database';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { createQueryResponseStreamMetrics, QueryExecutionStatus, QueryType, type QueryExecutionResponseStream } from '@ankoh/dashql-sdk/query/query_execution_state';
import { ConnectionRegistry, useConnectionRegistry } from '../../connections/connection_registry.js';
import { ConnectionHealth, createConnectionMetrics, type ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { CONNECTOR_INFOS, ConnectorType, HYPER_CONNECTOR } from '@ankoh/dashql-sdk/connections/connector_info';
import { QueryExecutorProvider } from '../../connections/query_executor.js';
import { WorkbookTestBackend } from '../../storage/workbook_test_backend.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { WorkbookExecutionProvider, workbookExecutionIsBusy, useWorkbookExecution } from './workbook_execution_provider.js';
import { isWorkbookExecutionRunning, type WorkbookExecutionState } from './workbook_execution.js';
import { REGISTER_QUERY, type WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import { scriptRunServices } from './script_run.js';
import { WorkbookScriptsRegistryProvider, useWorkbookScriptsRegistry, type ModifyWorkbookScripts } from './workbook_scripts_registry.js';

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
        getMetadata: () => new Map(),
        getMetrics: createQueryResponseStreamMetrics,
        getStatus: () => QueryExecutionStatus.RUNNING,
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
        // Command-only nodes avoid exercising result computation in provider lifecycle tests.
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
        // Only the services of the provider read the live workbook
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

describe('WorkbookExecutionProvider', () => {
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

    async function render(workbookId = 'first', showConsumer = true, showProvider = true) {
        // The execution value is memoized, count the observer commits instead of comparing identities.
        const previousObserverCommits = observerCommits;
        await act(async () => {
            root.render(<LoggerProvider>
                <StorageProvider backend={backend}>
                    <ConnectionRegistry>
                        <WorkbookScriptsRegistryProvider>
                            <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                                <ComputeConnectionProvider>
                                    <ComputationRegistry>
                                        <SeedRegistries fixtures={fixtures}>
                                            <QueryExecutorProvider>
                                                {showProvider ? <WorkbookExecutionProvider>
                                                    {showConsumer ? <Consumer key={workbookId} workbookId={workbookId} capture={capture} /> : null}
                                                    <Consumer workbookId="first" capture={captureObserver} />
                                                    <EarlyConsumer capture={execution => { early = execution; }} />
                                                    <RunServicesProbe workbookId="first" capture={captureServices} expose={bump => { bumpWorkbook = bump; }} />
                                                </WorkbookExecutionProvider> : <></>}
                                            </QueryExecutorProvider>
                                        </SeedRegistries>
                                    </ComputationRegistry>
                                </ComputeConnectionProvider>
                            </EmbeddedDatabaseProvider>
                        </WorkbookScriptsRegistryProvider>
                    </ConnectionRegistry>
                </StorageProvider>
            </LoggerProvider>);
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        // A timer turn does not guarantee that async database setup and React commits have finished.
        if (showProvider) await vi.waitFor(() => expect(observerCommits).toBeGreaterThan(previousObserverCommits));
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

    it('registers the run services before the effects of its children read them', async () => {
        await render();
        // A change of the workbook re-registers the services, e.g. a run that registers its query
        act(() => bumpWorkbook());
        act(() => bumpWorkbook());
        expect(servicesRegistered.length).toBeGreaterThanOrEqual(3);
        expect(servicesRegistered.every(registered => registered)).toBe(true);
    });

    it('prevents duplicate starts synchronously and after consumers rerender', async () => {
        await render();
        act(() => { current.start(fixtures[0].modify); current.start(fixtures[0].modify); });
        await vi.waitFor(() => expect(fixtures[0].stream.produce).toHaveBeenCalledTimes(1));
        act(() => current.start(fixtures[0].modify));
        expect(fixtures[0].plan).toHaveBeenCalledTimes(1);
        expect(fixtures[0].executeQuery).toHaveBeenCalledTimes(1);
        expect(fixtures[0].modify.mock.calls.filter(([action]) => action.type === REGISTER_QUERY)).toHaveLength(1);
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

    it.each(['execution', 'cancellation'] as const)('keeps stopping busy until both promises drain, with %s settling first', async first => {
        await render();
        await start();
        const f = fixtures[0];
        act(() => { current.stop(); current.stop(); });
        expect(f.signal?.aborted).toBe(true);
        expect(f.stream.cancel).toHaveBeenCalledTimes(1);
        expect(current.state?.phase).toBe('stopping');
        expect(current.busy).toBe(true);

        await act(async () => {
            f[first].resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(current.state?.phase).toBe('stopping');
        expect(current.busy).toBe(true);
        act(() => current.start(f.modify));
        expect(f.plan).toHaveBeenCalledTimes(1);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);

        await act(async () => {
            f.execution.resolve(); f.cancellation.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(current.state?.phase).toBe('cancelled'));
        expect(current.busy).toBe(false);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(isWorkbookExecutionRunning(f.workbook)).toBe(false);

        act(() => current.start(f.modify));
        await vi.waitFor(() => expect(current.state?.phase).toBe('succeeded'));
        expect(f.plan).toHaveBeenCalledTimes(2);
        expect(f.executeQuery).toHaveBeenCalledTimes(3);
    });

    it('cancels a stream acquired after stop without consuming it or starting queued statements', async () => {
        const f = fixtures[0] = fixture('first', true);
        await render();
        act(() => current.start(f.modify));
        await vi.waitFor(() => {
            expect(f.executeQuery).toHaveBeenCalledTimes(1);
            expect(current.state?.phase).toBe('running');
        });
        expect(f.stream.produce).not.toHaveBeenCalled();
        expect(current.busy).toBe(true);

        act(() => current.stop());
        expect(f.signal?.aborted).toBe(true);
        expect(current.state?.phase).toBe('stopping');
        expect(f.stream.cancel).not.toHaveBeenCalled();

        await act(async () => {
            f.acquisition.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(f.stream.cancel).toHaveBeenCalledTimes(1));
        expect(f.stream.produce).not.toHaveBeenCalled();
        expect(current.state?.phase).toBe('stopping');
        expect(current.busy).toBe(true);
        act(() => current.start(f.modify));
        expect(f.plan).toHaveBeenCalledTimes(1);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);

        await act(async () => {
            f.cancellation.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(current.state?.phase).toBe('cancelled'));
        expect(current.state).toMatchObject({ totalStatements: 2, completedStatements: 0 });
        expect(current.busy).toBe(false);
        expect(isWorkbookExecutionRunning(f.workbook)).toBe(false);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(f.stream.cancel).toHaveBeenCalledTimes(1);
        expect(f.stream.produce).not.toHaveBeenCalled();
        expect(f.modify.mock.calls.filter(([action]) => action.type === REGISTER_QUERY)).toHaveLength(1);
    });

    it('completes schema-less commands without requesting their unresolved schema', async () => {
        const f = fixtures[0];
        const getSchema = vi.fn(() => new Promise<null>(() => {}));
        f.stream.getSchema = getSchema;
        await render();
        await start();
        expect(getSchema).not.toHaveBeenCalled();

        await act(async () => {
            f.execution.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(current.state?.phase).toBe('succeeded'));
        expect(current.state).toMatchObject({ totalStatements: 2, completedStatements: 2, completedScripts: 1 });
        expect(current.busy).toBe(false);
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
        expect(f.stream.produce).toHaveBeenCalledTimes(2);
        expect(getSchema).not.toHaveBeenCalled();
        expect(f.stream.cancel).not.toHaveBeenCalled();
        expect(f.modify.mock.calls.filter(([action]) => action.type === REGISTER_QUERY)).toHaveLength(2);
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

    it('does not start with an active query', async () => {
        const f = fixtures[0];
        f.database.queriesActive.set(99, { queryMetadata: { queryType: QueryType.USER_PROVIDED } } as never);
        await render();
        act(() => current.start(f.modify));
        expect(f.plan).not.toHaveBeenCalled();
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(f.modify).not.toHaveBeenCalled();
        expect(current.state).toBeNull();
        expect(current.busy).toBe(false);
    });

    it('runs every script while the connection is not connected and skips the statements that need it', async () => {
        const f = fixtures[0];
        f.database.connectionHealth = ConnectionHealth.FAILED;
        await render();
        act(() => current.start(f.modify));
        await vi.waitFor(() => expect(current.state?.phase).toBe('succeeded'));
        expect(f.plan).toHaveBeenCalled();
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(current.state).toMatchObject({ totalScripts: 1, completedScripts: 0, skippedScripts: 1, totalStatements: 0 });
    });

    it('runs a preview of a published workbook on the embedded Hyper only, its other connections are skipped', async () => {
        const preview = { workbookId: 'c0ffee00-0000-4000-8000-000000000001', versionId: 'c0ffee00-0000-4000-8000-000000000002', connectionId: 'cloud', preview: true };
        const [embedded, remote] = fixtures;
        for (const f of fixtures) Object.assign(f.workbook, { workbookMetadata: { cloud: preview } });
        // The second connection is a Hyper server, it is online but a preview doesn't run on it
        (remote.database.details.value as { proto: object }).proto = { setupParams: { protocol: 'V3_HTTP' } };
        await render();
        act(() => current.start(embedded.modify));
        await vi.waitFor(() => expect(embedded.stream.produce).toHaveBeenCalledTimes(1));
        await render('second');
        act(() => current.start(remote.modify));
        await vi.waitFor(() => expect(current.state?.phase).toBe('succeeded'));
        expect(remote.executeQuery).not.toHaveBeenCalled();
        expect(current.state).toMatchObject({ totalScripts: 1, completedScripts: 0, skippedScripts: 1, totalStatements: 0 });
    });

    it('runs a change of inputs while the connection is not connected', async () => {
        const f = fixtures[0];
        f.database.connectionHealth = ConnectionHealth.NOT_STARTED;
        await render();
        act(() => current.start(f.modify, { inputs: ['min'] }));
        // The fixture core derives no dataflow, the run starts and settles
        await vi.waitFor(() => expect(current.state?.phase).toMatch(/succeeded|failed/));
    });

    it('waits for a connection that is connecting, a change of inputs starts once it is online', async () => {
        const f = fixtures[0];
        f.database.connectionHealth = ConnectionHealth.CONNECTING;
        await render();
        act(() => current.start(f.modify));
        expect(current.state).toBeNull();
        act(() => current.start(f.modify, { inputs: ['min'] }));
        expect(current.state).toBeNull();
        await act(async () => setConnections(registry => {
            const connections = new Map(registry.connections);
            connections.set(f.database.connectionId, { ...f.database, connectionHealth: ConnectionHealth.ONLINE });
            return { ...registry, connections };
        }));
        await vi.waitFor(() => expect(current.state).not.toBeNull());
    });

    it('stops a run once a connection that it runs statements on drops', async () => {
        await render();
        await start();
        const f = fixtures[0];
        await act(async () => setConnections(registry => {
            const connections = new Map(registry.connections);
            connections.set(f.database.connectionId, { ...f.database, connectionHealth: ConnectionHealth.FAILED });
            return { ...registry, connections };
        }));
        expect(f.signal?.aborted).toBe(true);
    });

    it('starts while computations of the workbook query the compute database', async () => {
        const f = fixtures[0];
        f.database.queriesActive.set(99, { queryMetadata: { queryType: QueryType.INTERNAL_SQLFRAME } } as never);
        await render();
        act(() => current.start(f.modify));
        await vi.waitFor(() => expect(f.plan).toHaveBeenCalledTimes(1));
    });

    it('aborts every active run when the provider unmounts, not when route consumers unmount', async () => {
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

    it.each(['planning', 'running', 'stopping', 'succeeded', 'failed', 'cancelled'] as const)('classifies the %s phase', phase => {
        expect(workbookExecutionIsBusy({ phase } as WorkbookExecutionState))
            .toBe(phase === 'planning' || phase === 'running' || phase === 'stopping');
        expect(workbookExecutionIsBusy(null)).toBe(false);
        expect(workbookExecutionIsBusy(undefined)).toBe(false);
    });
});
