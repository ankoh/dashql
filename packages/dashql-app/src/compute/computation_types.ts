import * as arrow from 'apache-arrow';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { VariantKind } from '../utils/variant.js';
import { AsyncDataFrame } from './compute_worker_bindings.js';
import { ArrowTableFormatter } from 'view/query_result/arrow_formatter.js';

export const COLUMN_SUMMARY_TASK = Symbol("COLUMN_STATS_TASK");
export const TABLE_ORDERING_TASK = Symbol("TABLE_ORDERING_TASK");
export const TABLE_SUMMARY_TASK = Symbol("TABLE_STATS_TASK");
export const TASK_FAILED = Symbol("TASK_FAILED");
export const TASK_RUNNING = Symbol("TASK_RUNNING");
export const TASK_SUCCEDED = Symbol("TASK_SUCCEDED");
export const ORDINAL_COLUMN = Symbol("ORDINAL_COLUMN");
export const STRING_COLUMN = Symbol("STRING_COLUMN");
export const LIST_COLUMN = Symbol("LIST_COLUMN");
export const SKIPPED_COLUMN = Symbol("SKIPPED_COLUMN");
export const ROWNUMBER_COLUMN = Symbol("ROWNUMBER_COLUMN");

// ------------------------------------------------------------

export type TaskVariant =
    VariantKind<typeof TABLE_ORDERING_TASK, TableOrderingTask>
    | VariantKind<typeof TABLE_SUMMARY_TASK, TableSummaryTask>
    | VariantKind<typeof COLUMN_SUMMARY_TASK, ColumnSummaryTask>
    ;

export interface TableFilteringTask {
    /// The table id
    tableId: number;
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
    /// The data frame
    inputDataTable: arrow.Table;
    /// The data frame
    inputDataTableFieldIndex: Map<string, number>;
    /// The data frame
    inputDataFrame: AsyncDataFrame;
    /// The ordering constraints
    orderingConstraints: pb.dashql.compute.OrderByConstraint[];
}

export interface TableSummaryTask {
    /// The table id
    tableId: number;
    /// The column entries
    columnEntries: ColumnGroup[];
    /// The data frame
    inputDataFrame: AsyncDataFrame;
}

export interface SystemColumnComputationTask {
    /// The table id
    tableId: number;
    /// The column entries
    columnEntries: ColumnGroup[];
    /// The input table
    inputTable: arrow.Table;
    /// The input data frame
    inputDataFrame: AsyncDataFrame;
    /// The stats table
    tableSummary: TableSummary;
}

export interface ColumnSummaryTask {
    /// The table id
    tableId: number;
    /// The task id
    columnId: number;
    /// The column entry
    columnEntry: ColumnGroup;
    /// The input data frame
    inputDataFrame: AsyncDataFrame;
    /// The table summary
    tableSummary: TableSummary;
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
    startedAt: Date | null;
    /// Task completed at timestamp
    completedAt: Date | null;
    /// Task failed at timestamp
    failedAt: Date | null;
    /// Task failed with error
    failedWithError: any;
}

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
    /// The arrow table, only containing the row ids of the filtered rows
    dataTable: arrow.Table;
    /// The data frame
    dataFrame: AsyncDataFrame;
}

// ------------------------------------------------------------

export type ColumnSummaryVariant =
    VariantKind<typeof ORDINAL_COLUMN, OrdinalColumnSummary>
    | VariantKind<typeof STRING_COLUMN, StringColumnSummary>
    | VariantKind<typeof LIST_COLUMN, ListColumnSummary>
    | VariantKind<typeof SKIPPED_COLUMN, null>
    ;

export interface TableSummary {
    /// The statistics
    statsDataFrame: AsyncDataFrame;
    /// The statistics
    statsTable: arrow.Table;
    /// The statistics field index
    statsTableFieldsByName: Map<string, number>;
    /// The formatter for the stats table
    statsTableFormatter: ArrowTableFormatter;
    /// Maximum value
    statsCountStarFieldName: string;
}

