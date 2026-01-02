import * as arrow from 'apache-arrow';
import * as pb from '@ankoh/dashql-protobuf';

import { ColumnAggregationVariant, TableAggregationTask, TableOrderingTask, TableAggregation, TaskProgress, ColumnGroup, SystemColumnComputationTask, FilterTable, ROWNUMBER_COLUMN, ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, SKIPPED_COLUMN, ColumnAggregationTask, OrderedTable, TableFilteringTask, WithProgress, TaskStatus, WithFilter } from './computation_types.js';
import { VariantKind } from '../utils/variant.js';
import { AsyncDataFrame, ComputeWorkerBindings } from './compute_worker_bindings.js';
import { LoggableException, Logger } from '../platform/logger.js';
import { COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK, TaskVariant } from './computation_scheduler.js';
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
    filteredColumnAggregates: (WithFilter<ColumnAggregationVariant> | null)[];
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

/// The computation registry
export interface ComputationState {
    /// The computation worker
    computationWorker: ComputeWorkerBindings | null;
    /// The computation worker error
    computationWorkerSetupError: Error | null;
    /// The computations
    tableComputations: { [key: number]: TableComputationState };
    /// The background tasks
    backgroundTasks: { [key: number]: TaskVariant };
    /// The next task id
    nextBackgroundTaskId: number;
}

/// Create the computation state
export function createComputationState(): ComputationState {
    return {
        computationWorker: null,
        computationWorkerSetupError: null,
        tableComputations: {},
        backgroundTasks: {},
        nextBackgroundTaskId: 0,
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
function createTableComputationState(computationId: number, table: arrow.Table, tableColumns: ColumnGroup[], tableLifetime: AbortController): TableComputationState {
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
export const POST_TASK = Symbol('POST_TASK');
export const UPDATE_TASK = Symbol('UPDATE_TASK');
export const DELETE_TASK = Symbol('DELETE_TASK');
export const TABLE_ORDERING_SUCCEDED = Symbol('TABLE_ORDERING_SUCCEDED');
export const TABLE_FILTERING_SUCCEEDED = Symbol('TABLE_FILTERING_SUCCEEDED');
export const TABLE_AGGREGATION_SUCCEEDED = Symbol('TABLE_AGGREGATION_SUCCEEDED');
export const SYSTEM_COLUMN_COMPUTATION_SUCCEEDED = Symbol('SYSTEM_COLUMN_COMPUTATION_SUCCEEDED');
export const COLUMN_AGGREGATION_SUCCEEDED = Symbol('COLUMN_AGGREGATION_SUCCEEDED');
export const FILTERED_COLUMN_AGGREGATION_SUCCEEDED = Symbol('FILTERED_COLUMN_AGGREGATION_SUCCEEDED');

export type ComputationAction =
    | VariantKind<typeof COMPUTATION_WORKER_CONFIGURED, ComputeWorkerBindings>
    | VariantKind<typeof COMPUTATION_WORKER_CONFIGURATION_FAILED, Error | null>

    | VariantKind<typeof POST_TASK, TaskVariant>
    | VariantKind<typeof UPDATE_TASK, [TaskVariant, Partial<TaskProgress>]>
    | VariantKind<typeof DELETE_TASK, TaskVariant>

    | VariantKind<typeof COMPUTATION_FROM_QUERY_RESULT, [number, arrow.Table, ColumnGroup[], AbortController]>
    | VariantKind<typeof DELETE_COMPUTATION, [number]>
    | VariantKind<typeof CREATED_DATA_FRAME, [number, AsyncDataFrame]>

    | VariantKind<typeof TABLE_ORDERING_SUCCEDED, [number, OrderedTable]>
    | VariantKind<typeof TABLE_FILTERING_SUCCEEDED, [number, FilterTable | null]>
    | VariantKind<typeof TABLE_AGGREGATION_SUCCEEDED, [number, TableAggregation]>
    | VariantKind<typeof SYSTEM_COLUMN_COMPUTATION_SUCCEEDED, [number, arrow.Table, AsyncDataFrame, ColumnGroup[]]>
    | VariantKind<typeof COLUMN_AGGREGATION_SUCCEEDED, [number, number, ColumnAggregationVariant]>
    | VariantKind<typeof FILTERED_COLUMN_AGGREGATION_SUCCEEDED, [number, number, WithFilter<ColumnAggregationVariant>]>
    ;

export function reduceComputationState(state: ComputationState, action: ComputationAction, logger: Logger): ComputationState {
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

        case POST_TASK: {
            const taskVariant = action.value;
            const initialProgress: TaskProgress = {
                status: TaskStatus.TASK_RUNNING,
                startedAt: new Date(),
                completedAt: null,
                failedAt: null,
                failedWithError: null,
            };
            return updateTask(state, taskVariant, initialProgress);
        }
        case UPDATE_TASK: {
            const [taskVariant, progress] = action.value;
            return updateTask(state, taskVariant, progress);
        }
        case DELETE_TASK: {
            if (action.value.taskId === undefined) {
                return state;
            }
            const backgroundTasks = { ...state.backgroundTasks };
            delete backgroundTasks[action.value.taskId];
            return {
                ...state,
                backgroundTasks
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
            destroyTableComputationState(tableState);
            delete tableComputations[tableId];
            return {
                ...state,
                tableComputations
            };
        }
        case CREATED_DATA_FRAME: {
            const [tableId, dataFrame] = action.value;
            const prevTableState = state.tableComputations[tableId]!;
            const nextTableState: TableComputationState = {
                ...prevTableState,
                tableEpoch: prevTableState.tableEpoch + 1,
                dataFrame,
            };
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
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                return state;
            }
            // XXX Move to Ordering Vector
            if (tableState.dataFrame != null) {
                tableState.dataFrame.destroy();
            }
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
            return tableFilteringSucceded(state, tableId, filterTable);
        }
        case TABLE_AGGREGATION_SUCCEEDED: {
            const [tableId, tableAggregation] = action.value;
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                tableAggregation.dataFrame.destroy();
                return state;
            }
            if (tableState.tableAggregation != null) {
                tableState.tableAggregation.dataFrame.destroy();
            }
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
                dataFrame.destroy();
                return state;
            }
            if (tableState.dataFrame != null) {
                tableState.dataFrame.destroy();
            }
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
            // Computation not registered?
            const [tableId, columnId, columnAggregate] = action.value;
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                destroyColumnAggregate(columnAggregate);
                return state;
            }
            // Column aggregation unknown?
            const currentTask = tableState.tasks.columnAggregationTasks[columnId];
            if (currentTask == null) {
                destroyColumnAggregate(columnAggregate);
                return state;
            }
            // Destroy the previous column aggregate, if there is one
            const prevAggregate = tableState.columnAggregates[columnId];
            if (prevAggregate != null) {
                destroyColumnAggregate(prevAggregate);
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
            const [tableId, columnId, columnAggregate] = action.value;
            // Computation not registered?
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                destroyColumnAggregate(columnAggregate);
                return state;
            }
            // Column aggregation task unknown?
            const currentTask = tableState.tasks.filteredColumnAggregationTasks[columnId];
            if (currentTask == null) {
                destroyColumnAggregate(columnAggregate);
                return state;
            }
            // Destroy the previous column aggregate, if there is one
            const prevAggregate = tableState.filteredColumnAggregates[columnId];
            if (prevAggregate != null) {
                destroyColumnAggregate(prevAggregate);
            }
            const filteredColumnAggregates: (WithFilter<ColumnAggregationVariant> | null)[] = [...tableState.filteredColumnAggregates];
            const filteredColumnAggregationTasks = [...tableState.tasks.filteredColumnAggregationTasks];
            filteredColumnAggregates[columnId] = columnAggregate;
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
            // That can happen if there's a newer filter epoch than the task epoch.
            const filterEpoch = tableState.filterTable?.tableEpoch ?? null;
            const taskEpoch = task.tableEpoch;
            if ((filterEpoch != null) && (taskEpoch != null) && (taskEpoch < filterEpoch)) {
                // XXX

                logger.debug("updating outdated column aggregate", {
                    tableId: tableId.toString(),
                    columnId: columnId.toString(),
                }, LOG_CTX)
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
                }
            };
        }
    }
}

