// The runs of workbooks of the runtime (`runWorkbook`, `runScript`, `stopRun` and the `run` slice) on a runtime of the
// tests: starting and stopping, the connections a run needs, previews, changes of inputs, the runs of single scripts
// and the cached results they read. The statements run on the executor of the runtime over channels of the tests. The
// scheduling of a run is tested in Rust (packages/dashql-core-runtime/tests/workbook_run_test.rs).
import type * as arrow from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as core from '../core/index.js';
import { ConnectionHealth } from '../platform/connections/connection_state.js';
import type { ConnectionParams } from '../platform/connections/connection_params.js';
import type { RunResult, Runtime } from './runtime.js';
import { createTestConnection, finishTestSetup, setupTestConnection } from './testing/connection_fixtures.js';
import type { EmbeddedComputeDatabase } from '../platform/embedded_database.js';
import type { HyperDB } from '../platform/hyperdb/hyperdb_wasm.js';
import { createQueryResponseStreamMetrics, QueryExecutionStatus, QueryType, type QueryExecutionResponseStream } from '../platform/query/query_execution_state.js';
import { tableFromArrays } from '../platform/testing/arrow_fixtures.js';
import { memoryWorkbookResultFiles } from '../platform/testing/memory_workbook_result_files.js';
import { openTestHyperDB } from '../platform/testing/test_hyperdb.js';
import { TASK_UPDATE_SCHEDULER } from './store/update_scheduler.js';
import { createTestRuntime, restoreTestWorkbook, type TestRuntime } from './testing/test_runtime.js';
import type { ScriptRunEvent } from '../platform/workbook/workbook_execution.js';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}

/// Let the runtime and the store take their turns
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/// A query as the runtime holds it now
const queryView = (runtime: Runtime, queryId: number) => {
    const view = runtime.module.views('query', [queryId])[0] ?? null;
    return view === 'busy' ? null : view;
};

/// A published workbook that a workbook is a preview of
const PREVIEW = { workbookId: 'c0ffee00-0000-4000-8000-000000000001', versionId: 'c0ffee00-0000-4000-8000-000000000002', connectionId: 'cloud', preview: true };

/// A workbook with a script of two commands on a connection of its own. The runtime creates both when the test opens
/// the workbook.
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
        // eslint-disable-next-line require-yield -- a stream that ends before its first batch
        read: vi.fn<QueryExecutionResponseStream['read']>(async function* (abort) {
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
    let runtime: TestRuntime | null = null;
    /// The latest query of the script
    const latestQueryId = () => {
        const core = runtime!;
        core.flush();
        const scriptKey = core.store.get('workbook', workbookId)!.scriptKeys[0];
        return core.store.get('script', scriptKey)?.latestQueryId ?? null;
    };
    /// Create the workbook in a runtime with two commands that don't depend on each other, a connection without a
    /// protocol runs them one at a time
    const create = (rt: TestRuntime) => {
        runtime = rt;
        const core = rt;
        core.createWorkbook(database.connectionId, workbookId, false, undefined, workbookId);
        core.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: 'create table a (x int);\ncreate table b (x int);', base: '1_commands' } });
        if (database.preview) core.dispatch({ workbook: workbookId }, { kind: 'setCloudLink', value: { link: PREVIEW } });
        core.flush();
    };
    /// The connection of the workbook, the runtime creates it with the health and the protocol of the fixture
    const database = {
        connectionId: `${workbookId}-database`,
        health: ConnectionHealth.ONLINE,
        // Without a protocol the connection runs one statement at a time
        protocol: null as string | null,
        /// The kinds of the queries that the connection runs when the workbook opens
        activeQueries: [] as QueryType[],
        /// Is the workbook a preview of a published workbook?
        preview: false,
    };
    return { workbookId, database, create, latestQueryId, stream, executeQuery, acquisition, execution, cancellation, aborted,
        get signal() { return signal; } };
}

type Fixture = ReturnType<typeof fixture>;

/// The runs of a workbook as the hook of the app reads them
interface Execution {
    readonly state: core.WorkbookRunState | null;
    readonly busy: boolean;
    /// Does a run hold the workbook?
    readonly held: boolean;
    start(options?: { inputs?: string[] }): Promise<RunResult>;
    stop(): void;
}

/// A compute database whose queries run until the test ends: the computations import their results and wait
const PENDING_COMPUTE = {
    terminate: vi.fn(),
    connect: async () => ({
        insertArrowTable: async () => { },
        createTableAs: () => new Promise(() => { }),
        query: () => new Promise(() => { }),
        execute: async () => { },
        close: async () => { },
    }),
} as unknown as EmbeddedComputeDatabase;

