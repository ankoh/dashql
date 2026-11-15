import * as arrow from 'apache-arrow';

import { ANALYZE_TABLE, ComputationAction } from './computation_state.js';
import { Dispatch } from '../utils/variant.js';
import { LoggerLike } from '../platform/logger/logger.js';
import type { EmbeddedClientContext, EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { AsyncValue } from '../utils/async_value.js';

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
