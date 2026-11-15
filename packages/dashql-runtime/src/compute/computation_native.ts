import * as core from '@ankoh/dashql-core';
import * as arrow from 'apache-arrow';

import {
    ANALYZE_TABLE,
    COLUMN_AGGREGATION_SUCCEEDED,
    COMPUTATION_FROM_QUERY_RESULT,
    CLEAR_TABLE_ORDERING,
    COLUMN_SEARCH_SUCCEEDED,
    CREATED_DATA_FRAME,
    DATA_SEARCH_FAILED,
    DATA_SEARCH_SUCCEEDED,
    DELETE_COMPUTATION,
    FILTERED_COLUMN_AGGREGATION_SUCCEEDED,
    RESULT_SEARCH_FAILED,
    SCHEDULE_TASK,
    SET_CROSS_FILTERS,
    SET_RESULT_SEARCH_PATTERN,
    SYSTEM_COLUMN_COMPUTATION_SUCCEEDED,
    TABLE_AGGREGATION_SUCCEEDED,
    TABLE_FILTERING_SUCCEEDED,
    TABLE_ORDERING_SUCCEDED,
    UNREGISTER_SCHEDULER_TASK,
    UPDATE_SCHEDULER_TASK,
    createArrowFieldIndex,
    type AnalyzeTableRequest,
    type ComputationAction,
    type ComputationState,
    type TableComputationState,
    type TableComputationTasks,
} from './computation_state.js';
import {
    COLUMN_AGGREGATION_TASK,
    ComputationStateVersion,
    DATA_SEARCH_TASK,
    FILTERED_COLUMN_AGGREGATION_TASK,
    LIST_COLUMN,
    ORDINAL_COLUMN,
    ROWNUMBER_COLUMN,
    SKIPPED_COLUMN,
    STRING_COLUMN,
    SYSTEM_COLUMN_COMPUTATION_TASK,
    TABLE_AGGREGATION_TASK,
    TABLE_FILTERING_TASK,
    TABLE_ORDERING_TASK,
    type ColumnAggregationVariant,
    type ColumnGroup,
    type ColumnStatsFields,
    type DataSearchTable,
    type FilterTable,
    type OrderingTable,
    type OrdinalColumnAnalysis,
    type OrdinalGridColumnGroup,
    type ResultSearchState,
    type StringColumnAnalysis,
    type TableAggregation,
    type TaskProgress,
    type TaskStatus,
    type TaskVariant,
    type WithFilterEpoch,
    type WithProgress,
} from './computation_types.js';
import { ArrowTableFormatter } from './arrow_formatter.js';
import { executeDirectly, type CreateComputeQueryExecution } from './computation_tasks.js';
import { CrossFilters, HISTOGRAM_FILTER } from './cross_filters.js';
import { DataFrame, type DataFrameRegistry } from './data_frame.js';
import type { OrderByConstraint } from './sql/sqlframe_builder.js';
import { parseDataSearchMatches } from './sql/query_result_search_sql.js';
import type { EmbeddedClientContext, EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { LoggableException, stringifyError, type LoggerLike } from '../platform/logger/logger.js';

/// The computations of result tables in Rust (`packages/dashql-core-runtime/src/compute`, docs/wip/core_runtime.md).
///
/// The Rust state holds the computations, the tasks of the scheduler and the Arrow tables. The tasks of a computation
/// that an analysis started (`ANALYZE_TABLE`, see analyze_table.ts) run in Rust on the compute database:
/// `NativeComputations` is their compute host, it creates, reads and drops the tables of the data frames and tracks
/// the queries of the tasks (`setQueryExecution`). A computation that an action of the host started runs its tasks on
/// the scheduler of the host, e.g. in tests that hand over their own results.
///
/// The JS objects of the state have ids: the Arrow tables of the host are registered as Arrow IPC with the action that
/// hands them over, the tables of the state are read as Arrow IPC once and wrapped like the results of the tasks of the
/// host (filter, ordering and search tables, the statistics with their formatter, the summaries with their analysis).
/// The data frames and the lifetimes are ids of the host, a data frame that the state releases is dropped unless the
/// host still reads it (`DataFrameRegistry`). `project` builds the `ComputationState` objects of the app: a computation
/// keeps its object while its revision doesn't move, and the parts of a changed computation keep theirs while they are
/// the same.

const LOG_CTX = 'computation_native';

/// The JS objects of a computation that the Rust state knows only by its lifetime
interface ComputationHost {
    /// The lifetime, aborted when the computation goes
    lifetime: AbortController;
    /// The client context of the queries of the computation
    clientContext: EmbeddedClientContext | null;
    /// The fields of the table the computation was created with
    fieldIndex: Map<string, number>;
    /// The fields of the result by name, the column groups of a computation of the runtime take their types
    fields: Map<string, arrow.Field>;
    /// The column groups of the grid, the ones the computation was created with or the ones of its system columns
    columnGroups: ColumnGroup[];
    /// The column groups of a computation of the runtime with the JSON of the snapshot they were built from
    columnGroupsKey: string | null;
    /// The cross filters that the state accepted last
    crossFilters: CrossFilters;
    /// The matching rows of the data search that the state accepted last
    matchingRows: Map<number, number[]> | null;
    /// The table of the data search of the runtime that the matching rows come from
    matchingRowsOf: number | null;
    /// Do the tasks of the computation run in Rust?
    native: boolean;
}

/// What a projected task was built from
interface ProjectedTask {
    key: string;
    variant: TaskVariant | null;
}

/// What kind of object an id names
type ObjectKind = 'frame' | 'table';

/// What the computations need of the platform to run their tasks
export interface ComputationsHostOptions {
    /// The data frames that the host reads
    memory: DataFrameRegistry;
    /// The log of the tasks
    logger: LoggerLike;
    /// A task changed the state
    onChange: () => void;
}

/// The context of a call of the compute host
interface ComputeCallContext {
    tableId: number;
    title: string;
    connectionId: string | null;
    clientContext: string | null;
    run: number;
}

/// The summary of a skipped column, it has no data
const SKIPPED_AGGREGATE: ColumnAggregationVariant = { type: SKIPPED_COLUMN, value: null };

/// The formats of the lower bounds of the bins of temporal columns
const TEMPORAL_BOUND_FORMAT = Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'medium' });

const NO_LOGGER: LoggerLike = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    exception: () => {},
};

/// Is a value an Arrow table? A bundle may hold two copies of apache-arrow.
function isArrowTable(table: unknown): table is arrow.Table {
    return table != null && typeof table === 'object' && Array.isArray((table as arrow.Table).batches) && (table as arrow.Table).schema != null;
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new LoggableException(stringifyError(error), {}, LOG_CTX);
}

export class NativeComputations implements core.ComputeHost {
    /// The Rust state
    readonly computations: core.DashQLComputations;
    /// The JS objects by id: data frames, Arrow tables, the filter, ordering and search tables, the statistics and
    /// the summaries
    private readonly objects = new Map<number, object>();
    /// The ids of the JS objects
    private readonly ids = new WeakMap<object, number>();
    /// What kind of object an id names
    private readonly kinds = new Map<number, ObjectKind>();
    /// The ids that the current action gave out
    private fresh: number[] = [];
    /// The JS objects of the computations by lifetime
    private readonly hosts = new Map<number, ComputationHost>();
    /// The lifetime of the computation of a table
    private readonly lifetimes = new Map<number, number>();
    /// The JS objects of the analyses that started, by table, until their computation is projected
    private readonly analyses = new Map<number, { lifetime: AbortController; clientContext: EmbeddedClientContext | null }>();
    /// The tasks as the app scheduled them by task id, with their task id
    private readonly tasks = new Map<number, TaskVariant>();
    /// The tasks of the app that run in Rust
    private readonly nativeTasks = new Set<number>();
    /// The errors of failed tasks by task id
    private readonly errors = new Map<number, LoggableException>();
    /// The projected computations by table with the revision they were projected at
    private projected = new Map<number, { revision: number; state: TableComputationState }>();
    /// What the projected tasks were built from
    private readonly projectedTasks = new WeakMap<object, ProjectedTask>();
    /// The last projection
    private last: ComputationState | null = null;
    /// The matching rows of a data search that the action hands over
    private pendingMatchingRows: Map<number, number[]> | null = null;

