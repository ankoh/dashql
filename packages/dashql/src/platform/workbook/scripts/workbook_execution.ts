import type * as core from '../../../core/index.js';

import { LoggableException } from '../../platform/logger/logger.js';

// The runs of workbooks are a service of the runtime of the module (`packages/dashql-core-wasm/src/runtime/runs.rs` on
// `packages/dashql-core-runtime/src/workbook_run`): `Runtime.runWorkbook`, `runScript` and `stopRun`, the `run`
// slice of a workbook. These are the types that the listeners of runs read.

/// The state of a run as the runtime reports it
export type WorkbookExecutionState = core.WorkbookRunState;

/// Is the run of a workbook planning, running or stopping?
export function workbookExecutionIsBusy(state: WorkbookExecutionState | null | undefined): boolean {
    return state?.phase === 'planning' || state?.phase === 'running' || state?.phase === 'stopping';
}

/// What happens to a script in a run. A script of the plan is `planned`, or `cached`, or `skipped`. A planned script
/// may still be skipped if its connection can't be set up. A planned script that starts is then `done`, `failed` or
/// `cancelled`. A planned script that never starts, e.g. because the run stopped first, gets no further event.
export type ScriptRunEvent =
    /// It runs once the scripts that it follows in the plan are done
    | { type: 'planned'; follows: string[] }
    /// The cache served its result instead of its connection, the query reads the cached file
    | { type: 'cached'; key: string; queryId: number }
    /// It doesn't run: its connection can't run or could not be set up, or it follows a script that doesn't run
    | { type: 'skipped'; reason: string }
    /// Its first statement started
    | { type: 'started' }
    /// Its statements are done: the key of its result in the query result cache if the key is reusable, the query of
    /// its last output, null without one
    | { type: 'done'; key: string | null; queryId: number | null }
    /// A statement of the script failed, the run stops. The query of the statement, null for a failure of no statement.
    | { type: 'failed'; error: unknown; queryId: number | null }
    /// The run stopped the script while it ran, e.g. after another script failed
    | { type: 'cancelled' };

/// A script that can't be planned, e.g. one that references an unknown script
export class ScriptPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ScriptPlanError';
    }
}

/// The error of a failure of a run or of a script: what the platform failed with, a plan error, the cancellation, or
/// the error of a failed statement with its details
export function workbookRunError(failure: core.WorkbookRunFailure, value: unknown): unknown {
    if (failure.hostValue) return value;
    switch (failure.kind) {
        case 'plan':
            return new ScriptPlanError(failure.message);
        case 'cancelled':
            return new DOMException(failure.message, 'AbortError');
        default:
            return failure.target != null ? new LoggableException(failure.message, failure.details, failure.target) : new Error(failure.message);
    }
}

/// The event of a script of the runtime as the listeners of runs read it
export function scriptRunEvent(event: core.WorkbookScriptRunEvent, value: unknown): ScriptRunEvent {
    if (event.type === 'failed') return { type: 'failed', error: workbookRunError(event.failure, value), queryId: event.failure.queryId };
    return event;
}
