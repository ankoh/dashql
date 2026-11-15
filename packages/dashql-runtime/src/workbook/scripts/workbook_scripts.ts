import * as core from '@ankoh/dashql-core';

import * as Immutable from 'immutable';

import type { DashQLPendingDiff, ScriptSessionUpdate } from './script_editor_state.js';
import { CONNECTOR_INFOS, ConnectorInfo, ConnectorType } from '../../connections/connector_info.js';
import { VariantKind } from '../../utils/variant.js';
import type { StorageWriter, WorkbookScriptList } from '../../storage/storage_writer.js';
import type { ConnectionParams, WorkbookCloudLink, WorkbookConnection, WorkbookScript } from '../../storage/storage_backend.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { isHyperWasmConnection } from '../../connections/connection_label.js';
import { Logger, stringifyError } from '../../platform/logger/logger.js';
import { ScriptAnnotations, ScriptRef, WorkbookMetadata as WorkbookMetadataType, scriptDisplayName } from './script_types.js';
import { randomScriptName } from './script_name.js';
import { attachmentStamp, type WorkbookAttachment } from '../attachments/workbook_attachments.js';
import { unmountWorkbookAttachments } from '../attachments/attachment_mounts.js';
import type { DataFile } from '../../storage/storage_backend.js';
import type { ScriptTextChange } from './script_reference_check.js';
import { NativeWorkbook, nativeCloudLink, writeWorkbookEffects, type CapturedVisualization, type WorkbookScriptsInit, type WorkbookTableParameters } from './workbook_native.js';
export { deriveScriptAnnotations, type CapturedVisualization, type InitialWorkbookScript, type WorkbookScriptsInit, type WorkbookTableParameters } from './workbook_native.js';

const LOG_CTX = 'workbook_scripts';

/// A script key
export type ScriptKey = number;

/// The result owner of the queries of a script, the connection keeps only the latest result of a script
export function scriptResultOwner(workbookId: string, scriptKey: ScriptKey): string {
    return `${workbookId}/${scriptKey}`;
}
/// A script data map
export type ScriptDataMap = { [scriptKey: number]: ScriptData };

/// The runtime state of a workbook's scripts
export interface WorkbookScripts {
    /// Workbook scripts contain many references into the Wasm heap.
    /// Consumers therefore resolve the "right" module through here.
    instance: core.DashQL;
    /// The workbook identifier.
    workbookId: string;
    /// The user-supplied workbook name, independent from the identity of its connections.
    name: string | null;
    /// The connection that the next appended script runs on when no script determines it: the
    /// connection of a workbook without scripts, or the connection picked for the next script.
    /// A workbook has no default connection, its scripts name their connections.
    pendingConnection: ScriptConnection | null;
    /// The workbook metadata
    workbookMetadata: WorkbookMetadataType;
    /// The scripts
    scripts: ScriptDataMap;
    /// Committed cells keyed by their file name.
    scriptRefs: { [fileName: string]: ScriptRef };
    /// The file names of the committed cells in feed order, the keys of `scriptRefs`
    scriptOrder: string[];
    /// The attachments of the workbook, a Parquet attachment is a table parameter of the scripts. Absent until the
    /// files of the workbook were listed.
    attachments?: WorkbookAttachment[];
    /// The Rust workbook that holds the scripts, see workbook_native.ts. Absent in plain objects of tests that only
    /// read a workbook, the actions need it.
    native?: NativeWorkbook;
}

/// The connection that a script is analyzed and executed with
export interface ScriptConnection {
    /// The connection id
    connectionId: string;
    /// The connector info of the connection
    connectorInfo: ConnectorInfo;
    /// The catalog of the connection, the script session lives in it
    catalog: core.DashQLCatalog;
    /// The params of the connection when the script took it. The workbook file needs them to hold a
    /// copy of a connection that it doesn't hold yet, a copy that it holds wins.
    params?: ConnectionParams;
    /// Is the connection the embedded Hyper, which scans the results of scripts of other connections?
    local?: boolean;
    /// The database and schema of relations without those names
    catalogNameDefaults?: core.CatalogNameDefaults;
}