    /// The compute database of the computations of the runtime
    private database: EmbeddedComputeDatabase | null = null;
    /// The data frames that the host reads
    private memory: DataFrameRegistry | null = null;
    private logger: LoggerLike = NO_LOGGER;
    private onChange: (() => void) | null = null;
    /// The execution of the queries of a task, e.g. tracked in the query history
    private queryExecution: CreateComputeQueryExecution | null = null;
    /// The abort controllers of the calls of the runs
    private readonly runs = new Map<number, Set<AbortController>>();

    private constructor(computations: core.DashQLComputations) {
        this.computations = computations;
        this.computations.setHost(this);
    }

    /// Create the computations of an instance of the core: through the instance, a bundle can hold two copies of the
    /// core package
    static create(instance: core.DashQL): ComputationState {
        return new NativeComputations(instance.createComputations()).project();
    }

    /// Give the computations what they need to run their tasks
    attach(options: ComputationsHostOptions): void {
        this.memory = options.memory;
        this.logger = options.logger;
        this.onChange = options.onChange;
    }

    /// Track the queries of the tasks, e.g. in the query history of the connection of a computation
    setQueryExecution(create: CreateComputeQueryExecution | null): void {
        this.queryExecution = create;
    }

    /// Does a task of the app run in Rust? The scheduler of the host leaves it alone.
    runsTask(taskId: number): boolean {
        return this.nativeTasks.has(taskId);
    }

    /// Free the Rust state and abort the lifetimes of the computations
    destroy(): void {
        for (const host of this.hosts.values()) host.lifetime.abort();
        for (const controllers of this.runs.values()) for (const controller of controllers) controller.abort();
        this.runs.clear();
        this.hosts.clear();
        this.lifetimes.clear();
        this.objects.clear();
        this.kinds.clear();
        this.tasks.clear();
        this.nativeTasks.clear();
        this.projected.clear();
        this.onChange = null;
        this.computations.destroy();
    }

    // Ids

    /// Remember an object by its id
    private remember(id: number, object: object, kind: ObjectKind): void {
        this.ids.set(object, id);
        this.objects.set(id, object);
        this.kinds.set(id, kind);
    }

    /// The id of a data frame, a new one for one that the state doesn't know. 0 for none.
    private frame(dataFrame: DataFrame | null | undefined): number {
        if (dataFrame == null) return 0;
        let id = this.ids.get(dataFrame);
        if (id === undefined) {
            id = this.computations.allocateId();
            this.remember(id, dataFrame, 'frame');
            this.fresh.push(id);
        }
        return id;
    }

    /// The id of an object with an Arrow table, e.g. a filter table. The table of an object that the state doesn't
    /// know is registered as Arrow IPC for the action. 0 for none.
    private tableId(object: object | null | undefined, table: arrow.Table | null | undefined): number {
        if (object == null) return 0;
        let id = this.ids.get(object);
        if (id === undefined) {
            const ipc = isArrowTable(table) ? arrow.tableToIPC(table, 'stream') : arrow.tableToIPC(arrow.tableFromArrays({}), 'stream');
            id = this.computations.registerArrowTable(ipc);
            this.remember(id, object, 'table');
            this.fresh.push(id);
        }
        return id;
    }

    /// The id of an object that the state knows, 0 for an unknown one. Identifies the source of a result, which the
    /// state doesn't take.
    private knownIdOf(object: object | null | undefined): number {
        return object == null ? 0 : this.ids.get(object) ?? 0;
    }

    /// Forget an object, returns it
    private forget(id: number): object | undefined {
        const object = this.objects.get(id);
        if (object !== undefined) {
            this.objects.delete(id);
            this.ids.delete(object);
            this.kinds.delete(id);
        }
        return object;
    }

    private object<T>(id: number | null | undefined): T | null {
        return id == null ? null : (this.objects.get(id) as T | undefined) ?? null;
    }

    /// The object of an id, built once
    private objectOr<T extends object>(id: number, build: () => T | null): T | null {
        const known = this.objects.get(id);
        if (known !== undefined) return known as T;
        const built = build();
        if (built != null) this.remember(id, built, 'table');
        return built;
    }

    /// The data frame of an id, a data frame of the compute database for one that the runtime created
    private frameObject(id: number | null | undefined, clientContext: EmbeddedClientContext | null = null): DataFrame | null {
        if (id == null || id === 0) return null;
        let dataFrame = this.object<DataFrame>(id);
        if (dataFrame == null) {
            if (this.database == null) return null;
            dataFrame = new DataFrame(this.database, `__df_${id}`, clientContext);
            this.remember(id, dataFrame, 'frame');
        }
        if (this.computations.holdsDataFrame(id)) this.memory?.adoptByState(dataFrame);
        return dataFrame;
    }

    /// A table of the state, read as Arrow IPC
    private decodeTable(id: number): arrow.Table {
        return arrow.tableFromIPC(new Uint8Array(this.computations.arrowTableIpc(id)));
    }

    // The values of the Rust state

    private arrowTable(table: arrow.Table | null | undefined): core.ComputationArrowTable {
        return { id: this.tableId(table, table) };
    }

    private filterTable(filter: FilterTable | null | undefined): core.ComputationFilterTable | null {
        if (filter == null) return null;
        return {
            inputRowNumberColumnName: filter.inputRowNumberColumnName ?? '',
            // The filter is the object of its table
            table: { id: this.tableId(filter, filter.dataTable) },
            dataFrame: this.frame(filter.dataFrame),
            version: versionValue(filter.version),
        };
    }

    private orderingTable(ordering: OrderingTable): core.ComputationOrderingTable {
        return {
            inputRowNumberColumnName: ordering.inputRowNumberColumnName ?? '',
            orderingConstraints: ordering.orderingConstraints ?? [],
            table: { id: this.tableId(ordering, ordering.dataTable) },
            dataFrame: this.frame(ordering.dataFrame),
            version: versionValue(ordering.version),
            dataSearchRequestId: ordering.dataSearchRequestId ?? null,
        };
    }

    private dataSearchTable(search: DataSearchTable | null | undefined): core.ComputationDataSearchTable | null {
        if (search == null) return null;
        return {
            inputRowNumberColumnName: search.inputRowNumberColumnName ?? '',
            table: { id: this.tableId(search, search.dataTable) },
            dataFrame: this.frame(search.dataFrame),
            version: versionValue(search.version),
            requestId: search.requestId ?? 0,
        };
    }

    private tableAggregation(aggregation: TableAggregation | null | undefined): core.ComputationTableAggregation | null {
        if (aggregation == null) return null;
        // The statistics are the object of their table, with their formatter
        return { table: this.tableId(aggregation, aggregation.table), dataFrame: this.frame(aggregation.dataFrame), countStarFieldName: aggregation.countStarFieldName ?? '' };
    }

