import * as React from 'react';

import type { ModifyWorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { inputConsumerScripts, workbookInputLiteral, type WorkbookInput } from '@akohn/dashql/platform/workbook/workbook_inputs';
import { useOptionalRuntime, useView, useWorkbookDerived, useWorkbookExecution } from '@akohn/dashql-react/hooks';

const NO_INPUTS: ReadonlySet<string> = new Set();

/// Apply the value of an input: write its `@param` tag into every script that uses it, then run the scripts that the
/// change affects. Returns the function, the literal of a value of a control, and the inputs whose run is active: the
/// runtime holds them while the run that applies their change runs or waits, so every view of the workbook agrees.
export function useApplyWorkbookInput(workbookId: string, modifyWorkbookScripts: ModifyWorkbookScripts) {
    const execution = useWorkbookExecution(workbookId);
    const derived = useWorkbookDerived(workbookId);
    const inputsRef = React.useRef(derived?.inputs ?? null);
    inputsRef.current = derived?.inputs ?? null;
    const executionRef = React.useRef(execution);
    executionRef.current = execution;

    const busy = useView('run', workbookId)?.busyInputs;
    const busyInputs = React.useMemo(() => busy == null || busy.length === 0 ? NO_INPUTS : new Set(busy), [busy]);

    const runtime = useOptionalRuntime();
    const literalOf = React.useCallback((input: WorkbookInput, value: string) => {
        const instance = runtime?.core;
        if (instance == null) return { error: 'The runtime has no core' };
        return workbookInputLiteral(instance, input.type, value);
    }, [runtime]);
    const apply = React.useCallback((name: string, literal: string) => {
        const input = inputsRef.current?.find(i => i.name === name);
        if (input == null) return;
        modifyWorkbookScripts({ kind: 'setWorkbookInput', value: { name, literal, scriptKeys: inputConsumerScripts(input) } });
        // The run reads the scripts with their new tags
        runtime?.flush();
        executionRef.current.start({ inputs: [name] });
    }, [modifyWorkbookScripts, runtime]);
    return { apply, literalOf, busyInputs };
}
