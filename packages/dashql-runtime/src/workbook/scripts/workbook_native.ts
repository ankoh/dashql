import * as core from '@ankoh/dashql-core';
import * as Immutable from 'immutable';

import {
    DEBOUNCE_DURATION_SCRIPT_WRITE,
    DEBOUNCE_DURATION_WORKBOOK_WRITE,
    DELETE_SCRIPT as STORAGE_DELETE_SCRIPT,
    groupScriptDeletes,
    groupScriptRenames,
    groupScriptWrites,
    groupWorkbookConnectionCopyWrites,
    groupWorkbookManifestWrites,
    groupWorkbookScriptListWrites,
    PATCH_WORKBOOK_CONNECTION,
    RENAME_SCRIPT as STORAGE_RENAME_SCRIPT,
    WRITE_SCRIPT,
    WRITE_WORKBOOK_PROPERTIES,
    WRITE_WORKBOOK_SCRIPTS,
    type StorageWriter,
} from '../../storage/storage_writer.js';
import type { ConnectionParams, DataFile, WorkbookCloudLink } from '../../storage/storage_backend.js';
import { formattingDialectForConnector } from './script_format.js';
import { resolveCompiledVisualization } from './script_compilation.js';
import { createEmptyAnnotations, createScriptRef, type ResolvedVisualizeQuery, type ScriptAnnotations, type ScriptRef, type WorkbookMetadata } from './script_types.js';
import { RevisionCache, share } from '../../store/projection.js';
import type { ScriptConnection, ScriptData, ScriptDataMap, WorkbookScripts } from './workbook_scripts.js';

/// The Rust workbook behind the scripts of a workbook (`packages/dashql-core-runtime`, docs/wip/core_runtime.md).
///
/// The workbook holds the scripts, their sessions and their analyses. The app reads `WorkbookScripts` objects that
/// `project` builds from the views of the workbook (docs/wip/runtime_projection.md): a script keeps its `ScriptData`
/// object as long as its revision doesn't change, the session of a script keeps its `DashQLScriptSession` handle as
/// long as the script keeps its session, a payload of a script (the editor update, the staged diff, the visualization,
/// the statistics) keeps its object as long as its key doesn't move.

/// The visualization that a run captured with the query of a script
export interface CapturedVisualization {
    /// The SQL of the query
    sql: string;
    /// The statement with the `@vis` tags
    statementId: number;
    /// The compiled visualization
    visualization: core.buffers.execution.CompiledVisualizationT;
}

/// A script that a new workbook starts with, e.g. one that storage holds
export interface InitialWorkbookScript {
    /// The file name
    name: string;
    /// The text
    sql: string;
    /// The connection
    connection: ScriptConnection;
    /// The connection that the workbook file names for the script while the app doesn't know it
    unresolvedConnectionId?: string;
}

/// What a new workbook starts with
export interface WorkbookScriptsInit {
    instance: core.DashQL;
    workbookId: string;
    name: string | null;
    workbookMetadata: WorkbookMetadata;
    pendingConnection: ScriptConnection | null;
    scripts: InitialWorkbookScript[];
    /// The data files of the workbook, absent until storage listed them
    dataFiles?: readonly DataFile[];
}

/// The table parameters of a workbook that a session which is no script of it reads, e.g. the draft of the composer
export interface WorkbookTableParameters {
    /// Give the table parameters to a session, returns whether its analysis is outdated by them
    attach(session: core.DashQLScriptSession): boolean;
}

/// A projected script: the data that the app reads and the view it came from, the next projection of the script
/// keeps what the view didn't change
interface ProjectedScript {
    view: core.WorkbookScriptView;
    data: ScriptData;
}

