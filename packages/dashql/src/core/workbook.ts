import * as buffers from './buffers.js';
import { DashQL, FlatBufferPtr } from './api.js';
import type { FlatBuffer } from '@akohn/dashql-wasm/dashql_core.js';

/// The views of the workbooks of the runtime, declared by the module (`packages/dashql-core-bindings/src/runtime/workbooks/view.rs`)
export type {
    EditorEventOutcome,
    WorkbookAttachmentView,
    WorkbookCloudLink,
    WorkbookDataFile,
    WorkbookDerivedView,
    WorkbookExternalChanges,
    WorkbookListEntry,
    WorkbookListView,
    WorkbookPendingDiff,
    WorkbookScriptKeys,
    WorkbookScriptStoredResult,
    WorkbookScriptStatistics,
    WorkbookScriptView,
    WorkbookScriptVisualization,
    WorkbookTextChange,
    WorkbookView,
} from '@akohn/dashql-wasm/dashql_core.js';

/// The runs of the workbooks of the runtime, declared by the module (`packages/dashql-core-bindings/src/runtime/runs/view.rs`)
export type {
    ReportedNotRun,
    ReportedScript,
    ReportedScriptOutcome,
    RunListener,
    RunOutcome,
    RunReportEnd,
    RunReportInput,
    RunScriptOptions,
    RunScriptSelection,
    RunWorkbookOptions,
    WorkbookRunFailure,
    WorkbookRunFailureKind,
    WorkbookRunKind,
    WorkbookRunPhase,
    WorkbookRunState,
    WorkbookRunStep,
    WorkbookRunView,
    WorkbookScriptRunEvent,
} from '@akohn/dashql-wasm/dashql_core.js';

const SCRIPT_DIFF_TYPE = Symbol('WORKBOOK_SCRIPT_DIFF_TYPE');


/// The staged diff of a script view as the sessions return their diffs
export function scriptDiffBuffer(api: DashQL, bytes: FlatBuffer<buffers.diff.ScriptDiff>): FlatBufferPtr<buffers.diff.ScriptDiff> {
    return new FlatBufferPtr(SCRIPT_DIFF_TYPE, api, bytes, () => new buffers.diff.ScriptDiff());
}
