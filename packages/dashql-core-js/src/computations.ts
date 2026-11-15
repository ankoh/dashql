import { DashQL, Ptr } from './api.js';
import type * as glue from './wasm/dashql_core.js';
import type {
    ComputationArrowTable,
    ComputationColumnAggregate,
    ComputationColumnGroup,
    ComputationCrossFilter,
    ComputationDataSearchTable,
    ComputationFilteredAggregate,
    ComputationFilterTable,
    ComputationOrderingTable,
    ComputationOutcome,
    ComputationProgressUpdate,
    ComputationSchedulerTaskSnapshot,
    ComputationSnapshot,
    ComputationTableAggregation,
    ComputationTask,
    ComputationVersionValue,
} from './wasm/dashql_core.js';

/// The computations of result tables in the Rust runtime (`packages/dashql-core-runtime/src/compute`, see
/// docs/wip/core_runtime.md): the summaries of the columns, the statistics of a table, the system columns, the cross
/// filters, the ordering and the searches, and the tasks of the scheduler that compute them.
///
/// The Arrow tables of the state are Rust values with ids: the host registers a table of its own as Arrow IPC before
/// the action that hands it over (`registerArrowTable`) and reads a table of the state as Arrow IPC once
/// (`arrowTableIpc`). The data frames and the lifetimes are ids of the host. The state owns the data frames it holds:
/// an action returns an effect to release a data frame once nothing in the state holds it. A computation changes its
/// revision with every change.
///
/// The tasks run in Rust on the compute database of the host (`ComputeHost`, set with `setHost`): `analyzeTable`
/// analyzes a result, `runTask` runs a scheduled task. The service drops the data frames that the state releases
/// through the host.

const COMPUTATIONS_TYPE = Symbol('COMPUTATIONS_TYPE');

/// The views of the computations, declared by the module (`packages/dashql-core-wasm/src/computations/view.rs`)
export type {
    ComputationArrowTable,
    ComputationBinBounds,
    ComputationColumnAggregate,
    ComputationColumnGroup,
    ComputationColumnSummary,
    ComputationColumnTask,
    ComputationCrossFilter,
    ComputationDataSearchColumn,
    ComputationDataSearchTable,
    ComputationDataSearchTableSnapshot,
    ComputationEffect,
    ComputationFilteredAggregate,
    ComputationFilterOp,
    ComputationFilterTable,
    ComputationFilterTableSnapshot,
    ComputationOrderBy,
    ComputationOrderingTable,
    ComputationOrderingTableSnapshot,
    ComputationOutcome,
    ComputationProgressUpdate,
    ComputationScalarFilter,
    ComputationSchedulerTaskSnapshot,
    ComputationSearchSnapshot,
    ComputationSnapshot,
    ComputationStatsFields,
    ComputationSummaryAnalysis,
    ComputationTableAggregation,
    ComputationTask,
    ComputationTaskProgress,
    ComputationTasksSnapshot,
    ComputationTrackedTask,
    ComputationVersionValue,
    ComputeCallContext,
} from './wasm/dashql_core.js';
/// The status of a task, a numeric enum of the module
export { TaskStatus } from './wasm/dashql_core.js';

/// The matching columns of the rows of a data search by row number from 1
export type ComputationMatchingRows = ReadonlyMap<number, readonly number[]>;

type NativeComputations = glue.Computations;

