import * as arrow from 'apache-arrow';

import { OrderByConstraint } from '../sql/sqlframe_builder.js';
import { ColumnAggregationVariant, TableAggregationTask, TableOrderingTask, TableAggregation, TaskProgress, ColumnGroup, SystemColumnComputationTask, FilterTable, ROWNUMBER_COLUMN, ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, SKIPPED_COLUMN, ColumnAggregationTask, OrderingTable, TableFilteringTask, WithProgress, TaskStatus, WithFilter, WithFilterEpoch } from './computation_types.js';
import { VariantKind } from '../utils/variant.js';
import { DataFrame, DataFrameRegistry } from './data_frame.js';
import { Logger } from '../platform/logger.js';
import { COLUMN_AGGREGATION_TASK, FILTERED_COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK, TaskVariant } from './computation_scheduler.js';
import { WebDBConnection } from '../webdb/api.js';

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
    dataFrame: DataFrame | null;
    /// The grid columns
    columnGroups: ColumnGroup[];
    /// The ordering constraints
    dataTableOrdering: OrderByConstraint[];

    /// The active filter table (if any)
    filterTable: FilterTable | null;
    /// The active ordering table (if any)
    orderingTable: OrderingTable | null;
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
    /// Indicates which filtered column aggregates are outdated for the current filter
    filteredColumnAggregatesOutdated: boolean[];
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
    /// The WebDB connection for computation
    webdbConnection: WebDBConnection | null;
    /// The WebDB connection setup error
    webdbConnectionSetupError: Error | null;
    /// The computations
    tableComputations: { [key: number]: TableComputationState };

    /// The scheduler tasks
    schedulerTasks: { [key: number]: TaskVariant };
    /// The next task id
    nextSchedulerTaskId: number;
}

/// Create the computation state
export function createComputationState(webdbConnection: WebDBConnection | null = null): ComputationState {
    return {
        webdbConnection,
        webdbConnectionSetupError: null,
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
        orderingTable: null,
        filteredColumnAggregates: Array.from({ length: tableColumns.length }, () => null),
        filteredColumnAggregatesOutdated: Array.from({ length: tableColumns.length }, () => false),
        tableAggregation: null,
    };
}

export const WEBDB_CONNECTION_CONFIGURED = Symbol('WEBDB_CONNECTION_CONFIGURED');
export const WEBDB_CONNECTION_CONFIGURATION_FAILED = Symbol('WEBDB_CONNECTION_CONFIGURATION_FAILED');
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
    | VariantKind<typeof WEBDB_CONNECTION_CONFIGURED, WebDBConnection>
    | VariantKind<typeof WEBDB_CONNECTION_CONFIGURATION_FAILED, Error | null>

    | VariantKind<typeof SCHEDULE_TASK, TaskVariant>
    | VariantKind<typeof UPDATE_SCHEDULER_TASK, [TaskVariant, Partial<TaskProgress>]>
    | VariantKind<typeof UNREGISTER_SCHEDULER_TASK, TaskVariant>

    | VariantKind<typeof COMPUTATION_FROM_QUERY_RESULT, [number, arrow.Table, ColumnGroup[], AbortController]>
    | VariantKind<typeof DELETE_COMPUTATION, [number]>
    | VariantKind<typeof CREATED_DATA_FRAME, [number, DataFrame]>

    | VariantKind<typeof TABLE_ORDERING_SUCCEDED, [number, OrderingTable]>
    | VariantKind<typeof TABLE_FILTERING_SUCCEEDED, [number, FilterTable | null]>
    | VariantKind<typeof TABLE_AGGREGATION_SUCCEEDED, [number, TableAggregation]>
    | VariantKind<typeof SYSTEM_COLUMN_COMPUTATION_SUCCEEDED, [number, arrow.Table, DataFrame, ColumnGroup[]]>
    | VariantKind<typeof COLUMN_AGGREGATION_SUCCEEDED, [number, number, ColumnAggregationVariant]>
    | VariantKind<typeof FILTERED_COLUMN_AGGREGATION_SUCCEEDED, [number, number, WithFilterEpoch<ColumnAggregationVariant> | null]>
    ;

