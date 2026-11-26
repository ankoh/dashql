import type { QueryExecutor } from '@akohn/dashql/platform/connections/query_execution_args';
import { DashQLShellEnvironment } from '../terminal/api.js';
import { reportShellTiming, SHELL_QUERY_METADATA } from '../terminal/shell_result.js';

interface EmbeddedDatabaseShellEnvironmentOptions {
    /// Called after a statement ran or failed, before its result shows and the prompt returns, e.g. to wait for the
    /// catalog of the connection
    afterStatement?: (query: string) => Promise<void>;
    /// The first rows of a result as an Arrow IPC stream, for the table of the terminal, see
    /// `DashQLShellEnvironment.previewResult`
    previewResult?: (queryId: number, limit: number) => Promise<Uint8Array>;
    /// Release the computation of a result that the shell did not pass on, see `DashQLShellEnvironment.releaseResult`
    releaseResult?: (queryId: number) => void;
}

/// The environment of a shell whose statements run with the query executor of a runtime on a connection, e.g. the
/// embedded Hyper of the shell. A statement is a query of the history of the connection, the executor analyzes its
/// result as the computation of the query and tells the catalog loader about the relations it touched.
export function createEmbeddedDatabaseShellEnvironment(
    execute: QueryExecutor,
    connectionId: string,
    options: EmbeddedDatabaseShellEnvironmentOptions = {},
): DashQLShellEnvironment {
    return {
        previewResult: options.previewResult,
        releaseResult: options.releaseResult,
        executeQuery: async (query, signal, onProgress, onResult, onTiming) => {
            signal?.throwIfAborted();
            onProgress?.('Executing query');
            const [queryId, execution] = execute(connectionId, {
                query,
                metadata: { ...SHELL_QUERY_METADATA },
                abortSignal: signal,
                analyzeResults: true,
                onTiming: elapsedMs => reportShellTiming(onTiming, elapsedMs),
            });
            let table;
            try {
                table = await execution;
            } finally {
                // A statement of many may have run, also when it failed
                await options.afterStatement?.(query);
            }
            // The result is analyzed now, it is reported also when the statement was cancelled meanwhile: the shell
            // releases it then
            if (table != null && table.numCols > 0) onResult?.(queryId, table.numRows);
            signal?.throwIfAborted();
        },
    };
}
