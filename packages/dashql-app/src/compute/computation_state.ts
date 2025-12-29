import * as arrow from 'apache-arrow';
import * as pb from '@ankoh/dashql-protobuf';

import { ColumnSummaryVariant, TableAggregationTask, TaskStatus, TableOrderingTask, TableAggregation, OrderedTable, TaskProgress, ColumnGroup, SystemColumnComputationTask, FilterTable, ROWNUMBER_COLUMN, ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, SKIPPED_COLUMN } from './computation_types.js';
import { VariantKind } from '../utils/variant.js';
import { AsyncDataFrame, ComputeWorkerBindings } from './compute_worker_bindings.js';
import { Logger } from '../platform/logger.js';

/// The table computation state
export interface TableComputationState {
    /// The table id
    tableId: number;

    /// The table on the main thread
    dataTable: arrow.Table;
    /// The table field index
    dataTableFieldsByName: Map<string, number>;
    /// The abort controller
    dataTableLifetime: AbortController;
    /// The data frame in the compute module
    dataFrame: AsyncDataFrame | null;

    /// The ordering constraints
    dataTableOrdering: pb.dashql.compute.OrderByConstraint[];
    /// The ordering task
    orderingTask: TableOrderingTask | null;
    /// The ordering task status
    orderingTaskStatus: TaskStatus | null;
    /// The active filter table (if any)
    filterTable: FilterTable | null;

    /// The grid columns
    columnGroups: ColumnGroup[];
    /// The row number column group
    rowNumberColumnGroup: number | null;
    /// The row number column name
    rowNumberColumnName: string | null;

    /// The table aggregation task
    tableAggregationTask: TableAggregationTask | null;
    /// The task aggregation status
    tableAggregationTaskStatus: TaskStatus | null;
    /// The table aggregation
    tableAggregation: TableAggregation | null;
    /// The task to precompute system columns
    systemColumnComputationTask: SystemColumnComputationTask | null;
    /// The status of precomputing system columns
    systemColumnComputationStatus: TaskStatus | null;
    /// The column (group) summaries
    columnGroupSummariesStatus: (TaskStatus | null)[];
    /// The column (group) summaries
    columnGroupSummaries: ColumnGroupSummaries;
}

/// The column summary variants
type ColumnGroupSummaries = (ColumnSummaryVariant | null)[];

/// The computation registry
export interface ComputationState {
    /// The epoch number
    globalEpoch: number;
    /// The computation worker
    computationWorker: ComputeWorkerBindings | null;
    /// The computation worker error
    computationWorkerSetupError: Error | null;
    /// The computations
    tableComputations: Map<number, TableComputationState>;
}

/// Create the computation state
export function createComputationState(): ComputationState {
    return {
        globalEpoch: 0,
        computationWorker: null,
        computationWorkerSetupError: null,
        tableComputations: new Map(),
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
        dataTable: table,
        dataTableFieldsByName: createArrowFieldIndex(table),
        columnGroups: tableColumns,
        columnGroupSummariesStatus: Array.from({ length: tableColumns.length }, () => null),
        columnGroupSummaries: Array.from({ length: tableColumns.length }, () => null),
        rowNumberColumnGroup: null,
        rowNumberColumnName: null,
        dataTableLifetime: tableLifetime,
        dataTableOrdering: [],
        dataFrame: null,
        filterTable: null,
        orderingTask: null,
        orderingTaskStatus: null,
        tableAggregationTask: null,
        tableAggregationTaskStatus: null,
        tableAggregation: null,
        systemColumnComputationTask: null,
        systemColumnComputationStatus: null,
    };
}

export const COMPUTATION_WORKER_CONFIGURED = Symbol('REGISTER_COMPUTATION');
export const COMPUTATION_WORKER_CONFIGURATION_FAILED = Symbol('COMPUTATION_WORKER_SETUP_FAILED');

