import * as React from 'react';

import { workbookExecutionIsBusy } from '@ankoh/dashql-runtime/workbook/scripts/workbook_execution';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';
import { useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useOptionalCoreRuntime, useView } from '../../runtime/runtime_hooks.js';

// The runs of workbooks are a service of the runtime of the module, the `run` slice of a workbook shows the run that
// holds it and the state of its last run (packages/dashql-core-wasm/src/runtime/runs.rs).

/// The options of a run of a workbook
export interface WorkbookExecutionOptions {
    /// Run the scripts that a change of these inputs affects. A run that holds the workbook stops, the run starts
    /// once the workbook is free, with the inputs of every change since.
    inputs?: readonly string[];
}

/// The run of a workbook. `busy` while the whole workbook runs, `runActive` while any run holds the workbook, a run of
/// the workbook or of one of its scripts: the workbook starts no other run then.
export function useWorkbookExecution(workbookId: string) {
    const runtime = useOptionalCoreRuntime();
    const run = useView('run', workbookId);
    // A run reads the cached results and the results of the queries with the compute database, a run starts once it
    // is set up
    const ready = useComputeDatabase() != null;
    const state = run?.state ?? null;
    const held = run?.held != null;
    return React.useMemo(() => {
        const busy = workbookExecutionIsBusy(state);
        return {
            state,
            busy,
            ready,
            runActive: busy || held,
            start: (options?: WorkbookExecutionOptions) => {
                void runtime?.runWorkbook(workbookId, { inputs: options?.inputs == null ? undefined : [...options.inputs] });
            },
            stop: () => runtime?.stopRun(workbookId),
        };
    }, [state, held, runtime, workbookId, ready]);
}

/// Run a script of a workbook with the scripts it references, a refresh reads no cached results. Resolves once the run
/// ended, a failure shows on the script.
export type ScriptRun = (workbookId: string, scriptKey: number, options?: { refresh?: boolean }) => Promise<void>;

/// The runs of single scripts of the runtime, null without a runtime
export function useScriptRun(): ScriptRun | null {
    const runtime = useOptionalCoreRuntime();
    const logger = useLogger();
    return React.useMemo(() => runtime == null ? null : async (workbookId, scriptKey, options = {}) => {
        try {
            await runtime.runScript(workbookId, scriptKey, { refresh: options.refresh });
        } catch (error) {
            logger.warn('Workbook script run failed', { workbookId, scriptKey: scriptKey.toString(), error: stringifyError(error) }, 'workbook_execution');
        }
    }, [runtime, logger]);
}

/// The reusable result key of a script, the key that a run of the script reads and writes; null without one
export type ScriptResultKey = (workbookId: string, scriptKey: number) => Promise<string | null>;

/// The result keys of single scripts of the runtime, null without a runtime
export function useScriptResultKey(): ScriptResultKey | null {
    const runtime = useOptionalCoreRuntime();
    return React.useMemo(() => runtime == null ? null : async (workbookId, scriptKey) => {
        const index = runtime.workbook(workbookId)?.scriptKeys.indexOf(scriptKey) ?? -1;
        if (index < 0) return null;
        const keys = await runtime.resultKeys(workbookId, [index]);
        return keys[index] ?? null;
    }, [runtime]);
}
