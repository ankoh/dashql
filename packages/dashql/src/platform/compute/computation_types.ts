import * as arrow from 'apache-arrow';
import type * as core from '../../core/index.js';

import { ArrowTableFormatter } from './arrow_formatter.js';
import { parseDataSearchMatches } from './sql/query_result_search_sql.js';
import type { LoggerLike } from '../platform/logger/logger.js';

// The computation of a result as the app reads it: the view of the runtime (`ComputationView` of the module, see
// docs/design/dashql_runtime.md) with the tables of the handle table, and the summaries of the columns that the plots
// draw, formatted like the cells of the grid.

/// The kinds of the column groups, the tags of `ComputationColumnGroup`
export const ORDINAL_COLUMN = 'ORDINAL';
export const STRING_COLUMN = 'STRING';
export const LIST_COLUMN = 'LIST';
export const SKIPPED_COLUMN = 'SKIPPED';
export const ROWNUMBER_COLUMN = 'ROWNUMBER';

/// The status of a task, the numeric enum of the runtime
export { TaskStatus } from '../../core/index.js';

/// The view of the computation of a result table
export type TableComputationState = core.ComputationView;
/// A column group of the grid
export type ColumnGroup = core.ComputationColumnGroup;
/// The value column of an ordinal, a string or a list column group
export type GridValueColumn = core.ComputationValueColumn;
/// A key of an ordering
export type OrderByConstraint = core.ComputationOrderBy;
/// The version of the data and the filter of a computation
export type ComputationStateVersion = core.ComputationVersionValue;
/// The search of the columns or of the data
export type ResultSearchState = core.ComputationSearch;
/// A task that a computation tracks with its progress
export type TrackedTask = core.ComputationTrackedTask;

/// The value column of a column group with the Arrow type of its field
export interface SummaryColumn extends Omit<GridValueColumn, 'inputFieldType'> {
    inputFieldType: arrow.DataType;
}

/// The statistics of all columns of a table
export interface TableAggregation {
    /// The statistics, one row
    table: arrow.Table;
    /// The statistics field index
    tableFieldsByName: Map<string, number>;
    /// The formatter of the statistics
    tableFormatter: ArrowTableFormatter;
    /// The field of the row count
    countStarFieldName: string;
}

export interface OrdinalColumnAggregation {
    /// The column entry
    columnEntry: SummaryColumn;
    /// The binned values
    binnedValues: BinnedValuesTable;
    /// The formatter for the binned values
    binnedValuesFormatter: ArrowTableFormatter;
    /// The analyzed information for an ordinal column
    columnAnalysis: OrdinalColumnAnalysis;
}

export interface OrdinalColumnAnalysis {
    totalCount: number;
    countNotNull: number;
    countNull: number;
    /// The minimum value, formatted
    minValue: string;
    /// The maximum value, formatted
    maxValue: string;
    binCount: number;
    binValueCounts: BigInt64Array;
    binPercentages: Float64Array;
    /// The lower bounds of the bins, formatted
    binLowerBounds: string[];
}

export interface StringColumnAggregation {
    /// The string column entry
    columnEntry: SummaryColumn;
    /// The frequent values
    frequentValuesTable: FrequentValuesTable;
    /// The formatter for the frequent values
    frequentValuesFormatter: ArrowTableFormatter;
    /// The analyzed column information
    analysis: StringColumnAnalysis;
}

export interface StringColumnAnalysis {
    totalCount: number;
    countNotNull: number;
    countNull: number;
    countDistinct: number;
    isUnique: boolean;
    /// The frequent values, formatted
    frequentValueStrings: (string | null)[];
    /// The frequent value ids (for plotting)
    frequentValueIds: BigInt64Array;
    frequentValueCounts: BigInt64Array;
    frequentValuePercentages: Float64Array;
}

/// The summary of a column for the plots
export type ColumnAggregationVariant =
    | { type: typeof ORDINAL_COLUMN; value: OrdinalColumnAggregation }
    | { type: typeof STRING_COLUMN; value: StringColumnAggregation }
    | { type: typeof LIST_COLUMN; value: null }
    | { type: typeof SKIPPED_COLUMN; value: null };

export type WithFilterEpoch<T> = T & {
    /// The filter version when this aggregate was computed
    filterVersion: ComputationStateVersion;
    /// The Data-search request when this aggregate was computed
    dataSearchRequestId: number | null;
};

export type BinnedValuesTable<WidthType extends arrow.DataType = arrow.DataType, BoundType extends arrow.DataType = arrow.DataType> = arrow.Table<{
    bin: arrow.Int32;
    binWidth: WidthType;
    binLowerBound: BoundType;
    binUpperBound: BoundType;
    count: arrow.Int64;
}>;

export type FrequentValuesTable<KeyType extends arrow.DataType = arrow.DataType> = arrow.Table<{
    key: KeyType;
    keyId: arrow.Int64;
    count: arrow.Int64;
}>;

/// The summaries of a computation that the plots draw
export interface ComputationSummaries {
    tableAggregation: TableAggregation | null;
    columnAggregates: (ColumnAggregationVariant | null)[];
    filteredColumnAggregates: (WithFilterEpoch<ColumnAggregationVariant> | null)[];
}

/// Where the summaries read the tables of the view
export interface SummaryTables {
    table(handle: number | null | undefined): arrow.Table | undefined;
}

/// The formats of the lower bounds of the bins of temporal columns
const TEMPORAL_BOUND_FORMAT = Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'medium' });