export class NativeWorkbook {
    /// The Rust workbook
    readonly workbook: core.DashQLWorkbook;
    /// The connections of the scripts by id, the objects of the app that the workbook only knows by id
    private readonly connections = new Map<string, ScriptConnection>();
    /// The handles of the sessions by session id
    private sessions = new Map<number, core.DashQLScriptSession>();
    /// The view of the workbook of the last projection, the next one shares its unchanged parts
    private view: core.WorkbookView | null = null;
    /// The projected scripts by key, kept while their revisions don't move
    private readonly scripts = new RevisionCache<number, ProjectedScript>();
    /// The payloads of the scripts by key, read once per payload key
    private readonly editorUpdates = new core.FlatBufferCache(bb => core.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb), table => table.unpack());
    private readonly pendingDiffs: core.FlatBufferCache<core.buffers.diff.ScriptDiff, core.FlatBufferPtr<core.buffers.diff.ScriptDiff>, number>;
    private readonly visualizations = new core.FlatBufferCache<core.buffers.execution.CompiledVisualization, core.buffers.execution.CompiledVisualizationT, number>(
        bb => core.buffers.execution.CompiledVisualization.getRootAsCompiledVisualization(bb),
        table => table.unpack(),
    );
    /// Editor updates that the editors reported, the projection holds them instead of reading them again
    private readonly knownUpdates = new Map<number, core.buffers.editor.EditorUpdateT>();
    /// The link to a published workbook as the workbook file holds it, the Rust workbook knows only its ids
    cloudLink: WorkbookCloudLink | null;

    private constructor(workbook: core.DashQLWorkbook, cloudLink: WorkbookCloudLink | null) {
        this.workbook = workbook;
        this.cloudLink = cloudLink;
        const api = workbook.ptr.api;
        this.pendingDiffs = new core.FlatBufferCache(bb => core.buffers.diff.ScriptDiff.getRootAsScriptDiff(bb), (_, bytes) => core.scriptDiffBuffer(api, bytes));
    }

    /// Create the scripts of a workbook
    static create(init: WorkbookScriptsInit): WorkbookScripts {
        // Through the instance: a bundle can hold two copies of the core package, the classes must be the instance's
        const workbook = init.instance.createWorkbook(init.workbookId, init.name);
        const native = new NativeWorkbook(workbook, init.workbookMetadata.cloud ?? null);
        try {
            if (init.workbookMetadata.ephemeral) workbook.setEphemeral(true);
            if (init.workbookMetadata.cloud != null) workbook.setStoredCloudLink(nativeCloudLink(init.workbookMetadata.cloud));
            if (init.pendingConnection != null) workbook.setStoredPendingConnection(native.connection(init.pendingConnection));
            for (const script of init.scripts) {
                workbook.addStoredScript(script.name, script.sql, native.connection(script.connection), script.unresolvedConnectionId);
            }
            if (init.dataFiles != null) workbook.setStoredAttachments(init.dataFiles);
        } catch (e) {
            native.destroy();
            throw e;
        }
        return native.project({
            instance: init.instance,
            workbookId: init.workbookId,
            name: init.name,
            workbookMetadata: init.workbookMetadata,
        });
    }

    /// The scripts of a workbook that a service of the Rust runtime created, e.g. the restore. The connections are the
    /// ones of its scripts and its pending connection.
    static adopt(init: Pick<WorkbookScriptsInit, 'instance' | 'workbookId' | 'name' | 'workbookMetadata'> & {
        workbook: core.DashQLWorkbook;
        connections: readonly ScriptConnection[];
    }): WorkbookScripts {
        const native = new NativeWorkbook(init.workbook, init.workbookMetadata.cloud ?? null);
        for (const connection of init.connections) native.connections.set(connection.connectionId, connection);
        try {
            return native.project({
                instance: init.instance,
                workbookId: init.workbookId,
                name: init.name,
                workbookMetadata: init.workbookMetadata,
            });
        } catch (e) {
            native.destroy();
            throw e;
        }
    }

    /// The connection of the Rust workbook, the connection object is remembered for the projection
    connection(connection: ScriptConnection): core.WorkbookConnection {
        this.connections.set(connection.connectionId, connection);
        return workbookConnectionOf(connection);
    }

    /// Take an editor update for the next projection of a script instead of reading it again
    knowUpdate(scriptKey: number, update: core.buffers.editor.EditorUpdateT): void {
        this.knownUpdates.set(scriptKey, update);
    }

    /// Forget the known updates of an action that changed nothing
    forgetUpdates(): void {
        this.knownUpdates.clear();
    }

    /// The session handle of a script, one per session
    private session(scriptKey: number, sessionId: number): core.DashQLScriptSession {
        let session = this.sessions.get(sessionId);
        if (session == null) {
            session = this.workbook.scriptSession(scriptKey);
            this.sessions.set(sessionId, session);
        }
        return session;
    }

    /// Build the `WorkbookScripts` of the workbook. Unchanged scripts keep their objects, and so do the maps of an
    /// unchanged previous projection.
    project(prev: Pick<WorkbookScripts, 'instance' | 'workbookId' | 'workbookMetadata' | 'name'> & Partial<WorkbookScripts>): WorkbookScripts {
        const view = share(this.view, this.workbook.view());
        this.view = view;
        const sessions = new Map<number, core.DashQLScriptSession>();
        const scripts: ScriptDataMap = {};
        const scriptOrder: string[] = [];
        let scriptsChanged = prev.scripts == null || Object.keys(prev.scripts).length !== view.scripts.length;
        for (const [key, revision] of view.scripts) {
            const { view: scriptView, data } = this.scripts.get(key, revision, before => this.projectScript(key, before));
            sessions.set(scriptView.sessionId, data.scriptSession);
            scripts[key] = data;
            scriptOrder.push(data.fileName);
            if (prev.scripts?.[key] !== data) scriptsChanged = true;
        }
        this.knownUpdates.clear();
        const keys = view.scripts.map(([key]) => key);
        if (this.scripts.retain(keys)) {
            this.editorUpdates.retain(keys);
            this.pendingDiffs.retain(keys);
            this.visualizations.retain(keys);
        }
        // The handles of sessions that no script holds anymore go
        for (const [sessionId, session] of this.sessions) {
            if (!sessions.has(sessionId)) session.destroy();
        }
        this.sessions = sessions;

        // A reorder keeps the references, a rename or a new script keeps the order of the others
        const refsUnchanged = prev.scriptRefs != null && Object.keys(prev.scriptRefs).length === scriptOrder.length
            && keys.every((key, i) => prev.scriptRefs?.[scriptOrder[i]]?.scriptId === key);
        const orderUnchanged = refsUnchanged && prev.scriptOrder != null && prev.scriptOrder.length === scriptOrder.length
            && prev.scriptOrder.every((name, i) => name === scriptOrder[i]);
        const scriptRefs: { [fileName: string]: ScriptRef } = {};
        if (!refsUnchanged) keys.forEach((key, i) => { scriptRefs[scriptOrder[i]] = createScriptRef(key, scriptOrder[i]); });
        const { ephemeral: _ephemeral, cloud: _cloud, ...metadata } = prev.workbookMetadata;
        const workbookMetadata: WorkbookMetadata = {
            ...metadata,
            ...(view.ephemeral ? { ephemeral: true } : {}),
            ...(this.cloudLink != null ? { cloud: this.cloudLink } : {}),
        };
        return {
            instance: prev.instance,
            workbookId: prev.workbookId,
            native: this,
            name: view.name,
            pendingConnection: view.pendingConnectionId == null ? null : this.connections.get(view.pendingConnectionId) ?? null,
            workbookMetadata,
            scripts: !scriptsChanged && prev.scripts != null ? prev.scripts : scripts,
            scriptRefs: refsUnchanged ? prev.scriptRefs! : scriptRefs,
            scriptOrder: orderUnchanged ? prev.scriptOrder! : scriptOrder,
            // The view shares the attachments while they don't change
            attachments: view.attachments ?? undefined,
        };
    }

    /// The view of a script without the payloads that the projection holds
    private scriptView(key: number, before: ProjectedScript | null, withStatistics: boolean): core.WorkbookScriptView {
        const pending = this.knownUpdates.get(key);
        const statistics = before?.view.statistics ?? [];
        return this.workbook.scriptView(key, {
            editorUpdate: pending != null ? core.editorUpdateKey(pending) : this.editorUpdates.known(key),
            pendingDiff: this.pendingDiffs.known(key),
            visualization: this.visualizations.known(key),
            statistics: withStatistics && statistics.length > 0 ? statistics[statistics.length - 1].key : null,
        });
    }

    /// The projection of a script whose revision moved
    private projectScript(key: number, before: ProjectedScript | null): ProjectedScript {
        let view = share(before?.view, this.scriptView(key, before, true));
        // The statistics that the view left out are the ones of the previous projection
        const held = new Map<number, core.buffers.editor.EditorProcessingStatisticsT>();
        before?.view.statistics.forEach((entry, i) => held.set(entry.key, before.data.statistics.get(i)!));
        if (view.statistics.some(entry => entry.statistics == null && !held.has(entry.key))) {
            view = this.scriptView(key, before, false);
        }
        const connection = this.connections.get(view.connectionId);
        if (connection == null) throw new Error(`the workbook names an unknown connection: ${view.connectionId}`);

        // The payloads keep their objects while their keys don't move, a reported editor update is held as it is
        const pending = this.knownUpdates.get(key);
        if (pending != null && view.editorUpdateKey != null && view.editorUpdateKey === core.editorUpdateKey(pending)) {
            this.editorUpdates.hold(key, view.editorUpdateKey, pending);
        }
        const editorUpdate = this.editorUpdates.read(key, view.editorUpdateKey, view.editorUpdate);
        const diffBuffer = this.pendingDiffs.read(key, view.pendingDiff?.key ?? null, view.pendingDiff?.diff ?? null);
        const pendingDiff = view.pendingDiff == null || diffBuffer == null ? null
            : before?.data.pendingDiff?.diffBuffer === diffBuffer && before.data.pendingDiff.priorText === view.pendingDiff.priorText
                ? before.data.pendingDiff
                : { priorText: view.pendingDiff.priorText, diffBuffer };
        const visualization = this.visualizations.read(key, view.visualization?.key ?? null, view.visualization?.visualization ?? null);
        const visualizeQuery = view.visualization == null || visualization == null ? null
            : before != null && before.view.visualization?.key === view.visualization.key ? before.data.annotations.visualizeQuery
                : resolveCompiledVisualization(view.visualization.sql, visualization, view.visualization.statementId);
        const annotations = before != null && before.data.editorUpdate === editorUpdate && before.data.annotations.visualizeQuery === visualizeQuery
            ? before.data.annotations
            : deriveScriptAnnotations(editorUpdate, visualizeQuery);
        const statistics = view.statistics.map(entry => entry.statistics != null
            ? core.readFlatBuffer(entry.statistics, bb => core.buffers.editor.EditorProcessingStatistics.getRootAsEditorProcessingStatistics(bb)).unpack()
            : held.get(entry.key)!);
        const sameStatistics = before != null && before.data.statistics.size === statistics.length
            && statistics.every((value, i) => value === before.data.statistics.get(i));

        const data: ScriptData = {
            scriptKey: key,
            scriptSession: this.session(key, view.sessionId),
            editorUpdate,
            analysisOutdated: view.analysisOutdated,
            annotations,
            statistics: sameStatistics ? before.data.statistics : Immutable.List(statistics),
            pendingDiff,
            externalChanges: view.externalChanges,
            latestQueryId: view.latestQueryId,
            latestResultQueryId: view.latestResultQueryId,
            fileName: view.fileName,
            connection,
            ...(view.unresolvedConnectionId != null ? { unresolvedConnectionId: view.unresolvedConnectionId } : {}),
        };
        return { view, data };
    }

    /// The table parameters of the workbook for sessions that are no scripts of it
    tableParameters(): WorkbookTableParameters {
        return { attach: session => this.workbook.attachTableParameters(session) };
    }

    /// Free the workbook. Its scripts leave the catalogs of their connections.
    destroy(): void {
        for (const session of this.sessions.values()) session.destroy();
        this.sessions.clear();
        this.scripts.clear();
        this.view = null;
        this.workbook.destroy();
    }
}

