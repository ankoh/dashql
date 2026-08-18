import * as arrow from 'apache-arrow';

import { CancelQuery, QueryExecutor } from '../connections/query_executor.js';
import { QueryType } from '../connections/query_execution_state.js';
import type { DashQLShellEnvironment } from '../../../shell/api.js';
import {
    shouldShowResultUI,
    type ShellOutputMode,
} from '../../../shell/shell_result.js';

const EMPTY_RESULT_IPC = arrow.tableToIPC(arrow.tableFromArrays({}), 'file');

export function createNotebookShellEnvironment(
    connectionId: string,
    executeQuery: QueryExecutor,
    cancelQuery: CancelQuery,
    getOutputMode: () => ShellOutputMode = () => 'auto',
    getTerminalColumns: () => number = () => 100,
): DashQLShellEnvironment {
    return {
        async executeQuery(query, signal, onProgress, onResult) {
            const [queryId, execution] = executeQuery(connectionId, {
                query,
                analyzeResults: true,
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
            const abort = () => cancelQuery(connectionId, queryId);
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
                const outputMode = getOutputMode();
                if (shouldShowResultUI(outputMode, table, getTerminalColumns())) {
                    onResult?.(queryId, table.numRows);
                    return EMPTY_RESULT_IPC;
                }
                if (outputMode === 'off') return EMPTY_RESULT_IPC;
                return arrow.tableToIPC(table, 'file');
            } finally {
                signal?.removeEventListener('abort', abort);
            }
        },
    };
}
