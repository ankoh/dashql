import * as buffers from './buffers.js';
import { DashQL, FlatBufferPtr } from './api.js';
import type { FlatBuffer } from '@ankoh/dashql-wasm/dashql_core.js';

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
} from '@ankoh/dashql-wasm/dashql_core.js';

/// The runs of the workbooks of the runtime, declared by the module (`packages/dashql-core-wasm/src/runtime/runs/view.rs`)
export type {
    RunListener,
    RunOutcome,
    RunScriptOptions,
    RunWorkbookOptions,
    WorkbookRunFailure,
    WorkbookRunFailureKind,
    WorkbookRunKind,
    WorkbookRunPhase,
    WorkbookRunState,
    WorkbookRunView,
    WorkbookScriptRunEvent,
} from '@ankoh/dashql-wasm/dashql_core.js';

const SCRIPT_DIFF_TYPE = Symbol('WORKBOOK_SCRIPT_DIFF_TYPE');

/// The key of an editor update as `WorkbookScriptView.editorUpdateKey` names it
export function editorUpdateKey(update: buffers.editor.EditorUpdateT): string {
    return `${update.textVersion}:${update.stateRevision}:${update.catalogRevision}:${update.status}:${update.analysisAvailable}`;
}

/// The staged diff of a script view as the sessions return their diffs
export function scriptDiffBuffer(api: DashQL, bytes: FlatBuffer<buffers.diff.ScriptDiff>): FlatBufferPtr<buffers.diff.ScriptDiff> {
    return new FlatBufferPtr(SCRIPT_DIFF_TYPE, api, bytes, () => new buffers.diff.ScriptDiff());
}