    /// A summary, the JS object is the object of the table of the binned or the frequent values
    private columnAggregate(aggregate: ColumnAggregationVariant | null | undefined): core.ComputationColumnAggregate {
        switch (aggregate?.type) {
            case ORDINAL_COLUMN:
                return { kind: 'ordinal', id: this.tableId(aggregate, aggregate.value?.binnedValues), dataFrame: this.frame(aggregate.value?.binnedDataFrame) };
            case STRING_COLUMN:
                return { kind: 'string', id: this.tableId(aggregate, aggregate.value?.frequentValuesTable), dataFrame: this.frame(aggregate.value?.frequentValuesDataFrame) };
            case LIST_COLUMN:
                return { kind: 'list', id: this.tableId(aggregate, aggregate.value?.frequentValuesTable), dataFrame: this.frame(aggregate.value?.frequentValuesDataFrame) };
            default:
                return { kind: 'skipped' };
        }
    }

    private task(variant: TaskVariant): core.ComputationTask {
        switch (variant.type) {
            case TABLE_FILTERING_TASK: {
                const task = variant.value;
                return {
                    kind: 'tableFiltering',
                    tableId: task.tableId,
                    tableVersion: versionValue(task.tableVersion),
                    inputDataTable: this.arrowTable(task.inputDataTable),
                    inputDataFrame: this.frame(task.inputDataFrame),
                    rowNumberColumnName: task.rowNumberColumnName ?? '',
                    filters: task.filters ?? [],
                };
            }
            case TABLE_ORDERING_TASK: {
                const task = variant.value;
                return {
                    kind: 'tableOrdering',
                    tableId: task.tableId,
                    tableVersion: versionValue(task.tableVersion),
                    inputDataTable: this.arrowTable(task.inputDataTable),
                    inputDataFrame: this.frame(task.inputDataFrame),
                    filterTable: this.filterTable(task.filterTable),
                    dataSearchTable: this.dataSearchTable(task.dataSearchTable),
                    rowNumberColumnName: task.rowNumberColumnName ?? '',
                    orderingConstraints: task.orderingConstraints ?? [],
                };
            }
            case TABLE_AGGREGATION_TASK: {
                const task = variant.value;
                return {
                    kind: 'tableAggregation',
                    tableId: task.tableId,
                    tableVersion: versionValue(task.tableVersion),
                    columnEntries: (task.columnEntries ?? []).map(columnGroupValue),
                    inputDataFrame: this.frame(task.inputDataFrame),
                };
            }
            case SYSTEM_COLUMN_COMPUTATION_TASK: {
                const task = variant.value;
                return {
                    kind: 'systemColumns',
                    tableId: task.tableId,
                    tableVersion: versionValue(task.tableVersion),
                    columnEntries: (task.columnEntries ?? []).map(columnGroupValue),
                    inputTable: this.arrowTable(task.inputTable),
                    inputDataFrame: this.frame(task.inputDataFrame),
                    rowNumberFieldName: task.rowNumberFieldName ?? '',
                    tableAggregate: this.tableAggregation(task.tableAggregate),
                };
            }
            case COLUMN_AGGREGATION_TASK: {
                const task = variant.value;
                return {
                    kind: 'columnAggregation',
                    tableId: task.tableId,
                    tableVersion: versionValue(task.tableVersion),
                    columnId: task.columnId ?? 0,
                    columnEntry: task.columnEntry == null ? null : columnGroupValue(task.columnEntry),
                    inputDataFrame: this.frame(task.inputDataFrame),
                    tableAggregate: this.tableAggregation(task.tableAggregate),
                };
            }
            case FILTERED_COLUMN_AGGREGATION_TASK: {
                const task = variant.value;
                return {
                    kind: 'filteredColumnAggregation',
                    tableId: task.tableId,
                    tableVersion: versionValue(task.tableVersion),
                    columnId: task.columnId ?? 0,
                    columnEntry: task.columnEntry == null ? null : columnGroupValue(task.columnEntry),
                    inputDataFrame: this.frame(task.inputDataFrame),
                    tableAggregate: this.tableAggregation(task.tableAggregate),
                    filterTable: this.filterTable(task.filterTable),
                    dataSearchTable: this.dataSearchTable(task.dataSearchTable),
                    selectionRowCount: task.selectionRowCount ?? 0,
                    unfilteredAggregate: this.columnAggregate(task.unfilteredAggregate),
                };
            }
            case DATA_SEARCH_TASK: {
                const task = variant.value;
                return {
                    kind: 'dataSearch',
                    tableId: task.tableId,
                    tableVersion: versionValue(task.tableVersion),
                    inputDataFrame: this.frame(task.inputDataFrame),
                    rowNumberColumnName: task.rowNumberColumnName ?? '',
                    columns: task.columns ?? [],
                    pattern: task.pattern ?? '',
                    requestId: task.requestId ?? 0,
                };
            }
        }
    }

    /// Remember a scheduled task. A filtering is computed for the filter version that scheduling it gave out.
    private registerTask(taskId: number, variant: TaskVariant): TaskVariant {
        const scheduled = this.computations.schedulerTaskSnapshot(taskId);
        let value = variant.value;
        if (scheduled != null && !sameVersion(value.tableVersion, scheduled.version)) {
            value = { ...value, tableVersion: new ComputationStateVersion(scheduled.version.data, scheduled.version.filter) };
        }
        const registered = { ...variant, value, taskId } as TaskVariant;
        this.tasks.set(taskId, registered);
        return registered;
    }

    // Actions

    /// Apply an action to the Rust state and run its effects. Returns the outcome, null for an action that doesn't
    /// reach the state.
    apply(action: ComputationAction, memory: DataFrameRegistry): core.ComputationOutcome | null {
        this.fresh = [];
        this.memory = memory;
        try {
            const outcome = this.call(action);
            if (outcome != null) this.settle(action, outcome, memory);
            return outcome;
        } finally {
            // The objects of an action that the state didn't take stay with the host
            for (const id of this.fresh) {
                const kind = this.kinds.get(id);
                if (kind === 'frame' && this.computations.holdsDataFrame(id)) {
                    memory.adoptByState(this.objects.get(id) as DataFrame);
                } else if (kind === 'table' && this.computations.holdsArrowTable(id)) {
                    continue;
                } else {
                    this.forget(id);
                }
            }
            this.fresh = [];
        }
    }

