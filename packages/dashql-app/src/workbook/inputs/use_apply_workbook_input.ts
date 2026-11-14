import * as React from 'react';

import { SET_WORKBOOK_INPUT, type WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import type { ModifyWorkbookScripts } from '../scripts/workbook_scripts_registry.js';
import { useWorkbookExecution } from '../scripts/workbook_execution_provider.js';
import { deriveWorkbookInputs, inputConsumerScripts, workbookInputLiteral, type SessionInput } from '@ankoh/dashql-sdk/workbook/inputs/workbook_inputs';

const NO_INPUTS: ReadonlySet<string> = new Set();

/// Apply the value of an input: write its `@param` tag into every script that uses it, then run the scripts that the
/// change affects. Returns the function, the literal of a value of a control, and the inputs whose run is active.
export function useApplyWorkbookInput(workbookScripts: WorkbookScripts, modifyWorkbookScripts: ModifyWorkbookScripts) {
    const execution = useWorkbookExecution(workbookScripts.workbookId);
    const [applied, setApplied] = React.useState<ReadonlySet<string>>(NO_INPUTS);
    const workbookRef = React.useRef(workbookScripts);
    workbookRef.current = workbookScripts;
    const executionRef = React.useRef(execution);
    executionRef.current = execution;

    // The inputs stay busy while the run that they started runs
    const busy = execution.busy;
    const sawBusy = React.useRef(false);
    React.useEffect(() => {
        if (busy) sawBusy.current = true;
        else if (sawBusy.current) {
            sawBusy.current = false;
            setApplied(NO_INPUTS);
        }
    }, [busy]);

    const instance = workbookScripts.instance;
    const literalOf = React.useCallback((input: SessionInput, value: string) => workbookInputLiteral(instance, input.type, value), [instance]);
    const apply = React.useCallback((name: string, literal: string) => {
        const input = deriveWorkbookInputs(workbookRef.current).find(i => i.name === name);
        if (input == null) return;
        setApplied(previous => new Set([...previous, name]));
        void (async () => {
            await modifyWorkbookScripts({ type: SET_WORKBOOK_INPUT, value: { name, literal, scriptKeys: inputConsumerScripts(input) } });
            executionRef.current.start(modifyWorkbookScripts, { inputs: [name] });
        })();
    }, [modifyWorkbookScripts]);
    return { apply, literalOf, busyInputs: busy ? applied : NO_INPUTS };
}
