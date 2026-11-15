import * as buffers from './buffers.js';
import { DashQL, FlatBufferPtr } from './api.js';
import type * as glue from './wasm/dashql_core.js';
import type { FlatBuffer, WorkbookRunResult } from './wasm/dashql_core.js';

/// The views of the workbooks of the runtime, declared by the module (`packages/dashql-core-wasm/src/runtime/workbooks/view.rs`)
export type {
    StoredScriptView,
    WorkbookAttachmentView,
    WorkbookCloudLink,
    WorkbookConnectionCopy,
    WorkbookDataFile,
    WorkbookDerivedView,
    WorkbookExternalChanges,
    WorkbookListEntry,
    WorkbookListView,
    WorkbookPendingDiff,
    WorkbookScriptKeys,
    WorkbookScriptList,
    WorkbookScriptListEntry,
    WorkbookScriptStatistics,
    WorkbookScriptView,
    WorkbookScriptVisualization,
    WorkbookTextChange,
    WorkbookView,
} from './wasm/dashql_core.js';

export type {
    WorkbookResultKey,
    WorkbookResultKeyHost,
    WorkbookRunFailure,
    WorkbookRunFailureKind,
    WorkbookRunHost,
    WorkbookRunKind,
    WorkbookRunOptions,
    WorkbookRunPhase,
    WorkbookRunResult,
    WorkbookRunState,
    WorkbookRunStatementEnd,
    WorkbookScriptRunEvent,
} from './wasm/dashql_core.js';

const SCRIPT_DIFF_TYPE = Symbol('WORKBOOK_SCRIPT_DIFF_TYPE');

/// How a run ended, with what the host failed with
export type WorkbookRunOutcome = WorkbookRunResult & { error: unknown };

/// A run of a workbook of the runtime (`Runtime.startWorkbookRun`)
export class DashQLWorkbookRun {
    private readonly native: glue.WorkbookRun;
    /// Settles once the run ended
    public readonly outcome: Promise<WorkbookRunOutcome>;

    public constructor(native: glue.WorkbookRun) {
        this.native = native;
        this.outcome = (native.result() as Promise<{ outcome: WorkbookRunResult; error: unknown }>)
            .then(result => ({ ...result.outcome, error: result.error }))
            .finally(() => native.free());
    }

    /// Stop the run, the running statements are cancelled
    public cancel(): void {
        try {
            this.native.cancel();
        } catch {
            // The run ended and was freed
        }
    }
}

/// The key of an editor update as `WorkbookScriptView.editorUpdateKey` names it
export function editorUpdateKey(update: buffers.editor.EditorUpdateT): string {
    return `${update.textVersion}:${update.stateRevision}:${update.catalogRevision}:${update.status}:${update.analysisAvailable}`;
}

/// The staged diff of a script view as the sessions return their diffs
export function scriptDiffBuffer(api: DashQL, bytes: FlatBuffer<buffers.diff.ScriptDiff>): FlatBufferPtr<buffers.diff.ScriptDiff> {
    return new FlatBufferPtr(SCRIPT_DIFF_TYPE, api, bytes, () => new buffers.diff.ScriptDiff());
}