/// The connection of a script as the Rust workbook takes it
export function workbookConnectionOf(connection: ScriptConnection): core.WorkbookConnection {
    return {
        connectionId: connection.connectionId,
        catalog: connection.catalog,
        dialect: formattingDialectForConnector(connection.connectorInfo?.connectorType),
        local: connection.local ?? false,
        params: connection.params == null ? null : JSON.stringify(connection.params),
        defaultDatabase: connection.catalogNameDefaults?.databaseName ?? '',
        defaultSchema: connection.catalogNameDefaults?.schemaName ?? '',
    };
}

/// The ids of a link to a published workbook that the Rust workbook keeps
export function nativeCloudLink(link: WorkbookCloudLink): core.WorkbookCloudLink {
    return { workbookId: link.workbookId, versionId: link.versionId, preview: link.preview === true };
}

/// The annotations of a script for the views: its tables, its visualization, its positions on the canvas and the board
export function deriveScriptAnnotations(
    update: core.buffers.editor.EditorUpdateT | null | undefined,
    visualizeQuery: ResolvedVisualizeQuery | null,
): ScriptAnnotations {
    // The visualization that a run captured holds also without an analysis
    if (!update?.analysisAvailable) {
        return { ...createEmptyAnnotations(), visualizeQuery };
    }
    const tableDefs = update.scriptAnnotations?.tableDefinitions
        .map(table => typeof table.name === 'string' ? table.name : null)
        .filter((name): name is string => name != null)
        .sort() ?? [];
    const flow = update.scriptAnnotations?.flowPosition;
    const board = update.scriptAnnotations?.boardPosition;
    const lastStatement = (update.scriptAnnotations?.statements ?? [])
        .reduce<core.buffers.editor.EditorStatementT | null>((last, statement) => last == null || statement.statementId > last.statementId ? statement : last, null);
    return {
        tableDefs,
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

/// Run the effects of an action of a workbook through the storage writer, in order
export function writeWorkbookEffects(workbook: WorkbookScripts, effects: readonly core.WorkbookEffect[], storage: { write: StorageWriter['write'] }): void {
    const workbookId = workbook.workbookId;
    for (const effect of effects) {
        switch (effect.type) {
            case 'writeScript':
                void storage.write(
                    groupScriptWrites(workbookId, effect.fileName),
                    { type: WRITE_SCRIPT, value: [workbookId, effect.fileName, effect.text] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE,
                );
                break;
            case 'deleteScript':
                void storage.write(
                    groupScriptDeletes(workbookId, effect.fileName),
                    { type: STORAGE_DELETE_SCRIPT, value: [workbookId, effect.fileName] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE,
                );
                break;
            case 'renameScript':
                void storage.write(
                    groupScriptRenames(workbookId, effect.from),
                    { type: STORAGE_RENAME_SCRIPT, value: [workbookId, effect.from, effect.to] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE,
                );
                break;
            case 'writeScriptList':
                void storage.write(
                    groupWorkbookScriptListWrites(workbookId),
                    {
                        type: WRITE_WORKBOOK_SCRIPTS,
                        value: [workbookId, {
                            scripts: effect.list.scripts,
                            connections: effect.list.connections.map(copy => ({ connectionId: copy.connectionId, params: JSON.parse(copy.params) as ConnectionParams })),
                        }],
                    },
                    DEBOUNCE_DURATION_WORKBOOK_WRITE,
                );
                break;
            case 'writeProperties': {
                // The workbook file holds the whole link to the cloud, the Rust workbook only its ids
                const cloud = workbook.workbookMetadata?.cloud;
                void storage.write(
                    groupWorkbookManifestWrites(workbookId),
                    {
                        type: WRITE_WORKBOOK_PROPERTIES,
                        value: [workbookId, {
                            name: effect.name,
                            ...(effect.ephemeral ? { ephemeral: true } : {}),
                            ...(effect.cloud != null && cloud != null ? { cloud } : {}),
                        }],
                    },
                    DEBOUNCE_DURATION_WORKBOOK_WRITE,
                );
                break;
            }
            case 'patchConnection':
                for (const from of effect.replaces) {
                    void storage.write(
                        groupWorkbookConnectionCopyWrites(workbookId, from),
                        {
                            type: PATCH_WORKBOOK_CONNECTION,
                            value: [workbookId, { connectionId: effect.connectionId, params: JSON.parse(effect.params ?? 'null') as ConnectionParams }, [from]],
                        },
                        DEBOUNCE_DURATION_WORKBOOK_WRITE,
                    );
                }
                break;
        }
    }
}
