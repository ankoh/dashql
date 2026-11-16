import * as arrow from 'apache-arrow';
import * as core from '../core/index.js';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

import { createRuntime, type Runtime } from './runtime.js';
import { ORDINAL_COLUMN, ROWNUMBER_COLUMN, STRING_COLUMN, TaskStatus, resolveMatchingRows, resolveSummaries } from '../platform/compute/computation_types.js';
import { openTestHyperDB } from '../platform/testing/test_hyperdb.js';
import type { HyperDB } from '../platform/platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../platform/testing/test_logger.js';
import { newDefaultHyperWasmConnection } from '../platform/connections/connection_params.js';
import { QueryExecutionStatus, QueryType } from '../platform/query/query_execution_state.js';
import { vectorFromArray } from '../platform/testing/arrow_fixtures.js';
import { TASK_UPDATE_SCHEDULER } from './store/update_scheduler.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

// The computations of the runtime of the module on the embedded Hyper: the analysis of a result, then the requests of
// the views, read through the store.

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

describe('The computations of the runtime', () => {
    let database: HyperDB | null = null;
    let runtime: Runtime | null = null;

    afterEach(async () => {
        await runtime?.destroy();
        runtime = null;
        await database?.terminate();
        database = null;
    });

    /// The tables of the data frames in the compute database
    async function dataFrameTables(): Promise<string[]> {
        const conn = await database!.connect();
        try {
            const tables = await conn.query(`
                SELECT c.relname AS name
                FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind = 'r' AND n.nspname = 'public'
            `);
            return tables.toArray().map(row => String(row.name)).filter(name => name.startsWith('__df_')).sort();
        } finally {
            await conn.close();
        }
    }

    async function analyzed(): Promise<Runtime> {
        database = await openTestHyperDB('runtime_computations_test');
        runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, core: dql, computeDatabase: async () => database! });
        const table = new arrow.Table({
            score: vectorFromArray([42, 10, 10, 30], new arrow.Float64()),
            name: vectorFromArray(['a', 'b', 'a', 'c'], new arrow.Utf8()),
        });
        // The module learns the rows and the schema of the result, its data never crosses
        const tables = (runtime as unknown as { tables: core.RuntimeTables }).tables;
        const read = vi.spyOn(tables, 'read');
        const describe = vi.spyOn(tables, 'describe');
        await runtime.analyzeTable(1, table, { connectionId: 'main' });
        expect(read).not.toHaveBeenCalled();
        expect(describe).toHaveBeenCalled();
        read.mockRestore();
        describe.mockRestore();
        return runtime;
    }

    /// The view of the computation once the runtime is idle
    async function settled(rt: Runtime, done: (view: core.ComputationView) => boolean): Promise<core.ComputationView> {
        await vi.waitFor(() => {
            rt.flush();
            const view = rt.store.get('computation', 1);
            expect(view != null && done(view)).toBe(true);
        }, { timeout: 30_000 });
        return rt.store.get('computation', 1)!;
    }

    it('analyzes a result', async () => {
        const rt = await analyzed();
        const computation = rt.store.get('computation', 1)!;
        expect(computation.connectionId).toBe('main');
        expect(computation.dataTableRows).toBe(4);
        expect(rt.table(computation.dataTable)?.schema.fields.map(field => field.name)).toEqual(expect.arrayContaining(['score', 'name', '_rownum']));
        expect(computation.dataTableFields).toEqual(['score', 'name']);
        expect(computation.columnGroups.map(group => group.type)).toEqual([ROWNUMBER_COLUMN, ORDINAL_COLUMN, STRING_COLUMN]);
        expect(computation.rowNumberColumnName).toBe('_rownum');
        expect(computation.dataFrame).not.toBeNull();

        const summaries = resolveSummaries(computation, rt, new TestLogger());
        expect(summaries.tableAggregation?.table.numRows).toBe(1);
        const score = summaries.columnAggregates[1];
        expect(score?.type).toBe(ORDINAL_COLUMN);
        if (score?.type !== ORDINAL_COLUMN) return;
        expect(score.value.columnAnalysis).toMatchObject({ totalCount: 4, countNull: 0, countNotNull: 4 });
        // The values are formatted like the cells of the grid
        expect(score.value.columnAnalysis.minValue).toMatch(/^10/);
        expect(score.value.columnAnalysis.maxValue).toMatch(/^42/);
        expect(score.value.columnAnalysis.binLowerBounds[0]).toMatch(/^10/);
        expect(score.value.columnAnalysis.binValueCounts.reduce((sum, count) => sum + count, 0n)).toBe(4n);
        expect(score.value.columnEntry.inputFieldType.typeId).toBe(arrow.Type.Float);
        // The summaries keep their objects while their tables are the same
        expect(resolveSummaries(computation, rt, new TestLogger()).columnAggregates[1]).toBe(score);

        const name = summaries.columnAggregates[2];
        expect(name?.type).toBe(STRING_COLUMN);
        if (name?.type !== STRING_COLUMN) return;
        expect(name.value.analysis).toMatchObject({ totalCount: 4, countDistinct: 3, isUnique: false });
        expect(name.value.analysis.frequentValueStrings[0]).toBe('a');
        expect(Array.from(name.value.analysis.frequentValueCounts)).toEqual([2n, 1n, 1n]);

        expect(computation.tasks.columnAggregationTasks[1]?.progress.status).toBe(TaskStatus.TASK_SUCCEEDED);
        expect(computation.tasks.systemColumnTask?.progress.status).toBe(TaskStatus.TASK_SUCCEEDED);
    }, 60_000);

    it('filters, orders and searches an analyzed result', async () => {
        const rt = await analyzed();
        const target = { computation: 1 };

        // A range of the histogram of the score
        expect(rt.dispatch(target, { kind: 'histogramFilter', value: { columnGroup: 1, selection: [1, 1000] } }).ok).toBe(true);
        let computation = await settled(rt, view => view.filterTable != null && view.tasks.filteringTask?.progress.status === TaskStatus.TASK_SUCCEEDED);
        expect(computation.crossFilters).toEqual([{ kind: 'histogram', column: 1, selection: [1, 1000] }]);
        expect(computation.filterTable?.rows).toBe(2);

        // Ordered by the score, descending, over the filtered rows
        rt.dispatch(target, { kind: 'orderBy', value: { constraints: [{ field: 'score', ascending: false }] } });
        computation = await settled(rt, view => view.orderingTable != null);
        expect(rt.table(computation.orderingTable?.dataTable)?.toArray().map(row => row._rownum)).toEqual([1n, 4n]);

        // The summary of the name over the selected rows
        rt.dispatch(target, { kind: 'requestFilteredColumnAggregation', value: { columnGroup: 2 } });
        computation = await settled(rt, view => view.filteredColumnAggregates[2] != null && !view.filteredColumnAggregatesOutdated[2]);
        expect(resolveSummaries(computation, rt, new TestLogger()).filteredColumnAggregates[2]?.type).toBe(STRING_COLUMN);

        // A search of the data, the ordering follows it
        rt.dispatch(target, { kind: 'setResultSearchPattern', value: { search: 'data', pattern: 'b' } });
        computation = await settled(rt, view => !view.dataSearch.pending && view.dataSearch.appliedPattern === 'b');
        expect(resolveMatchingRows(computation, rt)).toEqual(new Map([[2, [1]]]));

        // A search of the columns
        rt.dispatch(target, { kind: 'setResultSearchPattern', value: { search: 'columns', pattern: 'nam' } });
        computation = await settled(rt, view => !view.columnSearch.pending && view.columnSearch.appliedPattern === 'nam');
        expect(computation.columnSearch.matchingColumnGroups).toEqual([2]);

        // Deleting the computation drops its data frames and releases its tables
        expect((await dataFrameTables()).length).toBeGreaterThan(0);
        rt.dispatch({ computation: 1 }, { kind: 'deleteComputation' });
        rt.flush();
        expect(rt.store.get('computation', 1)).toBeNull();
        expect(rt.handles.size).toBe(0);
        await vi.waitFor(async () => expect(await dataFrameTables()).toEqual([]));
    }, 60_000);

    it('lists the queries of the tasks in the history of the connection and in a history without one', async () => {
        database = await openTestHyperDB('runtime_computations_history_test');
        runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, core: dql, computeDatabase: async () => database! });
        const table = () => new arrow.Table({
            score: vectorFromArray([42, 10, 10, 30], new arrow.Float64()),
            name: vectorFromArray(['a', 'b', 'a', 'c'], new arrow.Utf8()),
        });
        const sqlframe = (queryIds: readonly number[]) => queryIds
            .map(queryId => runtime!.store.get('query', queryId))
            .filter(query => query?.queryMetadata.issuer === 'SQLFrame');

        // The tasks of a result of a connection run their SELECTs in its history
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: false }));
        await runtime.analyzeTable(1, table(), { connectionId: connection.connectionId });
        runtime.flush();
        const view = runtime.store.get('connection', connection.connectionId)!;
        expect(view.queriesActiveOrdered).toEqual([]);
        const ofConnection = sqlframe(view.queriesFinishedOrdered);
        expect(ofConnection.length).toBeGreaterThan(0);
        expect(ofConnection.every(query => query?.status === QueryExecutionStatus.SUCCEEDED)).toBe(true);
        expect(ofConnection.every(query => query?.queryMetadata.queryType === QueryType.INTERNAL_SQLFRAME && query.queryMetadata.title != null)).toBe(true);

        // A result of the shell names its history
        expect(runtime.dispatch({ history: 'shell-test' }, { kind: 'createHistory', value: {} }).ok).toBe(true);
        await runtime.analyzeTable(2, table(), { history: 'shell-test' });
        runtime.flush();
        const ofHistory = sqlframe(runtime.store.get('history', 'shell-test')?.queries ?? []);
        expect(ofHistory.length).toBe(ofConnection.length);
        expect(ofHistory.every(query => query?.status === QueryExecutionStatus.SUCCEEDED)).toBe(true);
    }, 60_000);

    it('aborts the running query of a task when its connection is reset', async () => {
        database = await openTestHyperDB('runtime_computations_reset_test');
        const real = database;
        // The first SELECT of a task hangs until its call is aborted
        let aborted: unknown = null;
        let hanging: (() => void) | null = null;
        const hangs = new Promise<void>(resolve => { hanging = resolve; });
        const computeDatabase = {
            ...real,
            connect: async (options?: Parameters<HyperDB['connect']>[0]) => {
                const conn = await real.connect(options);
                return Object.assign(Object.create(Object.getPrototypeOf(conn)), conn, {
                    createTableAs: (name: string, sql: string, signal?: AbortSignal) => {
                        if (aborted != null || signal == null) return conn.createTableAs(name, sql, signal);
                        hanging?.();
                        return new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
                            aborted = signal.reason;
                            reject(signal.reason);
                        }, { once: true }));
                    },
                });
            },
        } as unknown as HyperDB;
        runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, core: dql, computeDatabase: async () => computeDatabase });
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: false }));
        const table = new arrow.Table({
            score: vectorFromArray([42, 10, 10, 30], new arrow.Float64()),
            name: vectorFromArray(['a', 'b', 'a', 'c'], new arrow.Utf8()),
        });
        const analysis = runtime.analyzeTable(1, table, { connectionId: connection.connectionId }).then(() => null, error => error);
        await hangs;

        // The SELECT of the task runs in the history of the connection
        runtime.flush();
        const [queryId] = runtime.store.get('connection', connection.connectionId)!.queriesActiveOrdered;
        expect(runtime.store.get('query', queryId)).toMatchObject({ status: QueryExecutionStatus.RUNNING, queryMetadata: { issuer: 'SQLFrame' } });
        const warn = vi.spyOn(runtime.logger, 'warn');

        // A reset stops the queries of the connection: the call of the task is aborted, the query leaves the history of
        // the connection with the other queries of the connection, the analysis fails
        runtime.dispatch({ connection: connection.connectionId }, { kind: 'resetConnection' });
        await vi.waitFor(() => expect(aborted).not.toBeNull());
        expect(String((aborted as Error).message ?? aborted)).toMatch(/cancelled/i);
        expect(await analysis).not.toBeNull();
        runtime.flush();
        const view = runtime.store.get('connection', connection.connectionId)!;
        expect(view.queriesActiveOrdered).toEqual([]);
        expect(view.queriesFinishedOrdered).toEqual([]);
        expect(runtime.store.get('query', queryId)).toBeNull();
        expect(warn).not.toHaveBeenCalledWith('Failed to close a query of a computation', expect.anything(), expect.anything());
    }, 60_000);

    it('cancels the run of a task whose query is stopped', async () => {
        database = await openTestHyperDB('runtime_computations_stop_test');
        const real = database;
        // The first SELECT of a task hangs until its call is aborted
        let hanging: (() => void) | null = null;
        const hangs = new Promise<void>(resolve => { hanging = resolve; });
        let hung = false;
        const computeDatabase = {
            ...real,
            connect: async (options?: Parameters<HyperDB['connect']>[0]) => {
                const conn = await real.connect(options);
                return Object.assign(Object.create(Object.getPrototypeOf(conn)), conn, {
                    createTableAs: (name: string, sql: string, signal?: AbortSignal) => {
                        if (hung || signal == null) return conn.createTableAs(name, sql, signal);
                        hung = true;
                        hanging?.();
                        // The call ends only after the runtime stopped waiting for it
                        return new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
                            setTimeout(() => reject(new Error('the call ended late')), 10);
                        }, { once: true }));
                    },
                });
            },
        } as unknown as HyperDB;
        runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, core: dql, computeDatabase: async () => computeDatabase });
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: false }));
        const table = new arrow.Table({ score: vectorFromArray([42, 10], new arrow.Float64()) });
        const analysis = runtime.analyzeTable(1, table, { connectionId: connection.connectionId }).then(() => null, error => error);
        await hangs;
        runtime.flush();
        const [queryId] = runtime.store.get('connection', connection.connectionId)!.queriesActiveOrdered;

        // The stop cancels the run of the task in the runtime: the query ends cancelled right away, not with the error
        // of the call
        await runtime.cancel(queryId);
        await vi.waitFor(() => {
            runtime!.flush();
            expect(runtime!.store.get('query', queryId)?.status).toBe(QueryExecutionStatus.CANCELLED);
        });
        expect(runtime.store.get('query', queryId)).toMatchObject({ error: { message: 'The request was cancelled' } });
        expect(await analysis).not.toBeNull();
    }, 60_000);

    it('analyzes nothing without columns and dispatches nothing once destroyed', async () => {
        runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, core: dql });
        await runtime.analyzeTable(1, new arrow.Table());
        expect(runtime.store.get('computation', 1)).toBeNull();
        await runtime.destroy();
        expect(runtime.dispatch({ computation: 1 }, { kind: 'deleteComputation' })).toMatchObject({ ok: false });
    });
});
