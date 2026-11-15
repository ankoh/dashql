// The runs of workbooks of the runtime (WorkbookExecutionService) on a runtime of the tests: starting and stopping, the
// connections a run needs, previews and changes of inputs. The tests of the provider of the app on it stay in the app.
import * as core from '@ankoh/dashql-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, setupStepAction } from '../../connections/connection_state.js';
import type { ConnectionParams } from '../../connections/connection_params.js';
import { createTestConnection } from '../../testing/connection_fixtures.js';
import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import type { EmbeddedComputeDatabase } from '../../platform/database/embedded_database.js';
import { createQueryResponseStreamMetrics, QueryType, type QueryExecutionResponseStream } from '../../query/query_execution_state.js';
import { createTestRuntime, testCore, type TestRuntime } from '../../testing/test_runtime.js';
import { isWorkbookExecutionRunning, type WorkbookExecutionState } from './workbook_execution.js';
import { workbookExecutionIsBusy, type WorkbookExecutionOptions } from './workbook_execution_service.js';
import { createWorkbookScripts } from './workbook_scripts.js';
import { createEmptyMetadata } from './script_types.js';
import type { ModifyWorkbookScripts } from './workbook_scripts_registry_state.js';

/// Run a step of a test and wait for it
const step = (run: () => unknown) => run();

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}

let dql: core.DashQL;
beforeAll(async () => { dql = await testCore(); });

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
    // Two commands that don't depend on each other, a connection without a protocol runs them one at a time
    const workbook = createWorkbookScripts({
        instance: dql, workbookId, name: workbookId, pendingConnection: null, workbookMetadata: createEmptyMetadata(),
        scripts: [{
            name: '1_commands.sql', sql: 'create table a (x int);\ncreate table b (x int);',
            connection: { connectionId: `${workbookId}-database`, connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: dql.createCatalog() },
        }],
    });
    // The runs of the workbook on the Rust runtime
    const plan = vi.spyOn(workbook.native!.workbook, 'run');
    const scriptKey = workbook.scriptRefs['1_commands.sql'].scriptId;
    /// The latest query of the script
    const latestQueryId = () => workbook.native!.workbook.scriptView(scriptKey, { editorUpdate: null, pendingDiff: null, visualization: null, statistics: null }).latestQueryId;
    const modify = vi.fn<ModifyWorkbookScripts>(() => {});
    /// The connection of the workbook, the runtime creates it with the health and the protocol of the fixture
    const database = {
        connectionId: `${workbookId}-database`,
        health: ConnectionHealth.ONLINE,
        // Without a protocol the connection runs one statement at a time
        protocol: null as string | null,
        /// The kinds of the queries that the connection runs when the workbook opens
        activeQueries: [] as QueryType[],
    };
    return { workbook, database, plan, latestQueryId, stream, executeQuery, modify, acquisition, execution, cancellation, aborted,
        get signal() { return signal; } };
}

type Fixture = ReturnType<typeof fixture>;

/// The run of a workbook as the hook of the app shows it
interface Execution {
    readonly state: WorkbookExecutionState | null;
    readonly busy: boolean;
    readonly ready: boolean;
    start(modify: ModifyWorkbookScripts, options?: WorkbookExecutionOptions): void;
    stop(): void;
}