/// The compute database of the computations, see `ComputeHost` of the module
export type ComputeHost = glue.ComputeHost;

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

    /// The Rust computations, their methods take and return the views
    private get native(): NativeComputations {
        return this.ptr.assertNotNull();
    }

    // Services

    /// Set the compute host, the tasks run on its compute database
    public setHost(host: ComputeHost): void {
        this.native.setHost(host);
    }

    /// A new id of a data frame, an Arrow table or a lifetime of the host
    public allocateId(): number {
        return this.native.allocateId();
    }

    /// Register a table of the host as an Arrow IPC stream, the next action names it by the returned id. The tables
    /// that the action doesn't take go.
    public registerArrowTable(ipc: Uint8Array): number {
        return this.native.registerArrowTable(ipc);
    }

    /// A table of the state as an Arrow IPC stream
    public arrowTableIpc(table: number): Uint8Array {
        return this.native.arrowTableIpc(table);
    }

    /// The tables that the state holds
    public arrowTableIds(): number[] {
        return Array.from(this.native.arrowTableIds());
    }

    /// Analyze a result as Arrow IPC: start its computation, import it, compute its statistics, its system columns and
    /// the summaries of its columns. Rejects with the error of a failed task.
    public analyzeTable(tableId: number, ipc: Uint8Array, connectionId: string | null, clientContext: string | null, columnAggregates: boolean): Promise<void> {
        return this.native.analyzeTable(tableId, ipc, connectionId, clientContext, columnAggregates) as Promise<void>;
    }

    /// Run a scheduled task on the compute host, rejects with its error
    public runTask(taskId: number): Promise<void> {
        return this.native.runTask(taskId) as Promise<void>;
    }

    /// Cancel the run of a task, it fails
    public cancelTask(taskId: number): void {
        this.native.cancelTask(taskId);
    }

    // Actions

    /// Schedule a task, it becomes the latest task of its kind of its computation. A task of an unknown computation
    /// is dropped.
    public scheduleTask(task: ComputationTask, now: number): ComputationOutcome {
        return this.native.scheduleTask(task, now);
    }

    public updateSchedulerTask(taskId: number, progress: ComputationProgressUpdate, now: number): ComputationOutcome {
        return this.native.updateSchedulerTask(taskId, progress, now);
    }

    public unregisterSchedulerTask(taskId: number): ComputationOutcome {
        return this.native.unregisterSchedulerTask(taskId);
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
        return this.native.computationFromQueryResult(tableId, dataTable.id, fields, columnGroups, lifetime, connectionId, clientContext);
    }

    public deleteComputation(tableId: number): ComputationOutcome {
        return this.native.deleteComputation(tableId);
    }

    public createdDataFrame(tableId: number, dataFrame: number): ComputationOutcome {
        return this.native.createdDataFrame(tableId, dataFrame);
    }

    public tableOrderingSucceeded(tableId: number, ordering: ComputationOrderingTable, now: number): ComputationOutcome {
        return this.native.tableOrderingSucceeded(tableId, ordering, now);
    }

    public clearTableOrdering(tableId: number): ComputationOutcome {
        return this.native.clearTableOrdering(tableId);
    }

    public tableFilteringSucceeded(tableId: number, version: ComputationVersionValue, filter: ComputationFilterTable | null, now: number): ComputationOutcome {
        return this.native.tableFilteringSucceeded(tableId, version.data, version.filter, filter ?? undefined, now);
    }

    public tableAggregationSucceeded(tableId: number, aggregation: ComputationTableAggregation, now: number): ComputationOutcome {
        return this.native.tableAggregationSucceeded(tableId, aggregation, now);
    }

    public systemColumnsSucceeded(
        tableId: number,
        dataTable: ComputationArrowTable,
        dataFrame: number,
        columnGroups: ComputationColumnGroup[],
        now: number,
    ): ComputationOutcome {
        return this.native.systemColumnsSucceeded(tableId, dataTable.id, dataFrame, columnGroups, now);
    }

    public columnAggregationSucceeded(tableId: number, columnId: number, aggregate: ComputationColumnAggregate, now: number): ComputationOutcome {
        return this.native.columnAggregationSucceeded(tableId, columnId, aggregate, now);
    }

    public filteredColumnAggregationSucceeded(
        tableId: number,
        columnId: number,
        version: ComputationVersionValue,
        aggregate: ComputationFilteredAggregate | null,
        now: number,
    ): ComputationOutcome {
        return this.native.filteredColumnAggregationSucceeded(tableId, columnId, version.data, version.filter, aggregate ?? undefined, now);
    }

    /// Set the cross filters, the same selections change nothing
    public setCrossFilters(tableId: number, filters: readonly ComputationCrossFilter[]): ComputationOutcome {
        return this.native.setCrossFilters(tableId, [...filters]);
    }

    /// Request a search of the columns or the data, an empty pattern ends the search
    public setResultSearchPattern(tableId: number, kind: 'columns' | 'data', pattern: string): ComputationOutcome {
        return this.native.setResultSearchPattern(tableId, kind === 'data', pattern);
    }

    public columnSearchSucceeded(tableId: number, dataFrame: number, requestId: number, matchingColumnGroups: readonly number[]): ComputationOutcome {
        return this.native.columnSearchSucceeded(tableId, dataFrame, requestId, Uint32Array.from(matchingColumnGroups));
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
        return this.native.dataSearchSucceeded(tableId, dataFrame, requestId, search, rows, offsets, Uint32Array.from(columns), now);
    }

    public dataSearchFailed(tableId: number, dataFrame: number, requestId: number, error: string): ComputationOutcome {
        return this.native.dataSearchFailed(tableId, dataFrame, requestId, error);
    }

    public resultSearchFailed(tableId: number, dataFrame: number, kind: 'columns' | 'data', requestId: number, error: string): ComputationOutcome {
        return this.native.resultSearchFailed(tableId, dataFrame, kind === 'data', requestId, error);
    }

    // Reading the state

    /// The revision of the state, it changes with every change
    public revision(): number {
        return this.native.revision();
    }

    /// The id of the next scheduled task
    public nextTaskId(): number {
        return this.native.nextTaskId();
    }

    /// The tables with a computation
    public tableIds(): number[] {
        return Array.from(this.native.tableIds());
    }

    /// The revision of the computation of a table, null without one
    public computationRevision(tableId: number): number | null {
        return this.native.computationRevision(tableId) ?? null;
    }

    /// The fields of the computation of a table, a new object with every call
    public computationSnapshot(tableId: number): ComputationSnapshot {
        return this.native.computationSnapshot(tableId);
    }

    /// The tasks of the scheduler
    public schedulerTaskIds(): number[] {
        return Array.from(this.native.schedulerTaskIds());
    }

    /// The table and the version of a task of the scheduler, null for an unknown task
    public schedulerTaskSnapshot(taskId: number): ComputationSchedulerTaskSnapshot | null {
        return this.native.schedulerTaskSnapshot(taskId) ?? null;
    }

    /// The tasks that the state knows: the tasks of the scheduler and the ones that the computations track
    public taskIds(): number[] {
        return Array.from(this.native.taskIds());
    }

    public holdsDataFrame(dataFrame: number): boolean {
        return this.native.holdsDataFrame(dataFrame);
    }

    public holdsArrowTable(table: number): boolean {
        return this.native.holdsArrowTable(table);
    }
}
