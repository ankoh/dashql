import * as arrow from 'apache-arrow';
import * as core from '@ankoh/dashql-core';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

import { ArrowTableFormatter } from './arrow_formatter.js';
import { DataFrame, DataFrameRegistry } from './data_frame.js';
import { AsyncValue } from '../utils/async_value.js';
import { CLEAR_TABLE_ORDERING, COLUMN_AGGREGATION_SUCCEEDED, COLUMN_SEARCH_SUCCEEDED, COMPUTATION_FROM_QUERY_RESULT, CREATED_DATA_FRAME, DATA_SEARCH_FAILED, DATA_SEARCH_SUCCEEDED, RESULT_SEARCH_FAILED, FILTERED_COLUMN_AGGREGATION_SUCCEEDED, SET_CROSS_FILTERS, SET_RESULT_SEARCH_PATTERN, SYSTEM_COLUMN_COMPUTATION_SUCCEEDED, TABLE_FILTERING_SUCCEEDED, TABLE_ORDERING_SUCCEDED, ComputationAction, ComputationState, createComputationState, DELETE_COMPUTATION, reduceComputationState, SCHEDULE_TASK, UNREGISTER_SCHEDULER_TASK, UPDATE_SCHEDULER_TASK } from './computation_state.js';
import { BinnedValuesTable, ColumnAggregationVariant, ColumnGroup, ComputationStateVersion, FilterTable, LIST_COLUMN, OrderingTable, ORDINAL_COLUMN, OrdinalColumnAnalysis, OrdinalGridColumnGroup, ROWNUMBER_COLUMN, STRING_COLUMN, TableAggregation, TaskStatus, TaskVariant, WithFilterEpoch } from './computation_types.js';
import { LoggableException } from '../platform/logger/logger.js';
import { COLUMN_AGGREGATION_TASK, DATA_SEARCH_TASK, FILTERED_COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK } from './computation_types.js';
import { TestLogger } from '../testing/test_logger.js';
import { mockDataFrame } from '../testing/mocks/compute_query.js';
import { CrossFilters } from './cross_filters.js';
import { tableFromArrays } from '../testing/arrow_fixtures.js';
import type { OrderByConstraint } from './computation_types.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

// The state lives in the Rust core (computation_native.ts). The tests build their states with actions: a state of the
// TypeScript reducer could be set up with fields that no action produces. The state owns the data frames it holds, the
// registry counts its hold once and the holds of the host on top.

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => { vi.restoreAllMocks(); dql.resetUnsafe(); });

function createOrdinalAggregate(
    columnEntry: OrdinalGridColumnGroup,
    dataFrame: DataFrame,
    aggregateTable: BinnedValuesTable<any, any>,
    formatter: ArrowTableFormatter,
    analysis: OrdinalColumnAnalysis,
): ColumnAggregationVariant {
    return {
        type: ORDINAL_COLUMN,
        value: {
            columnEntry,
            binnedDataFrame: dataFrame,
            binnedValues: aggregateTable,
            binnedValuesFormatter: formatter,
            columnAnalysis: analysis,
        },
    };
}

function createFilteredOrdinalAggregate(
    columnEntry: OrdinalGridColumnGroup,
    dataFrame: DataFrame,
    aggregateTable: BinnedValuesTable<any, any>,
    formatter: ArrowTableFormatter,
    analysis: OrdinalColumnAnalysis,
    filterVersion: ComputationStateVersion,
): WithFilterEpoch<ColumnAggregationVariant> {
    return {
        ...createOrdinalAggregate(columnEntry, dataFrame, aggregateTable, formatter, analysis),
        filterVersion,
        dataSearchRequestId: null,
    };
}

function getAggregationDataFrame(aggregation: ColumnAggregationVariant | null | undefined): DataFrame | null {
    if (aggregation == null) {
        return null;
    }
    switch (aggregation.type) {
        case ORDINAL_COLUMN:
            return aggregation.value.binnedDataFrame;
        case STRING_COLUMN:
            return aggregation.value.frequentValuesDataFrame;
        case LIST_COLUMN:
            return aggregation.value.frequentValuesDataFrame;
        default:
            return null;
    }
}

/// Dropping the tasks of the scheduler and the computations releases every data frame that the state holds
function releaseAllRegisteredDataFramesFromLatestState(state: ComputationState, memory: DataFrameRegistry) {
    expect(Object.entries(state.tableComputations).length).toBeGreaterThan(0);
    expect(memory.getRegisteredDataFrames().size).toBeGreaterThan(0);
    for (const task of Object.values(state.schedulerTasks)) {
        state = reduceComputationState(state, { type: UNREGISTER_SCHEDULER_TASK, value: task }, memory);
    }
    for (const tableId of Object.keys(state.tableComputations)) {
        state = reduceComputationState(state, { type: DELETE_COMPUTATION, value: [Number(tableId)] }, memory);
    }
    expect(Object.entries(state.tableComputations).length).toEqual(0);
    expect(memory.getRegisteredDataFrames().size).toEqual(0);
}