    private call(action: ComputationAction): core.ComputationOutcome | null {
        const computations = this.computations;
        const now = Date.now();
        switch (action.type) {
            case SCHEDULE_TASK: {
                const outcome = computations.scheduleTask(this.task(action.value), now);
                if (outcome.taskId != null) {
                    const registered = this.registerTask(outcome.taskId, action.value);
                    if (this.hostOfTable(action.value.value.tableId)?.native) this.runTask(outcome.taskId, registered);
                }
                return outcome;
            }
            case UPDATE_SCHEDULER_TASK: {
                const [task, progress] = action.value;
                if (task.taskId == null) return null;
                if (progress.failedWithError != null) this.errors.set(task.taskId, progress.failedWithError);
                return computations.updateSchedulerTask(task.taskId, progressUpdate(progress), now);
            }
            case UNREGISTER_SCHEDULER_TASK:
                if (action.value.taskId == null) return null;
                return computations.unregisterSchedulerTask(action.value.taskId);
            case COMPUTATION_FROM_QUERY_RESULT: {
                const [tableId, table, columnGroups, lifetime, connectionId, clientContext] = action.value;
                const lifetimeId = computations.allocateId();
                const outcome = computations.computationFromQueryResult(
                    tableId,
                    this.arrowTable(table),
                    table.schema.fields.map(field => field.name),
                    columnGroups.map(columnGroupValue),
                    lifetimeId,
                    connectionId ?? null,
                    clientContextJson(clientContext ?? null),
                );
                this.hosts.set(lifetimeId, {
                    lifetime,
                    clientContext: clientContext ?? null,
                    fieldIndex: createArrowFieldIndex(table),
                    fields: new Map(table.schema.fields.map(field => [field.name, field])),
                    columnGroups,
                    columnGroupsKey: null,
                    crossFilters: new CrossFilters(),
                    matchingRows: null,
                    matchingRowsOf: null,
                    native: false,
                });
                this.lifetimes.set(tableId, lifetimeId);
                return outcome;
            }
            case ANALYZE_TABLE:
                this.analyze(action.value);
                return null;
            case DELETE_COMPUTATION:
                return computations.deleteComputation(action.value[0]);
            case CREATED_DATA_FRAME: {
                const [tableId, dataFrame] = action.value;
                return computations.createdDataFrame(tableId, this.frame(dataFrame));
            }
            case TABLE_ORDERING_SUCCEDED: {
                const [tableId, ordering] = action.value;
                return computations.tableOrderingSucceeded(tableId, this.orderingTable(ordering), now);
            }
            case CLEAR_TABLE_ORDERING:
                return computations.clearTableOrdering(action.value);
            case TABLE_FILTERING_SUCCEEDED: {
                const [tableId, version, filter] = action.value;
                return computations.tableFilteringSucceeded(tableId, versionValue(version), this.filterTable(filter), now);
            }
            case TABLE_AGGREGATION_SUCCEEDED: {
                const [tableId, aggregation] = action.value;
                return computations.tableAggregationSucceeded(tableId, this.tableAggregation(aggregation)!, now);
            }
            case SYSTEM_COLUMN_COMPUTATION_SUCCEEDED: {
                const [tableId, table, dataFrame, columnGroups] = action.value;
                return computations.systemColumnsSucceeded(tableId, this.arrowTable(table), this.frame(dataFrame), columnGroups.map(columnGroupValue), now);
            }
            case COLUMN_AGGREGATION_SUCCEEDED: {
                const [tableId, columnId, aggregate] = action.value;
                return computations.columnAggregationSucceeded(tableId, columnId, this.columnAggregate(aggregate), now);
            }
            case FILTERED_COLUMN_AGGREGATION_SUCCEEDED: {
                const [tableId, columnId, version, aggregate] = action.value;
                const filtered: core.ComputationFilteredAggregate | null = aggregate == null ? null : {
                    aggregate: this.columnAggregate(aggregate),
                    filterVersion: versionValue(aggregate.filterVersion),
                    dataSearchRequestId: aggregate.dataSearchRequestId ?? null,
                };
                return computations.filteredColumnAggregationSucceeded(tableId, columnId, versionValue(version), filtered, now);
            }
            case SET_CROSS_FILTERS: {
                const [tableId, filters] = action.value;
                return computations.setCrossFilters(tableId, crossFilterValues(filters));
            }
            case SET_RESULT_SEARCH_PATTERN: {
                const [tableId, kind, pattern] = action.value;
                return computations.setResultSearchPattern(tableId, kind, pattern);
            }
            case COLUMN_SEARCH_SUCCEEDED: {
                const [tableId, source, requestId, matchingColumnGroups] = action.value;
                return computations.columnSearchSucceeded(tableId, this.knownIdOf(source), requestId, matchingColumnGroups);
            }
            case DATA_SEARCH_SUCCEEDED: {
                const [tableId, source, requestId, search] = action.value;
                const matchingRows = search.dataTable == null ? new Map<number, number[]>() : parseDataSearchMatches(search.dataTable);
                this.pendingMatchingRows = matchingRows;
                return computations.dataSearchSucceeded(tableId, this.knownIdOf(source), requestId, this.dataSearchTable(search)!, matchingRows, now);
            }
            case DATA_SEARCH_FAILED: {
                const [tableId, source, requestId, error] = action.value;
                return computations.dataSearchFailed(tableId, this.knownIdOf(source), requestId, error);
            }
            case RESULT_SEARCH_FAILED: {
                const [tableId, source, kind, requestId, error] = action.value;
                return computations.resultSearchFailed(tableId, this.knownIdOf(source), kind, requestId, error);
            }
        }
    }

    /// Run the effects of an action and keep the JS objects of what the state accepted
    private settle(action: ComputationAction, outcome: core.ComputationOutcome, memory: DataFrameRegistry): void {
        this.settleEffects(outcome.effects, memory);
        const matchingRows = this.pendingMatchingRows;
        this.pendingMatchingRows = null;
        if (!outcome.changed) return;
        // The JS objects of the parts that the state keeps by value
        switch (action.type) {
            case SYSTEM_COLUMN_COMPUTATION_SUCCEEDED: {
                const host = this.hostOfTable(action.value[0]);
                if (host != null) host.columnGroups = action.value[3];
                break;
            }
            case SET_CROSS_FILTERS: {
                const host = this.hostOfTable(action.value[0]);
                if (host != null) host.crossFilters = action.value[1];
                break;
            }
            case DATA_SEARCH_SUCCEEDED: {
                const host = this.hostOfTable(action.value[0]);
                if (host != null) host.matchingRows = matchingRows;
                break;
            }
        }
    }

    /// Abort what the state dropped and release the data frames of the actions of the host. The runtime drops the data
    /// frames that its tasks release, without a registry the effects only abort.
    private settleEffects(effects: core.ComputationEffect[], memory: DataFrameRegistry | null): void {
        for (const effect of effects) {
            switch (effect.type) {
                case 'abortComputation': {
                    const host = this.hosts.get(effect.lifetime);
                    this.hosts.delete(effect.lifetime);
                    if (this.lifetimes.get(effect.tableId) === effect.lifetime) this.lifetimes.delete(effect.tableId);
                    host?.lifetime.abort();
                    break;
                }
                case 'abortDataSearch':
                    for (const task of this.tasks.values()) {
                        if (task.type === DATA_SEARCH_TASK && task.value.tableId === effect.tableId && task.value.requestId === effect.requestId) {
                            task.value.abortController?.abort();
                        }
                    }
                    break;
                case 'releaseDataFrame': {
                    if (memory == null) break;
                    const known = this.forget(effect.dataFrame) as DataFrame | undefined;
                    const dataFrame = known ?? (this.database == null ? null : new DataFrame(this.database, `__df_${effect.dataFrame}`));
                    if (dataFrame != null) memory.releaseByState(dataFrame);
                    break;
                }
            }
        }
    }

    private hostOfTable(tableId: number): ComputationHost | null {
        const lifetime = this.lifetimes.get(tableId);
        return lifetime == null ? null : this.hosts.get(lifetime) ?? null;
    }

    // The tasks in Rust

    /// Analyze a result in Rust
    private analyze(request: AnalyzeTableRequest): void {
        this.database = request.database;
        this.analyses.set(request.tableId, { lifetime: new AbortController(), clientContext: request.clientContext });
        let analysis: Promise<void>;
        try {
            const ipc = arrow.tableToIPC(request.table, 'stream');
            analysis = this.computations.analyzeTable(request.tableId, ipc, request.connectionId, clientContextJson(request.clientContext), request.columnAggregates);
        } catch (e) {
            request.result.reject(asError(e));
            return;
        }
        analysis.then(() => request.result.resolve(), (e: unknown) => request.result.reject(asError(e)));
    }

