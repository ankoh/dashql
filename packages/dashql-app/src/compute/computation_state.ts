import * as arrow from 'apache-arrow';
import * as pb from '@ankoh/dashql-protobuf';

import { ColumnAggregationVariant, TableAggregationTask, TableOrderingTask, TableAggregation, TaskProgress, ColumnGroup, SystemColumnComputationTask, FilterTable, ROWNUMBER_COLUMN, ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, SKIPPED_COLUMN, ColumnAggregationTask, OrderedTable, TableFilteringTask, WithProgress, TaskStatus } from './computation_types.js';
import { VariantKind } from '../utils/variant.js';
import { AsyncDataFrame, ComputeWorkerBindings } from './compute_worker_bindings.js';
import { Logger } from '../platform/logger.js';
import { COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK, TaskVariant } from './computation_scheduler.js';

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
}

export interface TableComputationTasks {
    /// The filtering task
    filteringTask: WithProgress<TableFilteringTask> | null;
    /// The ordering task
    orderingTask: WithProgress<TableOrderingTask> | null;
    /// The table aggregation task
    tableAggregationTask: WithProgress<TableAggregationTask> | null;
    /// The task to precompute system columns
    systemColumnTask: WithProgress<SystemColumnComputationTask> | null;
    /// The task to compute column (group) aggregates.
    /// The array contains N entries where N is the number of column groups
    columnAggregationTasks: (WithProgress<ColumnAggregationTask> | null)[];
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
    ;

export function reduceComputationState(state: ComputationState, action: ComputationAction, _logger: Logger): ComputationState {
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
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                return state;
            }
            if (tableState.filterTable != null) {
                tableState.filterTable.dataFrame.destroy();
            }
            const filteringTask = !tableState.tasks.filteringTask ? null : {
                ...tableState.tasks.filteringTask,
                progress: {
                    ...tableState.tasks.filteringTask.progress,
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }
            };
            // XXX Check if column aggregation tasks are outdated.
            // XXX Schedule column summary updates
            for (let i = 0; i < tableState.tasks.columnAggregationTasks.length; ++i) {
                const task = tableState.tasks.columnAggregationTasks[i];
                if (task === null) {
                    continue;
                }
                if (task.tableEpoch != tableState.filterTable?.tableEpoch) {
                    // XXX
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
                        columnAggregates: clearColumnFilters(tableState.columnAggregates),
                        tasks: {
                            ...tableState.tasks,
                            filteringTask,
                        }
                    }
                }
            };
        }
        case TABLE_AGGREGATION_SUCCEEDED: {
            const [tableId, tableAggregation] = action.value;
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
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
            const [tableId, columnId, columnSummary] = action.value;
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                return state;
            }
            const columnAggregationTasks = [...tableState.tasks.columnAggregationTasks];
            const columnAggregates: (ColumnAggregationVariant | null)[] = [...tableState.columnAggregates];
            const prevAggregate = columnAggregates[columnId];
            columnAggregates[columnId] = columnSummary;
            if (prevAggregate) {
                destroyColumnSummary(prevAggregate);
            }
            if (columnAggregationTasks[columnId] != null) {
                columnAggregationTasks[columnId] = {
                    ...columnAggregationTasks[columnId],
                    progress: {
                        ...columnAggregationTasks[columnId].progress,
                        completedAt: new Date(),
                        status: TaskStatus.TASK_SUCCEEDED,
                    }
                }
            }
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
    }
}


/// Helper to destroy state of a column summary
function destroyColumnSummary(summary: ColumnAggregationVariant) {
    switch (summary.type) {
        case ORDINAL_COLUMN: {
            summary.value.binnedDataFrame?.destroy();
            break;
        }
        case STRING_COLUMN: {
            summary.value.frequentValuesDataFrame?.destroy();
            break;
        }
        case LIST_COLUMN: {
            summary.value.frequentValuesDataFrame?.destroy();
            break;
        }
        case SKIPPED_COLUMN: {
            break;
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

/// Helper to destroy state of a table
function destroyTableComputationState(state: TableComputationState) {
    for (const s of state.columnAggregates) {
        if (s !== null) {
            destroyColumnSummary(s);
        }
    }
    state?.filterTable?.dataFrame.destroy();
    state?.tableAggregation?.dataFrame.destroy();
    state?.dataFrame?.destroy();
}

/// Helper to clear a filtered column analysis
function clearColumnFilters(summaries: (ColumnAggregationVariant | null)[]): (ColumnAggregationVariant | null)[] {
    const out = [...summaries];
    for (let i = 0; i < summaries.length; ++i) {
        const c = summaries[i];
        if (c == null) {
            continue;
        }
        switch (c.type) {
            case ORDINAL_COLUMN:
                out[i] = {
                    type: ORDINAL_COLUMN,
                    value: {
                        ...c.value,
                        filteredColumnAnalysis: null
                    }
                };
                break;
            default:
                break;
        }
    }
    return out;
}
