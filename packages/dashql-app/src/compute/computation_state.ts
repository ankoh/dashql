import * as arrow from 'apache-arrow';
import * as pb from '@ankoh/dashql-protobuf';

import { ColumnAggregationVariant, TableAggregationTask, TableOrderingTask, TableAggregation, TaskProgress, ColumnGroup, SystemColumnComputationTask, FilterTable, ROWNUMBER_COLUMN, ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, SKIPPED_COLUMN, ColumnAggregationTask, OrderedTable, TableFilteringTask, WithProgress, TaskStatus, WithFilter, WithFilterEpoch } from './computation_types.js';
import { VariantKind } from '../utils/variant.js';
import { AsyncDataFrame, AsyncDataFrameRegistry, ComputeWorkerBindings } from './compute_worker_bindings.js';
import { LoggableException, Logger } from '../platform/logger.js';
import { COLUMN_AGGREGATION_TASK, FILTERED_COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK, TaskVariant } from './computation_scheduler.js';
import { AsyncValue } from '../utils/async_value.js';

const LOG_CTX = 'computation_state';

/// The table computation state
export interface TableComputationState {
    /// The table id
    tableId: number;
    /// The table epoch
    tableEpoch: number;
    /// The tasks
    tasks: TableComputationTasks;

    /// The table on the main thread
    dataTable: arrow.Table;
    /// The table field index
    dataTableFieldsByName: Map<string, number>;
    /// The abort controller
    dataTableLifetime: AbortController;
    /// The data frame in the compute module
    dataFrame: AsyncDataFrame | null;
    /// The grid columns
    columnGroups: ColumnGroup[];
    /// The ordering constraints
    dataTableOrdering: pb.dashql.compute.OrderByConstraint[];

    /// The active filter table (if any)
    filterTable: FilterTable | null;
    /// The row number column group
    rowNumberColumnGroup: number | null;
    /// The row number column name
    rowNumberColumnName: string | null;
    /// The table aggregation
    tableAggregation: TableAggregation | null;
    /// The column (group) aggregates
    columnAggregates: (ColumnAggregationVariant | null)[];
    /// The filtered column (group) aggregates
    filteredColumnAggregates: (WithFilterEpoch<ColumnAggregationVariant> | null)[];
}

export interface TableComputationTasks {
    /// The table aggregation task
    tableAggregationTask: WithProgress<TableAggregationTask> | null;
    /// The task to precompute system columns
    systemColumnTask: WithProgress<SystemColumnComputationTask> | null;
    /// The filtering task
    filteringTask: WithProgress<TableFilteringTask> | null;
    /// The ordering task
    orderingTask: WithProgress<TableOrderingTask> | null;
    /// The task to compute column (group) aggregates.
    /// The array contains N entries where N is the number of column groups
    columnAggregationTasks: (WithProgress<ColumnAggregationTask> | null)[];
    /// The task to compute filtered column (group) aggregates
    filteredColumnAggregationTasks: (WithProgress<WithFilter<ColumnAggregationTask>> | null)[];
}

/// The computation registry.
/// We store the scheduler tasks here as well to allow for linking the "latest" tasks safely in the per-table computation states.
export interface ComputationState {
    /// The computation worker
    computationWorker: ComputeWorkerBindings | null;
    /// The computation worker error
    computationWorkerSetupError: Error | null;
    /// The computations
    tableComputations: { [key: number]: TableComputationState };

    /// The scheduler tasks
    schedulerTasks: { [key: number]: TaskVariant };
    /// The next task id
    nextSchedulerTaskId: number;
}

/// Create the computation state
export function createComputationState(computeWorker: ComputeWorkerBindings | null = null): ComputationState {
    return {
        computationWorker: computeWorker,
        computationWorkerSetupError: null,
        tableComputations: {},
        schedulerTasks: {},
        nextSchedulerTaskId: 1,
    };
}

export function createArrowFieldIndex(table: arrow.Table): Map<string, number> {
    let out = new Map<string, number>();
    for (let i = 0; i < table.schema.fields.length; ++i) {
        out.set(table.schema.fields[i].name, i);
    }
    return out;
}

