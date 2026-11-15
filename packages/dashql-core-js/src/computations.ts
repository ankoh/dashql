import { DashQL, Ptr } from './api.js';
import type * as glue from './wasm/dashql_core.js';

/// The computations of result tables in the Rust runtime (`packages/dashql-runtime-rs/src/compute`, see
/// docs/wip/rust_runtime.md): the summaries of the columns, the statistics of a table, the system columns, the cross
/// filters, the ordering and the searches, and the tasks of the scheduler that compute them.
///
/// The Arrow tables, the summaries, the data frames and the lifetimes stay with the host, the state knows them by the
/// ids that the host gives them. The state owns what it holds: an action returns an effect to release a data frame or
/// an Arrow table once nothing in the state holds it. A computation changes its revision with every change.

const COMPUTATIONS_TYPE = Symbol('COMPUTATIONS_TYPE');

/// The version of a computation: the data changes with a new data frame, the filter with every scheduled filtering
export interface ComputationVersionValue {
    data: number;
    filter: number;
}

/// An Arrow table of the host
export interface ComputationArrowTable {
    id: number;
    rows: number;
}

/// The fields of the table aggregation with the statistics of a column
export interface ComputationStatsFields {
    countFieldName: string;
    distinctCountFieldName: string | null;
    minAggregateFieldName: string | null;
    maxAggregateFieldName: string | null;
}

/// A column of the grid of a result, the type of a field as the host names it
export type ComputationColumnGroup =
    | { type: 'ROWNUMBER'; rowNumberFieldName: string }
    | { type: 'SKIPPED'; inputFieldName: string; inputFieldType: string; inputFieldNullable: boolean }
    | {
        type: 'ORDINAL';
        inputFieldName: string;
        inputFieldType: string;
        inputFieldNullable: boolean;
        statsFields: ComputationStatsFields | null;
        binFieldName: string | null;
        binCount: number;
    }
    | {
        type: 'STRING' | 'LIST';
        inputFieldName: string;
        inputFieldType: string;
        inputFieldNullable: boolean;
        statsFields: ComputationStatsFields | null;
        valueIdFieldName: string | null;
    };

/// A filter that compares a field with a number
export interface ComputationScalarFilter {
    fieldName: string;
    op: '=' | '<' | '<=' | '>' | '>=';
    value: number;
}

/// A key of an ordering, ascending and nulls last without
export interface ComputationOrderBy {
    field: string;
    ascending?: boolean | null;
    nullsFirst?: boolean | null;
}

/// The rows that pass the cross filters
export interface ComputationFilterTable {
    inputRowNumberColumnName: string;
    table: ComputationArrowTable;
    dataFrame: number;
    version: ComputationVersionValue;
}

/// The row numbers in the order of the grid
export interface ComputationOrderingTable {
    inputRowNumberColumnName: string;
    orderingConstraints: ComputationOrderBy[];
    table: ComputationArrowTable;
    dataFrame: number;
    version: ComputationVersionValue;
    dataSearchRequestId: number | null;
}

/// The rows that a data search matched
export interface ComputationDataSearchTable {
    inputRowNumberColumnName: string;
    table: ComputationArrowTable;
    dataFrame: number;
    version: ComputationVersionValue;
    requestId: number;
}

/// The statistics of all columns of a table, the table names the statistics of the host with their formatter
export interface ComputationTableAggregation {
    table: number;
    dataFrame: number;
    countStarFieldName: string;
}

/// The summary of a column, the id names the summary of the host
export type ComputationColumnAggregate =
    | { kind: 'ordinal' | 'string' | 'list'; id: number; dataFrame: number }
    | { kind: 'skipped' };

/// The summary of a column over the rows that the filters and the data search select
export interface ComputationFilteredAggregate {
    aggregate: ComputationColumnAggregate;
    filterVersion: ComputationVersionValue;
    dataSearchRequestId: number | null;
}

/// A summary of a column as a snapshot names it, the id and the data frame are null for a skipped column
export interface ComputationColumnAggregateSnapshot {
    kind: 'ordinal' | 'string' | 'list' | 'skipped';
    id: number | null;
    dataFrame: number | null;
}

/// The summary of a column to compute
export interface ComputationColumnTask {
    tableId: number;
    tableVersion: ComputationVersionValue;
    columnId: number;
    columnEntry: ComputationColumnGroup | null;
    inputDataFrame: number;
    tableAggregate: ComputationTableAggregation | null;
}