export function reduceComputationState(state: ComputationState, action: ComputationAction, memory: DataFrameRegistry, logger: Logger): ComputationState {
    switch (action.type) {
        case WEBDB_CONNECTION_CONFIGURED:
            return {
                ...state,
                webdbConnection: action.value,
            };
        case WEBDB_CONNECTION_CONFIGURATION_FAILED:
            return {
                ...state,
                webdbConnectionSetupError: action.value,
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
            const [tableId, orderingTable] = action.value;
            memory.acquire(orderingTable.dataFrame);

            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                orderingTable.dataFrame.destroy();
                return state;
            }
            if (
                orderingTable.tableEpoch != null
                && tableState.tableEpoch != null
                && orderingTable.tableEpoch < tableState.tableEpoch
            ) {
                memory.release(orderingTable.dataFrame);
                return state;
            }

            const task = !tableState.tasks.orderingTask ? null : {
                ...tableState.tasks.orderingTask,
                progress: {
                    ...tableState.tasks.orderingTask.progress,
                    status: TaskStatus.TASK_SUCCEEDED,
                    completedAt: new Date(),
                }
            };
            memory.release(tableState.orderingTable?.dataFrame);
            return {
                ...state,
                tableComputations: {
                    ...state.tableComputations,
                    [tableId]: {
                        ...tableState,
                        tableEpoch: tableState.tableEpoch + 1,
                        orderingTable,
                        dataTableOrdering: orderingTable.orderingConstraints,
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
            const tableState = state.tableComputations[tableId];
            if (tableState === undefined) {
                memory.release(filterTable?.dataFrame);
                return state;
            }
            if (
                filterTable != null
                && filterTable.tableEpoch != null
                && tableState.tableEpoch != null
                && filterTable.tableEpoch < tableState.tableEpoch
            ) {
                memory.release(filterTable.dataFrame);
                return state;
            }
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
            const filteredColumnAggregatesOutdated = [...tableState.filteredColumnAggregatesOutdated];
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

            const filterEpoch = tableState.filterTable?.tableEpoch ?? null;
            const aggregateEpoch = newColumnAggregate?.filterTableEpoch ?? null;
            if (tableState.filterTable == null) {

                // We computed a column aggregation, but the filter was removed in the meantime.
                // Clear the filtered column aggregates.
                releaseColumnAggregate(newColumnAggregate, memory);
                filteredColumnAggregates[columnId] = null;
                filteredColumnAggregationTasks[columnId] = null;
                filteredColumnAggregatesOutdated[columnId] = false;
            } else {
                // There is a filter table, check if the aggregates were computed on an older filter epoch.
                // If so, mark the column aggregate outdated.
                filteredColumnAggregatesOutdated[columnId] = (
                    filterEpoch != null
                    && aggregateEpoch != null
                    && aggregateEpoch < filterEpoch
                ) || (
                        filterEpoch != null
                        && aggregateEpoch == null
                    );
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
                        filteredColumnAggregatesOutdated,
                        tasks: {
                            ...tableState.tasks,
                            filteredColumnAggregationTasks
                        }
                    }
                },
            };
        }
    }
}

