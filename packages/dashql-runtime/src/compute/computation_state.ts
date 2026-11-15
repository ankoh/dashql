import * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import { OrderByConstraint } from './sql/sqlframe_builder.js';
import { ColumnAggregationVariant, TableAggregationTask, TableOrderingTask, TableAggregation, TaskProgress, ColumnGroup, SystemColumnComputationTask, FilterTable, ColumnAggregationTask, OrderingTable, TableFilteringTask, WithProgress, WithFilter, WithFilterEpoch, ComputationStateVersion, ResultSearchState, createResultSearchState, DataSearchTable, DataSearchTask } from './computation_types.js';
import { VariantKind } from '../utils/variant.js';
import { CrossFilters } from './cross_filters.js';
import { DataFrame, DataFrameRegistry } from './data_frame.js';
import type { EmbeddedClientContext } from '../platform/database/embedded_database.js';
import { TaskVariant } from './computation_types.js';
import { stringifyError } from '../platform/logger/logger.js';
import { NativeComputations } from './computation_native.js';

const LOG_CTX = 'computation_state';

/// The table computation state
export interface TableComputationState {
    /// The table id
    tableId: number;
    /// The connection that ran the query of the table, its query history lists the computation queries.
    /// Null for a host without connections.
    connectionId: string | null;
    /// The client context of the queries of a computation without a connection, e.g. of the connection overview
    clientContext: EmbeddedClientContext | null;
    /// The tasks
    tasks: TableComputationTasks;

    /// The current version tracking data, filter, and ordering changes
    version: ComputationStateVersion;
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

    /// The active cross-filter selection.
    /// This is the source of truth for cross-filtering and lives here (rather than
    /// as component-local state) so that every view of the same table - the result
    /// table header plots and the visualization tab's aggregation bar - shares one
    /// selection and drives a single `filterTable`.
    crossFilters: CrossFilters;
    /// The active filter table (if any)
    filterTable: FilterTable | null;
    /// The active ordering table (if any)
    orderingTable: OrderingTable | null;
    /// Shared Columns search for every view of this result
    columnSearch: ResultSearchState;
    /// Shared Data search for every view of this result
    dataSearch: ResultSearchState;
    /// The materialized rows and matching columns for the applied Data search
    dataSearchTable: DataSearchTable | null;
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
    /// The Data-search materialization task
    dataSearchTask: WithProgress<DataSearchTask> | null;
    /// The task to compute column (group) aggregates.
    /// The array contains N entries where N is the number of column groups
    columnAggregationTasks: (WithProgress<ColumnAggregationTask> | null)[];
    /// The task to compute filtered column (group) aggregates
    filteredColumnAggregationTasks: (WithProgress<WithFilter<ColumnAggregationTask>> | null)[];
}

/// The computation registry.
/// We store the scheduler tasks here as well to allow for linking the "latest" tasks safely in the per-table computation states.
export interface ComputationState {
    /// The computations
    tableComputations: { [key: number]: TableComputationState };

    /// The scheduler tasks
    schedulerTasks: { [key: number]: TaskVariant };
    /// The next task id
    nextSchedulerTaskId: number;
    /// The Rust state of the computations, see computation_native.ts. Absent in a state without a core and in plain
    /// objects of tests that only read computations, the actions need it.
    native?: NativeComputations;
}

