import * as arrow from 'apache-arrow';
import * as core from '@ankoh/dashql-core';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

import { analyzeTable } from './analyze_table.js';
import { createComputations, type Computations } from './computations.js';
import { scheduleTask } from './computation_tasks.js';
import { DATA_SEARCH_TASK, ORDINAL_COLUMN, ROWNUMBER_COLUMN, STRING_COLUMN, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK, TaskStatus } from './computation_types.js';
import { DELETE_COMPUTATION, SET_RESULT_SEARCH_PATTERN } from './computation_state.js';
import { openTestHyperDB } from '../testing/test_hyperdb.js';
import type { HyperDB } from '../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../testing/test_logger.js';
import { vectorFromArray } from '../testing/arrow_fixtures.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

// The tasks of the computations run in the runtime of the core on the embedded Hyper: the analysis of a result, then
// the tasks that the views schedule.

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

describe('Computations in the core', () => {
    let database: HyperDB | null = null;
    let computations: Computations | null = null;

    afterEach(async () => {
        computations?.destroy();
        computations = null;
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

    async function analyzed() {
        database = await openTestHyperDB('computations_test');
        const logger = new TestLogger();
        computations = createComputations(logger, dql);
        const table = new arrow.Table({
            score: vectorFromArray([42, 10, 10, 30], new arrow.Float64()),
            name: vectorFromArray(['a', 'b', 'a', 'c'], new arrow.Utf8()),
        });
        await analyzeTable(1, table, computations.dispatch, database, logger, 'main');
        return computations;
    }

    it('analyze a result', async () => {
        const { store } = await analyzed();
        const computation = store.current.tableComputations[1];
        expect(computation.connectionId).toBe('main');
        expect(computation.dataTable.numRows).toBe(4);
        expect(computation.dataTable.schema.fields.map(field => field.name)).toEqual(expect.arrayContaining(['score', 'name', '_rownum']));
        expect([...computation.dataTableFieldsByName.keys()]).toEqual(['score', 'name']);
        expect(computation.columnGroups.map(group => group.type)).toEqual([ROWNUMBER_COLUMN, ORDINAL_COLUMN, STRING_COLUMN]);
        expect(computation.rowNumberColumnName).toBe('_rownum');
        expect(computation.dataFrame?.tableName).toMatch(/^__df_\d+$/);
        expect(computation.tableAggregation?.table.numRows).toBe(1);

        const score = computation.columnAggregates[1];
        expect(score?.type).toBe(ORDINAL_COLUMN);
        if (score?.type !== ORDINAL_COLUMN) return;
        expect(score.value.columnAnalysis).toMatchObject({ totalCount: 4, countNull: 0, countNotNull: 4 });
        // The values are formatted like the cells of the grid
        expect(score.value.columnAnalysis.minValue).toMatch(/^10/);
        expect(score.value.columnAnalysis.maxValue).toMatch(/^42/);
        expect(score.value.columnAnalysis.binLowerBounds[0]).toMatch(/^10/);
        expect(score.value.columnAnalysis.binValueCounts.reduce((sum, count) => sum + count, 0n)).toBe(4n);

        const name = computation.columnAggregates[2];
        expect(name?.type).toBe(STRING_COLUMN);
        if (name?.type !== STRING_COLUMN) return;
        expect(name.value.analysis).toMatchObject({ totalCount: 4, countDistinct: 3, isUnique: false });
        expect(name.value.analysis.frequentValueStrings[0]).toBe('a');
        expect(Array.from(name.value.analysis.frequentValueCounts)).toEqual([2n, 1n, 1n]);

        expect(computation.tasks.columnAggregationTasks[1]?.progress.status).toBe(TaskStatus.TASK_SUCCEEDED);
        expect(computation.tasks.systemColumnTask?.progress.status).toBe(TaskStatus.TASK_SUCCEEDED);
        // The tasks of the analysis ran in the core, the scheduler of the host has none
        expect(store.current.schedulerTasks).toEqual({});
    }, 60_000);

    it('filter, order and search an analyzed result', async () => {
        const { store, dispatch } = await analyzed();
        let computation = store.current.tableComputations[1];
        const score = computation.columnGroups[1];
        if (score.type !== ORDINAL_COLUMN) throw new Error('an ordinal column');

        const filter = await scheduleTask(TABLE_FILTERING_TASK, {
            tableId: 1,
            tableVersion: computation.version,
            inputDataTable: computation.dataTable,
            inputDataTableFieldIndex: computation.dataTableFieldsByName,
            inputDataFrame: computation.dataFrame!,
            rowNumberColumnName: computation.rowNumberColumnName!,
            filters: [{ fieldName: score.value.binFieldName!, op: '>=', value: 1 }],
        }, dispatch);
        computation = store.current.tableComputations[1];
        expect(filter).toBe(computation.filterTable);
        expect(computation.filterTable?.dataTable.numRows).toBe(2);
        expect(computation.tasks.filteringTask?.progress.status).toBe(TaskStatus.TASK_SUCCEEDED);

        const ordering = await scheduleTask(TABLE_ORDERING_TASK, {
            tableId: 1,
            tableVersion: computation.version,
            inputDataTable: computation.dataTable,
            inputDataTableFieldIndex: computation.dataTableFieldsByName,
            inputDataFrame: computation.dataFrame!,
            filterTable: computation.filterTable,
            dataSearchTable: null,
            rowNumberColumnName: computation.rowNumberColumnName!,
            orderingConstraints: [{ field: 'score', ascending: false }],
        }, dispatch);
        computation = store.current.tableComputations[1];
        expect(ordering).toBe(computation.orderingTable);
        expect(computation.orderingTable?.dataTable.toArray().map(row => row._rownum)).toEqual([1n, 4n]);

        dispatch({ type: SET_RESULT_SEARCH_PATTERN, value: [1, 'data', 'b'] });
        computation = store.current.tableComputations[1];
        await scheduleTask(DATA_SEARCH_TASK, {
            tableId: 1,
            tableVersion: computation.version,
            inputDataFrame: computation.dataFrame!,
            rowNumberColumnName: computation.rowNumberColumnName!,
            columns: [{ columnIdx: 1, columnGroupIdx: 2, fieldName: 'name' }],
            pattern: 'b',
            requestId: computation.dataSearch.requestId,
            abortController: new AbortController(),
        }, dispatch);
        computation = store.current.tableComputations[1];
        expect(computation.dataSearch).toMatchObject({ appliedPattern: 'b', pending: false });
        expect(computation.dataSearch.matchingRows).toEqual(new Map([[2, [1]]]));

        // Deleting the computation drops its data frames
        expect((await dataFrameTables()).length).toBeGreaterThan(0);
        dispatch({ type: DELETE_COMPUTATION, value: [1] });
        await vi.waitFor(async () => expect(await dataFrameTables()).toEqual([]));
    }, 60_000);
});