export interface OrdinalColumnSummary {
    /// The column entry
    columnEntry: OrdinalGridColumnGroup;
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

export interface StringColumnSummary {
    /// The string column entry
    columnEntry: StringGridColumnGroup;
    /// The frequent values
    frequentValues: FrequentValuesTable;
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

export interface ListColumnSummary {
    /// The list column entry
    /// The string column entry
    columnEntry: ListGridColumnGroup;
    /// The frequent values
    frequentValues: FrequentValuesTable;
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

export function createTableSummaryTransform(task: TableSummaryTask): [pb.dashql.compute.DataFrameTransform, ColumnGroup[], string] {
    let aggregates: pb.dashql.compute.GroupByAggregate[] = [];

    // Add count(*) aggregate
    const countColumn = `_count`;
    aggregates.push(buf.create(pb.dashql.compute.GroupByAggregateSchema, {
        outputAlias: `_count`,
        aggregationFunction: pb.dashql.compute.AggregationFunction.CountStar,
    }));

    // Add column aggregates
    const updatedEntries: ColumnGroup[] = [];
    for (let i = 0; i < task.columnEntries.length; ++i) {
        const entry = task.columnEntries[i];
        switch (entry.type) {
            case SKIPPED_COLUMN:
            case ROWNUMBER_COLUMN:
                updatedEntries.push(entry);
                break;
            case ORDINAL_COLUMN: {
                const countAggregateColumn = `_${i}_count`;
                const minAggregateColumn = `_${i}_min`;
                const maxAggregateColumn = `_${i}_max`;
                aggregates.push(buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: entry.value.inputFieldName,
                    outputAlias: countAggregateColumn,
                    aggregationFunction: pb.dashql.compute.AggregationFunction.Count,
                }));
                aggregates.push(buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: entry.value.inputFieldName,
                    outputAlias: minAggregateColumn,
                    aggregationFunction: pb.dashql.compute.AggregationFunction.Min,
                }));
                aggregates.push(buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: entry.value.inputFieldName,
                    outputAlias: maxAggregateColumn,
                    aggregationFunction: pb.dashql.compute.AggregationFunction.Max,
                }));
                const newEntry: ColumnGroup = {
                    type: ORDINAL_COLUMN,
                    value: {
                        ...entry.value,
                        statsFields: {
                            countFieldName: countAggregateColumn,
                            distinctCountFieldName: null,
                            minAggregateFieldName: minAggregateColumn,
                            maxAggregateFieldName: maxAggregateColumn,
                        }
                    }
                };
                updatedEntries.push(newEntry);
                break;
            }
            case STRING_COLUMN: {
                const countAggregateColumn = `_${i}_count`;
                const countDistinctAggregateColumn = `_${i}_countd`;
                aggregates.push(buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: entry.value.inputFieldName,
                    outputAlias: countAggregateColumn,
                    aggregationFunction: pb.dashql.compute.AggregationFunction.Count,
                }));
                aggregates.push(buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: entry.value.inputFieldName,
                    outputAlias: countDistinctAggregateColumn,
                    aggregationFunction: pb.dashql.compute.AggregationFunction.Count,
                    aggregateDistinct: true,
                }));
                const newEntry: ColumnGroup = {
                    type: STRING_COLUMN,
                    value: {
                        ...entry.value,
                        statsFields: {
                            countFieldName: countAggregateColumn,
                            distinctCountFieldName: countDistinctAggregateColumn,
                            minAggregateFieldName: null,
                            maxAggregateFieldName: null
                        }
                    }
                };
                updatedEntries.push(newEntry);
                break;
            }
            case LIST_COLUMN: {
                const countAggregateColumn = `_${i}_count`;
                const countDistinctAggregateColumn = `_${i}_countd`;
                aggregates.push(buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: entry.value.inputFieldName,
                    outputAlias: countAggregateColumn,
                    aggregationFunction: pb.dashql.compute.AggregationFunction.Count,
                }));
                aggregates.push(buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: entry.value.inputFieldName,
                    outputAlias: countDistinctAggregateColumn,
                    aggregationFunction: pb.dashql.compute.AggregationFunction.Count,
                    aggregateDistinct: true,
                }));
                const newEntry: ColumnGroup = {
                    type: LIST_COLUMN,
                    value: {
                        ...entry.value,
                        statsFields: {
                            countFieldName: countAggregateColumn,
                            distinctCountFieldName: countDistinctAggregateColumn,
                            minAggregateFieldName: null,
                            maxAggregateFieldName: null,
                        }
                    }
                };
                updatedEntries.push(newEntry);
                break;
            }
        }
    }
    const transform = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        groupBy: buf.create(pb.dashql.compute.GroupByTransformSchema, {
            keys: [],
            aggregates
        })
    });
    return [transform, updatedEntries, countColumn];
}

