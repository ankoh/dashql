import * as React from 'react';

import { isWorkbookExecutionRunning, subscribeWorkbookExecutions, type WorkbookExecutionState } from '@ankoh/dashql-runtime/workbook/scripts/workbook_execution';
import { useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { useOptionalRuntime } from '../../runtime/runtime_provider.js';
import type { ScriptRunServices } from '@ankoh/dashql-runtime/workbook/scripts/script_run';
import {
    workbookExecutionIsBusy,
    type WorkbookExecutionOptions,
} from '@ankoh/dashql-runtime/workbook/scripts/workbook_execution_service';

// The runs of workbooks are a service of the runtime (packages/dashql-runtime/src/workbook/scripts/workbook_execution_service.ts).
// The runtime follows the workbooks and the connections and stops the runs of those that are gone.

const NO_STATES = new Map<string, WorkbookExecutionState>();
const noStates = () => NO_STATES;
const subscribeNothing = () => () => { };

/// The run of a workbook. `busy` while the whole workbook runs, `runActive` while any run holds the workbook, a run of
/// the workbook or of one of its scripts: the workbook starts no other run then.
export function useWorkbookExecution(workbookId: string) {
    const runtime = useOptionalRuntime();
    const execution = runtime?.execution ?? null;
    const states = React.useSyncExternalStore(execution?.states.subscribe ?? subscribeNothing, execution?.states.get ?? noStates);
    const state = states.get(workbookId) ?? null;
    const held = React.useSyncExternalStore(subscribeWorkbookExecutions, () => isWorkbookExecutionRunning(workbookId));
    // A run reads the cached results and the results of the queries with the compute database, a run starts once it
    // is set up
    const ready = useComputeDatabase() != null;
    return React.useMemo(() => {
        const busy = workbookExecutionIsBusy(state);
        return {
            state,
            busy,
            ready,
            runActive: busy || held,
            start: (options?: WorkbookExecutionOptions) => execution?.start(workbookId, options),
            stop: () => execution?.stop(workbookId),
        };
    }, [state, held, execution, workbookId, ready]);
}

/// The services of the runs of single scripts of the runtime, null without a runtime
export function useScriptRunServices(): ScriptRunServices | null {
    return useOptionalRuntime()?.execution.scriptRunServices ?? null;
}
