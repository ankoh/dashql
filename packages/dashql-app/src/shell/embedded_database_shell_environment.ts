import * as arrow from 'apache-arrow';

import {
    QUERY_RECEIVED_ALL_BATCHES,
    createQueryResponseStreamMetrics,
    QueryType,
    type QueryExecutionTracker,
} from '../query/query_execution_state.js';
import type { EmbeddedConnection } from '../platform/database/embedded_database.js';
import { DashQLShellEnvironment } from './api.js';
import { executeTrackedQuery } from '../query/tracked_query_execution.js';
import { shouldShowResultUI, type ShellOutputMode } from './shell_result.js';

const EMPTY_RESULT_IPC = arrow.tableToIPC(arrow.tableFromArrays({}), 'file');

interface EmbeddedDatabaseShellEnvironmentOptions {
    getOutputMode?: () => ShellOutputMode;
    getTerminalColumns?: () => number;
    prepareResult?: (queryId: number, table: arrow.Table) => void | Promise<void>;
}

export function createEmbeddedDatabaseShellEnvironment(
    connection: EmbeddedConnection,
    queryExecutions?: QueryExecutionTracker,
    options: EmbeddedDatabaseShellEnvironmentOptions = {},
): DashQLShellEnvironment {
    return {
        executeQuery: async (query, signal, onProgress, onResult) => {
            const cancellation = new AbortController();
            const abort = () => cancellation.abort();
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
            const tracker = queryExecutions ?? { dispatch: () => {} };
            try {
                return await executeTrackedQuery({
                    query,
                    tracker,
                    cancellation,
                    errorTarget: 'standalone_shell',
                    metadata: {
                        queryType: QueryType.USER_PROVIDED,
                        title: 'Shell Query',
                        description: null,
                        issuer: 'DashQL Shell',
                        userProvided: true,
                    },
                    execute: async tracked => {
                        onProgress?.('Executing query');
                        let queryResult = await connection.queryArrowIPC(query);
                        cancellation.signal.throwIfAborted();
                        const totalDataBytesReceived = queryResult.byteLength;
                        if (queryResult.byteLength === 0) {
                            queryResult = EMPTY_RESULT_IPC;
                        }
                        const table = arrow.tableFromIPC(queryResult);
                        const metrics = createQueryResponseStreamMetrics();
                        metrics.totalDataBytesReceived = totalDataBytesReceived;
                        metrics.totalBatchesReceived = table.batches.length;
                        metrics.totalRowsReceived = table.numRows;
                        tracked.dispatch({
                            type: QUERY_RECEIVED_ALL_BATCHES,
                            value: [tracked.queryId, table, new Map(), metrics],
                        });
                        const outputMode = options.getOutputMode?.() ?? 'auto';
                        const showUI = shouldShowResultUI(
                            outputMode,
                            table,
                            options.getTerminalColumns?.() ?? 100,
                        );
                        if (showUI && table.numCols > 0 && onResult != null) {
                            await options.prepareResult?.(tracked.queryId, table);
                            onResult(tracked.queryId, table.numRows);
                            return EMPTY_RESULT_IPC;
                        }
                        if (outputMode === 'off') return EMPTY_RESULT_IPC;
                        return queryResult;
                    },
                });
            } finally {
                signal?.removeEventListener('abort', abort);
            }
        },
    };
}
