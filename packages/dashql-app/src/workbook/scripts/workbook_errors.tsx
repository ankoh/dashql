import * as React from 'react';

import { useWorkbookDerived, useWorkbookScriptMap } from '@akohn/dashql-react/hooks';
import { collectScriptDiagnostics } from './script_diagnostics.js';
import { WorkbookErrorsButton, type WorkbookScriptErrors } from '../views/workbook_errors_button.js';

/// The scripts of a workbook with errors in feed order: the errors of their analyses and of their script references,
/// as the headers of their entries count them. The component renders again when a script of the workbook changes.
export function useWorkbookErrors(workbookId: string, scriptKeys: readonly number[]): WorkbookScriptErrors[] {
    const scripts = useWorkbookScriptMap(workbookId);
    const references = useWorkbookDerived(workbookId)?.references ?? null;
    return React.useMemo(() => {
        const result: WorkbookScriptErrors[] = [];
        for (const scriptKey of scriptKeys) {
            const script = scripts[scriptKey];
            if (script == null) continue;
            // The formatter is no error, it is not inspected
            const errors = collectScriptDiagnostics(script, true, undefined, null, references?.get(scriptKey) ?? null)
                .filter(diagnostic => diagnostic.severity === 'error');
            if (errors.length === 0) continue;
            result.push({ scriptKey, fileName: script.fileName, errors: errors.length, message: errors[0].message });
        }
        return result;
    }, [scripts, references, scriptKeys]);
}

interface Props {
    workbookId: string;
    /// The keys of the scripts in feed order
    scriptKeys: readonly number[];
    /// Show a script in the feed
    showScript(scriptKey: number): void;
}

/// The errors of a workbook in its bar. A component of its own: it renders again with every change of a script, the
/// page around it doesn't.
export function WorkbookErrors({ workbookId, scriptKeys, showScript }: Props): React.ReactElement | null {
    const scripts = useWorkbookErrors(workbookId, scriptKeys);
    return <WorkbookErrorsButton workbookId={workbookId} scripts={scripts} showScript={showScript} />;
}