    /// Run a task of the app in Rust, its result settles with the run
    private runTask(taskId: number, variant: TaskVariant): void {
        this.nativeTasks.add(taskId);
        const abort = variant.type === DATA_SEARCH_TASK ? variant.value.abortController : null;
        const cancel = () => this.computations.cancelTask(taskId);
        abort?.signal.addEventListener('abort', cancel, { once: true });
        const settle = (settled: () => void) => {
            abort?.signal.removeEventListener('abort', cancel);
            try {
                settled();
            } catch (e) {
                this.logger.warn('Failed to settle a task', { error: stringifyError(e) }, LOG_CTX);
            }
        };
        this.computations.runTask(taskId).then(
            () => settle(() => (variant.result as { resolve(value: unknown): void }).resolve(this.taskResult(variant))),
            (e: unknown) => {
                const error = new LoggableException(asError(e).message, { task: String(taskId) }, LOG_CTX);
                this.errors.set(taskId, error);
                settle(() => variant.result.reject(error));
            },
        );
    }

    /// The result of a task of the app as the projection shows it
    private taskResult(variant: TaskVariant): unknown {
        const computation = (this.last ?? this.project()).tableComputations[variant.value.tableId];
        if (computation == null) return null;
        switch (variant.type) {
            case TABLE_FILTERING_TASK: return computation.filterTable;
            case TABLE_ORDERING_TASK: return computation.orderingTable;
            case DATA_SEARCH_TASK: return computation.dataSearchTable;
            case TABLE_AGGREGATION_TASK: return [computation.tableAggregation, computation.columnGroups];
            case SYSTEM_COLUMN_COMPUTATION_TASK: return [computation.dataTable, computation.dataFrame, computation.columnGroups];
            case COLUMN_AGGREGATION_TASK: return computation.columnAggregates[variant.value.columnId] ?? null;
            case FILTERED_COLUMN_AGGREGATION_TASK: return computation.filteredColumnAggregates[variant.value.columnId] ?? null;
        }
    }

    // The compute host

    private requireDatabase(): EmbeddedComputeDatabase {
        if (this.database == null) throw new Error('the computations have no compute database');
        return this.database;
    }

    /// Run a call of a run that the runtime can abort
    private async inRun<T>(run: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
        const controller = new AbortController();
        let controllers = this.runs.get(run);
        if (controllers == null) {
            controllers = new Set();
            this.runs.set(run, controllers);
        }
        controllers.add(controller);
        try {
            return await call(controller.signal);
        } finally {
            controllers.delete(controller);
            if (controllers.size === 0) this.runs.delete(run);
        }
    }

