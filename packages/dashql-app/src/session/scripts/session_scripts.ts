import * as core from '@ankoh/dashql-core';
import * as Immutable from 'immutable';

import { DashQLCompletionState, DashQLPendingDiff, DashQLProcessorUpdateOut } from '../editor/dashql_processor.js';
import { deriveFocusFromCompletionCandidates, deriveFocusFromEditorUpdate, SemanticUserFocus } from './focus.js';
import { ConnectorInfo, ConnectorType } from '../../connections/connector_info.js';
import { VariantKind } from '../../utils/variant.js';
import {
    DEBOUNCE_DURATION_SCRIPT_WRITE,
    DEBOUNCE_DURATION_SESSION_WRITE,
    DELETE_SCRIPT as STORAGE_DELETE_SCRIPT,
    groupSessionConnectionCopyWrites,
    groupSessionManifestWrites,
    groupSessionScriptListWrites,
    groupScriptDeletes,
    groupScriptRenames,
    groupScriptWrites,
    RENAME_SCRIPT as STORAGE_RENAME_SCRIPT,
    PATCH_SESSION_CONNECTION,
    StorageWriter,
    WRITE_SESSION_PROPERTIES,
    WRITE_SESSION_SCRIPTS,
    WRITE_SCRIPT,
    type SessionScriptList,
} from '../../storage/storage_writer.js';
import type { ConnectionParams, SessionConnection, SessionScript } from '../../storage/storage_backend.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { isHyperWasmConnection } from '../../connections/connection_label.js';
import { Logger, LoggerLike, stringifyError } from '../../platform/logger/logger.js';
import { ScriptAnnotations, ScriptRef, SessionMetadata as SessionMetadataType, ResolvedVisualizeQuery, createEmptyAnnotations, createScriptRef, generateScriptFileName, scriptDisplayName, uniqueScriptBase } from './script_types.js';

import { chartStatementId, compileVisualizeQuery } from './script_compilation.js';
import { dropSessionTableParameters, publishTableParameters } from './table_parameters_publisher.js';
import { attachmentNames, attachmentParameterName, attachmentStamp, readSessionAttachments, sameSessionAttachments, type SessionAttachment } from '../attachments/session_attachments.js';
import { unmountSessionAttachments } from '../attachments/attachment_mounts.js';
import type { DataFile } from '../../storage/storage_backend.js';
import { applyScriptTextChanges, computeScriptReferenceReports, renameReferenceChanges, type ScriptTextChange, type TableParameterTarget } from './script_reference_check.js';

const LOG_CTX = 'session_scripts';

/// A script key
export type ScriptKey = number;

/// The result owner of the queries of a script, the connection keeps only the latest result of a script
export function scriptResultOwner(sessionId: string, scriptKey: ScriptKey): string {
    return `${sessionId}/${scriptKey}`;
}
/// A script data map
export type ScriptDataMap = { [scriptKey: number]: ScriptData };
/// A session user focus
export interface ScriptFocus {
    /// The file name of the selected cell (empty if none)
    fileName: string;
}

/// The runtime state of a session's scripts
export interface SessionScripts {
    /// Session scripts contain many references into the Wasm heap.
    /// Consumers therefore resolve the "right" module through here.
    instance: core.DashQL;
    /// The session identifier.
    sessionId: string;
    /// The user-supplied session name, independent from the identity of its connections.
    name: string | null;
    /// The connection that the next appended script runs on when no script determines it: the
    /// connection of a session without scripts, or the connection picked for the next script.
    /// A session has no default connection, its scripts name their connections.
    pendingConnection: ScriptConnection | null;
    /// The session metadata
    sessionMetadata: SessionMetadataType;
    /// The scripts
    scripts: ScriptDataMap;
    /// Committed cells keyed by their file name.
    scriptRefs: { [fileName: string]: ScriptRef };
    /// The file names of the committed cells in feed order, the keys of `scriptRefs`
    scriptOrder: string[];
    /// The session focus (selected cell by file name)
    scriptFocus: ScriptFocus;
    /// The semantic user focus info (if any)
    semanticUserFocus: SemanticUserFocus | null;
    /// The attachments of the session, a Parquet attachment is a table parameter of the scripts. Absent until the
    /// files of the session were listed.
    attachments?: SessionAttachment[];
}

/// The connection that a script is analyzed and executed with
export interface ScriptConnection {
    /// The connection id
    connectionId: string;
    /// The connector info of the connection
    connectorInfo: ConnectorInfo;
    /// The catalog of the connection, the script session lives in it
    catalog: core.DashQLCatalog;
    /// The params of the connection when the script took it. The session file needs them to hold a
    /// copy of a connection that it doesn't hold yet, a copy that it holds wins.
    params?: ConnectionParams;
    /// Is the connection the embedded Hyper, which scans the results of scripts of other connections?
    local?: boolean;
}

/// The connection of a script that runs on a connection of the app
export function scriptConnectionOf(connection: ConnectionState): ScriptConnection {
    return {
        connectionId: connection.connectionId, connectorInfo: connection.connectorInfo, catalog: connection.catalog, params: connection.params,
        local: isHyperWasmConnection(connection),
    };
}

/// The name of the ephemeral session, the sidebar shows it until a script promotes the session
export const EPHEMERAL_SESSION_NAME = 'New session';

/// Is this the ephemeral session of the greeter? It has no scripts and the first one promotes it to a full session.
export function isEphemeralSession(state: SessionScripts): boolean {
    return state.sessionMetadata?.ephemeral === true;
}

/// The first of "Untitled", "Untitled 2", ... that no other session has, compared case-insensitively
export function freeSessionName(names: Iterable<string | null>): string {
    const taken = new Set<string>();
    for (const name of names) {
        if (name != null) taken.add(name.trim().toLowerCase());
    }
    if (!taken.has('untitled')) return 'Untitled';
    let n = 2;
    while (taken.has(`untitled ${n}`)) ++n;
    return `Untitled ${n}`;
}

/// The names that a new session cannot take, the ephemeral session gives up its name
export function takenSessionNames(sessions: Iterable<SessionScripts>): (string | null)[] {
    return [...sessions].filter(session => !isEphemeralSession(session)).map(session => session.name);
}

/// The scripts of a session in session order, the order of the feed
export function orderedSessionScripts(state: SessionScripts): ScriptData[] {
    return (state.scriptOrder ?? []).flatMap(name => state.scripts[state.scriptRefs[name]?.scriptId] ?? []);
}

