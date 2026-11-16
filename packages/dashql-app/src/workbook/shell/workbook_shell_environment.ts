import * as dashql from '@ankoh/dashql';

import type { ClientFunctionCallDescription } from '@ankoh/dashql/platform/connections/clfn_spec';
import type { CancelQuery, QueryExecutor } from '@ankoh/dashql/platform/connections/query_execution_args';
import type { DashQLShellEnvironment } from '../../shell/api.js';
import { reportShellTiming, SHELL_QUERY_METADATA } from '../../shell/shell_result.js';

/// The client function call of a shell statement, null if the statement goes to the backend. A spec shadows its
/// namespace and no backend judges a call in it, so a call that can't run fails here, like it fails a workbook plan.
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
        // The inputs of a workbook belong to its scripts, the shell has no values for them
        const binding = description.bindings?.[0];
        if (binding != null) throw new Error(`input :${binding.param} has no value`);
        return description;
    } finally {
        script.destroy();
    }
}

export function createWorkbookShellEnvironment(
    workbookId: string,
    connectionId: string,
    executeQuery: QueryExecutor,
    cancelQuery: CancelQuery,
    releaseResult: (queryId: number) => void = () => { },
    resolveCall: (query: string) => ClientFunctionCallDescription | null = () => null,
    previewResult?: (queryId: number, limit: number) => Promise<Uint8Array>,
): DashQLShellEnvironment {
    return {
        previewResult,
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
                metadata: { ...SHELL_QUERY_METADATA, workbookId },
            });
            const abort = () => cancelQuery(queryId);
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
                if (table.numCols > 0) {
                    onResult?.(queryId, table.numRows);
                } else {
                    // A statement without columns has nothing to show, its computation is not needed
                    releaseResult(queryId);
                }
            } finally {
                signal?.removeEventListener('abort', abort);
            }
        },
    };
}
