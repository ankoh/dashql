import * as arrow from 'apache-arrow';
import * as pb from '@ankoh/dashql-protobuf';

import { VariantKind } from '../utils/variant.js';
import { AsyncDataFrame } from './compute_worker_bindings.js';
import { ArrowTableFormatter } from 'view/query_result/arrow_formatter.js';
import { LoggableException } from '../platform/logger.js';

export const TASK_FAILED = Symbol("TASK_FAILED");
export const TASK_RUNNING = Symbol("TASK_RUNNING");
export const TASK_SUCCEDED = Symbol("TASK_SUCCEDED");
export const ORDINAL_COLUMN = Symbol("ORDINAL_COLUMN");
export const STRING_COLUMN = Symbol("STRING_COLUMN");
export const LIST_COLUMN = Symbol("LIST_COLUMN");
export const SKIPPED_COLUMN = Symbol("SKIPPED_COLUMN");
export const ROWNUMBER_COLUMN = Symbol("ROWNUMBER_COLUMN");

// ------------------------------------------------------------

export type TableComputationEpoch = number | null;

export interface TableFilteringTask {
    /// The table id
    tableId: number;
    /// The table epoch
    tableEpoch: TableComputationEpoch;
    /// The data frame
    inputDataTable: arrow.Table;
    /// The data frame
    inputDataTableFieldIndex: Map<string, number>;
    /// The data frame
    inputDataFrame: AsyncDataFrame;
    /// The row number columns
    rowNumberColumnName: string;
    /// The ordering constraints
    filters: pb.dashql.compute.FilterTransform[];
}

export interface TableOrderingTask {
    /// The table id
    tableId: number;
    /// The table epoch
    tableEpoch: TableComputationEpoch;
    /// The data frame
    inputDataTable: arrow.Table;
    /// The data frame
    inputDataTableFieldIndex: Map<string, number>;
    /// The data frame
    inputDataFrame: AsyncDataFrame;
    /// The ordering constraints
    orderingConstraints: pb.dashql.compute.OrderByConstraint[];
}

export interface TableAggregationTask {
    /// The table id
    tableId: number;
    /// The table epoch
    tableEpoch: TableComputationEpoch;
    /// The column entries
    columnEntries: ColumnGroup[];
    /// The data frame
    inputDataFrame: AsyncDataFrame;
}

export interface SystemColumnComputationTask {
    /// The table id
    tableId: number;
    /// The table epoch
    tableEpoch: TableComputationEpoch;
    /// The column entries
    columnEntries: ColumnGroup[];
    /// The input table
    inputTable: arrow.Table;
    /// The input data frame
    inputDataFrame: AsyncDataFrame;
    /// The stats table
    tableSummary: TableAggregation;
}

export interface ColumnAggregationTask {
    /// The table id
    tableId: number;
    /// The table epoch
    tableEpoch: TableComputationEpoch;
    /// The task id
    columnId: number;
    /// The column entry
    columnEntry: ColumnGroup;
    /// The input data frame
    inputDataFrame: AsyncDataFrame;
    /// The table summary
    tableAggregate: TableAggregation;
}

// ------------------------------------------------------------

export enum TaskStatus {
    TASK_RUNNING,
    TASK_SUCCEEDED,
    TASK_FAILED,
};

export interface TaskProgress {
    /// Task status
    status: TaskStatus;
    /// Task started at timestamp
    startedAt: Date;
    /// Task completed at timestamp
    completedAt: Date | null;
    /// Task failed at timestamp
    failedAt: Date | null;
    /// Task failed with error
    failedWithError: LoggableException | null;
}

export type WithProgress<T> = T & { progress: TaskProgress };

// ------------------------------------------------------------

