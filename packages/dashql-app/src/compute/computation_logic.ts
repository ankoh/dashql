import * as arrow from 'apache-arrow';
import * as buf from '@bufbuild/protobuf';
import * as pb from '@ankoh/dashql-protobuf';

import { ArrowTableFormatter } from '../view/query_result/arrow_formatter.js';
import { AsyncDataFrame, ComputeWorkerBindings } from './compute_worker_bindings.js';
import { AsyncValue } from '../utils/async_value.js';
import { COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK, TaskVariant } from './computation_scheduler.js';
import { COMPUTATION_FROM_QUERY_RESULT, ComputationAction, createArrowFieldIndex, CREATED_DATA_FRAME, SCHEDULE_TASK } from './computation_state.js';
import { ColumnAggregationVariant, ColumnAggregationTask, TableAggregationTask, TableOrderingTask, TableAggregation, OrderedTable, ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, ColumnGroup, SKIPPED_COLUMN, OrdinalColumnAnalysis, StringColumnAnalysis, ListColumnAnalysis, ListGridColumnGroup, StringGridColumnGroup, OrdinalGridColumnGroup, BinnedValuesTable, FrequentValuesTable, SystemColumnComputationTask, ROWNUMBER_COLUMN, getGridColumnTypeName, TableFilteringTask, FilterTable, WithFilter, WithFilterEpoch } from './computation_types.js';
import { Dispatch } from '../utils/variant.js';
import { LoggableException, Logger } from '../platform/logger.js';
import { assert } from '../utils/assert.js';

const LOG_CTX = "compute";

const DATA_TAG_INGEST = Symbol("DATA_TAG_INGEST");
const DATA_TAG_SYSTEM_COLUMNS = Symbol("DATA_TAG_SYSTEM_COLUMNS");
const DATA_TAG_ORDERING_TABLE = Symbol("DATA_TAG_ORDERING_TABLE");
const DATA_TAG_FILTER_TABLE = Symbol("DATA_TAG_FILTER_TABLE");
const DATA_TAG_TABLE_AGGREGATION = Symbol("DATA_TAG_TABLE_AGGREGATION");
const DATA_TAG_COLUMN_AGGREGATION = Symbol("DATA_TAG_COLUMN_AGGREGATION");
const DATA_TAG_FILTERED_COLUMN_AGGREGATION = Symbol("DATA_TAG_FILTERED_COLUMN_AGGREGATION");

