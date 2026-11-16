import * as arrow from 'apache-arrow';
import * as core from '@ankoh/dashql-core';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

import { createRuntime, type Runtime } from './runtime.js';
import { ORDINAL_COLUMN, ROWNUMBER_COLUMN, STRING_COLUMN, TaskStatus, resolveMatchingRows, resolveSummaries } from './compute/computation_types.js';
import { openTestHyperDB } from './testing/test_hyperdb.js';
import type { HyperDB } from './platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from './testing/test_logger.js';
import { vectorFromArray } from './testing/arrow_fixtures.js';
import { TASK_UPDATE_SCHEDULER } from './store/store.js';

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
        runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, setupCore: dql, computeDatabase: database });
        const table = new arrow.Table({
            score: vectorFromArray([42, 10, 10, 30], new arrow.Float64()),
            name: vectorFromArray(['a', 'b', 'a', 'c'], new arrow.Utf8()),
        });
        await runtime.analyzeTable(1, table, { connectionId: 'main' });
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

    it('dispatches nothing without a core and analyzes nothing without columns', async () => {
        runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER });
        expect(runtime.dispatch({ computation: 1 }, { kind: 'deleteComputation' })).toMatchObject({ ok: false });
        await runtime.analyzeTable(1, new arrow.Table());
        expect(runtime.store.get('computation', 1)).toBeNull();
    });
});