/// Create the table computation state
export function createTableComputationState(computationId: number, table: arrow.Table, tableColumns: ColumnGroup[], tableLifetime: AbortController): TableComputationState {
    return {
        tableId: computationId,
        tableEpoch: 1,
        tasks: {
            filteringTask: null,
            orderingTask: null,
            tableAggregationTask: null,
            systemColumnTask: null,
            columnAggregationTasks: Array(tableColumns.length + 1).fill(null),
            filteredColumnAggregationTasks: Array(tableColumns.length + 1).fill(null),
        },
        dataTable: table,
        dataTableFieldsByName: createArrowFieldIndex(table),
        columnGroups: tableColumns,
        columnAggregates: Array.from({ length: tableColumns.length }, () => null),
        rowNumberColumnGroup: null,
        rowNumberColumnName: null,
        dataTableLifetime: tableLifetime,
        dataTableOrdering: [],
        dataFrame: null,
        filterTable: null,
        filteredColumnAggregates: Array.from({ length: tableColumns.length }, () => null),
        tableAggregation: null,
    };
}

export const COMPUTATION_WORKER_CONFIGURED = Symbol('REGISTER_COMPUTATION');
export const COMPUTATION_WORKER_CONFIGURATION_FAILED = Symbol('COMPUTATION_WORKER_SETUP_FAILED');
export const COMPUTATION_FROM_QUERY_RESULT = Symbol('COMPUTATION_FROM_QUERY_RESULT');
export const DELETE_COMPUTATION = Symbol('DELETE_COMPUTATION');
export const CREATED_DATA_FRAME = Symbol('CREATED_DATA_FRAME');
export const SCHEDULE_TASK = Symbol('SCHEDULE_TASK');
export const UPDATE_SCHEDULER_TASK = Symbol('UPDATE_SCHEDULER_TASK');
export const UNREGISTER_SCHEDULER_TASK = Symbol('UNREGISTER_SCHEDULER_TASK');
export const TABLE_ORDERING_SUCCEDED = Symbol('TABLE_ORDERING_SUCCEDED');
export const TABLE_FILTERING_SUCCEEDED = Symbol('TABLE_FILTERING_SUCCEEDED');
export const TABLE_AGGREGATION_SUCCEEDED = Symbol('TABLE_AGGREGATION_SUCCEEDED');
export const SYSTEM_COLUMN_COMPUTATION_SUCCEEDED = Symbol('SYSTEM_COLUMN_COMPUTATION_SUCCEEDED');
export const COLUMN_AGGREGATION_SUCCEEDED = Symbol('COLUMN_AGGREGATION_SUCCEEDED');
export const FILTERED_COLUMN_AGGREGATION_SUCCEEDED = Symbol('FILTERED_COLUMN_AGGREGATION_SUCCEEDED');

export type ComputationAction =
    | VariantKind<typeof COMPUTATION_WORKER_CONFIGURED, ComputeWorkerBindings>
    | VariantKind<typeof COMPUTATION_WORKER_CONFIGURATION_FAILED, Error | null>

    | VariantKind<typeof SCHEDULE_TASK, TaskVariant>
    | VariantKind<typeof UPDATE_SCHEDULER_TASK, [TaskVariant, Partial<TaskProgress>]>
    | VariantKind<typeof UNREGISTER_SCHEDULER_TASK, TaskVariant>

    | VariantKind<typeof COMPUTATION_FROM_QUERY_RESULT, [number, arrow.Table, ColumnGroup[], AbortController]>
    | VariantKind<typeof DELETE_COMPUTATION, [number]>
    | VariantKind<typeof CREATED_DATA_FRAME, [number, AsyncDataFrame]>

    | VariantKind<typeof TABLE_ORDERING_SUCCEDED, [number, OrderedTable]>
    | VariantKind<typeof TABLE_FILTERING_SUCCEEDED, [number, FilterTable | null]>
    | VariantKind<typeof TABLE_AGGREGATION_SUCCEEDED, [number, TableAggregation]>
    | VariantKind<typeof SYSTEM_COLUMN_COMPUTATION_SUCCEEDED, [number, arrow.Table, AsyncDataFrame, ColumnGroup[]]>
    | VariantKind<typeof COLUMN_AGGREGATION_SUCCEEDED, [number, number, ColumnAggregationVariant]>
    | VariantKind<typeof FILTERED_COLUMN_AGGREGATION_SUCCEEDED, [number, number, WithFilterEpoch<ColumnAggregationVariant> | null]>
    ;

