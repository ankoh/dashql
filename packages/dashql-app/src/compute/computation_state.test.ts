import * as arrow from 'apache-arrow';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ArrowTableFormatter } from './arrow_formatter.js';
import { DataFrame, DataFrameRegistry } from './data_frame.js';
import { AsyncValue } from '../utils/async_value.js';
import { CLEAR_TABLE_ORDERING, COLUMN_AGGREGATION_SUCCEEDED, COLUMN_SEARCH_SUCCEEDED, COMPUTATION_FROM_QUERY_RESULT, CREATED_DATA_FRAME, DATA_SEARCH_FAILED, DATA_SEARCH_SUCCEEDED, RESULT_SEARCH_FAILED, FILTERED_COLUMN_AGGREGATION_SUCCEEDED, SET_CROSS_FILTERS, SET_RESULT_SEARCH_PATTERN, TABLE_FILTERING_SUCCEEDED, TABLE_ORDERING_SUCCEDED, ComputationAction, ComputationState, createComputationState, createTableComputationState, DELETE_COMPUTATION, reduceComputationState, SCHEDULE_TASK, UNREGISTER_SCHEDULER_TASK, UPDATE_SCHEDULER_TASK } from './computation_state.js';
import { BinnedValuesTable, ColumnAggregationVariant, ColumnGroup, ComputationStateVersion, FilterTable, LIST_COLUMN, OrderingTable, ORDINAL_COLUMN, OrdinalColumnAnalysis, OrdinalGridColumnGroup, ROWNUMBER_COLUMN, STRING_COLUMN, TableAggregation, TaskStatus, WithFilterEpoch } from './computation_types.js';
import { LoggableException } from '../platform/logger/logger.js';
import { COLUMN_AGGREGATION_TASK, DATA_SEARCH_TASK, FILTERED_COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK } from './computation_types.js';
import { TestLogger } from '../platform/logger/test_logger.js';
import { mockDataFrame } from '../tests/mocks/compute_query.js';
import { CrossFilters } from './cross_filters.js';
import { tableFromArrays } from '../tests/arrow_fixtures.js';

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

