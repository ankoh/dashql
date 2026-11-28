import type * as core from '../../core/index.js';

import { LoggableException } from '../logger/logger.js';

// The runs of workbooks are a service of the runtime of the module (`packages/dashql-core-bindings/src/runtime/runs.rs` on
// `packages/dashql-core-runtime/src/workbook_run`): `Runtime.runWorkbook`, `runScript` and `stopRun`, the `run`
// slice of a workbook. These are the types that the listeners of runs read.

/// What happens to a script in a run. A script of the plan is `planned`, or `cached`, or `skipped`, or `failed` if a run
/// of the workbook can't plan it. A planned script may still be skipped if its connection can't be set up. A planned
/// script that starts is then `done`, `failed` or `cancelled`. A planned script that follows a script that failed is
/// `blocked`. A planned script that never starts, e.g. because the run stopped first, gets no further event.
export type ScriptRunEvent =
    /// It runs once the scripts that it follows in the plan are done
    | { type: 'planned'; follows: string[] }
    /// A stored result whose key fits served it instead of its connection, the query reads the stored file
    | { type: 'cached'; key: string; queryId: number }
    /// It doesn't run: its connection can't run or could not be set up, or it follows a script that doesn't run
    | { type: 'skipped'; reason: string }
    /// Its first statement started
    | { type: 'started' }
    /// Its statements are done: the key of its stored result if the key is reusable, the query of its last output, null
    /// without one
    | { type: 'done'; key: string | null; queryId: number | null }
    /// A statement of the script failed, or a run of the workbook can't plan it. The query of the statement, null for a
    /// failure of no statement. The scripts that follow it don't run, the others run on.
    | { type: 'failed'; error: unknown; queryId: number | null }
    /// It doesn't run since it follows a script that failed: the file of that script and its error
    | { type: 'blocked'; by: string; message: string }
    /// The run stopped the script while it ran
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