/// A task of the scheduler
export type ComputationTask =
    | {
        kind: 'tableFiltering';
        tableId: number;
        tableVersion: ComputationVersionValue;
        inputDataTable: ComputationArrowTable;
        inputDataFrame: number;
        rowNumberColumnName: string;
        filters: ComputationScalarFilter[];
    }
    | {
        kind: 'tableOrdering';
        tableId: number;
        tableVersion: ComputationVersionValue;
        inputDataTable: ComputationArrowTable;
        inputDataFrame: number;
        filterTable: ComputationFilterTable | null;
        dataSearchTable: ComputationDataSearchTable | null;
        rowNumberColumnName: string;
        orderingConstraints: ComputationOrderBy[];
    }
    | {
        kind: 'tableAggregation';
        tableId: number;
        tableVersion: ComputationVersionValue;
        columnEntries: ComputationColumnGroup[];
        inputDataFrame: number;
    }
    | {
        kind: 'systemColumns';
        tableId: number;
        tableVersion: ComputationVersionValue;
        columnEntries: ComputationColumnGroup[];
        inputTable: ComputationArrowTable;
        inputDataFrame: number;
        rowNumberFieldName: string;
        tableAggregate: ComputationTableAggregation | null;
    }
    | ({ kind: 'columnAggregation' } & ComputationColumnTask)
    | ({
        kind: 'filteredColumnAggregation';
        filterTable: ComputationFilterTable | null;
        dataSearchTable: ComputationDataSearchTable | null;
        selectionRowCount: number;
        unfilteredAggregate: ComputationColumnAggregate | null;
    } & ComputationColumnTask)
    | {
        kind: 'dataSearch';
        tableId: number;
        tableVersion: ComputationVersionValue;
        inputDataFrame: number;
        rowNumberColumnName: string;
        columns: { columnIdx: number; columnGroupIdx: number; fieldName: string }[];
        pattern: string;
        requestId: number;
    };

/// The status of a task: running 1, succeeded 2, failed 3
export type ComputationTaskStatus = 1 | 2 | 3;

/// An update of the progress of a task, it sets what it has. Times in milliseconds since epoch.
export interface ComputationProgressUpdate {
    status?: ComputationTaskStatus | null;
    startedAt?: number | null;
    completedAt?: number | null;
    failedAt?: number | null;
    failedWithError?: string | null;
}

/// The selection in the summary of a column
export type ComputationCrossFilter =
    | { column: number; kind: 'histogram'; selection: [number, number]; filters: ComputationScalarFilter[] }
    | { column: number; kind: 'mostFrequent'; valueId: number; filters: ComputationScalarFilter[] };

/// The matching columns of the rows of a data search by row number from 1
export type ComputationMatchingRows = ReadonlyMap<number, readonly number[]>;

/// What the host does after an action, in this order
export type ComputationEffect =
    /// Abort the lifetime of a computation that was dropped or replaced
    | { type: 'abortComputation'; tableId: number; lifetime: number }
    /// Abort a data search that was superseded
    | { type: 'abortDataSearch'; tableId: number; requestId: number }
    /// Nothing in the state holds the data frame anymore
    | { type: 'releaseDataFrame'; dataFrame: number }
    /// Nothing in the state holds the Arrow table anymore
    | { type: 'releaseArrowTable'; table: number };

/// What an action did
export interface ComputationOutcome {
    /// Did the action change the state? A result that is dropped changes nothing.
    changed: boolean;
    /// The effects for the host, in order
    effects: ComputationEffect[];
    /// The id of a scheduled task, null if it was dropped
    taskId: number | null;
}

/// The progress of a task, times in milliseconds since epoch
export interface ComputationTaskProgress {
    status: ComputationTaskStatus;
    startedAt: number;
    completedAt: number | null;
    failedAt: number | null;
    failedWithError: string | null;
}

/// A task that a computation tracks, the latest of its kind
export interface ComputationTrackedTask {
    /// The task of the scheduler that the computation tracks
    taskId: number;
    /// The version that the task computes for
    version: ComputationVersionValue;
    /// The ordering of an ordering task, cleared with the ordering of the table
    orderingConstraints?: ComputationOrderBy[];
    progress: ComputationTaskProgress;
}

/// The search of a result, of its columns or of its data
export interface ComputationSearchSnapshot {
    requestedPattern: string;
    appliedPattern: string;
    requestId: number;
    appliedRequestId: number;
    matchingColumnGroups: number[] | null;
    /// Does the search hold matching rows? They are the rows of the last data search that the host handed over.
    hasMatchingRows: boolean;
    pending: boolean;
    error: string | null;
}