export function reduceComputationState(state: ComputationState, action: ComputationAction, memory: AsyncDataFrameRegistry, logger: Logger): ComputationState {
    switch (action.type) {
        case COMPUTATION_WORKER_CONFIGURED:
            return {
                ...state,
                computationWorker: action.value,
            };
        case COMPUTATION_WORKER_CONFIGURATION_FAILED:
            return {
                ...state,
                computationWorkerSetupError: action.value,
            };

        case SCHEDULE_TASK: {
            const taskVariant = action.value;
            const initialProgress: TaskProgress = {
                status: TaskStatus.TASK_RUNNING,
                startedAt: new Date(),
                completedAt: null,
                failedAt: null,
                failedWithError: null,
            };
            return updateTask(state, taskVariant, initialProgress, memory, true);
        }
        case UPDATE_SCHEDULER_TASK: {
            const [taskVariant, progress] = action.value;
            return updateTask(state, taskVariant, progress, memory, false);
        }
        case UNREGISTER_SCHEDULER_TASK: {
            if (action.value.taskId === undefined) {
                return state;
            }
            const schedulerTasks = { ...state.schedulerTasks };
            delete schedulerTasks[action.value.taskId];
            return {
                ...state,
                schedulerTasks
            };
        }

        case COMPUTATION_FROM_QUERY_RESULT: {
            const [tableId, table, tableColumns, tableLifetime] = action.value;
            const tableState = createTableComputationState(tableId, table, tableColumns, tableLifetime);
            return {
                ...state,
                tableComputations: {
                    ...state.tableComputations,
                    [tableId]: tableState
                }
            };
        }
        case DELETE_COMPUTATION: {
            const [tableId] = action.value;
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                return state;
            }
            const tableComputations = { ...state.tableComputations };
            destroyTableComputationState(tableState, memory);
            delete tableComputations[tableId];
            return {
                ...state,
                tableComputations
            };
        }
        case CREATED_DATA_FRAME: {
            const [tableId, dataFrame] = action.value;
            memory.acquire(dataFrame);

            const prevTableState = state.tableComputations[tableId]!;
            const nextTableState: TableComputationState = {
                ...prevTableState,
                tableEpoch: prevTableState.tableEpoch + 1,
                dataFrame,
            };
            memory.release(prevTableState.dataFrame);
            return {
                ...state,
                tableComputations: {
                    ...state.tableComputations,
                    [tableId]: nextTableState
                }
            };
        }
        case TABLE_ORDERING_SUCCEDED: {
            const [tableId, orderedTable] = action.value;
            memory.acquire(orderedTable.dataFrame);

            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                orderedTable.dataFrame.destroy();
                return state;
            }
            memory.release(tableState.dataFrame);

            const task = !tableState.tasks.orderingTask ? null : {
                ...tableState.tasks.orderingTask,
                progress: {
                    ...tableState.tasks.orderingTask.progress,
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }
            };
            return {
                ...state,
                tableComputations: {
                    ...state.tableComputations,
                    [tableId]: {
                        ...tableState,
                        tableEpoch: tableState.tableEpoch + 1,
                        dataFrame: orderedTable.dataFrame,
                        dataTable: orderedTable.dataTable,
                        dataTableOrdering: orderedTable.orderingConstraints,
                        tasks: {
                            ...tableState.tasks,
                            orderingTask: task
                        }
                    }
                }
            };
        }
        case TABLE_FILTERING_SUCCEEDED: {
            const [tableId, filterTable] = action.value;
            memory.acquire(filterTable?.dataFrame);
            return tableFilteringSucceded(state, tableId, filterTable, memory);
        }
        case TABLE_AGGREGATION_SUCCEEDED: {
            const [tableId, tableAggregation] = action.value;
            memory.acquire(tableAggregation.dataFrame);

            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                tableAggregation.dataFrame.destroy();
                return state;
            }
            memory.release(tableState.tableAggregation?.dataFrame);

            const task = !tableState.tasks.tableAggregationTask ? null : {
                ...tableState.tasks.tableAggregationTask,
                progress: {
                    ...tableState.tasks.tableAggregationTask.progress,
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }
            };
            return {
                ...state,
                tableComputations: {
                    ...state.tableComputations,
                    [tableId]: {
                        ...tableState,
                        tableEpoch: tableState.tableEpoch + 1,
                        tableAggregation: tableAggregation,
                        tasks: {
                            ...tableState.tasks,
                            tableAggregationTask: task,
                        }
                    }
                }
            };
        }
        case SYSTEM_COLUMN_COMPUTATION_SUCCEEDED: {
            const [tableId, dataTable, dataFrame, columnGroups] = action.value;
            memory.acquire(dataFrame);

            let rowNumberColumnGroup: number | null = null;
            let rowNumberColumnName: string | null = null;
            for (let i = 0; i < columnGroups.length; ++i) {
                const group = columnGroups[i];
                switch (group.type) {
                    case ROWNUMBER_COLUMN:
                        rowNumberColumnGroup = i;
                        rowNumberColumnName = group.value.rowNumberFieldName;
                        break;
                }
            }
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                memory.release(dataFrame);
                return state;
            }
            memory.release(tableState.dataFrame);

            const task = !tableState.tasks.systemColumnTask ? null : {
                ...tableState.tasks.systemColumnTask,
                progress: {
                    ...tableState.tasks.systemColumnTask.progress,
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }
            };
            return {
                ...state,
                tableComputations: {
                    ...state.tableComputations,
                    [tableId]: {
                        ...tableState,
                        tableEpoch: tableState.tableEpoch + 1,
                        dataTable,
                        dataFrame,
                        columnGroups,
                        rowNumberColumnGroup,
                        rowNumberColumnName,
                        tasks: {
                            ...tableState.tasks,
                            systemColumnTask: task,
                        }
                    }
                }
            };
        }
        case COLUMN_AGGREGATION_SUCCEEDED: {
            const [tableId, columnId, columnAggregate] = action.value;
            acquireColumnAggregate(columnAggregate, memory);

            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                releaseColumnAggregate(columnAggregate, memory);
                return state;
            }
            // Column aggregation unknown?
            const currentTask = tableState.tasks.columnAggregationTasks[columnId];
            if (currentTask == null) {
                releaseColumnAggregate(columnAggregate, memory);
                return state;
            }
            // Destroy the previous column aggregate, if there is one
            const prevAggregate = tableState.columnAggregates[columnId];
            if (prevAggregate != null) {
                releaseColumnAggregate(prevAggregate, memory);
            }
            const columnAggregates: (ColumnAggregationVariant | null)[] = [...tableState.columnAggregates];
            const columnAggregationTasks = [...tableState.tasks.columnAggregationTasks];
            columnAggregates[columnId] = columnAggregate;
            const aggregationTask: WithProgress<ColumnAggregationTask> = {
                ...currentTask,
                progress: {
                    ...currentTask.progress,
                    completedAt: new Date(),
                    status: TaskStatus.TASK_SUCCEEDED,
                }
            };
            columnAggregationTasks[columnId] = aggregationTask;

            return {
                ...state,
                tableComputations: {
                    ...tableState,
                    [tableId]: {
                        ...tableState,
                        tableEpoch: tableState.tableEpoch + 1,
                        columnAggregates,
                        tasks: {
                            ...tableState.tasks,
                            columnAggregationTasks
                        }
                    }
                }
            };
        }
        case FILTERED_COLUMN_AGGREGATION_SUCCEEDED: {
            const [tableId, columnId, newColumnAggregate] = action.value;
            acquireColumnAggregate(newColumnAggregate, memory);

            // Computation not registered?
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                releaseColumnAggregate(newColumnAggregate, memory);
                return state;
            }
            // Column aggregation task unknown?
            const currentTask = tableState.tasks.filteredColumnAggregationTasks[columnId];
            if (currentTask == null) {
                releaseColumnAggregate(newColumnAggregate, memory);
                return state;
            }

            const filteredColumnAggregates: (WithFilterEpoch<ColumnAggregationVariant> | null)[] = [...tableState.filteredColumnAggregates];
            const filteredColumnAggregationTasks = [...tableState.tasks.filteredColumnAggregationTasks];
            const prevColumnAggregate = filteredColumnAggregates[columnId];
            filteredColumnAggregates[columnId] = newColumnAggregate;
            const task: WithProgress<WithFilter<ColumnAggregationTask>> = {
                ...currentTask,
                progress: {
                    ...currentTask.progress,
                    completedAt: new Date(),
                    status: TaskStatus.TASK_SUCCEEDED,
                }
            };
            filteredColumnAggregationTasks[columnId] = task;

            // Check if the filtered column aggregation is already outdated.
            // That can happen if the filter was updated in the meantime
            let newColumnAggregationTask: WithProgress<WithFilter<ColumnAggregationTask>> | null = null;
            let newBackgroundTask: TaskVariant | null = null;
            let newBackgroundTasks = state.schedulerTasks;

            const filterEpoch = tableState.filterTable?.tableEpoch ?? null;
            const taskEpoch = task.tableEpoch;
            if ((filterEpoch != null)
                && (taskEpoch != null)
                && (taskEpoch < filterEpoch)
                && (tableState.filterTable != null)
                && (tableState.dataFrame != null)
                && (tableState.columnAggregates[columnId] != null)) {

                // Update the filter
                let nextBackroundTaskId = state.nextSchedulerTaskId;
                newColumnAggregationTask = {
                    ...task,
                    tableEpoch: tableState.tableEpoch,
                    inputDataFrame: tableState.dataFrame,
                    filterTable: tableState.filterTable,
                    unfilteredAggregate: tableState.columnAggregates[columnId],
                    progress: {
                        status: TaskStatus.TASK_RUNNING,
                        startedAt: new Date(),
                        completedAt: null,
                        failedAt: null,
                        failedWithError: null,
                    }
                };
                newBackgroundTask = {
                    type: FILTERED_COLUMN_AGGREGATION_TASK,
                    value: newColumnAggregationTask,
                    result: new AsyncValue<WithFilterEpoch<ColumnAggregationVariant> | null, LoggableException>(),
                    taskId: nextBackroundTaskId,
                };
                newBackgroundTasks = {
                    ...state.schedulerTasks,
                    [nextBackroundTaskId]: newBackgroundTask!
                };
                filteredColumnAggregationTasks[columnId] = newColumnAggregationTask;

                logger.debug("updating outdated column aggregate", {
                    tableId: tableId.toString(),
                    columnId: columnId.toString(),
                }, LOG_CTX);

            } else if (tableState.filterTable == null) {

                // We computed a column aggregation, but the filter was removed in the meantime.
                // Clear the filtered column aggregates.
                releaseColumnAggregate(newColumnAggregate, memory);
                filteredColumnAggregates[columnId] = null;
                filteredColumnAggregationTasks[columnId] = null;
            }

            // Destroy the previous column aggregate, if there is one
            if (prevColumnAggregate != null) {
                releaseColumnAggregate(prevColumnAggregate, memory);
            }
            return {
                ...state,
                tableComputations: {
                    ...tableState,
                    [tableId]: {
                        ...tableState,
                        tableEpoch: tableState.tableEpoch + 1,
                        filteredColumnAggregates,
                        tasks: {
                            ...tableState.tasks,
                            filteredColumnAggregationTasks
                        }
                    }
                },
                schedulerTasks: newBackgroundTasks
            };
        }
    }
}