describe('ComputationState', () => {
    const logger = new TestLogger();

    const inputTable = tableFromArrays({
        rowNumber: new Int32Array([0, 1, 2, 3]),
        score: new Float64Array([42, 10, 10, 30]),
    });
    const inputTableFieldIndex = new Map([
        ['rowNumber', 0],
        ['score', 1],
    ]);
    const inputTableColumns: ColumnGroup[] = [
        {
            type: ROWNUMBER_COLUMN,
            value: { rowNumberFieldName: 'rowNumber' },
        },
        {
            type: ORDINAL_COLUMN,
            value: {
                inputFieldName: 'score',
                inputFieldType: new arrow.Float64(),
                inputFieldNullable: true,
                statsFields: {
                    countFieldName: '_1_count',
                    distinctCountFieldName: null,
                    minAggregateFieldName: '_1_min',
                    maxAggregateFieldName: '_1_max',
                },
                binFieldName: null,
                binCount: 10,
            },
        },
    ];

    const aggregateTable = tableFromArrays({
        "_count_star": new BigUint64Array([BigInt(4)]),
        "_1_count": new BigUint64Array([BigInt(4)]),
        "_1_min": new Float64Array([10]),
        "_1_max": new Float64Array([42]),
    });
    const aggregateTableFieldIndex = new Map([
        ["_1_count", 0],
        ["_1_min", 1],
        ["_1_max", 2],
    ]);
    const aggregateTableFormatter = new ArrowTableFormatter(aggregateTable.schema, aggregateTable.batches, logger);

    const scoreAggregateTable: BinnedValuesTable<arrow.Float64, arrow.Float64> = tableFromArrays({
        "bin": new Int32Array([0, 1, 2, 3]),
        "binWidth": new Float64Array([2, 0, 1, 1]),
        "binLowerBound": new Float64Array([10, 10, 10, 10]),
        "binUpperBound": new Float64Array([10, 20, 30, 40]),
        "count": new BigInt64Array([BigInt(20), BigInt(30), BigInt(40), BigInt(50)]),
    });
    const scoreAggregateTableFormatter = new ArrowTableFormatter(scoreAggregateTable.schema, scoreAggregateTable.batches, logger);

    const filterTable = tableFromArrays({
        "rowNumber": new Int32Array([0, 1]),
    });
    const ordinalColumnAnalysis: OrdinalColumnAnalysis = {
        totalCount: 4,
        countNotNull: 4,
        countNull: 0,
        minValue: '10',
        maxValue: '42',
        binCount: 4,
        binValueCounts: new BigInt64Array([BigInt(2), BigInt(0), BigInt(1), BigInt(1)]),
        binPercentages: new Float64Array([0.5, 0, 0.25, 0.25]),
        binLowerBounds: ['10', '20', '30', '40'],
    };
    const scoreColumn = inputTableColumns[1].value as OrdinalGridColumnGroup;
    const scoreDescending: OrderByConstraint[] = [{ field: 'score', ascending: false, nullsFirst: false }];

    const tableAggregation = (dataFrame: DataFrame, countStarFieldName = '_count_star'): TableAggregation => ({
        dataFrame,
        table: aggregateTable,
        tableFieldsByName: aggregateTableFieldIndex,
        tableFormatter: aggregateTableFormatter,
        countStarFieldName,
    });
    const scoreAggregate = (dataFrame: DataFrame) =>
        createOrdinalAggregate(scoreColumn, dataFrame, scoreAggregateTable, scoreAggregateTableFormatter, ordinalColumnAnalysis);

    /// A computation state with table 1 of the input table, materialized as the data frame. Its version is 1.0.
    function stateWithTable(memory: DataFrameRegistry, dataFrame: DataFrame, lifetime = new AbortController()): ComputationState {
        let state = createComputationState(dql);
        state = reduceComputationState(state, { type: COMPUTATION_FROM_QUERY_RESULT, value: [1, inputTable, inputTableColumns, lifetime] }, memory);
        state = reduceComputationState(state, { type: CREATED_DATA_FRAME, value: [1, dataFrame] }, memory);
        return state;
    }

    /// Schedule a task, returns the state and the task as the scheduler holds it
    function schedule(state: ComputationState, task: Omit<TaskVariant, 'result'>, memory: DataFrameRegistry): [ComputationState, TaskVariant] {
        const next = reduceComputationState(state, { type: SCHEDULE_TASK, value: { ...task, result: new AsyncValue() } as TaskVariant }, memory);
        const taskId = state.nextSchedulerTaskId;
        expect(next.schedulerTasks[taskId]).toBeDefined();
        return [next, next.schedulerTasks[taskId]];
    }

    /// Schedule a filtering of table 1, it moves the filter version
    function scheduleFiltering(state: ComputationState, inputDataFrame: DataFrame, memory: DataFrameRegistry): [ComputationState, TaskVariant] {
        return schedule(state, {
            type: TABLE_FILTERING_TASK,
            value: {
                tableId: 1,
                tableVersion: state.tableComputations[1].version,
                inputDataTable: inputTable,
                inputDataTableFieldIndex: inputTableFieldIndex,
                inputDataFrame,
                rowNumberColumnName: 'rowNumber',
                filters: [{ fieldName: 'score', op: "<", value: 20 }],
            },
        }, memory);
    }

    /// Schedule an ordering of table 1 by the score
    function scheduleOrdering(state: ComputationState, inputDataFrame: DataFrame, memory: DataFrameRegistry, orderingConstraints = scoreDescending): [ComputationState, TaskVariant] {
        return schedule(state, {
            type: TABLE_ORDERING_TASK,
            value: {
                tableId: 1,
                tableVersion: state.tableComputations[1].version,
                inputDataTable: inputTable,
                inputDataTableFieldIndex: inputTableFieldIndex,
                inputDataFrame,
                filterTable: null,
                dataSearchTable: null,
                rowNumberColumnName: 'rowNumber',
                orderingConstraints,
            },
        }, memory);
    }

    /// The ordering of table 1 as a task computes it
    function orderingResult(dataFrame: DataFrame, version: ComputationStateVersion, orderingConstraints: OrderByConstraint[] = scoreDescending): OrderingTable {
        return {
            inputRowNumberColumnName: 'rowNumber',
            orderingConstraints,
            dataTable: filterTable,
            dataFrame,
            version,
            dataSearchRequestId: null,
        };
    }

    /// The filter of table 1 as a task computes it
    function filterResult(dataFrame: DataFrame, version: ComputationStateVersion): FilterTable {
        return { inputRowNumberColumnName: 'rowNumber', dataTable: filterTable, dataFrame, version };
    }

    it('configure a computation state', () => {
        const memory = new DataFrameRegistry(logger);
        const state = createComputationState(dql);
        expect(Object.keys(state.tableComputations)).toEqual([]);
        expect(state.native).toBeDefined();
        expect(memory.getRegisteredDataFrames().size).toEqual(0);
        // Without a core the state can't be reduced
        expect(() => reduceComputationState(createComputationState(), { type: DELETE_COMPUTATION, value: [1] }, memory)).toThrow();
    });

    it('computation from query result', () => {
        const memory = new DataFrameRegistry(logger);
        const state = createComputationState(dql);
        const tableLifetime = new AbortController();
        const action: ComputationAction = {
            type: COMPUTATION_FROM_QUERY_RESULT,
            value: [1, inputTable, inputTableColumns, tableLifetime, 'connection'],
        };
        const output = reduceComputationState(state, action, memory);
        expect(Object.entries(output.tableComputations).length).toEqual(1);
        // The computation queries are tracked on the connection that ran the query of the table
        expect(output.tableComputations[1].connectionId).toBe('connection');
        expect(output.tableComputations[1].dataTable).toEqual(inputTable);
        expect(output.tableComputations[1].dataTableFieldsByName).toEqual(inputTableFieldIndex);
        expect(output.tableComputations[1].columnGroups).toEqual(inputTableColumns);
        expect(output.tableComputations[1].dataTableLifetime).toEqual(tableLifetime);
        expect(output.tableComputations[1].dataFrame).toBeNull();
    });

    it('keeps the objects of the computations that an action does not change', () => {
        const memory = new DataFrameRegistry(logger);
        let state = stateWithTable(memory, mockDataFrame('__test_input'));
        const table = state.tableComputations[1];
        state = reduceComputationState(state, { type: COMPUTATION_FROM_QUERY_RESULT, value: [2, inputTable, inputTableColumns, new AbortController()] }, memory);
        expect(state.tableComputations[1]).toBe(table);

        // A change of the computation keeps the parts that are the same
        state = reduceComputationState(state, { type: SET_RESULT_SEARCH_PATTERN, value: [1, 'columns', 'sc'] }, memory);
        const changed = state.tableComputations[1];
        expect(changed).not.toBe(table);
        expect(changed.columnSearch).not.toBe(table.columnSearch);
        expect(changed.dataSearch).toBe(table.dataSearch);
        expect(changed.version).toBe(table.version);
        expect(changed.tasks).toBe(table.tasks);
        expect(changed.columnAggregates).toBe(table.columnAggregates);
        expect(changed.columnGroups).toBe(table.columnGroups);
        expect(changed.crossFilters).toBe(table.crossFilters);
    });

    it('keeps column matches visible while a replacement search is pending', () => {
        const memory = new DataFrameRegistry(logger);
        const dataFrame = mockDataFrame('__test_input');
        let state = stateWithTable(memory, dataFrame);

        state = reduceComputationState(state, {
            type: SET_RESULT_SEARCH_PATTERN,
            value: [1, 'columns', 'score'],
        }, memory);
        state = reduceComputationState(state, {
            type: COLUMN_SEARCH_SUCCEEDED,
            value: [1, dataFrame, 1, [1]],
        }, memory);
        state = reduceComputationState(state, {
            type: SET_RESULT_SEARCH_PATTERN,
            value: [1, 'columns', 'sc'],
        }, memory);

        expect(state.tableComputations[1].columnSearch.pending).toBe(true);
        expect(state.tableComputations[1].columnSearch.requestedPattern).toBe('sc');
        expect(state.tableComputations[1].columnSearch.appliedPattern).toBe('score');
        expect(state.tableComputations[1].columnSearch.matchingColumnGroups).toEqual([1]);
    });

    it('accepts the latest materialized Data search without changing the filter version', () => {
        const memory = new DataFrameRegistry(logger);
        const dataFrame = mockDataFrame('__test_input');
        const searchFrame = mockDataFrame('__test_search');
        let state = stateWithTable(memory, dataFrame);
        [state] = scheduleFiltering(state, dataFrame, memory);
        const version = state.tableComputations[1].version;
        expect(version).toEqual(new ComputationStateVersion(1, 1));
        state = reduceComputationState(state, {
            type: SET_RESULT_SEARCH_PATTERN,
            value: [1, 'data', '10'],
        }, memory);

        state = reduceComputationState(state, {
            type: DATA_SEARCH_SUCCEEDED,
            value: [1, dataFrame, 1, {
                inputRowNumberColumnName: 'rowNumber',
                dataTable: tableFromArrays({ row_idx: new Int32Array([2, 3]), column_indices: [[1], [1]] }),
                dataFrame: searchFrame,
                version,
                requestId: 1,
            }],
        }, memory);

        expect(state.tableComputations[1].version).toEqual(new ComputationStateVersion(1, 1));
        expect(state.tableComputations[1].dataSearch.matchingRows).toEqual(new Map([[2, [1]], [3, [1]]]));
        expect(state.tableComputations[1].dataSearchTable?.dataFrame).toBe(searchFrame);
        expect(memory.getRegisteredDataFrames().get(searchFrame)).toBe(1);
    });

    it('drops the Data search of the latest request when it fails', () => {
        const memory = new DataFrameRegistry(logger);
        const dataFrame = mockDataFrame('__test_input');
        const searchFrame = mockDataFrame('__test_search');
        let state = stateWithTable(memory, dataFrame);
        state = reduceComputationState(state, { type: SET_RESULT_SEARCH_PATTERN, value: [1, 'data', '10'] }, memory);
        state = reduceComputationState(state, {
            type: DATA_SEARCH_SUCCEEDED,
            value: [1, dataFrame, 1, {
                inputRowNumberColumnName: 'rowNumber',
                dataTable: tableFromArrays({ row_idx: new Int32Array([2]), column_indices: [[1]] }),
                dataFrame: searchFrame,
                version: state.tableComputations[1].version,
                requestId: 1,
            }],
        }, memory);
        state = reduceComputationState(state, { type: SET_RESULT_SEARCH_PATTERN, value: [1, 'data', '42'] }, memory);
        expect(state.tableComputations[1].dataSearchTable?.dataFrame).toBe(searchFrame);
        const latestRequest = state.tableComputations[1].dataSearch.requestId;

        // Failures of older requests and of other data frames are ignored
        expect(reduceComputationState(state, { type: DATA_SEARCH_FAILED, value: [1, dataFrame, 1, 'stale'] }, memory)).toBe(state);
        expect(reduceComputationState(state, { type: DATA_SEARCH_FAILED, value: [1, searchFrame, latestRequest, 'other'] }, memory)).toBe(state);

        state = reduceComputationState(state, { type: DATA_SEARCH_FAILED, value: [1, dataFrame, latestRequest, 'boom'] }, memory);
        expect(state.tableComputations[1].dataSearch).toMatchObject({ error: 'boom', pending: false, matchingRows: null, appliedPattern: '' });
        expect(state.tableComputations[1].dataSearchTable).toBeNull();
        expect(memory.getRegisteredDataFrames().has(searchFrame)).toBe(false);
    });

    it('records the error of a failed column search', () => {
        const memory = new DataFrameRegistry(logger);
        const dataFrame = mockDataFrame('__test_input');
        let state = stateWithTable(memory, dataFrame);
        state = reduceComputationState(state, { type: SET_RESULT_SEARCH_PATTERN, value: [1, 'columns', 'sc'] }, memory);
        const requestId = state.tableComputations[1].columnSearch.requestId;

        expect(reduceComputationState(state, { type: RESULT_SEARCH_FAILED, value: [1, dataFrame, 'columns', requestId + 1, 'stale'] }, memory)).toBe(state);
        state = reduceComputationState(state, { type: RESULT_SEARCH_FAILED, value: [1, dataFrame, 'columns', requestId, 'bad pattern'] }, memory);
        expect(state.tableComputations[1].columnSearch).toMatchObject({ error: 'bad pattern', pending: false, matchingColumnGroups: null });
        expect(state.tableComputations[1].dataSearch.error).toBeNull();
    });

    it('keeps the state for equal cross filters', () => {
        const memory = new DataFrameRegistry(logger);
        const state = stateWithTable(memory, mockDataFrame('__test_input'));
        const set = (filters: CrossFilters, tableId = 1): ComputationAction => ({ type: SET_CROSS_FILTERS, value: [tableId, filters] });
        expect(reduceComputationState(state, set(new CrossFilters()), memory)).toBe(state);
        expect(reduceComputationState(state, set(new CrossFilters(), 7), memory)).toBe(state);

        const filters = new CrossFilters();
        filters.addMostFrequentValueFilter(1, { inputFieldName: 'score', inputFieldType: new arrow.Utf8(), inputFieldNullable: true, statsFields: null, valueIdFieldName: 'score_id' }, 3);
        const next = reduceComputationState(state, set(filters), memory);
        expect(next.tableComputations[1].crossFilters).toBe(filters);
        // The same selection keeps the state and its filters
        const same = new CrossFilters();
        same.addMostFrequentValueFilter(1, { inputFieldName: 'score', inputFieldType: new arrow.Utf8(), inputFieldNullable: true, statsFields: null, valueIdFieldName: 'score_id' }, 3);
        expect(reduceComputationState(next, set(same), memory)).toBe(next);
    });

    it('tracks the latest Data search task and ignores progress of older requests', () => {
        const memory = new DataFrameRegistry(logger);
        const dataFrame = mockDataFrame('__test_input');
        const searchTask = (requestId: number) => ({
            tableId: 1,
            tableVersion: new ComputationStateVersion(0, 0),
            inputDataFrame: dataFrame,
            rowNumberColumnName: 'rowNumber',
            columns: [],
            pattern: 'a',
            requestId,
            abortController: new AbortController(),
        });
        let state = stateWithTable(memory, dataFrame);
        const first = searchTask(1);
        let firstTask: TaskVariant;
        [state, firstTask] = schedule(state, { type: DATA_SEARCH_TASK, value: first }, memory);
        const second = searchTask(2);
        let secondTask: TaskVariant;
        [state, secondTask] = schedule(state, { type: DATA_SEARCH_TASK, value: second }, memory);
        expect(first.abortController.signal.aborted).toBe(true);
        expect(second.abortController.signal.aborted).toBe(false);
        expect(state.tableComputations[1].tasks.dataSearchTask?.requestId).toBe(2);

        // The progress of a task reaches the state with the task that the scheduler holds. The Rust state drops the
        // progress of a task that the scheduler doesn't know, the TypeScript reducer registered it as a new task.
        const update = (task: TaskVariant): ComputationAction => ({
            type: UPDATE_SCHEDULER_TASK,
            value: [task, { status: TaskStatus.TASK_SUCCEEDED }],
        });
        state = reduceComputationState(state, update(firstTask), memory);
        expect(state.tableComputations[1].tasks.dataSearchTask?.progress.status).toBe(TaskStatus.TASK_RUNNING);
        state = reduceComputationState(state, update(secondTask), memory);
        expect(state.tableComputations[1].tasks.dataSearchTask?.progress.status).toBe(TaskStatus.TASK_SUCCEEDED);
    });

    it('delete computation', () => {
        const memory = new DataFrameRegistry(logger);
        let state = createComputationState(dql);
        const tableLifetime = new AbortController();
        state = reduceComputationState(state, { type: COMPUTATION_FROM_QUERY_RESULT, value: [1, inputTable, inputTableColumns, tableLifetime] }, memory);
        const action: ComputationAction = {
            type: DELETE_COMPUTATION,
            value: [1],
        };
        const output = reduceComputationState(state, action, memory);
        expect(Object.entries(output.tableComputations).length).toEqual(0);
        expect(tableLifetime.signal.aborted).toBe(true);
    });

    it('releases the previous computation when replacing the same table id', () => {
        const memory = new DataFrameRegistry(logger);
        let state = createComputationState(dql);
        const previousFrame = mockDataFrame('__previous');
        const destroy = vi.spyOn(previousFrame, 'destroy').mockResolvedValue();
        const previousLifetime = new AbortController();

        state = reduceComputationState(state, {
            type: COMPUTATION_FROM_QUERY_RESULT,
            value: [1, inputTable, inputTableColumns, previousLifetime],
        }, memory);
        state = reduceComputationState(state, {
            type: CREATED_DATA_FRAME,
            value: [1, previousFrame],
        }, memory);

        state = reduceComputationState(state, {
            type: COMPUTATION_FROM_QUERY_RESULT,
            value: [1, inputTable, inputTableColumns, new AbortController()],
        }, memory);

        expect(state.tableComputations[1].dataFrame).toBeNull();
        expect(previousLifetime.signal.aborted).toBe(true);
        expect(state.tableComputations[1].dataTableLifetime.signal.aborted).toBe(false);
        expect(memory.getRegisteredDataFrames().has(previousFrame)).toBe(false);
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('keeps a data frame that the host reads after the state released it', () => {
        const memory = new DataFrameRegistry(logger);
        const inputDataFrame = mockDataFrame('__test_input');
        const destroy = vi.spyOn(inputDataFrame, 'destroy').mockResolvedValue();
        let state = stateWithTable(memory, inputDataFrame);

        // A search of the columns reads the data frame of the table outside of the state
        memory.acquire(state.tableComputations[1].dataFrame);
        // The system columns replace the data frame of the table
        state = reduceComputationState(state, {
            type: SYSTEM_COLUMN_COMPUTATION_SUCCEEDED,
            value: [1, inputTable, mockDataFrame('__test_system_columns'), inputTableColumns],
        }, memory);
        expect(state.tableComputations[1].dataFrame).not.toBe(inputDataFrame);
        expect(state.tableComputations[1].version).toEqual(new ComputationStateVersion(2, 0));
        expect(destroy).not.toHaveBeenCalled();
        expect(memory.getRegisteredDataFrames().get(inputDataFrame)).toBe(1);

        // The search ends
        memory.release(inputDataFrame);
        expect(destroy).toHaveBeenCalledOnce();
        expect(memory.getRegisteredDataFrames().has(inputDataFrame)).toBe(false);
    });

    describe('task scheduling', () => {
        it('filtering task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");

            let state = stateWithTable(memory, inputDataFrame);
            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: TABLE_FILTERING_TASK,
                    value: {
                        tableId: 1,
                        tableVersion: new ComputationStateVersion(0, 20),
                        inputDataTable: inputTable,
                        inputDataTableFieldIndex: inputTableFieldIndex,
                        inputDataFrame,
                        rowNumberColumnName: 'rowNumber',
                        filters: [
                            { fieldName: 'score', op: "<", value: 20 },
                        ],
                    },
                    result: new AsyncValue<FilterTable | null, LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[1].type).toEqual(TABLE_FILTERING_TASK);
            expect(state.schedulerTasks[1].taskId).toEqual(1);
            expect(state.nextSchedulerTaskId).toEqual(2);
            // Scheduling a filtering moves the filter version, the task computes the filter for it
            expect(state.tableComputations[1].version).toEqual(new ComputationStateVersion(1, 1));
            expect(state.schedulerTasks[1].value.tableVersion).toEqual(new ComputationStateVersion(1, 1));
            expect(state.tableComputations[1].tasks.filteringTask).toBeDefined();
            expect(state.tableComputations[1].tasks.filteringTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(memory.getRegisteredDataFrames().get(inputDataFrame)).toEqual(1);

            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[1], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory);
            expect(state.tableComputations[1].tasks.filteringTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[1],
            };
            state = reduceComputationState(state, deleteTask, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.filteringTask).not.toBeNull();
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('records the error of a failed task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            let state = stateWithTable(memory, inputDataFrame);
            let task: TaskVariant;
            [state, task] = scheduleFiltering(state, inputDataFrame, memory);
            const error = new LoggableException('boom');
            state = reduceComputationState(state, {
                type: UPDATE_SCHEDULER_TASK,
                value: [task, { status: TaskStatus.TASK_FAILED, failedAt: new Date(1234), failedWithError: error }],
            }, memory);
            expect(state.tableComputations[1].tasks.filteringTask?.progress).toMatchObject({
                status: TaskStatus.TASK_FAILED,
                failedAt: new Date(1234),
                failedWithError: error,
            });
        });

        it('ordering task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");

            let state = stateWithTable(memory, inputDataFrame);
            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: TABLE_ORDERING_TASK,
                    value: {
                        tableId: 1,
                        tableVersion: new ComputationStateVersion(0, 20),
                        inputDataTable: inputTable,
                        inputDataTableFieldIndex: inputTableFieldIndex,
                        inputDataFrame,
                        filterTable: null,
                        dataSearchTable: null,
                        rowNumberColumnName: 'rowNumber',
                        orderingConstraints: [
                            { field: 'score', ascending: false, nullsFirst: false },
                        ],
                    },
                    result: new AsyncValue<OrderingTable, LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[1].type).toEqual(TABLE_ORDERING_TASK);
            expect(state.schedulerTasks[1].taskId).toEqual(1);
            expect(state.nextSchedulerTaskId).toEqual(2);
            expect(state.tableComputations[1].tasks.orderingTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(memory.getRegisteredDataFrames().get(inputDataFrame)).toEqual(1);

            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[1], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory);
            expect(state.tableComputations[1].tasks.orderingTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[1],
            };
            state = reduceComputationState(state, deleteTask, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.orderingTask).not.toBeNull();
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('table aggregation task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");

            let state = stateWithTable(memory, inputDataFrame);
            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: TABLE_AGGREGATION_TASK,
                    value: {
                        tableId: 1,
                        tableVersion: new ComputationStateVersion(0, 20),
                        inputDataFrame,
                        columnEntries: inputTableColumns,
                    },
                    result: new AsyncValue<[TableAggregation, ColumnGroup[]], LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[1].type).toEqual(TABLE_AGGREGATION_TASK);
            expect(state.schedulerTasks[1].taskId).toEqual(1);
            expect(state.nextSchedulerTaskId).toEqual(2);
            expect(state.tableComputations[1].tasks.tableAggregationTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[1],
            };
            state = reduceComputationState(state, deleteTask, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.tableAggregationTask).not.toBeNull();
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('system column computation task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const aggregateDataFrame = mockDataFrame("__test_agg");

            let state = stateWithTable(memory, inputDataFrame);
            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: SYSTEM_COLUMN_COMPUTATION_TASK,
                    value: {
                        tableId: 1,
                        tableVersion: new ComputationStateVersion(0, 20),
                        inputDataFrame,
                        inputTable: inputTable,
                        columnEntries: inputTableColumns,
                        rowNumberFieldName: '_rownum',
                        tableAggregate: tableAggregation(aggregateDataFrame, '_1_count'),
                    },
                    result: new AsyncValue<[arrow.Table, DataFrame, ColumnGroup[]], LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[1].type).toEqual(SYSTEM_COLUMN_COMPUTATION_TASK);
            expect(state.schedulerTasks[1].taskId).toEqual(1);
            expect(state.nextSchedulerTaskId).toEqual(2);
            expect(state.tableComputations[1].tasks.systemColumnTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(memory.getRegisteredDataFrames().get(inputDataFrame)).toEqual(1);
            expect(memory.getRegisteredDataFrames().get(aggregateDataFrame)).toEqual(1);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[1],
            };
            state = reduceComputationState(state, deleteTask, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(state.tableComputations[1].tasks.systemColumnTask).not.toBeNull();
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        /// A computation of table 1 with a scheduled aggregation task of the score column
        function scheduleScoreAggregation(memory: DataFrameRegistry, inputDataFrame: DataFrame, aggregateDataFrame: DataFrame): ComputationState {
            const state = stateWithTable(memory, inputDataFrame);
            return reduceComputationState(state, {
                type: SCHEDULE_TASK,
                value: {
                    type: COLUMN_AGGREGATION_TASK,
                    value: {
                        tableId: 1,
                        tableVersion: new ComputationStateVersion(0, 20),
                        inputDataFrame,
                        columnId: 1,
                        columnEntry: inputTableColumns[1],
                        tableAggregate: tableAggregation(aggregateDataFrame),
                    },
                    result: new AsyncValue<ColumnAggregationVariant, LoggableException>(),
                },
            }, memory);
        }

        it('column aggregation task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const aggregateDataFrame = mockDataFrame("__test_agg");

            let state = scheduleScoreAggregation(memory, inputDataFrame, aggregateDataFrame);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[1].type).toEqual(COLUMN_AGGREGATION_TASK);
            expect(state.schedulerTasks[1].taskId).toEqual(1);
            expect(state.nextSchedulerTaskId).toEqual(2);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(memory.getRegisteredDataFrames().get(inputDataFrame)).toEqual(1);
            expect(memory.getRegisteredDataFrames().get(aggregateDataFrame)).toEqual(1);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[1],
            };
            state = reduceComputationState(state, deleteTask, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]).not.toBeNull();
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('stores succeeded column aggregates and releases the previous one', () => {
            const memory = new DataFrameRegistry(logger);
            const first = scoreAggregate(mockDataFrame("__test_first"));
            const second = scoreAggregate(mockDataFrame("__test_second"));
            const succeeded = (tableId: number, columnId: number, value: ColumnAggregationVariant): ComputationAction =>
                ({ type: COLUMN_AGGREGATION_SUCCEEDED, value: [tableId, columnId, value] });

            let state = scheduleScoreAggregation(memory, mockDataFrame("__test_input"), mockDataFrame("__test_agg"));
            state = reduceComputationState(state, succeeded(1, 1, first), memory);
            expect(state.tableComputations[1].columnAggregates[1]).toBe(first);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
            expect(memory.getRegisteredDataFrames().get(getAggregationDataFrame(first)!)).toEqual(1);

            state = reduceComputationState(state, succeeded(1, 1, second), memory);
            expect(state.tableComputations[1].columnAggregates[1]).toBe(second);
            expect(memory.getRegisteredDataFrames().has(getAggregationDataFrame(first)!)).toBe(false);

            // Aggregates of unknown tables and of columns without a task are released right away
            const unknown = scoreAggregate(mockDataFrame("__test_unknown"));
            const destroy = vi.spyOn(getAggregationDataFrame(unknown)!, 'destroy').mockResolvedValue();
            expect(reduceComputationState(state, succeeded(7, 1, unknown), memory)).toBe(state);
            expect(reduceComputationState(state, succeeded(1, 0, unknown), memory)).toBe(state);
            expect(memory.getRegisteredDataFrames().has(getAggregationDataFrame(unknown)!)).toBe(false);
            expect(destroy).toHaveBeenCalledTimes(2);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('filtered column aggregation task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const tableAggregateDataFrame = mockDataFrame("__test_tbl_agg");
            const scoreAggregateDataFrame = mockDataFrame("__test_col_agg");
            const filterDataFrame = mockDataFrame("__test_filter");

            let state = stateWithTable(memory, inputDataFrame);

            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: FILTERED_COLUMN_AGGREGATION_TASK,
                    value: {
                        tableId: 1,
                        tableVersion: new ComputationStateVersion(0, 20),
                        inputDataFrame,
                        columnId: 1,
                        columnEntry: inputTableColumns[1],
                        tableAggregate: tableAggregation(tableAggregateDataFrame),
                        filterTable: filterResult(filterDataFrame, new ComputationStateVersion(0, 10)),
                        dataSearchTable: null,
                        selectionRowCount: filterTable.numRows,
                        unfilteredAggregate: scoreAggregate(scoreAggregateDataFrame),
                    },
                    result: new AsyncValue<WithFilterEpoch<ColumnAggregationVariant> | null, LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[1].type).toEqual(FILTERED_COLUMN_AGGREGATION_TASK);
            expect(state.schedulerTasks[1].taskId).toEqual(1);
            expect(state.nextSchedulerTaskId).toEqual(2);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(4);
            for (const dataFrame of [inputDataFrame, filterDataFrame, tableAggregateDataFrame, scoreAggregateDataFrame]) {
                expect(memory.getRegisteredDataFrames().get(dataFrame)).toEqual(1);
            }

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[1],
            };
            state = reduceComputationState(state, deleteTask, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(4);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]).not.toBeNull();
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('marks filtered column summaries outdated without scheduling all columns on filter success', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const filterDataFrame = mockDataFrame("__test_filter");
            const scoreAggregateDataFrame = mockDataFrame("__test_col_agg");

            let state = scheduleScoreAggregation(memory, inputDataFrame, mockDataFrame("__test_agg"));
            state = reduceComputationState(state, { type: COLUMN_AGGREGATION_SUCCEEDED, value: [1, 1, scoreAggregate(scoreAggregateDataFrame)] }, memory);
            let filtering: TaskVariant;
            [state, filtering] = scheduleFiltering(state, inputDataFrame, memory);
            for (const task of Object.values(state.schedulerTasks)) {
                state = reduceComputationState(state, { type: UNREGISTER_SCHEDULER_TASK, value: task }, memory);
            }
            const version = filtering.value.tableVersion;
            expect(version).toEqual(new ComputationStateVersion(1, 1));

            const filterSucceeded: ComputationAction = {
                type: TABLE_FILTERING_SUCCEEDED,
                value: [1, version, filterResult(filterDataFrame, version)],
            };

            state = reduceComputationState(state, filterSucceeded, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(state.tableComputations[1].filterTable?.version.filter).toEqual(1);
            expect(state.tableComputations[1].version.filter).toEqual(1); // State version unchanged (already incremented when task was scheduled)
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[0]).toEqual(false);
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[1]).toEqual(true);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]).toBeNull();
        });

        it('ignores stale filter table success for an older table epoch', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const staleFilterDataFrame = mockDataFrame("__test_filter_stale");
            const destroy = vi.spyOn(staleFilterDataFrame, 'destroy').mockResolvedValue();

            let state = stateWithTable(memory, inputDataFrame);
            let stale: TaskVariant;
            [state, stale] = scheduleFiltering(state, inputDataFrame, memory);
            [state] = scheduleFiltering(state, inputDataFrame, memory);
            expect(state.tableComputations[1].version).toEqual(new ComputationStateVersion(1, 2));

            const staleFilterSucceeded: ComputationAction = {
                type: TABLE_FILTERING_SUCCEEDED,
                value: [1, stale.value.tableVersion, filterResult(staleFilterDataFrame, stale.value.tableVersion)],
            };

            const next = reduceComputationState(state, staleFilterSucceeded, memory);
            expect(next).toBe(state);
            expect(next.tableComputations[1].version.filter).toEqual(2);
            expect(next.tableComputations[1].filterTable).toBeNull();
            expect(memory.getRegisteredDataFrames().has(staleFilterDataFrame)).toBe(false);
            expect(destroy).toHaveBeenCalledOnce();
        });

        it('accepts filter table success for current table epoch', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const currentFilterDataFrame = mockDataFrame("__test_filter_current");
            const orderingDataFrame = mockDataFrame("__test_ordering_current");

            let state = stateWithTable(memory, inputDataFrame);
            [state] = scheduleOrdering(state, inputDataFrame, memory);
            state = reduceComputationState(state, { type: TABLE_ORDERING_SUCCEDED, value: [1, orderingResult(orderingDataFrame, state.tableComputations[1].version)] }, memory);
            expect(state.tableComputations[1].orderingTable?.dataFrame).toBe(orderingDataFrame);
            let filtering: TaskVariant;
            [state, filtering] = scheduleFiltering(state, inputDataFrame, memory);
            const version = filtering.value.tableVersion;

            const currentFilterSucceeded: ComputationAction = {
                type: TABLE_FILTERING_SUCCEEDED,
                value: [1, version, filterResult(currentFilterDataFrame, version)],
            };

            state = reduceComputationState(state, currentFilterSucceeded, memory);
            expect(state.tableComputations[1].version.filter).toEqual(1); // State unchanged (already incremented when task was scheduled)
            expect(state.tableComputations[1].filterTable?.version.filter).toEqual(1);
            expect(state.tableComputations[1].orderingTable).toBeNull(); // Ordering cleared because filter changed
            expect(memory.getRegisteredDataFrames().has(orderingDataFrame)).toBe(false);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('stores ordering table without replacing the immutable base table', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const orderingDataFrame = mockDataFrame("__test_ordering");

            let state = stateWithTable(memory, inputDataFrame);
            [state] = scheduleFiltering(state, inputDataFrame, memory);
            [state] = scheduleOrdering(state, inputDataFrame, memory);
            const version = state.tableComputations[1].version;

            const orderingSucceeded: ComputationAction = {
                type: TABLE_ORDERING_SUCCEDED,
                value: [1, orderingResult(orderingDataFrame, version)],
            };

            state = reduceComputationState(state, orderingSucceeded, memory);
            expect(state.tableComputations[1].version).toBe(version); // Ordering doesn't change filter version
            expect(state.tableComputations[1].dataFrame).toBe(inputDataFrame);
            expect(state.tableComputations[1].dataTable).toBe(inputTable);
            expect(state.tableComputations[1].orderingTable?.dataFrame).toBe(orderingDataFrame);
            expect(state.tableComputations[1].dataTableOrdering).toEqual([{ field: 'score', ascending: false, nullsFirst: false }]);
            expect(state.tableComputations[1].tasks.orderingTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('clears the active table ordering', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input_clear_ordering");
            const orderingDataFrame = mockDataFrame("__test_ordering_clear");
            const ordering: OrderByConstraint[] = [{ field: 'score', ascending: false }];

            let state = stateWithTable(memory, inputDataFrame);
            [state] = scheduleOrdering(state, inputDataFrame, memory, ordering);
            state = reduceComputationState(state, { type: TABLE_ORDERING_SUCCEDED, value: [1, orderingResult(orderingDataFrame, state.tableComputations[1].version, ordering)] }, memory);
            expect(state.tableComputations[1].dataTableOrdering).toEqual(ordering);
            expect(memory.getRegisteredDataFrames().has(orderingDataFrame)).toBe(true);

            state = reduceComputationState(state, { type: CLEAR_TABLE_ORDERING, value: 1 }, memory);

            expect(state.tableComputations[1].dataTableOrdering).toEqual([]);
            expect(state.tableComputations[1].orderingTable).toBeNull();
            expect(state.tableComputations[1].tasks.orderingTask?.orderingConstraints).toEqual([]);
            expect(memory.getRegisteredDataFrames().has(orderingDataFrame)).toBe(false);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('ignores an ordering result after ordering is cleared', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input_stale_clear");
            const orderingDataFrame = mockDataFrame("__test_ordering_stale_clear");
            const ordering: OrderByConstraint[] = [{ field: 'score', ascending: false }];

            let state = stateWithTable(memory, inputDataFrame);
            [state] = scheduleOrdering(state, inputDataFrame, memory, ordering);
            state = reduceComputationState(state, { type: CLEAR_TABLE_ORDERING, value: 1 }, memory);

            state = reduceComputationState(state, {
                type: TABLE_ORDERING_SUCCEDED,
                value: [1, orderingResult(orderingDataFrame, state.tableComputations[1].version, ordering)],
            }, memory);

            expect(state.tableComputations[1].dataTableOrdering).toEqual([]);
            expect(state.tableComputations[1].orderingTable).toBeNull();
            expect(memory.getRegisteredDataFrames().has(orderingDataFrame)).toBe(false);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('ignores stale ordering table success for an older table epoch', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const staleOrderingDataFrame = mockDataFrame("__test_ordering_stale");

            let state = stateWithTable(memory, inputDataFrame);
            [state] = scheduleOrdering(state, inputDataFrame, memory);
            const staleVersion = state.tableComputations[1].version;
            [state] = scheduleFiltering(state, inputDataFrame, memory);
            expect(state.tableComputations[1].version.filter).toEqual(1);

            const staleOrderingSucceeded: ComputationAction = {
                type: TABLE_ORDERING_SUCCEDED,
                value: [1, orderingResult(staleOrderingDataFrame, staleVersion)],
            };

            state = reduceComputationState(state, staleOrderingSucceeded, memory);
            expect(state.tableComputations[1].version.filter).toEqual(1);
            expect(state.tableComputations[1].orderingTable).toBeNull();
            expect(state.tableComputations[1].dataFrame).toBe(inputDataFrame);
            expect(memory.getRegisteredDataFrames().has(staleOrderingDataFrame)).toBe(false);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('discards stale filtered aggregation results without replacing the active task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const tableAggregateDataFrame = mockDataFrame("__test_tbl_agg");
            const scoreAggregateDataFrame = mockDataFrame("__test_col_agg");
            const filteredAggregateDataFrame = mockDataFrame("__test_filtered_col_agg");
            const staleAggregateDataFrame = mockDataFrame("__test_stale_col_agg");
            const filterDataFrame = mockDataFrame("__test_filter");

            // The score column has a summary, then a filter selects rows
            let state = scheduleScoreAggregation(memory, inputDataFrame, tableAggregateDataFrame);
            const unfilteredAggregate = scoreAggregate(scoreAggregateDataFrame);
            state = reduceComputationState(state, { type: COLUMN_AGGREGATION_SUCCEEDED, value: [1, 1, unfilteredAggregate] }, memory);
            let filtering: TaskVariant;
            [state, filtering] = scheduleFiltering(state, inputDataFrame, memory);
            const version = filtering.value.tableVersion;
            const filter = filterResult(filterDataFrame, version);
            state = reduceComputationState(state, { type: TABLE_FILTERING_SUCCEEDED, value: [1, version, filter] }, memory);
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[1]).toEqual(true);

            // The summary over the selected rows is computed
            [state] = schedule(state, {
                type: FILTERED_COLUMN_AGGREGATION_TASK,
                value: {
                    tableId: 1,
                    tableVersion: version,
                    inputDataFrame,
                    columnId: 1,
                    columnEntry: inputTableColumns[1],
                    tableAggregate: tableAggregation(tableAggregateDataFrame),
                    filterTable: filter,
                    dataSearchTable: null,
                    selectionRowCount: filterTable.numRows,
                    unfilteredAggregate,
                },
            }, memory);
            for (const task of Object.values(state.schedulerTasks)) {
                state = reduceComputationState(state, { type: UNREGISTER_SCHEDULER_TASK, value: task }, memory);
            }

            const staleVersion = new ComputationStateVersion(version.data, version.filter - 1);
            const aggregationSucceeded: ComputationAction = {
                type: FILTERED_COLUMN_AGGREGATION_SUCCEEDED,
                value: [1, 1, staleVersion, createFilteredOrdinalAggregate(
                    scoreColumn,
                    staleAggregateDataFrame,
                    scoreAggregateTable,
                    scoreAggregateTableFormatter,
                    ordinalColumnAnalysis,
                    staleVersion,
                )],
            };

            state = reduceComputationState(state, aggregationSucceeded, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(state.tableComputations[1].filteredColumnAggregates[1]).toBeNull();
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[1]).toEqual(true);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().has(staleAggregateDataFrame)).toBe(false);

            const current = createFilteredOrdinalAggregate(
                scoreColumn,
                filteredAggregateDataFrame,
                scoreAggregateTable,
                scoreAggregateTableFormatter,
                ordinalColumnAnalysis,
                version,
            );
            const currentAggregationSucceeded: ComputationAction = {
                type: FILTERED_COLUMN_AGGREGATION_SUCCEEDED,
                value: [1, 1, version, current],
            };
            state = reduceComputationState(state, currentAggregationSucceeded, memory);
            expect(state.tableComputations[1].filteredColumnAggregates[1]).toBe(current);
            expect(state.tableComputations[1].filteredColumnAggregates[1]?.filterVersion.filter).toEqual(1);
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[1]).toEqual(false);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });
    });
});