/// Create the computation state on the computations of a core. Without a core a state that the actions can't reduce,
/// e.g. while the core loads.
export function createComputationState(instance?: core.DashQL | null): ComputationState {
    if (instance != null) {
        return NativeComputations.create(instance);
    }
    return {
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

/// The state of the computation of a table as a plain object, e.g. of a test that renders a computation
export function createTableComputationState(computationId: number, table: arrow.Table, tableColumns: ColumnGroup[], tableLifetime: AbortController, connectionId: string | null = null, clientContext: EmbeddedClientContext | null = null): TableComputationState {
    return {
        tableId: computationId,
        connectionId,
        clientContext,
        tasks: {
            filteringTask: null,
            orderingTask: null,
            dataSearchTask: null,
            tableAggregationTask: null,
            systemColumnTask: null,
            columnAggregationTasks: Array(tableColumns.length + 1).fill(null),
            filteredColumnAggregationTasks: Array(tableColumns.length + 1).fill(null),
        },
        dataTable: table,
        version: new ComputationStateVersion(0, 0),
        dataTableFieldsByName: createArrowFieldIndex(table),
        columnGroups: tableColumns,
        columnAggregates: Array.from({ length: tableColumns.length }, () => null),
        rowNumberColumnGroup: null,
        rowNumberColumnName: null,
        dataTableLifetime: tableLifetime,
        dataTableOrdering: [],
        crossFilters: new CrossFilters(),
        dataFrame: null,
        filterTable: null,
        orderingTable: null,
        columnSearch: createResultSearchState(),
        dataSearch: createResultSearchState(),
        dataSearchTable: null,
        filteredColumnAggregates: Array.from({ length: tableColumns.length }, () => null),
        filteredColumnAggregatesOutdated: Array.from({ length: tableColumns.length }, () => false),
        tableAggregation: null,
    };
}

export const COMPUTATION_FROM_QUERY_RESULT = Symbol('COMPUTATION_FROM_QUERY_RESULT');
export const DELETE_COMPUTATION = Symbol('DELETE_COMPUTATION');
export const CREATED_DATA_FRAME = Symbol('CREATED_DATA_FRAME');
export const SCHEDULE_TASK = Symbol('SCHEDULE_TASK');
export const UPDATE_SCHEDULER_TASK = Symbol('UPDATE_SCHEDULER_TASK');
export const UNREGISTER_SCHEDULER_TASK = Symbol('UNREGISTER_SCHEDULER_TASK');
export const TABLE_ORDERING_SUCCEDED = Symbol('TABLE_ORDERING_SUCCEDED');
export const CLEAR_TABLE_ORDERING = Symbol('CLEAR_TABLE_ORDERING');
export const TABLE_FILTERING_SUCCEEDED = Symbol('TABLE_FILTERING_SUCCEEDED');
export const TABLE_AGGREGATION_SUCCEEDED = Symbol('TABLE_AGGREGATION_SUCCEEDED');
export const SYSTEM_COLUMN_COMPUTATION_SUCCEEDED = Symbol('SYSTEM_COLUMN_COMPUTATION_SUCCEEDED');
export const COLUMN_AGGREGATION_SUCCEEDED = Symbol('COLUMN_AGGREGATION_SUCCEEDED');
export const FILTERED_COLUMN_AGGREGATION_SUCCEEDED = Symbol('FILTERED_COLUMN_AGGREGATION_SUCCEEDED');
export const SET_CROSS_FILTERS = Symbol('SET_CROSS_FILTERS');
export const SET_RESULT_SEARCH_PATTERN = Symbol('SET_RESULT_SEARCH_PATTERN');
export const COLUMN_SEARCH_SUCCEEDED = Symbol('COLUMN_SEARCH_SUCCEEDED');
export const DATA_SEARCH_SUCCEEDED = Symbol('DATA_SEARCH_SUCCEEDED');
export const DATA_SEARCH_FAILED = Symbol('DATA_SEARCH_FAILED');
export const RESULT_SEARCH_FAILED = Symbol('RESULT_SEARCH_FAILED');

export type ComputationAction =
    | VariantKind<typeof SCHEDULE_TASK, TaskVariant>
    | VariantKind<typeof UPDATE_SCHEDULER_TASK, [TaskVariant, Partial<TaskProgress>]>
    | VariantKind<typeof UNREGISTER_SCHEDULER_TASK, TaskVariant>

    | VariantKind<typeof COMPUTATION_FROM_QUERY_RESULT, [number, arrow.Table, ColumnGroup[], AbortController, (string | null)?, (EmbeddedClientContext | null)?]>
    | VariantKind<typeof DELETE_COMPUTATION, [number]>
    | VariantKind<typeof CREATED_DATA_FRAME, [number, DataFrame]>

    | VariantKind<typeof TABLE_ORDERING_SUCCEDED, [number, OrderingTable]>
    | VariantKind<typeof CLEAR_TABLE_ORDERING, number>
    | VariantKind<typeof TABLE_FILTERING_SUCCEEDED, [number, ComputationStateVersion, FilterTable | null]>
    | VariantKind<typeof TABLE_AGGREGATION_SUCCEEDED, [number, TableAggregation]>
    | VariantKind<typeof SYSTEM_COLUMN_COMPUTATION_SUCCEEDED, [number, arrow.Table, DataFrame, ColumnGroup[]]>
    | VariantKind<typeof COLUMN_AGGREGATION_SUCCEEDED, [number, number, ColumnAggregationVariant]>
    | VariantKind<typeof FILTERED_COLUMN_AGGREGATION_SUCCEEDED, [number, number, ComputationStateVersion, WithFilterEpoch<ColumnAggregationVariant> | null]>
    | VariantKind<typeof SET_CROSS_FILTERS, [number, CrossFilters]>
    | VariantKind<typeof SET_RESULT_SEARCH_PATTERN, [number, 'columns' | 'data', string]>
    | VariantKind<typeof COLUMN_SEARCH_SUCCEEDED, [number, DataFrame, number, number[]]>
    | VariantKind<typeof DATA_SEARCH_SUCCEEDED, [number, DataFrame, number, DataSearchTable]>
    | VariantKind<typeof DATA_SEARCH_FAILED, [number, DataFrame, number, string]>
    | VariantKind<typeof RESULT_SEARCH_FAILED, [number, DataFrame, 'columns' | 'data', number, string]>
    ;

/// Apply an action to the computations. The state of the app is a projection of the Rust state
/// (computation_native.ts): the action calls it, its effects release the data frames and Arrow tables that it no
/// longer holds and abort what it dropped, and the projection keeps the objects of the parts that didn't change. An
/// action that changes nothing returns the state as it is. Like the workbooks, only the latest state of the
/// computations can be reduced: an action on an older state acts on the latest one.
export function reduceComputationState(state: ComputationState, action: ComputationAction, memory: DataFrameRegistry): ComputationState {
    const native = state.native;
    if (native == null) {
        throw new Error('the computation state needs the computations of a core, see createComputationState');
    }
    let outcome;
    try {
        outcome = native.apply(action, memory);
    } catch (e) {
        // A failed action leaves the state as it is
        memory.logger.error('Failed to apply a computation action', { action: action.type.description ?? '', error: stringifyError(e) }, LOG_CTX);
        return state;
    }
    if (outcome == null || !outcome.changed) {
        return state;
    }
    return native.project();
}
