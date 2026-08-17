import * as arrow from 'apache-arrow';

import {
    QUERY_RECEIVED_ALL_BATCHES,
} from '../app/notebook/connections/connection_state.js';
import {
    createQueryResponseStreamMetrics,
    QueryType,
    type QueryExecutionTracker,
} from '../app/notebook/connections/query_execution_state.js';
import type { EmbeddedConnection } from '../shared/platform/database/embedded_database.js';
import { DashQLShellEnvironment } from './api.js';
import { executeTrackedQuery } from '../app/notebook/connections/tracked_query_execution.js';

export function createEmbeddedDatabaseShellEnvironment(
    connection: EmbeddedConnection,
    queryExecutions?: QueryExecutionTracker,
): DashQLShellEnvironment {
    return {
        executeQuery: async (query, signal) => {
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
                        const queryResult = await connection.queryArrowIPC(query);
                        cancellation.signal.throwIfAborted();
                        const table = arrow.tableFromIPC(queryResult);
                        const metrics = createQueryResponseStreamMetrics();
                        metrics.totalDataBytesReceived = queryResult.byteLength;
                        metrics.totalBatchesReceived = table.batches.length;
                        metrics.totalRowsReceived = table.numRows;
                        tracked.dispatch({
                            type: QUERY_RECEIVED_ALL_BATCHES,
                            value: [tracked.queryId, table, new Map(), metrics],
                        });
                        return queryResult;
                    },
                });
            } finally {
                signal?.removeEventListener('abort', abort);
            }
        },
    };
}