export const COMPUTATION_FROM_QUERY_RESULT = Symbol('COMPUTATION_FROM_QUERY_RESULT');
export const DELETE_COMPUTATION = Symbol('DELETE_COMPUTATION');
export const CREATED_DATA_FRAME = Symbol('CREATED_DATA_FRAME');

export const SYSTEM_COLUMN_COMPUTATION_TASK_RUNNING = Symbol('SYSTEM_COLUMN_COMPUTATION_TASK_RUNNING');
export const SYSTEM_COLUMN_COMPUTATION_TASK_FAILED = Symbol('SYSTEM_COLUMN_COMPUTATION_TASK_FAILED');
export const SYSTEM_COLUMN_COMPUTATION_TASK_SUCCEEDED = Symbol('SYSTEM_COLUMN_COMPUTATION_TASK_SUCCEEDED');

export const TABLE_ORDERING_TASK_RUNNING = Symbol('TABLE_ORDERING_TASK_RUNNING');
export const TABLE_ORDERING_TASK_FAILED = Symbol('TABLE_ORDERING_TASK_FAILED');
export const TABLE_ORDERING_TASK_SUCCEEDED = Symbol('TABLE_ORDERING_TASK_SUCCEEDED');

export const TABLE_CLEAR_FILTERS = Symbol('TABLE_CLEAR_FILTERS');
export const TABLE_FILTERING_TASK_RUNNING = Symbol('TABLE_FILTERING_TASK_RUNNING');
export const TABLE_FILTERING_TASK_FAILED = Symbol('TABLE_FILTERING_TASK_FAILED');
export const TABLE_FILTERING_TASK_SUCCEEDED = Symbol('TABLE_FILTERING_TASK_SUCCEEDED');

export const TABLE_AGGREGATION_TASK_RUNNING = Symbol('TABLE_SUMMARY_TASK_RUNNING');
export const TABLE_AGGREGATION_TASK_FAILED = Symbol('TABLE_SUMMARY_TASK_FAILED');
export const TABLE_AGGREGATION_TASK_SUCCEEDED = Symbol('TABLE_SUMMARY_TASK_SUCCEEDED');

export const COLUMN_AGGREGATION_TASK_RUNNING = Symbol('COLUMN_AGGREGATION_TASK_RUNNING');
export const COLUMN_AGGREGATION_TASK_FAILED = Symbol('COLUMN_AGGREGATION_TASK_FAILED');
export const COLUMN_AGGREGATION_TASK_SUCCEEDED = Symbol('COLUMN_AGGREGATION_TASK_SUCCEEDED');

export type ComputationAction =
    | VariantKind<typeof COMPUTATION_WORKER_CONFIGURED, ComputeWorkerBindings>
    | VariantKind<typeof COMPUTATION_WORKER_CONFIGURATION_FAILED, Error | null>

    | VariantKind<typeof COMPUTATION_FROM_QUERY_RESULT, [number, arrow.Table, ColumnGroup[], AbortController]>
    | VariantKind<typeof DELETE_COMPUTATION, [number]>
    | VariantKind<typeof CREATED_DATA_FRAME, [number, AsyncDataFrame]>

    | VariantKind<typeof TABLE_ORDERING_TASK_RUNNING, [number, TaskProgress]>
    | VariantKind<typeof TABLE_ORDERING_TASK_FAILED, [number, TaskProgress, any]>
    | VariantKind<typeof TABLE_ORDERING_TASK_SUCCEEDED, [number, TaskProgress, OrderedTable]>

    | VariantKind<typeof TABLE_CLEAR_FILTERS, number>
    | VariantKind<typeof TABLE_FILTERING_TASK_RUNNING, [number, TaskProgress]>
    | VariantKind<typeof TABLE_FILTERING_TASK_FAILED, [number, TaskProgress, any]>
    | VariantKind<typeof TABLE_FILTERING_TASK_SUCCEEDED, [number, TaskProgress, FilterTable]>

    | VariantKind<typeof TABLE_AGGREGATION_TASK_RUNNING, [number, TaskProgress]>
    | VariantKind<typeof TABLE_AGGREGATION_TASK_FAILED, [number, TaskProgress, any]>
    | VariantKind<typeof TABLE_AGGREGATION_TASK_SUCCEEDED, [number, TaskProgress, TableAggregation]>

    | VariantKind<typeof SYSTEM_COLUMN_COMPUTATION_TASK_RUNNING, [number, TaskProgress]>
    | VariantKind<typeof SYSTEM_COLUMN_COMPUTATION_TASK_FAILED, [number, TaskProgress, any]>
    | VariantKind<typeof SYSTEM_COLUMN_COMPUTATION_TASK_SUCCEEDED, [number, TaskProgress, arrow.Table, AsyncDataFrame, ColumnGroup[]]>

    | VariantKind<typeof COLUMN_AGGREGATION_TASK_RUNNING, [number, number, TaskProgress]>
    | VariantKind<typeof COLUMN_AGGREGATION_TASK_FAILED, [number, number, TaskProgress, any]>
    | VariantKind<typeof COLUMN_AGGREGATION_TASK_SUCCEEDED, [number, number, TaskProgress, ColumnSummaryVariant]>
    ;