/// What the summaries built of a table, built once per table
const built = new WeakMap<object, unknown>();
function once<T>(table: arrow.Table, build: () => T): T {
    if (built.has(table)) return built.get(table) as T;
    const value = build();
    built.set(table, value);
    return value;
}

/// The statistics of a computation
export function resolveTableAggregation(view: TableComputationState, tables: SummaryTables, logger: LoggerLike): TableAggregation | null {
    const aggregation = view.tableAggregation;
    const table = aggregation == null ? undefined : tables.table(aggregation.table);
    if (aggregation == null || table == null) return null;
    return once(table, () => ({
        table,
        tableFieldsByName: new Map(table.schema.fields.map((field, i) => [field.name, i])),
        tableFormatter: new ArrowTableFormatter(table.schema, table.batches, logger),
        countStarFieldName: aggregation.countStarFieldName,
    }));
}

/// The column of a column group with the Arrow type of its field in the table
function summaryColumn(group: ColumnGroup | undefined, dataTable: arrow.Table | undefined): SummaryColumn | null {
    if (group == null || (group.type !== ORDINAL_COLUMN && group.type !== STRING_COLUMN && group.type !== LIST_COLUMN)) return null;
    const field = dataTable?.schema.fields.find(field => field.name === group.value.inputFieldName);
    return { ...group.value, inputFieldType: field?.type ?? new arrow.Null() };
}

/// The summary of a column of the view with its analysis and the formatted values
function resolveAggregate(
    aggregate: core.ComputationColumnAggregate | null | undefined,
    group: ColumnGroup | undefined,
    stats: TableAggregation | null,
    dataTable: arrow.Table | undefined,
    tables: SummaryTables,
    logger: LoggerLike,
): ColumnAggregationVariant | null {
    if (aggregate == null) return null;
    if (aggregate.kind === 'skipped') return SKIPPED_AGGREGATE;
    if (aggregate.kind === 'list') return { type: LIST_COLUMN, value: null };
    const table = tables.table(aggregate.table);
    const analysis = aggregate.analysis;
    if (table == null || analysis == null || stats == null) return null;
    return once(table, () => {
        const column = summaryColumn(group, dataTable);
        if (column == null) return null;
        const formatter = new ArrowTableFormatter(table.schema, table.batches, logger);
        if (analysis.kind === 'ordinal' && group?.type === ORDINAL_COLUMN) {
            return {
                type: ORDINAL_COLUMN,
                value: {
                    columnEntry: column,
                    binnedValues: table as BinnedValuesTable,
                    binnedValuesFormatter: formatter,
                    columnAnalysis: ordinalAnalysis(analysis, stats, column, table, formatter),
                },
            };
        }
        if (analysis.kind === 'string' && group?.type === STRING_COLUMN) {
            return {
                type: STRING_COLUMN,
                value: {
                    columnEntry: column,
                    frequentValuesTable: table as FrequentValuesTable,
                    frequentValuesFormatter: formatter,
                    analysis: stringAnalysis(analysis, table, formatter),
                },
            };
        }
        return null;
    });
}

const SKIPPED_AGGREGATE: ColumnAggregationVariant = { type: SKIPPED_COLUMN, value: null };

/// The epochs of the summaries over the selected rows, one object per summary
const epochs = new WeakMap<object, WithFilterEpoch<ColumnAggregationVariant>>();

/// The summaries of a computation for the plots. A summary keeps its object while its table is the same.
export function resolveSummaries(view: TableComputationState, tables: SummaryTables, logger: LoggerLike): ComputationSummaries {
    const dataTable = tables.table(view.dataTable);
    const tableAggregation = resolveTableAggregation(view, tables, logger);
    const columnAggregates = view.columnAggregates.map((aggregate, i) =>
        resolveAggregate(aggregate, view.columnGroups[i], tableAggregation, dataTable, tables, logger));
    const filteredColumnAggregates = view.filteredColumnAggregates.map((filtered, i) => {
        if (filtered == null) return null;
        const aggregate = resolveAggregate(filtered.aggregate, view.columnGroups[i], tableAggregation, dataTable, tables, logger);
        if (aggregate == null) return null;
        // The view of the summary keeps its object while it is the same, and so does its epoch
        let epoch = epochs.get(filtered);
        if (epoch == null || epoch.type !== aggregate.type || epoch.value !== aggregate.value) {
            epoch = { ...aggregate, filterVersion: filtered.filterVersion, dataSearchRequestId: filtered.dataSearchRequestId } as WithFilterEpoch<ColumnAggregationVariant>;
            epochs.set(filtered, epoch);
        }
        return epoch;
    });
    return { tableAggregation, columnAggregates, filteredColumnAggregates };
}

/// The matching columns of the rows of the applied data search by row number from 1, null without a data search
export function resolveMatchingRows(view: TableComputationState | null, tables: SummaryTables): Map<number, number[]> | null {
    if (view == null || !view.dataSearch.hasMatchingRows) return null;
    const table = tables.table(view.dataSearchTable?.dataTable);
    if (table == null) return EMPTY_MATCHES;
    return once(table, () => parseDataSearchMatches(table));
}

const EMPTY_MATCHES = new Map<number, number[]>();

/// The analysis of a histogram: the numbers of the runtime, the values formatted like the cells of the grid
function ordinalAnalysis(
    analysis: Extract<core.ComputationSummaryAnalysis, { kind: 'ordinal' }>,
    stats: TableAggregation,
    column: SummaryColumn,
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
