import '@jest/globals';

import * as arrow from 'apache-arrow';
import * as compute from '@ankoh/dashql-compute';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';

import { ArrowTableFormatter } from '../view/query_result/arrow_formatter.js';
import { AsyncDataFrame, AsyncDataFrameRegistry } from './compute_worker_bindings.js';
import { AsyncValue } from '../utils/async_value.js';
import { COMPUTATION_FROM_QUERY_RESULT, COMPUTATION_WORKER_CONFIGURATION_FAILED, COMPUTATION_WORKER_CONFIGURED, ComputationAction, createComputationState, createTableComputationState, DELETE_COMPUTATION, reduceComputationState, SCHEDULE_TASK, UNREGISTER_SCHEDULER_TASK, UPDATE_SCHEDULER_TASK } from './computation_state.js';
import { BinnedValuesTable, ColumnAggregationVariant, ColumnGroup, FilterTable, OrderedTable, ORDINAL_COLUMN, OrdinalColumnAnalysis, OrdinalGridColumnGroup, ROWNUMBER_COLUMN, TableAggregation, TaskStatus, WithFilterEpoch } from './computation_types.js';
import { LoggableException } from '../platform/logger.js';
import { COLUMN_AGGREGATION_TASK, FILTERED_COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK } from './computation_scheduler.js';
import { TestLogger } from '../platform/test_logger.js';
import { instantiateTestWorker } from './compute_test_worker.js';

const distPath = path.resolve(fileURLToPath(new URL('../../../dashql-compute/dist/', import.meta.url)));
const wasmPath = path.resolve(distPath, './dashql_compute_bg.wasm');

beforeAll(async () => {
    expect(async () => await fs.promises.access(wasmPath)).resolves;
    const buf = await fs.promises.readFile(wasmPath);
    await compute.default({
        module_or_path: buf
    });
    const version = compute.getVersion();
    expect(version.text).toMatch(/^[0-9]+.[0-9]+.[0-9]+(\-dev\.[0-9]+)?$/);
});