/// What the views that the core derives from a session read: the names, connections and analyses of its scripts and
/// its attachments. The dataflow, the inputs and the checks of script references derive again when it changes.
export function sessionAnalysisSignature(state: SessionScripts): string {
    return orderedSessionScripts(state).map(script => [
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

/// The ids of the connections that the scripts of a session run on, in the order the scripts first
/// use them. A session run takes exactly these connections.
export function scriptConnectionIds(state: SessionScripts): string[] {
    return [...new Set(orderedSessionScripts(state).map(script => script.connection.connectionId))];
}

/// The ids of the connections that a session uses: the connections of its scripts and the pending
/// connection. Everything else that knows the connections of a session derives them from here.
export function sessionConnectionIds(state: SessionScripts): string[] {
    const ids = scriptConnectionIds(state);
    if (state.pendingConnection != null && !ids.includes(state.pendingConnection.connectionId)) {
        ids.push(state.pendingConnection.connectionId);
    }
    return ids;
}

/// The connection that a new script runs on, null when the session has neither scripts nor a pending
/// connection. A script inserted at an index takes the connection of the script before it, the first
/// script that of the script after it. An appended script takes the pending connection, otherwise the
/// connection of the last script.
export function newScriptConnection(state: SessionScripts, index: number | null): ScriptConnection | null {
    const scripts = orderedSessionScripts(state);
    if (index == null || scripts.length === 0) {
        return state.pendingConnection ?? scripts[scripts.length - 1]?.connection ?? null;
    }
    const neighbor = scripts[Math.max(0, Math.min(Math.trunc(index), scripts.length) - 1)];
    return neighbor.connection;
}

/// The number of scripts of a session that run on a connection.
/// The scripts keep the connection in the session, the pending connection alone does not.
export function scriptsOnConnection(state: SessionScripts, connectionId: string): number {
    let count = 0;
    for (const script of Object.values(state.scripts)) {
        if (script.connection.connectionId === connectionId) count += 1;
    }
    return count;
}

/// A script as storage holds it
export interface StoredSessionScript {
    /// The file name
    name: string;
    /// The text
    sql: string;
    /// The connection
    connection: ScriptConnection;
    /// The connection that the session file names for the script while the app doesn't know it
    unresolvedConnectionId?: string;
}

/// The id of the connection that the session file names for a script
export function persistedConnectionId(script: { connection: ScriptConnection; unresolvedConnectionId?: string }): string {
    return script.unresolvedConnectionId ?? script.connection.connectionId;
}

/// Storage-shaped session content used when an external filesystem change replaces the persisted
/// session. Keeping this type here prevents the native watcher from knowing about WASM lifetime
/// and catalog invariants.
export interface SessionScriptsStorageSnapshot {
    /// The scripts in feed order
    scripts: StoredSessionScript[];
}

export function sessionScriptsMatchStorageSnapshot(state: SessionScripts, snapshot: SessionScriptsStorageSnapshot): boolean {
    if (state.scriptOrder.length !== snapshot.scripts.length) {
        return false;
    }
    return snapshot.scripts.every((stored, i) => {
        const ref = state.scriptRefs[stored.name];
        const script = ref == null ? undefined : state.scripts[ref.scriptId];
        return state.scriptOrder[i] === stored.name
            && script?.connection.connectionId === stored.connection.connectionId
            && persistedConnectionId(script) === persistedConnectionId(stored)
            && script.scriptSession.getText() === stored.sql;
    });
}

/// A script data
export interface ScriptData {
    /// The script key
    scriptKey: number;
    /// The durable editor session that owns the native script
    scriptSession: core.DashQLScriptSession;
    /// The latest plain editor-session snapshot.
    editorUpdate?: core.buffers.editor.EditorUpdateT | null;
    /// Whether the editor session must be reanalyzed against its text or catalog.
    analysisOutdated: boolean;
    /// The derived annotations for the ui
    annotations: ScriptAnnotations;
    /// The statistics
    statistics: Immutable.List<core.buffers.editor.EditorProcessingStatisticsT>;
    /// The completion state.
    completion: DashQLCompletionState | null;
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
    /// The connection that the session file names for the script while the app doesn't know it, e.g.
    /// after a hand edit. The script runs on the embedded database meanwhile and the session file
    /// keeps the reference until another connection is picked.
    unresolvedConnectionId?: string;
}

export const SELECT_NEXT_SCRIPT = Symbol('SELECT_NEXT_SCRIPT');
export const SELECT_PREV_SCRIPT = Symbol('SELECT_PREV_SCRIPT');
export const SELECT_SCRIPT = Symbol('SELECT_SCRIPT');
export const ANALYZE_OUTDATED_SCRIPT = Symbol('ANALYZE_OUTDATED_SCRIPT');
export const APPLY_PLANNER_ANALYSIS = Symbol('APPLY_PLANNER_ANALYSIS');
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
export const SET_SESSION_INPUT = Symbol('SET_SESSION_INPUT');
export const ACCEPT_PENDING_DIFF = Symbol('ACCEPT_PENDING_DIFF');
export const REJECT_PENDING_DIFF = Symbol('REJECT_PENDING_DIFF');
export const RENAME_SESSION = Symbol('RENAME_SESSION');
export const SET_SCRIPT_CONNECTION = Symbol('SET_SCRIPT_CONNECTION');
export const SET_PENDING_CONNECTION = Symbol('SET_PENDING_CONNECTION');
export const REPLACE_CONNECTION = Symbol('REPLACE_CONNECTION');
export const DETACH_CONNECTION = Symbol('DETACH_CONNECTION');
export const SET_SESSION_ATTACHMENTS = Symbol('SET_SESSION_ATTACHMENTS');
export const SET_ATTACHMENT_COLUMNS = Symbol('SET_ATTACHMENT_COLUMNS');
export const RENAME_ATTACHMENT = Symbol('RENAME_ATTACHMENT');

export type SessionScriptsAction =
    | VariantKind<typeof SELECT_NEXT_SCRIPT, null>
    | VariantKind<typeof SELECT_PREV_SCRIPT, null>
    | VariantKind<typeof SELECT_SCRIPT, string>
    | VariantKind<typeof ANALYZE_OUTDATED_SCRIPT, ScriptKey>
    | VariantKind<typeof APPLY_PLANNER_ANALYSIS, Array<{ scriptKey: number; editorUpdate: core.buffers.editor.EditorUpdateT }>>
    | VariantKind<typeof UPDATE_FROM_PROCESSOR, DashQLProcessorUpdateOut>
    | VariantKind<typeof CATALOG_DID_UPDATE, string>
    | VariantKind<typeof REGISTER_QUERY, [ScriptKey, number]>
    | VariantKind<typeof REGISTER_SCRIPT_RESULT, [ScriptKey, number]>
    | VariantKind<typeof SET_SCRIPT_EXECUTION_VISUALIZATION, [ScriptKey, ResolvedVisualizeQuery | null]>
    | VariantKind<typeof CREATE_SCRIPT, { index: number | null, text?: string, connection?: ScriptConnection }>
    | VariantKind<typeof DELETE_SCRIPT, string>
    | VariantKind<typeof RENAME_SCRIPT, { fileName: string, newFileName: string }>
    | VariantKind<typeof REORDER_SCRIPTS, string[]>
    /// With a diff, the rewrite is staged to accept or reject, together with a diff that is already staged
    | VariantKind<typeof SET_SCRIPT_TEXT, { scriptKey: ScriptKey, text: string, withDiff?: boolean }>
    | VariantKind<typeof SET_SCRIPT_VIS_SPEC, { scriptKey: ScriptKey, spec: string }>
    | VariantKind<typeof SET_SESSION_INPUT, { name: string, literal: string, scriptKeys: ScriptKey[] }>
    | VariantKind<typeof ACCEPT_PENDING_DIFF, ScriptKey>
    | VariantKind<typeof REJECT_PENDING_DIFF, ScriptKey>
    | VariantKind<typeof RENAME_SESSION, string | null>
    | VariantKind<typeof SET_SCRIPT_CONNECTION, { fileName: string, connection: ScriptConnection }>
    | VariantKind<typeof SET_PENDING_CONNECTION, ScriptConnection>
    /// The scripts and the pending connection of the session on one connection move to another
    | VariantKind<typeof REPLACE_CONNECTION, { from: string, into: ConnectionState }>
    | VariantKind<typeof DETACH_CONNECTION, { from: string, into: ScriptConnection }>
    /// The data files of the session as the storage lists them
    | VariantKind<typeof SET_SESSION_ATTACHMENTS, DataFile[]>
    /// The columns of an attachment, read from the file with the stamp
    | VariantKind<typeof SET_ATTACHMENT_COLUMNS, { fileName: string, stamp: string, columns: string[] }>
    /// An attachment whose file was renamed, the scripts that read it read the new name
    | VariantKind<typeof RENAME_ATTACHMENT, { fileName: string, newFileName: string }>
    ;

const STATS_HISTORY_LIMIT = 20;

/// Create the data of an empty script on a connection.
/// A script that moves to another connection keeps its script key, the key is unused in the catalog of the connection.
export function createEmptyScriptData(instance: core.DashQL, connection: ScriptConnection, fileName: string = '', movedScriptKey?: ScriptKey): [number, ScriptData] {
    const scriptSession = movedScriptKey == null
        ? instance.createScriptSession(connection.catalog)
        : instance.createScriptSessionWithEntryId(connection.catalog, movedScriptKey);
    const scriptKey = scriptSession.getCatalogEntryId();
    const scriptData: ScriptData = {
        scriptKey,
        scriptSession,
        editorUpdate: null,
        analysisOutdated: true,
        statistics: Immutable.List(),
        annotations: createEmptyAnnotations(),
        completion: null,
        pendingDiff: null,
        latestQueryId: null,
        latestResultQueryId: null,
        fileName,
        connection,
    };
    return [scriptKey, scriptData];
}

enum FocusUpdate {
    Clear,
    UpdateFromCursor,
    UpdateFromCompletion,
};

/// Returns the committed cells in feed order.
export function getScriptRefs(state: SessionScripts): ScriptRef[] {
    return state.scriptOrder.map(name => state.scriptRefs[name]);
}

/// Returns the currently selected cell, or the first cell when focus is unset.
export function getSelectedScriptRef(state: SessionScripts): ScriptRef | undefined {
    const file = state.scriptFocus.fileName;
    if (file && state.scriptRefs[file]) return state.scriptRefs[file];
    const files = state.scriptOrder;
    return files.length > 0 ? state.scriptRefs[files[0]] : undefined;
}

/// The script list of the session file, the cells in feed order with their connections
export function sessionScriptList(state: SessionScripts): SessionScript[] {
    return state.scriptOrder.flatMap(name => {
        const script = state.scripts[state.scriptRefs[name]?.scriptId];
        return script == null ? [] : [{ name, connectionId: persistedConnectionId(script) }];
    });
}

/// The copies of the connections that the scripts of a session use, as far as the scripts know them
export function sessionConnectionCopies(state: SessionScripts): SessionConnection[] {
    const copies = new Map<string, SessionConnection>();
    for (const script of Object.values(state.scripts)) {
        const { connectionId, params } = script.connection;
        if (params != null && !copies.has(connectionId)) copies.set(connectionId, { connectionId, params });
    }
    return [...copies.values()];
}

/// The script list of a session as the session file stores it.
/// A session without scripts holds the pending connection, the given copies list it first.
export function sessionScriptListWrite(state: SessionScripts): SessionScriptList {
    const pending = state.pendingConnection;
    const pendingCopy = state.scriptOrder.length === 0 && pending?.params != null
        ? [{ connectionId: pending.connectionId, params: pending.params }]
        : [];
    return { scripts: sessionScriptList(state), connections: [...pendingCopy, ...sessionConnectionCopies(state)] };
}

/// Persist the order and the connections of the cells, the session file follows with its connections
/// The storage of the session reducer. The registry defers the effects of a reduction until it returned: a
/// reducer that throws leaves the storage and the native objects of the previous state untouched.
export interface SessionScriptsStorage {
    /// Schedule a write
    write: StorageWriter['write'];
    /// Free native objects that the previous state still references, right away without a registry
    release?(free: () => void): void;
}

/// The effects of a session reduction, applied once it returned
export class SessionScriptsEffects implements SessionScriptsStorage {
    private readonly writes: Array<() => void> = [];
    private readonly frees: Array<() => void> = [];

    constructor(private readonly storage: StorageWriter) { }

    write(...args: Parameters<StorageWriter['write']>): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.writes.push(() => this.storage.write(...args).then(resolve, reject));
        });
    }
    release(free: () => void): void {
        this.frees.push(free);
    }
    /// Apply the effects, in the order of the reduction
    commit(): void {
        for (const write of this.writes) write();
        for (const free of this.frees) free();
        this.writes.length = 0;
        this.frees.length = 0;
    }
}