describe('the runs of workbooks of the runtime', () => {
    let fixtures: Fixture[];
    let runtime: TestRuntime | null = null;
    let current: Execution;

    beforeEach(() => {
        fixtures = [fixture('first'), fixture('second')];
    });

    afterEach(async () => {
        fixtures.forEach(f => { f.acquisition.resolve(); f.execution.resolve(); f.cancellation.resolve(); });
        await runtime?.destroy();
        runtime = null;
    });

    /// The runs of a workbook of the runtime, read from its slice
    function executionOf(rt: TestRuntime, workbookId: string): Execution {
        const core = rt;
        return {
            get state() { return core.store.get('run', workbookId)?.state ?? null; },
            get busy() { return core.store.get('run', workbookId)?.state?.busy ?? false; },
            get held() { return core.store.get('run', workbookId)?.held != null; },
            start: options => core.runWorkbook(workbookId, { inputs: options?.inputs }),
            stop: () => core.module.stopRun(workbookId),
        };
    }

    /// Create the connection of a fixture in the runtime, the runtime sets it up: online with a channel, connecting,
    /// failed or not started
    async function addConnection(rt: TestRuntime, f: Fixture) {
        const { connectionId, health, protocol } = f.database;
        const params = { hyper: { endpoint: 'http://hyper', ...(protocol == null ? {} : { protocol }) } } as ConnectionParams;
        await createTestConnection(rt, {
            connectionId,
            params,
            channel: health === ConnectionHealth.NOT_STARTED ? undefined : { executeQuery: f.executeQuery },
            health,
            error: 'down',
        });
        // A query of the user runs on the channel until the test ends, a computation of a result of the connection queries
        // the compute database until the test ends
        for (const [i, queryType] of f.database.activeQueries.entries()) {
            if (queryType === QueryType.INTERNAL_SQLFRAME) {
                void rt.analyzeTable(1000 + i, tableFromArrays({ value: [1, 2] }), { connectionId }).catch(() => { });
            } else {
                const metadata = { queryType, title: null, description: null, issuer: null, userProvided: true };
                void rt.execute(connectionId, { query: 'select 1', metadata })[1].catch(() => { });
            }
        }
        if (f.database.activeQueries.length > 0) {
            await vi.waitFor(() => expect(rt.connection(connectionId).queriesActiveOrdered.length).toBeGreaterThanOrEqual(f.database.activeQueries.length));
        }
        expect(rt.connection(connectionId).connectionHealth).toBe(health);
    }

    /// A runtime with the workbooks and the connections of the fixtures, the runs of a workbook as `current`
    async function openWorkbook(workbookId = 'first', options: { computeDatabase?: boolean } = {}) {
        if (runtime == null) {
            runtime = await createTestRuntime({
                computeDatabase: options.computeDatabase === false ? null
                    : fixtures.some(f => f.database.activeQueries.includes(QueryType.INTERNAL_SQLFRAME)) ? PENDING_COMPUTE
                        : { terminate: vi.fn() } as unknown as EmbeddedComputeDatabase,
            });
            for (const f of fixtures) {
                await addConnection(runtime, f);
                f.create(runtime);
            }
        }
        current = executionOf(runtime, workbookId);
    }

    /// Start a run of a fixture and wait until its first statement streams
    async function start(f = fixtures[0]) {
        void current.start();
        await vi.waitFor(() => {
            expect(f.stream.read).toHaveBeenCalledTimes(1);
            expect(current.state?.phase).toBe('running');
        });
        expect(current.busy).toBe(true);
        expect(current.held).toBe(true);
    }

    it('starts no run without the compute database that reads the cached results', async () => {
        fixtures[0].database.health = ConnectionHealth.NOT_STARTED;
        await openWorkbook('first', { computeDatabase: false });
        const run = await current.start();
        expect(run.outcome.refused).toBe('the compute database is not set up');
        expect(current.state).toBeNull();
        expect(current.held).toBe(false);
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

    it('prevents duplicate starts at once and while the run is busy', async () => {
        await openWorkbook();
        const first = current.start();
        const second = await current.start();
        expect(second.outcome.refused).toBe('a run holds the workbook');
        await vi.waitFor(() => expect(fixtures[0].stream.read).toHaveBeenCalledTimes(1));
        expect((await current.start()).outcome.refused).toBe('a run holds the workbook');
        expect(fixtures[0].executeQuery).toHaveBeenCalledTimes(1);
        expect(fixtures[0].latestQueryId()).not.toBeNull();
        fixtures[0].execution.resolve();
        expect((await first).outcome).toMatchObject({ refused: null, failure: null, launched: true });
        expect(current.state?.phase).toBe('succeeded');
        expect(current.held).toBe(false);
    });

    it.each(['execution', 'cancellation'] as const)('keeps stopping busy until both promises drain, with %s settling first', async first => {
        await openWorkbook();
        const run = current.start();
        await vi.waitFor(() => expect(current.state?.phase).toBe('running'));
        await vi.waitFor(() => expect(fixtures[0].stream.read).toHaveBeenCalledTimes(1));
        const f = fixtures[0];
        current.stop();
        current.stop();
        await settle();
        runtime!.flush();
        expect(f.signal?.aborted).toBe(true);
        expect(f.stream.cancel).toHaveBeenCalledTimes(1);
        expect(current.state?.phase).toBe('stopping');
        expect(current.busy).toBe(true);

        f[first].resolve();
        await settle();
        runtime!.flush();
        expect(current.state?.phase).toBe('stopping');
        expect(current.busy).toBe(true);
        expect((await current.start()).outcome.refused).toBe('a run holds the workbook');
        expect(f.executeQuery).toHaveBeenCalledTimes(1);

        f.execution.resolve();
        f.cancellation.resolve();
        expect((await run).outcome.failure?.kind).toBe('cancelled');
        expect(current.state?.phase).toBe('cancelled');
        expect(current.busy).toBe(false);
        expect(current.held).toBe(false);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);

        expect((await current.start()).outcome.failure).toBeNull();
        expect(current.state?.phase).toBe('succeeded');
        expect(f.executeQuery).toHaveBeenCalledTimes(3);
    });

    it('cancels a stream acquired after stop without consuming it or starting queued statements', async () => {
        const f = fixtures[0] = fixture('first', true);
        await openWorkbook();
        const run = current.start();
        await vi.waitFor(() => {
            expect(f.executeQuery).toHaveBeenCalledTimes(1);
            expect(current.state?.phase).toBe('running');
        });
        expect(f.stream.read).not.toHaveBeenCalled();

        current.stop();
        await settle();
        runtime!.flush();
        expect(f.signal?.aborted).toBe(true);
        expect(current.state?.phase).toBe('stopping');
        expect(f.stream.cancel).not.toHaveBeenCalled();

        f.acquisition.resolve();
        await vi.waitFor(() => expect(f.stream.cancel).toHaveBeenCalledTimes(1));
        expect(f.stream.read).not.toHaveBeenCalled();
        runtime!.flush();
        expect(current.state?.phase).toBe('stopping');
        expect(current.busy).toBe(true);

        f.cancellation.resolve();
        await run;
        expect(current.state).toMatchObject({ phase: 'cancelled', totalStatements: 2, completedStatements: 0 });
        expect(current.busy).toBe(false);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(f.stream.cancel).toHaveBeenCalledTimes(1);
        expect(f.stream.read).not.toHaveBeenCalled();
        expect(f.latestQueryId()).not.toBeNull();
    });

    it('completes schema-less commands without requesting their unresolved schema', async () => {
        const f = fixtures[0];
        const getSchema = vi.fn(() => new Promise<null>(() => {}));
        f.stream.getSchema = getSchema;
        await openWorkbook();
        f.execution.resolve();
        await current.start();
        expect(current.state).toMatchObject({ phase: 'succeeded', totalStatements: 2, completedStatements: 2, completedScripts: 1 });
        expect(current.busy).toBe(false);
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
        expect(f.stream.read).toHaveBeenCalledTimes(2);
        expect(getSchema).not.toHaveBeenCalled();
        expect(f.stream.cancel).not.toHaveBeenCalled();
        expect(f.latestQueryId()).not.toBeNull();
    });

    it('does not start with an active query', async () => {
        const f = fixtures[0];
        f.database.activeQueries.push(QueryType.USER_PROVIDED);
        await openWorkbook();
        // The active query runs on the channel
        await vi.waitFor(() => expect(f.executeQuery).toHaveBeenCalledTimes(1));
        const run = await current.start();
        expect(run.outcome.refused).toBe(`the connection ${f.database.connectionId} runs a query`);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(current.state).toBeNull();
        expect(current.busy).toBe(false);
    });

    it('runs every script while the connection is not connected and skips the statements that need it', async () => {
        const f = fixtures[0];
        f.database.health = ConnectionHealth.FAILED;
        await openWorkbook();
        await current.start();
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(current.state).toMatchObject({ phase: 'succeeded', totalScripts: 1, completedScripts: 0, skippedScripts: 1, totalStatements: 0 });
    });

    it('runs a preview of a published workbook on the embedded Hyper only, its other connections are skipped', async () => {
        const [embedded, remote] = fixtures;
        for (const f of fixtures) f.database.preview = true;
        // The second connection is a Hyper server, it is online but a preview doesn't run on it
        remote.database.protocol = 'V3_GRPC';
        await openWorkbook();
        void current.start();
        await vi.waitFor(() => expect(embedded.stream.read).toHaveBeenCalledTimes(1));
        await openWorkbook('second');
        await current.start();
        expect(remote.executeQuery).not.toHaveBeenCalled();
        expect(current.state).toMatchObject({ phase: 'succeeded', totalScripts: 1, completedScripts: 0, skippedScripts: 1, totalStatements: 0 });
    });

    it('runs a change of inputs while the connection is not connected', async () => {
        const f = fixtures[0];
        f.database.health = ConnectionHealth.NOT_STARTED;
        await openWorkbook();
        const run = await current.start({ inputs: ['min'] });
        // No script reads the input, the run settles without statements
        expect(run.outcome.refused).toBeNull();
        expect(current.state?.phase).toBe('succeeded');
    });

    it('waits for a connection that is connecting, a change of inputs starts once it is online', async () => {
        const f = fixtures[0];
        f.database.health = ConnectionHealth.CONNECTING;
        await openWorkbook();
        expect((await current.start()).outcome.refused).toBe(`the connection ${f.database.connectionId} is connecting`);
        expect(current.state).toBeNull();
        expect((await current.start({ inputs: ['min'] })).outcome.refused).toBe('the change of inputs waits for the workbook');
        runtime!.flush();
        expect(runtime!.store.get('run', f.workbookId)).toMatchObject({ pendingInputs: ['min'], busyInputs: ['min'] });
        expect(current.state).toBeNull();
        await finishTestSetup(runtime!, f.database.connectionId, ConnectionHealth.ONLINE);
        await vi.waitFor(() => {
            runtime!.flush();
            expect(current.state?.phase).toBe('succeeded');
        });
        expect(runtime!.store.get('run', f.workbookId)).toMatchObject({ pendingInputs: [], busyInputs: [] });
    });

    it('keeps an input busy from the run that its change stops until the run that applies it ended', async () => {
        await openWorkbook();
        await start();
        const f = fixtures[0];
        const view = () => {
            runtime!.flush();
            return runtime!.store.get('run', f.workbookId);
        };
        expect(view()?.busyInputs).toEqual([]);
        // The change stops the run that holds the workbook and waits for it
        expect((await current.start({ inputs: ['min'] })).outcome.refused).toBe('the change of inputs waits for the workbook');
        await settle();
        expect(view()).toMatchObject({ pendingInputs: ['min'], busyInputs: ['min'], state: { phase: 'stopping' } });
        // Once the stopped run drained, the change runs, no script reads the input
        f.execution.resolve();
        f.cancellation.resolve();
        await vi.waitFor(() => expect(view()?.held).toBeNull());
        expect(view()).toMatchObject({ pendingInputs: [], busyInputs: [], state: { phase: 'succeeded' } });
    });

    it('stops a run once a connection that it runs statements on drops', async () => {
        await openWorkbook();
        await start();
        const f = fixtures[0];
        // A setup of the connection whose health check fails
        void setupTestConnection(runtime!, f.database.connectionId, { channel: { executeQuery: f.executeQuery }, health: ConnectionHealth.FAILED, error: 'down' });
        await vi.waitFor(() => expect(f.signal?.aborted).toBe(true));
    });

    it('starts while computations of the workbook query the compute database', async () => {
        const f = fixtures[0];
        f.database.activeQueries.push(QueryType.INTERNAL_SQLFRAME);
        await openWorkbook();
        expect(f.executeQuery).not.toHaveBeenCalled();
        void current.start();
        await vi.waitFor(() => expect(f.executeQuery).toHaveBeenCalledTimes(1));
    });
});

describe('the runs of scripts of the runtime', () => {
    let runtime: TestRuntime | null = null;
    let database: HyperDB | null = null;

    afterEach(async () => {
        await runtime?.destroy();
        runtime = null;
        await database?.terminate();
        database = null;
    });

    /// A runtime on the embedded Hyper of the tests with a connection whose channel answers every statement with a
    /// table of its number, and a workbook with scripts on it. The stored results in memory if asked for, the
    /// connection reuses them.
    async function scripts(entries: Array<[string, string]>, options: { cache?: boolean } = {}) {
        database = await openTestHyperDB('workbook_runs_test');
        const cache = options.cache ? memoryWorkbookResultFiles() : null;
        const rt = await createTestRuntime({ computeDatabase: database, results: cache });
        runtime = rt;
        const statements: string[] = [];
        const answer = (table: arrow.Table): QueryExecutionResponseStream => {
            const stream: QueryExecutionResponseStream = {
                getMetrics: createQueryResponseStreamMetrics,
                getSchema: async () => table.schema,
                read: async function* () { for (const batch of table.batches) yield { type: 'batch' as const, batch }; },
            };
            return stream;
        };
        const executeQuery = vi.fn(async (query: string) => {
            statements.push(query);
            return answer(tableFromArrays({ n: Int32Array.from([statements.length]) }));
        });
        const connectionId = crypto.randomUUID();
        await rt.addConnection({ connectionId, params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as ConnectionParams, channel: { executeQuery } });
        const workbook = rt.addWorkbook(connectionId, entries, { name: 'scripts' });
        const core = rt;
        /// A script of the workbook as the store holds it now
        const script = (fileName: string) => {
            core.flush();
            const key = core.store.get('workbook', workbook.workbookId)!.scriptRefs[fileName].scriptId;
            return core.store.get('script', key)!;
        };
        const run = (fileName: string, refresh = false) => core.runScript(workbook.workbookId, script(fileName).scriptKey, { refresh });
        return { rt, core, connectionId, workbookId: workbook.workbookId, statements, executeQuery, script, run, cache };
    }

    it('runs a script with the scripts it references and shows its result on the script', async () => {
        const f = await scripts([['base.sql', 'select 1 as a;'], ['bar.sql', 'select a from :base;']]);
        const run = await f.run('bar.sql');
        expect(run.outcome).toMatchObject({ refused: null, failure: null, launched: true });
        // The reference is inlined into the query of the script
        expect(f.statements).toHaveLength(1);
        expect(f.statements[0]).toContain('select 1 as a');
        const queryId = f.script('bar.sql').latestQueryId!;
        expect(run.outcome.outputs[1]).toBe(queryId);
        const query = queryView(f.core, queryId)!;
        expect(query.status).toBe(QueryExecutionStatus.SUCCEEDED);
        expect(query.queryMetadata).toMatchObject({ queryType: QueryType.USER_PROVIDED, workbookId: f.workbookId, issuer: expect.any(String) });
        expect(f.core.table(query.resultTable?.id)?.numRows).toBe(1);
        expect(f.core.store.get('run', f.workbookId)?.held).toBeNull();
    });

    /// Hold the imports of the results of the analyses into the compute database until the test releases them
    function holdImports(hyper: HyperDB) {
        const importing = deferred();
        const released = deferred();
        const connect = hyper.connect.bind(hyper);
        vi.spyOn(hyper, 'connect').mockImplementation(async (...args: Parameters<HyperDB['connect']>) => {
            const conn = await connect(...args);
            const insert = conn.insertArrowTable.bind(conn);
            conn.insertArrowTable = async (table, options) => {
                importing.resolve();
                await released.promise;
                return await insert(table, options);
            };
            return conn;
        });
        return { importing: importing.promise, release: released.resolve };
    }

    /// The computation of a query as the runtime holds it now
    const computationOf = (f: { core: TestRuntime }, queryId: number) => {
        f.core.flush();
        return f.core.store.get('computation', queryId) ?? null;
    };

    it('is done before the analysis of the result of a script, which replaces the computation of the earlier result', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;']]);
        expect((await f.run('foo.sql')).outcome.failure).toBeNull();
        const first = f.script('foo.sql').latestQueryId!;
        // The first analysis in a fresh compute database can take seconds on CI
        await vi.waitFor(() => expect(computationOf(f, first)?.rowNumberColumnName ?? null).not.toBeNull(), { timeout: 30_000 });
        // The import of the next result waits, the run doesn't
        const imports = holdImports(database!);
        expect((await f.run('foo.sql')).outcome.failure).toBeNull();
        await imports.importing;
        const latest = f.script('foo.sql').latestQueryId!;
        expect(latest).not.toBe(first);
        expect(queryView(f.core, latest)?.status).toBe(QueryExecutionStatus.SUCCEEDED);
        expect(f.core.table(queryView(f.core, latest)?.resultTable?.id)?.numRows).toBe(1);
        // The computation of the result is there with the result as its table, the earlier one went with its result
        expect(computationOf(f, latest)).not.toBeNull();
        expect(computationOf(f, latest)?.rowNumberColumnName ?? null).toBeNull();
        expect(computationOf(f, first)).toBeNull();
        imports.release();
        await vi.waitFor(() => expect(computationOf(f, latest)?.rowNumberColumnName ?? null).not.toBeNull(), { timeout: 30_000 });
    });

    it('stops the analyses of the results of a run that is stopped, the results keep their computations', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select 2 as b;']]);
        // The statement of bar streams until the run stops it
        const answer = f.executeQuery.getMockImplementation()!;
        f.executeQuery.mockImplementation(async (query: string) => {
            if (!query.includes('select 2')) return await answer(query);
            f.statements.push(query);
            return {
                getMetrics: createQueryResponseStreamMetrics,
                getSchema: async () => null,
                read: (abort?: AbortSignal) => ({
                    [Symbol.asyncIterator]: () => ({
                        next: () => new Promise<never>((_resolve, reject) => abort?.addEventListener('abort', () => reject(new DOMException('Query was cancelled', 'AbortError')))),
                    }),
                }),
            } satisfies QueryExecutionResponseStream;
        });
        const imports = holdImports(database!);
        const run = f.core.runWorkbook(f.workbookId);
        await imports.importing;
        await vi.waitFor(() => expect(f.statements.some(text => text.includes('select 2'))).toBe(true));
        f.core.module.stopRun(f.workbookId);
        imports.release();
        expect((await run).outcome.failure).not.toBeNull();
        const foo = f.script('foo.sql').latestQueryId!;
        expect(queryView(f.core, foo)?.status).toBe(QueryExecutionStatus.SUCCEEDED);
        await settle();
        await settle();
        // The analysis stopped with the import, the result keeps its computation without a data frame
        expect(computationOf(f, foo)).not.toBeNull();
        expect(computationOf(f, foo)?.dataFrame ?? null).toBeNull();
    });

    it('refuses a run of a script while a run holds the workbook', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;']]);
        const first = f.run('foo.sql');
        const second = await f.run('foo.sql');
        expect(second.outcome.refused).toBe('a run holds the workbook');
        expect((await first).outcome.failure).toBeNull();
        expect(f.executeQuery).toHaveBeenCalledOnce();
    });

    it('analyzes an outdated script before it runs', async () => {
        const f = await scripts([]);
        // A restored workbook is not analyzed yet
        const restored = await restoreTestWorkbook(f.core, f.rt.options.storage!, [['foo.sql', 'select 2 as b;', f.connectionId]]);
        const scriptKey = restored.scriptKeys[0];
        expect(f.core.store.get('script', scriptKey)?.analysisOutdated).toBe(true);
        expect((await f.core.runScript(restored.workbookId, scriptKey)).outcome.failure).toBeNull();
        expect(f.core.store.get('script', scriptKey)?.analysisOutdated).toBe(false);
        expect(f.statements).toEqual([expect.stringContaining('select 2 as b')]);
    });

    it('shows the errors of the plan of a script as failed queries of the script', async () => {
        const f = await scripts([['bar.sql', 'select * from :missing;'], ['empty.sql', '-- nothing']]);
        const bar = await f.run('bar.sql');
        expect(bar.outcome.failure).toMatchObject({ kind: 'plan', message: expect.stringContaining(':missing') });
        expect((bar.error as Error).name).toBe('ScriptPlanError');
        const empty = await f.run('empty.sql');
        expect(empty.outcome.failure).toMatchObject({ kind: 'plan', message: expect.stringContaining('no statement') });
        // Nothing runs, the scripts record the errors as failed queries that show where their results would be
        expect(f.executeQuery).not.toHaveBeenCalled();
        for (const [fileName, outcome] of [['bar.sql', bar], ['empty.sql', empty]] as const) {
            const query = queryView(f.core, f.script(fileName).latestQueryId!)!;
            expect(query.status).toBe(QueryExecutionStatus.FAILED);
            expect(query.error?.message).toBe(outcome.outcome.failure?.message);
            expect(query.queryMetadata.resultOwner).toBe(`${f.workbookId}/${f.script(fileName).scriptKey}`);
        }
    });

    it('stores the result of a script, reuses it while its key matches and refreshes it on request', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;']], { cache: true });
        const first = await f.run('foo.sql');
        expect(first.outcome.failure).toBeNull();
        await f.core.module.flushResultWrites();
        const [key] = await f.core.module.resultKeys(f.workbookId);
        expect(key).not.toBeNull();
        // The workbook keeps one file of the script, named after the script and its key
        expect(f.cache!.names(f.workbookId)).toEqual([expect.stringMatching(new RegExp(`^foo\\.${key}\\.[0-9a-f]{20}\\.parquet$`))]);
        f.core.flush();
        expect(queryView(f.core, f.script('foo.sql').latestQueryId!)).toMatchObject({ servedFromCache: false });
        // The second run reuses the stored result instead of the connection. The script shows the result that it wrote
        // to that file already, the run doesn't read the file again.
        const shown = f.script('foo.sql').latestQueryId;
        await f.run('foo.sql');
        expect(f.executeQuery).toHaveBeenCalledOnce();
        expect(f.script('foo.sql').latestQueryId).toBe(shown);
        // A refresh runs the script again, its new file replaces the old one
        await f.run('foo.sql', true);
        await f.core.module.flushResultWrites();
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
        expect(f.cache!.names(f.workbookId)).toHaveLength(1);
    });

    it('shows the stored result of a script on its view, outdated once its key changed', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;']], { cache: true });
        expect(f.script('foo.sql').storedResult).toBeNull();
        await f.run('foo.sql');
        await f.core.module.flushResultWrites();
        const [key] = await f.core.module.resultKeys(f.workbookId);
        const [name] = f.cache!.names(f.workbookId);
        // The runtime looks the results up once the run wrote its result
        await vi.waitFor(() => expect(f.script('foo.sql').storedResult).toEqual({ name, key, writtenAt: expect.any(Number), current: true }));
        edit(f.rt, f.workbookId, f.script('foo.sql').scriptKey, 8, '2');
        await vi.waitFor(() => expect(f.script('foo.sql').storedResult).toMatchObject({ name, key, current: false }));
    });

    it('keeps the stored result of a script current while another script of the workbook can\'t be planned', async () => {
        const broken = ['select * from :missing;', 'selec 1', '/** @param :x */\nselect :x;'];
        const f = await scripts([['foo.sql', 'select 1 as a;'], ...broken.map((text, i): [string, string] => [`broken${i}.sql`, text])], { cache: true });
        expect((await f.run('foo.sql')).outcome.failure).toBeNull();
        await f.core.module.flushResultWrites();
        const [key] = await f.core.module.resultKeys(f.workbookId);
        expect(key).not.toBeNull();
        await vi.waitFor(() => expect(f.script('foo.sql').storedResult).toMatchObject({ key, current: true }));
    });

    it('outdates the stored results downstream of a refreshed script and runs them again', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select a from :foo;']], { cache: true });
        expect((await f.core.runWorkbook(f.workbookId, {})).outcome.failure).toBeNull();
        await f.core.module.flushResultWrites();
        await vi.waitFor(() => {
            expect(f.script('foo.sql').storedResult).toMatchObject({ current: true });
            expect(f.script('bar.sql').storedResult).toMatchObject({ current: true });
        });
        // Both results fit, a run of the workbook reuses them
        const calls = f.executeQuery.mock.calls.length;
        expect((await f.core.runWorkbook(f.workbookId, {})).outcome.failure).toBeNull();
        expect(f.executeQuery.mock.calls.length).toBe(calls);
        // A refresh of foo writes a new result of foo, the result of bar was computed from the old one
        await f.run('foo.sql', true);
        await f.core.module.flushResultWrites();
        await vi.waitFor(() => expect(f.script('bar.sql').storedResult).toMatchObject({ current: false }));
        expect(f.script('foo.sql').storedResult).toMatchObject({ current: true });
        // The next run of the workbook reuses foo and runs bar
        const refreshed = f.executeQuery.mock.calls.length;
        expect((await f.core.runWorkbook(f.workbookId, {})).outcome.failure).toBeNull();
        expect(f.statements.slice(refreshed)).toEqual([expect.stringContaining('select a from foo')]);
        await f.core.module.flushResultWrites();
        await vi.waitFor(() => expect(f.script('bar.sql').storedResult).toMatchObject({ current: true }));
    });

    it('lets the steps of a run wait for the frame, its start and its end go out at once', async () => {
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const f = await scripts(files.map((name, i): [string, string] => [`${name}.sql`, `select ${i} as ${name};`]), { cache: true });
        expect((await f.core.runWorkbook(f.workbookId, {})).outcome.failure).toBeNull();
        await f.core.module.flushResultWrites();
        // The analyses of the results follow the run in the compute database, each one flushes at once when it's done.
        // They would count as flushes of the next run, e.g. in Firefox, where they take longer.
        await vi.waitFor(() => {
            for (const name of files) {
                expect(computationOf(f, f.script(`${name}.sql`).latestQueryId!)?.rowNumberColumnName ?? null).not.toBeNull();
            }
        }, { timeout: 30_000 });
        await f.rt.clock.elapse();
        await settle();
        // The run checks the stored result of every script, each check is a step of its own that waits for the frame:
        // the urgent flushes are those of the start, the analysis, the planning and the end, whatever the scripts
        const urgent = vi.spyOn(TASK_UPDATE_SCHEDULER, 'afterTask');
        try {
            expect((await f.core.runWorkbook(f.workbookId, {})).outcome.failure).toBeNull();
            expect(urgent.mock.calls.length).toBeLessThan(files.length);
            expect(f.core.store.get('run', f.workbookId)?.state).toMatchObject({ phase: 'succeeded', completedScripts: files.length });
        } finally {
            urgent.mockRestore();
        }
    });

    it('keeps the results of workbooks apart, also for the same script on the same connection', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;']], { cache: true });
        const other = f.rt.addWorkbook(f.connectionId, [['foo.sql', 'select 1 as a;']], { name: 'other' });
        await f.run('foo.sql');
        await f.core.module.flushResultWrites();
        await vi.waitFor(() => expect(f.script('foo.sql').storedResult).not.toBeNull());
        await f.rt.clock.elapse();
        f.core.flush();
        const [same] = other.scriptKeys;
        expect(f.core.store.get('script', same)?.storedResult).toBeNull();
        expect(f.cache!.names(other.workbookId)).toEqual([]);
        // The other workbook runs its query anew
        expect((await f.core.runScript(other.workbookId, same)).outcome.failure).toBeNull();
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
    });

    it('reads the stored results of a workbook when it is first shown, whatever their keys, and runs nothing', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select 2 as b;']], { cache: true });
        // A result of an import, of another version of the app: its key is no key of the script here
        const name = f.cache!.put(f.workbookId, `foo.${'0'.repeat(64)}.00000000000100000001.parquet`, tableFromArrays({ a: Int32Array.from([41]) }));
        f.core.showWorkbook(f.workbookId);
        await vi.waitFor(() => expect(f.script('foo.sql').latestResultQueryId).not.toBeNull());
        const query = queryView(f.core, f.script('foo.sql').latestResultQueryId!)!;
        expect(query).toMatchObject({ servedFromCache: true });
        expect(f.core.table(query.resultTable?.id)?.getChild('a')?.toArray()).toEqual(Int32Array.from([41]));
        expect(f.script('bar.sql').latestResultQueryId).toBeNull();
        expect(f.executeQuery).not.toHaveBeenCalled();
        // The read reports its progress like a run of the workbook, over the scripts that it looked at
        await vi.waitFor(() => expect(f.core.store.get('run', f.workbookId)).toMatchObject({
            held: null, state: { phase: 'succeeded', busy: false, completedScripts: 2, totalScripts: 2, skippedScripts: 0 },
        }));
        await vi.waitFor(() => expect(f.script('foo.sql').storedResult).toMatchObject({ name, current: false }));
        // Showing it again reads nothing, a run computes the result of the outdated key anew
        f.core.showWorkbook(f.workbookId);
        await f.run('foo.sql');
        expect(f.executeQuery).toHaveBeenCalledOnce();
        await f.core.module.flushResultWrites();
        await vi.waitFor(() => expect(f.script('foo.sql').storedResult).toMatchObject({ current: true }));
        expect(f.cache!.names(f.workbookId)).toHaveLength(1);
    });

    it('pins the file of the stored result of a script while a caller uses it', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;']], { cache: true });
        await f.run('foo.sql');
        await f.core.module.flushResultWrites();
        const [name] = f.cache!.names(f.workbookId);
        const events: string[] = [];
        f.cache!.pin.mockImplementation(async (_workbookId, pinned) => {
            events.push(`pin ${pinned}`);
            return async () => { events.push(`release ${pinned}`); };
        });
        const use = async (file: string) => {
            events.push(`use ${file}`);
            return file.length;
        };
        expect(await f.core.withStoredResult(f.workbookId, 'foo.sql', use)).toBe(name.length);
        expect(events).toEqual([`pin ${name}`, `use ${name}`, `release ${name}`]);
        // A use that fails releases the pin as well, a script without a result uses nothing
        events.length = 0;
        await expect(f.core.withStoredResult(f.workbookId, 'foo.sql', async () => { throw new Error('gone'); })).rejects.toThrow('gone');
        expect(events).toEqual([`pin ${name}`, `release ${name}`]);
        expect(await f.core.withStoredResult(f.workbookId, 'other.sql', use)).toBeNull();
        // A file that another window removes between the listing and the pin is no stored result
        events.length = 0;
        f.cache!.pin.mockImplementationOnce(async (workbookId, pinned) => {
            f.cache!.workbooks.get(workbookId)?.delete(pinned);
            events.push(`pin ${pinned}`);
            return async () => { events.push(`release ${pinned}`); };
        });
        expect(await f.core.withStoredResult(f.workbookId, 'foo.sql', use)).toBeNull();
        expect(events).toEqual([`pin ${name}`, `release ${name}`]);
    });

    it('exports the stored results of the scripts and leaves out one that can not be read', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;']], { cache: true });
        await f.run('foo.sql');
        await f.core.module.flushResultWrites();
        await f.rt.storage.flush();
        const exported = async () => await f.core.exportTables(f.workbookId, { results: true }, async () => {});
        expect(await exported()).toMatchObject({ cachedScripts: 1, totalScripts: 1, files: 1 });
        f.cache!.readFile.mockRejectedValueOnce(new DOMException('The file is gone', 'NotFoundError'));
        expect(await exported()).toMatchObject({ cachedScripts: 0, totalScripts: 1, files: 0 });
    });

    it('renames the result of a renamed script and removes the result of a deleted one as garbage', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select 2 as b;']], { cache: true });
        await f.run('foo.sql');
        await f.run('bar.sql');
        await f.core.module.flushResultWrites();
        expect(f.cache!.names(f.workbookId)).toHaveLength(2);
        expect(f.core.dispatch({ workbook: f.workbookId }, { kind: 'renameScript', value: { fileName: 'foo.sql', newName: 'renamed' } }).ok).toBe(true);
        expect(f.core.dispatch({ workbook: f.workbookId }, { kind: 'deleteScript', value: { fileName: 'bar.sql' } }).ok).toBe(true);
        const renamed = expect.stringMatching(/^renamed\.[0-9a-f]{64}\.[0-9a-f]{20}\.parquet$/);
        await vi.waitFor(() => expect(f.cache!.names(f.workbookId)).toContainEqual(renamed));
        // The renamed script reuses its result, the end of the run removes the file of the deleted script
        await f.run('renamed.sql');
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
        expect(f.cache!.names(f.workbookId)).toEqual([renamed]);
    });

    /// An editor event of a script as the editor sends it: typed text at an offset, or a move of the cursor
    function edit(rt: Runtime, workbookId: string, scriptKey: number, offset: number, text: string | null) {
        rt.flush();
        const script = rt.store.get('script', scriptKey)!;
        const editor = core.buffers.editor;
        const change = text == null ? [] : [new editor.EditorTextChangeT(BigInt(offset), BigInt(offset), text)];
        const cursor = BigInt(offset + (text?.length ?? 0));
        const event = new editor.EditorEventT(
            script.scriptSession.getTextVersion(), change, new editor.EditorSelectionT(cursor, cursor), editor.EditorEventOrigin.USER,
            text == null ? editor.EditorEventIntent.SELECTION : editor.EditorEventIntent.EDIT, editor.EditorEventAction.TYPE, text != null,
        );
        expect(rt.applyEditorEvent({ workbookId, scriptKey, sessionGeneration: script.sessionGeneration }, event, script.editorUpdate)?.status).toBe(editor.EditorUpdateStatus.OK);
    }

    it('looks up the stored results of the workbook that changed once the changes paused, a move of the cursor looks up none', async () => {
        const f = await scripts([['foo.sql', 'select 1 as a;']], { cache: true });
        const other = f.rt.addWorkbook(f.connectionId, [['bar.sql', 'select 2 as b;']], { name: 'other' });
        await f.run('foo.sql');
        await f.core.module.flushResultWrites();
        await vi.waitFor(() => expect(f.script('foo.sql').storedResult).not.toBeNull());
        await f.rt.clock.elapse();
        f.cache!.files.mockClear();
        const foo = f.script('foo.sql').scriptKey;
        for (let offset = 0; offset < 5; ++offset) edit(f.rt, f.workbookId, foo, offset, null);
        await f.rt.clock.elapse();
        expect(f.cache!.files).not.toHaveBeenCalled();
        // Typing looks up the scripts of the typed workbook once, the other workbook keeps its results
        for (const [offset, text] of [[8, '2'], [9, '3']] as const) edit(f.rt, f.workbookId, foo, offset, text);
        await f.rt.clock.elapse();
        await vi.waitFor(() => expect(f.cache!.files.mock.calls.length).toBeGreaterThan(0));
        expect(f.cache!.files.mock.calls.map(([workbookId]) => workbookId)).not.toContain(other.workbookId);
        // The stored results that the lookup showed change nothing that its keys come from
        await vi.waitFor(() => expect(f.script('foo.sql').storedResult).toMatchObject({ current: false }));
        f.cache!.files.mockClear();
        await f.rt.clock.elapse();
        await f.rt.clock.elapse();
        expect(f.cache!.files).not.toHaveBeenCalled();
    });

    it('runs create, insert and select across scripts in the order of their dependencies', async () => {
        const f = await scripts([
            ['1_create.sql', 'create table items (id int);'],
            ['2_insert.sql', 'insert into items values (7);'],
            ['10_query.sql', 'select id from items;'],
        ]);
        const run = await f.core.runWorkbook(f.workbookId);
        expect(run.outcome.failure).toBeNull();
        expect(f.statements).toEqual(['create table items (id int)', 'insert into items values (7)', 'select id from items']);
        expect(f.core.store.get('run', f.workbookId)?.state).toMatchObject({ phase: 'succeeded', completedScripts: 3, completedStatements: 3 });
        // Every script shows the query of its statement, the output is the result of the last one
        expect(f.script('10_query.sql').latestResultQueryId).toBe(f.script('10_query.sql').latestQueryId);
        expect(queryView(f.core, f.script('1_create.sql').latestQueryId!)?.queryText).toBe('create table items (id int)');
    });

    it('shows the last output of a script after its trailing commands', async () => {
        const f = await scripts([['1_outputs.sql', 'create table items (id int); select 1; select 2; insert into items values (3);']]);
        await f.core.runWorkbook(f.workbookId);
        // A Hyper server runs the statements that don't depend on each other at once
        expect(f.statements[0]).toBe('create table items (id int)');
        expect([...f.statements].sort()).toEqual(['create table items (id int)', 'insert into items values (3)', 'select 1', 'select 2']);
        const script = f.script('1_outputs.sql');
        expect(queryView(f.core, script.latestQueryId!)?.queryText).toBe('select 2');
        expect(script.latestResultQueryId).toBe(script.latestQueryId);
    });

    it('runs EXPLAIN as an output statement', async () => {
        const f = await scripts([['1_explain.sql', 'explain select 2;']]);
        await f.core.runWorkbook(f.workbookId);
        expect(f.statements).toEqual(['explain select 2']);
        expect(f.script('1_explain.sql').latestResultQueryId).not.toBeNull();
        expect(f.script('1_explain.sql').annotations.visualizeQuery).toBeNull();
    });

    it('captures the visualization of the last output, also before a trailing DELETE', async () => {
        const f = await scripts([['1_visualize.sql',
            'create table items (id int);\n/* @vis table */\nselect id from items;\n'
            + '/* @vis table\n   @board row=2 column=4 width=8 height=5 */\nselect 2 as value;\n'
            + 'delete from items;']]);
        await f.core.runWorkbook(f.workbookId);
        // A Hyper server runs the statements that don't depend on each other at once
        expect(f.statements[0]).toBe('create table items (id int)');
        expect([...f.statements].sort()).toEqual(['create table items (id int)', 'delete from items', 'select 2 as value', 'select id from items']);
        const script = f.script('1_visualize.sql');
        expect(queryView(f.core, script.latestQueryId!)?.queryText).toBe('select 2 as value');
        expect(script.annotations.visualizeQuery).toMatchObject({
            renderer: 'table', sql: 'select 2 as value', statementId: 2, dashboardSpec: { row: 2, column: 4, width: 8, height: 5 },
        });
    });

    it('runs an unsupported SET as a barrier in workbook order', async () => {
        const f = await scripts([['1_valid.sql', 'select 1;'], ['2_set.sql', 'set foo = 1;'], ['3_after.sql', 'select 2;']]);
        await f.core.runWorkbook(f.workbookId);
        expect(f.statements).toEqual(['select 1', 'set foo = 1', 'select 2']);
        expect(f.core.store.get('run', f.workbookId)?.state).toMatchObject({ phase: 'succeeded', completedStatements: 3 });
    });

    it('reports the events of the scripts of a run of the workbook and fails with the error of a statement', async () => {
        const f = await scripts([['1_ok.sql', 'select 1 as a;'], ['2_bad.sql', 'select 2 as b;']]);
        f.executeQuery.mockImplementation(async (query: string) => {
            f.statements.push(query);
            if (query.includes('select 2')) throw new Error('the channel failed');
            const table = tableFromArrays({ n: Int32Array.from([1]) });
            const stream: QueryExecutionResponseStream = {
                getMetrics: createQueryResponseStreamMetrics,
                getSchema: async () => table.schema,
                read: async function* () { for (const batch of table.batches) yield { type: 'batch' as const, batch }; },
            };
            return stream;
        });
        const events: Array<[string, ScriptRunEvent]> = [];
        const run = await f.core.runWorkbook(f.workbookId, {}, { onScript: (file, event) => events.push([file, event]) });
        expect(run.outcome.failure).toMatchObject({ kind: 'error', message: 'the channel failed' });
        const failed = events.find(([file, event]) => file === '2_bad.sql' && event.type === 'failed')?.[1];
        expect(failed).toMatchObject({ type: 'failed', error: expect.objectContaining({ message: 'the channel failed' }) });
        expect(queryView(f.core, (failed as { queryId: number }).queryId)?.queryText).toContain('select 2');
        expect(events.filter(([, event]) => event.type === 'planned').map(([file]) => file).sort()).toEqual(['1_ok.sql', '2_bad.sql']);
        expect(f.core.store.get('run', f.workbookId)?.state).toMatchObject({ phase: 'failed', error: 'the channel failed' });
    });
});
