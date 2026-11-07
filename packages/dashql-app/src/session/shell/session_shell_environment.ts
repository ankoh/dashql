import * as arrow from 'apache-arrow';
import * as dashql from '@ankoh/dashql-core';

import type { ClientFunctionCallDescription } from '../../connections/clfn/clfn_spec.js';
import { CancelQuery, QueryExecutor } from '../../connections/query_executor.js';
import type { DashQLShellEnvironment } from '../../shell/api.js';
import {
    EMPTY_RESULT_IPC,
    reportShellTiming,
    SHELL_QUERY_METADATA,
    shouldShowResultUI,
    type ShellOutputMode,
} from '../../shell/shell_result.js';

/// The client function call of a shell statement, null if the statement goes to the backend. A spec shadows its
/// namespace and no backend judges a call in it, so a call that can't run fails here, like it fails a session plan.
export function resolveClientFunctionCall(catalog: dashql.DashQLCatalog, query: string): ClientFunctionCallDescription | null {
    const script = catalog.ptr.api.createScript(catalog);
    try {
        script.replaceText(query);
        script.analyze();
        if (!script.startsClientFunctionCall()) return null;
        const parsed = script.getParsed().read();
        const syntaxError = parsed.scannerErrorsLength() > 0 ? parsed.scannerErrors(0) : parsed.parserErrorsLength() > 0 ? parsed.parserErrors(0) : null;
        if (syntaxError != null) throw new Error(syntaxError.message() ?? 'Invalid client function call');
        if (parsed.statementsLength() > 1) throw new Error('A client function call runs as a statement of its own');
        const analyzed = script.getAnalyzed().read();
        for (let i = 0; i < analyzed.errorsLength(); ++i) {
            const error = analyzed.errors(i)!;
            if (error.severity() === dashql.buffers.analyzer.AnalyzerErrorSeverity.ERROR) throw new Error(error.message() ?? 'Invalid client function call');
        }
        const description = JSON.parse(analyzed.clientFunctionCalls(0)!.description()!) as ClientFunctionCallDescription;
        // The inputs of a session belong to its scripts, the shell has no values for them
        const binding = description.bindings?.[0];
        if (binding != null) throw new Error(`input :${binding.param} has no value`);
        return description;
    } finally {
        script.destroy();
    }
}

export function createSessionShellEnvironment(
    sessionId: string,
    connectionId: string,
    executeQuery: QueryExecutor,
    cancelQuery: CancelQuery,
    getOutputMode: () => ShellOutputMode = () => 'auto',
    getTerminalColumns: () => number = () => 100,
    releaseResult: (queryId: number) => void = () => { },
    resolveCall: (query: string) => ClientFunctionCallDescription | null = () => null,
): DashQLShellEnvironment {
    return {
        async executeQuery(query, signal, onProgress, onResult, onTiming) {
            const reportTiming = (label: string, elapsedMs: number) => reportShellTiming(onTiming, label, elapsedMs);
            const clientFunctionCall = resolveCall(query) ?? undefined;
            const [queryId, execution] = executeQuery(connectionId, {
                query,
                clientFunctionCall,
                analyzeResults: true,
                cacheable: false,
                throwOnError: true,
                onLog: onProgress,
                onTiming: reportTiming,
                metadata: { ...SHELL_QUERY_METADATA, sessionId },
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
                const outputStartedAt = performance.now();
                try {
                    const outputMode = getOutputMode();
                    if (table.numCols > 0 && shouldShowResultUI(outputMode, table, getTerminalColumns())) {
                        onResult?.(queryId, table.numRows);
                        return EMPTY_RESULT_IPC;
                    }
                    // The terminal shows the result as text, its computation is not needed
                    releaseResult(queryId);
                    if (outputMode === 'off') return EMPTY_RESULT_IPC;
                    return arrow.tableToIPC(table, 'file');
                } finally {
                    reportTiming('Postprocess', performance.now() - outputStartedAt);
                }
            } finally {
                signal?.removeEventListener('abort', abort);
            }
        },
    };
}