/// Free native objects of the previous state once the reduction returned
function release(storage: SessionScriptsStorage, free: () => void) {
    if (storage.release) storage.release(free);
    else free();
}

function writeSessionScriptList(state: SessionScripts, storage: SessionScriptsStorage) {
    void storage.write(
        groupSessionScriptListWrites(state.sessionId),
        { type: WRITE_SESSION_SCRIPTS, value: [state.sessionId, sessionScriptListWrite(state)] },
        DEBOUNCE_DURATION_SESSION_WRITE,
    );
}

function writeSessionProperties(state: SessionScripts, storage: SessionScriptsStorage) {
    void storage.write(
        groupSessionManifestWrites(state.sessionId),
        { type: WRITE_SESSION_PROPERTIES, value: [state.sessionId, { name: state.name, ...(isEphemeralSession(state) ? { ephemeral: true } : {}) }] },
        DEBOUNCE_DURATION_SESSION_WRITE,
    );
}

/// Promote an ephemeral session with scripts to a full session: it drops the marker and takes a free name.
/// Every path that adds a script ends here, also the commands of the agent.
export function promoteEphemeralSession(state: SessionScripts, sessions: Iterable<SessionScripts>, storage: SessionScriptsStorage): SessionScripts {
    if (!isEphemeralSession(state) || state.scriptOrder.length === 0) return state;
    const { ephemeral: _promoted, ...sessionMetadata } = state.sessionMetadata;
    const next: SessionScripts = { ...state, sessionMetadata, name: freeSessionName(takenSessionNames(sessions)) };
    writeSessionProperties(next, storage);
    return next;
}

export function reduceSessionScripts(state: SessionScripts, action: SessionScriptsAction, storage: SessionScriptsStorage, logger: Logger): SessionScripts {
    // The table parameters of the scripts read the results of the scripts, which follow every change
    return publishTableParameters(state, reduceScripts(state, action, storage, logger));
}

/// Rewrite the table parameters that read a renamed script or attachment to read `name`, in `scripts`. The references
/// are those of a plan with the names before the rename, the scripts are analyzed first if their analysis lags behind
/// their text. The script `keep` keeps its text. Returns the rewritten scripts.
function rewriteRenamedReferences(
    state: SessionScripts,
    scripts: ScriptDataMap,
    target: TableParameterTarget,
    name: string,
    keep: ScriptKey | null,
    logger: Logger,
): ScriptData[] {
    for (const [key, script] of Object.entries(scripts)) {
        if (script.editorUpdate?.textVersion !== script.scriptSession.getTextVersion()) {
            scripts[Number(key)] = analyzeScriptData(script, logger);
        }
    }
    let changes = new Map<number, ScriptTextChange[]>();
    try {
        const reports = computeScriptReferenceReports({ ...state, scripts });
        changes = renameReferenceChanges(reports, target, `:${state.instance.quoteIdentifier(name)}`);
    } catch (e: any) {
        logger.error("Failed to find the references of a renamed table parameter", { target: JSON.stringify(target), error: stringifyError(e) }, LOG_CTX);
    }
    const rewritten: ScriptData[] = [];
    for (const [key, scriptChanges] of changes) {
        const script = scripts[key];
        if (script == null || key === keep) continue;
        const fromText = script.scriptSession.getText();
        replaceScriptSessionText(script.scriptSession, applyScriptTextChanges(fromText, scriptChanges));
        const next = analyzeScriptData({ ...script, pendingDiff: null }, logger);
        next.externalChanges = { fromText, changes: scriptChanges };
        scripts[key] = next;
        rewritten.push(next);
    }
    return rewritten;
}

/// Write the scripts whose references were renamed
function writeRewrittenScripts(state: SessionScripts, rewritten: readonly ScriptData[], storage: SessionScriptsStorage): void {
    for (const script of rewritten) {
        storage.write(
            groupScriptWrites(state.sessionId, script.fileName),
            { type: WRITE_SCRIPT, value: [state.sessionId, script.fileName, script.scriptSession.getText()] },
            DEBOUNCE_DURATION_SCRIPT_WRITE
        );
    }
}