    /// Remember a data frame that the runtime created
    private created(id: number, dataFrame: DataFrame): void {
        if (this.objects.get(id) == null) this.remember(id, dataFrame, 'frame');
    }

    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: string): void {
        let keyValues: Record<string, string> = {};
        try {
            keyValues = JSON.parse(details) as Record<string, string>;
        } catch {
            // The details are the runtime's, a message without them is still worth logging
        }
        this.logger[level](message, keyValues, 'compute');
    }

    async importTable(dataFrame: number, tableName: string, ipc: Uint8Array, context: string): Promise<void> {
        const ctx = parseContext(context);
        const database = this.requireDatabase();
        const clientContext = clientContextOf(ctx.clientContext);
        // The bytes are a view of the module, which may belong to another realm
        const table = arrow.tableFromIPC(new Uint8Array(ipc));
        await this.inRun(ctx.run, () => DataFrame.withConnection(database, conn => conn.insertArrowTable(table, { name: tableName, create: true }), clientContext));
        this.created(dataFrame, new DataFrame(database, tableName, clientContext));
    }

    async createTable(dataFrame: number, tableName: string, sql: string, context: string): Promise<void> {
        const ctx = parseContext(context);
        const database = this.requireDatabase();
        const execution = this.queryExecution?.({ tableId: ctx.tableId, title: ctx.title }) ?? executeDirectly;
        const created = await this.inRun(ctx.run, signal => execution(sql, clientContext =>
            DataFrame.fromSQL(database, sql, tableName, signal, clientContext ?? clientContextOf(ctx.clientContext))));
        this.created(dataFrame, created);
    }

    async query(sql: string, context: string): Promise<Uint8Array> {
        const ctx = parseContext(context);
        const database = this.requireDatabase();
        const table = await this.inRun(ctx.run, signal => DataFrame.withConnection(database, conn => conn.query(sql, signal), clientContextOf(ctx.clientContext)));
        return arrow.tableToIPC(table, 'stream');
    }

    async dropTable(dataFrame: number, tableName: string): Promise<void> {
        const known = this.forget(dataFrame) as DataFrame | undefined;
        const frame = known ?? (this.database == null ? null : new DataFrame(this.database, tableName));
        if (frame == null) return;
        if (this.memory != null) {
            this.memory.releaseByState(frame);
        } else {
            await frame.destroy();
        }
    }

    cancel(run: number): void {
        for (const controller of this.runs.get(run) ?? []) controller.abort(new DOMException('The task was cancelled', 'AbortError'));
    }

    changed(effects: string): void {
        try {
            this.settleEffects(JSON.parse(effects) as core.ComputationEffect[], null);
            this.onChange?.();
        } catch (e) {
            this.logger.error('Failed to apply a change of the computations', { error: stringifyError(e) }, LOG_CTX);
        }
    }

    // Projection

    /// Build the `ComputationState` of the Rust state. Unchanged computations keep their objects, and so does the map
    /// of the computations if none changed.
    project(): ComputationState {
        const computations = this.computations;
        const tableComputations: { [key: number]: TableComputationState } = {};
        const projected = new Map<number, { revision: number; state: TableComputationState }>();
        let changed = this.last == null;
        for (const tableId of computations.tableIds()) {
            const revision = computations.computationRevision(tableId)!;
            let entry = this.projected.get(tableId);
            if (entry == null || entry.revision !== revision) {
                entry = { revision, state: this.tableState(computations.computationSnapshot(tableId), entry?.state ?? null) };
                changed = true;
            }
            projected.set(tableId, entry);
            tableComputations[tableId] = entry.state;
        }
        if (projected.size !== this.projected.size) changed = true;
        this.projected = projected;

        // The objects of the tables that the state no longer holds go
        const tables = new Set(computations.arrowTableIds());
        for (const [id, kind] of [...this.kinds]) {
            if (kind === 'table' && !tables.has(id)) this.forget(id);
        }

        // The tasks that the state no longer knows go
        const known = new Set(computations.taskIds());
        for (const taskId of [...this.tasks.keys()]) {
            if (!known.has(taskId)) {
                this.tasks.delete(taskId);
                this.errors.delete(taskId);
                this.nativeTasks.delete(taskId);
            }
        }
        // The tasks that run in Rust aren't the scheduler's of the host
        const schedulerTasks: { [key: number]: TaskVariant } = {};
        let schedulerChanged = this.last == null;
        for (const taskId of computations.schedulerTaskIds()) {
            const task = this.tasks.get(taskId);
            if (task == null || this.nativeTasks.has(taskId)) continue;
            schedulerTasks[taskId] = task;
            if (this.last?.schedulerTasks[taskId] !== task) schedulerChanged = true;
        }
        if (this.last != null && Object.keys(this.last.schedulerTasks).length !== Object.keys(schedulerTasks).length) schedulerChanged = true;

        const state: ComputationState = {
            tableComputations: changed || this.last == null ? tableComputations : this.last.tableComputations,
            schedulerTasks: schedulerChanged || this.last == null ? schedulerTasks : this.last.schedulerTasks,
            nextSchedulerTaskId: computations.nextTaskId(),
            native: this,
        };
        this.last = state;
        return state;
    }

    /// The JS objects of a computation, the ones of an analysis for a computation of the runtime
    private hostOf(snapshot: core.ComputationSnapshot): ComputationHost {
        let host = this.hosts.get(snapshot.lifetime);
        if (host == null) {
            const analysis = this.analyses.get(snapshot.tableId);
            this.analyses.delete(snapshot.tableId);
            const table = this.objectOr(snapshot.dataTable.id, () => this.decodeTable(snapshot.dataTable.id));
            host = {
                lifetime: analysis?.lifetime ?? new AbortController(),
                clientContext: analysis?.clientContext ?? clientContextOf(snapshot.clientContext),
                fieldIndex: new Map(snapshot.dataTableFields.map((field, i) => [field, i])),
                fields: new Map((table?.schema.fields ?? []).map(field => [field.name, field])),
                columnGroups: [],
                columnGroupsKey: null,
                crossFilters: new CrossFilters(),
                matchingRows: null,
                matchingRowsOf: null,
                native: true,
            };
            this.hosts.set(snapshot.lifetime, host);
            this.lifetimes.set(snapshot.tableId, snapshot.lifetime);
        }
        return host;
    }

    /// The column groups of a computation of the runtime, with the Arrow types of the result
    private columnGroupsOf(snapshot: core.ComputationSnapshot, host: ComputationHost): ColumnGroup[] {
        if (!host.native) return host.columnGroups;
        const key = JSON.stringify(snapshot.columnGroups);
        if (host.columnGroupsKey !== key) {
            host.columnGroups = snapshot.columnGroups.map(group => columnGroupObject(group, host.fields));
            host.columnGroupsKey = key;
        }
        return host.columnGroups;
    }

    /// The state of a computation, the parts of the previous state that are the same keep their objects
    private tableState(snapshot: core.ComputationSnapshot, prev: TableComputationState | null): TableComputationState {
        const host = this.hostOf(snapshot);
        const version = versionObject(snapshot.version, prev?.version);
        const dataTable = this.objectOr(snapshot.dataTable.id, () => this.decodeTable(snapshot.dataTable.id))!;
        const columnGroups = this.columnGroupsOf(snapshot, host);
        const dataFrame = this.frameObject(snapshot.dataFrame, host.clientContext);
        const filterTable = snapshot.filterTable == null ? null : this.objectOr<FilterTable>(snapshot.filterTable.table, () => ({
            inputRowNumberColumnName: snapshot.filterTable!.inputRowNumberColumnName,
            dataTable: this.decodeTable(snapshot.filterTable!.table),
            dataFrame: this.frameObject(snapshot.filterTable!.dataFrame, host.clientContext)!,
            version: versionObject(snapshot.filterTable!.version),
        }));
        const ordering = snapshot.orderingTable;
        const orderingTable = ordering == null ? null : this.objectOr<OrderingTable>(ordering.table, () => ({
            inputRowNumberColumnName: ordering.inputRowNumberColumnName,
            orderingConstraints: orderByConstraints(ordering.orderingConstraints),
            dataTable: this.decodeTable(ordering.table),
            dataFrame: this.frameObject(ordering.dataFrame, host.clientContext)!,
            version: versionObject(ordering.version),
            dataSearchRequestId: ordering.dataSearchRequestId,
        }));
        const search = snapshot.dataSearchTable;
        const dataSearchTable = search == null ? null : this.objectOr<DataSearchTable>(search.table, () => ({
            inputRowNumberColumnName: search.inputRowNumberColumnName,
            dataTable: this.decodeTable(search.table),
            dataFrame: this.frameObject(search.dataFrame, host.clientContext)!,
            version: versionObject(search.version),
            requestId: search.requestId,
        }));
        const aggregation = snapshot.tableAggregation;
        const tableAggregation = aggregation == null ? null : this.objectOr<TableAggregation>(aggregation.table, () => {
            const table = this.decodeTable(aggregation.table);
            return {
                dataFrame: this.frameObject(aggregation.dataFrame, host.clientContext)!,
                table,
                tableFieldsByName: createArrowFieldIndex(table),
                tableFormatter: new ArrowTableFormatter(table.schema, table.batches, this.logger),
                countStarFieldName: aggregation.countStarFieldName,
            };
        });
        // The matching rows of a data search of the runtime come from its table
        if (host.native && host.matchingRowsOf !== (search?.table ?? null)) {
            host.matchingRows = dataSearchTable == null ? null : parseDataSearchMatches(dataSearchTable.dataTable);
            host.matchingRowsOf = search?.table ?? null;
        }
        const dataTableOrdering = sameOrderBy(prev?.dataTableOrdering, snapshot.dataTableOrdering)
            ? prev!.dataTableOrdering
            : sameOrderBy(orderingTable?.orderingConstraints, snapshot.dataTableOrdering)
                ? orderingTable!.orderingConstraints
                : orderByConstraints(snapshot.dataTableOrdering);
        const columnAggregates = reuseArray(prev?.columnAggregates, snapshot.columnAggregates.map((aggregate, i) =>
            this.aggregate(aggregate, columnGroups[i], tableAggregation, host)));
        const filteredColumnAggregates = reuseArray(prev?.filteredColumnAggregates, snapshot.filteredColumnAggregates.map((aggregate, i) => {
            if (aggregate == null) return null;
            if (aggregate.aggregate.kind !== 'skipped') {
                const epoch = { filterVersion: versionObject(aggregate.filterVersion), dataSearchRequestId: aggregate.dataSearchRequestId };
                return this.aggregate(aggregate.aggregate, columnGroups[i], tableAggregation, host, epoch) as WithFilterEpoch<ColumnAggregationVariant> | null;
            }
            const before = prev?.filteredColumnAggregates[i];
            if (before?.type === SKIPPED_COLUMN && sameVersion(before.filterVersion, aggregate.filterVersion) && before.dataSearchRequestId === aggregate.dataSearchRequestId) {
                return before;
            }
            return { ...SKIPPED_AGGREGATE, filterVersion: versionObject(aggregate.filterVersion), dataSearchRequestId: aggregate.dataSearchRequestId };
        }));
        return {
            tableId: snapshot.tableId,
            connectionId: snapshot.connectionId,
            clientContext: host.clientContext,
            tasks: this.tasksState(snapshot.tasks, prev?.tasks ?? null, snapshot.tableId),
            version,
            dataTable,
            dataTableFieldsByName: host.fieldIndex,
            dataTableLifetime: host.lifetime,
            dataFrame,
            columnGroups,
            dataTableOrdering,
            crossFilters: host.crossFilters,
            filterTable,
            orderingTable,
            columnSearch: searchState(snapshot.columnSearch, prev?.columnSearch ?? null, null),
            dataSearch: searchState(snapshot.dataSearch, prev?.dataSearch ?? null, host.matchingRows),
            dataSearchTable,
            rowNumberColumnGroup: snapshot.rowNumberColumnGroup,
            rowNumberColumnName: snapshot.rowNumberColumnName,
            tableAggregation,
            columnAggregates,
            filteredColumnAggregates,
            filteredColumnAggregatesOutdated: reuseArray(prev?.filteredColumnAggregatesOutdated, snapshot.filteredColumnAggregatesOutdated),
        };
    }

    /// A summary: the one of the host, or the one of the runtime with its analysis and the formatted values
    private aggregate(
        aggregate: core.ComputationColumnAggregateSnapshot | null,
        group: ColumnGroup | undefined,
        stats: TableAggregation | null,
        host: ComputationHost,
        epoch?: { filterVersion: ComputationStateVersion; dataSearchRequestId: number | null },
    ): ColumnAggregationVariant | null {
        if (aggregate == null) return null;
        if (aggregate.kind === 'skipped') return SKIPPED_AGGREGATE;
        if (aggregate.id == null) return null;
        return this.objectOr<ColumnAggregationVariant>(aggregate.id, () => {
            const analysis = aggregate.analysis;
            if (analysis == null || stats == null) return null;
            const table = this.decodeTable(aggregate.id!);
            const formatter = new ArrowTableFormatter(table.schema, table.batches, this.logger);
            const dataFrame = this.frameObject(aggregate.dataFrame, host.clientContext)!;
            if (analysis.kind === 'ordinal' && group?.type === ORDINAL_COLUMN) {
                return {
                    type: ORDINAL_COLUMN,
                    value: {
                        columnEntry: group.value,
                        binnedDataFrame: dataFrame,
                        binnedValues: table as never,
                        binnedValuesFormatter: formatter,
                        columnAnalysis: ordinalAnalysis(analysis, stats, group.value, table, formatter),
                    },
                    ...epoch,
                };
            }
            if (analysis.kind === 'string' && group?.type === STRING_COLUMN) {
                return {
                    type: STRING_COLUMN,
                    value: {
                        columnEntry: group.value,
                        frequentValuesDataFrame: dataFrame,
                        frequentValuesTable: table as never,
                        frequentValuesFormatter: formatter,
                        analysis: stringAnalysis(analysis, table, formatter),
                    },
                    ...epoch,
                };
            }
            return null;
        });
    }

    private tasksState(tasks: core.ComputationSnapshot['tasks'], prev: TableComputationTasks | null, tableId: number): TableComputationTasks {
        const next: TableComputationTasks = {
            tableAggregationTask: this.trackedTask(tasks.tableAggregation, prev?.tableAggregationTask, tableId),
            systemColumnTask: this.trackedTask(tasks.systemColumns, prev?.systemColumnTask, tableId),
            filteringTask: this.trackedTask(tasks.filtering, prev?.filteringTask, tableId),
            orderingTask: this.trackedTask(tasks.ordering, prev?.orderingTask, tableId),
            dataSearchTask: this.trackedTask(tasks.dataSearch, prev?.dataSearchTask, tableId),
            columnAggregationTasks: reuseArray(prev?.columnAggregationTasks, tasks.columnAggregation.map((task, i) => this.trackedTask(task, prev?.columnAggregationTasks[i], tableId))),
            filteredColumnAggregationTasks: reuseArray(prev?.filteredColumnAggregationTasks, tasks.filteredColumnAggregation.map((task, i) => this.trackedTask(task, prev?.filteredColumnAggregationTasks[i], tableId))),
        };
        if (prev != null && (Object.keys(next) as (keyof TableComputationTasks)[]).every(key => next[key] === prev[key])) return prev;
        return next;
    }

    /// A task that a computation tracks: the task as the app scheduled it with the version and the progress of the
    /// state. A task of an analysis in Rust has only its table, its version and its progress.
    private trackedTask<T>(tracked: core.ComputationTrackedTask | null, prev: WithProgress<T> | null | undefined, tableId: number): WithProgress<T> | null {
        if (tracked == null) return null;
        const variant = this.tasks.get(tracked.taskId) ?? null;
        const key = JSON.stringify(tracked);
        if (prev != null) {
            const before = this.projectedTasks.get(prev);
            if (before?.key === key && before.variant === variant) return prev;
        }
        const value: Record<string, unknown> = variant == null ? { tableId } : { ...variant.value };
        value.tableVersion = versionObject(tracked.version, variant?.value.tableVersion);
        if (tracked.orderingConstraints != null && variant?.type === TABLE_ORDERING_TASK) {
            const scheduled = variant.value.orderingConstraints;
            value.orderingConstraints = sameOrderBy(scheduled, tracked.orderingConstraints) ? scheduled : orderByConstraints(tracked.orderingConstraints);
        }
        const progress = tracked.progress;
        value.progress = {
            status: progress.status as TaskStatus,
            startedAt: new Date(progress.startedAt),
            completedAt: progress.completedAt == null ? null : new Date(progress.completedAt),
            failedAt: progress.failedAt == null ? null : new Date(progress.failedAt),
            failedWithError: progress.failedWithError == null
                ? null
                : this.errors.get(tracked.taskId) ?? new LoggableException(progress.failedWithError, {}, LOG_CTX),
        } satisfies TaskProgress;
        const task = value as WithProgress<T>;
        this.projectedTasks.set(task, { key, variant });
        return task;
    }
}