function releaseAllRegisteredDataFramesFromLatestState(state: ComputationState, memory: DataFrameRegistry) {
    expect(Object.entries(state.tableComputations).length).toBeGreaterThan(0);
    const liveDataFrames = new Set<DataFrame>();
    const addDataFrame = (dataFrame: DataFrame | null | undefined) => {
        if (dataFrame != null) {
            liveDataFrames.add(dataFrame);
        }
    };

    for (const tableState of Object.values(state.tableComputations)) {
        addDataFrame(tableState.dataFrame);
        addDataFrame(tableState.filterTable?.dataFrame);
        addDataFrame(tableState.dataSearchTable?.dataFrame);
        addDataFrame(tableState.orderingTable?.dataFrame);
        addDataFrame(tableState.tableAggregation?.dataFrame);

        for (const aggregate of tableState.columnAggregates) {
            addDataFrame(getAggregationDataFrame(aggregate));
        }
        for (const aggregate of tableState.filteredColumnAggregates) {
            addDataFrame(getAggregationDataFrame(aggregate));
        }

        addDataFrame(tableState.tasks.filteringTask?.inputDataFrame);
        addDataFrame(tableState.tasks.orderingTask?.inputDataFrame);
        addDataFrame(tableState.tasks.orderingTask?.filterTable?.dataFrame);
        addDataFrame(tableState.tasks.orderingTask?.dataSearchTable?.dataFrame);
        addDataFrame(tableState.tasks.dataSearchTask?.inputDataFrame);
        addDataFrame(tableState.tasks.tableAggregationTask?.inputDataFrame);
        addDataFrame(tableState.tasks.systemColumnTask?.inputDataFrame);
        addDataFrame(tableState.tasks.systemColumnTask?.tableAggregate.dataFrame);

        for (const task of tableState.tasks.columnAggregationTasks) {
            addDataFrame(task?.inputDataFrame);
            addDataFrame(task?.tableAggregate.dataFrame);
        }
        for (const task of tableState.tasks.filteredColumnAggregationTasks) {
            addDataFrame(task?.inputDataFrame);
            addDataFrame(task?.tableAggregate.dataFrame);
            addDataFrame(task?.filterTable?.dataFrame);
            addDataFrame(task?.dataSearchTable?.dataFrame);
            addDataFrame(getAggregationDataFrame(task?.unfilteredAggregate));
        }
    }

    for (const dataFrame of liveDataFrames) {
        const refCount = memory.getRegisteredDataFrames().get(dataFrame) ?? 0;
        for (let i = 0; i < refCount; ++i) {
            memory.release(dataFrame);
        }
    }

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

    /// A computation state with table 1 of the input table, materialized as the data frame
    function stateWithTable(dataFrame: DataFrame): ComputationState {
        const state = createComputationState();
        state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
        state.tableComputations[1].dataFrame = dataFrame;
        return state;
    }

    it('configure a computation state', () => {
        const memory = new DataFrameRegistry(logger);
        const state = createComputationState();
        expect(Object.keys(state.tableComputations)).toEqual([]);
        expect(memory.getRegisteredDataFrames().size).toEqual(0);
    });

    it('computation from query result', () => {
        const memory = new DataFrameRegistry(logger);
        const state = createComputationState();
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

    it('keeps column matches visible while a replacement search is pending', () => {
        const memory = new DataFrameRegistry(logger);
        const dataFrame = mockDataFrame('__test_input');
        let state = stateWithTable(dataFrame);

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
        let state = stateWithTable(dataFrame);
        state.tableComputations[1].version = new ComputationStateVersion(2, 7);
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
                version: new ComputationStateVersion(2, 7),
                requestId: 1,
            }],
        }, memory);

        expect(state.tableComputations[1].version).toEqual(new ComputationStateVersion(2, 7));
        expect(state.tableComputations[1].dataSearch.matchingRows).toEqual(new Map([[2, [1]], [3, [1]]]));
        expect(state.tableComputations[1].dataSearchTable?.dataFrame).toBe(searchFrame);
        expect(memory.getRegisteredDataFrames().get(searchFrame)).toBe(1);
    });

    it('drops the Data search of the latest request when it fails', () => {
        const memory = new DataFrameRegistry(logger);
        const dataFrame = mockDataFrame('__test_input');
        const searchFrame = mockDataFrame('__test_search');
        let state = stateWithTable(dataFrame);
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
        let state = stateWithTable(dataFrame);
        state = reduceComputationState(state, { type: SET_RESULT_SEARCH_PATTERN, value: [1, 'columns', 'sc'] }, memory);
        const requestId = state.tableComputations[1].columnSearch.requestId;

        expect(reduceComputationState(state, { type: RESULT_SEARCH_FAILED, value: [1, dataFrame, 'columns', requestId + 1, 'stale'] }, memory)).toBe(state);
        state = reduceComputationState(state, { type: RESULT_SEARCH_FAILED, value: [1, dataFrame, 'columns', requestId, 'bad pattern'] }, memory);
        expect(state.tableComputations[1].columnSearch).toMatchObject({ error: 'bad pattern', pending: false, matchingColumnGroups: null });
        expect(state.tableComputations[1].dataSearch.error).toBeNull();
    });

    it('keeps the state for equal cross filters', () => {
        const memory = new DataFrameRegistry(logger);
        const state = stateWithTable(mockDataFrame('__test_input'));
        const set = (filters: CrossFilters, tableId = 1): ComputationAction => ({ type: SET_CROSS_FILTERS, value: [tableId, filters] });
        expect(reduceComputationState(state, set(new CrossFilters()), memory)).toBe(state);
        expect(reduceComputationState(state, set(new CrossFilters(), 7), memory)).toBe(state);

        const filters = new CrossFilters();
        filters.addMostFrequentValueFilter(1, { inputFieldName: 'score', inputFieldType: new arrow.Utf8(), inputFieldNullable: true, statsFields: null, valueIdFieldName: 'score_id' }, 3);
        expect(reduceComputationState(state, set(filters), memory).tableComputations[1].crossFilters).toBe(filters);
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
        let state = stateWithTable(dataFrame);
        const first = searchTask(1);
        state = reduceComputationState(state, { type: SCHEDULE_TASK, value: { type: DATA_SEARCH_TASK, value: first, result: new AsyncValue() } }, memory);
        const second = searchTask(2);
        state = reduceComputationState(state, { type: SCHEDULE_TASK, value: { type: DATA_SEARCH_TASK, value: second, result: new AsyncValue() } }, memory);
        expect(first.abortController.signal.aborted).toBe(true);
        expect(state.tableComputations[1].tasks.dataSearchTask?.requestId).toBe(2);

        const update = (requestId: number): ComputationAction => ({
            type: UPDATE_SCHEDULER_TASK,
            value: [{ type: DATA_SEARCH_TASK, value: searchTask(requestId) } as never, { status: TaskStatus.TASK_SUCCEEDED }],
        });
        state = reduceComputationState(state, update(1), memory);
        expect(state.tableComputations[1].tasks.dataSearchTask?.progress.status).toBe(TaskStatus.TASK_RUNNING);
        state = reduceComputationState(state, update(2), memory);
        expect(state.tableComputations[1].tasks.dataSearchTask?.progress.status).toBe(TaskStatus.TASK_SUCCEEDED);
    });

    it('delete computation', () => {
        const memory = new DataFrameRegistry(logger);
        const state = createComputationState();
        const tableLifetime = new AbortController();
        state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, tableLifetime);
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
        let state = createComputationState();
        const previousFrame = mockDataFrame('__previous');
        const destroy = vi.spyOn(previousFrame, 'destroy').mockResolvedValue();

        state = reduceComputationState(state, {
            type: COMPUTATION_FROM_QUERY_RESULT,
            value: [1, inputTable, inputTableColumns, new AbortController()],
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
        expect(memory.getRegisteredDataFrames().has(previousFrame)).toBe(false);
        expect(destroy).toHaveBeenCalledOnce();
    });

    describe('task scheduling', () => {
        it('filtering task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");

            let state = stateWithTable(inputDataFrame);
            state.nextSchedulerTaskId = 42;
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
            expect(state.schedulerTasks[42].type).toEqual(TABLE_FILTERING_TASK);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.filteringTask).toBeDefined();
            expect(state.tableComputations[1].tasks.filteringTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            expect(inputRefCount).toEqual(2);

            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[42], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory);
            expect(state.tableComputations[1].tasks.filteringTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.filteringTask).not.toBeNull();
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('ordering task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");

            let state = stateWithTable(inputDataFrame);
            state.nextSchedulerTaskId = 42;
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
            expect(state.schedulerTasks[42].type).toEqual(TABLE_ORDERING_TASK);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.orderingTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            expect(inputRefCount).toEqual(2);

            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[42], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory);
            expect(state.tableComputations[1].tasks.orderingTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
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

            let state = stateWithTable(inputDataFrame);
            state.nextSchedulerTaskId = 42;
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
            expect(state.schedulerTasks[42].type).toEqual(TABLE_AGGREGATION_TASK);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.tableAggregationTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
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

            let state = stateWithTable(inputDataFrame);
            state.nextSchedulerTaskId = 42;
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
                        tableAggregate: {
                            dataFrame: aggregateDataFrame,
                            table: aggregateTable,
                            tableFieldsByName: aggregateTableFieldIndex,
                            tableFormatter: aggregateTableFormatter,
                            countStarFieldName: '_1_count',
                        },
                    },
                    result: new AsyncValue<[arrow.Table, DataFrame, ColumnGroup[]], LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(SYSTEM_COLUMN_COMPUTATION_TASK);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.systemColumnTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);

            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            let aggregateRefCount = memory.getRegisteredDataFrames().get(aggregateDataFrame);
            expect(inputRefCount).toEqual(2);
            expect(aggregateRefCount).toEqual(2);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(state.tableComputations[1].tasks.systemColumnTask).not.toBeNull();
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        /// A computation of table 1 with a scheduled aggregation task of the score column
        function scheduleScoreAggregation(memory: DataFrameRegistry, inputDataFrame: DataFrame, aggregateDataFrame: DataFrame): ComputationState {
            const state = stateWithTable(inputDataFrame);
            state.nextSchedulerTaskId = 42;
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
                        tableAggregate: {
                            dataFrame: aggregateDataFrame,
                            table: aggregateTable,
                            tableFieldsByName: aggregateTableFieldIndex,
                            tableFormatter: aggregateTableFormatter,
                            countStarFieldName: '_count_star',
                        },
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
            expect(state.schedulerTasks[42].type).toEqual(COLUMN_AGGREGATION_TASK);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);

            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            let aggregateRefCount = memory.getRegisteredDataFrames().get(aggregateDataFrame);
            expect(inputRefCount).toEqual(2);
            expect(aggregateRefCount).toEqual(2);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]).not.toBeNull();
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('stores succeeded column aggregates and releases the previous one', () => {
            const memory = new DataFrameRegistry(logger);
            const scoreColumn = inputTableColumns[1].value as OrdinalGridColumnGroup;
            const aggregate = (dataFrame: DataFrame) =>
                createOrdinalAggregate(scoreColumn, dataFrame, scoreAggregateTable, scoreAggregateTableFormatter, ordinalColumnAnalysis);
            const first = aggregate(mockDataFrame("__test_first"));
            const second = aggregate(mockDataFrame("__test_second"));
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
            const unknown = aggregate(mockDataFrame("__test_unknown"));
            expect(reduceComputationState(state, succeeded(7, 1, unknown), memory)).toBe(state);
            expect(reduceComputationState(state, succeeded(1, 0, unknown), memory)).toBe(state);
            expect(memory.getRegisteredDataFrames().has(getAggregationDataFrame(unknown)!)).toBe(false);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('filtered column aggregation task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const tableAggregateDataFrame = mockDataFrame("__test_tbl_agg");
            const scoreAggregateDataFrame = mockDataFrame("__test_col_agg");
            const filterDataFrame = mockDataFrame("__test_filter");

            let state = stateWithTable(inputDataFrame);
            state.nextSchedulerTaskId = 42;

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
                        tableAggregate: {
                            dataFrame: tableAggregateDataFrame,
                            table: aggregateTable,
                            tableFieldsByName: aggregateTableFieldIndex,
                            tableFormatter: aggregateTableFormatter,
                            countStarFieldName: '_count_star',
                        },
                        filterTable: {
                            inputRowNumberColumnName: 'rowNumber',
                            dataTable: filterTable,
                            dataFrame: filterDataFrame,
                            version: new ComputationStateVersion(0, 10),
                        },
                        dataSearchTable: null,
                        selectionRowCount: filterTable.numRows,
                        unfilteredAggregate: {
                            ...createOrdinalAggregate(inputTableColumns[1].value as OrdinalGridColumnGroup, scoreAggregateDataFrame, scoreAggregateTable, scoreAggregateTableFormatter, ordinalColumnAnalysis),
                        },
                    },
                    result: new AsyncValue<WithFilterEpoch<ColumnAggregationVariant> | null, LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(FILTERED_COLUMN_AGGREGATION_TASK);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(4);

            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            let filterRefCount = memory.getRegisteredDataFrames().get(filterDataFrame);
            let tableAggregateRefCount = memory.getRegisteredDataFrames().get(tableAggregateDataFrame);
            let columnAggregateRefCount = memory.getRegisteredDataFrames().get(scoreAggregateDataFrame);
            expect(inputRefCount).toEqual(2);
            expect(filterRefCount).toEqual(2);
            expect(tableAggregateRefCount).toEqual(2);
            expect(columnAggregateRefCount).toEqual(2);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
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

            let state = stateWithTable(inputDataFrame);
            state.tableComputations[1].version = new ComputationStateVersion(0, 10); // State must match filter result version
            state.tableComputations[1].columnAggregates[1] = createOrdinalAggregate(
                inputTableColumns[1].value as OrdinalGridColumnGroup,
                scoreAggregateDataFrame,
                scoreAggregateTable,
                scoreAggregateTableFormatter,
                ordinalColumnAnalysis,
            );

            const filterSucceeded: ComputationAction = {
                type: TABLE_FILTERING_SUCCEEDED,
                value: [1, new ComputationStateVersion(0, 10), {
                    inputRowNumberColumnName: 'rowNumber',
                    dataTable: filterTable,
                    dataFrame: filterDataFrame,
                    version: new ComputationStateVersion(0, 10),
                }],
            };

            state = reduceComputationState(state, filterSucceeded, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(state.tableComputations[1].filterTable?.version.filter).toEqual(10);
            expect(state.tableComputations[1].version.filter).toEqual(10); // State version unchanged (already incremented when task was scheduled)
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[0]).toEqual(false);
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[1]).toEqual(true);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]).toBeNull();
        });

        it('ignores stale filter table success for an older table epoch', () => {
            const memory = new DataFrameRegistry(logger);
            const staleFilterDataFrame = mockDataFrame("__test_filter_stale");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].version = new ComputationStateVersion(0, 11);

            const staleFilterSucceeded: ComputationAction = {
                type: TABLE_FILTERING_SUCCEEDED,
                value: [1, new ComputationStateVersion(0, 10), {
                    inputRowNumberColumnName: 'rowNumber',
                    dataTable: filterTable,
                    dataFrame: staleFilterDataFrame,
                    version: new ComputationStateVersion(0, 10),
                }],
            };

            state = reduceComputationState(state, staleFilterSucceeded, memory);
            expect(state.tableComputations[1].version.filter).toEqual(11);
            expect(state.tableComputations[1].filterTable).toBeNull();
            expect(memory.getRegisteredDataFrames().size).toEqual(0);
        });

        it('accepts filter table success for current table epoch', () => {
            const memory = new DataFrameRegistry(logger);
            const currentFilterDataFrame = mockDataFrame("__test_filter_current");
            const orderingDataFrame = mockDataFrame("__test_ordering_current");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].version = new ComputationStateVersion(0, 10);
            state.tableComputations[1].orderingTable = {
                inputRowNumberColumnName: 'rowNumber',
                orderingConstraints: [{ field: 'score', ascending: false, nullsFirst: false }],
                dataTable: filterTable,
                dataFrame: orderingDataFrame,
                version: new ComputationStateVersion(0, 9),
                dataSearchRequestId: null,
            };

            const currentFilterSucceeded: ComputationAction = {
                type: TABLE_FILTERING_SUCCEEDED,
                value: [1, new ComputationStateVersion(0, 10), {
                    inputRowNumberColumnName: 'rowNumber',
                    dataTable: filterTable,
                    dataFrame: currentFilterDataFrame,
                    version: new ComputationStateVersion(0, 10),
                }],
            };

            state = reduceComputationState(state, currentFilterSucceeded, memory);
            expect(state.tableComputations[1].version.filter).toEqual(10); // State unchanged (already incremented when task was scheduled)
            expect(state.tableComputations[1].filterTable?.version.filter).toEqual(10);
            expect(state.tableComputations[1].orderingTable).toBeNull(); // Ordering cleared because filter changed
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('stores ordering table without replacing the immutable base table', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const orderingDataFrame = mockDataFrame("__test_ordering");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].version = new ComputationStateVersion(0, 10);
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.tableComputations[1].tasks.orderingTask = {
                tableId: 1,
                tableVersion: state.tableComputations[1].version,
                inputDataTable: inputTable,
                inputDataTableFieldIndex: inputTableFieldIndex,
                inputDataFrame,
                filterTable: null,
                dataSearchTable: null,
                rowNumberColumnName: 'rowNumber',
                orderingConstraints: [{ field: 'score', ascending: false, nullsFirst: false }],
                progress: {
                    status: TaskStatus.TASK_RUNNING,
                    startedAt: new Date(),
                    completedAt: null,
                    failedAt: null,
                    failedWithError: null,
                },
            };
            memory.acquire(inputDataFrame);

            const orderingSucceeded: ComputationAction = {
                type: TABLE_ORDERING_SUCCEDED,
                value: [1, {
                    inputRowNumberColumnName: 'rowNumber',
                    orderingConstraints: [{ field: 'score', ascending: false, nullsFirst: false }],
                    dataTable: filterTable,
                    dataFrame: orderingDataFrame,
                    version: new ComputationStateVersion(0, 10),
                    dataSearchRequestId: null,
                }],
            };

            state = reduceComputationState(state, orderingSucceeded, memory);
            expect(state.tableComputations[1].version.filter).toEqual(10); // Ordering doesn't change filter version
            expect(state.tableComputations[1].dataFrame).toBe(inputDataFrame);
            expect(state.tableComputations[1].dataTable).toBe(inputTable);
            expect(state.tableComputations[1].orderingTable?.dataFrame).toBe(orderingDataFrame);
            expect(state.tableComputations[1].dataTableOrdering).toEqual([{ field: 'score', ascending: false, nullsFirst: false }]);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('clears the active table ordering', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input_clear_ordering");
            const orderingDataFrame = mockDataFrame("__test_ordering_clear");

            let state = stateWithTable(inputDataFrame);
            state.tableComputations[1].dataTableOrdering = [{ field: 'score', ascending: false }];
            state.tableComputations[1].orderingTable = {
                inputRowNumberColumnName: 'rowNumber',
                orderingConstraints: [{ field: 'score', ascending: false }],
                dataTable: filterTable,
                dataFrame: orderingDataFrame,
                version: state.tableComputations[1].version,
                dataSearchRequestId: null,
            };
            memory.acquire(orderingDataFrame);

            state = reduceComputationState(state, { type: CLEAR_TABLE_ORDERING, value: 1 }, memory);

            expect(state.tableComputations[1].dataTableOrdering).toEqual([]);
            expect(state.tableComputations[1].orderingTable).toBeNull();
            expect(memory.getRegisteredDataFrames().has(orderingDataFrame)).toBe(false);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('ignores an ordering result after ordering is cleared', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input_stale_clear");
            const orderingDataFrame = mockDataFrame("__test_ordering_stale_clear");

            let state = stateWithTable(inputDataFrame);
            state.tableComputations[1].tasks.orderingTask = {
                tableId: 1,
                tableVersion: state.tableComputations[1].version,
                inputDataTable: inputTable,
                inputDataTableFieldIndex: inputTableFieldIndex,
                inputDataFrame,
                filterTable: null,
                dataSearchTable: null,
                rowNumberColumnName: 'rowNumber',
                orderingConstraints: [],
                progress: {
                    status: TaskStatus.TASK_RUNNING,
                    startedAt: new Date(),
                    completedAt: null,
                    failedAt: null,
                    failedWithError: null,
                },
            };

            state = reduceComputationState(state, {
                type: TABLE_ORDERING_SUCCEDED,
                value: [1, {
                    inputRowNumberColumnName: 'rowNumber',
                    orderingConstraints: [{ field: 'score', ascending: false }],
                    dataTable: filterTable,
                    dataFrame: orderingDataFrame,
                    version: state.tableComputations[1].version,
                    dataSearchRequestId: null,
                }],
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

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].version = new ComputationStateVersion(0, 11);
            state.tableComputations[1].dataFrame = inputDataFrame;
            memory.acquire(inputDataFrame);

            const staleOrderingSucceeded: ComputationAction = {
                type: TABLE_ORDERING_SUCCEDED,
                value: [1, {
                    inputRowNumberColumnName: 'rowNumber',
                    orderingConstraints: [{ field: 'score', ascending: false, nullsFirst: false }],
                    dataTable: filterTable,
                    dataFrame: staleOrderingDataFrame,
                    version: new ComputationStateVersion(0, 10),
                    dataSearchRequestId: null,
                }],
            };

            state = reduceComputationState(state, staleOrderingSucceeded, memory);
            expect(state.tableComputations[1].version.filter).toEqual(11);
            expect(state.tableComputations[1].orderingTable).toBeNull();
            expect(state.tableComputations[1].dataFrame).toBe(inputDataFrame);
            releaseAllRegisteredDataFramesFromLatestState(state, memory);
        });

        it('discards stale filtered aggregation results without replacing the active task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = mockDataFrame("__test_input");
            const tableAggregateDataFrame = mockDataFrame("__test_tbl_agg");
            const scoreAggregateDataFrame = mockDataFrame("__test_col_agg");
            const filteredAggregateDataFrame = mockDataFrame("__test_filtered_col_agg");
            const filterDataFrame = mockDataFrame("__test_filter");

            let state = stateWithTable(inputDataFrame);
            state.tableComputations[1].version = new ComputationStateVersion(0, 10);
            state.tableComputations[1].filterTable = {
                inputRowNumberColumnName: 'rowNumber',
                dataTable: filterTable,
                dataFrame: filterDataFrame,
                version: new ComputationStateVersion(0, 10),
            };
            state.tableComputations[1].columnAggregates[1] = createOrdinalAggregate(
                inputTableColumns[1].value as OrdinalGridColumnGroup,
                scoreAggregateDataFrame,
                scoreAggregateTable,
                scoreAggregateTableFormatter,
                ordinalColumnAnalysis,
            );
            state.tableComputations[1].filteredColumnAggregatesOutdated[1] = true;
            state.tableComputations[1].tasks.filteredColumnAggregationTasks[1] = {
                tableId: 1,
                tableVersion: new ComputationStateVersion(0, 10),
                inputDataFrame,
                columnId: 1,
                columnEntry: inputTableColumns[1],
                tableAggregate: {
                    dataFrame: tableAggregateDataFrame,
                    table: aggregateTable,
                    tableFieldsByName: aggregateTableFieldIndex,
                    tableFormatter: aggregateTableFormatter,
                    countStarFieldName: '_count_star',
                },
                filterTable: {
                    inputRowNumberColumnName: 'rowNumber',
                    dataTable: filterTable,
                    dataFrame: filterDataFrame,
                    version: new ComputationStateVersion(0, 10),
                },
                dataSearchTable: null,
                selectionRowCount: filterTable.numRows,
                unfilteredAggregate: createOrdinalAggregate(
                    inputTableColumns[1].value as OrdinalGridColumnGroup,
                    scoreAggregateDataFrame,
                    scoreAggregateTable,
                    scoreAggregateTableFormatter,
                    ordinalColumnAnalysis,
                ),
                progress: {
                    status: TaskStatus.TASK_RUNNING,
                    startedAt: new Date(),
                    completedAt: null,
                    failedAt: null,
                    failedWithError: null,
                },
            };

            const aggregationSucceeded: ComputationAction = {
                type: FILTERED_COLUMN_AGGREGATION_SUCCEEDED,
                value: [1, 1, new ComputationStateVersion(0, 9), createFilteredOrdinalAggregate(
                    inputTableColumns[1].value as OrdinalGridColumnGroup,
                    filteredAggregateDataFrame,
                    scoreAggregateTable,
                    scoreAggregateTableFormatter,
                    ordinalColumnAnalysis,
                    new ComputationStateVersion(0, 9),
                )],
            };

            state = reduceComputationState(state, aggregationSucceeded, memory);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(state.tableComputations[1].filteredColumnAggregates[1]).toBeNull();
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[1]).toEqual(true);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_RUNNING);

            const currentAggregationSucceeded: ComputationAction = {
                type: FILTERED_COLUMN_AGGREGATION_SUCCEEDED,
                value: [1, 1, new ComputationStateVersion(0, 10), createFilteredOrdinalAggregate(
                    inputTableColumns[1].value as OrdinalGridColumnGroup,
                    filteredAggregateDataFrame,
                    scoreAggregateTable,
                    scoreAggregateTableFormatter,
                    ordinalColumnAnalysis,
                    new ComputationStateVersion(0, 10),
                )],
            };
            state = reduceComputationState(state, currentAggregationSucceeded, memory);
            expect(state.tableComputations[1].filteredColumnAggregates[1]?.filterVersion.filter).toEqual(10);
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[1]).toEqual(false);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
        });
    });
});
