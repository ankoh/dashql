import * as core from '@ankoh/dashql-core';
import type * as arrow from 'apache-arrow';

import {
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
    type ResultSearchState,
    type TableAggregation,
    type TaskProgress,
    type TaskStatus,
    type TaskVariant,
    type WithFilterEpoch,
    type WithProgress,
} from './computation_types.js';
import { CrossFilters, HISTOGRAM_FILTER } from './cross_filters.js';
import type { DataFrame, DataFrameRegistry } from './data_frame.js';
import type { OrderByConstraint } from './sql/sqlframe_builder.js';
import { parseDataSearchMatches } from './sql/query_result_search_sql.js';
import type { EmbeddedClientContext } from '../platform/database/embedded_database.js';
import { LoggableException } from '../platform/logger/logger.js';

/// The computations of result tables in Rust (`packages/dashql-core-runtime/src/compute`, docs/wip/core_runtime.md).
///
/// The Rust state holds the computations and the tasks of the scheduler. It knows the Arrow tables, the data frames,
/// the summaries and the lifetimes of the app only by ids. `NativeComputations` gives the JS objects their ids, keeps
/// them while the state holds them and lets go of them on the effects of an action: a data frame that the state
/// releases is dropped unless the host still reads it (`DataFrameRegistry`), an Arrow table is forgotten, a lifetime
/// is aborted. `project` builds the `ComputationState` objects of the app: a computation keeps its object while its
/// revision doesn't move, and the parts of a changed computation keep theirs while they are the same.

const LOG_CTX = 'computation_native';

/// The JS objects of a computation that the Rust state knows only by its lifetime
interface ComputationHost {
    /// The lifetime, aborted when the computation goes
    lifetime: AbortController;
    /// The client context of the queries of the computation
    clientContext: EmbeddedClientContext | null;
    /// The fields of the table the computation was created with
    fieldIndex: Map<string, number>;
    /// The column groups of the grid, the ones the computation was created with or the ones of its system columns
    columnGroups: ColumnGroup[];
    /// The cross filters that the state accepted last
    crossFilters: CrossFilters;
    /// The matching rows of the data search that the state accepted last
    matchingRows: Map<number, number[]> | null;
}

/// What a projected task was built from
interface ProjectedTask {
    key: string;
    variant: TaskVariant;
}

/// What kind of object an id names
type ObjectKind = 'frame' | 'table';

/// The summary of a skipped column, it has no data
const SKIPPED_AGGREGATE: ColumnAggregationVariant = { type: SKIPPED_COLUMN, value: null };

export class NativeComputations {
    /// The Rust state
    readonly computations: core.DashQLComputations;
    /// The JS objects by id: data frames, Arrow tables, the filter, ordering and search tables, the statistics and
    /// the summaries
    private readonly objects = new Map<number, object>();
    /// The ids of the JS objects
    private readonly ids = new WeakMap<object, number>();
    /// What kind of object an id names
    private readonly kinds = new Map<number, ObjectKind>();
    /// The next id, ids and lifetimes share it
    private nextId = 1;
    /// The ids that the current action gave out
    private fresh: number[] = [];
    /// The JS objects of the computations by lifetime
    private readonly hosts = new Map<number, ComputationHost>();
    /// The lifetime of the computation of a table
    private readonly lifetimes = new Map<number, number>();
    /// The tasks as the app scheduled them by task id, with their task id
    private readonly tasks = new Map<number, TaskVariant>();
    /// The errors of failed tasks by task id
    private readonly errors = new Map<number, LoggableException>();
    /// The projected computations by table with the revision they were projected at
    private projected = new Map<number, { revision: number; state: TableComputationState }>();
    /// What the projected tasks were built from
    private readonly projectedTasks = new WeakMap<object, ProjectedTask>();
    /// The last projection
    private last: ComputationState | null = null;

    private constructor(computations: core.DashQLComputations) {
        this.computations = computations;
    }

