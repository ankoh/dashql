import * as flatbuffers from 'flatbuffers';

import * as buffers from './buffers.js';
import { DashQL, DashQLCatalog, DashQLScriptSession, FlatBufferPtr, Ptr } from './api.js';
import type * as glue from './wasm/dashql_core.js';

/// The scripts of a workbook in the Rust runtime (`packages/dashql-runtime-rs`, a spike, see docs/wip/rust_runtime.md).
/// An action changes the workbook and returns the effects that the host applies, e.g. the files to write. The state
/// is read per script, a script changes its revision with every change.

const WORKBOOK_TYPE = Symbol('WORKBOOK_TYPE');
const SCRIPT_SESSION_TYPE = Symbol('WORKBOOK_SCRIPT_SESSION_TYPE');
const SCRIPT_DIFF_TYPE = Symbol('WORKBOOK_SCRIPT_DIFF_TYPE');

/// The connection that a script is analyzed and executed with
export interface WorkbookConnection {
    /// The id of the connection
    connectionId: string;
    /// The catalog of the connection, the scripts publish their declarations into it
    catalog: DashQLCatalog;
    /// The dialect that the queries of the scripts are compiled to
    dialect: buffers.formatting.FormattingDialect;
    /// Is the connection the embedded Hyper, which scans the results of scripts of other connections?
    local: boolean;
    /// The params of the connection as JSON, the workbook file holds a copy of them
    params: string | null;
    /// The database of relations without a database name
    defaultDatabase: string;
    /// The schema of relations without a schema name
    defaultSchema: string;
}

/// The script list of the workbook file
export interface WorkbookScriptList {
    scripts: { name: string; connectionId: string }[];
    connections: { connectionId: string; params: string }[];
}

/// The published workbook of a cloud that a workbook came from or was published to
export interface WorkbookCloudLink {
    workbookId: string;
    versionId: string;
    preview: boolean;
}

/// What the host does after an action, in this order
export type WorkbookEffect =
    | { type: 'writeScript'; fileName: string; text: string }
    | { type: 'deleteScript'; fileName: string }
    | { type: 'renameScript'; from: string; to: string }
    | { type: 'writeScriptList'; list: WorkbookScriptList }
    | { type: 'writeProperties'; name: string | null; ephemeral: boolean; cloud: WorkbookCloudLink | null }
    | { type: 'patchConnection'; connectionId: string; params: string | null; replaces: string[] };

/// What an action did
export interface WorkbookOutcome {
    /// Did the action change the workbook?
    changed: boolean;
    /// The effects for the host, in order
    effects: WorkbookEffect[];
    /// The update of an editor event
    editorUpdate: buffers.editor.EditorUpdateT | null;
}

/// A change of the text of a script in the offset unit of the editors
export interface WorkbookTextChange {
    from: number;
    to: number;
    insert: string;
}

/// The plain fields of a script
export interface WorkbookScriptSnapshot {
    key: number;
    /// Identifies the session of the script, a script that moved to another connection has a new one
    sessionId: number;
    fileName: string;
    revision: number;
    connectionId: string;
    unresolvedConnectionId: string | null;
    analysisOutdated: boolean;
    /// Names the editor update of the script, an update with the same key is the same analysis
    editorUpdateKey: string | null;
    latestQueryId: number | null;
    latestResultQueryId: number | null;
    /// The text before a staged rewrite
    pendingDiffPriorText: string | null;
    /// The last change of the text that the workbook made
    externalChanges: { fromText: string; changes: WorkbookTextChange[] } | null;
    /// The SQL and the statement of the visualization of the script
    visualizationSql: string | null;
    visualizationStatementId: number | null;
}

/// An attachment of a workbook
export interface WorkbookAttachmentSnapshot {
    fileName: string;
    name: string;
    sizeBytes: number;
    mtimeMs: number;
    columns: string[] | null;
}

/// The plain fields of a workbook
export interface WorkbookProperties {
    name: string | null;
    ephemeral: boolean;
    pendingConnectionId: string | null;
    cloud: WorkbookCloudLink | null;
    attachments: WorkbookAttachmentSnapshot[] | null;
    scriptList: WorkbookScriptList;
}

/// A data file of a workbook as storage lists it
export interface WorkbookDataFile {
    name: string;
    sizeBytes: number;
    mtimeMs?: number;
}

