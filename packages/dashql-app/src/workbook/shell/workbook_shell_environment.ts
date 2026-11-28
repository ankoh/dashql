import * as dashql from '@akohn/dashql';

import type { ClientFunctionCallDescription } from '@akohn/dashql/platform/connections/clfn_spec';

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
