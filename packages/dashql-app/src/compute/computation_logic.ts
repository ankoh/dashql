import * as arrow from 'apache-arrow';
import * as buf from '@bufbuild/protobuf';
import * as pb from '@ankoh/dashql-protobuf';

import { Dispatch } from '../utils/variant.js';
import { Logger } from '../platform/logger.js';
import { COLUMN_SUMMARY_TASK_FAILED, COLUMN_SUMMARY_TASK_RUNNING, COLUMN_SUMMARY_TASK_SUCCEEDED, COMPUTATION_FROM_QUERY_RESULT, ComputationAction, createArrowFieldIndex, CREATED_DATA_FRAME, SYSTEM_COLUMN_COMPUTATION_TASK_FAILED, SYSTEM_COLUMN_COMPUTATION_TASK_RUNNING, SYSTEM_COLUMN_COMPUTATION_TASK_SUCCEEDED, TABLE_FILTERING_TASK_FAILED, TABLE_FILTERING_TASK_RUNNING, TABLE_FILTERING_TASK_SUCCEEDED, TABLE_ORDERING_TASK_FAILED, TABLE_ORDERING_TASK_RUNNING, TABLE_ORDERING_TASK_SUCCEEDED, TABLE_SUMMARY_TASK_FAILED, TABLE_SUMMARY_TASK_RUNNING, TABLE_SUMMARY_TASK_SUCCEEDED } from './computation_state.js';
import { ColumnSummaryVariant, ColumnSummaryTask, TableSummaryTask, TaskStatus, TableOrderingTask, TableSummary, OrderedTable, TaskProgress, ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, createOrderByTransform, createTableSummaryTransform, createColumnSummaryTransform, GridColumnGroup, SKIPPED_COLUMN, OrdinalColumnAnalysis, StringColumnAnalysis, ListColumnAnalysis, ListGridColumnGroup, StringGridColumnGroup, OrdinalGridColumnGroup, BinnedValuesTable, FrequentValuesTable, createSystemColumnComputationTransform, SystemColumnComputationTask, BIN_COUNT, ROWNUMBER_COLUMN, getGridColumnTypeName, TableFilteringTask, FilterTable } from './computation_types.js';
import { AsyncDataFrame, ComputeWorkerBindings } from './compute_worker_bindings.js';
import { ArrowTableFormatter } from '../view/query_result/arrow_formatter.js';
import { assert } from '../utils/assert.js';

const LOG_CTX = "compute";

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
    let dataFrame = await worker.createDataFrameFromTable(table);
    dispatch({
        type: CREATED_DATA_FRAME,
        value: [tableId, dataFrame]
    });

    // Summarize the table
    const tableSummaryTask: TableSummaryTask = {
        tableId,
        columnEntries: gridColumnGroups,
        inputDataFrame: dataFrame
    };
    const [tableSummary, updatedGridColumnGroups1] = await computeTableSummary(tableSummaryTask, dispatch, logger);
    gridColumnGroups = updatedGridColumnGroups1;

    // Precompute column expressions
    const precomputationTask: SystemColumnComputationTask = {
        tableId,
        columnEntries: gridColumnGroups,
        inputTable: table,
        inputDataFrame: dataFrame,
        tableSummary
    };
    const [newDataFrame, updatedGridColumnGroups2] = await computeSystemColumns(precomputationTask, dispatch, logger);
    gridColumnGroups = updatedGridColumnGroups2;

    // Summarize the columns
    for (let columnId = 0; columnId < gridColumnGroups.length; ++columnId) {
        // Skip columns that don't compute a column summary
        if (gridColumnGroups[columnId].type == SKIPPED_COLUMN || gridColumnGroups[columnId].type == ROWNUMBER_COLUMN) {
            continue;
        }
        const columnSummaryTask: ColumnSummaryTask = {
            tableId,
            columnId,
            tableSummary: tableSummary,
            columnEntry: gridColumnGroups[columnId],
            inputDataFrame: newDataFrame,
        };
        await computeColumnSummary(tableId, columnSummaryTask, dispatch, logger);
    }
}

