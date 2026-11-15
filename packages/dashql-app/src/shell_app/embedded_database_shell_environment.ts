import * as arrow from 'apache-arrow';

import { createQueryResponseStreamMetrics } from '@ankoh/dashql-runtime/query/query_execution_state';
import type { EmbeddedConnection } from '@ankoh/dashql-runtime/platform/database/embedded_database';
import { DashQLShellEnvironment } from '../shell/api.js';
import { executeTrackedQuery, type QueryTracker } from '@ankoh/dashql-runtime/query/tracked_query_execution';
import { reportShellTiming, SHELL_QUERY_METADATA } from '../shell/shell_result.js';

interface EmbeddedDatabaseShellEnvironmentOptions {
    prepareResult?: (queryId: number, table: arrow.Table) => void | Promise<void>;
    /// Called after a statement ran or failed, before its result shows and the prompt returns
    afterStatement?: (query: string) => Promise<void>;
}

/// The queries of a shell without a history run untracked
const UNTRACKED: QueryTracker = {
    runtime: {
        handles: { register: () => 0, release: () => { } } as unknown as QueryTracker['runtime']['handles'],
        dispatch: () => ({ ok: false, changed: false, error: 'the shell has no query history', id: null }),
    },
    target: { history: 'untracked' },
};

export function createEmbeddedDatabaseShellEnvironment(
    connection: EmbeddedConnection,
    queryExecutions?: QueryTracker,
    options: EmbeddedDatabaseShellEnvironmentOptions = {},
): DashQLShellEnvironment {
    return {
        executeQuery: async (query, signal, onProgress, onResult, onTiming) => {
            const reportTiming = (label: string, elapsedMs: number) => reportShellTiming(onTiming, label, elapsedMs);
            const cancellation = new AbortController();
            const abort = () => cancellation.abort();
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
            const tracker = queryExecutions ?? UNTRACKED;
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
                            tracked.receivedAllBatches(table, metrics);
                            if (table.numCols === 0) return;
                            if (options.prepareResult != null) {
                                tracked.processingResults();
                                await options.prepareResult(tracked.queryId, table);
                                cancellation.signal.throwIfAborted();
                                tracked.processedResults();
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