export const BIN_COUNT = 16;

export function createColumnSummaryTransform(task: ColumnSummaryTask): pb.dashql.compute.DataFrameTransform {
    if (task.columnEntry.type == SKIPPED_COLUMN || task.columnEntry.type == ROWNUMBER_COLUMN || task.columnEntry.value.statsFields == null) {
        throw new Error("column summary requires precomputed table summary");
    }
    let fieldName = task.columnEntry.value.inputFieldName;
    let out: pb.dashql.compute.DataFrameTransform;
    switch (task.columnEntry.type) {
        case ORDINAL_COLUMN: {
            const minField = task.columnEntry.value.statsFields.minAggregateFieldName!;
            const maxField = task.columnEntry.value.statsFields.maxAggregateFieldName!;
            out = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
                groupBy: buf.create(pb.dashql.compute.GroupByTransformSchema, {
                    keys: [
                        buf.create(pb.dashql.compute.GroupByKeySchema, {
                            fieldName,
                            outputAlias: "bin",
                            binning: buf.create(pb.dashql.compute.GroupByKeyBinningSchema, {
                                statsTableId: 0,
                                statsMinimumFieldName: minField,
                                statsMaximumFieldName: maxField,
                                binCount: BIN_COUNT,
                                outputBinWidthAlias: "binWidth",
                                outputBinLbAlias: "binLowerBound",
                                outputBinUbAlias: "binUpperBound",
                            })
                        })
                    ],
                    aggregates: [
                        buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                            fieldName,
                            outputAlias: "count",
                            aggregationFunction: pb.dashql.compute.AggregationFunction.CountStar,
                        })
                    ]
                }),
                orderBy: buf.create(pb.dashql.compute.OrderByTransformSchema, {
                    constraints: [
                        buf.create(pb.dashql.compute.OrderByConstraintSchema, {
                            fieldName: "bin",
                            ascending: true,
                            nullsFirst: false,
                        })
                    ],
                })
            });
            break;
        }
        case LIST_COLUMN:
        case STRING_COLUMN: {
            out = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
                groupBy: buf.create(pb.dashql.compute.GroupByTransformSchema, {
                    keys: [
                        buf.create(pb.dashql.compute.GroupByKeySchema, {
                            fieldName,
                            outputAlias: "key",
                        })
                    ],
                    aggregates: [
                        buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                            fieldName,
                            outputAlias: "count",
                            aggregationFunction: pb.dashql.compute.AggregationFunction.CountStar,
                        })
                    ]
                }),
                orderBy: buf.create(pb.dashql.compute.OrderByTransformSchema, {
                    constraints: [
                        buf.create(pb.dashql.compute.OrderByConstraintSchema, {
                            fieldName: "count",
                            ascending: false,
                            nullsFirst: false,
                        })
                    ],
                    limit: 32
                })
            });
            break;
        }
    }
    return out;
}

export function createOrderByTransform(constraints: pb.dashql.compute.OrderByConstraint[], limit?: number): pb.dashql.compute.DataFrameTransform {
    const out = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        orderBy: buf.create(pb.dashql.compute.OrderByTransformSchema, {
            constraints,
            limit
        })
    });
    return out;
}