/// The fields of a computation. The ids name the objects of the host.
export interface ComputationSnapshot {
    tableId: number;
    connectionId: string | null;
    lifetime: number;
    revision: number;
    version: ComputationVersionValue;
    dataTable: ComputationArrowTable;
    dataFrame: number | null;
    dataTableOrdering: ComputationOrderBy[];
    /// The filter, ordering and search tables by the ids of their tables
    filterTable: number | null;
    orderingTable: number | null;
    dataSearchTable: number | null;
    columnSearch: ComputationSearchSnapshot;
    dataSearch: ComputationSearchSnapshot;
    rowNumberColumnGroup: number | null;
    rowNumberColumnName: string | null;
    /// The statistics by the id of their table
    tableAggregation: number | null;
    columnAggregates: (ComputationColumnAggregateSnapshot | null)[];
    filteredColumnAggregates: ({
        aggregate: ComputationColumnAggregateSnapshot;
        filterVersion: ComputationVersionValue;
        dataSearchRequestId: number | null;
    } | null)[];
    filteredColumnAggregatesOutdated: boolean[];
    tasks: {
        tableAggregation: ComputationTrackedTask | null;
        systemColumns: ComputationTrackedTask | null;
        filtering: ComputationTrackedTask | null;
        ordering: ComputationTrackedTask | null;
        dataSearch: ComputationTrackedTask | null;
        columnAggregation: (ComputationTrackedTask | null)[];
        filteredColumnAggregation: (ComputationTrackedTask | null)[];
    };
}

/// A task of the scheduler: its table and the version it computes for
export interface ComputationSchedulerTaskSnapshot {
    tableId: number;
    version: ComputationVersionValue;
}

type NativeComputations = glue.Computations;

export class DashQLComputations {
    public readonly ptr: Ptr<typeof COMPUTATIONS_TYPE, NativeComputations>;

    public constructor(ptr: Ptr<typeof COMPUTATIONS_TYPE, NativeComputations>) {
        this.ptr = ptr;
    }

    /// A state without computations
    public static create(api: DashQL): DashQLComputations {
        return new DashQLComputations(new Ptr(COMPUTATIONS_TYPE, api, new api.bindings.Computations()));
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    private outcome(outcome: glue.ComputationOutcome): ComputationOutcome {
        try {
            return {
                changed: outcome.changed,
                effects: JSON.parse(outcome.effects) as ComputationEffect[],
                taskId: outcome.taskId ?? null,
            };
        } finally {
            outcome.free();
        }
    }

    // Actions

    /// Schedule a task, it becomes the latest task of its kind of its computation. A task of an unknown computation
    /// is dropped.
    public scheduleTask(task: ComputationTask, now: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().scheduleTask(JSON.stringify(task), now));
    }