/// The context of a call of the compute host
function parseContext(context: string): ComputeCallContext {
    return JSON.parse(context) as ComputeCallContext;
}

/// The client context of the JSON of the runtime
function clientContextOf(json: string | null | undefined): EmbeddedClientContext | null {
    if (json == null) return null;
    try {
        return JSON.parse(json) as EmbeddedClientContext;
    } catch {
        return null;
    }
}

/// A column group of a snapshot with the Arrow type of its field in the result
function columnGroupObject(group: core.ComputationColumnGroupSnapshot, fields: Map<string, arrow.Field>): ColumnGroup {
    if (group.type === 'ROWNUMBER') return { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: group.rowNumberFieldName } };
    const inputFieldType = fields.get(group.inputFieldName)?.type ?? new arrow.Null();
    switch (group.type) {
        case 'SKIPPED':
            return { type: SKIPPED_COLUMN, value: { inputFieldName: group.inputFieldName, inputFieldType, inputFieldNullable: group.inputFieldNullable } };
        case 'ORDINAL':
            return {
                type: ORDINAL_COLUMN,
                value: {
                    inputFieldName: group.inputFieldName,
                    inputFieldType,
                    inputFieldNullable: group.inputFieldNullable,
                    statsFields: statsFieldsObject(group.statsFields),
                    binFieldName: group.binFieldName ?? null,
                    binCount: group.binCount,
                },
            };
        case 'STRING':
        case 'LIST':
            return {
                type: group.type === 'STRING' ? STRING_COLUMN : LIST_COLUMN,
                value: {
                    inputFieldName: group.inputFieldName,
                    inputFieldType,
                    inputFieldNullable: group.inputFieldNullable,
                    statsFields: statsFieldsObject(group.statsFields),
                    valueIdFieldName: group.valueIdFieldName ?? null,
                },
            };
    }
}

function statsFieldsObject(fields: core.ComputationStatsFields | null): ColumnStatsFields | null {
    if (fields == null) return null;
    return {
        countFieldName: fields.countFieldName,
        distinctCountFieldName: fields.distinctCountFieldName ?? null,
        minAggregateFieldName: fields.minAggregateFieldName ?? null,
        maxAggregateFieldName: fields.maxAggregateFieldName ?? null,
    };
}

/// The analysis of a histogram: the numbers of the runtime, the values formatted like the cells of the grid
function ordinalAnalysis(
    analysis: Extract<core.ComputationSummaryAnalysis, { kind: 'ordinal' }>,
    stats: TableAggregation,
    column: OrdinalGridColumnGroup,
    binned: arrow.Table,
    formatter: ArrowTableFormatter,
): OrdinalColumnAnalysis {
    const statistic = (field: string | null | undefined) => {
        const index = field == null ? undefined : stats.tableFieldsByName.get(field);
        return index == null || stats.table.numRows === 0 ? '' : stats.tableFormatter.getValue(0, index) ?? '';
    };
    const lowerBound = binned.schema.fields.findIndex(field => field.name === 'binLowerBound');
    const binLowerBounds = analysis.binLowerBounds.map((bound, i) => {
        if (analysis.binBounds === 'epochMillis') return bound == null ? '' : TEMPORAL_BOUND_FORMAT.format(new Date(bound));
        return lowerBound < 0 || i >= binned.numRows ? '' : formatter.getValue(i, lowerBound) ?? '';
    });
    return {
        totalCount: analysis.totalCount,
        countNotNull: analysis.countNotNull,
        countNull: analysis.countNull,
        minValue: statistic(column.statsFields?.minAggregateFieldName),
        maxValue: statistic(column.statsFields?.maxAggregateFieldName),
        binCount: analysis.binCount,
        binValueCounts: BigInt64Array.from(analysis.binValueCounts, count => BigInt(count)),
        binPercentages: Float64Array.from(analysis.binPercentages),
        binLowerBounds,
    };
}