/// Helper to create a unique column name
function createUniqueColumnName(prefix: string, fieldNames: Set<string>) {
    let name = prefix;
    while (true) {
        if (fieldNames.has(name)) {
            name = `_${name}`;
        } else {
            fieldNames.add(name);
            return name;
        }
    }
}

export function createSystemColumnComputationTransform(schema: arrow.Schema, columns: ColumnGroup[], _stats: arrow.Table): [pb.dashql.compute.DataFrameTransform, ColumnGroup[]] {
    let binningTransforms = [];
    let identifierTransforms = [];

    // Track field names for unique system columns
    let fieldNames = new Set<string>();
    for (const field of schema.fields) {
        fieldNames.add(field.name);
    }

    // Prepend the row number column at position 0
    const rowNumberFieldName = createUniqueColumnName(`_rownum`, fieldNames);
    const rowNumberTransform = buf.create(pb.dashql.compute.RowNumberTransformSchema, {
        outputAlias: rowNumberFieldName
    });
    const rowNumberGridColumn: ColumnGroup = {
        type: ROWNUMBER_COLUMN,
        value: {
            rowNumberFieldName: rowNumberFieldName
        }
    };
    let gridColumns: ColumnGroup[] = [
        rowNumberGridColumn,
        ...columns
    ];

    // Create the metadata columns for all others
    for (let i = 1; i <= columns.length; ++i) {
        let column = gridColumns[i];
        switch (column.type) {
            case ROWNUMBER_COLUMN:
            case SKIPPED_COLUMN:
                break;
            case ORDINAL_COLUMN: {
                const binFieldName = createUniqueColumnName(`_${i}_bin`, fieldNames);
                binningTransforms.push(buf.create(pb.dashql.compute.BinningTransformSchema, {
                    fieldName: column.value.inputFieldName,
                    statsTableId: 0,
                    statsMaximumFieldName: column.value.statsFields!.maxAggregateFieldName!,
                    statsMinimumFieldName: column.value.statsFields!.minAggregateFieldName!,
                    binCount: column.value.binCount,
                    outputAlias: binFieldName
                }));
                gridColumns[i] = {
                    type: ORDINAL_COLUMN,
                    value: {
                        ...column.value,
                        binFieldName: binFieldName,
                    }
                };
                break;
            }
            case STRING_COLUMN: {
                const valueFieldName = createUniqueColumnName(`_${i}_id`, fieldNames);
                identifierTransforms.push(buf.create(pb.dashql.compute.ValueIdentifierTransformSchema, {
                    fieldName: column.value.inputFieldName,
                    outputAlias: valueFieldName
                }));
                gridColumns[i] = {
                    type: STRING_COLUMN,
                    value: {
                        ...column.value,
                        valueIdFieldName: valueFieldName
                    }
                };
                break;
            }
            case LIST_COLUMN: {
                const valueFieldName = createUniqueColumnName(`_${i}_id`, fieldNames);
                identifierTransforms.push(buf.create(pb.dashql.compute.ValueIdentifierTransformSchema, {
                    fieldName: column.value.inputFieldName,
                    outputAlias: valueFieldName
                }));
                gridColumns[i] = {
                    type: LIST_COLUMN,
                    value: {
                        ...column.value,
                        valueIdFieldName: valueFieldName
                    }
                };
                break;
            }
        }
    }

    const ordering = buf.create(pb.dashql.compute.OrderByTransformSchema, {
        constraints: [
            buf.create(pb.dashql.compute.OrderByConstraintSchema, {
                fieldName: rowNumberFieldName,
                ascending: true,
                nullsFirst: false
            })
        ]
    });

    const transform = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        rowNumber: rowNumberTransform,
        valueIdentifiers: identifierTransforms,
        binning: binningTransforms,
        orderBy: ordering
    });
    return [transform, gridColumns];
}
