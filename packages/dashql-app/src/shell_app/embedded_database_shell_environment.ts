import type { QueryExecutor } from '@ankoh/dashql/platform/connections/query_execution_args';
import { DashQLShellEnvironment } from '../shell/api.js';
import { reportShellTiming, SHELL_QUERY_METADATA } from '../shell/shell_result.js';

interface EmbeddedDatabaseShellEnvironmentOptions {
    /// Called after a statement ran or failed, before its result shows and the prompt returns, e.g. to wait for the
    /// catalog of the connection
    afterStatement?: (query: string) => Promise<void>;
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
        executeQuery: async (query, signal, onProgress, onResult, onTiming) => {
            signal?.throwIfAborted();
            onProgress?.('Executing query');
            const [queryId, execution] = execute(connectionId, {
                query,
                metadata: { ...SHELL_QUERY_METADATA },
                abortSignal: signal,
                analyzeResults: true,
                throwOnError: true,
                onTiming: (label, elapsedMs) => reportShellTiming(onTiming, label, elapsedMs),
            });
            let table;
            try {
                table = await execution;
            } finally {
                // A statement of many may have run, also when it failed
                await options.afterStatement?.(query);
            }
            signal?.throwIfAborted();
            if (table == null || table.numCols === 0) return;
            onResult?.(queryId, table.numRows);
        },
    };
}