    /// Create the computations of an instance of the core: through the instance, a bundle can hold two copies of the
    /// core package
    static create(instance: core.DashQL): ComputationState {
        return new NativeComputations(instance.createComputations()).project();
    }

    /// Free the Rust state and abort the lifetimes of the computations
    destroy(): void {
        for (const host of this.hosts.values()) host.lifetime.abort();
        this.hosts.clear();
        this.lifetimes.clear();
        this.objects.clear();
        this.kinds.clear();
        this.tasks.clear();
        this.projected.clear();
        this.computations.destroy();
    }

    // Ids

    /// The id of an object, a new one for an object that the state doesn't know. 0 for none.
    private idOf(object: object | null | undefined, kind: ObjectKind): number {
        if (object == null) return 0;
        let id = this.ids.get(object);
        if (id === undefined) {
            id = this.nextId++;
            this.ids.set(object, id);
            this.objects.set(id, object);
            this.kinds.set(id, kind);
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

    // The values of the Rust state

    private arrowTable(table: arrow.Table | null | undefined): core.ComputationArrowTable {
        return { id: this.idOf(table, 'table'), rows: table?.numRows ?? 0 };
    }

    private frame(dataFrame: DataFrame | null | undefined): number {
        return this.idOf(dataFrame, 'frame');
    }

    private filterTable(filter: FilterTable | null | undefined): core.ComputationFilterTable | null {
        if (filter == null) return null;
        return {
            inputRowNumberColumnName: filter.inputRowNumberColumnName ?? '',
            // The filter is the table of the host, its Arrow table goes with it
            table: { id: this.idOf(filter, 'table'), rows: filter.dataTable?.numRows ?? 0 },
            dataFrame: this.frame(filter.dataFrame),
            version: versionValue(filter.version),
        };
    }

    private orderingTable(ordering: OrderingTable): core.ComputationOrderingTable {
        return {
            inputRowNumberColumnName: ordering.inputRowNumberColumnName ?? '',
            orderingConstraints: ordering.orderingConstraints ?? [],
            table: { id: this.idOf(ordering, 'table'), rows: ordering.dataTable?.numRows ?? 0 },
            dataFrame: this.frame(ordering.dataFrame),
            version: versionValue(ordering.version),
            dataSearchRequestId: ordering.dataSearchRequestId ?? null,
        };
    }

    private dataSearchTable(search: DataSearchTable | null | undefined): core.ComputationDataSearchTable | null {
        if (search == null) return null;
        return {
            inputRowNumberColumnName: search.inputRowNumberColumnName ?? '',
            table: { id: this.idOf(search, 'table'), rows: search.dataTable?.numRows ?? 0 },
            dataFrame: this.frame(search.dataFrame),
            version: versionValue(search.version),
            requestId: search.requestId ?? 0,
        };
    }

    private tableAggregation(aggregation: TableAggregation | null | undefined): core.ComputationTableAggregation | null {
        if (aggregation == null) return null;
        // The statistics are the table of the host with their formatter
        return { table: this.idOf(aggregation, 'table'), dataFrame: this.frame(aggregation.dataFrame), countStarFieldName: aggregation.countStarFieldName ?? '' };
    }

    /// A summary, the JS object is the summary of the host
    private columnAggregate(aggregate: ColumnAggregationVariant | null | undefined): core.ComputationColumnAggregate {
        switch (aggregate?.type) {
            case ORDINAL_COLUMN:
                return { kind: 'ordinal', id: this.idOf(aggregate, 'table'), dataFrame: this.frame(aggregate.value?.binnedDataFrame) };
            case STRING_COLUMN:
                return { kind: 'string', id: this.idOf(aggregate, 'table'), dataFrame: this.frame(aggregate.value?.frequentValuesDataFrame) };
            case LIST_COLUMN:
                return { kind: 'list', id: this.idOf(aggregate, 'table'), dataFrame: this.frame(aggregate.value?.frequentValuesDataFrame) };
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
    private registerTask(taskId: number, variant: TaskVariant): void {
        const scheduled = this.computations.schedulerTaskSnapshot(taskId);
        let value = variant.value;
        if (scheduled != null && !sameVersion(value.tableVersion, scheduled.version)) {
            value = { ...value, tableVersion: new ComputationStateVersion(scheduled.version.data, scheduled.version.filter) };
        }
        this.tasks.set(taskId, { ...variant, value, taskId } as TaskVariant);
    }

    // Actions

    /// Apply an action to the Rust state and run its effects. Returns the outcome, null for an action that doesn't
    /// reach the state.
    apply(action: ComputationAction, memory: DataFrameRegistry): core.ComputationOutcome | null {
        this.fresh = [];
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
                if (outcome.taskId != null) this.registerTask(outcome.taskId, action.value);
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
                const lifetimeId = this.nextId++;
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
                    columnGroups,
                    crossFilters: new CrossFilters(),
                    matchingRows: null,
                });
                this.lifetimes.set(tableId, lifetimeId);
                return outcome;
            }
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

    /// The matching rows of a data search that the action hands over
    private pendingMatchingRows: Map<number, number[]> | null = null;

    /// Run the effects of an action and keep the JS objects of what the state accepted
    private settle(action: ComputationAction, outcome: core.ComputationOutcome, memory: DataFrameRegistry): void {
        for (const effect of outcome.effects) {
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
                    const dataFrame = this.forget(effect.dataFrame);
                    if (dataFrame != null) memory.releaseByState(dataFrame as DataFrame);
                    break;
                }
                case 'releaseArrowTable':
                    this.forget(effect.table);
                    break;
            }
        }
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

    private hostOfTable(tableId: number): ComputationHost | null {
        const lifetime = this.lifetimes.get(tableId);
        return lifetime == null ? null : this.hosts.get(lifetime) ?? null;
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

        // The tasks that the state no longer knows go
        const known = new Set(computations.taskIds());
        for (const taskId of [...this.tasks.keys()]) {
            if (!known.has(taskId)) {
                this.tasks.delete(taskId);
                this.errors.delete(taskId);
            }
        }
        const schedulerTasks: { [key: number]: TaskVariant } = {};
        let schedulerChanged = this.last == null;
        const schedulerTaskIds = computations.schedulerTaskIds();
        for (const taskId of schedulerTaskIds) {
            const task = this.tasks.get(taskId);
            if (task == null) continue;
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

    /// The state of a computation, the parts of the previous state that are the same keep their objects
    private tableState(snapshot: core.ComputationSnapshot, prev: TableComputationState | null): TableComputationState {
        let host = this.hosts.get(snapshot.lifetime);
        if (host == null) {
            // Every computation starts with an action that brings its host objects, this is a fallback
            const table = this.object<arrow.Table>(snapshot.dataTable.id);
            host = {
                lifetime: new AbortController(),
                clientContext: null,
                fieldIndex: table == null ? new Map() : createArrowFieldIndex(table),
                columnGroups: [],
                crossFilters: new CrossFilters(),
                matchingRows: null,
            };
            this.hosts.set(snapshot.lifetime, host);
        }
        const version = versionObject(snapshot.version, prev?.version);
        const orderingTable = this.object<OrderingTable>(snapshot.orderingTable);
        const dataTableOrdering = sameOrderBy(prev?.dataTableOrdering, snapshot.dataTableOrdering)
            ? prev!.dataTableOrdering
            : sameOrderBy(orderingTable?.orderingConstraints, snapshot.dataTableOrdering)
                ? orderingTable!.orderingConstraints
                : orderByConstraints(snapshot.dataTableOrdering);
        const columnAggregates = reuseArray(prev?.columnAggregates, snapshot.columnAggregates.map(aggregate => this.aggregate(aggregate)));
        const filteredColumnAggregates = reuseArray(prev?.filteredColumnAggregates, snapshot.filteredColumnAggregates.map((aggregate, i) => {
            if (aggregate == null) return null;
            if (aggregate.aggregate.kind !== 'skipped') return this.object<WithFilterEpoch<ColumnAggregationVariant>>(aggregate.aggregate.id);
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
            tasks: this.tasksState(snapshot.tasks, prev?.tasks ?? null),
            version,
            dataTable: this.object<arrow.Table>(snapshot.dataTable.id)!,
            dataTableFieldsByName: host.fieldIndex,
            dataTableLifetime: host.lifetime,
            dataFrame: this.object<DataFrame>(snapshot.dataFrame),
            columnGroups: host.columnGroups,
            dataTableOrdering,
            crossFilters: host.crossFilters,
            filterTable: this.object<FilterTable>(snapshot.filterTable),
            orderingTable,
            columnSearch: searchState(snapshot.columnSearch, prev?.columnSearch ?? null, null),
            dataSearch: searchState(snapshot.dataSearch, prev?.dataSearch ?? null, host.matchingRows),
            dataSearchTable: this.object<DataSearchTable>(snapshot.dataSearchTable),
            rowNumberColumnGroup: snapshot.rowNumberColumnGroup,
            rowNumberColumnName: snapshot.rowNumberColumnName,
            tableAggregation: this.object<TableAggregation>(snapshot.tableAggregation),
            columnAggregates,
            filteredColumnAggregates,
            filteredColumnAggregatesOutdated: reuseArray(prev?.filteredColumnAggregatesOutdated, snapshot.filteredColumnAggregatesOutdated),
        };
    }

    private aggregate(aggregate: core.ComputationColumnAggregateSnapshot | null): ColumnAggregationVariant | null {
        if (aggregate == null) return null;
        if (aggregate.kind === 'skipped') return SKIPPED_AGGREGATE;
        return this.object<ColumnAggregationVariant>(aggregate.id);
    }

    private tasksState(tasks: core.ComputationSnapshot['tasks'], prev: TableComputationTasks | null): TableComputationTasks {
        const next: TableComputationTasks = {
            tableAggregationTask: this.trackedTask(tasks.tableAggregation, prev?.tableAggregationTask),
            systemColumnTask: this.trackedTask(tasks.systemColumns, prev?.systemColumnTask),
            filteringTask: this.trackedTask(tasks.filtering, prev?.filteringTask),
            orderingTask: this.trackedTask(tasks.ordering, prev?.orderingTask),
            dataSearchTask: this.trackedTask(tasks.dataSearch, prev?.dataSearchTask),
            columnAggregationTasks: reuseArray(prev?.columnAggregationTasks, tasks.columnAggregation.map((task, i) => this.trackedTask(task, prev?.columnAggregationTasks[i]))),
            filteredColumnAggregationTasks: reuseArray(prev?.filteredColumnAggregationTasks, tasks.filteredColumnAggregation.map((task, i) => this.trackedTask(task, prev?.filteredColumnAggregationTasks[i]))),
        };
        if (prev != null && (Object.keys(next) as (keyof TableComputationTasks)[]).every(key => next[key] === prev[key])) return prev;
        return next;
    }

    /// A task that a computation tracks: the task as the app scheduled it with the version and the progress of the state
    private trackedTask<T>(tracked: core.ComputationTrackedTask | null, prev: WithProgress<T> | null | undefined): WithProgress<T> | null {
        if (tracked == null) return null;
        const variant = this.tasks.get(tracked.taskId);
        if (variant == null) return null;
        const key = JSON.stringify(tracked);
        if (prev != null) {
            const before = this.projectedTasks.get(prev);
            if (before?.key === key && before.variant === variant) return prev;
        }
        const value: Record<string, unknown> = { ...variant.value };
        value.tableVersion = versionObject(tracked.version, variant.value.tableVersion);
        if (tracked.orderingConstraints != null && variant.type === TABLE_ORDERING_TASK) {
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
