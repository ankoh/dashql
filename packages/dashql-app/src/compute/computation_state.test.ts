import * as arrow from 'apache-arrow';

import { ArrowTableFormatter } from '../view/query_result/arrow_formatter.js';
import { DataFrame, DataFrameRegistry } from './data_frame.js';
import { AsyncValue } from '../utils/async_value.js';
import { COMPUTATION_FROM_QUERY_RESULT, FILTERED_COLUMN_AGGREGATION_SUCCEEDED, TABLE_FILTERING_SUCCEEDED, WEBDB_CONNECTION_CONFIGURATION_FAILED, WEBDB_CONNECTION_CONFIGURED, ComputationAction, createComputationState, createTableComputationState, DELETE_COMPUTATION, reduceComputationState, SCHEDULE_TASK, UNREGISTER_SCHEDULER_TASK, UPDATE_SCHEDULER_TASK } from './computation_state.js';
import { BinnedValuesTable, ColumnAggregationVariant, ColumnGroup, FilterTable, OrderedTable, ORDINAL_COLUMN, OrdinalColumnAnalysis, OrdinalGridColumnGroup, ROWNUMBER_COLUMN, TableAggregation, TaskStatus, WithFilterEpoch } from './computation_types.js';
import { LoggableException } from '../platform/logger.js';
import { COLUMN_AGGREGATION_TASK, FILTERED_COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK } from './computation_scheduler.js';
import { TestLogger } from '../platform/test_logger.js';
import { WebDBConnection } from '../webdb/api.js';

function createMockDataFrame(tableName: string): DataFrame {
    return new DataFrame({} as WebDBConnection, tableName);
}

function createOrdinalAggregate(
    columnEntry: OrdinalGridColumnGroup,
    dataFrame: DataFrame,
    aggregateTable: BinnedValuesTable<arrow.DataType<arrow.Type, any>, arrow.DataType<arrow.Type, any>>,
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
    aggregateTable: BinnedValuesTable<arrow.DataType<arrow.Type, any>, arrow.DataType<arrow.Type, any>>,
    formatter: ArrowTableFormatter,
    analysis: OrdinalColumnAnalysis,
    filterTableEpoch: number,
): WithFilterEpoch<ColumnAggregationVariant> {
    return {
        ...createOrdinalAggregate(columnEntry, dataFrame, aggregateTable, formatter, analysis),
        filterTableEpoch,
    };
}