export type ColumnGroup =
    | VariantKind<typeof ROWNUMBER_COLUMN, RowNumberGridColumnGroup>
    | VariantKind<typeof SKIPPED_COLUMN, SkippedGridColumnGroup>
    | VariantKind<typeof ORDINAL_COLUMN, OrdinalGridColumnGroup>
    | VariantKind<typeof STRING_COLUMN, StringGridColumnGroup>
    | VariantKind<typeof LIST_COLUMN, ListGridColumnGroup>
    ;

export function getGridColumnTypeName(variant: ColumnGroup) {
    switch (variant.type) {
        case ROWNUMBER_COLUMN: return "ROWNUMBER";
        case SKIPPED_COLUMN: return "SKIPPED";
        case ORDINAL_COLUMN: return "ORDINAL";
        case STRING_COLUMN: return "STRING";
        case LIST_COLUMN: return "LIST";
    }
}

export interface ColumnStatsFields {
    /// Entry count (!= null)
    countFieldName: string;
    /// Distinct entry count (only for strings and lists)
    distinctCountFieldName: string | null;
    /// Maximum value
    minAggregateFieldName: string | null;
    /// Minimum value
    maxAggregateFieldName: string | null;
}

export interface ColumnBinningFields {
    /// The bin field
    binFieldName: string;
}

export interface RowNumberGridColumnGroup {
    /// The input field
    rowNumberFieldName: string;
}

export interface OrdinalGridColumnGroup {
    /// The input field name
    inputFieldName: string;
    /// The input field type
    inputFieldType: arrow.DataType;
    /// Is the input nullable?
    inputFieldNullable: boolean;
    /// The column stats
    statsFields: ColumnStatsFields | null;
    /// The bin field name
    binFieldName: string | null;
    /// The bin count
    binCount: number;
}

export interface StringGridColumnGroup {
    /// The input field name
    inputFieldName: string;
    /// The input field type
    inputFieldType: arrow.DataType;
    /// Is the input nullable?
    inputFieldNullable: boolean;
    /// The column stats
    statsFields: ColumnStatsFields | null;
    /// The identifier field
    valueIdFieldName: string | null;
}

export interface ListGridColumnGroup {
    /// The input field name
    inputFieldName: string;
    /// The input field type
    inputFieldType: arrow.DataType;
    /// Is the input nullable?
    inputFieldNullable: boolean;
    /// The column stats
    statsFields: ColumnStatsFields | null;
    /// The identifier field
    valueIdFieldName: string | null;
}

export interface SkippedGridColumnGroup {
    /// The input field name
    inputFieldName: string;
    /// The input field type
    inputFieldType: arrow.DataType;
    /// Is the input nullable?
    inputFieldNullable: boolean;
}

// ------------------------------------------------------------

export interface OrderedTable {
    /// The ordering constraints
    orderingConstraints: pb.dashql.compute.OrderByConstraint[];
    /// The arrow table
    dataTable: arrow.Table;
    /// The field index
    dataTableFieldsByName: Map<string, number>;
    /// The data frame
    dataFrame: AsyncDataFrame;
}

export interface FilterTable {
    /// The row number column that is used for the filter
    inputRowNumberColumnName: string;
    /// The arrow table, only containing the row ids of the filtered rows
    dataTable: arrow.Table;
    /// The data frame
    dataFrame: AsyncDataFrame;
    /// The table epoch
    tableEpoch: TableComputationEpoch;
}

// ------------------------------------------------------------

export type ColumnAggregationVariant =
    VariantKind<typeof ORDINAL_COLUMN, OrdinalColumnAggregation>
    | VariantKind<typeof STRING_COLUMN, StringColumnAggregation>
    | VariantKind<typeof LIST_COLUMN, ListColumnAggregation>
    | VariantKind<typeof SKIPPED_COLUMN, null>
    ;

export type WithFilter<T> = T & {
    /// The filter table
    filterTable: FilterTable,
    /// The unfiltered aggregate
    unfilteredAggregate: ColumnAggregationVariant;
};