/// The catalogs of the connections of the runtime
export interface ConnectionCatalogs {
    catalog(connectionId: string): core.DashQLCatalog | null;
}

/// The connection of a script that runs on a connection of the runtime, with the catalog of the connection
export function scriptConnectionOf(catalogs: ConnectionCatalogs, connection: ConnectionState): ScriptConnection {
    const catalog = catalogs.catalog(connection.connectionId);
    if (catalog == null) throw new Error(`the runtime holds no connection ${connection.connectionId}`);
    return {
        connectionId: connection.connectionId,
        connectorInfo: CONNECTOR_INFOS[connection.connectorType as ConnectorType],
        catalog,
        params: connection.params,
        local: isHyperWasmConnection(connection),
        catalogNameDefaults: connection.catalogNameDefaults,
    };
}

/// The name of the ephemeral workbook, the sidebar shows it until a script promotes the workbook
export const EPHEMERAL_WORKBOOK_NAME = 'New Workbook';

/// Is this the ephemeral workbook of the greeter? It has no scripts and the first one promotes it to a full workbook.
export function isEphemeralWorkbook(state: WorkbookScripts): boolean {
    return state.workbookMetadata?.ephemeral === true;
}

/// The published workbook of the cloud that a workbook came from or was published to, null without one
export function workbookCloudLink(state: WorkbookScripts): WorkbookCloudLink | null {
    return state.workbookMetadata?.cloud ?? null;
}

/// Is this a read-only look at a version of a published workbook? It is hidden from the local workbooks, its scripts
/// can't be changed, and importing it turns it into a workbook of its own. See docs/design/cloud.md.
export function isCloudPreview(state: WorkbookScripts): boolean {
    return state.workbookMetadata?.cloud?.preview === true;
}

/// The first of "Untitled", "Untitled 2", ... that no other workbook has, compared case-insensitively
export function freeWorkbookName(names: Iterable<string | null>): string {
    const taken = new Set<string>();
    for (const name of names) {
        if (name != null) taken.add(name.trim().toLowerCase());
    }
    if (!taken.has('untitled')) return 'Untitled';
    let n = 2;
    while (taken.has(`untitled ${n}`)) ++n;
    return `Untitled ${n}`;
}

/// The names that a new workbook cannot take, the ephemeral workbook gives up its name
export function takenWorkbookNames(workbooks: Iterable<WorkbookScripts>): (string | null)[] {
    return [...workbooks].filter(workbook => !isEphemeralWorkbook(workbook)).map(workbook => workbook.name);
}

/// The scripts of a workbook in workbook order, the order of the feed
export function orderedWorkbookScripts(state: WorkbookScripts): ScriptData[] {
    return (state.scriptOrder ?? []).flatMap(name => state.scripts[state.scriptRefs[name]?.scriptId] ?? []);
}

/// What the views that the core derives from a workbook read: the names, connections and analyses of its scripts and
/// its attachments. The dataflow, the inputs and the checks of script references derive again when it changes.
export function workbookAnalysisSignature(state: WorkbookScripts): string {
    return orderedWorkbookScripts(state).map(script => [
        script.scriptKey,
        script.fileName,
        script.connection.connectionId,
        script.connection.local ? 'L' : 'R',
        script.scriptSession.getTextVersion(),
        // The analyzed text, not the cursor: the views read the text and its analysis only
        script.editorUpdate?.textVersion ?? '',
        script.editorUpdate?.catalogRevision ?? '',
        script.editorUpdate?.analysisAvailable ? 'A' : '',
    ].join('\u0001')).concat((state.attachments ?? []).map(attachment => [
        attachment.fileName,
        attachmentStamp(attachment),
        attachment.columns?.join(',') ?? '',
    ].join('\u0001'))).join('\u0002');
}

/// The ids of the connections that the scripts of a workbook run on, in the order the scripts first
/// use them. A workbook run takes exactly these connections.
export function scriptConnectionIds(state: WorkbookScripts): string[] {
    return [...new Set(orderedWorkbookScripts(state).map(script => script.connection.connectionId))];
}