function updateTask(state: ComputationState, task: TaskVariant, progress: Partial<TaskProgress>, memory: AsyncDataFrameRegistry, create: boolean = false) {
    const allocatedTaskId = task.taskId !== undefined;
    if (!allocatedTaskId) {
        task = {
            ...task,
            taskId: state.nextSchedulerTaskId,
        };
    }
    const tableState = state.tableComputations[task.value.tableId];
    if (tableState === undefined) {
        return state;
    }
    // Note that we acquire data frames times twice for scheduler task and table computation state
    let registerTask: (tasks: TableComputationTasks) => TableComputationTasks = (t: TableComputationTasks) => t;
    switch (task.type) {
        case TABLE_FILTERING_TASK:
            if (create) {
                memory.acquire(task.value.inputDataFrame, 2);
            }
            registerTask = (tasks: TableComputationTasks) => {
                return ({
                    ...tasks,
                    filteringTask: {
                        ...task.value,
                        progress: {
                            ...tasks.filteringTask?.progress,
                            ...progress,
                        } as TaskProgress,
                    }
                });
            };
            break;
        case TABLE_ORDERING_TASK:
            if (create) {
                memory.acquire(task.value.inputDataFrame, 2);
            }
            registerTask = (tasks: TableComputationTasks) => {
                return ({
                    ...tasks,
                    orderingTask: {
                        ...task.value,
                        progress: {
                            ...tasks.orderingTask?.progress,
                            ...progress,
                        } as TaskProgress,
                    }
                });
            };
            break;
        case TABLE_AGGREGATION_TASK:
            if (create) {
                memory.acquire(task.value.inputDataFrame, 2);
            }
            registerTask = (tasks: TableComputationTasks) => {
                return ({
                    ...tasks,
                    tableAggregationTask: {
                        ...task.value,
                        progress: {
                            ...tasks.tableAggregationTask?.progress,
                            ...progress,
                        } as TaskProgress,
                    }
                });
            };
            break;
        case SYSTEM_COLUMN_COMPUTATION_TASK:
            if (create) {
                memory.acquire(task.value.inputDataFrame, 2);
                memory.acquire(task.value.tableAggregate.dataFrame, 2);
            }
            registerTask = (tasks: TableComputationTasks) => {
                return ({
                    ...tasks,
                    systemColumnTask: {
                        ...task.value,
                        progress: {
                            ...tasks.systemColumnTask?.progress,
                            ...progress,
                        } as TaskProgress,
                    }
                });
            };
            break;
        case COLUMN_AGGREGATION_TASK:
            if (create) {
                memory.acquire(task.value.inputDataFrame, 2);
                memory.acquire(task.value.tableAggregate.dataFrame, 2);
            }
            registerTask = (tasks: TableComputationTasks) => {
                const prev = tasks.columnAggregationTasks[task.value.columnId];
                const updated = [...tasks.columnAggregationTasks];
                updated[task.value.columnId] = {
                    ...task.value,
                    progress: {
                        ...prev?.progress,
                        ...progress
                    } as TaskProgress
                };
                return ({
                    ...tasks,
                    columnAggregationTasks: updated
                })
            };
            break;
        case FILTERED_COLUMN_AGGREGATION_TASK:
            if (create) {
                memory.acquire(task.value.inputDataFrame, 2);
                memory.acquire(task.value.filterTable.dataFrame, 2);
                memory.acquire(task.value.tableAggregate.dataFrame, 2);
                acquireColumnAggregate(task.value.unfilteredAggregate, memory, 2);
            }
            registerTask = (tasks: TableComputationTasks) => {
                const prev = tasks.filteredColumnAggregationTasks[task.value.columnId];
                const updated = [...tasks.filteredColumnAggregationTasks];
                updated[task.value.columnId] = {
                    ...task.value,
                    progress: {
                        ...prev?.progress,
                        ...progress
                    } as TaskProgress
                };
                return ({
                    ...tasks,
                    filteredColumnAggregationTasks: updated
                })
            };
            break;
    }
    const updatedTaskId = task.taskId!;
    const updatedState: ComputationState = {
        ...state,
        nextSchedulerTaskId: (!allocatedTaskId) ? (state.nextSchedulerTaskId + 1) : state.nextSchedulerTaskId,
        schedulerTasks: {
            ...state.schedulerTasks,
            [updatedTaskId]: task
        },
        tableComputations: {
            ...state.tableComputations,
            [task.value.tableId]: {
                ...tableState,
                tasks: registerTask(tableState.tasks)
            }
        }
    };
    return updatedState;
}