function reduceScripts(state: SessionScripts, action: SessionScriptsAction, storage: SessionScriptsStorage, logger: Logger): SessionScripts {
    switch (action.type) {
        case SET_SESSION_ATTACHMENTS: {
            const attachments = readSessionAttachments(action.value, state.attachments);
            if (state.attachments != null && sameSessionAttachments(state.attachments, attachments)) return state;
            return { ...state, attachments };
        }
        case RENAME_ATTACHMENT: {
            // The file was renamed already, the scripts that read the attachment read the new name
            const { fileName, newFileName } = action.value;
            const index = state.attachments?.findIndex(a => a.fileName === fileName) ?? -1;
            const name = attachmentParameterName(newFileName);
            if (index < 0 || name == null || fileName === newFileName) return state;
            const newScripts = { ...state.scripts };
            const rewritten = rewriteRenamedReferences(state, newScripts, { attachment: fileName }, name, null, logger);
            for (const script of rewritten) {
                markOtherScriptsOutdatedInPlace(newScripts, script);
            }
            const attachments = [...state.attachments!];
            attachments[index] = { ...attachments[index], fileName: newFileName, name };
            const next = { ...state, scripts: newScripts, attachments };
            writeRewrittenScripts(next, rewritten, storage);
            return next;
        }
        case SET_ATTACHMENT_COLUMNS: {
            const { fileName, stamp, columns } = action.value;
            const index = state.attachments?.findIndex(a => a.fileName === fileName && attachmentStamp(a) === stamp) ?? -1;
            if (index < 0) return state;
            const attachments = [...state.attachments!];
            attachments[index] = { ...attachments[index], columns };
            return { ...state, attachments };
        }
        case RENAME_SESSION: {
            const trimmed = action.value?.trim() ?? '';
            const name = trimmed.length > 0 ? trimmed : null;
            if (name === state.name) return state;
            const next = { ...state, name };
            writeSessionProperties(next, storage);
            return next;
        }
        case SELECT_NEXT_SCRIPT: {
            const files = state.scriptOrder;
            const cur = files.indexOf(state.scriptFocus.fileName);
            const nextIdx = Math.min(Math.max(cur, 0) + 1, files.length - 1);
            const fileName = files[nextIdx] ?? state.scriptFocus.fileName;
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: { ...state.scriptFocus, fileName },
            };
        }
        case SELECT_PREV_SCRIPT: {
            const files = state.scriptOrder;
            const cur = files.indexOf(state.scriptFocus.fileName);
            const prevIdx = Math.max((cur < 0 ? 0 : cur) - 1, 0);
            const fileName = files[prevIdx] ?? state.scriptFocus.fileName;
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: { ...state.scriptFocus, fileName },
            };
        }
        case SELECT_SCRIPT: {
            const fileName = action.value;
            if (!state.scriptRefs[fileName]) return state;
            // Hovering a card re-selects it constantly, keep the state (and the semantic focus) untouched.
            if (state.scriptFocus.fileName === fileName) return state;
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: { ...state.scriptFocus, fileName },
            };
        }
        case CATALOG_DID_UPDATE: {
            const scripts = { ...state.scripts };
            for (const scriptKey in scripts) {
                const prev = scripts[scriptKey];
                if (prev.connection.connectionId !== action.value) continue;
                scripts[scriptKey] = {
                    ...prev,
                    analysisOutdated: true,
                };
            }
            return {
                ...state,
                scripts
            };
        }

        case ANALYZE_OUTDATED_SCRIPT:
            return analyzeOutdatedScript(state, action.value, logger);

        case APPLY_PLANNER_ANALYSIS: {
            let scripts = state.scripts;
            const focusedScriptKey = getSelectedScriptRef(state)?.scriptId;
            let semanticUserFocus: SemanticUserFocus | null = null;
            for (const { scriptKey, editorUpdate } of action.value) {
                const prevScript = scripts[scriptKey];
                if (!prevScript ||
                    prevScript.scriptSession.getTextVersion() !== editorUpdate.textVersion ||
                    prevScript.scriptSession.getCatalogRevision() !== editorUpdate.catalogRevision ||
                    editorUpdate.status !== core.buffers.editor.EditorUpdateStatus.OK ||
                    !editorUpdate.analysisAvailable) {
                    continue;
                }
                // Cursor movement can supersede a planner snapshot without changing text or catalog.
                const nextUpdate = prevScript.scriptSession.getStateRevision() === editorUpdate.stateRevision
                    ? editorUpdate
                    : prevScript.scriptSession.analyze();
                const projectionChanged = prevScript.editorUpdate?.stateRevision !== nextUpdate.stateRevision;
                if (scripts === state.scripts) scripts = { ...scripts };
                scripts[scriptKey] = {
                    ...prevScript,
                    editorUpdate: nextUpdate,
                    analysisOutdated: false,
                    annotations: deriveScriptAnnotations(nextUpdate, prevScript.scriptSession,
                        prevScript.connection.connectorInfo.connectorType, logger),
                    statistics: editorUpdate.analysisUpdated
                        ? rotateScriptStatistics(prevScript.statistics, editorUpdate.processingStatistics)
                        : prevScript.statistics,
                    completion: projectionChanged ? null : prevScript.completion,
                };
                if (scriptKey === focusedScriptKey) {
                    semanticUserFocus = scripts[scriptKey].completion != null
                        ? deriveFocusFromCompletionCandidates(scriptKey, scripts[scriptKey])
                        : deriveFocusFromEditorUpdate(scriptKey, nextUpdate);
                }
            }
            if (scripts === state.scripts) return state;
            // Analysis is already published by the planner. Publishing again invalidates its revision.
            return {
                ...state,
                scripts,
                semanticUserFocus,
            };
        }

        case UPDATE_FROM_PROCESSOR: {
            const update = action.value;
            const prevScript = state.scripts[update.scriptKey];
            const prevFocus = state.semanticUserFocus;
            const updateSession = update.scriptSession;
            // If the script key does not refer to a value we know, we cannot keep the new script alive.
            // Drop the update.
            if (!prevScript) {
                logger.warn("Dropping editor update for unknown script", {
                    sessionId: state.sessionId,
                    scriptKey: update.scriptKey.toString(),
                    textVersion: update.editorUpdate?.textVersion.toString(),
                    stateRevision: update.editorUpdate?.stateRevision.toString(),
                }, LOG_CTX);
                return clearSemanticUserFocus(state);
            }
            if (updateSession !== prevScript.scriptSession) {
                logger.warn("Dropping editor update from stale editor session", {
                    sessionId: state.sessionId,
                    scriptKey: update.scriptKey.toString(),
                    textVersion: update.editorUpdate?.textVersion.toString(),
                    stateRevision: update.editorUpdate?.stateRevision.toString(),
                }, LOG_CTX);
                return clearSemanticUserFocus(state);
            }
            const nextCursorContext = update.editorUpdate?.primaryCursorContext;
            const documentChanged = prevScript.editorUpdate?.textVersion !== update.editorUpdate?.textVersion;
            const analysisRefreshed = update.editorUpdate?.analysisUpdated === true;
            const projectionChanged = prevScript.editorUpdate?.stateRevision !== update.editorUpdate?.stateRevision;
            logger.debug("Applying editor processor update", {
                sessionId: state.sessionId,
                scriptKey: update.scriptKey.toString(),
                documentChanged: documentChanged.toString(),
                analysisRefreshed: analysisRefreshed.toString(),
                projectionChanged: projectionChanged.toString(),
                previousTextVersion: prevScript.editorUpdate?.textVersion.toString(),
                textVersion: update.editorUpdate?.textVersion.toString(),
                previousStateRevision: prevScript.editorUpdate?.stateRevision.toString(),
                stateRevision: update.editorUpdate?.stateRevision.toString(),
                cursorOffset: update.editorUpdate?.primaryCursorState?.textOffset?.toString(),
            }, LOG_CTX);
            let focusUpdate: FocusUpdate | null = null;
            if (projectionChanged) {
                focusUpdate = FocusUpdate.Clear;
            }
            // Did the completion change?
            if (update.scriptCompletion) {
                if (update.scriptCompletion.buffer !== prevScript.completion?.buffer) {
                    focusUpdate = FocusUpdate.UpdateFromCompletion;
                } else {
                    // Did the completion index change?
                    if (update.scriptCompletion.candidateId !== prevScript.completion?.candidateId) {
                        focusUpdate = FocusUpdate.UpdateFromCompletion;
                    }
                }
            }
            if (projectionChanged) {
                focusUpdate = update.scriptCompletion != null
                    ? FocusUpdate.UpdateFromCompletion
                    : nextCursorContext != null
                        ? FocusUpdate.UpdateFromCursor
                        : FocusUpdate.Clear;
            }
            const nextScript: ScriptData = {
                ...prevScript,
                analysisOutdated: false,
                completion: update.scriptCompletion,
                pendingDiff: update.scriptPendingDiff,
                editorUpdate: update.editorUpdate ?? prevScript.editorUpdate,
                statistics: update.editorUpdate?.analysisUpdated
                    ? rotateScriptStatistics(prevScript.statistics, update.editorUpdate.processingStatistics)
                    : prevScript.statistics,
            };
            // Publishing declarations equal to the published ones keeps the catalog revision
            let catalogChanged = false;
            if (documentChanged || analysisRefreshed) {
                nextScript.annotations = deriveScriptAnnotations(update.editorUpdate, updateSession,
                    prevScript.connection.connectorInfo.connectorType, logger);
                const catalogRevision = updateSession.getCatalogRevision();
                updateSession.loadIntoCatalog();
                catalogChanged = updateSession.getCatalogRevision() !== catalogRevision;
            }
            // Update semantic user focus
            let semanticUserFocus: SemanticUserFocus | null = prevFocus;
            switch (focusUpdate) {
                case FocusUpdate.Clear:
                    semanticUserFocus = null;
                    break;
                case FocusUpdate.UpdateFromCursor:
                    semanticUserFocus = deriveFocusFromEditorUpdate(update.scriptKey, nextScript.editorUpdate);
                    break;
                case FocusUpdate.UpdateFromCompletion:
                    semanticUserFocus = deriveFocusFromCompletionCandidates(update.scriptKey, nextScript);
                    break;
            }
            let nextState: SessionScripts = {
                ...state,
                scripts: {
                    ...state.scripts,
                    [update.scriptKey]: nextScript
                },
                semanticUserFocus,
            };

            // Mark the other scripts of the catalog as outdated when the published declarations changed.
            // Eventually, we could restrict to those that are depending?
            if (catalogChanged) {
                markOtherScriptsOutdatedInPlace(nextState.scripts, nextScript);
            }
            // Persist only when the document text changed. Cursor/completion updates
            // still flow through this action but must not rewrite identical SQL.
            if (documentChanged) {
                const scriptKey = update.scriptKey;
                const scriptData = nextState.scripts[scriptKey];
                if (scriptData?.fileName) {
                    const sql = scriptData.scriptSession.getText();
                    storage.write(
                        groupScriptWrites(nextState.sessionId, scriptData.fileName),
                        { type: WRITE_SCRIPT, value: [nextState.sessionId, scriptData.fileName, sql] },
                        DEBOUNCE_DURATION_SCRIPT_WRITE
                    );
                }
            }
            return nextState;
        }

        case REGISTER_QUERY: {
            const [scriptKey, queryId] = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) {
                logger.warn("Orphan query references invalid script", {
                    scriptKey: scriptKey.toString(),
                    queryId: queryId.toString(),
                }, LOG_CTX);
                return state;
            } else {
                const next = { ...state, scripts: { ...state.scripts } };
                next.scripts[scriptKey] = {
                    ...scriptData,
                    latestQueryId: queryId,
                    latestResultQueryId: scriptData.latestResultQueryId === undefined
                        ? scriptData.latestQueryId : scriptData.latestResultQueryId,
                };
                return next;
            }
        }

        case SET_SCRIPT_EXECUTION_VISUALIZATION: {
            const [scriptKey, visualizeQuery] = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) return state;
            return {
                ...state,
                scripts: {
                    ...state.scripts,
                    [scriptKey]: {
                        ...scriptData,
                        annotations: { ...scriptData.annotations, visualizeQuery },
                    },
                },
            };
        }

        case REGISTER_SCRIPT_RESULT: {
            const [scriptKey, queryId] = action.value;
            const scriptData = state.scripts[scriptKey];
            // Query ids are monotonic; an older overlapping execution must not replace a newer result.
            if (!scriptData || (scriptData.latestResultQueryId != null && scriptData.latestResultQueryId >= queryId)) {
                return state;
            }
            return {
                ...state,
                scripts: {
                    ...state.scripts,
                    [scriptKey]: { ...scriptData, latestResultQueryId: queryId },
                },
            };
        }

        case DELETE_SCRIPT: {
            const deletedFileName = action.value;
            const deletedEntry = state.scriptRefs[deletedFileName];
            if (!deletedEntry) return state;
            const remainingFiles = state.scriptOrder.filter(name => name !== deletedFileName);
            const scriptRefs = { ...state.scriptRefs };
            delete scriptRefs[deletedFileName];

            // Adjust focus if needed
            let newFile = state.scriptFocus.fileName;
            if (newFile === deletedFileName) {
                const oldIdx = state.scriptOrder.indexOf(deletedFileName);
                newFile = remainingFiles[Math.max(0, oldIdx - 1)] ?? remainingFiles[0] ?? '';
            }

            // A session without scripts keeps the connection of its last script for the next one
            const deletedScript = state.scripts[deletedEntry.scriptId];
            const pendingConnection = remainingFiles.length === 0
                ? state.pendingConnection ?? deletedScript?.connection ?? null
                : state.pendingConnection;
            const next = destroyDeadScripts(storage, {
                ...clearSemanticUserFocus(state),
                pendingConnection,
                scriptRefs,
                scriptOrder: remainingFiles,
                scriptFocus: { ...state.scriptFocus, fileName: newFile },
            });
            storage.write(
                groupScriptDeletes(next.sessionId, deletedEntry.fileName),
                { type: STORAGE_DELETE_SCRIPT, value: [next.sessionId, deletedEntry.fileName] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
            writeSessionScriptList(next, storage);
            return next;
        }

        case CREATE_SCRIPT: {
            // Null appends; an index inserts at that feed boundary. Text seeds the new script, e.g. from the composer.
            const { index, text, connection } = action.value;
            // A script takes no name of an attachment, the table parameter would be ambiguous
            const fileName = generateScriptFileName(state.scriptRefs, undefined, attachmentNames(state.attachments));

            // Create a new script on the given connection, otherwise on the connection of its neighbors
            const scriptConnection = connection ?? newScriptConnection(state, index);
            if (scriptConnection == null) {
                logger.warn("CREATE_SCRIPT misses a connection", { sessionId: state.sessionId }, LOG_CTX);
                return state;
            }
            let [scriptKey, scriptData] = createEmptyScriptData(state.instance, scriptConnection, fileName);
            const scripts: ScriptDataMap = { ...state.scripts };
            if (text) {
                // Analyze right away so the script can be executed without waiting for an editor,
                // and mark the others outdated since the new script was loaded into the catalog.
                replaceScriptSessionText(scriptData.scriptSession, text);
                scriptData = analyzeScriptData(scriptData, logger);
                markOtherScriptsOutdatedInPlace(scripts, scriptData);
            }
            scripts[scriptKey] = scriptData;

            const scriptOrder = [...state.scriptOrder];
            const insertAt = index == null ? scriptOrder.length : Math.max(0, Math.min(Math.trunc(index), scriptOrder.length));
            scriptOrder.splice(insertAt, 0, fileName);

            const next: SessionScripts = {
                ...clearSemanticUserFocus(state),
                // The pending connection is taken by the script that runs on it
                pendingConnection: state.pendingConnection?.connectionId === scriptConnection.connectionId ? null : state.pendingConnection,
                scripts,
                scriptRefs: { ...state.scriptRefs, [fileName]: createScriptRef(scriptKey, fileName) },
                scriptOrder,
                scriptFocus: { ...state.scriptFocus, fileName },
            };
            storage.write(
                groupScriptWrites(next.sessionId, fileName),
                { type: WRITE_SCRIPT, value: [next.sessionId, fileName, text ?? ''] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
            writeSessionScriptList(next, storage);
            return next;
        }

        case RENAME_SCRIPT: {
            const { fileName: oldFileName, newFileName: requestedName } = action.value;
            const entry = state.scriptRefs[oldFileName];
            if (!entry) {
                logger.warn("RENAME_SCRIPT references invalid script", {
                    fileName: oldFileName,
                }, LOG_CTX);
                return state;
            }
            // The rename input edits the display name. Drop a ".sql" the user included, disambiguate
            // the name against the other scripts and attach the ".sql" extension. An empty name and a
            // name that is not a plain file name are ignored.
            const requestedBase = scriptDisplayName(requestedName.trim());
            if (!requestedBase || /[/\\\0]/.test(requestedBase)) {
                return state;
            }
            const cleanBase = uniqueScriptBase(requestedBase, state.scriptRefs, oldFileName, attachmentNames(state.attachments));
            const newFileName = `${cleanBase}.sql`;
            const renamed = oldFileName !== newFileName;
            const renamedEntry: ScriptRef = { ...entry, fileName: newFileName };
            const scriptRefs = { ...state.scriptRefs };
            if (renamed) delete scriptRefs[oldFileName];
            scriptRefs[newFileName] = renamedEntry;
            const scriptOrder = state.scriptOrder.map(name => name === oldFileName ? newFileName : name);

            // Update the script data fileName and re-analyze immediately with the new path.
            const scriptId = entry.scriptId;
            const updatedScriptData = state.scripts[scriptId];
            const newScripts = { ...state.scripts };
            // The scripts that reference the script read the new name. A script that references itself is a cycle, it
            // keeps the name.
            const rewritten = renamed
                ? rewriteRenamedReferences(state, newScripts, { script: oldFileName }, cleanBase, scriptId, logger)
                : [];
            if (newScripts[scriptId]) {
                const renamedScriptData: ScriptData = { ...newScripts[scriptId], fileName: newFileName };
                if (renamed) {
                    newScripts[scriptId] = analyzeScriptData(renamedScriptData, logger);
                    markOtherScriptsOutdatedInPlace(newScripts, renamedScriptData);
                } else {
                    newScripts[scriptId] = renamedScriptData;
                }
            }
            for (const script of rewritten) {
                markOtherScriptsOutdatedInPlace(newScripts, script);
            }

            // Keep focus on this script across the rename
            const focusFile = state.scriptFocus.fileName === oldFileName
                ? newFileName
                : state.scriptFocus.fileName;

            const next = {
                ...(renamed ? clearSemanticUserFocus(state) : state),
                scriptRefs,
                scriptOrder,
                scripts: newScripts,
                scriptFocus: { ...state.scriptFocus, fileName: focusFile },
            };
            writeRewrittenScripts(next, rewritten, storage);
            if (renamed) {
                // Rename the file in place: its SQL is unchanged, so move it rather than delete-old +
                // rewrite-new. The new clean base is disambiguated unique within the page, so the
                // rename target never collides with another script's existing name.
                storage.write(
                    groupScriptRenames(next.sessionId, oldFileName),
                    { type: STORAGE_RENAME_SCRIPT, value: [next.sessionId, oldFileName, newFileName] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
                writeSessionScriptList(next, storage);
            } else {
                // No rename: just persist the current contents under the unchanged name.
                const sql = updatedScriptData ? updatedScriptData.scriptSession.getText() : '';
                storage.write(
                    groupScriptWrites(next.sessionId, newFileName),
                    { type: WRITE_SCRIPT, value: [next.sessionId, newFileName, sql] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            }
            return next;
        }

        case REORDER_SCRIPTS: {
            const requestedOrder = action.value;

            // Build the target order: the requested files (that still exist, de-duplicated), then any
            // files the caller omitted, appended in their current feed order so none are dropped.
            const seen = new Set<string>();
            const order: string[] = [];
            for (const file of requestedOrder) {
                if (state.scriptRefs[file] && !seen.has(file)) {
                    seen.add(file);
                    order.push(file);
                }
            }
            const currentOrder = state.scriptOrder;
            for (const file of currentOrder) {
                if (!seen.has(file)) {
                    seen.add(file);
                    order.push(file);
                }
            }

            // Same order as the current feed → change nothing (don't churn the disk).
            if (order.length === currentOrder.length && order.every((f, i) => f === currentOrder[i])) {
                return state;
            }
            // The order lives in the session file, the script files stay untouched
            const next: SessionScripts = { ...state, scriptOrder: order };
            writeSessionScriptList(next, storage);
            return next;
        }

        case SET_SCRIPT_CONNECTION: {
            const { fileName, connection } = action.value;
            const entry = state.scriptRefs[fileName];
            const prev = entry == null ? undefined : state.scripts[entry.scriptId];
            if (!prev) {
                logger.warn("SET_SCRIPT_CONNECTION references invalid script", { fileName }, LOG_CTX);
                return state;
            }
            if (prev.connection.connectionId === connection.connectionId) {
                if (prev.unresolvedConnectionId == null) return state;
                // Picking the connection the script runs on replaces the unresolved reference
                const next: SessionScripts = {
                    ...state,
                    scripts: { ...state.scripts, [prev.scriptKey]: { ...prev, unresolvedConnectionId: undefined } },
                };
                writeSessionScriptList(next, storage);
                return next;
            }
            // A script session belongs to one catalog, the script moves into a new script session under
            // its key. The new session is created first, a failure leaves the script untouched.
            let moved: [number, ScriptData];
            try {
                moved = moveScriptData(storage, state.instance, prev, connection);
            } catch (e: any) {
                logger.warn("Failed to move script to another connection", { fileName, error: stringifyError(e) }, LOG_CTX);
                return state;
            }
            let [scriptKey, scriptData] = moved;
            scriptData = analyzeScriptData(scriptData, logger);
            const scripts: ScriptDataMap = { ...state.scripts };
            // The scripts of both catalogs may have referenced the moved script
            markOtherScriptsOutdatedInPlace(scripts, prev);
            markOtherScriptsOutdatedInPlace(scripts, scriptData);
            scripts[scriptKey] = scriptData;
            const next: SessionScripts = {
                ...clearSemanticUserFocus(state),
                scripts,
            };
            writeSessionScriptList(next, storage);
            return next;
        }

        case SET_PENDING_CONNECTION: {
            // The next appended script runs on the connection, the scripts keep theirs
            const connection = action.value;
            if (connection.connectionId === state.pendingConnection?.connectionId) return state;
            if (connection.params == null) {
                logger.warn("SET_PENDING_CONNECTION misses the params of the connection", { connectionId: connection.connectionId }, LOG_CTX);
                return state;
            }
            const next: SessionScripts = { ...state, pendingConnection: connection };
            // A session without scripts holds the connection in its session file
            if (state.scriptOrder.length === 0) writeSessionScriptList(next, storage);
            return next;
        }

        case DETACH_CONNECTION: {
            // A session lets go of a connection that only its next script would use. A session without
            // scripts then holds the other connection.
            const { from, into } = action.value;
            if (state.pendingConnection?.connectionId !== from || scriptsOnConnection(state, from) > 0) return state;
            if (state.scriptOrder.length > 0) return { ...state, pendingConnection: null };
            return reduceSessionScripts({ ...state, pendingConnection: null }, { type: SET_PENDING_CONNECTION, value: into }, storage, logger);
        }

        case REPLACE_CONNECTION: {
            const { from, into } = action.value;
            const target = scriptConnectionOf(into);
            const scripts: ScriptDataMap = { ...state.scripts };
            let moved = 0;
            for (const prev of Object.values(state.scripts)) {
                if (prev.connection.connectionId !== from) continue;
                try {
                    const [scriptKey, scriptData] = moveScriptData(storage, state.instance, prev, target);
                    scripts[scriptKey] = scriptData;
                    moved += 1;
                } catch (e: any) {
                    // The script stays on the replaced connection, it is not removed then
                    logger.warn("Failed to move script to the replacing connection", { fileName: prev.fileName, error: stringifyError(e) }, LOG_CTX);
                }
            }
            const movesPending = state.pendingConnection?.connectionId === from;
            if (moved === 0 && !movesPending) return state;
            // The moved scripts analyze lazily, the scripts of the target catalog may reference them
            for (const key in scripts) {
                const script = scripts[key];
                if (script.analysisOutdated || script.connection.catalog !== target.catalog) continue;
                scripts[key] = { ...script, analysisOutdated: true };
            }
            const next: SessionScripts = {
                ...clearSemanticUserFocus(state),
                ...(movesPending ? { pendingConnection: target } : {}),
                scripts,
            };
            // The references of the session file follow. The script list is written as well, it replaces
            // a pending list that still names the replaced connection.
            void storage.write(
                groupSessionConnectionCopyWrites(state.sessionId, from),
                { type: PATCH_SESSION_CONNECTION, value: [state.sessionId, { connectionId: into.connectionId, params: into.params }, [from]] },
                DEBOUNCE_DURATION_SESSION_WRITE,
            );
            writeSessionScriptList(next, storage);
            return next;
        }

        case SET_SCRIPT_TEXT: {
            const { scriptKey, text, withDiff } = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) {
                logger.warn("SET_SCRIPT_TEXT references invalid script", { scriptKey: scriptKey.toString() }, LOG_CTX);
                return state;
            }
            // Compute a staged diff against the prior text *before* we overwrite it (a genuine text
            // change is required — an unchanged rewrite produces no overlay). The prior script still
            // holds the old text here; diff it against a throwaway target seeded with the new text.
            // A rewrite of a script with a staged diff restages it against the text before the staged
            // diff, so that rejecting it reverts both. A rewrite back to that text drops the diff.
            const currentText = scriptData.scriptSession.getText();
            const priorText = withDiff ? scriptData.pendingDiff?.priorText ?? currentText : currentText;
            let pendingDiff: DashQLPendingDiff | null = null;
            if (withDiff && text !== priorText) {
                if (priorText !== currentText) {
                    replaceScriptSessionText(scriptData.scriptSession, priorText);
                }
                pendingDiff = computePendingDiff(state.instance, scriptData.scriptSession, text, priorText, logger);
            }
            // Rewrite the script text in-place
            replaceScriptSessionText(scriptData.scriptSession, text);
            // Re-analyze through the path-aware helper (destroys the stale buffers, refreshes
            // buffers + annotations incl. visualizeQuery, reloads the script into the catalog)
            const nextScriptData = analyzeScriptData(scriptData, logger);
            nextScriptData.pendingDiff = pendingDiff;

            const nextState: SessionScripts = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [scriptKey]: nextScriptData,
                },
            };
            // The text changed and was reloaded into the catalog; mark the other scripts of the
            // catalog outdated so cross-script references re-resolve (mirrors UPDATE_FROM_PROCESSOR).
            markOtherScriptsOutdatedInPlace(nextState.scripts, nextScriptData);

            // Persist only the updated script (same tail as UPDATE_FROM_PROCESSOR)
            const sql = nextScriptData.scriptSession.getText();
            if (nextScriptData.fileName) {
                storage.write(
                    groupScriptWrites(nextState.sessionId, nextScriptData.fileName),
                    { type: WRITE_SCRIPT, value: [nextState.sessionId, nextScriptData.fileName, sql] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            }
            return nextState;
        }

        case SET_SESSION_INPUT: {
            // The value of an input is the `@param :name = <literal>` tag of every script that uses it. The tags are
            // rewritten as changes, a mounted editor keeps its cursor and undoes them as one step.
            const { name, literal, scriptKeys } = action.value;
            const scripts = { ...state.scripts };
            const rewritten: ScriptData[] = [];
            for (const scriptKey of scriptKeys) {
                const script = scripts[scriptKey];
                if (script == null) continue;
                const fromText = script.scriptSession.getText();
                let text: string;
                try {
                    text = script.scriptSession.rewriteParamTag(name, literal);
                } catch (e: any) {
                    logger.warn("Cannot write the value of an input", { input: name, fileName: script.fileName, error: stringifyError(e) }, LOG_CTX);
                    continue;
                }
                if (text === fromText) continue;
                replaceScriptSessionText(script.scriptSession, text);
                const next = analyzeScriptData({ ...script, pendingDiff: null }, logger);
                next.externalChanges = { fromText, changes: [textChange(fromText, text)] };
                scripts[scriptKey] = next;
                rewritten.push(next);
            }
            if (rewritten.length === 0) return state;
            for (const script of rewritten) {
                markOtherScriptsOutdatedInPlace(scripts, script);
            }
            const next = { ...state, scripts };
            for (const script of rewritten) {
                if (!script.fileName) continue;
                storage.write(
                    groupScriptWrites(next.sessionId, script.fileName),
                    { type: WRITE_SCRIPT, value: [next.sessionId, script.fileName, script.scriptSession.getText()] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            }
            return next;
        }

        case SET_SCRIPT_VIS_SPEC: {
            // Rewrite the `@vis vegalite` tag of the charted statement and stage the rewrite as a diff to accept or
            // reject, like a formatting. The rewrite keeps the other tags, e.g. `@board`.
            // The chart builder sends every edit, each one restages the diff against the text before the first edit,
            // so the script shows the whole chart edit as one diff, including the starter chart of a new board card.
            const { scriptKey, spec } = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) {
                logger.warn("SET_SCRIPT_VIS_SPEC references invalid script", { scriptKey: scriptKey.toString() }, LOG_CTX);
                return state;
            }
            const scriptSession = scriptData.scriptSession;
            const currentText = scriptSession.getText();
            const priorText = scriptData.pendingDiff?.priorText ?? currentText;
            let text: string | null = null;
            try {
                // The diff is computed against the text of the session, rewrite the text before the first edit
                if (priorText !== currentText) {
                    replaceScriptSessionText(scriptSession, priorText);
                }
                const statementId = chartStatementId(scriptSession);
                if (statementId == null) {
                    logger.warn("SET_SCRIPT_VIS_SPEC found no statement to chart", { scriptKey: scriptKey.toString() }, LOG_CTX);
                } else {
                    text = scriptSession.rewriteVisRenderer(statementId, 'vegalite', spec);
                }
            } catch (e: unknown) {
                logger.warn("SET_SCRIPT_VIS_SPEC failed to rewrite the chart tag", { scriptKey: scriptKey.toString(), error: String(e) }, LOG_CTX);
            }
            if (text == null || text === currentText) {
                // Leave the script as it is
                if (scriptSession.getText() !== currentText) {
                    replaceScriptSessionText(scriptSession, currentText);
                }
                return state;
            }
            // A spec that restores the chart before the first edit drops the diff
            return reduceSessionScripts(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text, withDiff: true } }, storage, logger);
        }

        case ACCEPT_PENDING_DIFF: {
            // Keep the current (new) text — SET_SCRIPT_TEXT already applied and persisted it — and
            // just drop the staged diff. Mirrors the editor's DashQLDiffAcceptEffect path, which
            // clears scriptPendingDiff without touching the rope.
            const scriptKey = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData || scriptData.pendingDiff == null) {
                return state;
            }
            return {
                ...state,
                scripts: {
                    ...state.scripts,
                    [scriptKey]: { ...scriptData, pendingDiff: null },
                },
            };
        }

        case REJECT_PENDING_DIFF: {
            // Restore the verbatim prior text and drop the staged diff. This reproduces the
            // editor's DashQLDiffRejectEffect path (restore priorText + clear) via the same tail as
            // SET_SCRIPT_TEXT, so a diff rejected from the feed and one rejected from the Details
            // editor leave identical session scripts state.
            const scriptKey = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData || scriptData.pendingDiff == null) {
                return state;
            }
            const priorText = scriptData.pendingDiff.priorText;
            // Rewrite the script text in-place and re-analyze through the path-aware helper.
            replaceScriptSessionText(scriptData.scriptSession, priorText);
            const nextScriptData = analyzeScriptData(scriptData, logger);
            nextScriptData.pendingDiff = null;

            const nextState: SessionScripts = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [scriptKey]: nextScriptData,
                },
            };
            // The text changed and was reloaded into the catalog; mark the other scripts of the
            // catalog outdated so cross-script references re-resolve (mirrors SET_SCRIPT_TEXT).
            markOtherScriptsOutdatedInPlace(nextState.scripts, nextScriptData);

            // Persist only the updated script (same tail as SET_SCRIPT_TEXT)
            const sql = nextScriptData.scriptSession.getText();
            if (nextScriptData.fileName) {
                storage.write(
                    groupScriptWrites(nextState.sessionId, nextScriptData.fileName),
                    { type: WRITE_SCRIPT, value: [nextState.sessionId, nextScriptData.fileName, sql] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            }
            return nextState;
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

export function clearSemanticUserFocus<V extends SessionScripts>(state: V): V {
    return { ...state, semanticUserFocus: null };
}

/// Mark the other scripts in the catalog of a script as outdated in a scripts map that the caller
/// already owns. Scripts in other catalogs can't reference the script.
///
/// Scripts that are already outdated keep their identity.
/// This runs for every keystroke and every new ScriptData object re-renders its editor and card.
function markOtherScriptsOutdatedInPlace(scripts: ScriptDataMap, changed: ScriptData) {
    for (const key in scripts) {
        if (+key === changed.scriptKey) continue;
        const script = scripts[key];
        if (script.analysisOutdated || script.connection.catalog !== changed.connection.catalog) continue;
        scripts[key] = {
            ...script,
            analysisOutdated: true,
        };
    }
}
function destroyScriptData(data: ScriptData) {
    data.scriptSession.destroy();
}

/// Drop a script from its catalog and destroy it
function dropScriptData(data: ScriptData) {
    try {
        data.scriptSession.dropFromCatalog();
    } catch {
        // The script may not have completed analysis and therefore may not be in the catalog.
    }
    destroyScriptData(data);
}

/// Move a script to another connection, the previous script data is dropped once the reduction returned.
/// A failure leaves the previous script data untouched.
function moveScriptData(storage: SessionScriptsStorage, instance: core.DashQL, prev: ScriptData, connection: ScriptConnection): [number, ScriptData] {
    const moved = createMovedScriptData(instance, prev, connection);
    release(storage, () => dropScriptData(prev));
    return moved;
}

/// Create the script data of a script that moves to another connection. The script keeps its key,
/// its text and its results, the caller drops the previous script data afterwards.
function createMovedScriptData(instance: core.DashQL, prev: ScriptData, connection: ScriptConnection): [number, ScriptData] {
    const [scriptKey, scriptData] = createEmptyScriptData(instance, connection, prev.fileName, prev.scriptKey);
    try {
        replaceScriptSessionText(scriptData.scriptSession, prev.scriptSession.getText());
    } catch (e) {
        destroyScriptData(scriptData);
        throw e;
    }
    return [scriptKey, { ...scriptData, latestQueryId: prev.latestQueryId, latestResultQueryId: prev.latestResultQueryId }];
}

export function destroySessionScripts(state: SessionScripts): SessionScripts {
    // Drop the session-owned scripts from the connection catalog.
    for (const scriptData of Object.values(state.scripts)) {
        scriptData.scriptSession.dropFromCatalog();
    }
    // Destroy all the script data
    for (const key in state.scripts) {
        const script = state.scripts[key];
        destroyScriptData(script);
    }
    dropSessionTableParameters(state.sessionId);
    void unmountSessionAttachments(state.sessionId);
    return state;
}

/// Replace persisted session content without scheduling writes back to storage.
///
/// Scripts that remain at the same file path on the same connection retain their WASM identity,
/// query history and UI references. A script that moved to another connection gets a new script
/// session in the catalog of that connection. Added and removed paths allocate/free their WASM state
/// here, where the catalog and script-registry lifetime rules are already centralized.
///
/// Every new script session is created before anything of the current state is changed or freed, a
/// failure leaves the current state intact.
export function replaceSessionScriptsFromStorage(
    state: SessionScripts,
    snapshot: SessionScriptsStorageSnapshot,
    _logger: Logger,
): SessionScripts {
    const existingByPath = new Map<string, ScriptData>();
    for (const script of Object.values(state.scripts)) {
        if (script.fileName) {
            existingByPath.set(script.fileName, script);
        }
    }

    // Phase 1: create the script sessions of added and moved scripts, nothing is freed yet
    const stored = snapshot.scripts.filter((entry, i) => snapshot.scripts.findIndex(other => other.name === entry.name) === i);
    const created = new Map<string, ScriptData>();
    try {
        for (const entry of stored) {
            const existing = existingByPath.get(entry.name);
            if (existing != null && existing.connection.connectionId === entry.connection.connectionId) continue;
            // A script that moved to another connection keeps its key and its results
            const [, scriptData] = existing != null
                ? createMovedScriptData(state.instance, existing, entry.connection)
                : createEmptyScriptData(state.instance, entry.connection, entry.name);
            created.set(entry.name, scriptData);
            replaceScriptSessionText(scriptData.scriptSession, entry.sql);
        }
    } catch (e) {
        for (const scriptData of created.values()) destroyScriptData(scriptData);
        throw e;
    }

    // Phase 2: update the scripts that stay and free the replaced and removed ones
    const scripts: ScriptDataMap = {};
    const scriptRefs: { [fileName: string]: ScriptRef } = {};
    const scriptOrder: string[] = [];
    let contentChanged = false;
    for (const entry of stored) {
        const existing = existingByPath.get(entry.name);
        existingByPath.delete(entry.name);
        let scriptData = created.get(entry.name);
        if (scriptData != null) {
            if (existing != null) dropScriptData(existing);
            contentChanged = true;
        } else {
            scriptData = existing!;
            if (scriptData.scriptSession.getText() !== entry.sql) {
                replaceScriptSessionText(scriptData.scriptSession, entry.sql);
                scriptData = {
                    ...scriptData,
                    pendingDiff: null,
                    completion: null,
                    analysisOutdated: true,
                };
                contentChanged = true;
            }
        }
        if (scriptData.unresolvedConnectionId !== entry.unresolvedConnectionId) {
            scriptData = { ...scriptData, unresolvedConnectionId: entry.unresolvedConnectionId };
        }
        scripts[scriptData.scriptKey] = scriptData;
        scriptRefs[entry.name] = createScriptRef(scriptData.scriptKey, entry.name);
        scriptOrder.push(entry.name);
    }

    // Files no longer present on disk own WASM objects that must be detached before destruction.
    for (const removed of existingByPath.values()) {
        dropScriptData(removed);
        contentChanged = true;
    }

    const previousFile = state.scriptFocus.fileName;
    const fileName = scriptRefs[previousFile] ? previousFile : (scriptOrder[0] ?? '');

    let next: SessionScripts = {
        ...clearSemanticUserFocus(state),
        scripts,
        scriptRefs,
        scriptOrder,
        scriptFocus: {
            ...state.scriptFocus,
            fileName,
        },
    };

    if (contentChanged) {
        // Cross-script references can be affected by any add/remove/content change.
        // Invalidate the session and let each script reanalyze at its next explicit use.
        for (const key in next.scripts) {
            next.scripts[key] = {
                ...next.scripts[key],
                analysisOutdated: true,
            };
        }
    }
    return next;
}

/// Drop the scripts that no file refers to anymore, once the reduction returned
function destroyDeadScripts(storage: SessionScriptsStorage, state: SessionScripts): SessionScripts {
    // Determine script liveness from the committed cell collection.
    let deadScripts = new Map<number, ScriptData>();
    for (const key in state.scripts) {
        deadScripts.set(+key, state.scripts[key]);
    }
    for (const ref of Object.values(state.scriptRefs)) {
        deadScripts.delete(ref.scriptId);
    }
    // Nothing to cleanup?
    if (deadScripts.size == 0) {
        return state;
    }
    // Copy scripts
    const cleanedScripts: ScriptDataMap = { ...state.scripts };
    // Delete scripts
    for (const [k, v] of deadScripts) {
        release(storage, () => {
            v.scriptSession.dropFromCatalog();
            destroyScriptData(v);
        });
        delete cleanedScripts[k];
    }
    // The remaining scripts of their catalogs may have referenced their declarations
    for (const v of deadScripts.values()) {
        markOtherScriptsOutdatedInPlace(cleanedScripts, v);
    }
    return { ...state, scripts: cleanedScripts };
}

export function rotateScriptStatistics(
    log: Immutable.List<core.buffers.editor.EditorProcessingStatisticsT>,
    stats: core.buffers.editor.EditorProcessingStatisticsT | null,
) {
    if (stats == null) {
        return log;
    } else {
        return log.withMutations(m => {
            m.push(stats);
            if (m.size > STATS_HISTORY_LIMIT) {
                m.shift();
            }
        });
    }
}

function deriveScriptAnnotations(
    update: core.buffers.editor.EditorUpdateT | null | undefined,
    scriptSession: core.DashQLScriptSession,
    connectorType: ConnectorType,
    logger?: LoggerLike,
): ScriptAnnotations {
    if (!update?.analysisAvailable) {
        return createEmptyAnnotations();
    }
    const tableDefsFlat = update.scriptAnnotations?.tableDefinitions
        .map(table => typeof table.name === 'string' ? table.name : null)
        .filter((name): name is string => name != null)
        .sort() ?? [];

    const visualizeQuery = compileVisualizeQuery(scriptSession, connectorType, logger);

    const flow = update.scriptAnnotations?.flowPosition;
    const board = update.scriptAnnotations?.boardPosition;
    const lastStatement = (update.scriptAnnotations?.statements ?? [])
        .reduce<core.buffers.editor.EditorStatementT | null>((last, statement) => last == null || statement.statementId > last.statementId ? statement : last, null);
    return {
        tableDefs: tableDefsFlat,
        visualizeQuery,
        flowPosition: flow != null
            ? { statementId: flow.statementId, x: flow.x, y: flow.y, width: flow.width, height: flow.height }
            : null,
        boardPosition: board != null
            ? { statementId: board.statementId, row: board.row, column: board.column, width: board.width, height: board.height }
            : null,
        lastStatementIsQuery: lastStatement?.statementType === core.buffers.parser.StatementType.SELECT,
        manual: update.scriptAnnotations?.manual ?? false,
    };
}

/// Compute a staged, statement-level semantic diff from a script's prior text to a new text.
///
/// `sourceSession` still holds the old text and analysis. The new text is loaded into a throwaway
/// target script created in a fresh catalog so it
/// never touches the session's catalog. Returns null (and logs) on any failure, so a diff problem
/// never blocks applying the rewrite. The returned FlatBufferPtr is owned by the caller (stored on
/// ScriptData.pendingDiff, freed when the diff is superseded, accepted/rejected, or the script is
/// destroyed).
function computePendingDiff(
    instance: core.DashQL,
    sourceSession: core.DashQLScriptSession,
    newText: string,
    priorText: string,
    logger: Logger,
): DashQLPendingDiff | null {
    let targetCatalog: core.DashQLCatalog | null = null;
    let targetScript: core.DashQLScript | null = null;
    try {
        // Ensure the source session is parsed (the diff walks the parsed AST).
        const analysis = sourceSession.analyze();
        if (analysis.status !== core.buffers.editor.EditorUpdateStatus.OK || !analysis.analysisAvailable) {
            throw new Error('Failed to analyze source script for diff');
        }
        // Seed a throwaway target with the new text in its own catalog (kept out of the session's).
        targetCatalog = instance.createCatalog();
        targetScript = instance.createScript(targetCatalog);
        targetScript.insertTextAt(0, newText);
        targetScript.parse();
        const diffBuffer = sourceSession.computeDiff(targetScript);
        return { priorText, diffBuffer };
    } catch (e: any) {
        logger.warn("Failed to compute script diff", { error: stringifyError(e) }, LOG_CTX);
        return null;
    } finally {
        targetScript?.destroy();
        targetCatalog?.destroy();
    }
}

/// Analyze a script and publish it into the catalog of its connection.
///
/// A failed analysis is kept on the script (an update without available analysis) instead of thrown, a
/// throw inside a reducer would drop the whole action. The script is not outdated afterwards: analyzing
/// the same text against the same catalog fails again, and a change of either marks it outdated.
export function analyzeScriptData(scriptData: ScriptData, logger: Logger): ScriptData {
    const next: ScriptData = { ...scriptData };

    // Analyze the script
    const update = next.scriptSession.analyze();
    next.analysisOutdated = false;
    next.editorUpdate = update;
    if (update.status !== core.buffers.editor.EditorUpdateStatus.OK || !update.analysisAvailable) {
        logger.error("Failed to analyze script", {
            scriptKey: next.scriptKey.toString(),
            status: core.buffers.editor.EditorUpdateStatus[update.status] ?? update.status.toString(),
            message: typeof update.statusMessage === 'string' ? update.statusMessage : '',
        }, LOG_CTX);
        return next;
    }
    // Rotate the script statistics
    if (update.analysisUpdated) {
        next.statistics = rotateScriptStatistics(next.statistics, update.processingStatistics);
    }
    // Derive script annotations (incl. the resolved visualization)
    next.annotations = deriveScriptAnnotations(
        update,
        next.scriptSession,
        next.connection.connectorInfo.connectorType,
        logger,
    );

    try {
        next.scriptSession.loadIntoCatalog();
    } catch (e: any) {
        logger.error("Failed to publish script into the catalog", {
            scriptKey: next.scriptKey.toString(),
            error: stringifyError(e),
        }, LOG_CTX);
    }
    return next;
}

export function replaceScriptSessionText(scriptSession: core.DashQLScriptSession, text: string): void {
    const update = scriptSession.replaceText(scriptSession.getTextVersion(), text);
    if (update.status !== core.buffers.editor.EditorUpdateStatus.OK) {
        const status = core.buffers.editor.EditorUpdateStatus[update.status] ?? update.status.toString();
        throw new Error(`Failed to replace editor session text: ${status}`);
    }
}

/// Is the analysis of a script outdated? The flag marks the changes that the app knows about, the versions also
/// catch the ones it missed: the text of the session or its catalog changed since the analysis. A script that
/// published its own declarations changed its catalog too, so a current script may analyze once more.
export function isAnalysisOutdated(scriptData: ScriptData): boolean {
    if (scriptData.analysisOutdated) return true;
    const update = scriptData.editorUpdate;
    if (update == null) return false;
    return update.textVersion !== scriptData.scriptSession.getTextVersion()
        || update.catalogRevision !== scriptData.scriptSession.getCatalogRevision();
}

export function analyzeOutdatedScript<V extends SessionScripts>(state: V, scriptKey: number, logger: Logger): V {
    const scriptData = state.scripts[scriptKey];
    if (!scriptData || !isAnalysisOutdated(scriptData)) {
        return state;
    }
    // Create the next session scripts state
    const catalogRevision = scriptData.scriptSession.getCatalogRevision();
    const nextScriptData = analyzeScriptData(scriptData, logger);
    const next = {
        ...state,
        scripts: {
            ...state.scripts,
            [scriptKey]: nextScriptData
        }
    };
    // The analysis ran against a newer catalog and may publish different declarations, e.g. a view
    // over a table of another script. Then the scripts that resolve against them are outdated, too.
    if (nextScriptData.scriptSession.getCatalogRevision() !== catalogRevision) {
        markOtherScriptsOutdatedInPlace(next.scripts, nextScriptData);
    }

    // Only the selected script drives the semantic focus.
    // Scripts in the background are re-analyzed whenever another script changes and must not steal it.
    if (getSelectedScriptRef(state)?.scriptId === scriptKey) {
        next.semanticUserFocus = deriveFocusFromEditorUpdate(scriptKey, nextScriptData.editorUpdate);
    }
    return next;
}