/// The ids of the connections that a workbook uses: the connections of its scripts and the pending
/// connection. Everything else that knows the connections of a workbook derives them from here.
export function workbookConnectionIds(state: WorkbookScripts): string[] {
    const ids = scriptConnectionIds(state);
    if (state.pendingConnection != null && !ids.includes(state.pendingConnection.connectionId)) {
        ids.push(state.pendingConnection.connectionId);
    }
    return ids;
}

/// The connection that a new script runs on, null when the workbook has neither scripts nor a pending
/// connection. A script inserted at an index takes the connection of the script before it, the first
/// script that of the script after it. An appended script takes the pending connection, otherwise the
/// connection of the last script.
export function newScriptConnection(state: WorkbookScripts, index: number | null): ScriptConnection | null {
    const scripts = orderedWorkbookScripts(state);
    if (index == null || scripts.length === 0) {
        return state.pendingConnection ?? scripts[scripts.length - 1]?.connection ?? null;
    }
    const neighbor = scripts[Math.max(0, Math.min(Math.trunc(index), scripts.length) - 1)];
    return neighbor.connection;
}

/// The number of scripts of a workbook that run on a connection.
/// The scripts keep the connection in the workbook, the pending connection alone does not.
export function scriptsOnConnection(state: WorkbookScripts, connectionId: string): number {
    let count = 0;
    for (const script of Object.values(state.scripts)) {
        if (script.connection.connectionId === connectionId) count += 1;
    }
    return count;
}

/// A script as storage holds it
export interface StoredWorkbookScript {
    /// The file name
    name: string;
    /// The text
    sql: string;
    /// The connection
    connection: ScriptConnection;
    /// The connection that the workbook file names for the script while the app doesn't know it
    unresolvedConnectionId?: string;
}

/// The id of the connection that the workbook file names for a script
export function persistedConnectionId(script: { connection: ScriptConnection; unresolvedConnectionId?: string }): string {
    return script.unresolvedConnectionId ?? script.connection.connectionId;
}

/// Storage-shaped workbook content used when an external filesystem change replaces the persisted
/// workbook. Keeping this type here prevents the native watcher from knowing about WASM lifetime
/// and catalog invariants.
export interface WorkbookScriptsStorageSnapshot {
    /// The scripts in feed order
    scripts: StoredWorkbookScript[];
}

/// A script data
export interface ScriptData {
    /// The script key
    scriptKey: number;
    /// The durable editor workbook that owns the native script
    scriptSession: core.DashQLScriptSession;
    /// The latest plain editor-workbook snapshot.
    editorUpdate?: core.buffers.editor.EditorUpdateT | null;
    /// Whether the editor workbook must be reanalyzed against its text or catalog.
    analysisOutdated: boolean;
    /// The derived annotations for the ui
    annotations: ScriptAnnotations;
    /// The statistics
    statistics: Immutable.List<core.buffers.editor.EditorProcessingStatisticsT>;
    /// A pending, staged formatting rewrite shown as an in-place diff.
    /// Set by SET_SCRIPT_TEXT; cleared once the user accepts/rejects it in the
    /// editor (which round-trips back through UPDATE_FROM_PROCESSOR).
    pendingDiff: DashQLPendingDiff | null;
    /// The last text change that the app made to the script, e.g. the rename of a script it references. An editor
    /// that shows `fromText` applies the changes instead of replacing its text, it keeps its cursor and history.
    externalChanges?: { fromText: string; changes: ScriptTextChange[] } | null;
    /// The latest query id
    latestQueryId: number | null;
    /// The retained result/computation id, independent of later commands or failures.
    latestResultQueryId?: number | null;
    /// The file name of this committed script
    fileName: string;
    /// The connection the script is analyzed and executed with
    connection: ScriptConnection;
    /// The connection that the workbook file names for the script while the app doesn't know it, e.g.
    /// after a hand edit. The script runs on the embedded database meanwhile and the workbook file
    /// keeps the reference until another connection is picked.
    unresolvedConnectionId?: string;
}