function tableFilteringSucceded(state: ComputationState, tableId: number, filterTable: FilterTable | null, memory: AsyncDataFrameRegistry) {
    const tableState = state.tableComputations[tableId];
    if (tableState === undefined) {
        memory.release(filterTable?.dataFrame);
        return state;
    }

    // Create filtering task
    const filteringTask = !tableState.tasks.filteringTask ? null : {
        ...tableState.tasks.filteringTask,
        progress: {
            ...tableState.tasks.filteringTask.progress,
            status: TaskStatus.TASK_SUCCEEDED,
            completedAt: new Date(),
        }
    };
    const tableAggregate = tableState.tableAggregation!;
    const inputDataFrame = tableState.dataFrame!;
    const obsoleteFilteredColumnAggregates: Map<number, WithFilterEpoch<ColumnAggregationVariant> | null> = new Map();
    const newFilteredColumnAggregationTasks: Map<number, WithProgress<WithFilter<ColumnAggregationTask>> | null> = new Map();

    if (filterTable == null) {
        // Clear column aggregates - track existing ones for release
        for (let columnId = 0; columnId < tableState.filteredColumnAggregates.length; ++columnId) {
            const prevAggregate = tableState.filteredColumnAggregates[columnId];
            if (prevAggregate != null) {
                obsoleteFilteredColumnAggregates.set(columnId, prevAggregate);
            }
            newFilteredColumnAggregationTasks.set(columnId, null);
        }

    } else {
        // Create initial column aggregations
        for (let columnId = 0; columnId < tableState.tasks.filteredColumnAggregationTasks.length; ++columnId) {
            // Previous task has up-to-date filter table epoch
            const task = tableState.tasks.filteredColumnAggregationTasks[columnId];
            if ((task !== null) && (filterTable != null) && (filterTable.tableEpoch ?? 0) <= (task.tableEpoch ?? 0)) {
                continue;
            }
            // Skip columns that don't compute a column summary
            const columnEntry = tableState.columnGroups[columnId];
            if (columnEntry.type == SKIPPED_COLUMN || columnEntry.type == ROWNUMBER_COLUMN) {
                continue;
            }
            // Create filtered aggregation task
            const unfilteredAggregate = tableState.columnAggregates[columnId];
            if (unfilteredAggregate != null) {
                const task: WithFilter<ColumnAggregationTask> = {
                    tableId,
                    tableEpoch: tableState.tableEpoch,
                    columnId,
                    tableAggregate,
                    columnEntry,
                    inputDataFrame,
                    filterTable,
                    unfilteredAggregate
                };
                const initialProgress: TaskProgress = {
                    status: TaskStatus.TASK_RUNNING,
                    startedAt: new Date(),
                    completedAt: null,
                    failedAt: null,
                    failedWithError: null,
                };
                const prevFilteredAggregate = tableState.filteredColumnAggregates[columnId];
                if (prevFilteredAggregate != null) {
                    obsoleteFilteredColumnAggregates.set(columnId, prevFilteredAggregate);
                }
                newFilteredColumnAggregationTasks.set(columnId, {
                    ...task,
                    progress: initialProgress
                });

                // Acquired through scheduler task and table computation task state
                memory.acquire(task.inputDataFrame, 2);
                memory.acquire(task.filterTable?.dataFrame, 2);
                memory.acquire(task.tableAggregate.dataFrame, 2);
                acquireColumnAggregate(task.unfilteredAggregate, memory, 2);
            }
        }
    }

    // Collect new filtered aggregates
    let newColumnAggregationTasks = tableState.tasks.filteredColumnAggregationTasks;
    let newBackgroundTasks = state.schedulerTasks;
    let nextBackgroundTaskId = state.nextSchedulerTaskId;

    if (newFilteredColumnAggregationTasks.size > 0) {
        newColumnAggregationTasks = [...tableState.tasks.filteredColumnAggregationTasks];
        newBackgroundTasks = { ...state.schedulerTasks };

        for (const [k, v] of newFilteredColumnAggregationTasks) {
            newColumnAggregationTasks[k] = v;
        }
        for (const [_k, v] of newFilteredColumnAggregationTasks) {
            if (v != null) {
                const taskId = nextBackgroundTaskId++;
                newBackgroundTasks[taskId] = {
                    type: FILTERED_COLUMN_AGGREGATION_TASK,
                    value: v,
                    result: new AsyncValue<WithFilterEpoch<ColumnAggregationVariant> | null, LoggableException>(),
                    taskId,
                };
            }
        }
    }

    // When the filter is cleared, release obsolete aggregates and clear the state.
    // When the filter is active, we deliberately keep old aggregates until new ones are computed.
    // We use the filter epoch to determine that an aggregate is not yet updated.
    let newFilteredColumnAggregates = tableState.filteredColumnAggregates;
    if (filterTable == null) {
        // Release all obsolete filtered column aggregates
        for (const [, prevAggregate] of obsoleteFilteredColumnAggregates.entries()) {
            releaseColumnAggregate(prevAggregate, memory);
        }
        // Clear the filtered column aggregates array
        newFilteredColumnAggregates = Array.from({ length: tableState.filteredColumnAggregates.length }, () => null);
    }

    memory.release(tableState.filterTable?.dataFrame);
    return {
        ...state,
        tableComputations: {
            ...state.tableComputations,
            [tableId]: {
                ...tableState,
                tableEpoch: tableState.tableEpoch + 1,
                filterTable,
                filteredColumnAggregates: newFilteredColumnAggregates,
                tasks: {
                    ...tableState.tasks,
                    filteringTask,
                    filteredColumnAggregationTasks: newColumnAggregationTasks
                }
            }
        },
        schedulerTasks: newBackgroundTasks,
        nextBackgroundTaskId,
    };
}