function updateTask(state: ComputationState, task: TaskVariant, progress: Partial<TaskProgress>, memory: DataFrameRegistry, create: boolean = false) {
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
                memory.acquire(task.value.filterTable?.dataFrame, 2);
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

function tableFilteringSucceded(state: ComputationState, tableId: number, filterTable: FilterTable | null, memory: DataFrameRegistry) {
    const tableState = state.tableComputations[tableId];
    if (tableState === undefined) {
        memory.release(filterTable?.dataFrame);
        return state;
    }

    // Mark filtering task succeeded
    const filteringTask = !tableState.tasks.filteringTask ? null : {
        ...tableState.tasks.filteringTask,
        progress: {
            ...tableState.tasks.filteringTask.progress,
            status: TaskStatus.TASK_SUCCEEDED,
            completedAt: new Date(),
        }
    };
    const obsoleteFilteredColumnAggregates: Map<number, WithFilterEpoch<ColumnAggregationVariant> | null> = new Map();
    let newFilteredColumnAggregatesOutdated = tableState.filteredColumnAggregatesOutdated;

    if (filterTable == null) {
        // Clear column aggregates - track existing ones for release
        for (let columnId = 0; columnId < tableState.filteredColumnAggregates.length; ++columnId) {
            const prevAggregate = tableState.filteredColumnAggregates[columnId];
            if (prevAggregate != null) {
                obsoleteFilteredColumnAggregates.set(columnId, prevAggregate);
            }
        }
        newFilteredColumnAggregatesOutdated = Array.from({ length: tableState.filteredColumnAggregatesOutdated.length }, () => false);

    } else {
        newFilteredColumnAggregatesOutdated = [...tableState.filteredColumnAggregatesOutdated];
        for (let columnId = 0; columnId < tableState.columnGroups.length; ++columnId) {
            // Skip columns that don't compute a column summary
            const columnEntry = tableState.columnGroups[columnId];
            if (columnEntry.type == SKIPPED_COLUMN || columnEntry.type == ROWNUMBER_COLUMN) {
                newFilteredColumnAggregatesOutdated[columnId] = false;
                continue;
            }
            const unfilteredAggregate = tableState.columnAggregates[columnId];
            const prevFilteredAggregate = tableState.filteredColumnAggregates[columnId];
            newFilteredColumnAggregatesOutdated[columnId] = (
                unfilteredAggregate != null
                && prevFilteredAggregate?.filterTableEpoch !== filterTable.tableEpoch
            );
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
    memory.release(tableState.orderingTable?.dataFrame);
    return {
        ...state,
        tableComputations: {
            ...state.tableComputations,
            [tableId]: {
                ...tableState,
                tableEpoch: tableState.tableEpoch + 1,
                filterTable,
                orderingTable: null,
                filteredColumnAggregates: newFilteredColumnAggregates,
                filteredColumnAggregatesOutdated: newFilteredColumnAggregatesOutdated,
                tasks: {
                    ...tableState.tasks,
                    filteringTask,
                }
            }
        },
    };
}

/// Acquire a column aggregate
function acquireColumnAggregate(aggregate: ColumnAggregationVariant | null | undefined, memory: DataFrameRegistry, times: number = 1) {
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
function releaseColumnAggregate(aggregate: ColumnAggregationVariant | null | undefined, memory: DataFrameRegistry) {
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
function releaseColumnAggregates(aggregates: (ColumnAggregationVariant | null)[], dataFrameMemory: DataFrameRegistry) {
    for (const aggregate of aggregates) {
        if (aggregate != null) {
            releaseColumnAggregate(aggregate, dataFrameMemory);
        }
    }
}

/// Helper to destroy state of a table
function destroyTableComputationState(state: TableComputationState, memory: DataFrameRegistry) {
    // Release data frames
    memory.release(state.dataFrame);
    memory.release(state.filterTable?.dataFrame);
    memory.release(state.orderingTable?.dataFrame);
    memory.release(state.tableAggregation?.dataFrame);
    releaseColumnAggregates(state.columnAggregates, memory);
    releaseColumnAggregates(state.filteredColumnAggregates, memory);

    // Release data frames from tasks
    memory.release(state.tasks.filteringTask?.inputDataFrame);
    memory.release(state.tasks.orderingTask?.inputDataFrame);
    memory.release(state.tasks.orderingTask?.filterTable?.dataFrame);
    memory.release(state.tasks.tableAggregationTask?.inputDataFrame);
    memory.release(state.tasks.systemColumnTask?.inputDataFrame);
    memory.releaseMany(state.tasks.columnAggregationTasks.map(task => task?.inputDataFrame));
    for (const task of state.tasks.filteredColumnAggregationTasks) {
        memory.release(task?.filterTable?.dataFrame);
        releaseColumnAggregate(task?.unfilteredAggregate ?? null, memory);
    }
}