export const ANALYZE_OUTDATED_SCRIPT = Symbol('ANALYZE_OUTDATED_SCRIPT');
/// The Rust workbook changed outside of an action, e.g. a run registered a query: project it again
export const PROJECT_WORKBOOK = Symbol('PROJECT_WORKBOOK');
export const UPDATE_FROM_PROCESSOR = Symbol('UPDATE_FROM_PROCESSOR');
export const CATALOG_DID_UPDATE = Symbol('CATALOG_DID_UPDATE');
export const REGISTER_QUERY = Symbol('REGISTER_QUERY');
export const REGISTER_SCRIPT_RESULT = Symbol('REGISTER_SCRIPT_RESULT');
export const SET_SCRIPT_EXECUTION_VISUALIZATION = Symbol('SET_SCRIPT_EXECUTION_VISUALIZATION');
export const CREATE_SCRIPT = Symbol('CREATE_SCRIPT');
export const DELETE_SCRIPT = Symbol('DELETE_SCRIPT');
export const RENAME_SCRIPT = Symbol('RENAME_SCRIPT');
export const REORDER_SCRIPTS = Symbol('REORDER_SCRIPTS');
export const SET_SCRIPT_TEXT = Symbol('SET_SCRIPT_TEXT');
export const SET_SCRIPT_VIS_SPEC = Symbol('SET_SCRIPT_VIS_SPEC');
export const SET_WORKBOOK_INPUT = Symbol('SET_WORKBOOK_INPUT');
export const ACCEPT_PENDING_DIFF = Symbol('ACCEPT_PENDING_DIFF');
export const REJECT_PENDING_DIFF = Symbol('REJECT_PENDING_DIFF');
export const RENAME_WORKBOOK = Symbol('RENAME_WORKBOOK');
export const SET_SCRIPT_CONNECTION = Symbol('SET_SCRIPT_CONNECTION');
export const SET_PENDING_CONNECTION = Symbol('SET_PENDING_CONNECTION');
export const REPLACE_CONNECTION = Symbol('REPLACE_CONNECTION');
export const DETACH_CONNECTION = Symbol('DETACH_CONNECTION');
export const SET_WORKBOOK_ATTACHMENTS = Symbol('SET_WORKBOOK_ATTACHMENTS');
export const SET_ATTACHMENT_COLUMNS = Symbol('SET_ATTACHMENT_COLUMNS');
export const RENAME_ATTACHMENT = Symbol('RENAME_ATTACHMENT');
export const SET_WORKBOOK_CLOUD_LINK = Symbol('SET_WORKBOOK_CLOUD_LINK');

export type WorkbookScriptsAction =
    | VariantKind<typeof ANALYZE_OUTDATED_SCRIPT, ScriptKey>
    | VariantKind<typeof PROJECT_WORKBOOK, null>
    | VariantKind<typeof UPDATE_FROM_PROCESSOR, ScriptSessionUpdate>
    | VariantKind<typeof CATALOG_DID_UPDATE, string>
    | VariantKind<typeof REGISTER_QUERY, [ScriptKey, number]>
    | VariantKind<typeof REGISTER_SCRIPT_RESULT, [ScriptKey, number]>
    /// The visualization that a run captured with the query of a script, it replaces the compiled one
    | VariantKind<typeof SET_SCRIPT_EXECUTION_VISUALIZATION, [ScriptKey, CapturedVisualization | null]>
    | VariantKind<typeof CREATE_SCRIPT, { index: number | null, text?: string, connection?: ScriptConnection }>
    | VariantKind<typeof DELETE_SCRIPT, string>
    | VariantKind<typeof RENAME_SCRIPT, { fileName: string, newFileName: string }>
    | VariantKind<typeof REORDER_SCRIPTS, string[]>
    /// With a diff, the rewrite is staged to accept or reject, together with a diff that is already staged
    | VariantKind<typeof SET_SCRIPT_TEXT, { scriptKey: ScriptKey, text: string, withDiff?: boolean }>
    | VariantKind<typeof SET_SCRIPT_VIS_SPEC, { scriptKey: ScriptKey, spec: string }>
    | VariantKind<typeof SET_WORKBOOK_INPUT, { name: string, literal: string, scriptKeys: ScriptKey[] }>
    | VariantKind<typeof ACCEPT_PENDING_DIFF, ScriptKey>
    | VariantKind<typeof REJECT_PENDING_DIFF, ScriptKey>
    | VariantKind<typeof RENAME_WORKBOOK, string | null>
    | VariantKind<typeof SET_SCRIPT_CONNECTION, { fileName: string, connection: ScriptConnection }>
    | VariantKind<typeof SET_PENDING_CONNECTION, ScriptConnection>
    /// The scripts and the pending connection of the workbook on one connection move to another
    | VariantKind<typeof REPLACE_CONNECTION, { from: string, into: ScriptConnection }>
    | VariantKind<typeof DETACH_CONNECTION, { from: string, into: ScriptConnection }>
    /// The data files of the workbook as the storage lists them
    | VariantKind<typeof SET_WORKBOOK_ATTACHMENTS, DataFile[]>
    /// The columns of an attachment, read from the file with the stamp
    | VariantKind<typeof SET_ATTACHMENT_COLUMNS, { fileName: string, stamp: string, columns: string[] }>
    /// An attachment whose file was renamed, the scripts that read it read the new name
    | VariantKind<typeof RENAME_ATTACHMENT, { fileName: string, newFileName: string }>
    /// The published workbook of the cloud that the workbook is linked to, null removes the link. A link without
    /// `preview` imports a cloud preview.
    | VariantKind<typeof SET_WORKBOOK_CLOUD_LINK, WorkbookCloudLink | null>
    ;

