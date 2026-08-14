import * as arrow from 'apache-arrow';

import { CancelQuery, QueryExecutor } from '../connections/query_executor.js';
import { QueryType } from '../connections/query_execution_state.js';
import type { DashQLShellCommand, DashQLShellEnvironment } from '../../../shell/api.js';

const EMPTY_RESULT_IPC = arrow.tableToIPC(arrow.tableFromArrays({}), 'file');
export const NOTEBOOK_SHELL_AUTO_OVERLAY_ROW_LIMIT = 100;
const TABLE_FRAME_WIDTH_PER_COLUMN = 3;
export type NotebookShellResultMode = 'auto' | 'overlay' | 'term';

function textWidth(value: unknown): number {
    if (value == null) return 0;
    return String(value).split(/\r?\n/, -1).reduce((width, line) => Math.max(width, Array.from(line).length), 0);
}

export function estimateTerminalTableWidth(table: arrow.Table): number {
    if (table.numCols === 0) return 0;
    let width = TABLE_FRAME_WIDTH_PER_COLUMN * table.numCols + 1;
    for (let columnIndex = 0; columnIndex < table.numCols; ++columnIndex) {
        const column = table.getChildAt(columnIndex);
        let columnWidth = textWidth(table.schema.fields[columnIndex]?.name ?? '');
        if (column != null) {
            for (let rowIndex = 0; rowIndex < table.numRows; ++rowIndex) {
                columnWidth = Math.max(columnWidth, textWidth(column.get(rowIndex)));
            }
        }
        width += Math.max(columnWidth, 1);
    }
    return width;
}

export function createNotebookShellResultCommand(
    getMode: () => NotebookShellResultMode,
    setMode: (mode: NotebookShellResultMode) => void,
): DashQLShellCommand {
    return [
        'result',
        'Set result display: auto, overlay, or term',
        args => {
            if (args.length > 1 || (args.length === 1 && !['auto', 'overlay', 'term'].includes(args[0]))) {
                throw new Error('usage: .result [auto|overlay|term]');
            }
            if (args.length === 1) setMode(args[0] as NotebookShellResultMode);
            const mode = getMode();
            return mode === 'auto'
                ? `Result display: auto (overlay when results exceed ${NOTEBOOK_SHELL_AUTO_OVERLAY_ROW_LIMIT} rows or terminal width)`
                : `Result display: ${mode}`;
        },
    ];
}

export function createNotebookShellEnvironment(
    notebookId: string,
    executeQuery: QueryExecutor,
    cancelQuery: CancelQuery,
    getResultMode: () => NotebookShellResultMode = () => 'auto',
    getTerminalColumns: () => number = () => 100,
): DashQLShellEnvironment {
    return {
        async executeQuery(query, signal, onProgress, onResult) {
            const [queryId, execution] = executeQuery(notebookId, {
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
                const mode = getResultMode();
                const showOverlay = mode === 'overlay'
                    || (mode === 'auto' && (
                        table.numRows > NOTEBOOK_SHELL_AUTO_OVERLAY_ROW_LIMIT
                        || estimateTerminalTableWidth(table) > Math.max(getTerminalColumns(), 1)
                    ));
                if (showOverlay) {
                    onResult?.(queryId, table.numRows);
                    return EMPTY_RESULT_IPC;
                }
                return arrow.tableToIPC(table, 'file');
            } finally {
                signal?.removeEventListener('abort', abort);
            }
        },
    };
}