    public updateSchedulerTask(taskId: number, progress: ComputationProgressUpdate, now: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().updateSchedulerTask(taskId, JSON.stringify(progress), now));
    }

    public unregisterSchedulerTask(taskId: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().unregisterSchedulerTask(taskId));
    }

    /// Start the computation of a result table, it replaces an earlier computation of the table
    public computationFromQueryResult(
        tableId: number,
        dataTable: ComputationArrowTable,
        fields: string[],
        columnGroups: ComputationColumnGroup[],
        lifetime: number,
        connectionId: string | null,
        clientContext: string | null,
    ): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().computationFromQueryResult(
            tableId, dataTable.id, dataTable.rows, fields, JSON.stringify(columnGroups), lifetime, connectionId ?? undefined, clientContext ?? undefined,
        ));
    }

    public deleteComputation(tableId: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().deleteComputation(tableId));
    }

    public createdDataFrame(tableId: number, dataFrame: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().createdDataFrame(tableId, dataFrame));
    }

    public tableOrderingSucceeded(tableId: number, ordering: ComputationOrderingTable, now: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().tableOrderingSucceeded(tableId, JSON.stringify(ordering), now));
    }

    public clearTableOrdering(tableId: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().clearTableOrdering(tableId));
    }

    public tableFilteringSucceeded(tableId: number, version: ComputationVersionValue, filter: ComputationFilterTable | null, now: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().tableFilteringSucceeded(
            tableId, version.data, version.filter, filter == null ? undefined : JSON.stringify(filter), now,
        ));
    }

    public tableAggregationSucceeded(tableId: number, aggregation: ComputationTableAggregation, now: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().tableAggregationSucceeded(tableId, JSON.stringify(aggregation), now));
    }

    public systemColumnsSucceeded(
        tableId: number,
        dataTable: ComputationArrowTable,
        dataFrame: number,
        columnGroups: ComputationColumnGroup[],
        now: number,
    ): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().systemColumnsSucceeded(
            tableId, dataTable.id, dataTable.rows, dataFrame, JSON.stringify(columnGroups), now,
        ));
    }

    public columnAggregationSucceeded(tableId: number, columnId: number, aggregate: ComputationColumnAggregate, now: number): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().columnAggregationSucceeded(tableId, columnId, JSON.stringify(aggregate), now));
    }

    public filteredColumnAggregationSucceeded(
        tableId: number,
        columnId: number,
        version: ComputationVersionValue,
        aggregate: ComputationFilteredAggregate | null,
        now: number,
    ): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().filteredColumnAggregationSucceeded(
            tableId, columnId, version.data, version.filter, aggregate == null ? undefined : JSON.stringify(aggregate), now,
        ));
    }

    /// Set the cross filters, the same selections change nothing
    public setCrossFilters(tableId: number, filters: readonly ComputationCrossFilter[]): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().setCrossFilters(tableId, JSON.stringify({ columnFilters: filters })));
    }

    /// Request a search of the columns or the data, an empty pattern ends the search
    public setResultSearchPattern(tableId: number, kind: 'columns' | 'data', pattern: string): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().setResultSearchPattern(tableId, kind === 'data', pattern));
    }

    public columnSearchSucceeded(tableId: number, dataFrame: number, requestId: number, matchingColumnGroups: readonly number[]): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().columnSearchSucceeded(tableId, dataFrame, requestId, Uint32Array.from(matchingColumnGroups)));
    }

    public dataSearchSucceeded(
        tableId: number,
        dataFrame: number,
        requestId: number,
        search: ComputationDataSearchTable,
        matchingRows: ComputationMatchingRows,
        now: number,
    ): ComputationOutcome {
        const rows = new Float64Array(matchingRows.size);
        const offsets = new Uint32Array(matchingRows.size + 1);
        const columns: number[] = [];
        let i = 0;
        for (const [row, rowColumns] of matchingRows) {
            rows[i] = row;
            offsets[i] = columns.length;
            for (const column of rowColumns) columns.push(column);
            ++i;
        }
        offsets[i] = columns.length;
        return this.outcome(this.ptr.assertNotNull().dataSearchSucceeded(
            tableId, dataFrame, requestId, JSON.stringify(search), rows, offsets, Uint32Array.from(columns), now,
        ));
    }

    public dataSearchFailed(tableId: number, dataFrame: number, requestId: number, error: string): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().dataSearchFailed(tableId, dataFrame, requestId, error));
    }

    public resultSearchFailed(tableId: number, dataFrame: number, kind: 'columns' | 'data', requestId: number, error: string): ComputationOutcome {
        return this.outcome(this.ptr.assertNotNull().resultSearchFailed(tableId, dataFrame, kind === 'data', requestId, error));
    }

    // Reading the state

    /// The revision of the state, it changes with every change
    public revision(): number {
        return this.ptr.assertNotNull().revision();
    }

    /// The id of the next scheduled task
    public nextTaskId(): number {
        return this.ptr.assertNotNull().nextTaskId();
    }

    /// The tables with a computation
    public tableIds(): number[] {
        return Array.from(this.ptr.assertNotNull().tableIds());
    }

    /// The revision of the computation of a table, null without one
    public computationRevision(tableId: number): number | null {
        return this.ptr.assertNotNull().computationRevision(tableId) ?? null;
    }

    /// The fields of the computation of a table
    public computationSnapshot(tableId: number): ComputationSnapshot {
        return JSON.parse(this.ptr.assertNotNull().computationSnapshot(tableId)) as ComputationSnapshot;
    }

    /// The tasks of the scheduler
    public schedulerTaskIds(): number[] {
        return Array.from(this.ptr.assertNotNull().schedulerTaskIds());
    }

    /// The table and the version of a task of the scheduler, null for an unknown task
    public schedulerTaskSnapshot(taskId: number): ComputationSchedulerTaskSnapshot | null {
        const snapshot = this.ptr.assertNotNull().schedulerTaskSnapshot(taskId);
        return snapshot == null ? null : JSON.parse(snapshot) as ComputationSchedulerTaskSnapshot;
    }

    /// The tasks that the state knows: the tasks of the scheduler and the ones that the computations track
    public taskIds(): number[] {
        return Array.from(this.ptr.assertNotNull().taskIds());
    }

    public holdsDataFrame(dataFrame: number): boolean {
        return this.ptr.assertNotNull().holdsDataFrame(dataFrame);
    }

    public holdsArrowTable(table: number): boolean {
        return this.ptr.assertNotNull().holdsArrowTable(table);
    }
}