export interface TableAggregation {
    /// The statistics
    dataFrame: AsyncDataFrame;
    /// The statistics
    table: arrow.Table;
    /// The statistics field index
    tableFieldsByName: Map<string, number>;
    /// The formatter for the stats table
    tableFormatter: ArrowTableFormatter;
    /// Maximum value
    countStarFieldName: string;
}

export interface OrdinalColumnAggregation {
    /// The column entry
    columnEntry: OrdinalGridColumnGroup;
    /// The binned data frame
    binnedDataFrame: AsyncDataFrame;
    /// The binned values
    binnedValues: BinnedValuesTable;
    /// The formatter for the binned values
    binnedValuesFormatter: ArrowTableFormatter;
    /// The analyzed information for an ordinal column
    columnAnalysis: OrdinalColumnAnalysis;
    /// The analyzed information for an ordinal column with cross-filter
    filteredColumnAnalysis: OrdinalColumnFilterAnalysis | null;
}

export interface OrdinalColumnAnalysis {
    /// The value count
    countNotNull: number;
    /// The null count
    countNull: number;
    /// The minimum value
    minValue: string;
    /// The maximum value
    maxValue: string;
    /// The bin count
    binCount: number;
    /// The bin counts
    binValueCounts: BigInt64Array;
    /// The bin percentages
    binPercentages: Float64Array;
    /// The bin lower bounds
    binLowerBounds: string[];
}

export interface OrdinalColumnFilterAnalysis {
    /// The bin counts
    binValueCounts: BigInt64Array;
    /// The bin percentages
    binPercentages: Float64Array;
}

export interface StringColumnAggregation {
    /// The string column entry
    columnEntry: StringGridColumnGroup;
    /// The frequent values
    frequentValuesDataFrame: AsyncDataFrame;
    /// The frequent values
    frequentValuesTable: FrequentValuesTable;
    /// The formatter for the frequent values
    frequentValuesFormatter: ArrowTableFormatter;
    /// The analyzed column information
    analysis: StringColumnAnalysis;
}

export interface StringColumnAnalysis {
    /// The value count
    countNotNull: number;
    /// The null count
    countNull: number;
    /// The distinct count
    countDistinct: number;
    /// Is unique?
    isUnique: boolean;
    /// The frequent values
    frequentValueStrings: (string | null)[];
    /// The frequent value counts
    frequentValueCounts: BigInt64Array;
    /// The frequent value percentages
    frequentValuePercentages: Float64Array;
}

export interface ListColumnAggregation {
    /// The list column entry
    /// The string column entry
    columnEntry: ListGridColumnGroup;
    /// The frequent values
    frequentValuesDataFrame: AsyncDataFrame;
    /// The frequent values
    frequentValuesTable: FrequentValuesTable;
    /// The formatter for the frequent values
    frequentValuesFormatter: ArrowTableFormatter;
    /// The analyzed information for a list column
    analysis: ListColumnAnalysis;
}

export interface ListColumnAnalysis {
    /// The value count
    countNotNull: number;
    /// The null count
    countNull: number;
    /// The distinct count
    countDistinct: number;
    /// Is unique?
    isUnique: boolean;
    /// The frequent value is null
    frequentValueIsNull: Uint8Array;
    /// The frequent value counts
    frequentValueCounts: BigInt64Array;
    /// The frequent value percentages
    frequentValuePercentages: Float64Array;
}

// ------------------------------------------------------------

export type BinnedValuesTable<WidthType extends arrow.DataType = arrow.DataType, BoundType extends arrow.DataType = arrow.DataType> = arrow.Table<{
    bin: arrow.Int32,
    binWidth: WidthType,
    binLowerBound: BoundType,
    binUpperBound: BoundType,
    count: arrow.Int64,
}>;

export type FrequentValuesTable<KeyType extends arrow.DataType = arrow.DataType> = arrow.Table<{
    key: KeyType,
    count: arrow.Int64,
}>


// ------------------------------------------------------------