export function reduceComputationState(state: ComputationState, action: ComputationAction, _worker: ComputeWorkerBindings, _logger: Logger): ComputationState {
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
        case COMPUTATION_FROM_QUERY_RESULT: {
            const [computationId, table, tableColumns, tableLifetime] = action.value;
            const tableState = createTableComputationState(computationId, table, tableColumns, tableLifetime);
            state.tableComputations.set(computationId, tableState);
            return {
                ...state,
                tableComputations: state.tableComputations
            };
        }
        case DELETE_COMPUTATION: {
            const [computationId] = action.value;
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined) {
                return state;
            }
            destroyTableComputationState(tableState);
            state.tableComputations.delete(computationId);
            return { ...state };
        }
        case CREATED_DATA_FRAME: {
            const [computationId, dataFrame] = action.value;
            const prevTableState = state.tableComputations.get(computationId)!;
            const nextTableState: TableComputationState = {
                ...prevTableState,
                dataFrame,
            };
            state.tableComputations.set(computationId, nextTableState);
            return { ...state };
        }
        case TABLE_ORDERING_TASK_SUCCEEDED: {
            const [computationId, taskProgress, orderedTable] = action.value;
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined) {
                return state;
            }
            if (tableState.dataFrame != null) {
                tableState.dataFrame.destroy();
            }
            state.tableComputations.set(computationId, {
                ...tableState,
                dataFrame: orderedTable.dataFrame,
                dataTable: orderedTable.dataTable,
                dataTableOrdering: orderedTable.orderingConstraints,
                orderingTaskStatus: taskProgress.status,
            });
            return { ...state };
        }
        case TABLE_CLEAR_FILTERS: {
            const computationId = action.value;
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined || tableState.filterTable == null) {
                return state;
            }
            tableState.filterTable.dataFrame.destroy();
            state.tableComputations.set(computationId, {
                ...tableState,
                filterTable: null,
                columnGroupSummaries: clearColumnFilters(tableState.columnGroupSummaries)
            });
            return { ...state };
        }
        case TABLE_FILTERING_TASK_SUCCEEDED: {
            const [computationId, _taskProgress, filterTable] = action.value;
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined) {
                return state;
            }
            if (tableState.filterTable != null) {
                tableState.filterTable.dataFrame.destroy();
            }
            state.tableComputations.set(computationId, {
                ...tableState,
                filterTable: filterTable,
                columnGroupSummaries: clearColumnFilters(tableState.columnGroupSummaries)
            });
            return { ...state };
        }
        case TABLE_AGGREGATION_TASK_RUNNING:
        case TABLE_AGGREGATION_TASK_FAILED: {
            const [computationId, taskProgress] = action.value;
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined) {
                return state;
            }
            state.tableComputations.set(computationId, {
                ...tableState,
                tableAggregationTaskStatus: taskProgress.status,
            });
            return { ...state };
        }
        case TABLE_AGGREGATION_TASK_SUCCEEDED: {
            const [computationId, taskProgress, tableSummary] = action.value;
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined) {
                return state;
            }
            state.tableComputations.set(computationId, {
                ...tableState,
                tableAggregationTaskStatus: taskProgress.status,
                tableAggregation: tableSummary
            });
            return { ...state };
        }
        case SYSTEM_COLUMN_COMPUTATION_TASK_RUNNING:
        case SYSTEM_COLUMN_COMPUTATION_TASK_FAILED: {
            const [computationId, taskProgress] = action.value;
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined) {
                return state;
            }
            state.tableComputations.set(computationId, {
                ...tableState,
                systemColumnComputationStatus: taskProgress.status,
            });
            return { ...state };
        }
        case SYSTEM_COLUMN_COMPUTATION_TASK_SUCCEEDED: {
            const [computationId, taskProgress, dataTable, dataFrame, columnGroups] = action.value;
            let rowNumColumnGroup: number | null = null;
            let rowNumColumnName: string | null = null;
            for (let i = 0; i < columnGroups.length; ++i) {
                const group = columnGroups[i];
                switch (group.type) {
                    case ROWNUMBER_COLUMN:
                        rowNumColumnGroup = i;
                        rowNumColumnName = group.value.rowNumberFieldName;
                        break;
                }
            }
            console.warn("missing rownum column group");
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined) {
                return state;
            }
            state.tableComputations.set(computationId, {
                ...tableState,
                dataTable,
                dataFrame,
                columnGroups: columnGroups,
                tableAggregationTaskStatus: taskProgress.status,
                rowNumberColumnGroup: rowNumColumnGroup,
                rowNumberColumnName: rowNumColumnName,
            });
            return { ...state };
        }
        case COLUMN_AGGREGATION_TASK_RUNNING:
        case COLUMN_AGGREGATION_TASK_FAILED: {
            const [computationId, columnId, taskProgress] = action.value;
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined) {
                return state;
            }
            const status = [...tableState.columnGroupSummariesStatus];
            status[columnId] = taskProgress.status;
            state.tableComputations.set(computationId, {
                ...tableState,
                columnGroupSummariesStatus: status,
            });
            return { ...state };
        }
        case COLUMN_AGGREGATION_TASK_SUCCEEDED: {
            const [computationId, columnId, taskProgress, columnSummary] = action.value;
            const tableState = state.tableComputations.get(computationId);
            if (tableState === undefined) {
                return state;
            }
            const status = [...tableState.columnGroupSummariesStatus];
            const summaries = [...tableState.columnGroupSummaries];
            status[columnId] = taskProgress.status;
            const prev = summaries[columnId];
            summaries[columnId] = columnSummary;
            state.tableComputations.set(computationId, {
                ...tableState,
                columnGroupSummariesStatus: status,
                columnGroupSummaries: summaries
            });
            if (prev) {
                destroyColumnSummary(prev);
            }
            return { ...state };
        }
    }
    return state;
}


/// Helper to destroy state of a column summary
function destroyColumnSummary(summary: ColumnSummaryVariant) {
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

/// Helper to destroy state of a table
function destroyTableComputationState(state: TableComputationState) {
    for (const s of state.columnGroupSummaries) {
        if (s !== null) {
            destroyColumnSummary(s);
        }
    }
    state?.filterTable?.dataFrame.destroy();
    state?.tableAggregation?.dataFrame.destroy();
    state?.dataFrame?.destroy();
}

/// Helper to clear a filtered column analysis
function clearColumnFilters(summaries: ColumnGroupSummaries): ColumnGroupSummaries {
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
