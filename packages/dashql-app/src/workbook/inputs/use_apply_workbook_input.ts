import * as React from 'react';

import type { ModifyWorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { inputConsumerScripts, workbookInputLiteral, type SessionInput } from '@akohn/dashql/platform/workbook/workbook_inputs';
import { useOptionalRuntime, useWorkbookDerived, useWorkbookExecution } from '@akohn/dashql-react/hooks';

const NO_INPUTS: ReadonlySet<string> = new Set();

/// Apply the value of an input: write its `@param` tag into every script that uses it, then run the scripts that the
/// change affects. Returns the function, the literal of a value of a control, and the inputs whose run is active.
export function useApplyWorkbookInput(workbookId: string, modifyWorkbookScripts: ModifyWorkbookScripts) {
    const execution = useWorkbookExecution(workbookId);
    const [applied, setApplied] = React.useState<ReadonlySet<string>>(NO_INPUTS);
    const derived = useWorkbookDerived(workbookId);
    const inputsRef = React.useRef(derived?.inputs ?? null);
    inputsRef.current = derived?.inputs ?? null;
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

    const runtime = useOptionalRuntime();
    const literalOf = React.useCallback((input: SessionInput, value: string) => {
        const instance = runtime?.core;
        if (instance == null) return { error: 'The runtime has no core' };
        return workbookInputLiteral(instance, input.type, value);
    }, [runtime]);
    const apply = React.useCallback((name: string, literal: string) => {
        const input = inputsRef.current?.find(i => i.name === name);
        if (input == null) return;
        setApplied(previous => new Set([...previous, name]));
        modifyWorkbookScripts({ kind: 'setWorkbookInput', value: { name, literal, scriptKeys: inputConsumerScripts(input) } });
        // The run reads the scripts with their new tags
        runtime?.flush();
        executionRef.current.start({ inputs: [name] });
    }, [modifyWorkbookScripts, runtime]);
    return { apply, literalOf, busyInputs: busy ? applied : NO_INPUTS };
}