/// Acquire a column aggregate
function acquireColumnAggregate(aggregate: ColumnAggregationVariant | null | undefined, memory: AsyncDataFrameRegistry, times: number = 1) {
    if (aggregate == null || aggregate == undefined) {
        return;
    }
    switch (aggregate.type) {
        case ORDINAL_COLUMN:
            memory.acquire(aggregate.value.binnedDataFrame, times);
            break;
        case STRING_COLUMN:
            memory.acquire(aggregate.value.frequentValuesDataFrame, times);
            break;
        case LIST_COLUMN:
            memory.acquire(aggregate.value.frequentValuesDataFrame, times);
            break;
        case SKIPPED_COLUMN:
            break;
    }
}

/// Helper to release memory of a column aggregate
function releaseColumnAggregate(aggregate: ColumnAggregationVariant | null | undefined, memory: AsyncDataFrameRegistry) {
    if (aggregate == null || aggregate == undefined) {
        return;
    }
    switch (aggregate.type) {
        case ORDINAL_COLUMN:
            memory.release(aggregate.value.binnedDataFrame);
            break;
        case STRING_COLUMN:
            memory.release(aggregate.value.frequentValuesDataFrame);
            break;
        case LIST_COLUMN:
            memory.release(aggregate.value.frequentValuesDataFrame);
            break;
        case SKIPPED_COLUMN:
            break;
    }
}

