import * as arrow from 'apache-arrow';

import {
    QUERY_PROCESSED_RESULTS,
    QUERY_PROCESSING_RESULTS,
    QUERY_RECEIVED_ALL_BATCHES,
    createQueryResponseStreamMetrics,
    type QueryExecutionTracker,
} from '../query/query_execution_state.js';
import type { EmbeddedConnection } from '../platform/database/embedded_database.js';
import { DashQLShellEnvironment } from '../shell/api.js';
import { executeTrackedQuery } from '../query/tracked_query_execution.js';
import { reportShellTiming, SHELL_QUERY_METADATA } from '../shell/shell_result.js';

interface EmbeddedDatabaseShellEnvironmentOptions {
    prepareResult?: (queryId: number, table: arrow.Table) => void | Promise<void>;
    /// Called after a statement ran or failed, before its result shows and the prompt returns
    afterStatement?: (query: string) => Promise<void>;
}

export function createEmbeddedDatabaseShellEnvironment(
    connection: EmbeddedConnection,
    queryExecutions?: QueryExecutionTracker,
    options: EmbeddedDatabaseShellEnvironmentOptions = {},
): DashQLShellEnvironment {
    return {
        executeQuery: async (query, signal, onProgress, onResult, onTiming) => {
            const reportTiming = (label: string, elapsedMs: number) => reportShellTiming(onTiming, label, elapsedMs);
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
                    metadata: { ...SHELL_QUERY_METADATA },
                    execute: async tracked => {
                        onProgress?.('Executing query');
                        const queryStartedAt = performance.now();
                        let table: arrow.Table;
                        try {
                            table = await connection.query(query, cancellation.signal);
                        } catch (error) {
                            await options.afterStatement?.(query);
                            throw error;
                        }
                        reportTiming('Results', performance.now() - queryStartedAt);
                        cancellation.signal.throwIfAborted();
                        await options.afterStatement?.(query);
                        const postprocessingStartedAt = performance.now();
                        try {
                            const metrics = createQueryResponseStreamMetrics();
                            metrics.totalDataBytesReceived = table.batches.reduce((bytes, batch) => bytes + batch.data.byteLength, 0);
                            metrics.totalBatchesReceived = table.batches.length;
                            metrics.totalRowsReceived = table.numRows;
                            tracked.dispatch({
                                type: QUERY_RECEIVED_ALL_BATCHES,
                                value: [tracked.queryId, table, new Map(), metrics],
                            });
                            if (table.numCols === 0) return;
                            if (options.prepareResult != null) {
                                tracked.dispatch({
                                    type: QUERY_PROCESSING_RESULTS,
                                    value: [tracked.queryId],
                                });
                                await options.prepareResult(tracked.queryId, table);
                                cancellation.signal.throwIfAborted();
                                tracked.dispatch({
                                    type: QUERY_PROCESSED_RESULTS,
                                    value: [tracked.queryId],
                                });
                            }
                            onResult?.(tracked.queryId, table.numRows);
                        } finally {
                            reportTiming('Postprocess', performance.now() - postprocessingStartedAt);
                        }
                    },
                });
            } finally {
                signal?.removeEventListener('abort', abort);
            }
        },
    };
}