/// Analyze a table.
///
/// This function computes multiple summaries for displaying the data in the table grid component.
///
/// It consists of multiple steps:
///   1) We first global table aggregates.
///      For each of the columns we compute minimum, maximum, counts and distinct counts depending on the column type.
///   2) We then compute auxiliary system columns storing the input row number and (fractional) bin values in the domain.
///   3) We then compute summary tables per column based on these bin values.
///      (For example an aggregated histogram table for ordinal columns)
///
/// On Cross-Filters:
///   One option for fast cross-filters is to pre-compute summed area tables from Dominik's Falcon paper:
///     https://osf.io/preprints/osf/szpqm_v1
///   This paper proposes to precompute a summation table to assist brushing.
///   The idea is the following:
///     A) Aggregate counts for the cube of all cross-filter dimensions (N table columns -> 2^N fields).
///        (A, B, C) -> grouping sets ((A, B, C), (A, B), (A, C), (B, C), (A), (B), (C), ())
///     B) Compute comulative sums for the aggregates.
///        When brushing, we want to compute the count between two boundaries, for which we need cumulative sums.
///     C) Cross-filtering then becomes a O(1) lookup in this cube.
///
///   Problem:
///     This is simple when doing this for ordinal columns only, where we control the dimension count.
///     For categorical columns, we have the problem that we might want to cross-filter with a *specific* distinct value.
///     Precomputing for that is infeasible with higher distinct counts, so we'll have to maintain a non-precomputed path anyway?
///     Also, 2^N is not exactly cheap for very wide tables where the user would never visibly see the cross-filter.
///
///   Alternative:
///     We do ad-hoc cross-filter computations on the pre-computed bin fields and only for what is currently visible (!).
///     The upside here is that the bin count is dictated by what we can show in the UI and is thus usually small.
///     Whenever a user updates a cross-filter (by brushing or selecting a distinct value), we just recompute the column summaries
///     with the new set of cross-filters and update the UI.
///
export async function analyzeTable(tableId: number, table: arrow.Table, dispatch: Dispatch<ComputationAction>, worker: ComputeWorkerBindings, logger: Logger): Promise<void> {
    // Register the table with compute
    let gridColumnGroups = buildGridColumnGroups(table!);
    const computeAbortCtrl = new AbortController();
    dispatch({
        type: COMPUTATION_FROM_QUERY_RESULT,
        value: [tableId, table!, gridColumnGroups, computeAbortCtrl]
    });

    // Create a Data Frame from a table
    let dataFrame = await worker.createDataFrameFromTable(table, DATA_TAG_INGEST);
    dispatch({
        type: CREATED_DATA_FRAME,
        value: [tableId, dataFrame]
    });

    // Summarize the table
    const tableAggregationTask: TableAggregationTask = {
        tableId,
        tableEpoch: null,
        columnEntries: gridColumnGroups,
        inputDataFrame: dataFrame
    };
    const [tableAggregate, initialColumnGroups] = await computeTableAggregatesDispatched(tableAggregationTask, dispatch);
    gridColumnGroups = initialColumnGroups;

    // Precompute column expressions
    const precomputationTask: SystemColumnComputationTask = {
        tableId,
        tableEpoch: null,
        columnEntries: gridColumnGroups,
        inputTable: table,
        inputDataFrame: dataFrame,
        tableAggregate
    };
    const [_newTable, newDataFrame, updatedColumnGroups] = await computeSystemColumnsDispatched(precomputationTask, dispatch);
    gridColumnGroups = updatedColumnGroups;

    // Aggregate the columns
    // XXX This we should do lazily based on column visibility
    for (let columnId = 0; columnId < gridColumnGroups.length; ++columnId) {
        // Skip columns that don't compute a column summary
        if (gridColumnGroups[columnId].type == SKIPPED_COLUMN || gridColumnGroups[columnId].type == ROWNUMBER_COLUMN) {
            continue;
        }
        const columnAggregationTask: ColumnAggregationTask = {
            tableId,
            tableEpoch: null,
            columnId,
            tableAggregate,
            columnEntry: gridColumnGroups[columnId],
            inputDataFrame: newDataFrame,
        };
        await computeColumnAggregatesDispatched(columnAggregationTask, dispatch);
    }
}

