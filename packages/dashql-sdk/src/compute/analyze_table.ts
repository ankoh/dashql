import * as arrow from 'apache-arrow';

import { DataFrame, generateTableName } from './data_frame.js';
import { COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK } from './computation_types.js';
import { COMPUTATION_FROM_QUERY_RESULT, ComputationAction, CREATED_DATA_FRAME } from './computation_state.js';
import { ColumnAggregationTask, TableAggregationTask, ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, ColumnGroup, SKIPPED_COLUMN, SystemColumnComputationTask, ROWNUMBER_COLUMN, ComputationStateVersion } from './computation_types.js';
import { Dispatch } from '../utils/variant.js';
import { LoggerLike } from '../platform/logger/logger.js';
import type { EmbeddedClientContext, EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { scheduleTask } from './computation_tasks.js';
import { createUniqueColumnName } from './arrow_columns.js';

const LOG_CTX = "compute";

/// The number of bins of an ordinal column
const BIN_COUNT = 16;

/// Options of the analysis of a table
export interface AnalyzeTableOptions {
    /// The client context of the queries of a table without a connection, e.g. of the connection overview
    clientContext?: EmbeddedClientContext | null;
    /// Compute the aggregates of the columns, e.g. false for a table that shows no column plots
    columnAggregates?: boolean;
}

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
export async function analyzeTable(tableId: number, table: arrow.Table, dispatch: Dispatch<ComputationAction>, database: EmbeddedComputeDatabase, logger: LoggerLike, connectionId: string | null = null, options: AnalyzeTableOptions = {}): Promise<void> {
    // Statements such as DDL can legitimately produce an Arrow table without columns. There is
    // nothing to summarize, and embedded databases reject importing a zero-column table.
    if (table.numCols === 0) {
        return;
    }

    let gridColumnGroups = buildGridColumnGroups(table!);
    const computeAbortCtrl = new AbortController();
    dispatch({
        type: COMPUTATION_FROM_QUERY_RESULT,
        value: [tableId, table!, gridColumnGroups, computeAbortCtrl, connectionId, options.clientContext ?? null]
    });

    const [numberedTable, rowNumberFieldName] = appendRowNumbers(table);
    const inputTableName = generateTableName("__input");
    let dataFrame = await DataFrame.fromArrowTable(database, numberedTable, inputTableName, options.clientContext ?? null);
    dispatch({
        type: CREATED_DATA_FRAME,
        value: [tableId, dataFrame]
    });

    // Compute table aggregates
    const tableAggregationTask: TableAggregationTask = {
        tableId,
        tableVersion: new ComputationStateVersion(0, 0),
        columnEntries: gridColumnGroups,
        inputDataFrame: dataFrame
    };
    const [tableAggregate, initialColumnGroups] = await scheduleTask(TABLE_AGGREGATION_TASK, tableAggregationTask, dispatch);
    gridColumnGroups = initialColumnGroups;

    // Precompute the system columns
    const precomputationTask: SystemColumnComputationTask = {
        tableId,
        tableVersion: new ComputationStateVersion(0, 0),
        columnEntries: gridColumnGroups,
        inputTable: table,
        inputDataFrame: dataFrame,
        rowNumberFieldName,
        tableAggregate
    };
    const [newTable, newDataFrame, updatedColumnGroups] = await scheduleTask(SYSTEM_COLUMN_COMPUTATION_TASK, precomputationTask, dispatch);
    gridColumnGroups = updatedColumnGroups;

    // Compute the column aggregates
    let colAggregateCount = 0;
    let colAggregateOrdinalCount = 0;
    let colAggregateStringCount = 0;
    let colAggregateSlowestDuration = 0;
    let colAggregateSlowestColumn: string | null = null;
    let colAggregatesBegin = performance.now();
    logger.info("Computing column aggregates", {
        "table": tableId.toString(),
        "rows": newTable.numRows.toString(),
        "columns": gridColumnGroups.length.toString(),
    }, LOG_CTX);
    // A table without column plots needs no column aggregates
    const aggregatedColumns = options.columnAggregates === false ? 0 : gridColumnGroups.length;
    for (let columnId = 0; columnId < aggregatedColumns; ++columnId) {
        // LIST columns (e.g. float32 embedding arrays) are not aggregated: their value
        // identifier / frequent-value / distinct-count computations are very expensive
        // (full-vector sort/hash) and buy nothing — no summary histogram is rendered for
        // them. We keep the LIST_COLUMN group but skip all of its embedded-database
        // aggregation work.
        const columnEntry = gridColumnGroups[columnId];
        if (columnEntry.type == SKIPPED_COLUMN || columnEntry.type == ROWNUMBER_COLUMN || columnEntry.type == LIST_COLUMN) {
            continue;
        }
        const columnAggregationTask: ColumnAggregationTask = {
            tableId,
            tableVersion: new ComputationStateVersion(0, 0),
            columnId,
            tableAggregate,
            columnEntry,
            inputDataFrame: newDataFrame,
        };
        // Measured around the dispatch, so this includes the scheduler round trip.
        const columnBegin = performance.now();
        await scheduleTask(COLUMN_AGGREGATION_TASK, columnAggregationTask, dispatch);
        const columnDuration = performance.now() - columnBegin;
        if (columnDuration > colAggregateSlowestDuration) {
            colAggregateSlowestDuration = columnDuration;
            colAggregateSlowestColumn = columnEntry.value.inputFieldName;
        }
        ++colAggregateCount;
        if (columnEntry.type == ORDINAL_COLUMN) {
            ++colAggregateOrdinalCount;
        } else {
            ++colAggregateStringCount;
        }
    }
    let colAggregatesEnd = performance.now();

    if (colAggregateCount > 0) {
        const duration = colAggregatesEnd - colAggregatesBegin;
        logger.info("Computed column aggregates", {
            "table": tableId.toString(),
            "rows": newTable.numRows.toString(),
            "aggregates": colAggregateCount.toString(),
            "ordinal": colAggregateOrdinalCount.toString(),
            "string": colAggregateStringCount.toString(),
            "duration": Math.floor(duration).toString(),
            "avgDuration": Math.floor(duration / colAggregateCount).toString(),
            "maxDuration": Math.floor(colAggregateSlowestDuration).toString(),
            "slowestColumn": colAggregateSlowestColumn ?? "",
        }, LOG_CTX);
    }
}

/// A table with the positions of its rows as an appended row-number column, from 1, and the name of the column.
/// The row numbers are appended before the import into the embedded database because Hyper numbers the rows of
/// row_number() OVER () in no particular order.
export function appendRowNumbers(table: arrow.Table): [arrow.Table, string] {
    const fieldName = createUniqueColumnName("_rownum", new Set(table.schema.fields.map(field => field.name)));
    const rowNumbers = BigInt64Array.from({ length: table.numRows }, (_, i) => BigInt(i + 1));
    return [table.assign(new arrow.Table({ [fieldName]: arrow.makeVector(rowNumbers) })), fieldName];
}

export function buildGridColumnGroups(table: arrow.Table): ColumnGroup[] {
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
