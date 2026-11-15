import * as flatbuffers from 'flatbuffers';

import * as buffers from './buffers.js';
import { DashQL, DashQLCatalog, DashQLScriptSession, FlatBufferPtr, Ptr } from './api.js';
import type * as glue from './wasm/dashql_core.js';
import type {
    FlatBuffer,
    WorkbookCloudLink,
    WorkbookDataFile,
    WorkbookOutcome,
    WorkbookScriptKeys,
    WorkbookScriptView,
    WorkbookView,
} from './wasm/dashql_core.js';

/// The views of the workbook, declared by the module (`packages/dashql-core-wasm/src/workbook/view.rs`)
export type {
    WorkbookAttachmentView,
    WorkbookCloudLink,
    WorkbookConnectionCopy,
    WorkbookDataFile,
    WorkbookEffect,
    WorkbookExternalChanges,
    WorkbookOutcome,
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

/// The scripts of a workbook in the core runtime (`packages/dashql-core-runtime`, see docs/wip/core_runtime.md).
/// An action changes the workbook and returns the effects that the host applies, e.g. the files to write. The state
/// is read as views: the workbook lists its scripts with their revisions, a script changes its revision with every
/// change and crosses with its payloads as FlatBuffers by key.

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

/// A script as storage holds it
export interface WorkbookStoredScript {
    name: string;
    sql: string;
    connection: WorkbookConnection;
    unresolvedConnectionId?: string | null;
}

import type { WorkbookResultKey, WorkbookResultKeyHost, WorkbookRunHost, WorkbookRunOptions, WorkbookRunResult } from './wasm/dashql_core.js';
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

/// How a run ended, with what the host failed with
export type WorkbookRunOutcome = WorkbookRunResult & { error: unknown };

/// A run of a workbook
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

type NativeWorkbook = glue.Workbook;
type ConnectionArgs = [string, glue.Catalog, number, boolean, string | undefined, string, string];

export function connectionArgs(api: DashQL, connection: WorkbookConnection): ConnectionArgs {
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

/// The key of an editor update as `WorkbookScriptView.editorUpdateKey` names it
export function editorUpdateKey(update: buffers.editor.EditorUpdateT): string {
    return `${update.textVersion}:${update.stateRevision}:${update.catalogRevision}:${update.status}:${update.analysisAvailable}`;
}

/// The staged diff of a script view as the sessions return their diffs
export function scriptDiffBuffer(api: DashQL, bytes: FlatBuffer<buffers.diff.ScriptDiff>): FlatBufferPtr<buffers.diff.ScriptDiff> {
    return new FlatBufferPtr(SCRIPT_DIFF_TYPE, api, bytes, () => new buffers.diff.ScriptDiff());
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

    /// A workbook of the module that a service of the runtime created, e.g. the restore
    public static adopt(api: DashQL, native: NativeWorkbook): DashQLWorkbook {
        return new DashQLWorkbook(new Ptr(WORKBOOK_TYPE, api, native));
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    private get api(): DashQL {
        return this.ptr.api;
    }

    // Restoring a workbook from storage

    public setStoredPendingConnection(connection: WorkbookConnection): void {
        this.ptr.assertNotNull().setStoredPendingConnection(...connectionArgs(this.api, connection));
    }

    public setEphemeral(ephemeral: boolean): void {
        this.ptr.assertNotNull().setEphemeral(ephemeral);
    }

    public setStoredCloudLink(link: WorkbookCloudLink | null): void {
        this.ptr.assertNotNull().setStoredCloudLink(link ?? undefined);
    }

    /// Add a script that storage holds, returns its key
    public addStoredScript(fileName: string, text: string, connection: WorkbookConnection, unresolvedConnectionId?: string | null): number {
        return this.ptr.assertNotNull().addStoredScript(fileName, text, ...connectionArgs(this.api, connection), unresolvedConnectionId ?? undefined);
    }

    public setStoredAttachments(files: readonly WorkbookDataFile[]): void {
        this.ptr.assertNotNull().setStoredAttachments([...files]);
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
        return this.ptr.assertNotNull().promote([...takenNames]);
    }

    // Actions

    public createScript(index: number | null, text: string | null, base: string, connection?: WorkbookConnection): WorkbookOutcome {
        const native = this.ptr.assertNotNull();
        return connection == null
            ? native.createScript(index ?? undefined, text ?? undefined, base)
            : native.createScriptOn(index ?? undefined, text ?? undefined, base, ...connectionArgs(this.api, connection));
    }

    public deleteScript(fileName: string): WorkbookOutcome {
        return this.ptr.assertNotNull().deleteScript(fileName);
    }

    public renameScript(fileName: string, newName: string): WorkbookOutcome {
        return this.ptr.assertNotNull().renameScript(fileName, newName);
    }

    public reorderScripts(order: readonly string[]): WorkbookOutcome {
        return this.ptr.assertNotNull().reorderScripts([...order]);
    }

    public setScriptText(key: number, text: string, withDiff = false): WorkbookOutcome {
        return this.ptr.assertNotNull().setScriptText(key, text, withDiff);
    }

    public acceptPendingDiff(key: number): WorkbookOutcome {
        return this.ptr.assertNotNull().acceptPendingDiff(key);
    }

    public rejectPendingDiff(key: number): WorkbookOutcome {
        return this.ptr.assertNotNull().rejectPendingDiff(key);
    }

    public setScriptVisSpec(key: number, spec: string): WorkbookOutcome {
        return this.ptr.assertNotNull().setScriptVisSpec(key, spec);
    }

    public setWorkbookInput(name: string, literal: string, keys: readonly number[]): WorkbookOutcome {
        return this.ptr.assertNotNull().setWorkbookInput(name, literal, Uint32Array.from(keys));
    }

    /// Apply an event of the editor of a script
    public applyEditorEvent(key: number, event: buffers.editor.EditorEventT): WorkbookOutcome {
        const builder = new flatbuffers.Builder();
        builder.finish(event.pack(builder));
        return this.ptr.assertNotNull().applyEditorEvent(key, builder.asUint8Array());
    }

    /// Report the update of an event that an editor applied to the session of a script itself
    public reportEditorUpdate(key: number, update: buffers.editor.EditorUpdateT, acceptsDiff: boolean): WorkbookOutcome {
        const builder = new flatbuffers.Builder();
        builder.finish(update.pack(builder));
        return this.ptr.assertNotNull().reportEditorUpdate(key, builder.asUint8Array(), acceptsDiff);
    }

    public analyzeOutdatedScript(key: number): WorkbookOutcome {
        return this.ptr.assertNotNull().analyzeOutdatedScript(key);
    }

    public catalogDidUpdate(connectionId: string): WorkbookOutcome {
        return this.ptr.assertNotNull().catalogDidUpdate(connectionId);
    }

    /// The visualization that a run captured, null removes it
    public setExecutionVisualization(key: number, visualization: { sql: string; statementId: number; visualization: buffers.execution.CompiledVisualizationT } | null): WorkbookOutcome {
        let packed: Uint8Array | undefined;
        if (visualization != null) {
            const builder = new flatbuffers.Builder();
            builder.finish(visualization.visualization.pack(builder));
            packed = builder.asUint8Array();
        }
        return this.ptr.assertNotNull().setExecutionVisualization(key, visualization?.sql, visualization?.statementId ?? 0, packed);
    }

    public registerQuery(key: number, queryId: number): WorkbookOutcome {
        return this.ptr.assertNotNull().registerQuery(key, queryId);
    }

    public registerScriptResult(key: number, queryId: number): WorkbookOutcome {
        return this.ptr.assertNotNull().registerScriptResult(key, queryId);
    }

    public renameWorkbook(name: string | null): WorkbookOutcome {
        return this.ptr.assertNotNull().renameWorkbook(name ?? undefined);
    }

    public setScriptConnection(fileName: string, connection: WorkbookConnection): WorkbookOutcome {
        return this.ptr.assertNotNull().setScriptConnection(fileName, ...connectionArgs(this.api, connection));
    }

    public setPendingConnection(connection: WorkbookConnection): WorkbookOutcome {
        return this.ptr.assertNotNull().setPendingConnection(...connectionArgs(this.api, connection));
    }

    public replaceConnection(from: string, into: WorkbookConnection): WorkbookOutcome {
        return this.ptr.assertNotNull().replaceConnection(from, ...connectionArgs(this.api, into));
    }

    public detachConnection(from: string, into: WorkbookConnection): WorkbookOutcome {
        return this.ptr.assertNotNull().detachConnection(from, ...connectionArgs(this.api, into));
    }

    public setWorkbookAttachments(files: readonly WorkbookDataFile[]): WorkbookOutcome {
        return this.ptr.assertNotNull().setWorkbookAttachments([...files]);
    }

    public setAttachmentColumns(fileName: string, stamp: string, columns: readonly string[]): WorkbookOutcome {
        return this.ptr.assertNotNull().setAttachmentColumns(fileName, stamp, [...columns]);
    }

    public renameAttachment(fileName: string, newFileName: string): WorkbookOutcome {
        return this.ptr.assertNotNull().renameAttachment(fileName, newFileName);
    }

    public setCloudLink(link: WorkbookCloudLink | null): WorkbookOutcome {
        return this.ptr.assertNotNull().setCloudLink(link ?? undefined);
    }

    /// Give the table parameters of the workbook to a session that is no script of it, e.g. the draft of the composer.
    /// Returns whether the analysis of the session is outdated by them.
    public attachTableParameters(session: DashQLScriptSession): boolean {
        return this.ptr.assertNotNull().attachTableParameters(session.ptr.assertNotNull());
    }

    // Runs

    /// Start a run of the scripts on a host (`packages/dashql-core-runtime/src/workbook_run`). The run analyzes the
    /// scripts, plans them, serves the cached results and runs the statements through the host.
    public run(host: WorkbookRunHost, options: WorkbookRunOptions): DashQLWorkbookRun {
        return new DashQLWorkbookRun(this.ptr.assertNotNull().run(host, options));
    }

    /// Analyze every script for a run and publish its declarations, throws the message of a script that doesn't analyze
    public analyzeForRun(): void {
        this.ptr.assertNotNull().analyzeForRun();
    }

    /// The plan of a run with the analyses as they are: of the targets with what they need, of every script without
    public planRun(targets: readonly number[] | null, mountPrefix: string): buffers.execution.ExecutionGraphT {
        const bytes = this.ptr.assertNotNull().planRun(targets == null ? undefined : Uint32Array.from(targets), mountPrefix);
        return buffers.execution.ExecutionGraph.getRootAsExecutionGraph(new flatbuffers.ByteBuffer(bytes)).unpack();
    }

    /// The result keys of the scripts in feed order, null for a script without a key. Plans the targets, every script
    /// without, with the analyses as they are; all null if the plan is invalid.
    public async resultKeys(targets: readonly number[] | null, host: WorkbookResultKeyHost): Promise<Array<WorkbookResultKey | null>> {
        return await this.ptr.assertNotNull().resultKeys(targets == null ? undefined : Uint32Array.from(targets), host) as Array<WorkbookResultKey | null>;
    }

    // Reading the state

    /// The revision of the workbook, it changes with every change
    public revision(): number {
        return this.ptr.assertNotNull().revision();
    }

    /// The workbook with its scripts in feed order and their revisions
    public view(): WorkbookView {
        return this.ptr.assertNotNull().view();
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

    /// The view of a script, with the payloads whose keys aren't the ones that the caller holds
    public scriptView(key: number, known: WorkbookScriptKeys): WorkbookScriptView {
        return this.ptr.assertNotNull().scriptView(key, known);
    }
}
