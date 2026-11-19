import * as React from 'react';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { workbookExecutionIsBusy } from '@akohn/dashql/platform/workbook/workbook_execution';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';

import { useDispatch, useOptionalRuntime, useQuery, useScript, useView } from '../hooks.js';

// The model of a script of a workbook (docs/agents/writing_components.md). A component that shows a script reads the
// model and calls its operations; the kinds, targets, actions, commands and handles of the runtime stay in this module.
// An operation that changes the state resolves once the store shows the change, the component renders with a new model
// right after: a model is the state of one render, it doesn't change after an await.
// Components take a model, so a test hands them a plain object (`fakeScriptModel` of `testing/fake_models.ts`) and
// another host may implement the interface over a state of its own.

/// A script of a workbook as a component shows it, and what the component can do with it
export interface ScriptModel {
    /// The workbook of the script
    readonly workbookId: string;
    /// The script: its text session, its staged diff, its annotations, its cached result
    readonly script: ScriptData;
    /// The latest query of the script, null before its first run
    readonly query: QueryExecutionState | null;
    /// Does a run of the workbook plan, run or stop, or hold the workbook? A script then starts no run of its own.
    readonly runActive: boolean;

    /// Run the script with the scripts it references, a refresh reads no cached results. Resolves once the run ended,
    /// a failure shows on the script.
    run(options?: { refresh?: boolean }): Promise<void>;
    /// Cancel what runs for the script: the run of the workbook while one is busy, the latest query otherwise
    cancel(): Promise<void>;
    /// Replace the text of the script. The rewrite is staged as a diff to accept or reject unless the script is blank.
    setText(text: string): Promise<void>;
    /// Keep the text of a staged rewrite
    acceptDiff(): Promise<void>;
    /// Restore the text before a staged rewrite
    rejectDiff(): Promise<void>;
    /// Stage a Vega-Lite spec for the `@vis vegalite` tag of the script, as a diff to accept or reject
    setVisSpec(spec: string): Promise<void>;
}

/// The model of a script of a workbook, null while the script is unknown. It renders again when the script, its latest
/// query or the run of its workbook changes.
export function useScriptModel(workbookId: string, scriptKey: number | null | undefined): ScriptModel | null {
    const runtime = useOptionalRuntime();
    const script = useScript(scriptKey);
    const query = useQuery(script?.latestQueryId ?? null);
    const run = useView('run', workbookId);
    const dispatch = useDispatch({ workbook: workbookId });
    const runActive = workbookExecutionIsBusy(run?.state) || run?.held != null;
    return React.useMemo(() => {
        if (script == null) return null;
        const key = script.scriptKey;
        return {
            workbookId,
            script,
            query,
            runActive,
            run: async options => {
                if (runtime == null) return;
                try {
                    await runtime.runScript(workbookId, key, { refresh: options?.refresh });
                } catch (error) {
                    runtime.logger.warn('Workbook script run failed', { workbookId, scriptKey: key.toString(), error: stringifyError(error) }, 'workbook_execution');
                }
            },
            cancel: async () => await runtime?.cancelScript(workbookId, key),
            setText: text => dispatch({ kind: 'setScriptText', value: { scriptKey: key, text, withDiff: true } }).settled,
            acceptDiff: () => dispatch({ kind: 'acceptPendingDiff', value: { scriptKey: key } }).settled,
            rejectDiff: () => dispatch({ kind: 'rejectPendingDiff', value: { scriptKey: key } }).settled,
            setVisSpec: spec => dispatch({ kind: 'setScriptVisSpec', value: { scriptKey: key, spec } }).settled,
        };
    }, [runtime, workbookId, script, query, runActive, dispatch]);
}
