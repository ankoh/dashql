import * as arrow from 'apache-arrow';

import {
    EXECUTE_QUERY,
    QUERY_CANCELLED,
    QUERY_FAILED,
    QUERY_RECEIVED_ALL_BATCHES,
    QUERY_SENDING,
    QUERY_SUCCEEDED,
} from '../app/notebook/connections/connection_state.js';
import {
    createQueryExecutionState,
    createQueryResponseStreamMetrics,
    QueryType,
    type QueryExecutionTracker,
} from '../app/notebook/connections/query_execution_state.js';
import { DuckDBConnection } from '../shared/platform/duckdb/duckdb_api.js';
import { LoggableException, stringifyError } from '../shared/platform/logger/logger.js';
import { createTrace } from '../shared/platform/logger/trace_context.js';
import { DashQLShellEnvironment } from './api.js';

let NEXT_QUERY_ID = 1;

export function createDuckDBShellEnvironment(
    connection: DuckDBConnection,
    queryExecutions?: QueryExecutionTracker,
): DashQLShellEnvironment {
    return {
        executeQuery: async (query, signal) => {
            const queryId = NEXT_QUERY_ID++;
            const cancellation = new AbortController();
            const abort = () => cancellation.abort();
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
            const initialState = createQueryExecutionState(
                queryId,
                createTrace().traceId,
                query,
                {
                    queryType: QueryType.USER_PROVIDED,
                    title: 'Shell Query',
                    description: null,
                    issuer: 'DashQL Shell',
                    userProvided: true,
                },
                cancellation,
            );
            queryExecutions?.dispatch({ type: EXECUTE_QUERY, value: [queryId, initialState] });
            try {
                cancellation.signal.throwIfAborted();
                queryExecutions?.dispatch({ type: QUERY_SENDING, value: [queryId] });
                const queryResult = await connection.queryArrowIPC(query);
                cancellation.signal.throwIfAborted();
                const table = arrow.tableFromIPC(queryResult);
                const metrics = createQueryResponseStreamMetrics();
                metrics.totalDataBytesReceived = queryResult.byteLength;
                metrics.totalBatchesReceived = table.batches.length;
                metrics.totalRowsReceived = table.numRows;
                queryExecutions?.dispatch({
                    type: QUERY_RECEIVED_ALL_BATCHES,
                    value: [queryId, table, new Map(), metrics],
                });
                queryExecutions?.dispatch({ type: QUERY_SUCCEEDED, value: [queryId] });
                return queryResult;
            } catch (error) {
                const message = stringifyError(error);
                const trackedError = error instanceof LoggableException
                    ? error
                    : new LoggableException(message, {}, 'standalone_shell');
                if (cancellation.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
                    queryExecutions?.dispatch({ type: QUERY_CANCELLED, value: [queryId, trackedError, null] });
                } else {
                    queryExecutions?.dispatch({ type: QUERY_FAILED, value: [queryId, trackedError, null] });
                }
                throw error;
            } finally {
                signal?.removeEventListener('abort', abort);
            }
        },
    };
}