describe('ComputationState', () => {
    const logger = new TestLogger();

    const inputTable = arrow.tableFromArrays({
        rowNumber: new Int32Array([
            0, 1, 2, 3,
        ]),
        score: new Float64Array([
            42, 10, 10, 30,
        ])
    });
    const inputTableFieldIndex = new Map([
        ['rowNumber', 0],
        ['score', 1],
    ]);
    const inputTableColumns: ColumnGroup[] = [
        {
            type: ROWNUMBER_COLUMN,
            value: {
                rowNumberFieldName: 'rowNumber',
            },
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
    const scoreAggregateTableFieldIndex = new Map([
        ["bin", 0],
        ["binWidth", 1],
        ["binLowerBound", 2],
        ["binUpperBound", 3],
        ["count", 4],
    ]);
    const scoreAggregateTableFormatter = new ArrowTableFormatter(scoreAggregateTable.schema, scoreAggregateTable.batches, logger);

    const filterTable = arrow.tableFromArrays({
        "rowNumber": new Int32Array([0, 1]),
    });
    const filterTableFieldIndex = new Map([
        ["rowNumber", 0],
    ]);
    const filterTableFormatter = new ArrowTableFormatter(filterTable.schema, filterTable.batches, logger);

    it('configure a computation state', async () => {
        const memory = new AsyncDataFrameRegistry(logger);
        const worker = await instantiateTestWorker(wasmPath, logger);
        const state = createComputationState(worker);
        expect(state.computationWorker).toBe(worker);
        expect(memory.getRegisteredDataFrames().size).toEqual(0);
    });

    it('configure a worker', async () => {
        const memory = new AsyncDataFrameRegistry(logger);
        const worker = await instantiateTestWorker(wasmPath, logger);
        const state = createComputationState(worker);
        const action: ComputationAction = {
            type: COMPUTATION_WORKER_CONFIGURED,
            value: worker,
        };
        const output = reduceComputationState(state, action, memory, logger);
        expect(output.computationWorker).toBe(worker);
        expect(output.computationWorkerSetupError).toBeNull();
    });

    it('worker configuration failed', async () => {
        const memory = new AsyncDataFrameRegistry(logger);
        const state = createComputationState();
        const error = new Error('test error');
        const action: ComputationAction = {
            type: COMPUTATION_WORKER_CONFIGURATION_FAILED,
            value: error,
        };
        const output = reduceComputationState(state, action, memory, logger);
        expect(output.computationWorkerSetupError).toBe(error);
    });

    it('computation from query result', async () => {
        const memory = new AsyncDataFrameRegistry(logger);
        const worker = await instantiateTestWorker(wasmPath, logger);
        const state = createComputationState(worker);
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

    it('delete computation', async () => {
        const memory = new AsyncDataFrameRegistry(logger);
        const worker = await instantiateTestWorker(wasmPath, logger);
        const state = createComputationState(worker);
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
        // Check scheduling and updates of filtering tasks
        it('filtering task', async () => {
            const memory = new AsyncDataFrameRegistry(logger);
            const worker = await instantiateTestWorker(wasmPath, logger);
            const inputDataFrame = await worker.createDataFrameFromTable(inputTable);

            // Create the computation state
            let state = createComputationState(worker);
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42
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
                            buf.create(pb.dashql.compute.FilterTransformSchema, {
                                fieldName: 'score',
                                operator: pb.dashql.compute.FilterOperator.LessThanLiteral,
                                literalDouble: 20,
                            }),
                        ],
                    },
                    result: new AsyncValue<FilterTable | null, LoggableException>(),
                },
            };

            // Schedule the task in the computation state
            state = reduceComputationState(state, schedulingAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(TABLE_FILTERING_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.filteringTask).toBeDefined();
            expect(state.tableComputations[1].tasks.filteringTask?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.filteringTask?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.filteringTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            expect(inputRefCount).toEqual(2);

            // Update the scheduler task progress
            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[42], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(TABLE_FILTERING_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.filteringTask).toBeDefined();
            expect(state.tableComputations[1].tasks.filteringTask?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.filteringTask?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.filteringTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            expect(inputRefCount).toEqual(2);

            // Delete the scheduler task
            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory, logger);

            // The scheduler tasks should now be empty.
            // But the registered data frames should still be one since the data frame is still registered for the table computation state.
            // The filtering task should still be present in the table computation state.
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.filteringTask).not.toBeNull();

            inputDataFrame.destroy();
        });

        // Check scheduling and updates of ordering tasks
        it('ordering task', async () => {
            const memory = new AsyncDataFrameRegistry(logger);
            const worker = await instantiateTestWorker(wasmPath, logger);
            const inputDataFrame = await worker.createDataFrameFromTable(inputTable);

            // Create the computation state
            let state = createComputationState(worker);
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42
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
                            buf.create(pb.dashql.compute.OrderByConstraintSchema, {
                                fieldName: 'score',
                                ascending: false,
                                nullsFirst: false,
                            }),
                        ],
                    },
                    result: new AsyncValue<OrderedTable, LoggableException>(),
                },
            };

            // Schedule the task in the computation state
            state = reduceComputationState(state, schedulingAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(TABLE_ORDERING_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.orderingTask).toBeDefined();
            expect(state.tableComputations[1].tasks.orderingTask?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.orderingTask?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.orderingTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            expect(inputRefCount).toEqual(2);

            // Update the scheduler task progress
            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[42], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(TABLE_ORDERING_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.orderingTask).toBeDefined();
            expect(state.tableComputations[1].tasks.orderingTask?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.orderingTask?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.orderingTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            expect(inputRefCount).toEqual(2);

            // Delete the scheduler task
            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory, logger);

            // The scheduler tasks should now be empty.
            // But the registered data frames should still be one since the data frame is still registered for the table computation state.
            // The ordering task should still be present in the table computation state.
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.orderingTask).not.toBeNull();

            inputDataFrame.destroy();
        });

        it('table aggregation task', async () => {
            const memory = new AsyncDataFrameRegistry(logger);
            const worker = await instantiateTestWorker(wasmPath, logger);
            const inputDataFrame = await worker.createDataFrameFromTable(inputTable);

            // Create the computation state
            let state = createComputationState(worker);
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42
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

            // Schedule the task in the computation state
            state = reduceComputationState(state, schedulingAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(TABLE_AGGREGATION_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.tableAggregationTask).toBeDefined();
            expect(state.tableComputations[1].tasks.tableAggregationTask?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.tableAggregationTask?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.tableAggregationTask?.columnEntries).toEqual(inputTableColumns);
            expect(state.tableComputations[1].tasks.tableAggregationTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            expect(inputRefCount).toEqual(2);

            // Update the scheduler task progress
            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[42], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(TABLE_AGGREGATION_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.tableAggregationTask).toBeDefined();
            expect(state.tableComputations[1].tasks.tableAggregationTask?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.tableAggregationTask?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.tableAggregationTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            expect(inputRefCount).toEqual(2);

            // Delete the scheduler task
            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory, logger);

            // The scheduler tasks should now be empty.
            // But the registered data frames should still be one since the data frame is still registered for the table computation state.
            // The table aggregation task should still be present in the table computation state.
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(1);
            expect(state.tableComputations[1].tasks.tableAggregationTask).not.toBeNull();

            inputDataFrame.destroy();
        });

        it('system column computation task', async () => {
            const memory = new AsyncDataFrameRegistry(logger);
            const worker = await instantiateTestWorker(wasmPath, logger);
            const inputDataFrame = await worker.createDataFrameFromTable(inputTable);
            const aggregateDataFrame = await worker.createDataFrameFromTable(aggregateTable);

            // Create the computation state
            let state = createComputationState(worker);
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42
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
                    result: new AsyncValue<[arrow.Table, AsyncDataFrame, ColumnGroup[]], LoggableException>(),
                },
            };

            // Schedule the task in the computation state
            state = reduceComputationState(state, schedulingAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(SYSTEM_COLUMN_COMPUTATION_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.systemColumnTask).toBeDefined();
            expect(state.tableComputations[1].tasks.systemColumnTask?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.systemColumnTask?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.systemColumnTask?.columnEntries).toEqual(inputTableColumns);
            expect(state.tableComputations[1].tasks.systemColumnTask?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            let aggregateRefCount = memory.getRegisteredDataFrames().get(aggregateDataFrame);
            expect(inputRefCount).toEqual(2);
            expect(aggregateRefCount).toEqual(2);

            // Update the scheduler task progress
            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[42], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(SYSTEM_COLUMN_COMPUTATION_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.systemColumnTask).toBeDefined();
            expect(state.tableComputations[1].tasks.systemColumnTask?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.systemColumnTask?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.systemColumnTask?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            aggregateRefCount = memory.getRegisteredDataFrames().get(aggregateDataFrame);
            expect(inputRefCount).toEqual(2);
            expect(aggregateRefCount).toEqual(2);

            // Delete the scheduler task
            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory, logger);

            // The scheduler tasks should now be empty.
            // But the registered data frames should still be one since the data frame is still registered for the table computation state.
            // The system column task should still be present in the table computation state.
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(state.tableComputations[1].tasks.systemColumnTask).not.toBeNull();

            inputDataFrame.destroy();
            aggregateDataFrame.destroy();
        });

        it('column aggregation task', async () => {
            const memory = new AsyncDataFrameRegistry(logger);
            const worker = await instantiateTestWorker(wasmPath, logger);
            const inputDataFrame = await worker.createDataFrameFromTable(inputTable);
            const aggregateDataFrame = await worker.createDataFrameFromTable(aggregateTable);

            // Create the computation state
            let state = createComputationState(worker);
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42
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

            // Schedule the task in the computation state
            state = reduceComputationState(state, schedulingAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(COLUMN_AGGREGATION_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]).toBeDefined();
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            let aggregateRefCount = memory.getRegisteredDataFrames().get(aggregateDataFrame);
            expect(inputRefCount).toEqual(2);
            expect(aggregateRefCount).toEqual(2);

            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[42], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(COLUMN_AGGREGATION_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]).toBeDefined();
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            aggregateRefCount = memory.getRegisteredDataFrames().get(aggregateDataFrame);
            expect(inputRefCount).toEqual(2);
            expect(aggregateRefCount).toEqual(2);

            // Delete the scheduler task
            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory, logger);

            // The scheduler tasks should now be empty.
            // But the registered data frames should still be one since the data frame is still registered for the table computation state.
            // The column aggregation task should still be present in the table computation state.
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(2);
            expect(state.tableComputations[1].tasks.columnAggregationTasks[1]).not.toBeNull();

            inputDataFrame.destroy();
            aggregateDataFrame.destroy();
        });

        it('filtered column aggregation task', async () => {
            const memory = new AsyncDataFrameRegistry(logger);
            const worker = await instantiateTestWorker(wasmPath, logger);
            const inputDataFrame = await worker.createDataFrameFromTable(inputTable);
            const tableAggregateDataFrame = await worker.createDataFrameFromTable(aggregateTable);
            const scoreAggregateDataFrame = await worker.createDataFrameFromTable(scoreAggregateTable);
            const filterDataFrame = await worker.createDataFrameFromTable(filterTable);

            // Create the computation state
            let state = createComputationState(worker);
            state.tableComputations[1] = createTableComputationState(1, inputTable, inputTableColumns, new AbortController());
            state.tableComputations[1].dataFrame = inputDataFrame;
            state.nextSchedulerTaskId = 42
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
            const orginalColumnAggregation: ColumnAggregationVariant = {
                type: ORDINAL_COLUMN,
                value: {
                    columnEntry: (inputTableColumns[1].value as OrdinalGridColumnGroup),
                    binnedDataFrame: tableAggregateDataFrame,
                    binnedValues: scoreAggregateTable as unknown as BinnedValuesTable<arrow.DataType<arrow.Type, any>, arrow.DataType<arrow.Type, any>>,
                    binnedValuesFormatter: aggregateTableFormatter,
                    columnAnalysis: ordinalColumnAnalysis,
                },
            };

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
                            type: ORDINAL_COLUMN,
                            value: {
                                columnEntry: (inputTableColumns[1].value as OrdinalGridColumnGroup),
                                binnedDataFrame: scoreAggregateDataFrame,
                                binnedValues: scoreAggregateTable as unknown as BinnedValuesTable<arrow.DataType<arrow.Type, any>, arrow.DataType<arrow.Type, any>>,
                                binnedValuesFormatter: scoreAggregateTableFormatter,
                                columnAnalysis: ordinalColumnAnalysis,
                            },
                        },
                    },
                    result: new AsyncValue<WithFilterEpoch<ColumnAggregationVariant> | null, LoggableException>(),
                },
            };

            // Schedule the task in the computation state
            state = reduceComputationState(state, schedulingAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(FILTERED_COLUMN_AGGREGATION_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]).toBeDefined();
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_RUNNING);
            expect(memory.getRegisteredDataFrames().size).toEqual(4);

            // The refcount should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            let inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            let filterRefCount = memory.getRegisteredDataFrames().get(filterDataFrame);
            let tableAggregateRefCount = memory.getRegisteredDataFrames().get(tableAggregateDataFrame);
            let columnAggregateRefCount = memory.getRegisteredDataFrames().get(scoreAggregateDataFrame);
            expect(inputRefCount).toEqual(2);
            expect(filterRefCount).toEqual(2);
            expect(tableAggregateRefCount).toEqual(2);
            expect(columnAggregateRefCount).toEqual(2);

            // Update the scheduler task progress
            const updateAction: ComputationAction = {
                type: UPDATE_SCHEDULER_TASK,
                value: [state.schedulerTasks[42], {
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }],
            };
            state = reduceComputationState(state, updateAction, memory, logger);
            expect(Object.entries(state.schedulerTasks).length).toEqual(1);
            expect(state.schedulerTasks[42].type).toEqual(FILTERED_COLUMN_AGGREGATION_TASK);
            expect(state.schedulerTasks[42].value).toEqual(schedulingAction.value.value);
            expect(state.schedulerTasks[42].taskId).toEqual(42);
            expect(state.nextSchedulerTaskId).toEqual(43);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]).toBeDefined();
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.tableId).toEqual(1);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.tableEpoch).toEqual(20);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]?.progress.status).toEqual(TaskStatus.TASK_SUCCEEDED);
            expect(memory.getRegisteredDataFrames().size).toEqual(4);

            // The refcounts should be 2 since we acquire the data frame twice for scheduler tasks and the computation state
            inputRefCount = memory.getRegisteredDataFrames().get(inputDataFrame);
            filterRefCount = memory.getRegisteredDataFrames().get(filterDataFrame);
            tableAggregateRefCount = memory.getRegisteredDataFrames().get(tableAggregateDataFrame);
            columnAggregateRefCount = memory.getRegisteredDataFrames().get(scoreAggregateDataFrame);
            expect(inputRefCount).toEqual(2);
            expect(filterRefCount).toEqual(2);
            expect(tableAggregateRefCount).toEqual(2);
            expect(columnAggregateRefCount).toEqual(2);

            // Delete the scheduler task
            const deleteTask: ComputationAction = {
                type: UNREGISTER_SCHEDULER_TASK,
                value: state.schedulerTasks[42],
            };
            state = reduceComputationState(state, deleteTask, memory, logger);

            // The scheduler tasks should now be empty.
            // But the registered data frames should still be one since the data frame is still registered for the table computation state.
            // The system column task should still be present in the table computation state.
            expect(Object.entries(state.schedulerTasks).length).toEqual(0);
            expect(memory.getRegisteredDataFrames().size).toEqual(4);
            expect(state.tableComputations[1].tasks.filteredColumnAggregationTasks[1]).not.toBeNull();

            inputDataFrame.destroy();
            filterDataFrame.destroy();
            tableAggregateDataFrame.destroy();
            scoreAggregateDataFrame.destroy();
        });
    });
});