/// Precompute system columns for fast column summaries
async function computeSystemColumns(task: SystemColumnComputationTask, dispatch: Dispatch<ComputationAction>, logger: Logger): Promise<[AsyncDataFrame, GridColumnGroup[]]> {
    let startedAt = new Date();
    let taskProgress: TaskProgress = {
        status: TaskStatus.TASK_RUNNING,
        startedAt,
        completedAt: null,
        failedAt: null,
        failedWithError: null,
    };
    try {
        dispatch({
            type: SYSTEM_COLUMN_COMPUTATION_TASK_RUNNING,
            value: [task.tableId, taskProgress]
        });
        // Create precomputation transform
        const [transform, newGridColumns] = createSystemColumnComputationTransform(task.inputTable.schema, task.columnEntries, task.tableSummary.statsTable);

        // Get timings
        const transformStart = performance.now();
        const transformed = await task.inputDataFrame.transform(transform, task.tableSummary.statsDataFrame);
        const transformEnd = performance.now();
        const transformedTable = await transformed.readTable();
        logger.info("precomputed system columns", { "duration": Math.floor(transformEnd - transformStart).toString() }, LOG_CTX);

        // Search the row number column
        let rowNumColumnName: string | null = null;
        for (let i = 0; i < newGridColumns.length; ++i) {
            const group = newGridColumns[i];
            switch (group.type) {
                case ROWNUMBER_COLUMN:
                    rowNumColumnName = group.value.rowNumberFieldName;
                    break;
            }
        }
        if (!rowNumColumnName) {
            logger.error("missing rownum column group", {}, LOG_CTX);
        }
        dispatch({
            type: SYSTEM_COLUMN_COMPUTATION_TASK_SUCCEEDED,
            value: [task.tableId, taskProgress, transformedTable, transformed, newGridColumns],
        });
        return [transformed, newGridColumns];
    } catch (error: any) {
        logger.error("column precomputation failed", { "error": error.toString() }, LOG_CTX);
        taskProgress = {
            status: TaskStatus.TASK_FAILED,
            startedAt,
            completedAt: null,
            failedAt: new Date(),
            failedWithError: error,
        };
        dispatch({
            type: SYSTEM_COLUMN_COMPUTATION_TASK_FAILED,
            value: [task.tableId, taskProgress, error],
        });
        throw error;
    }
}