/// The actions that a cloud preview refuses: they change the scripts or the names of the workbook. Running scripts,
/// inputs and the connections of the scripts stay, they don't change what the workbook says.
const CLOUD_PREVIEW_REFUSED_ACTIONS: ReadonlySet<symbol> = new Set([
    CREATE_SCRIPT, DELETE_SCRIPT, RENAME_SCRIPT, REORDER_SCRIPTS, SET_SCRIPT_TEXT, SET_SCRIPT_VIS_SPEC, ACCEPT_PENDING_DIFF,
    RENAME_WORKBOOK, RENAME_ATTACHMENT, SET_WORKBOOK_INPUT, SET_SCRIPT_CONNECTION,
]);

/// Does a cloud preview refuse the action?
export function isRefusedByCloudPreview(state: WorkbookScripts, action: WorkbookScriptsAction): boolean {
    return isCloudPreview(state) && CLOUD_PREVIEW_REFUSED_ACTIONS.has(action.type);
}

/// Returns the committed cells in feed order.
export function getScriptRefs(state: WorkbookScripts): ScriptRef[] {
    return state.scriptOrder.map(name => state.scriptRefs[name]);
}

/// The script list of the workbook file, the cells in feed order with their connections
export function workbookScriptList(state: WorkbookScripts): WorkbookScript[] {
    return state.scriptOrder.flatMap(name => {
        const script = state.scripts[state.scriptRefs[name]?.scriptId];
        return script == null ? [] : [{ name, connectionId: persistedConnectionId(script) }];
    });
}

/// The copies of the connections that the scripts of a workbook use, as far as the scripts know them
export function workbookConnectionCopies(state: WorkbookScripts): WorkbookConnection[] {
    const copies = new Map<string, WorkbookConnection>();
    for (const script of Object.values(state.scripts)) {
        const { connectionId, params } = script.connection;
        if (params != null && !copies.has(connectionId)) copies.set(connectionId, { connectionId, params });
    }
    return [...copies.values()];
}

/// The script list of a workbook as the workbook file stores it.
/// A workbook without scripts holds the pending connection, the given copies list it first.
export function workbookScriptListWrite(state: WorkbookScripts): WorkbookScriptList {
    const pending = state.pendingConnection;
    const pendingCopy = state.scriptOrder.length === 0 && pending?.params != null
        ? [{ connectionId: pending.connectionId, params: pending.params }]
        : [];
    return { scripts: workbookScriptList(state), connections: [...pendingCopy, ...workbookConnectionCopies(state)] };
}

/// The storage of the workbook reducer. The registry defers the writes of a reduction until it returned: a reducer
/// that throws leaves the storage untouched.
export interface WorkbookScriptsStorage {
    /// Schedule a write
    write: StorageWriter['write'];
}

/// The writes of a workbook reduction, applied once it returned
export class WorkbookScriptsEffects implements WorkbookScriptsStorage {
    private readonly writes: Array<() => void> = [];