/// A script as storage holds it
export interface WorkbookStoredScript {
    name: string;
    sql: string;
    connection: WorkbookConnection;
    unresolvedConnectionId?: string | null;
}

type NativeWorkbook = glue.Workbook;
type ConnectionArgs = [string, glue.Catalog, number, boolean, string | undefined, string, string];

function connectionArgs(api: DashQL, connection: WorkbookConnection): ConnectionArgs {
    if (connection.catalog.ptr.api !== api) {
        throw new Error('the catalog of the connection belongs to a different DashQL instance');
    }
    return [
        connection.connectionId,
        connection.catalog.ptr.assertNotNull(),
        connection.dialect,
        connection.local,
        connection.params ?? undefined,
        connection.defaultDatabase,
        connection.defaultSchema,
    ];
}

function dataFileArgs(files: readonly WorkbookDataFile[]): [string[], Float64Array, Float64Array] {
    return [
        files.map(file => file.name),
        Float64Array.from(files, file => file.sizeBytes),
        Float64Array.from(files, file => file.mtimeMs ?? 0),
    ];
}

/// The key of an editor update as `WorkbookScriptSnapshot.editorUpdateKey` names it
export function editorUpdateKey(update: buffers.editor.EditorUpdateT): string {
    return `${update.textVersion}:${update.stateRevision}:${update.catalogRevision}:${update.status}:${update.analysisAvailable}`;
}

function readEditorUpdate(bytes: Uint8Array): buffers.editor.EditorUpdateT {
    return buffers.editor.EditorUpdate.getRootAsEditorUpdate(new flatbuffers.ByteBuffer(bytes)).unpack();
}

export class DashQLWorkbook {
    public readonly ptr: Ptr<typeof WORKBOOK_TYPE, NativeWorkbook>;

    public constructor(ptr: Ptr<typeof WORKBOOK_TYPE, NativeWorkbook>) {
        this.ptr = ptr;
    }