function updateTask(state: ComputationState, task: TaskVariant, progress: Partial<TaskProgress>) {
    const allocatedTaskId = task.taskId === undefined;
    if (allocatedTaskId) {
        task = {
            ...task,
            taskId: state.nextBackgroundTaskId,
        };
    }
    let registerTask: (tasks: TableComputationTasks) => TableComputationTasks = (t: TableComputationTasks) => t;
    switch (task.type) {
        case TABLE_FILTERING_TASK:
            registerTask = (tasks: TableComputationTasks) => ({
                ...tasks,
                filteringTask: {
                    ...task.value,
                    progress: {
                        ...tasks.filteringTask?.progress,
                        ...progress,
                    } as TaskProgress,
                }
            });
            break;
        case TABLE_ORDERING_TASK:
            registerTask = (tasks: TableComputationTasks) => ({
                ...tasks,
                orderingTask: {
                    ...task.value,
                    progress: {
                        ...tasks.orderingTask?.progress,
                        ...progress,
                    } as TaskProgress,
                }
            });
            break;
        case TABLE_AGGREGATION_TASK:
            registerTask = (tasks: TableComputationTasks) => ({
                ...tasks,
                tableAggregationTask: {
                    ...task.value,
                    progress: {
                        ...tasks.tableAggregationTask?.progress,
                        ...progress,
                    } as TaskProgress,
                }
            });
            break;
        case SYSTEM_COLUMN_COMPUTATION_TASK:
            registerTask = (tasks: TableComputationTasks) => ({
                ...tasks,
                systemColumnTask: {
                    ...task.value,
                    progress: {
                        ...tasks.systemColumnTask?.progress,
                        ...progress,
                    } as TaskProgress,
                }
            });
            break;
        case COLUMN_AGGREGATION_TASK:
            registerTask = (tasks: TableComputationTasks) => {
                const updated = [...tasks.columnAggregationTasks];
                const prev = tasks.columnAggregationTasks[task.value.columnId];
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
    }
    const tableState = state.tableComputations[task.value.tableId];
    if (tableState === undefined) {
        return state;
    }
    const updatedTaskId = task.taskId ?? state.nextBackgroundTaskId;
    const updatedState: ComputationState = {
        ...state,
        nextBackgroundTaskId: allocatedTaskId ? (state.nextBackgroundTaskId + 1) : state.nextBackgroundTaskId,
        backgroundTasks: {
            ...state.backgroundTasks,
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

function tableFilteringSucceded(state: ComputationState, tableId: number, filterTable: FilterTable | null) {
    const tableState = state.tableComputations[tableId];
    if (tableState === undefined) {
        return state;
    }
    if (tableState.filterTable != null) {
        tableState.filterTable.dataFrame.destroy();
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
    const columnAggregateUpdates: Map<number, WithFilter<ColumnAggregationVariant> | null> = new Map();
    const columnAggregationTaskUpdates: Map<number, WithProgress<WithFilter<ColumnAggregationTask>> | null> = new Map();

    if (filterTable == null) {
        // Clear column aggregates
        for (let columnId = 0; columnId < tableState.filteredColumnAggregates.length; ++columnId) {
            columnAggregateUpdates.set(columnId, null);
            columnAggregationTaskUpdates.set(columnId, null);
        }

    } else {
        // Create initial column aggregations
        for (let columnId = 0; columnId < tableState.tasks.filteredColumnAggregationTasks.length; ++columnId) {
            // Previous task has up-to-date filter table epoch
            const task = tableState.tasks.filteredColumnAggregationTasks[columnId];
            if ((task !== null) && (filterTable.tableEpoch ?? 0) <= (task.tableEpoch ?? 0)) {
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
                columnAggregationTaskUpdates.set(columnId, {
                    ...task,
                    progress: initialProgress
                });
            }
        }
    }

    // Collect new filtered aggregates
    let newColumnAggregates = tableState.filteredColumnAggregates;
    let newColumnAggregationTasks = tableState.tasks.filteredColumnAggregationTasks;
    let newBackgroundTasks = state.backgroundTasks;
    let nextBackgroundTaskId = state.nextBackgroundTaskId;

    if (columnAggregationTaskUpdates.size > 0) {
        newColumnAggregates = [...tableState.filteredColumnAggregates];
        newColumnAggregationTasks = [...tableState.tasks.filteredColumnAggregationTasks];
        newBackgroundTasks = { ...state.backgroundTasks };

        for (const [k, v] of columnAggregateUpdates) {
            newColumnAggregates[k] = v;
            if (v != null) {
                destroyColumnAggregate(v);
            }
        }
        for (const [k, v] of columnAggregationTaskUpdates) {
            newColumnAggregationTasks[k] = v;
        }
        for (const [k, v] of columnAggregationTaskUpdates) {
            if (v != null) {
                newBackgroundTasks[k] = {
                    type: COLUMN_AGGREGATION_TASK,
                    value: v,
                    result: new AsyncValue<ColumnAggregationVariant, LoggableException>(),
                    taskId: nextBackgroundTaskId++,
                };
            }
        }
    }

    return {
        ...state,
        tableComputations: {
            ...state.tableComputations,
            [tableId]: {
                ...tableState,
                tableEpoch: tableState.tableEpoch + 1,
                filterTable: filterTable,
                filteredColumnAggregates: newColumnAggregates,
                tasks: {
                    ...tableState.tasks,
                    filteringTask,
                    filteredColumnAggregationTasks: newColumnAggregationTasks
                }
            }
        },
        backgroundTasks: newBackgroundTasks,
        nextBackgroundTaskId: nextBackgroundTaskId,
    };
}

/// Helper to destroy state of a column aggregate
function destroyColumnAggregate(aggregate: ColumnAggregationVariant) {
    switch (aggregate.type) {
        case ORDINAL_COLUMN: {
            aggregate.value.binnedDataFrame?.destroy();
            break;
        }
        case STRING_COLUMN: {
            aggregate.value.frequentValuesDataFrame?.destroy();
            break;
        }
        case LIST_COLUMN: {
            aggregate.value.frequentValuesDataFrame?.destroy();
            break;
        }
        case SKIPPED_COLUMN: {
            break;
        }
    }
}

/// Helper to destroy column aggregates
function destroyColumnAggregates(aggregates: (ColumnAggregationVariant | null)[]) {
    for (const aggregate of aggregates) {
        if (aggregate != null) {
            destroyColumnAggregate(aggregate);
        }
    }
}

/// Helper to destroy state of a table
function destroyTableComputationState(state: TableComputationState) {
    destroyColumnAggregates(state.columnAggregates);
    destroyColumnAggregates(state.filteredColumnAggregates);
    state?.filterTable?.dataFrame.destroy();
    state?.tableAggregation?.dataFrame.destroy();
    state?.dataFrame?.destroy();
}