    constructor(private readonly storage: StorageWriter) { }

    write(...args: Parameters<StorageWriter['write']>): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.writes.push(() => this.storage.write(...args).then(resolve, reject));
        });
    }
    /// Apply the writes, in the order of the reduction
    commit(): void {
        for (const write of this.writes) write();
        this.writes.length = 0;
    }
}

/// Create the scripts of a workbook, e.g. the scripts that storage holds. The scripts analyze when they are used.
export function createWorkbookScripts(init: WorkbookScriptsInit): WorkbookScripts {
    return NativeWorkbook.create(init);
}

/// The Rust workbook behind the scripts of a workbook
function nativeOf(state: WorkbookScripts): NativeWorkbook {
    if (state.native == null) throw new Error('the scripts of the workbook have no Rust workbook, create them with createWorkbookScripts');
    return state.native;
}

/// The next state after an outcome of the Rust workbook: the writes of its effects and the projection. An outcome
/// that changed nothing keeps the state.
function settle(state: WorkbookScripts, outcomes: readonly core.WorkbookOutcome[], storage: WorkbookScriptsStorage): WorkbookScripts {
    if (outcomes.every(outcome => !outcome.changed && outcome.effects.length === 0)) {
        nativeOf(state).forgetUpdates();
        return state;
    }
    const next = nativeOf(state).project(state);
    for (const outcome of outcomes) writeWorkbookEffects(next, outcome.effects, storage);
    return next;
}

/// Promote an ephemeral workbook with scripts to a full workbook: it drops the marker and takes a free name.
/// Every path that adds a script ends here, also the commands of the agent.
export function promoteEphemeralWorkbook(state: WorkbookScripts, workbooks: Iterable<WorkbookScripts>, storage: WorkbookScriptsStorage): WorkbookScripts {
    if (!isEphemeralWorkbook(state) || state.scriptOrder.length === 0) return state;
    const taken = takenWorkbookNames(workbooks).filter((name): name is string => name != null);
    return settle(state, [nativeOf(state).workbook.promote(taken)], storage);
}

