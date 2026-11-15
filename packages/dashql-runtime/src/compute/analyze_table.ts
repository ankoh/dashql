import * as arrow from 'apache-arrow';

import { ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, ColumnGroup, SKIPPED_COLUMN } from './computation_types.js';
import { ANALYZE_TABLE, ComputationAction } from './computation_state.js';
import { Dispatch } from '../utils/variant.js';
import { LoggerLike } from '../platform/logger/logger.js';
import type { EmbeddedClientContext, EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { createUniqueColumnName } from './arrow_columns.js';
import { AsyncValue } from '../utils/async_value.js';

/// The number of bins of an ordinal column
const BIN_COUNT = 16;

/// Options of the analysis of a table
export interface AnalyzeTableOptions {
    /// The client context of the queries of a table without a connection, e.g. of the connection overview
    clientContext?: EmbeddedClientContext | null;
    /// Compute the aggregates of the columns, e.g. false for a table that shows no column plots
    columnAggregates?: boolean;
}

/// Analyze a table for the grid: the statistics of its columns, the system columns with the row numbers, the bins and
/// the value ids, and the summary of every ordinal and string column.
///
/// The analysis runs in the runtime of the core (`analyze_table` of `packages/dashql-core-runtime/src/compute/service.rs`)
/// on the compute database, the computations get the result as Arrow IPC once. It settles once the summaries are
/// computed and fails with the error of a failed task. The tasks log through the logger of the computations.
export async function analyzeTable(tableId: number, table: arrow.Table, dispatch: Dispatch<ComputationAction>, database: EmbeddedComputeDatabase, _logger: LoggerLike, connectionId: string | null = null, options: AnalyzeTableOptions = {}): Promise<void> {
    // Statements such as DDL can legitimately produce an Arrow table without columns. There is
    // nothing to summarize, and embedded databases reject importing a zero-column table.
    if (table.numCols === 0) {
        return;
    }
    const result = new AsyncValue<void, Error>();
    dispatch({
        type: ANALYZE_TABLE,
        value: {
            tableId,
            table,
            database,
            connectionId,
            clientContext: options.clientContext ?? null,
            columnAggregates: options.columnAggregates !== false,
            result,
        },
    });
    await result.getValue();
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