describe('WorkbookExecutionService', () => {
    let fixtures: Fixture[];
    let runtime: TestRuntime | null = null;
    let current: Execution;

    beforeEach(() => {
        fixtures = [fixture('first'), fixture('second')];
    });

    afterEach(async () => {
        fixtures.forEach(f => { f.acquisition.resolve(); f.execution.resolve(); f.cancellation.resolve(); });
        await vi.waitFor(() => {
            for (const f of fixtures) expect(isWorkbookExecutionRunning(f.workbook)).toBe(false);
        });
        await runtime?.destroy();
        runtime = null;
    });

    /// The runs of a workbook of the runtime
    function executionOf(rt: TestRuntime, workbookId: string): Execution {
        return {
            get state() { return rt.execution.states.current.get(workbookId) ?? null; },
            get busy() { return workbookExecutionIsBusy(rt.execution.states.current.get(workbookId)); },
            get ready() { return rt.execution.ready; },
            start: (modify, options) => rt.execution.start(workbookId, modify, options),
            stop: () => rt.execution.stop(workbookId),
        };
    }

    /// Change a connection of the runtime, e.g. a connection that drops, the services follow the store
    function act(f: Fixture, step: string, value?: unknown) {
        runtime!.coreRuntime.dispatchConnection(f.database.connectionId, setupStepAction(step, value));
        runtime!.coreRuntime.flush();
    }

    /// Create the connection of a fixture in the runtime: online with a channel, connecting, failed or not started
    function addConnection(rt: TestRuntime, f: Fixture) {
        const { connectionId, health, protocol } = f.database;
        const params = { hyper: { endpoint: 'http://hyper', ...(protocol == null ? {} : { protocol }) } } as ConnectionParams;
        createTestConnection(rt.coreRuntime, {
            connectionId,
            params,
            channel: health === ConnectionHealth.NOT_STARTED ? undefined : { executeQuery: f.executeQuery },
            online: health === ConnectionHealth.ONLINE || health === ConnectionHealth.FAILED,
        });
        // The catalog describes the connection, the runs don't wait for the catalog loader
        rt.coreRuntime.dispatch({ connection: connectionId }, { kind: 'restoreCatalogUpdates', value: { described: true } });
        if (health === ConnectionHealth.FAILED) act(f, 'HEALTH_CHECK_FAILED', { message: 'down' });
        if (health === ConnectionHealth.CONNECTING) act(f, 'HEALTH_CHECK_STARTED');
        const metadata = { title: null, description: null, issuer: null, userProvided: true };
        for (const queryType of f.database.activeQueries) {
            rt.coreRuntime.dispatch({ connection: connectionId }, { kind: 'trackQuery', value: { traceId: 0, text: 'select 1', metadata: { ...metadata, queryType } } });
        }
        rt.coreRuntime.flush();
        expect(rt.connection(connectionId).connectionHealth).toBe(health);
    }

    /// A runtime with the workbooks and the connections of the fixtures, the runs of a workbook as `current`
    async function openWorkbook(workbookId = 'first', options: { computeDatabase?: boolean } = {}) {
        if (runtime == null) {
            runtime = await createTestRuntime({
                computeDatabase: options.computeDatabase === false ? null : { terminate: vi.fn() } as unknown as EmbeddedComputeDatabase,
            });
            const rt = runtime;
            rt.workbooks.store.update(registry => ({ ...registry,
                workbookScriptsMap: new Map(fixtures.map(f => [f.workbook.workbookId, f.workbook])),
            }));
            for (const f of fixtures) addConnection(rt, f);
        }
        current = executionOf(runtime, workbookId);
    }

    async function start(f = fixtures[0]) {
        step(() => current.start(f.modify));
        await vi.waitFor(() => {
            expect(f.stream.produce).toHaveBeenCalledTimes(1);
            expect(current.state?.phase).toBe('running');
        });
        expect(current.busy).toBe(true);
        expect(current.state?.phase).toBe('running');
    }

    it('starts no run without the compute database that reads the cached results', async () => {
        fixtures[0].database.health = ConnectionHealth.NOT_STARTED;
        await openWorkbook('first', { computeDatabase: false });
        expect(current.ready).toBe(false);
        step(() => current.start(fixtures[0].modify));
        expect(fixtures[0].plan).not.toHaveBeenCalled();
        expect(current.state).toBeNull();
    });

    it('stops every run when the runtime is destroyed', async () => {
        await openWorkbook();
        await start();
        await openWorkbook('second');
        await start(fixtures[1]);
        await runtime!.destroy();
        runtime = null;
        for (const f of fixtures) {
            expect(f.signal?.aborted).toBe(true);
            expect(f.aborted).toHaveBeenCalledTimes(1);
            expect(f.stream.cancel).toHaveBeenCalledTimes(1);
        }
    });

    it('prevents duplicate starts synchronously and while the run is busy', async () => {
        await openWorkbook();
        step(() => { current.start(fixtures[0].modify); current.start(fixtures[0].modify); });
        await vi.waitFor(() => expect(fixtures[0].stream.produce).toHaveBeenCalledTimes(1));
        step(() => current.start(fixtures[0].modify));
        expect(fixtures[0].plan).toHaveBeenCalledTimes(1);
        expect(fixtures[0].executeQuery).toHaveBeenCalledTimes(1);
        expect(fixtures[0].latestQueryId()).not.toBeNull();
    });

    it.each(['execution', 'cancellation'] as const)('keeps stopping busy until both promises drain, with %s settling first', async first => {
        await openWorkbook();
        await start();
        const f = fixtures[0];
        step(() => { current.stop(); current.stop(); });
        expect(f.signal?.aborted).toBe(true);
        expect(f.stream.cancel).toHaveBeenCalledTimes(1);
        expect(current.state?.phase).toBe('stopping');
        expect(current.busy).toBe(true);

        await step(async () => {
            f[first].resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(current.state?.phase).toBe('stopping');
        expect(current.busy).toBe(true);
        step(() => current.start(f.modify));
        expect(f.plan).toHaveBeenCalledTimes(1);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);

        await step(async () => {
            f.execution.resolve(); f.cancellation.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(current.state?.phase).toBe('cancelled'));
        expect(current.busy).toBe(false);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(isWorkbookExecutionRunning(f.workbook)).toBe(false);

        step(() => current.start(f.modify));
        await vi.waitFor(() => expect(current.state?.phase).toBe('succeeded'));
        expect(f.plan).toHaveBeenCalledTimes(2);
        expect(f.executeQuery).toHaveBeenCalledTimes(3);
    });

    it('cancels a stream acquired after stop without consuming it or starting queued statements', async () => {
        const f = fixtures[0] = fixture('first', true);
        await openWorkbook();
        step(() => current.start(f.modify));
        await vi.waitFor(() => {
            expect(f.executeQuery).toHaveBeenCalledTimes(1);
            expect(current.state?.phase).toBe('running');
        });
        expect(f.stream.produce).not.toHaveBeenCalled();
        expect(current.busy).toBe(true);

        step(() => current.stop());
        expect(f.signal?.aborted).toBe(true);
        expect(current.state?.phase).toBe('stopping');
        expect(f.stream.cancel).not.toHaveBeenCalled();

        await step(async () => {
            f.acquisition.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(f.stream.cancel).toHaveBeenCalledTimes(1));
        expect(f.stream.produce).not.toHaveBeenCalled();
        expect(current.state?.phase).toBe('stopping');
        expect(current.busy).toBe(true);
        step(() => current.start(f.modify));
        expect(f.plan).toHaveBeenCalledTimes(1);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);

        await step(async () => {
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
        expect(f.latestQueryId()).not.toBeNull();
    });

    it('completes schema-less commands without requesting their unresolved schema', async () => {
        const f = fixtures[0];
        const getSchema = vi.fn(() => new Promise<null>(() => {}));
        f.stream.getSchema = getSchema;
        await openWorkbook();
        await start();
        expect(getSchema).not.toHaveBeenCalled();

        await step(async () => {
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
        expect(f.latestQueryId()).not.toBeNull();
    });

    it('does not start with an active query', async () => {
        const f = fixtures[0];
        f.database.activeQueries.push(QueryType.USER_PROVIDED);
        await openWorkbook();
        step(() => current.start(f.modify));
        expect(f.plan).not.toHaveBeenCalled();
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(f.modify).not.toHaveBeenCalled();
        expect(current.state).toBeNull();
        expect(current.busy).toBe(false);
    });

    it('runs every script while the connection is not connected and skips the statements that need it', async () => {
        const f = fixtures[0];
        f.database.health = ConnectionHealth.FAILED;
        await openWorkbook();
        step(() => current.start(f.modify));
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
        remote.database.protocol = 'V3_HTTP';
        await openWorkbook();
        step(() => current.start(embedded.modify));
        await vi.waitFor(() => expect(embedded.stream.produce).toHaveBeenCalledTimes(1));
        await openWorkbook('second');
        step(() => current.start(remote.modify));
        await vi.waitFor(() => expect(current.state?.phase).toBe('succeeded'));
        expect(remote.executeQuery).not.toHaveBeenCalled();
        expect(current.state).toMatchObject({ totalScripts: 1, completedScripts: 0, skippedScripts: 1, totalStatements: 0 });
    });

    it('runs a change of inputs while the connection is not connected', async () => {
        const f = fixtures[0];
        f.database.health = ConnectionHealth.NOT_STARTED;
        await openWorkbook();
        step(() => current.start(f.modify, { inputs: ['min'] }));
        // The fixture core derives no dataflow, the run starts and settles
        await vi.waitFor(() => expect(current.state?.phase).toMatch(/succeeded|failed/));
    });

    it('waits for a connection that is connecting, a change of inputs starts once it is online', async () => {
        const f = fixtures[0];
        f.database.health = ConnectionHealth.CONNECTING;
        await openWorkbook();
        step(() => current.start(f.modify));
        expect(current.state).toBeNull();
        step(() => current.start(f.modify, { inputs: ['min'] }));
        expect(current.state).toBeNull();
        await step(async () => act(f, 'HEALTH_CHECK_SUCCEEDED'));
        await vi.waitFor(() => expect(current.state).not.toBeNull());
    });

    it('stops a run once a connection that it runs statements on drops', async () => {
        await openWorkbook();
        await start();
        const f = fixtures[0];
        await step(async () => act(f, 'HEALTH_CHECK_FAILED', { message: 'down' }));
        expect(f.signal?.aborted).toBe(true);
    });

    it('starts while computations of the workbook query the compute database', async () => {
        const f = fixtures[0];
        f.database.activeQueries.push(QueryType.INTERNAL_SQLFRAME);
        await openWorkbook();
        step(() => current.start(f.modify));
        await vi.waitFor(() => expect(f.plan).toHaveBeenCalledTimes(1));
    });

    it.each(['planning', 'running', 'stopping', 'succeeded', 'failed', 'cancelled'] as const)('classifies the %s phase', phase => {
        expect(workbookExecutionIsBusy({ phase } as WorkbookExecutionState))
            .toBe(phase === 'planning' || phase === 'running' || phase === 'stopping');
        expect(workbookExecutionIsBusy(null)).toBe(false);
        expect(workbookExecutionIsBusy(undefined)).toBe(false);
    });
});
