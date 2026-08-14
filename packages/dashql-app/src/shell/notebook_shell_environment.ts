import * as arrow from 'apache-arrow';

import { CancelQuery, QueryExecutor } from '../connection/query_executor.js';
import { QueryType } from '../connection/query_execution_state.js';
import { DashQLShellEnvironment } from './api.js';

export function createNotebookShellEnvironment(
    notebookId: string,
    executeQuery: QueryExecutor,
    cancelQuery: CancelQuery,
): DashQLShellEnvironment {
    return {
        async executeQuery(query, signal, onProgress) {
            const [queryId, execution] = executeQuery(notebookId, {
                query,
                analyzeResults: false,
                cacheable: false,
                throwOnError: true,
                onLog: onProgress,
                metadata: {
                    queryType: QueryType.USER_PROVIDED,
                    title: 'Shell Query',
                    description: null,
                    issuer: 'DashQL Shell',
                    userProvided: true,
                },
            });
            const abort = () => cancelQuery(notebookId, queryId);
            if (signal?.aborted) {
                abort();
            } else {
                signal?.addEventListener('abort', abort, { once: true });
            }
            try {
                const table = await execution;
                if (table == null) {
                    if (signal?.aborted) throw new DOMException('Query was cancelled', 'AbortError');
                    throw new Error('Query failed without an error');
                }
                return arrow.tableToIPC(table, 'file');
            } finally {
                signal?.removeEventListener('abort', abort);
            }
        },
    };
}