export function reduceWorkbookScripts(state: WorkbookScripts, action: WorkbookScriptsAction, storage: WorkbookScriptsStorage, logger: Logger): WorkbookScripts {
    if (isRefusedByCloudPreview(state, action)) {
        logger.warn('Refused a change of a cloud preview', { workbookId: state.workbookId, actionType: action.type.description ?? '' }, LOG_CTX);
        return state;
    }
    const native = nativeOf(state);
    const workbook = native.workbook;
    switch (action.type) {
        case SET_WORKBOOK_ATTACHMENTS:
            return settle(state, [workbook.setWorkbookAttachments(action.value)], storage);
        case SET_ATTACHMENT_COLUMNS: {
            const { fileName, stamp, columns } = action.value;
            return settle(state, [workbook.setAttachmentColumns(fileName, stamp, columns)], storage);
        }
        case RENAME_ATTACHMENT:
            return settle(state, [workbook.renameAttachment(action.value.fileName, action.value.newFileName)], storage);
        case SET_WORKBOOK_CLOUD_LINK: {
            const link = action.value;
            native.cloudLink = link;
            return settle(state, [workbook.setCloudLink(link == null ? null : nativeCloudLink(link))], storage);
        }
        case RENAME_WORKBOOK:
            return settle(state, [workbook.renameWorkbook(action.value)], storage);
        case CATALOG_DID_UPDATE:
            return settle(state, [workbook.catalogDidUpdate(action.value)], storage);
        case ANALYZE_OUTDATED_SCRIPT:
            if (state.scripts[action.value] == null) return state;
            return settle(state, [workbook.analyzeOutdatedScript(action.value)], storage);
        case PROJECT_WORKBOOK:
            return native.project(state);
        case UPDATE_FROM_PROCESSOR: {
            const update = action.value;
            const prevScript = state.scripts[update.scriptKey];
            // An update of a script that we don't know, or of a session that the script no longer holds, is dropped
            if (prevScript == null || update.scriptSession !== prevScript.scriptSession) {
                logger.warn('Dropping editor update of an unknown script or a stale session', {
                    workbookId: state.workbookId,
                    scriptKey: update.scriptKey.toString(),
                    textVersion: update.editorUpdate?.textVersion.toString(),
                }, LOG_CTX);
                return state;
            }
            const outcomes: core.WorkbookOutcome[] = [];
            if (update.editorUpdate != null) {
                native.knowUpdate(update.scriptKey, update.editorUpdate);
                outcomes.push(workbook.reportEditorUpdate(update.scriptKey, update.editorUpdate, false));
            }
            // The editor accepted or rejected the staged rewrite, a rejection restored the text already
            if (update.scriptPendingDiff == null && prevScript.pendingDiff != null) {
                outcomes.push(workbook.acceptPendingDiff(update.scriptKey));
            }
            return settle(state, outcomes, storage);
        }
        case REGISTER_QUERY: {
            const [scriptKey, queryId] = action.value;
            if (state.scripts[scriptKey] == null) {
                logger.warn('Orphan query references invalid script', { scriptKey: scriptKey.toString(), queryId: queryId.toString() }, LOG_CTX);
                return state;
            }
            return settle(state, [workbook.registerQuery(scriptKey, queryId)], storage);
        }
        case REGISTER_SCRIPT_RESULT: {
            const [scriptKey, queryId] = action.value;
            if (state.scripts[scriptKey] == null) return state;
            return settle(state, [workbook.registerScriptResult(scriptKey, queryId)], storage);
        }
        case SET_SCRIPT_EXECUTION_VISUALIZATION: {
            const [scriptKey, visualization] = action.value;
            if (state.scripts[scriptKey] == null) return state;
            return settle(state, [workbook.setExecutionVisualization(scriptKey, visualization)], storage);
        }
        case CREATE_SCRIPT: {
            const { index, text, connection } = action.value;
            if (connection == null && newScriptConnection(state, index) == null) {
                logger.warn('CREATE_SCRIPT misses a connection', { workbookId: state.workbookId }, LOG_CTX);
                return state;
            }
            const base = randomScriptName(new Set(Object.keys(state.scriptRefs).map(scriptDisplayName)));
            const target = connection == null ? undefined : native.connection(connection);
            return settle(state, [workbook.createScript(index, text ?? null, base, target)], storage);
        }
        case DELETE_SCRIPT:
            return settle(state, [workbook.deleteScript(action.value)], storage);
        case RENAME_SCRIPT:
            if (state.scriptRefs[action.value.fileName] == null) {
                logger.warn('RENAME_SCRIPT references invalid script', { fileName: action.value.fileName }, LOG_CTX);
                return state;
            }
            return settle(state, [workbook.renameScript(action.value.fileName, action.value.newFileName)], storage);
        case REORDER_SCRIPTS:
            return settle(state, [workbook.reorderScripts(action.value)], storage);
        case SET_SCRIPT_TEXT: {
            const { scriptKey, text, withDiff } = action.value;
            if (state.scripts[scriptKey] == null) {
                logger.warn('SET_SCRIPT_TEXT references invalid script', { scriptKey: scriptKey.toString() }, LOG_CTX);
                return state;
            }
            return settle(state, [workbook.setScriptText(scriptKey, text, withDiff ?? false)], storage);
        }
        case SET_SCRIPT_VIS_SPEC: {
            const { scriptKey, spec } = action.value;
            if (state.scripts[scriptKey] == null) {
                logger.warn('SET_SCRIPT_VIS_SPEC references invalid script', { scriptKey: scriptKey.toString() }, LOG_CTX);
                return state;
            }
            return settle(state, [workbook.setScriptVisSpec(scriptKey, spec)], storage);
        }
        case SET_WORKBOOK_INPUT: {
            const { name, literal, scriptKeys } = action.value;
            return settle(state, [workbook.setWorkbookInput(name, literal, scriptKeys.filter(key => state.scripts[key] != null))], storage);
        }
        case ACCEPT_PENDING_DIFF:
            if (state.scripts[action.value] == null) return state;
            return settle(state, [workbook.acceptPendingDiff(action.value)], storage);
        case REJECT_PENDING_DIFF:
            if (state.scripts[action.value] == null) return state;
            return settle(state, [workbook.rejectPendingDiff(action.value)], storage);
        case SET_SCRIPT_CONNECTION: {
            const { fileName, connection } = action.value;
            if (state.scriptRefs[fileName] == null) {
                logger.warn('SET_SCRIPT_CONNECTION references invalid script', { fileName }, LOG_CTX);
                return state;
            }
            try {
                return settle(state, [workbook.setScriptConnection(fileName, native.connection(connection))], storage);
            } catch (e: unknown) {
                // The script stays on its connection
                logger.warn('Failed to move script to another connection', { fileName, error: stringifyError(e) }, LOG_CTX);
                return state;
            }
        }
        case SET_PENDING_CONNECTION: {
            const connection = action.value;
            if (connection.params == null) {
                logger.warn('SET_PENDING_CONNECTION misses the params of the connection', { connectionId: connection.connectionId }, LOG_CTX);
                return state;
            }
            return settle(state, [workbook.setPendingConnection(native.connection(connection))], storage);
        }
        case DETACH_CONNECTION:
            return settle(state, [workbook.detachConnection(action.value.from, native.connection(action.value.into))], storage);
        case REPLACE_CONNECTION: {
            const { from, into } = action.value;
            return settle(state, [workbook.replaceConnection(from, native.connection(into))], storage);
        }
    }
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

/// Free the scripts of a workbook, they leave the catalogs of their connections
export function destroyWorkbookScripts(state: WorkbookScripts): WorkbookScripts {
    state.native?.destroy();
    void unmountWorkbookAttachments(state.workbookId);
    return state;
}

/// Does storage hold the scripts of a workbook as they are: the same files in the same order, on the same
/// connections, with the same texts?
export function workbookScriptsMatchStorageSnapshot(state: WorkbookScripts, snapshot: WorkbookScriptsStorageSnapshot): boolean {
    const native = nativeOf(state);
    return native.workbook.matchesStoredScripts(snapshot.scripts.map(script => storedScript(native, script)));
}

/// Replace the scripts of a workbook with the ones that storage holds, e.g. after the files changed outside of the
/// app. Writes nothing back. Scripts that stay at their file name on their connection keep their session and their
/// queries, a script that moved to another connection keeps its key. A failure leaves the workbook as it is.
export function replaceWorkbookScriptsFromStorage(
    state: WorkbookScripts,
    snapshot: WorkbookScriptsStorageSnapshot,
    _logger: Logger,
): WorkbookScripts {
    const native = nativeOf(state);
    const changed = native.workbook.replaceFromStorage(snapshot.scripts.map(script => storedScript(native, script)));
    return changed ? native.project(state) : state;
}

function storedScript(native: NativeWorkbook, script: StoredWorkbookScript): core.WorkbookStoredScript {
    return { name: script.name, sql: script.sql, connection: native.connection(script.connection), unresolvedConnectionId: script.unresolvedConnectionId };
}

/// The table parameters of a workbook for sessions that are no scripts of it, e.g. the draft of the composer
export function workbookTableParameters(state: WorkbookScripts): WorkbookTableParameters | null {
    return state.native?.tableParameters() ?? null;
}

export function replaceScriptSessionText(scriptSession: core.DashQLScriptSession, text: string): void {
    const update = scriptSession.replaceText(scriptSession.getTextVersion(), text);
    if (update.status !== core.buffers.editor.EditorUpdateStatus.OK) {
        const status = core.buffers.editor.EditorUpdateStatus[update.status] ?? update.status.toString();
        throw new Error(`Failed to replace editor workbook text: ${status}`);
    }
}

/// Is the analysis of a script outdated? The flag marks the changes that the workbook knows about, the versions also
/// catch the ones it missed: the text of the session or its catalog changed since the analysis. A script that
/// published its own declarations changed its catalog too, so a current script may analyze once more.
export function isAnalysisOutdated(scriptData: ScriptData): boolean {
    if (scriptData.analysisOutdated) return true;
    const update = scriptData.editorUpdate;
    if (update == null) return false;
    return update.textVersion !== scriptData.scriptSession.getTextVersion()
        || update.catalogRevision !== scriptData.scriptSession.getCatalogRevision();
}