describe('ComputationState', () => {
    const logger = new TestLogger();

    const inputTable = arrow.tableFromArrays({
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

    const aggregateTable = arrow.tableFromArrays({
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

    const scoreAggregateTable: BinnedValuesTable<arrow.Float64, arrow.Float64> = arrow.tableFromArrays({
        "bin": new Int32Array([0, 1, 2, 3]),
        "binWidth": new Float64Array([2, 0, 1, 1]),
        "binLowerBound": new Float64Array([10, 10, 10, 10]),
        "binUpperBound": new Float64Array([10, 20, 30, 40]),
        "count": new BigInt64Array([BigInt(20), BigInt(30), BigInt(40), BigInt(50)]),
    });
    const scoreAggregateTableFormatter = new ArrowTableFormatter(scoreAggregateTable.schema, scoreAggregateTable.batches, logger);

    const filterTable = arrow.tableFromArrays({
        "rowNumber": new Int32Array([0, 1]),
    });
    const ordinalColumnAnalysis: OrdinalColumnAnalysis = {
        countNotNull: 4,
        countNull: 0,
        minValue: '10',
        maxValue: '42',
        binCount: 4,
        binValueCounts: new BigInt64Array([BigInt(2), BigInt(0), BigInt(1), BigInt(1)]),
        binPercentages: new Float64Array([0.5, 0, 0.25, 0.25]),
        binLowerBounds: ['10', '20', '30', '40'],
    };

    it('configure a computation state', () => {
        const memory = new DataFrameRegistry(logger);
        const state = createComputationState();
        expect(state.webdbConnection).toBeNull();
        expect(memory.getRegisteredDataFrames().size).toEqual(0);
    });

    it('configure a webdb connection', () => {
        const memory = new DataFrameRegistry(logger);
        const mockConn = {} as WebDBConnection;
        const state = createComputationState();
        const action: ComputationAction = {
            type: WEBDB_CONNECTION_CONFIGURED,
            value: mockConn,
        };
        const output = reduceComputationState(state, action, memory, logger);
        expect(output.webdbConnection).toBe(mockConn);
        expect(output.webdbConnectionSetupError).toBeNull();
    });

    it('connection configuration failed', () => {
        const memory = new DataFrameRegistry(logger);
        const state = createComputationState();
        const error = new Error('test error');
        const action: ComputationAction = {
            type: WEBDB_CONNECTION_CONFIGURATION_FAILED,
            value: error,
        };
        const output = reduceComputationState(state, action, memory, logger);
        expect(output.webdbConnectionSetupError).toBe(error);
    });

    it('computation from query result', () => {
        const memory = new DataFrameRegistry(logger);
        const state = createComputationState();
        const tableLifetime = new AbortController();
        const action: ComputationAction = {
            type: COMPUTATION_FROM_QUERY_RESULT,
            value: [1, inputTable, inputTableColumns, tableLifetime],
        };
        const output = reduceComputationState(state, action, memory, logger);
        expect(Object.entries(output.tableComputations).length).toEqual(1);
        expect(output.tableComputations[1].dataTable).toEqual(inputTable);
        expect(output.tableComputations[1].dataTableFieldsByName).toEqual(inputTableFieldIndex);
        expect(output.tableComputations[1].columnGroups).toEqual(inputTableColumns);
        expect(output.tableComputations[1].dataTableLifetime).toEqual(tableLifetime);
        expect(output.tableComputations[1].dataFrame).toBeNull();
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
        const output = reduceComputationState(state, action, memory, logger);
        expect(Object.entries(output.tableComputations).length).toEqual(0);
    });

    describe('task scheduling', () => {
        it('filtering task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = createMockDataFrame("__test_input");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42;
            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: TABLE_FILTERING_TASK,
                    value: {
                        tableId: 1,
                        tableEpoch: 20,
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

            state = reduceComputationState(state, schedulingAction, memory, logger);
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
            state = reduceComputationState(state, updateAction, memory, logger);
            expect(state.tableComputations[1].tasks.filteringTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.filteringTask).not.toBeNull();
        });

        it('ordering task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = createMockDataFrame("__test_input");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42;
            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: TABLE_ORDERING_TASK,
                    value: {
                        tableId: 1,
                        tableEpoch: 20,
                        inputDataTable: inputTable,
                        inputDataTableFieldIndex: inputTableFieldIndex,
                        inputDataFrame,
                        orderingConstraints: [
                            { field: 'score', ascending: false, nullsFirst: false },
                        ],
                    },
                    result: new AsyncValue<OrderedTable, LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory, logger);
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
            state = reduceComputationState(state, updateAction, memory, logger);
            expect(state.tableComputations[1].tasks.orderingTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);

            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.orderingTask).not.toBeNull();
        });

        it('table aggregation task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = createMockDataFrame("__test_input");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42;
            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: TABLE_AGGREGATION_TASK,
                    value: {
                        tableId: 1,
                        tableEpoch: 20,
                        inputDataFrame,
                        columnEntries: inputTableColumns,
                    },
                    result: new AsyncValue<[TableAggregation, ColumnGroup[]], LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory, logger);
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
            state = reduceComputationState(state, deleteTask, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.tableAggregationTask).not.toBeNull();
        });

        it('system column computation task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = createMockDataFrame("__test_input");
            const aggregateDataFrame = createMockDataFrame("__test_agg");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42;
            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: SYSTEM_COLUMN_COMPUTATION_TASK,
                    value: {
                        tableId: 1,
                        tableEpoch: 20,
                        inputDataFrame,
                        inputTable: inputTable,
                        columnEntries: inputTableColumns,
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

            state = reduceComputationState(state, schedulingAction, memory, logger);
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
            state = reduceComputationState(state, deleteTask, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(state.tableComputations[1].tasks.systemColumnTask).not.toBeNull();
        });

        it('column aggregation task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = createMockDataFrame("__test_input");
            const aggregateDataFrame = createMockDataFrame("__test_agg");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42;
            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: COLUMN_AGGREGATION_TASK,
                    value: {
                        tableId: 1,
                        tableEpoch: 20,
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
            };

            state = reduceComputationState(state, schedulingAction, memory, logger);
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
            state = reduceComputationState(state, deleteTask, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]).not.toBeNull();
        });

        it('filtered column aggregation task', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = createMockDataFrame("__test_input");
            const tableAggregateDataFrame = createMockDataFrame("__test_tbl_agg");
            const scoreAggregateDataFrame = createMockDataFrame("__test_col_agg");
            const filterDataFrame = createMockDataFrame("__test_filter");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42;

            const schedulingAction: ComputationAction = {
                type: SCHEDULE_TASK,
                value: {
                    type: FILTERED_COLUMN_AGGREGATION_TASK,
                    value: {
                        tableId: 1,
                        tableEpoch: 20,
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
                            tableEpoch: 10,
                        },
                        unfilteredAggregate: {
                            ...createOrdinalAggregate(inputTableColumns[1].value as OrdinalGridColumnGroup, scoreAggregateDataFrame, scoreAggregateTable as unknown as BinnedValuesTable<arrow.DataType<arrow.Type, any>, arrow.DataType<arrow.Type, any>>, scoreAggregateTableFormatter, ordinalColumnAnalysis),
                        },
                    },
                    result: new AsyncValue<WithFilterEpoch<ColumnAggregationVariant> | null, LoggableException>(),
                },
            };

            state = reduceComputationState(state, schedulingAction, memory, logger);
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
            state = reduceComputationState(state, deleteTask, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(4);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]).not.toBeNull();
        });

        it('marks filtered column summaries outdated without scheduling all columns on filter success', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = createMockDataFrame("__test_input");
            const filterDataFrame = createMockDataFrame("__test_filter");
            const scoreAggregateDataFrame = createMockDataFrame("__test_col_agg");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.tableComputations[1].columnAggregates[1] = createOrdinalAggregate(
                inputTableColumns[1].value as OrdinalGridColumnGroup,
                scoreAggregateDataFrame,
                scoreAggregateTable as unknown as BinnedValuesTable<arrow.DataType<arrow.Type, any>, arrow.DataType<arrow.Type, any>>,
                scoreAggregateTableFormatter,
                ordinalColumnAnalysis,
            );

            const filterSucceeded: ComputationAction = {
                type: TABLE_FILTERING_SUCCEEDED,
                value: [1, {
                    inputRowNumberColumnName: 'rowNumber',
                    dataTable: filterTable,
                    dataFrame: filterDataFrame,
                    tableEpoch: 10,
                }],
            };

            state = reduceComputationState(state, filterSucceeded, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(state.tableComputations[1].filterTable?.tableEpoch).toEqual(10);
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[0]).toEqual(false);
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[1]).toEqual(true);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]).toBeNull();
        });

        it('keeps stale filtered aggregation results marked outdated without auto-rescheduling', () => {
            const memory = new DataFrameRegistry(logger);
            const inputDataFrame = createMockDataFrame("__test_input");
            const tableAggregateDataFrame = createMockDataFrame("__test_tbl_agg");
            const scoreAggregateDataFrame = createMockDataFrame("__test_col_agg");
            const filteredAggregateDataFrame = createMockDataFrame("__test_filtered_col_agg");
            const filterDataFrame = createMockDataFrame("__test_filter");

            let state = createComputationState();
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.tableComputations[1].filterTable = {
                inputRowNumberColumnName: 'rowNumber',
                dataTable: filterTable,
                dataFrame: filterDataFrame,
                tableEpoch: 10,
            };
            state.tableComputations[1].columnAggregates[1] = createOrdinalAggregate(
                inputTableColumns[1].value as OrdinalGridColumnGroup,
                scoreAggregateDataFrame,
                scoreAggregateTable as unknown as BinnedValuesTable<arrow.DataType<arrow.Type, any>, arrow.DataType<arrow.Type, any>>,
                scoreAggregateTableFormatter,
                ordinalColumnAnalysis,
            );
            state.tableComputations[1].filteredColumnAggregatesOutdated[1] = true;
            state.tableComputations[1].tasks.filteredColumnAggregationTasks[1] = {
                tableId: 1,
                tableEpoch: 20,
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
                    tableEpoch: 9,
                },
                unfilteredAggregate: createOrdinalAggregate(
                    inputTableColumns[1].value as OrdinalGridColumnGroup,
                    scoreAggregateDataFrame,
                    scoreAggregateTable as unknown as BinnedValuesTable<arrow.DataType<arrow.Type, any>, arrow.DataType<arrow.Type, any>>,
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
                value: [1, 1, createFilteredOrdinalAggregate(
                    inputTableColumns[1].value as OrdinalGridColumnGroup,
                    filteredAggregateDataFrame,
                    scoreAggregateTable as unknown as BinnedValuesTable<arrow.DataType<arrow.Type, any>, arrow.DataType<arrow.Type, any>>,
                    scoreAggregateTableFormatter,
                    ordinalColumnAnalysis,
                    9,
                )],
            };

            state = reduceComputationState(state, aggregationSucceeded, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(state.tableComputations[1].filteredColumnAggregates[1]?.filterTableEpoch).toEqual(9);
            expect(state.tableComputations[1].filteredColumnAggregatesOutdated[1]).toEqual(true);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
        });
    });
});