/// Helper to derive column entry variants from an arrow table
function buildGridColumnGroups(table: arrow.Table): GridColumnGroup[] {
    const columnGroups: GridColumnGroup[] = [];
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

/// Helper to sort a table
export async function sortTable(task: TableOrderingTask, dispatch: Dispatch<ComputationAction>, logger: Logger): Promise<void> {
    // Create the transform
    const transform = createOrderByTransform(task.orderingConstraints);

    // Mark task as running
    let startedAt = new Date();
    let taskProgress: TaskProgress = {
        status: TaskStatus.TASK_RUNNING,
        startedAt,
        completedAt: null,
        failedAt: null,
        failedWithError: null,
    };

    if (task.orderingConstraints.length == 1) {
        logger.info("sorting table by field", { "field": task.orderingConstraints[0].fieldName }, LOG_CTX);
    } else {
        logger.info("sorting table by multiple fields", {}, LOG_CTX);
    }

    try {
        dispatch({
            type: TABLE_ORDERING_TASK_RUNNING,
            value: [task.tableId, taskProgress]
        });
        // Order the data frame
        const sortStart = performance.now();
        const transformed = await task.inputDataFrame!.transform(transform);
        const sortEnd = performance.now();
        logger.info("sorted table", { "duration": Math.floor(sortEnd - sortStart).toString() }, LOG_CTX);
        // Read the result
        const orderedTable = await transformed.readTable();

        // The output table
        const out: OrderedTable = {
            orderingConstraints: task.orderingConstraints,
            dataTable: orderedTable,
            dataTableFieldsByName: task.inputDataTableFieldIndex,
            dataFrame: transformed,
        };
        // Mark the task as running
        taskProgress = {
            status: TaskStatus.TASK_SUCCEEDED,
            startedAt,
            completedAt: new Date(),
            failedAt: null,
            failedWithError: null,
        };
        dispatch({
            type: TABLE_ORDERING_TASK_SUCCEEDED,
            value: [task.tableId, taskProgress, out],
        });

    } catch (error: any) {
        logger.error(`sorting table failed`, { "error": error.toString() }, LOG_CTX);
        taskProgress = {
            status: TaskStatus.TASK_FAILED,
            startedAt,
            completedAt: null,
            failedAt: new Date(),
            failedWithError: error,
        };
        dispatch({
            type: TABLE_ORDERING_TASK_FAILED,
            value: [task.tableId, taskProgress, error],
        });
    }
}

/// Helper to compoute a filter table
export async function filterTable(task: TableFilteringTask, dispatch: Dispatch<ComputationAction>, logger: Logger): Promise<void> {
    // Filter the data frame and project the row id column
    const transform = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        filters: task.filters,
        projection: buf.create(pb.dashql.compute.ProjectionTransformSchema, {
            fields: [task.rowNumberColumnName]
        })
    });

    // Mark task as running
    let startedAt = new Date();
    let taskProgress: TaskProgress = {
        status: TaskStatus.TASK_RUNNING,
        startedAt,
        completedAt: null,
        failedAt: null,
        failedWithError: null,
    };

    try {
        dispatch({
            type: TABLE_FILTERING_TASK_RUNNING,
            value: [task.tableId, taskProgress]
        });
        // Order the data frame
        const sortStart = performance.now();
        const transformed = await task.inputDataFrame!.transform(transform);
        const sortEnd = performance.now();
        const filterTable = await transformed.readTable();

        logger.info("filtered table", {
            "duration": Math.floor(sortEnd - sortStart).toString(),
            "inputRows": task.inputDataTable.numRows.toString(),
            "outputRows": filterTable.numRows.toString(),
        }, LOG_CTX);
        // console.log(task.inputDataTable.toString());

        // The output table
        const out: FilterTable = {
            dataTable: filterTable,
            dataFrame: transformed
        };
        // Mark the task as running
        taskProgress = {
            status: TaskStatus.TASK_SUCCEEDED,
            startedAt,
            completedAt: new Date(),
            failedAt: null,
            failedWithError: null,
        };
        dispatch({
            type: TABLE_FILTERING_TASK_SUCCEEDED,
            value: [task.tableId, taskProgress, out],
        });

    } catch (error: any) {
        logger.error(`filtering table failed`, { "error": error.toString() }, LOG_CTX);
        taskProgress = {
            status: TaskStatus.TASK_FAILED,
            startedAt,
            completedAt: null,
            failedAt: new Date(),
            failedWithError: error,
        };
        dispatch({
            type: TABLE_FILTERING_TASK_FAILED,
            value: [task.tableId, taskProgress, error],
        });
    }
}

/// Helper to summarize a table
export async function computeTableSummary(task: TableSummaryTask, dispatch: Dispatch<ComputationAction>, logger: Logger): Promise<[TableSummary, GridColumnGroup[]]> {
    // Create the transform
    const [transform, columnEntries, countStarColumn] = createTableSummaryTransform(task);

    // Mark task as running
    let startedAt = new Date();
    let taskProgress: TaskProgress = {
        status: TaskStatus.TASK_RUNNING,
        startedAt,
        completedAt: null,
        failedAt: null,
        failedWithError: null,
    }

    try {
        dispatch({
            type: TABLE_SUMMARY_TASK_RUNNING,
            value: [task.tableId, taskProgress]
        });
        // Order the data frame
        const summaryStart = performance.now();
        const transformedDataFrame = await task.inputDataFrame!.transform(transform);
        const summaryEnd = performance.now();
        logger.info("aggregated table", { "computation": task.tableId.toString(), "duration": Math.floor(summaryEnd - summaryStart).toString() }, LOG_CTX);
        // Read the result
        const statsTable = await transformedDataFrame.readTable();
        const statsTableFields = createArrowFieldIndex(statsTable);
        const statsTableFormatter = new ArrowTableFormatter(statsTable.schema, statsTable.batches, logger);
        // The output table
        const summary: TableSummary = {
            statsTable,
            statsTableFormatter,
            statsTableFieldsByName: statsTableFields,
            statsDataFrame: transformedDataFrame,
            statsCountStarFieldName: countStarColumn,
        };
        // Mark the task as succeeded
        taskProgress = {
            status: TaskStatus.TASK_SUCCEEDED,
            startedAt,
            completedAt: new Date(),
            failedAt: null,
            failedWithError: null,
        };
        dispatch({
            type: TABLE_SUMMARY_TASK_SUCCEEDED,
            value: [task.tableId, taskProgress, summary],
        });
        return [summary, columnEntries];

    } catch (error: any) {
        logger.error("ordering table failed", { "computation": task.tableId.toString(), "error": error.toString() }, LOG_CTX);
        taskProgress = {
            status: TaskStatus.TASK_FAILED,
            startedAt,
            completedAt: null,
            failedAt: new Date(),
            failedWithError: error,
        };
        dispatch({
            type: TABLE_SUMMARY_TASK_FAILED,
            value: [task.tableId, taskProgress, error],
        });
        throw error;
    }
}