/// Precompute system columns through dispatched actions
export async function computeSystemColumnsDispatched(task: SystemColumnComputationTask, dispatch: Dispatch<ComputationAction>): Promise<[arrow.Table, AsyncDataFrame, ColumnGroup[]]> {
    const result = new AsyncValue<[arrow.Table, AsyncDataFrame, ColumnGroup[]], LoggableException>();
    const variant: TaskVariant = {
        type: SYSTEM_COLUMN_COMPUTATION_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

/// Precompute system columns for fast column summaries
export async function computeSystemColumns(task: SystemColumnComputationTask, logger: Logger): Promise<[arrow.Table, AsyncDataFrame, ColumnGroup[]]> {
    try {
        // Create precomputation transform
        const [transform, columnGroups] = createSystemColumnComputationTransform(task.inputTable.schema, task.columnEntries, task.tableAggregate.table);

        // Get timings
        const transformStart = performance.now();
        const transformed = await task.inputDataFrame.transform(transform, [task.tableAggregate.dataFrame], DATA_TAG_SYSTEM_COLUMNS);
        const transformEnd = performance.now();
        const transformedTable = await transformed.readTable();
        logger.info("precomputed system columns", {
            "duration": Math.floor(transformEnd - transformStart).toString()
        }, LOG_CTX);

        // Search the row number column
        let rowNumColumnName: string | null = null;
        for (let i = 0; i < columnGroups.length; ++i) {
            const group = columnGroups[i];
            switch (group.type) {
                case ROWNUMBER_COLUMN:
                    rowNumColumnName = group.value.rowNumberFieldName;
                    break;
            }
        }
        if (!rowNumColumnName) {
            throw new LoggableException("missing rownum column group", {}, LOG_CTX);
        }
        return [transformedTable, transformed, columnGroups];

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            throw new LoggableException("column precomputation failed", { "error": error.toString() }, LOG_CTX);
        }
    }
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

/// Helper to create column computation transforms
function createSystemColumnComputationTransform(schema: arrow.Schema, columns: ColumnGroup[], _stats: arrow.Table): [pb.dashql.compute.DataFrameTransform, ColumnGroup[]] {
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

/// Helper to derive column entry variants from an arrow table
function buildGridColumnGroups(table: arrow.Table): ColumnGroup[] {
    const columnGroups: ColumnGroup[] = [];
    for (let i = 0; i < table.schema.fields.length; ++i) {
        const field = table.schema.fields[i];
        switch (field.typeId) {
            case arrow.Type.Int:
            case arrow.Type.Int8:
            case arrow.Type.Int16:
            case arrow.Type.Int32:
            case arrow.Type.Int64:
            case arrow.Type.Uint8:
            case arrow.Type.Uint16:
            case arrow.Type.Uint32:
            case arrow.Type.Uint64:
            case arrow.Type.Float:
            case arrow.Type.Float16:
            case arrow.Type.Float32:
            case arrow.Type.Float64:
            case arrow.Type.Bool:
            case arrow.Type.Decimal:
            case arrow.Type.Date:
            case arrow.Type.DateDay:
            case arrow.Type.DateMillisecond:
            case arrow.Type.Time:
            case arrow.Type.TimeSecond:
            case arrow.Type.TimeMillisecond:
            case arrow.Type.TimeMicrosecond:
            case arrow.Type.TimeNanosecond:
            case arrow.Type.Timestamp:
            case arrow.Type.TimestampSecond:
            case arrow.Type.TimestampMillisecond:
            case arrow.Type.TimestampMicrosecond:
            case arrow.Type.TimestampNanosecond:
            case arrow.Type.DurationSecond:
            case arrow.Type.DurationMillisecond:
            case arrow.Type.DurationMicrosecond:
            case arrow.Type.DurationNanosecond:
                columnGroups.push({
                    type: ORDINAL_COLUMN,
                    value: {
                        inputFieldName: field.name,
                        inputFieldType: field.type,
                        inputFieldNullable: field.nullable,
                        statsFields: null,
                        binFieldName: null,
                        binCount: BIN_COUNT
                    }
                });
                break;
            case arrow.Type.Utf8:
            case arrow.Type.LargeUtf8:
                columnGroups.push({
                    type: STRING_COLUMN,
                    value: {
                        inputFieldName: field.name,
                        inputFieldType: field.type,
                        inputFieldNullable: field.nullable,
                        statsFields: null,
                        valueIdFieldName: null,
                    }
                });
                break;
            case arrow.Type.List:
            case arrow.Type.FixedSizeList:
                columnGroups.push({
                    type: LIST_COLUMN,
                    value: {
                        inputFieldName: field.name,
                        inputFieldType: field.type,
                        inputFieldNullable: field.nullable,
                        statsFields: null,
                        valueIdFieldName: null,
                    }
                });
                break;
            default:
                columnGroups.push({
                    type: SKIPPED_COLUMN,
                    value: {
                        inputFieldName: field.name,
                        inputFieldType: field.type,
                        inputFieldNullable: field.nullable,
                    }
                });
                break;
        }
    }
    return columnGroups;
}

/// Sort a table through dispatched actions
export async function sortTableDispatched(task: TableOrderingTask, dispatch: Dispatch<ComputationAction>): Promise<OrderedTable> {

    const result = new AsyncValue<OrderedTable, LoggableException>();
    const variant: TaskVariant = {
        type: TABLE_ORDERING_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

/// Sort a table
export async function sortTable(task: TableOrderingTask, logger: Logger): Promise<OrderedTable> {
    // Create the transform
    const transform = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        orderBy: buf.create(pb.dashql.compute.OrderByTransformSchema, {
            constraints: task.orderingConstraints,
        })
    });

    // Mark task as running
    if (task.orderingConstraints.length == 1) {
        logger.info("sorting table by field", {
            "field": task.orderingConstraints[0].fieldName
        }, LOG_CTX);
    } else {
        logger.info("sorting table by multiple fields", {}, LOG_CTX);
    }

    try {
        // Order the data frame
        const sortStart = performance.now();
        const transformed = await task.inputDataFrame!.transform(transform, [], DATA_TAG_ORDERING_TABLE);
        const sortEnd = performance.now();
        logger.info("sorted table", {
            "duration": Math.floor(sortEnd - sortStart).toString()
        }, LOG_CTX);
        // Read the result
        const orderedTable = await transformed.readTable();

        // The output table
        const out: OrderedTable = {
            orderingConstraints: task.orderingConstraints,
            dataTable: orderedTable,
            dataTableFieldsByName: task.inputDataTableFieldIndex,
            dataFrame: transformed,
        };
        return out;

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            throw new LoggableException(`sorting table failed`, { "error": error.toString() }, LOG_CTX);
        }
    }
}

/// Filter a table through dispatched actions
export async function filterTableDispatched(task: TableFilteringTask, dispatch: Dispatch<ComputationAction>): Promise<FilterTable | null> {

    const result = new AsyncValue<FilterTable | null, LoggableException>();
    const variant: TaskVariant = {
        type: TABLE_FILTERING_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

/// Helper to compoute a filter table
export async function filterTable(task: TableFilteringTask, logger: Logger): Promise<FilterTable | null> {
    // Short-circuit empty filter
    if (task.filters.length == 0) {
        return null;
    }

    // Filter the data frame and project the row id column
    const transform = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        filters: task.filters,
        projection: buf.create(pb.dashql.compute.ProjectionTransformSchema, {
            fields: [task.rowNumberColumnName]
        })
    });

    try {
        // Order the data frame
        const sortStart = performance.now();
        const transformed = await task.inputDataFrame!.transform(transform, [], DATA_TAG_FILTER_TABLE);
        const sortEnd = performance.now();
        const filterTable = await transformed.readTable();

        logger.info("filtered table", {
            "duration": Math.floor(sortEnd - sortStart).toString(),
            "inputRows": task.inputDataTable.numRows.toString(),
            "outputRows": filterTable.numRows.toString(),
        }, LOG_CTX);

        // The output table
        const out: FilterTable = {
            inputRowNumberColumnName: task.rowNumberColumnName,
            dataTable: filterTable,
            dataFrame: transformed,
            tableEpoch: task.tableEpoch,
        };
        return out;

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            throw new LoggableException(`filtering table failed`, { "error": error.toString() }, LOG_CTX);
        }
    }
}

/// Aggregate a table through dispatched actions
export async function computeTableAggregatesDispatched(task: TableAggregationTask, dispatch: Dispatch<ComputationAction>): Promise<[TableAggregation, ColumnGroup[]]> {

    const result = new AsyncValue<[TableAggregation, ColumnGroup[]], LoggableException>();
    const variant: TaskVariant = {
        type: TABLE_AGGREGATION_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

/// Compute table aggregates
export async function computeTableAggregates(task: TableAggregationTask, logger: Logger): Promise<[TableAggregation, ColumnGroup[]]> {
    // Create the transform
    const [transform, columnEntries, countStarColumn] = createTableAggregationTransform(task);

    try {
        // Transform the data frame
        const summaryStart = performance.now();
        const transformedDataFrame = await task.inputDataFrame!.transform(transform, [], DATA_TAG_TABLE_AGGREGATION);
        const summaryEnd = performance.now();
        logger.info("aggregated table", {
            "table": task.tableId.toString(),
            "duration": Math.floor(summaryEnd - summaryStart).toString()
        }, LOG_CTX);
        // Read the result
        const statsTable = await transformedDataFrame.readTable();
        const statsTableFields = createArrowFieldIndex(statsTable);
        const statsTableFormatter = new ArrowTableFormatter(statsTable.schema, statsTable.batches, logger);
        // The output table
        const summary: TableAggregation = {
            table: statsTable,
            tableFormatter: statsTableFormatter,
            tableFieldsByName: statsTableFields,
            dataFrame: transformedDataFrame,
            countStarFieldName: countStarColumn,
        };
        return [summary, columnEntries];

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            throw new LoggableException("computing aggregate failed", {
                "table": task.tableId.toString(),
                "error": error.toString()
            }, LOG_CTX);
        }
    }
}

function createTableAggregationTransform(task: TableAggregationTask): [pb.dashql.compute.DataFrameTransform, ColumnGroup[], string] {
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

function analyzeOrdinalColumn(tableSummary: TableAggregation, columnEntry: OrdinalGridColumnGroup, binnedValues: BinnedValuesTable, binnedValuesFormatter: ArrowTableFormatter): OrdinalColumnAnalysis {
    const totalCountVector = tableSummary.table.getChild(tableSummary.countStarFieldName!) as arrow.Vector<arrow.Int64>;
    const notNullCountVector = tableSummary.table.getChild(columnEntry.statsFields!.countFieldName) as arrow.Vector<arrow.Int64>;

    const totalCount = Number(totalCountVector.get(0) ?? BigInt(0));
    const notNullCount = Number(notNullCountVector.get(0) ?? BigInt(0));
    const minFieldId = tableSummary.tableFieldsByName.get(columnEntry.statsFields!.minAggregateFieldName!)!;
    const maxFieldId = tableSummary.tableFieldsByName.get(columnEntry.statsFields!.maxAggregateFieldName!)!;
    const minValue = tableSummary.tableFormatter.getValue(0, minFieldId) ?? "";
    const maxValue = tableSummary.tableFormatter.getValue(0, maxFieldId) ?? "";

    assert(binnedValues.schema.fields[1].name == "count");
    assert(binnedValues.schema.fields[3].name == "binLowerBound");
    const binCountVector = binnedValues.getChildAt(1) as arrow.Vector<arrow.Int64>;
    const binLowerBounds: string[] = [];
    const binPercentages = new Float64Array(binnedValues.numRows);
    for (let i = 0; i < binnedValues.numRows; ++i) {
        const binCount = binCountVector.get(i) ?? BigInt(0);
        const binLB = binnedValuesFormatter.getValue(i, 3) ?? "";
        const binPercentage = (totalCount == 0) ? 0 : (Number(binCount) / totalCount);
        binLowerBounds.push(binLB);
        binPercentages[i] = binPercentage;
    }
    return {
        countNotNull: notNullCount,
        countNull: totalCount - notNullCount,
        minValue: minValue,
        maxValue: maxValue,
        binCount: binnedValues.numRows,
        binValueCounts: binCountVector.toArray(),
        binPercentages: binPercentages,
        binLowerBounds: binLowerBounds,
    };
}

function analyzeStringColumn(tableSummary: TableAggregation, columnEntry: StringGridColumnGroup, frequentValueTable: FrequentValuesTable, frequentValuesFormatter: ArrowTableFormatter): StringColumnAnalysis {
    const totalCountVector = tableSummary.table.getChild(tableSummary.countStarFieldName!) as arrow.Vector<arrow.Int64>;
    const notNullCountVector = tableSummary.table.getChild(columnEntry.statsFields!.countFieldName) as arrow.Vector<arrow.Int64>;
    const distinctCountVector = tableSummary.table.getChild(columnEntry.statsFields!.distinctCountFieldName!) as arrow.Vector<arrow.Int64>;

    const totalCount = Number(totalCountVector.get(0) ?? BigInt(0));
    const notNullCount = Number(notNullCountVector.get(0) ?? BigInt(0));
    const distinctCount = Number(distinctCountVector.get(0) ?? BigInt(0));

    assert(frequentValueTable.schema.fields[0].name == "key");
    assert(frequentValueTable.getChild("count") != null);

    const frequentValueCounts = frequentValueTable.getChild("count")!.toArray();
    const frequentValuePercentages = new Float64Array(frequentValueTable.numRows);
    const frequentValueStrings = [];
    for (let i = 0; i < frequentValueTable.numRows; ++i) {
        frequentValuePercentages[i] = totalCount == 0 ? 0 : (Number(frequentValueCounts[i]) / totalCount);
        frequentValueStrings.push(frequentValuesFormatter.getValue(i, 0));
    }

    // Extract the value IDs (required for plotting support)
    const keyIdColumn = (frequentValueTable as arrow.Table).getChild("keyId");
    if (keyIdColumn == null) {
        throw new Error("missing keyId column in frequent values table");
    }
    const frequentValueIds = keyIdColumn.toArray() as BigInt64Array;

    return {
        countNotNull: notNullCount,
        countNull: totalCount - notNullCount,
        countDistinct: distinctCount,
        isUnique: notNullCount == distinctCount,
        frequentValueStrings: frequentValueStrings,
        frequentValueIds: frequentValueIds,
        frequentValueCounts: frequentValueCounts,
        frequentValuePercentages: frequentValuePercentages,
    };
}

function analyzeListColumn(tableSummary: TableAggregation, columnEntry: ListGridColumnGroup, frequentValueTable: FrequentValuesTable): ListColumnAnalysis {
    const totalCountVector = tableSummary.table.getChild(tableSummary.countStarFieldName!) as arrow.Vector<arrow.Int64>;
    const notNullCountVector = tableSummary.table.getChild(columnEntry.statsFields!.countFieldName) as arrow.Vector<arrow.Int64>;
    const distinctCountVector = tableSummary.table.getChild(columnEntry.statsFields!.distinctCountFieldName!) as arrow.Vector<arrow.Int64>;

    const totalCount = Number(totalCountVector.get(0) ?? BigInt(0));
    const notNullCount = Number(notNullCountVector.get(0) ?? BigInt(0));
    const distinctCount = Number(distinctCountVector.get(0) ?? BigInt(0));

    assert(frequentValueTable.schema.fields[0].name == "key");
    assert(frequentValueTable.schema.fields[1].name == "count");

    const frequentValueIsNull = new Uint8Array(frequentValueTable.numRows);
    const frequentValueKeys = frequentValueTable.getChild("key")!;
    const frequentValueCounts = frequentValueTable.getChild("count")!.toArray();
    const frequentValuePercentages = new Float64Array(frequentValueTable.numRows);
    for (let i = 0; i < frequentValueTable.numRows; ++i) {
        frequentValuePercentages[i] = totalCount == 0 ? 0 : (Number(frequentValueCounts[i]) / totalCount);
        if (frequentValueKeys.nullable) {
            for (let i = 0; i < frequentValueTable.numRows; ++i) {
                frequentValueIsNull[i] = frequentValueKeys.isValid(i) ? 0 : 1;
            }
        }
    }

    return {
        countNotNull: Number(notNullCount),
        countNull: Number(totalCount - notNullCount),
        countDistinct: Number(distinctCount),
        isUnique: notNullCount == distinctCount,
        frequentValueIsNull: frequentValueIsNull,
        frequentValueCounts: frequentValueCounts,
        frequentValuePercentages: frequentValuePercentages,
    };
}

/// Aggregate a column through dispatched actions
export async function computeColumnAggregatesDispatched(task: ColumnAggregationTask, dispatch: Dispatch<ComputationAction>): Promise<ColumnAggregationVariant> {

    const result = new AsyncValue<ColumnAggregationVariant, LoggableException>();
    const variant: TaskVariant = {
        type: COLUMN_AGGREGATION_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

/// Compute column aggregates
export async function computeColumnAggregates(task: ColumnAggregationTask, logger: Logger): Promise<ColumnAggregationVariant> {
    // Fail to compute a column aggregate on unsupported type
    if (task.columnEntry.type == SKIPPED_COLUMN || task.columnEntry.type == ROWNUMBER_COLUMN) {
        throw new LoggableException(`Column of type cannot be aggregated`, {
            type: getGridColumnTypeName(task.columnEntry),
        }, LOG_CTX);
    }

    // Create the transform
    const transform = createColumnAggregationTransform(task);

    try {
        // Order the data frame
        const transformStart = performance.now();
        const aggregateDataFrame = await task.inputDataFrame!.transform(transform, [task.tableAggregate.dataFrame], DATA_TAG_COLUMN_AGGREGATION);
        const transformEnd = performance.now();
        logger.info("aggregated table column", {
            "table": task.tableId.toString(),
            "columnIndex": task.columnId.toString(),
            "columnName": task.columnEntry.value.inputFieldName,
            "groupType": getGridColumnTypeName(task.columnEntry),
            "duration": Math.floor(transformEnd - transformStart).toString()
        }, LOG_CTX);

        // Read the result
        const aggregateTable = await aggregateDataFrame.readTable();
        const aggregateTableFormatter = new ArrowTableFormatter(aggregateTable.schema, aggregateTable.batches, logger);
        // Create the summary variant
        let columnAggregate: ColumnAggregationVariant;
        switch (task.columnEntry.type) {
            case ORDINAL_COLUMN: {
                const analysis = analyzeOrdinalColumn(task.tableAggregate, task.columnEntry.value, aggregateTable, aggregateTableFormatter);
                columnAggregate = {
                    type: ORDINAL_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        binnedDataFrame: aggregateDataFrame,
                        binnedValues: aggregateTable,
                        binnedValuesFormatter: aggregateTableFormatter,
                        columnAnalysis: analysis,
                    }
                };
                break;
            }
            case STRING_COLUMN: {
                const analysis = analyzeStringColumn(task.tableAggregate, task.columnEntry.value, aggregateTable, aggregateTableFormatter);
                columnAggregate = {
                    type: STRING_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValuesDataFrame: aggregateDataFrame,
                        frequentValuesTable: aggregateTable,
                        frequentValuesFormatter: aggregateTableFormatter,
                        analysis,
                    }
                };
                break;
            }
            case LIST_COLUMN: {
                const analysis = analyzeListColumn(task.tableAggregate, task.columnEntry.value, aggregateTable);
                columnAggregate = {
                    type: LIST_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValuesDataFrame: aggregateDataFrame,
                        frequentValuesTable: aggregateTable,
                        frequentValuesFormatter: aggregateTableFormatter,
                        analysis,
                    }
                };
                break;
            }
        }
        return columnAggregate;

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            const exception = new LoggableException("computing column aggregate failed", {
                "table": task.tableId.toString(),
                "error": error.toString(),
            }, LOG_CTX);
            logger.exception(exception);
            throw exception;
        }
    }
}

export const BIN_COUNT = 16;

function createColumnAggregationTransform(task: ColumnAggregationTask, filtered: [FilterTable, ColumnAggregationVariant] | null = null): pb.dashql.compute.DataFrameTransform {
    if (task.columnEntry.type == SKIPPED_COLUMN || task.columnEntry.type == ROWNUMBER_COLUMN || task.columnEntry.value.statsFields == null) {
        throw new Error("column summary requires precomputed table summary");
    }
    let filters: pb.dashql.compute.FilterTransform[] = [];
    if (filtered != null) {
        const filterTable = filtered[0];
        filters.push(buf.create(pb.dashql.compute.FilterTransformSchema, {
            fieldName: filterTable.inputRowNumberColumnName,
            operator: pb.dashql.compute.FilterOperator.SemiJoinField,
            semiJoinField: buf.create(pb.dashql.compute.FilterSemiJoinFieldSchema, {
                tableId: 1,
                fieldName: filterTable.dataTable.schema.fields[0].name
            })
        }));
    }
    let targetFieldName = task.columnEntry.value.inputFieldName;
    let out: pb.dashql.compute.DataFrameTransform;
    switch (task.columnEntry.type) {
        case ORDINAL_COLUMN: {
            const minField = task.columnEntry.value.statsFields.minAggregateFieldName!;
            const maxField = task.columnEntry.value.statsFields.maxAggregateFieldName!;
            out = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
                filters,
                groupBy: buf.create(pb.dashql.compute.GroupByTransformSchema, {
                    keys: [
                        buf.create(pb.dashql.compute.GroupByKeySchema, {
                            fieldName: targetFieldName,
                            outputAlias: "bin",
                            binning: buf.create(pb.dashql.compute.GroupByKeyBinningSchema, {
                                // XXX Use pre-binned field
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
                            fieldName: targetFieldName,
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
        case STRING_COLUMN: {
            if (task.columnEntry.value.valueIdFieldName == null) {
                throw new Error("cannot aggregate string column without precomputed value id");
            }
            out = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
                filters,
                groupBy: buf.create(pb.dashql.compute.GroupByTransformSchema, {
                    keys: [
                        buf.create(pb.dashql.compute.GroupByKeySchema, {
                            fieldName: targetFieldName,
                            outputAlias: "key",
                        }),
                        buf.create(pb.dashql.compute.GroupByKeySchema, {
                            fieldName: task.columnEntry.value.valueIdFieldName,
                            outputAlias: "keyId",
                        })
                    ],
                    aggregates: [
                        buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                            fieldName: targetFieldName,
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
        case LIST_COLUMN: {
            out = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
                filters,
                groupBy: buf.create(pb.dashql.compute.GroupByTransformSchema, {
                    keys: [
                        buf.create(pb.dashql.compute.GroupByKeySchema, {
                            fieldName: targetFieldName,
                            outputAlias: "key",
                        })
                    ],
                    aggregates: [
                        buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                            fieldName: targetFieldName,
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

/// Compute column aggregates
export async function computeFilteredColumnAggregates(task: WithFilter<ColumnAggregationTask>, logger: Logger): Promise<WithFilterEpoch<ColumnAggregationVariant> | null> {
    // Fail to compute a column aggregate on unsupported type
    if (task.columnEntry.type == SKIPPED_COLUMN || task.columnEntry.type == ROWNUMBER_COLUMN) {
        throw new LoggableException(`Column of type cannot be aggregated`, {
            type: getGridColumnTypeName(task.columnEntry),
        }, LOG_CTX);
    }

    // Create the transform
    const transform = createColumnAggregationTransform(task, [task.filterTable, task.unfilteredAggregate]);

    try {
        // Order the data frame
        const transformStart = performance.now();
        const aggregateDataFrame = await task.inputDataFrame!.transform(transform, [task.tableAggregate.dataFrame, task.filterTable.dataFrame], DATA_TAG_FILTERED_COLUMN_AGGREGATION);
        const transformEnd = performance.now();
        logger.info("aggregated filtered table column", {
            "table": task.tableId.toString(),
            "columnIndex": task.columnId.toString(),
            "columnName": task.columnEntry.value.inputFieldName,
            "groupType": getGridColumnTypeName(task.columnEntry),
            "duration": Math.floor(transformEnd - transformStart).toString()
        }, LOG_CTX);

        // Read the result
        const aggregateTable = await aggregateDataFrame.readTable();
        const aggregateTableFormatter = new ArrowTableFormatter(aggregateTable.schema, aggregateTable.batches, logger);
        // Create the summary variant
        let columnAggregate: WithFilterEpoch<ColumnAggregationVariant>;
        switch (task.columnEntry.type) {
            case ORDINAL_COLUMN: {
                const analysis = analyzeOrdinalColumn(task.tableAggregate, task.columnEntry.value, aggregateTable, aggregateTableFormatter);
                columnAggregate = {
                    type: ORDINAL_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        binnedDataFrame: aggregateDataFrame,
                        binnedValues: aggregateTable,
                        binnedValuesFormatter: aggregateTableFormatter,
                        columnAnalysis: analysis,
                    },
                    filterTableEpoch: task.filterTable.tableEpoch,
                };
                break;
            }
            case STRING_COLUMN: {
                const analysis = analyzeStringColumn(task.tableAggregate, task.columnEntry.value, aggregateTable, aggregateTableFormatter);
                columnAggregate = {
                    type: STRING_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValuesDataFrame: aggregateDataFrame,
                        frequentValuesTable: aggregateTable,
                        frequentValuesFormatter: aggregateTableFormatter,
                        analysis,
                    },
                    filterTableEpoch: task.filterTable.tableEpoch,
                };
                break;
            }
            case LIST_COLUMN: {
                const analysis = analyzeListColumn(task.tableAggregate, task.columnEntry.value, aggregateTable);
                columnAggregate = {
                    type: LIST_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValuesDataFrame: aggregateDataFrame,
                        frequentValuesTable: aggregateTable,
                        frequentValuesFormatter: aggregateTableFormatter,
                        analysis,
                    },
                    filterTableEpoch: task.filterTable.tableEpoch,
                };
                break;
            }
        }
        return columnAggregate;

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            const exception = new LoggableException("computing filtered column aggregate failed", {
                "table": task.tableId.toString(),
                "columnIndex": task.columnId.toString(),
                "columnName": task.columnEntry.value.inputFieldName,
                "error": error.toString(),
            }, LOG_CTX);
            logger.exception(exception);
            throw exception;
        }
    }
}