/// Helper to release memory of column aggregates
function releaseColumnAggregates(aggregates: (ColumnAggregationVariant | null)[], dataFrameMemory: AsyncDataFrameRegistry) {
    for (const aggregate of aggregates) {
        if (aggregate != null) {
            releaseColumnAggregate(aggregate, dataFrameMemory);
        }
    }
}

/// Helper to destroy state of a table
function destroyTableComputationState(state: TableComputationState, memory: AsyncDataFrameRegistry) {
    // Release data frames
    memory.release(state.dataFrame);
    memory.release(state.filterTable?.dataFrame);
    memory.release(state.tableAggregation?.dataFrame);
    releaseColumnAggregates(state.columnAggregates, memory);
    releaseColumnAggregates(state.filteredColumnAggregates, memory);

    // Release data frames from tasks
    memory.release(state.tasks.filteringTask?.inputDataFrame);
    memory.release(state.tasks.orderingTask?.inputDataFrame);
    memory.release(state.tasks.tableAggregationTask?.inputDataFrame);
    memory.release(state.tasks.systemColumnTask?.inputDataFrame);
    memory.releaseMany(state.tasks.columnAggregationTasks.map(task => task?.inputDataFrame));
    for (const task of state.tasks.filteredColumnAggregationTasks) {
        memory.release(task?.filterTable?.dataFrame);
        releaseColumnAggregate(task?.unfilteredAggregate ?? null, memory);
    }
}