function analyzeOrdinalColumn(tableSummary: TableSummary, columnEntry: OrdinalGridColumnGroup, binnedValues: BinnedValuesTable, binnedValuesFormatter: ArrowTableFormatter): OrdinalColumnAnalysis {
    const totalCountVector = tableSummary.statsTable.getChild(tableSummary.statsCountStarFieldName!) as arrow.Vector<arrow.Int64>;
    const notNullCountVector = tableSummary.statsTable.getChild(columnEntry.statsFields!.countFieldName) as arrow.Vector<arrow.Int64>;

    const totalCount = Number(totalCountVector.get(0) ?? BigInt(0));
    const notNullCount = Number(notNullCountVector.get(0) ?? BigInt(0));
    const minFieldId = tableSummary.statsTableFieldsByName.get(columnEntry.statsFields!.minAggregateFieldName!)!;
    const maxFieldId = tableSummary.statsTableFieldsByName.get(columnEntry.statsFields!.maxAggregateFieldName!)!;
    const minValue = tableSummary.statsTableFormatter.getValue(0, minFieldId) ?? "";
    const maxValue = tableSummary.statsTableFormatter.getValue(0, maxFieldId) ?? "";

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

function analyzeStringColumn(tableSummary: TableSummary, columnEntry: StringGridColumnGroup, frequentValueTable: FrequentValuesTable, frequentValuesFormatter: ArrowTableFormatter): StringColumnAnalysis {
    const totalCountVector = tableSummary.statsTable.getChild(tableSummary.statsCountStarFieldName!) as arrow.Vector<arrow.Int64>;
    const notNullCountVector = tableSummary.statsTable.getChild(columnEntry.statsFields!.countFieldName) as arrow.Vector<arrow.Int64>;
    const distinctCountVector = tableSummary.statsTable.getChild(columnEntry.statsFields!.distinctCountFieldName!) as arrow.Vector<arrow.Int64>;

    const totalCount = Number(totalCountVector.get(0) ?? BigInt(0));
    const notNullCount = Number(notNullCountVector.get(0) ?? BigInt(0));
    const distinctCount = Number(distinctCountVector.get(0) ?? BigInt(0));

    assert(frequentValueTable.schema.fields[0].name == "key");
    assert(frequentValueTable.schema.fields[1].name == "count");

    const frequentValueCounts = frequentValueTable.getChild("count")!.toArray();
    const frequentValuePercentages = new Float64Array(frequentValueTable.numRows);
    const frequentValueStrings = [];
    for (let i = 0; i < frequentValueTable.numRows; ++i) {
        frequentValuePercentages[i] = totalCount == 0 ? 0 : (Number(frequentValueCounts[i]) / totalCount);
        frequentValueStrings.push(frequentValuesFormatter.getValue(i, 0));
    }

    return {
        countNotNull: notNullCount,
        countNull: totalCount - notNullCount,
        countDistinct: distinctCount,
        isUnique: notNullCount == distinctCount,
        frequentValueStrings: frequentValueStrings,
        frequentValueCounts: frequentValueCounts,
        frequentValuePercentages: frequentValuePercentages,
    };
}

function analyzeListColumn(tableSummary: TableSummary, columnEntry: ListGridColumnGroup, frequentValueTable: FrequentValuesTable): ListColumnAnalysis {
    const totalCountVector = tableSummary.statsTable.getChild(tableSummary.statsCountStarFieldName!) as arrow.Vector<arrow.Int64>;
    const notNullCountVector = tableSummary.statsTable.getChild(columnEntry.statsFields!.countFieldName) as arrow.Vector<arrow.Int64>;
    const distinctCountVector = tableSummary.statsTable.getChild(columnEntry.statsFields!.distinctCountFieldName!) as arrow.Vector<arrow.Int64>;

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

export async function computeColumnSummary(tableId: number, task: ColumnSummaryTask, dispatch: Dispatch<ComputationAction>, logger: Logger): Promise<ColumnSummaryVariant> {
    // Fail to compute a column summary on unsupported type
    if (task.columnEntry.type == SKIPPED_COLUMN || task.columnEntry.type == ROWNUMBER_COLUMN) {
        throw new Error(`Cannot compute a column summary for type foo ${getGridColumnTypeName(task.columnEntry)}`);
    }

    // Create the transform
    const columnSummaryTransform = createColumnSummaryTransform(task);

    // Mark task as running
    let startedAt = new Date();
    let taskProgress: TaskProgress = {
        status: TaskStatus.TASK_RUNNING,
        startedAt,
        completedAt: null,
        failedAt: null,
        failedWithError: null,
    }

    try {
        dispatch({
            type: COLUMN_SUMMARY_TASK_RUNNING,
            value: [task.tableId, task.columnId, taskProgress]
        });
        // Order the data frame
        const summaryStart = performance.now();
        const columnSummaryDataFrame = await task.inputDataFrame!.transform(columnSummaryTransform, task.tableSummary.statsDataFrame);
        const summaryEnd = performance.now();
        logger.info("aggregated table column", { "computation": task.tableId.toString(), "column": task.columnId.toString(), "duration": Math.floor(summaryEnd - summaryStart).toString() }, LOG_CTX);
        // Read the result
        const columnSummaryTable = await columnSummaryDataFrame.readTable();
        const columnSummaryTableFormatter = new ArrowTableFormatter(columnSummaryTable.schema, columnSummaryTable.batches, logger);
        // Delete the data frame after reordering
        columnSummaryDataFrame.destroy();
        // Create the summary variant
        let summary: ColumnSummaryVariant;
        switch (task.columnEntry.type) {
            case ORDINAL_COLUMN: {
                const analysis = analyzeOrdinalColumn(task.tableSummary, task.columnEntry.value, columnSummaryTable, columnSummaryTableFormatter);
                summary = {
                    type: ORDINAL_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        binnedValues: columnSummaryTable,
                        binnedValuesFormatter: columnSummaryTableFormatter,
                        analysis,
                    }
                };
                break;
            }
            case STRING_COLUMN: {
                const analysis = analyzeStringColumn(task.tableSummary, task.columnEntry.value, columnSummaryTable, columnSummaryTableFormatter);
                summary = {
                    type: STRING_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValues: columnSummaryTable,
                        frequentValuesFormatter: columnSummaryTableFormatter,
                        analysis,
                    }
                };
                break;
            }
            case LIST_COLUMN: {
                const analysis = analyzeListColumn(task.tableSummary, task.columnEntry.value, columnSummaryTable);
                summary = {
                    type: LIST_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValues: columnSummaryTable,
                        frequentValuesFormatter: columnSummaryTableFormatter,
                        analysis,
                    }
                };
                break;
            }
        }
        // Mark the task as succeeded
        taskProgress = {
            status: TaskStatus.TASK_SUCCEEDED,
            startedAt,
            completedAt: new Date(),
            failedAt: null,
            failedWithError: null,
        };
        dispatch({
            type: COLUMN_SUMMARY_TASK_SUCCEEDED,
            value: [task.tableId, task.columnId, taskProgress, summary],
        });

        return summary;

    } catch (error: any) {
        logger.error("aggregated table", { "computation": tableId.toString(), "error": error.toString() }, LOG_CTX);
        taskProgress = {
            status: TaskStatus.TASK_FAILED,
            startedAt,
            completedAt: null,
            failedAt: new Date(),
            failedWithError: error,
        };
        dispatch({
            type: COLUMN_SUMMARY_TASK_FAILED,
            value: [task.tableId, task.columnId, taskProgress, error],
        });

        throw error;
    }
}