    /// An empty workbook, the editors count offsets in `offsetUnit`
    public static create(
        api: DashQL,
        id: string,
        name: string | null,
        offsetUnit = buffers.editor.EditorOffsetUnit.UTF16_CODE_UNITS,
    ): DashQLWorkbook {
        return new DashQLWorkbook(new Ptr(WORKBOOK_TYPE, api, new api.bindings.Workbook(id, name ?? undefined, offsetUnit)));
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    private get api(): DashQL {
        return this.ptr.api;
    }

    private outcome(outcome: glue.WorkbookOutcome): WorkbookOutcome {
        try {
            const update = outcome.editorUpdate();
            return {
                changed: outcome.changed,
                effects: JSON.parse(outcome.effects) as WorkbookEffect[],
                editorUpdate: update == null ? null : readEditorUpdate(update),
            };
        } finally {
            outcome.free();
        }
    }

    // Restoring a workbook from storage

    public setStoredPendingConnection(connection: WorkbookConnection): void {
        this.ptr.assertNotNull().setStoredPendingConnection(...connectionArgs(this.api, connection));
    }

    public setEphemeral(ephemeral: boolean): void {
        this.ptr.assertNotNull().setEphemeral(ephemeral);
    }

    public setStoredCloudLink(link: WorkbookCloudLink | null): void {
        this.ptr.assertNotNull().setStoredCloudLink(link?.workbookId, link?.versionId ?? '', link?.preview ?? false);
    }

    /// Add a script that storage holds, returns its key
    public addStoredScript(fileName: string, text: string, connection: WorkbookConnection, unresolvedConnectionId?: string | null): number {
        return this.ptr.assertNotNull().addStoredScript(fileName, text, ...connectionArgs(this.api, connection), unresolvedConnectionId ?? undefined);
    }

    public setStoredAttachments(files: readonly WorkbookDataFile[]): void {
        this.ptr.assertNotNull().setStoredAttachments(...dataFileArgs(files));
    }

    private stage(scripts: readonly WorkbookStoredScript[]): NativeWorkbook {
        const native = this.ptr.assertNotNull();
        for (const script of scripts) {
            native.stageStoredScript(script.name, script.sql, ...connectionArgs(this.api, script.connection), script.unresolvedConnectionId ?? undefined);
        }
        return native;
    }

    /// Does storage hold the scripts as they are?
    public matchesStoredScripts(scripts: readonly WorkbookStoredScript[]): boolean {
        return this.stage(scripts).matchesStoredScripts();
    }

    /// Replace the scripts with the ones that storage holds, returns whether anything changed
    public replaceFromStorage(scripts: readonly WorkbookStoredScript[]): boolean {
        return this.stage(scripts).replaceFromStorage();
    }

    /// Promote an ephemeral workbook with scripts to a full workbook with a name that no other workbook has
    public promote(takenNames: readonly string[]): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().promote([...takenNames]));
    }

    // Actions

    public createScript(index: number | null, text: string | null, base: string, connection?: WorkbookConnection): WorkbookOutcome {
        const native = this.ptr.assertNotNull();
        return this.outcome(connection == null
            ? native.createScript(index ?? undefined, text ?? undefined, base)
            : native.createScriptOn(index ?? undefined, text ?? undefined, base, ...connectionArgs(this.api, connection)));
    }

    public deleteScript(fileName: string): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().deleteScript(fileName));
    }

    public renameScript(fileName: string, newName: string): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().renameScript(fileName, newName));
    }

    public reorderScripts(order: readonly string[]): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().reorderScripts([...order]));
    }

    public setScriptText(key: number, text: string, withDiff = false): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().setScriptText(key, text, withDiff));
    }

    public acceptPendingDiff(key: number): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().acceptPendingDiff(key));
    }

    public rejectPendingDiff(key: number): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().rejectPendingDiff(key));
    }

    public setScriptVisSpec(key: number, spec: string): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().setScriptVisSpec(key, spec));
    }

    public setWorkbookInput(name: string, literal: string, keys: readonly number[]): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().setWorkbookInput(name, literal, Uint32Array.from(keys)));
    }

    /// Apply an event of the editor of a script
    public applyEditorEvent(key: number, event: buffers.editor.EditorEventT): WorkbookOutcome {
        const builder = new flatbuffers.Builder();
        builder.finish(event.pack(builder));
        return this.outcome(this.ptr.assertNotNull().applyEditorEvent(key, builder.asUint8Array()));
    }

    /// Report the update of an event that an editor applied to the session of a script itself
    public reportEditorUpdate(key: number, update: buffers.editor.EditorUpdateT, acceptsDiff: boolean): WorkbookOutcome {
        const builder = new flatbuffers.Builder();
        builder.finish(update.pack(builder));
        return this.outcome(this.ptr.assertNotNull().reportEditorUpdate(key, builder.asUint8Array(), acceptsDiff));
    }

    public analyzeOutdatedScript(key: number): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().analyzeOutdatedScript(key));
    }

    public catalogDidUpdate(connectionId: string): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().catalogDidUpdate(connectionId));
    }

    /// The visualization that a run captured, null removes it
    public setExecutionVisualization(key: number, visualization: { sql: string; statementId: number; visualization: buffers.execution.CompiledVisualizationT } | null): WorkbookOutcome {
        let packed: Uint8Array | undefined;
        if (visualization != null) {
            const builder = new flatbuffers.Builder();
            builder.finish(visualization.visualization.pack(builder));
            packed = builder.asUint8Array();
        }
        return this.outcome(this.ptr.assertNotNull().setExecutionVisualization(key, visualization?.sql, visualization?.statementId ?? 0, packed));
    }

    public registerQuery(key: number, queryId: number): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().registerQuery(key, queryId));
    }

    public registerScriptResult(key: number, queryId: number): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().registerScriptResult(key, queryId));
    }

    public renameWorkbook(name: string | null): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().renameWorkbook(name ?? undefined));
    }

    public setScriptConnection(fileName: string, connection: WorkbookConnection): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().setScriptConnection(fileName, ...connectionArgs(this.api, connection)));
    }

    public setPendingConnection(connection: WorkbookConnection): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().setPendingConnection(...connectionArgs(this.api, connection)));
    }

    public replaceConnection(from: string, into: WorkbookConnection): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().replaceConnection(from, ...connectionArgs(this.api, into)));
    }

    public detachConnection(from: string, into: WorkbookConnection): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().detachConnection(from, ...connectionArgs(this.api, into)));
    }

    public setWorkbookAttachments(files: readonly WorkbookDataFile[]): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().setWorkbookAttachments(...dataFileArgs(files)));
    }

    public setAttachmentColumns(fileName: string, stamp: string, columns: readonly string[]): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().setAttachmentColumns(fileName, stamp, [...columns]));
    }

    public renameAttachment(fileName: string, newFileName: string): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().renameAttachment(fileName, newFileName));
    }

    public setCloudLink(link: WorkbookCloudLink | null): WorkbookOutcome {
        return this.outcome(this.ptr.assertNotNull().setCloudLink(link?.workbookId, link?.versionId ?? '', link?.preview ?? false));
    }

    /// Apply the analysis that the planner of a run made of a script
    public applyPlannerAnalysis(key: number, update: buffers.editor.EditorUpdateT): WorkbookOutcome {
        const builder = new flatbuffers.Builder();
        builder.finish(update.pack(builder));
        return this.outcome(this.ptr.assertNotNull().applyPlannerAnalysis(key, builder.asUint8Array()));
    }

    /// Give the table parameters of the workbook to a session that is no script of it, e.g. the draft of the composer.
    /// Returns whether the analysis of the session is outdated by them.
    public attachTableParameters(session: DashQLScriptSession): boolean {
        return this.ptr.assertNotNull().attachTableParameters(session.ptr.assertNotNull());
    }

    // Reading the state

    /// The revision of the workbook, it changes with every change
    public revision(): number {
        return this.ptr.assertNotNull().revision();
    }

    public properties(): WorkbookProperties {
        return JSON.parse(this.ptr.assertNotNull().properties()) as WorkbookProperties;
    }

    /// The keys of the scripts in feed order
    public scriptKeys(): number[] {
        return Array.from(this.ptr.assertNotNull().scriptKeys());
    }

    public scriptRevision(key: number): number {
        return this.ptr.assertNotNull().scriptRevision(key);
    }

    public scriptSnapshot(key: number): WorkbookScriptSnapshot {
        return JSON.parse(this.ptr.assertNotNull().scriptSnapshot(key)) as WorkbookScriptSnapshot;
    }

    /// Is the analysis of a script outdated, also by a change that the workbook missed?
    public isAnalysisOutdated(key: number): boolean {
        return this.ptr.assertNotNull().isAnalysisOutdated(key);
    }

    /// The session of a script, shared with the workbook. Every call returns a new handle, the caller keeps one per
    /// session id and destroys it when the script goes.
    public scriptSession(key: number): DashQLScriptSession {
        const native = this.ptr.assertNotNull().scriptSession(key);
        // A session like the ones of `DashQL.createScriptSession`, the symbol of their pointers is private to api.ts
        const ptr = new Ptr(SCRIPT_SESSION_TYPE, this.api, native) as unknown as ConstructorParameters<typeof DashQLScriptSession>[0];
        return new DashQLScriptSession(ptr);
    }

    public scriptEditorUpdate(key: number): buffers.editor.EditorUpdateT | null {
        const bytes = this.ptr.assertNotNull().scriptEditorUpdate(key);
        return bytes == null ? null : readEditorUpdate(bytes);
    }

    /// The diff of the staged rewrite of a script
    public scriptPendingDiff(key: number): FlatBufferPtr<buffers.diff.ScriptDiff> | null {
        const bytes = this.ptr.assertNotNull().scriptPendingDiff(key);
        return bytes == null ? null : new FlatBufferPtr(SCRIPT_DIFF_TYPE, this.api, bytes, () => new buffers.diff.ScriptDiff());
    }

    public scriptVisualization(key: number): buffers.execution.CompiledVisualizationT | null {
        const bytes = this.ptr.assertNotNull().scriptVisualization(key);
        return bytes == null ? null : buffers.execution.CompiledVisualization.getRootAsCompiledVisualization(new flatbuffers.ByteBuffer(bytes)).unpack();
    }

    /// The processing statistics of the latest analyses of a script, the oldest first
    public scriptStatistics(key: number): buffers.editor.EditorProcessingStatisticsT[] {
        const native = this.ptr.assertNotNull();
        const out: buffers.editor.EditorProcessingStatisticsT[] = [];
        for (let i = 0; ; ++i) {
            const bytes = native.scriptStatistics(key, i);
            if (bytes == null) return out;
            out.push(buffers.editor.EditorProcessingStatistics.getRootAsEditorProcessingStatistics(new flatbuffers.ByteBuffer(bytes)).unpack());
        }
    }
}
