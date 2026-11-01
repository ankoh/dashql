import * as React from 'react';

import { SET_SESSION_INPUT, type SessionScripts } from '../scripts/session_scripts.js';
import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { useSessionExecution } from '../scripts/session_execution_provider.js';
import { deriveSessionInputs, inputConsumerScripts, sessionInputLiteral, type SessionInput } from './session_inputs.js';

const NO_INPUTS: ReadonlySet<string> = new Set();

/// Apply the value of an input: write its `@param` tag into every script that uses it, then run the scripts that the
/// change affects. Returns the function, the literal of a value of a control, and the inputs whose run is active.
export function useApplySessionInput(sessionScripts: SessionScripts, modifySessionScripts: ModifySessionScripts) {
    const execution = useSessionExecution(sessionScripts.sessionId);
    const [applied, setApplied] = React.useState<ReadonlySet<string>>(NO_INPUTS);
    const sessionRef = React.useRef(sessionScripts);
    sessionRef.current = sessionScripts;
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

    const instance = sessionScripts.instance;
    const literalOf = React.useCallback((input: SessionInput, value: string) => sessionInputLiteral(instance, input.type, value), [instance]);
    const apply = React.useCallback((name: string, literal: string) => {
        const input = deriveSessionInputs(sessionRef.current).find(i => i.name === name);
        if (input == null) return;
        setApplied(previous => new Set([...previous, name]));
        void (async () => {
            await modifySessionScripts({ type: SET_SESSION_INPUT, value: { name, literal, scriptKeys: inputConsumerScripts(input) } });
            executionRef.current.start(modifySessionScripts, { inputs: [name] });
        })();
    }, [modifySessionScripts]);
    return { apply, literalOf, busyInputs: busy ? applied : NO_INPUTS };
}