/// The analysis of the frequent values: the numbers of the runtime, the values formatted like the cells of the grid
function stringAnalysis(
    analysis: Extract<core.ComputationSummaryAnalysis, { kind: 'string' }>,
    frequentValues: arrow.Table,
    formatter: ArrowTableFormatter,
): StringColumnAnalysis {
    const key = Math.max(0, frequentValues.schema.fields.findIndex(field => field.name === 'key'));
    const frequentValueStrings: (string | null)[] = [];
    for (let i = 0; i < frequentValues.numRows; ++i) {
        frequentValueStrings.push(formatter.getValue(i, key));
    }
    return {
        totalCount: analysis.totalCount,
        countNotNull: analysis.countNotNull,
        countNull: analysis.countNull,
        countDistinct: analysis.countDistinct,
        isUnique: analysis.isUnique,
        frequentValueStrings,
        frequentValueIds: BigInt64Array.from(analysis.frequentValueIds, id => BigInt(id)),
        frequentValueCounts: BigInt64Array.from(analysis.frequentValueCounts, count => BigInt(count)),
        frequentValuePercentages: Float64Array.from(analysis.frequentValuePercentages),
    };
}

/// The version of the Rust state
function versionValue(version: ComputationStateVersion | null | undefined): core.ComputationVersionValue {
    return { data: version?.data ?? 0, filter: version?.filter ?? 0 };
}

function sameVersion(version: ComputationStateVersion | core.ComputationVersionValue | null | undefined, other: core.ComputationVersionValue): boolean {
    return version != null && version.data === other.data && version.filter === other.filter;
}

/// A version object, one of the candidates if it is the same
function versionObject(version: core.ComputationVersionValue, ...candidates: (ComputationStateVersion | null | undefined)[]): ComputationStateVersion {
    for (const candidate of candidates) {
        if (candidate instanceof ComputationStateVersion && sameVersion(candidate, version)) return candidate;
    }
    return new ComputationStateVersion(version.data, version.filter);
}

function statsFieldsValue(fields: ColumnStatsFields | null | undefined): core.ComputationStatsFields | null {
    if (fields == null) return null;
    return {
        countFieldName: fields.countFieldName,
        distinctCountFieldName: fields.distinctCountFieldName ?? null,
        minAggregateFieldName: fields.minAggregateFieldName ?? null,
        maxAggregateFieldName: fields.maxAggregateFieldName ?? null,
    };
}

/// A column group of the Rust state, the Arrow type of a field by its name
export function columnGroupValue(group: ColumnGroup): core.ComputationColumnGroup {
    switch (group.type) {
        case ROWNUMBER_COLUMN:
            return { type: 'ROWNUMBER', rowNumberFieldName: group.value.rowNumberFieldName };
        case SKIPPED_COLUMN:
            return { type: 'SKIPPED', inputFieldName: group.value.inputFieldName, inputFieldType: String(group.value.inputFieldType), inputFieldNullable: group.value.inputFieldNullable };
        case ORDINAL_COLUMN:
            return {
                type: 'ORDINAL',
                inputFieldName: group.value.inputFieldName,
                inputFieldType: String(group.value.inputFieldType),
                inputFieldNullable: group.value.inputFieldNullable,
                statsFields: statsFieldsValue(group.value.statsFields),
                binFieldName: group.value.binFieldName ?? null,
                binCount: group.value.binCount,
            };
        case STRING_COLUMN:
        case LIST_COLUMN:
            return {
                type: group.type === STRING_COLUMN ? 'STRING' : 'LIST',
                inputFieldName: group.value.inputFieldName,
                inputFieldType: String(group.value.inputFieldType),
                inputFieldNullable: group.value.inputFieldNullable,
                statsFields: statsFieldsValue(group.value.statsFields),
                valueIdFieldName: group.value.valueIdFieldName ?? null,
            };
    }
}

function crossFilterValues(filters: CrossFilters): core.ComputationCrossFilter[] {
    return Object.entries(filters.columnFilters).map(([column, predicate]): core.ComputationCrossFilter => predicate.type === HISTOGRAM_FILTER
        ? { column: Number(column), kind: 'histogram', selection: predicate.value.selection, filters: predicate.value.filters }
        : { column: Number(column), kind: 'mostFrequent', valueId: predicate.value.valueId, filters: predicate.value.filters });
}

/// The client context of the queries of a computation as opaque JSON
function clientContextJson(clientContext: EmbeddedClientContext | null): string | null {
    if (clientContext == null) return null;
    try {
        return JSON.stringify(clientContext);
    } catch {
        return null;
    }
}

function millis(date: Date | number | null | undefined): number | null {
    if (date == null) return null;
    return typeof date === 'number' ? date : date.getTime();
}

function progressUpdate(progress: Partial<TaskProgress>): core.ComputationProgressUpdate {
    return {
        status: progress.status ?? null,
        startedAt: millis(progress.startedAt),
        completedAt: millis(progress.completedAt),
        failedAt: millis(progress.failedAt),
        failedWithError: progress.failedWithError == null ? null : progress.failedWithError.message ?? String(progress.failedWithError),
    } as core.ComputationProgressUpdate;
}

function sameOrderBy(constraints: readonly OrderByConstraint[] | null | undefined, other: readonly core.ComputationOrderBy[]): boolean {
    return constraints != null && constraints.length === other.length && constraints.every((constraint, i) =>
        constraint.field === other[i].field
        && (constraint.ascending ?? null) === (other[i].ascending ?? null)
        && (constraint.nullsFirst ?? null) === (other[i].nullsFirst ?? null));
}

function orderByConstraints(constraints: readonly core.ComputationOrderBy[]): OrderByConstraint[] {
    return constraints.map(constraint => ({
        field: constraint.field,
        ...(constraint.ascending != null ? { ascending: constraint.ascending } : {}),
        ...(constraint.nullsFirst != null ? { nullsFirst: constraint.nullsFirst } : {}),
    }));
}

/// The previous array if it holds the same elements
function reuseArray<T>(prev: readonly T[] | null | undefined, next: T[]): T[] {
    if (prev != null && prev.length === next.length && prev.every((element, i) => element === next[i])) return prev as T[];
    return next;
}

/// The search state of a snapshot, the previous one if it is the same
function searchState(search: core.ComputationSearchSnapshot, prev: ResultSearchState | null, matchingRows: Map<number, number[]> | null): ResultSearchState {
    const rows = search.hasMatchingRows ? matchingRows ?? new Map<number, number[]>() : null;
    const groups = search.matchingColumnGroups == null ? null : reuseArray(prev?.matchingColumnGroups, search.matchingColumnGroups);
    if (prev != null
        && prev.requestedPattern === search.requestedPattern
        && prev.appliedPattern === search.appliedPattern
        && prev.requestId === search.requestId
        && prev.appliedRequestId === search.appliedRequestId
        && prev.matchingColumnGroups === groups
        && prev.matchingRows === rows
        && prev.pending === search.pending
        && prev.error === search.error) {
        return prev;
    }
    return {
        requestedPattern: search.requestedPattern,
        appliedPattern: search.appliedPattern,
        requestId: search.requestId,
        appliedRequestId: search.appliedRequestId,
        matchingColumnGroups: groups,
        matchingRows: rows,
        pending: search.pending,
        error: search.error,
    };
}
