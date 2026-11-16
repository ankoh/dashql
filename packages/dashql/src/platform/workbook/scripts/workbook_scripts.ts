import * as core from '../../../core/index.js';
import type * as Immutable from 'immutable';

import type { DashQLPendingDiff } from './script_editor_state.js';
import type { WorkbookCloudLink } from '../../storage/storage_backend.js';
import type { ScriptAnnotations, ScriptRef, WorkbookMetadata } from './script_types.js';
import type { ScriptReferenceReport, ScriptTextChange } from './script_reference_check.js';
import type { SessionInput } from '../inputs/workbook_inputs.js';

/// The workbooks are a domain of the runtime of the module (`packages/dashql-core-wasm/src/runtime/workbooks.rs`,
/// docs/wip/runtime_api.md). The app reads them as views through the store: the workbook, a script, and what the
/// runtime derives from the scripts of a workbook. This module holds their types and the helpers of the UI.

/// A script key
export type ScriptKey = number;

/// The result owner of the queries of a script, the connection keeps only the latest result of a script
export function scriptResultOwner(workbookId: string, scriptKey: ScriptKey): string {
    return `${workbookId}/${scriptKey}`;
}

/// A workbook: the view of the runtime with its metadata typed and the scripts by file name. It lists the keys of its
/// scripts, a script is a view of its own.
export interface WorkbookScripts extends Omit<core.WorkbookView, 'workbookMetadata'> {
    /// The metadata of the workbook file
    workbookMetadata: WorkbookMetadata;
    /// The scripts by their file names
    scriptRefs: { [fileName: string]: ScriptRef };
}

/// A script of a workbook: the view of the runtime with its payloads read
export interface ScriptData {
    /// The script key
    scriptKey: number;
    /// The workbook of the script
    workbookId: string;
    /// Names the session of the script, a script that moved to another connection has a new one. An editor event names
    /// it (`Runtime.applyEditorEvent`).
    sessionGeneration: number;
    /// The session of the script, shared with the workbook. The editor reads it, its events go to the runtime.
    scriptSession: core.DashQLScriptSession;
    /// The latest editor update
    editorUpdate: core.buffers.editor.EditorUpdateT | null;
    /// Must the script be analyzed again against its text or its catalog?
    analysisOutdated: boolean;
    /// The derived annotations for the UI
    annotations: ScriptAnnotations;
    /// The processing statistics of the latest analyses
    statistics: Immutable.List<core.buffers.editor.EditorProcessingStatisticsT>;
    /// A staged rewrite shown as an in-place diff, accepted or rejected in the editor
    pendingDiff: DashQLPendingDiff | null;
    /// The last text change that the app made to the script, e.g. the rename of a script it references. An editor
    /// that shows `fromText` applies the changes instead of replacing its text, it keeps its cursor and history.
    externalChanges: { fromText: string; changes: ScriptTextChange[] } | null;
    /// The latest query id
    latestQueryId: number | null;
    /// The retained result/computation id, independent of later commands or failures
    latestResultQueryId: number | null;
    /// The cached result of a run of the script in the query result cache, null without one
    cachedResult: core.WorkbookScriptCachedResult | null;
    /// The file name of the script
    fileName: string;
    /// The connection the script is analyzed and executed with
    connectionId: string;
    /// The connection that the workbook file names for the script while the app doesn't know it, e.g. after a hand edit
    unresolvedConnectionId?: string;
}

/// The scripts of a workbook by key
export type ScriptDataMap = { [scriptKey: number]: ScriptData };

/// What the runtime derives from the scripts of a workbook: the checked references by script key, the dataflow and the
/// inputs. It changes when an analysis changes its result.
export interface WorkbookDerived {
    workbookId: string;
    /// The keys of the scripts in feed order, the order of the dataflow
    scriptKeys: number[];
    /// The checked script references by script key, a script without a current analysis has none
    references: Map<number, ScriptReferenceReport>;
    /// The dataflow of the scripts
    dataflow: core.buffers.execution.SessionDataflowT;
    /// The inputs of the workbook
    inputs: SessionInput[];
}

/// The actions of a workbook
export type WorkbookAction = Extract<core.RuntimeAction, { kind: WorkbookActionKind }>;
type WorkbookActionKind =
    | 'createScript' | 'deleteScript' | 'renameScript' | 'reorderScripts' | 'setScriptText' | 'acceptPendingDiff'
    | 'rejectPendingDiff' | 'setScriptVisSpec' | 'setWorkbookInput' | 'analyzeOutdatedScript' | 'showScript' | 'hideScript' | 'registerQuery'
    | 'registerScriptResult' | 'renameWorkbook' | 'setScriptConnection' | 'setPendingConnection' | 'replaceConnection'
    | 'detachConnection' | 'setWorkbookAttachments' | 'setAttachmentColumns' | 'renameAttachment' | 'setCloudLink'
    | 'replaceFromStorage';

/// Apply an action to a workbook, it applies at once and the views follow with the next flush of the store
export type ModifyWorkbookScripts = (action: WorkbookAction) => core.DispatchOutcome;

/// The name of the ephemeral workbook, the sidebar shows it until a script promotes the workbook
export const EPHEMERAL_WORKBOOK_NAME = 'New Workbook';

/// Is this the ephemeral workbook of the greeter? It has no scripts and the first one promotes it to a full workbook.
export function isEphemeralWorkbook(state: Pick<WorkbookScripts, 'ephemeral'>): boolean {
    return state.ephemeral;
}

/// The published workbook of the cloud that a workbook came from or was published to, null without one
export function workbookCloudLink(state: Pick<WorkbookScripts, 'workbookMetadata'>): WorkbookCloudLink | null {
    return state.workbookMetadata?.cloud ?? null;
}

/// Is this a read-only look at a version of a published workbook? It is hidden from the local workbooks, its scripts
/// can't be changed, and importing it turns it into a workbook of its own. See docs/design/cloud.md.
export function isCloudPreview(state: Pick<WorkbookScripts, 'cloud'>): boolean {
    return state.cloud?.preview === true;
}

/// The ids of the connections that the scripts of a workbook run on, in the order the scripts first use them. A
/// workbook run takes exactly these connections.
export function scriptConnectionIds(state: Pick<WorkbookScripts, 'scriptConnections'>): string[] {
    return [...new Set(state.scriptConnections)];
}

/// The ids of the connections that a workbook uses: the connections of its scripts and the pending connection
export function workbookConnectionIds(state: Pick<WorkbookScripts, 'connectionIds'>): string[] {
    return state.connectionIds;
}

/// The number of scripts of a workbook that run on a connection. The pending connection alone does not count.
export function scriptsOnConnection(state: Pick<WorkbookScripts, 'scriptConnections'>, connectionId: string): number {
    return state.scriptConnections.filter(id => id === connectionId).length;
}

/// The scripts of a workbook by file name in feed order
export function getScriptRefs(state: Pick<WorkbookScripts, 'scriptOrder' | 'scriptRefs'>): ScriptRef[] {
    return state.scriptOrder.map(name => state.scriptRefs[name]);
}

/// The change from one text to another: the range between their common prefix and suffix
export function textChange(from: string, to: string): ScriptTextChange {
    let prefix = 0;
    const max = Math.min(from.length, to.length);
    while (prefix < max && from.charCodeAt(prefix) === to.charCodeAt(prefix)) ++prefix;
    let suffix = 0;
    while (suffix < max - prefix && from.charCodeAt(from.length - 1 - suffix) === to.charCodeAt(to.length - 1 - suffix)) ++suffix;
    return { from: prefix, to: from.length - suffix, insert: to.slice(prefix, to.length - suffix) };
}

