import * as buffers from './buffers.js';
import * as flatbuffers from 'flatbuffers';

import * as glue from './wasm/dashql_core.js';
import { decodeBatchResult, encodeBatchRequest } from './batch.js';
import type { BatchRequest, BatchResult } from './batch.js';
import type { ScriptAnnotation } from './comment_tags.js';

/// The wasm-bindgen module of the Rust core (`packages/dashql-core-wasm`).
/// Every module that re-exports the core bindings (e.g. the shell module) satisfies this interface.
export type DashQLBindings = Pick<
    typeof glue,
    | 'Catalog'
    | 'Script'
    | 'ScriptBatch'
    | 'ScriptSession'
    | 'QueryProfile'
    | 'SessionPlanRequest'
    | 'TableParameters'
    | 'planSession'
    | 'checkScriptReferences'
    | 'deriveSessionDataflow'
    | 'collectSessionInputs'
    | 'inputLiteral'
    | 'quoteIdentifier'
    | 'quoteColumnName'
    | 'processBatch'
    | 'appendCatalogChangesSql'
    | 'qualifyCatalogChanges'
    | 'installPanicHook'
>;

/// The placement of a script on the dataflow canvas, its `@flow` tag
export interface DataflowPlacement {
    /// The top left corner of the box, absent if the layout places the box
    position?: { x: number; y: number } | null;
    /// The width of the box, absent for the default width
    width?: number | null;
    /// The height of the chart of the box, absent for the default height
    height?: number | null;
}

/// A connection of a session plan
export interface SessionPlanConnection {
    /// The connection id of the host
    id: string;
    /// Is the connection the embedded Hyper, which scans the materialized results of other connections?
    local: boolean;
    /// The SQL dialect of the connection, the values of inputs are printed in it. Hyper if absent.
    dialect?: buffers.formatting.FormattingDialect;
    /// The catalog of the connection, its scripts are analyzed with it
    catalog: DashQLCatalog;
}

/// A script of a session plan
export interface SessionPlanScript {
    /// The script name, `foo` for `foo.sql`, that table parameters reference
    name: string;
    /// The connection index
    connection: number;
    /// The script session
    session: DashQLScriptSession;
    /// The name of the Parquet file of a materialized result of the script below the mount prefix, `s<index>.parquet`
    /// if absent
    materializationFile?: string;
}

/// An attachment of a session, a Parquet file that the table parameter `:name` reads
export interface SessionPlanAttachment {
    /// The name, `foo` for `foo.parquet`
    name: string;
    /// The file name below the attachment prefix
    file: string;
    /// Changes when the file changes, e.g. its size and modification time
    stamp: string;
    /// The columns of the file, absent if the host didn't read them yet
    columns?: string[] | null;
}

/// A request to plan the scripts of a session
export interface SessionPlanRequest {
    /// The connections
    connections: SessionPlanConnection[];
    /// The scripts in session order
    scripts: SessionPlanScript[];
    /// The target scripts, the plan covers the whole session without them
    targets?: number[];
    /// The scripts whose materialized results the host provides
    materialized?: number[];
    /// The directory the host mounts materialized results in, e.g. the query result cache at `/mnt/external/cache`
    mountPrefix?: string;
    /// The attachments of the session
    attachments?: SessionPlanAttachment[];
    /// The directory the host mounts the attachments in, e.g. `/mnt/external/attachments/<session>`
    attachmentPrefix?: string;
}

/// A listener for panics of the core
export type CorePanicListener = (message: string) => void;

const corePanicListeners = new Set<CorePanicListener>();
let corePanicMessage: string | null = null;

/// Listen for panics of the core, e.g. to ask for a reload. A listener added after a panic is called right away.
///
/// A panic traps the wasm call that raised it without releasing what the call borrowed, so the catalogs, scripts
/// and sessions it touched throw on every later call. The module stays unusable until the page reloads.
/// The panic hook reports for every module of this realm, the core module and the shell module that re-exports it.
export function onCorePanic(listener: CorePanicListener): () => void {
    corePanicListeners.add(listener);
    if (corePanicMessage != null) listener(corePanicMessage);
    return () => corePanicListeners.delete(listener);
}

/// The message of the first panic of the core in this realm, null if the core did not panic
export function getCorePanic(): string | null {
    return corePanicMessage;
}

function installPanicListener(bindings: DashQLBindings) {
    (globalThis as { __dashqlCorePanic?: CorePanicListener }).__dashqlCorePanic = (message: string) => {
        corePanicMessage ??= message;
        for (const listener of corePanicListeners) {
            try {
                listener(message);
            } catch {
                // A failing listener must not hide the panic from the others
            }
        }
    };
    bindings.installPanicHook();
}

export interface DashQLModuleOptions {
    /// The wasm binary
    wasmBinary?: Uint8Array | ArrayBuffer;
    /// A precompiled wasm module, takes precedence over the binary
    module?: WebAssembly.Module;
}

interface FlatBufferObject<T, O> {
    __init(i: number, bb: flatbuffers.ByteBuffer): T;
    unpack(): O;
}

/// A native object of the wasm module
interface NativeObject {
    free(): void;
}

const ANALYZED_SCRIPT_TYPE = Symbol('ANALYZED_SCRIPT_TYPE');
const CATALOG_ENTRIES_TYPE = Symbol('CATALOG_ENTRIES_TYPE');
const CATALOG_STATISTICS_TYPE = Symbol('CATALOG_STATISTICS_TYPE');
const CATALOG_TYPE = Symbol('CATALOG_TYPE');
const COMPLETION_TYPE = Symbol('COMPLETION_TYPE');
const CURSOR_TYPE = Symbol('CURSOR_TYPE');
const SCRIPT_SESSION_TYPE = Symbol('SCRIPT_SESSION_TYPE');
const EDITOR_UPDATE_TYPE = Symbol('EDITOR_UPDATE_TYPE');
const SCRIPT_DIFF_TYPE = Symbol('SCRIPT_DIFF_TYPE');
const SCRIPT_COMPILATION_TYPE = Symbol('SCRIPT_COMPILATION_TYPE');
const EXECUTION_GRAPH_TYPE = Symbol('EXECUTION_GRAPH_TYPE');
const SCRIPT_REFERENCE_CHECK_TYPE = Symbol('SCRIPT_REFERENCE_CHECK_TYPE');
const SESSION_DATAFLOW_TYPE = Symbol('SESSION_DATAFLOW_TYPE');
const SESSION_INPUTS_TYPE = Symbol('SESSION_INPUTS_TYPE');
const TABLE_PARAMETERS_TYPE = Symbol('TABLE_PARAMETERS_TYPE');
const FLAT_CATALOG_TYPE = Symbol('FLAT_CATALOG_TYPE');
const FLAT_QUERY_PROFILE_TYPE = Symbol('FLAT_QUERY_PROFILE_TYPE');
const QUERY_PROFILE_EVENTS_TYPE = Symbol('QUERY_PROFILE_EVENTS_TYPE');
const PARSED_SCRIPT_TYPE = Symbol('PARSED_SCRIPT_TYPE');
const QUERY_PROFILE_TYPE = Symbol('QUERY_PROFILE_TYPE');
const SCRIPT_STATISTICS_TYPE = Symbol('SCRIPT_STATISTICS_TYPE');
const SCRIPT_TYPE = Symbol('SCRIPT_TYPE');

/// Pack catalog changes as `CatalogChanges`
function packCatalogChanges(changes: buffers.catalog.CatalogChangeT[]): Uint8Array {
    const list = new buffers.catalog.CatalogChangesT();
    list.changes = changes;
    const builder = new flatbuffers.Builder();
    builder.finish(list.pack(builder));
    return builder.asUint8Array();
}

/// Load the wasm binary next to this module
async function loadDefaultWasm(): Promise<Uint8Array | URL> {
    const url = new URL('./wasm/dashql_core.wasm', import.meta.url);
    if (url.protocol === 'file:') {
        // Node: fetch does not support file URLs. The specifier is not static to keep bundlers away.
        const fs = 'node:fs/promises';
        const { readFile } = await import(/* @vite-ignore */ fs);
        return new Uint8Array(await readFile(url));
    }
    return url;
}

export class DashQL {
    encoder: TextEncoder;
    decoder: TextDecoder;
    /// The wasm-bindgen module
    bindings: DashQLBindings;
    /// The native objects owned by this instance, held weakly. Freeing a native object releases its memory and
    /// leaves the catalog as it is, so a script or session that misses its `destroy()` is freed by the finalizer of
    /// wasm-bindgen once it is unreachable.
    registeredMemory: Set<WeakRef<Ptr<symbol>>>;
    /// The entries of `registeredMemory` by object
    registeredMemoryRefs: WeakMap<Ptr<symbol>, WeakRef<Ptr<symbol>>>;
    /// Removes the entries of collected objects from `registeredMemory`
    registeredMemoryCleanup: FinalizationRegistry<WeakRef<Ptr<symbol>>>;

    public constructor(bindings: DashQLBindings) {
        this.encoder = new TextEncoder();
        this.decoder = new TextDecoder();
        this.bindings = bindings;
        this.registeredMemory = new Set();
        this.registeredMemoryRefs = new WeakMap();
        this.registeredMemoryCleanup = new FinalizationRegistry(ref => this.registeredMemory.delete(ref));
        installPanicListener(bindings);
    }

    /// Create a DashQL instance.
    /// A wasm-bindgen module is instantiated once per JS module: instances share the wasm memory
    /// but own their native objects independently.
    public static async create(options?: DashQLModuleOptions): Promise<DashQL> {
        const moduleOrPath = options?.module ?? options?.wasmBinary ?? await loadDefaultWasm();
        await glue.default({ module_or_path: moduleOrPath });
        // A plain copy of the module namespace, the namespace itself is frozen
        return new DashQL({ ...glue });
    }

    public registerMemory(ptr: Ptr<symbol>) {
        const ref = new WeakRef(ptr);
        this.registeredMemory.add(ref);
        this.registeredMemoryRefs.set(ptr, ref);
        this.registeredMemoryCleanup.register(ptr, ref, ref);
    }
    public unregisterMemory(ptr: Ptr<symbol>) {
        const ref = this.registeredMemoryRefs.get(ptr);
        if (ref == null) return;
        this.registeredMemory.delete(ref);
        this.registeredMemoryRefs.delete(ptr);
        this.registeredMemoryCleanup.unregister(ref);
    }
    /// Destroy all native objects of this instance.
    /// Test-only teardown helper; JS objects that still reference them become null pointers.
    /// Objects are freed in reverse registration order, scripts before their catalogs.
    public resetUnsafe() {
        const entries = Array.from(this.registeredMemory);
        for (let i = entries.length - 1; i >= 0; --i) {
            try {
                entries[i].deref()?.destroy();
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        this.registeredMemory = new Set();
    }

    public processBatch(request: BatchRequest): BatchResult {
        return decodeBatchResult(this.bindings.processBatch(encodeBatchRequest(request)));
    }

    public createScript(
        catalog: DashQLCatalog,
        _databaseName: string | null = null,
        _schemaName: string | null = null,
    ): DashQLScript {
        const native = new this.bindings.Script(catalog.ptr.assertNotNull());
        return new DashQLScript(new Ptr(SCRIPT_TYPE, this, native));
    }

    public createCatalog(): DashQLCatalog {
        return new DashQLCatalog(new Ptr(CATALOG_TYPE, this, new this.bindings.Catalog()));
    }

    public createScriptSession(
        catalog: DashQLCatalog,
        offsetUnit = buffers.editor.EditorOffsetUnit.UTF16_CODE_UNITS,
    ): DashQLScriptSession {
        const native = new this.bindings.ScriptSession(catalog.ptr.assertNotNull(), offsetUnit);
        return new DashQLScriptSession(new Ptr(SCRIPT_SESSION_TYPE, this, native));
    }

    /// Create a script session that takes over the catalog entry id of a script session of another
    /// catalog, e.g. when a script moves to another connection. The entry id must not be in use in
    /// the catalog.
    public createScriptSessionWithEntryId(
        catalog: DashQLCatalog,
        entryId: number,
        offsetUnit = buffers.editor.EditorOffsetUnit.UTF16_CODE_UNITS,
    ): DashQLScriptSession {
        const native = this.bindings.ScriptSession.withEntryId(catalog.ptr.assertNotNull(), offsetUnit, entryId);
        return new DashQLScriptSession(new Ptr(SCRIPT_SESSION_TYPE, this, native));
    }

    /// Build the native request of a session plan, the caller frees it
    private buildSessionPlanRequest(request: SessionPlanRequest): InstanceType<DashQLBindings['SessionPlanRequest']> {
        const native = new this.bindings.SessionPlanRequest();
        try {
            for (const connection of request.connections) {
                if (connection.catalog.ptr.api !== this) {
                    throw new Error('planner catalog belongs to a different DashQL instance');
                }
                native.addConnection(connection.id, connection.local, connection.catalog.ptr.assertNotNull(), connection.dialect ?? buffers.formatting.FormattingDialect.HYPER);
            }
            for (const script of request.scripts) {
                if (!(script.session instanceof DashQLScriptSession)) {
                    throw new TypeError('planner script must be a DashQLScriptSession');
                }
                if (script.session.ptr.api !== this) {
                    throw new Error('planner session belongs to a different DashQL instance');
                }
                native.addScript(script.name, script.connection, script.session.ptr.assertNotNull(), script.materializationFile);
            }
            if (request.targets != null) {
                native.setTargets(Uint32Array.from(request.targets));
            }
            native.setMaterialized(Uint32Array.from(request.materialized ?? []));
            native.setMountPrefix(request.mountPrefix ?? '');
            native.setAttachmentPrefix(request.attachmentPrefix ?? '');
            for (const attachment of request.attachments ?? []) {
                native.addAttachment(attachment.name, attachment.file, attachment.stamp, attachment.columns ?? undefined);
            }
            return native;
        } catch (e) {
            native.free();
            throw e;
        }
    }

    /// Plan the scripts of a session across connections. The scripts reference each other by name with table
    /// parameters (`:foo`), see docs/design/planner.md. Without targets, the plan covers the whole session.
    public planSession(request: SessionPlanRequest): FlatBufferPtr<buffers.execution.ExecutionGraph> {
        const native = this.buildSessionPlanRequest(request);
        try {
            return new FlatBufferPtr(EXECUTION_GRAPH_TYPE, this, this.bindings.planSession(native), () => new buffers.execution.ExecutionGraph());
        } finally {
            native.free();
        }
    }

    /// Check the script references of every script of a session whose analysis is current with its text, like a
    /// plan of the session would, see docs/design/script_references.md. The text spans are in the offset unit of the
    /// session of each script. Ignores the targets, the materialized scripts and the mount prefix.
    public checkScriptReferences(request: SessionPlanRequest): FlatBufferPtr<buffers.execution.ScriptReferenceCheck> {
        const native = this.buildSessionPlanRequest(request);
        try {
            return new FlatBufferPtr(SCRIPT_REFERENCE_CHECK_TYPE, this, this.bindings.checkScriptReferences(native), () => new buffers.execution.ScriptReferenceCheck());
        } finally {
            native.free();
        }
    }

    /// Derive the dataflow of the scripts of a session: the statements of the scripts and the edges between them,
    /// see docs/design/dataflow.md. Takes every analysis that is current with the text of its script. The text spans
    /// are in the offset unit of the session of each script. Ignores the targets, the materialized scripts and the
    /// mount prefix.
    public deriveSessionDataflow(request: SessionPlanRequest): FlatBufferPtr<buffers.execution.SessionDataflow> {
        const native = this.buildSessionPlanRequest(request);
        try {
            return new FlatBufferPtr(SESSION_DATAFLOW_TYPE, this, this.bindings.deriveSessionDataflow(native), () => new buffers.execution.SessionDataflow());
        } finally {
            native.free();
        }
    }

    /// Collect the inputs of the scripts of a session, the named scalar parameters and their values, see
    /// docs/design/session_inputs.md. Takes every analysis that is current with the text of its script. Ignores the
    /// targets, the materialized scripts and the mount prefix.
    public collectSessionInputs(request: SessionPlanRequest): FlatBufferPtr<buffers.execution.SessionInputs> {
        const native = this.buildSessionPlanRequest(request);
        try {
            return new FlatBufferPtr(SESSION_INPUTS_TYPE, this, this.bindings.collectSessionInputs(native), () => new buffers.execution.SessionInputs());
        } finally {
            native.free();
        }
    }

    /// The literal of the value of an input control in the Hyper dialect, the value of an `@param` tag: a number,
    /// `true` or `false`, a date, a time, a timestamp, an interval or a string, as the type of the input says. Without
    /// a type a number is a number, `true` and `false` are booleans, and any other value is a string. The type is its
    /// SQL text, `SqlType.sql`. Throws if the type doesn't read the value.
    public inputLiteral(value: string, type: string | null): string {
        return this.bindings.inputLiteral(value, type ?? undefined);
    }

    /// Create the table parameters of a session, the tables that `:foo` in table position reads
    public createTableParameters(): DashQLTableParameters {
        return new DashQLTableParameters(new Ptr(TABLE_PARAMETERS_TYPE, this, new this.bindings.TableParameters()));
    }

    /// Quote an identifier if it would not read back unquoted, e.g. the name of a script reference `:"foo-2"`
    public quoteIdentifier(text: string): string {
        return this.bindings.quoteIdentifier(text);
    }

    /// Quote a column name for a column reference in SQL text, also quotes keywords that are not unreserved, e.g. `"user"`
    public quoteColumnName(text: string): string {
        return this.bindings.quoteColumnName(text);
    }

    public createQueryProfile(layoutConfig: buffers.profile.ProfileLayoutConfigT): DashQLQueryProfile {
        const ptr = new Ptr(QUERY_PROFILE_TYPE, this, new this.bindings.QueryProfile());
        return new DashQLQueryProfile(ptr, layoutConfig);
    }

    /// Append catalog changes to catalog changes SQL, returns the compacted SQL
    public appendCatalogChangesSql(changesSql: string, changes: buffers.catalog.CatalogChangeT[]): string {
        return this.bindings.appendCatalogChangesSql(changesSql, packCatalogChanges(changes));
    }

    /// Fill the missing database and schema names of catalog changes with the defaults of a connection
    public qualifyCatalogChanges(changes: buffers.catalog.CatalogChangeT[], defaults: CatalogNameDefaults): buffers.catalog.CatalogChangeT[] {
        const bytes = this.bindings.qualifyCatalogChanges(packCatalogChanges(changes), defaults.databaseName, defaults.schemaName);
        return buffers.catalog.CatalogChanges.getRootAsCatalogChanges(new flatbuffers.ByteBuffer(bytes)).unpack().changes;
    }
}

export const NULL_POINTER_EXCEPTION = new Error('tried to access a null pointer');

/// A script of the table parameters of a session
export interface TableParametersScript {
    /// The script name, `foo` for `foo.sql`
    name: string;
    /// The script session
    session: DashQLScriptSession;
}

/// The table parameters of a session: the tables that `:foo` in table position reads, the output columns of the
/// scripts that are a single SELECT. The analyzer resolves columns through them and completion offers their names
/// after `:`. See docs/design/script_references.md.
export class DashQLTableParameters {
    public readonly ptr: Ptr<typeof TABLE_PARAMETERS_TYPE>;

    public constructor(ptr: Ptr<typeof TABLE_PARAMETERS_TYPE>) {
        this.ptr = ptr;
    }
    public destroy(): void {
        this.ptr.destroy();
    }
    /// Derive the table parameters from the analyses of the scripts and the attachments and give them to the sessions
    /// of the scripts. Returns the indexes of the scripts whose analysis is outdated by them.
    public publish(scripts: TableParametersScript[], attachments: SessionPlanAttachment[] = []): number[] {
        const api = this.ptr.api;
        const native = new api.bindings.SessionPlanRequest();
        try {
            for (const script of scripts) {
                if (script.session.ptr.api !== api) {
                    throw new Error('script session belongs to a different DashQL instance');
                }
                native.addScript(script.name, 0, script.session.ptr.assertNotNull(), undefined);
            }
            for (const attachment of attachments) {
                native.addAttachment(attachment.name, attachment.file, attachment.stamp, attachment.columns ?? undefined);
            }
            return Array.from(this.ptr.assertNotNull().publish(native));
        } finally {
            native.free();
        }
    }
    /// Give the table parameters to a session that is no script of the session, e.g. a draft. Returns whether the
    /// analysis of the session is outdated by them.
    public attach(session: DashQLScriptSession): boolean {
        return this.ptr.assertNotNull().attach(session.ptr.assertNotNull());
    }
}

/// An owned native object of the wasm module
export class Ptr<T extends symbol, O extends NativeObject = any> {
    /// The object type
    public readonly type: T;
    /// The DashQL api
    public readonly api: DashQL;
    /// The native object
    private object: O | null;

    public constructor(type: T, api: DashQL, object: O) {
        this.type = type;
        this.api = api;
        this.object = object;
        api.registerMemory(this);
    }
    /// Delete the object
    public destroy() {
        const object = this.object;
        if (object == null) {
            return;
        }
        this.object = null;
        this.api.unregisterMemory(this);
        object.free();
    }
    /// Make sure the object was not deleted
    public assertNotNull(): O {
        if (this.object == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        return this.object;
    }
    /// Is null?
    public isNull(): boolean {
        return this.object == null;
    }
    /// Get the object
    public get(): O | null {
        return this.object;
    }
}

/// A FlatBuffer returned by the wasm module. The bytes are owned by JS.
export class FlatBufferPtr<T extends FlatBufferObject<T, O>, O = any> {
    /// The object type
    public readonly type: symbol;
    /// The DashQL api
    public readonly api: DashQL;
    /// The bytes
    private readonly bytes: Uint8Array;
    /// The factory
    factory: () => T;

    public constructor(type: symbol, api: DashQL, bytes: Uint8Array, factory: () => T) {
        this.type = type;
        this.api = api;
        this.bytes = bytes;
        this.factory = factory;
    }
    /// The data length
    public get dataLength(): number {
        return this.bytes.byteLength;
    }
    /// Get the data
    public get data(): Uint8Array {
        return this.bytes;
    }
    /// Copy the data into a buffer
    public copy(): Uint8Array {
        return this.data.slice();
    }
    /// Equals a different flatbuffer ptr?
    public equals(other: FlatBufferPtr<T>): boolean {
        return this === other;
    }
    // Get the flatbuffer object
    // C.f. getRootAsAnalyzedScript
    public read(obj: T | null = null): T {
        obj = obj ?? this.factory();
        const bb = new flatbuffers.ByteBuffer(this.data);
        return obj.__init(bb.readInt32(bb.position()) + bb.position(), bb);
    }
    // Get the flatbuffer object and unpack it
    public unpack(obj: T | null = null): O {
        return this.read(obj).unpack();
    }
}

export class ParserError extends Error {
    public parsed: FlatBufferPtr<buffers.parser.ParsedScript>;
    constructor(parsed: FlatBufferPtr<buffers.parser.ParsedScript>, firstError: buffers.parser.Error) {
        super(firstError.message()!);
        this.parsed = parsed;
    }
}

type NativeScriptSession = glue.ScriptSession;
type NativeScript = glue.Script;
type NativeCatalog = glue.Catalog;
type NativeQueryProfile = glue.QueryProfile;

/// The names that qualify the relations of unqualified statements, they depend on the connection
export interface CatalogNameDefaults {
    /// The database of relations without a database name
    databaseName: string;
    /// The schema of relations without a schema name
    schemaName: string;
}

export class DashQLScriptSession {
    public readonly ptr: Ptr<typeof SCRIPT_SESSION_TYPE, NativeScriptSession>;
    public readonly catalog_entry_id: number;
    /// The latest update that carries an analysis. Events name its version, so the core leaves an unchanged
    /// analysis out and the update reuses the arrays of this one.
    private lastAnalysis: buffers.editor.EditorUpdateT | null = null;

    public constructor(ptr: Ptr<typeof SCRIPT_SESSION_TYPE, NativeScriptSession>) {
        this.ptr = ptr;
        this.catalog_entry_id = ptr.assertNotNull().catalogEntryId();
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    public getCatalogEntryId(): number {
        return this.ptr.assertNotNull().catalogEntryId();
    }

    public getText(): string {
        return this.ptr.assertNotNull().text();
    }

    public getTextVersion(): bigint {
        return this.ptr.assertNotNull().textVersion();
    }

    /// The named table parameters of the analysis that reference scripts, `:foo`, with the index of the script that
    /// each finds among `names` like the planner does, null if none. In text order and in the offset unit of the
    /// session. Positional parameters and the targets of writes reference no script. Empty if the analysis lags
    /// behind the text.
    public findScriptReferences(names: readonly string[]): { from: number; to: number; script: number | null }[] {
        const flat = this.ptr.assertNotNull().findScriptReferences([...names]);
        const out: { from: number; to: number; script: number | null }[] = [];
        for (let i = 0; i + 2 < flat.length; i += 3) {
            out.push({ from: flat[i], to: flat[i] + flat[i + 1], script: flat[i + 2] === 0xFFFFFFFF ? null : flat[i + 2] });
        }
        return out;
    }

    public getStateRevision(): bigint {
        return this.ptr.assertNotNull().stateRevision();
    }

    public getCatalogRevision(): bigint {
        return this.ptr.assertNotNull().catalogRevision();
    }

    public replaceText(expectedTextVersion: bigint, text: string): buffers.editor.EditorUpdateT {
        return this.readUpdate(this.ptr.assertNotNull().replaceText(expectedTextVersion, text));
    }

    /// Apply an editor event. The session sets the known analysis of the event.
    public apply(event: buffers.editor.EditorEventT): buffers.editor.EditorUpdateT {
        const session = this.ptr.assertNotNull();
        event.knownAnalysis = this.lastAnalysis == null
            ? null
            : new buffers.editor.EditorAnalysisVersionT(this.lastAnalysis.textVersion, this.lastAnalysis.catalogRevision);
        const builder = new flatbuffers.Builder();
        builder.finish(event.pack(builder));
        return this.readUpdate(session.apply(builder.asUint8Array()));
    }

    public setCursor(expectedTextVersion: bigint, offset: bigint): buffers.editor.EditorUpdateT {
        return this.readUpdate(this.ptr.assertNotNull().setPrimaryCursor(expectedTextVersion, offset));
    }

    public analyze(): buffers.editor.EditorUpdateT {
        return this.readUpdate(this.ptr.assertNotNull().analyze());
    }

    public completeAtCursor(limit: number, keywordCase = buffers.formatting.KeywordCase.LOWER): FlatBufferPtr<buffers.completion.Completion> {
        const bytes = this.ptr.assertNotNull().completeAtCursor(limit, keywordCase);
        return new FlatBufferPtr(COMPLETION_TYPE, this.ptr.api, bytes, () => new buffers.completion.Completion());
    }

    public compileQuery(
        config: buffers.formatting.FormattingConfigT,
        allowExtensions: boolean = true,
        parseIfOutdated: boolean = true,
    ): FlatBufferPtr<buffers.execution.ScriptCompilationResult> {
        const bytes = this.ptr.assertNotNull().compileQuery(
            config.dialect,
            config.mode,
            config.maxWidth,
            config.indentationWidth,
            allowExtensions,
            parseIfOutdated,
        );
        return new FlatBufferPtr(SCRIPT_COMPILATION_TYPE, this.ptr.api, bytes, () => new buffers.execution.ScriptCompilationResult());
    }

    public format(
        config: buffers.formatting.FormattingConfigT,
        catalog: DashQLCatalog | null = null,
        parseIfOutdated: boolean = true,
    ): DashQLScript {
        const self = this.ptr.assertNotNull();
        const args = [
            config.dialect,
            config.mode,
            config.maxWidth,
            config.indentationWidth,
            config.debugMode,
            config.keywordCase,
            parseIfOutdated,
        ] as const;
        const native = catalog == null ? self.format(...args) : self.formatInto(...args, catalog.ptr.assertNotNull());
        return new DashQLScript(new Ptr(SCRIPT_TYPE, this.ptr.api, native));
    }

    /// The annotation of a statement: the comment tags in front of it.
    public readAnnotation(statementId: number, parseIfOutdated: boolean = true): ScriptAnnotation {
        return JSON.parse(this.ptr.assertNotNull().readAnnotation(statementId, parseIfOutdated)) as ScriptAnnotation;
    }

    /// Replace the annotation of a statement, printed as one comment in place of its tagged comments. An empty
    /// annotation removes them. Returns the new text, the session is not changed.
    public rewriteAnnotation(statementId: number, annotation: ScriptAnnotation, parseIfOutdated: boolean = true): string {
        return this.ptr.assertNotNull().rewriteAnnotation(statementId, JSON.stringify(annotation), parseIfOutdated);
    }

    /// Set the dashboard placement of a query, its `@board` tag. Returns the new text, the script is not changed.
    public rewriteVisBoard(
        statementId: number,
        row: number | null,
        column: number | null,
        width: number,
        height: number,
        parseIfOutdated: boolean = true,
    ): string {
        return this.ptr.assertNotNull().rewriteVisBoard(statementId, row ?? -1, column ?? -1, width, height, parseIfOutdated);
    }

    /// Set the placement of the script on the dataflow canvas, its `@flow` tag: the position of the box, its width and
    /// the height of its chart, each if given. Returns the new text, the script is not changed.
    public rewriteVisFlow(flow: DataflowPlacement, parseIfOutdated: boolean = true): string {
        const round = (value: number | null | undefined) => (value == null ? undefined : Math.round(value));
        return this.ptr.assertNotNull().rewriteVisFlow(
            round(flow.position?.x),
            round(flow.position?.y),
            round(flow.width),
            round(flow.height),
            parseIfOutdated,
        );
    }

    /// Remove the `@flow` tag of the script. Returns the new text, the script is not changed.
    public removeVisFlow(parseIfOutdated: boolean = true): string {
        return this.ptr.assertNotNull().removeVisFlow(parseIfOutdated);
    }

    /// Set the value of an input of the script, its `@param :name = <literal>` tag, the literal in the Hyper dialect. A
    /// new tag goes to the statement that uses the input first. Returns the new text, the script is not changed.
    public rewriteParamTag(name: string, literal: string, parseIfOutdated: boolean = true): string {
        return this.ptr.assertNotNull().rewriteParamTag(name, literal, parseIfOutdated);
    }

    /// Remove the `@param` tags of an input of the script. Returns the new text, the script is not changed.
    public removeParamTag(name: string, parseIfOutdated: boolean = true): string {
        return this.ptr.assertNotNull().removeParamTag(name, parseIfOutdated);
    }

    /// Set the renderer of a query, its `@vis vegalite` (a JSON object), `markdown` (a row template) or `table` tag.
    /// A null kind removes it. Returns the new text, the script is not changed.
    public rewriteVisRenderer(
        statementId: number,
        kind: 'vegalite' | 'markdown' | 'table' | null,
        body: string = '',
        parseIfOutdated: boolean = true,
    ): string {
        return this.ptr.assertNotNull().rewriteVisRenderer(statementId, kind ?? '', body, parseIfOutdated);
    }

    public isFullyFormattable(
        config: buffers.formatting.FormattingConfigT,
        parseIfOutdated: boolean = true,
    ): boolean {
        return this.ptr.assertNotNull().isFullyFormattable(
            config.dialect,
            config.mode,
            config.maxWidth,
            config.indentationWidth,
            config.debugMode,
            parseIfOutdated,
        );
    }

    public computeDiff(target: DashQLScript): FlatBufferPtr<buffers.diff.ScriptDiff> {
        const bytes = this.ptr.assertNotNull().computeDiff(target.ptr.assertNotNull());
        return new FlatBufferPtr(SCRIPT_DIFF_TYPE, this.ptr.api, bytes, () => new buffers.diff.ScriptDiff());
    }

    /// Publish the analysis into the session layer of the catalog
    public loadIntoCatalog(): void {
        this.ptr.assertNotNull().loadIntoCatalog();
    }

    public dropFromCatalog(): void {
        this.ptr.assertNotNull().dropFromCatalog();
    }

    /// Read an update. An update that leaves the analysis out takes the arrays of the known analysis, so an
    /// unchanged analysis keeps its identity.
    private readUpdate(bytes: Uint8Array): buffers.editor.EditorUpdateT {
        const update = new FlatBufferPtr<buffers.editor.EditorUpdate, buffers.editor.EditorUpdateT>(
            EDITOR_UPDATE_TYPE,
            this.ptr.api,
            bytes,
            () => new buffers.editor.EditorUpdate(),
        ).unpack();
        if (update.analysisOmitted && this.lastAnalysis != null) {
            update.diagnostics = this.lastAnalysis.diagnostics;
            update.syntaxSpans = this.lastAnalysis.syntaxSpans;
            update.vegaliteSpecs = this.lastAnalysis.vegaliteSpecs;
            update.commentTags = this.lastAnalysis.commentTags;
            update.semanticSpans = this.lastAnalysis.semanticSpans;
            update.scriptAnnotations = this.lastAnalysis.scriptAnnotations;
            update.processingStatistics = this.lastAnalysis.processingStatistics;
        } else if (update.analysisAvailable) {
            this.lastAnalysis = update;
        }
        return update;
    }
}

export class DashQLScript {
    public readonly ptr: Ptr<typeof SCRIPT_TYPE, NativeScript>;
    public readonly catalog_entry_id: number;

    public constructor(ptr: Ptr<typeof SCRIPT_TYPE, NativeScript>) {
        this.ptr = ptr;
        this.catalog_entry_id = ptr.assertNotNull().catalogEntryId();
    }
    /// Delete the script, this drops it from its catalog
    public destroy() {
        this.ptr.destroy();
    }
    /// Get the script id
    public getCatalogEntryId(): number {
        return this.ptr.assertNotNull().catalogEntryId();
    }
    /// Whether formatting can complete without unsupported-node placeholders.
    public isFullyFormattable(config: buffers.formatting.FormattingConfigT, parseIfOutdated: boolean = true): boolean {
        return this.ptr.assertNotNull().isFullyFormattable(
            config.dialect,
            config.mode,
            config.maxWidth,
            config.indentationWidth,
            config.debugMode,
            parseIfOutdated,
        );
    }
    /// AST node ids that prevent formatting.
    public getUnformattableNodes(config: buffers.formatting.FormattingConfigT, parseIfOutdated: boolean = true): number[] {
        return Array.from(this.ptr.assertNotNull().getUnformattableNodes(
            config.dialect,
            config.mode,
            config.maxWidth,
            config.indentationWidth,
            config.debugMode,
            parseIfOutdated,
        ));
    }
    /// Insert text at a code point offset
    public insertTextAt(offset: number, text: string) {
        this.ptr.assertNotNull().insertTextAt(offset, text);
    }
    /// Erase a range of code points
    public eraseTextRange(offset: number, length: number) {
        this.ptr.assertNotNull().eraseTextRange(offset, length);
    }
    /// Replace the text
    public replaceText(text: string) {
        this.ptr.assertNotNull().replaceText(text);
    }
    /// Convert the script, or a UTF-8 byte range of it, to a string.
    public toString(offset?: number, length?: number): string {
        return this.ptr.assertNotNull().toString(offset, length);
    }
    /// Return the first parsed statement without its separator or surrounding trivia.
    public getStatementText(parseIfOutdated: boolean = true): string {
        return this.ptr.assertNotNull().getStatementText(parseIfOutdated);
    }
    /// The annotation of a statement: the comment tags in front of it.
    public readAnnotation(statementId: number, parseIfOutdated: boolean = true): ScriptAnnotation {
        return JSON.parse(this.ptr.assertNotNull().readAnnotation(statementId, parseIfOutdated)) as ScriptAnnotation;
    }
    /// Replace the annotation of a statement, printed as one comment in place of its tagged comments. An empty
    /// annotation removes them. Returns the new text, the script is not changed.
    public rewriteAnnotation(statementId: number, annotation: ScriptAnnotation, parseIfOutdated: boolean = true): string {
        return this.ptr.assertNotNull().rewriteAnnotation(statementId, JSON.stringify(annotation), parseIfOutdated);
    }
    /// Visualize the terminal query with a Vega-Lite spec, a JSON object: replace its `@vis vegalite`,
    /// `markdown` or `table` tag in the text, or insert a `@vis vegalite` comment. Returns the UTF-8 byte
    /// range of the written tag in the new text.
    public rewriteVegaLite(spec: string, parseIfOutdated: boolean = true): { offset: number; length: number } {
        const [offset, length] = this.ptr.assertNotNull().rewriteVegaLite(spec, parseIfOutdated);
        return { offset, length };
    }
    /// Compile the script into an executable query.
    public compileQuery(
        config: buffers.formatting.FormattingConfigT,
        allowExtensions: boolean = true,
        parseIfOutdated: boolean = true,
    ): FlatBufferPtr<buffers.execution.ScriptCompilationResult> {
        const bytes = this.ptr.assertNotNull().compileQuery(
            config.dialect,
            config.mode,
            config.maxWidth,
            config.indentationWidth,
            allowExtensions,
            parseIfOutdated,
        );
        return new FlatBufferPtr(SCRIPT_COMPILATION_TYPE, this.ptr.api, bytes, () => new buffers.execution.ScriptCompilationResult());
    }
    /// Parse the script
    public parse() {
        this.ptr.assertNotNull().parse();
    }
    /// Analyze the script (throws exception on error)
    public analyze(parseIfOutdated: boolean = true) {
        this.ptr.assertNotNull().analyze(parseIfOutdated);
    }
    /// Get the parsed script
    public getParsed(): FlatBufferPtr<buffers.parser.ParsedScript> {
        const bytes = this.ptr.assertNotNull().getParsed();
        return new FlatBufferPtr(PARSED_SCRIPT_TYPE, this.ptr.api, bytes, () => new buffers.parser.ParsedScript());
    }
    /// Get the analyzed script
    public getAnalyzed(): FlatBufferPtr<buffers.analyzer.AnalyzedScript> {
        const bytes = this.ptr.assertNotNull().getAnalyzed();
        return new FlatBufferPtr(ANALYZED_SCRIPT_TYPE, this.ptr.api, bytes, () => new buffers.analyzer.AnalyzedScript());
    }
    /// Compute a statement-level semantic diff from this (source/old) script to another (target/new) script
    public computeDiff(target: DashQLScript): FlatBufferPtr<buffers.diff.ScriptDiff> {
        const bytes = this.ptr.assertNotNull().computeDiff(target.ptr.assertNotNull());
        return new FlatBufferPtr(SCRIPT_DIFF_TYPE, this.ptr.api, bytes, () => new buffers.diff.ScriptDiff());
    }
    /// Move the cursor
    public moveCursor(textOffset: number): FlatBufferPtr<buffers.cursor.ScriptCursor> {
        const bytes = this.ptr.assertNotNull().moveCursor(textOffset);
        return new FlatBufferPtr(CURSOR_TYPE, this.ptr.api, bytes, () => new buffers.cursor.ScriptCursor());
    }
    /// Complete at the cursor
    public completeAtCursor(limit: number, keywordCase = buffers.formatting.KeywordCase.LOWER): FlatBufferPtr<buffers.completion.Completion> {
        const bytes = this.ptr.assertNotNull().completeAtCursor(limit, keywordCase);
        return new FlatBufferPtr(COMPLETION_TYPE, this.ptr.api, bytes, () => new buffers.completion.Completion());
    }
    /// Try to complete at cursor
    public tryCompleteAtCursor(limit: number): FlatBufferPtr<buffers.completion.Completion> | null {
        try {
            return this.completeAtCursor(limit);
        } catch (e: unknown) {
            return null;
        }
    }
    /// Get the script statistics.
    /// Timings are useless in some browsers today.
    /// For example, Firefox rounds to millisecond precision, so all our step timings will be 0 for most foundations.
    /// One way out might be COEP but we cannot easily set that with GitHub pages.
    /// https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/High_precision_timing#reduced_precision
    public getStatistics(): FlatBufferPtr<buffers.statistics.ScriptStatistics> {
        const bytes = this.ptr.assertNotNull().getStatistics();
        return new FlatBufferPtr(SCRIPT_STATISTICS_TYPE, this.ptr.api, bytes, () => new buffers.statistics.ScriptStatistics());
    }
    /// Format the script
    public format(
        config: buffers.formatting.FormattingConfigT,
        catalog: DashQLCatalog | null = null,
        parseIfOutdated: boolean = true,
    ): DashQLScript {
        const self = this.ptr.assertNotNull();
        const args = [
            config.dialect,
            config.mode,
            config.maxWidth,
            config.indentationWidth,
            config.debugMode,
            config.keywordCase,
            parseIfOutdated,
        ] as const;
        const native = catalog == null ? self.format(...args) : self.formatInto(...args, catalog.ptr.assertNotNull());
        return new DashQLScript(new Ptr(SCRIPT_TYPE, this.ptr.api, native));
    }
}

export class DashQLCatalogSnapshotReader {
    public catalogReader: buffers.catalog.FlatCatalog;
    nameDictionary: (string | null)[];

    /// Construct a snapshot reader with a name dictionary
    constructor(catalog: buffers.catalog.FlatCatalog, nameDictionary: (string | null)[]) {
        this.catalogReader = catalog;
        this.nameDictionary = nameDictionary;
    }
    /// Read a name
    public readName(nameId: number): string {
        let name = this.nameDictionary[nameId];
        if (name == null) {
            name = this.catalogReader.nameDictionary(nameId);
            this.nameDictionary[nameId] = name;
        }
        return name;
    }
}

export class DashQLCatalogSnapshot {
    public ptr: FlatBufferPtr<buffers.catalog.FlatCatalog>;
    nameDictionary: (string | null)[];

    constructor(snapshot: FlatBufferPtr<buffers.catalog.FlatCatalog>) {
        this.ptr = snapshot;
        this.nameDictionary = [];
    }
    /// Read a snapshot
    public read(): DashQLCatalogSnapshotReader {
        const reader = this.ptr.read();
        return new DashQLCatalogSnapshotReader(reader, this.nameDictionary);
    }
}

function assertUint32(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError(`${name} must be a uint32`);
    }
}

/// The bindings take a layer as u8 and would wrap other numbers
function assertLayer(layer: buffers.catalog.CatalogLayer): void {
    if (buffers.catalog.CatalogLayer[layer] === undefined) {
        throw new RangeError(`invalid catalog layer: ${layer}`);
    }
}

export class DashQLCatalog {
    public readonly ptr: Ptr<typeof CATALOG_TYPE, NativeCatalog>;
    /// The cached snapshot
    public snapshot: DashQLCatalogSnapshot | null;
    /// The version of the catalog that the cached snapshot shows
    private snapshotVersion: number | null;

    public constructor(ptr: Ptr<typeof CATALOG_TYPE, NativeCatalog>) {
        this.ptr = ptr;
        this.snapshot = null;
        this.snapshotVersion = null;
    }
    /// The version of the catalog, bumped by every change, also by the script sessions on the catalog
    public version(): number {
        return this.ptr.assertNotNull().version();
    }
    /// Delete the catalog
    public destroy() {
        this.deleteSnapshot();
        this.ptr.destroy();
    }
    /// Forget the cached snapshot
    protected deleteSnapshot() {
        this.snapshot = null;
    }
    /// Reset a catalog
    public clear(): void {
        this.deleteSnapshot();
        this.ptr.assertNotNull().clear();
    }
    public allocateEntryId(): number {
        return this.ptr.assertNotNull().allocateEntryId();
    }
    /// Publish descriptor bytes in a layer
    public replaceDescriptor(catalogEntryId: number, layer: buffers.catalog.CatalogLayer, descriptor: Uint8Array): void {
        const catalog = this.ptr.assertNotNull();
        assertUint32(catalogEntryId, 'catalogEntryId');
        assertLayer(layer);
        catalog.replaceDescriptor(catalogEntryId, layer, descriptor);
        this.deleteSnapshot();
    }
    public dropDescriptor(id: number): void {
        assertUint32(id, 'catalogEntryId');
        this.ptr.assertNotNull().dropDescriptor(id);
        this.deleteSnapshot();
    }
    /// Register an overlay from its JSON spec and return its namespace. The namespace must be free.
    public registerOverlay(spec: string): string {
        const namespace = this.ptr.assertNotNull().registerOverlay(spec);
        this.deleteSnapshot();
        return namespace;
    }
    /// Drop the overlay of a namespace
    public dropOverlay(namespace: string): void {
        this.ptr.assertNotNull().dropOverlay(namespace);
        this.deleteSnapshot();
    }
    /// Apply catalog changes to a descriptor entry, an unknown entry is created in the layer
    public applyCatalogChanges(catalogEntryId: number, layer: buffers.catalog.CatalogLayer, changes: buffers.catalog.CatalogChangeT[]): void {
        assertUint32(catalogEntryId, 'catalogEntryId');
        assertLayer(layer);
        this.ptr.assertNotNull().applyCatalogChanges(catalogEntryId, layer, packCatalogChanges(changes));
        this.deleteSnapshot();
    }
    /// Apply catalog changes SQL to a descriptor entry, an unknown entry is created in the layer
    public applyCatalogChangesSql(catalogEntryId: number, layer: buffers.catalog.CatalogLayer, changesSql: string): void {
        assertUint32(catalogEntryId, 'catalogEntryId');
        assertLayer(layer);
        this.ptr.assertNotNull().applyCatalogChangesSql(catalogEntryId, layer, changesSql);
        this.deleteSnapshot();
    }
    /// Contains an entry id?
    public containsEntryId(entryId: number): boolean {
        return this.ptr.assertNotNull().containsEntryId(entryId);
    }
    /// Describe catalog entries
    public describeEntries(): FlatBufferPtr<buffers.catalog.CatalogEntries> {
        const bytes = this.ptr.assertNotNull().describeEntries();
        return new FlatBufferPtr(CATALOG_ENTRIES_TYPE, this.ptr.api, bytes, () => new buffers.catalog.CatalogEntries());
    }
    /// Describe the catalog entries of an entry
    public describeEntriesOf(id: number): FlatBufferPtr<buffers.catalog.CatalogEntries> {
        const bytes = this.ptr.assertNotNull().describeEntriesOf(id);
        if (bytes == null) {
            throw new Error(`unknown catalog entry: ${id}`);
        }
        return new FlatBufferPtr(CATALOG_ENTRIES_TYPE, this.ptr.api, bytes, () => new buffers.catalog.CatalogEntries());
    }
    /// Export a catalog snapshot. The snapshot is cached until the version of the catalog changes, the identity of
    /// the snapshot tells when the catalog changed.
    public createSnapshot(): DashQLCatalogSnapshot {
        const version = this.version();
        if (this.snapshot != null && this.snapshotVersion === version) {
            return this.snapshot;
        }
        const bytes = this.ptr.assertNotNull().flatten();
        this.snapshot = new DashQLCatalogSnapshot(
            new FlatBufferPtr(FLAT_CATALOG_TYPE, this.ptr.api, bytes, () => new buffers.catalog.FlatCatalog()),
        );
        this.snapshotVersion = version;
        return this.snapshot;
    }
    /// Add a script to a layer of the catalog (throws exception on error)
    public loadScript(script: DashQLScript, layer: buffers.catalog.CatalogLayer) {
        assertLayer(layer);
        this.deleteSnapshot();
        this.ptr.assertNotNull().loadScript(script.ptr.assertNotNull(), layer);
    }
    /// Atomically add or replace scripts in layers of the catalog.
    public loadScripts(scripts: ReadonlyArray<readonly [DashQLScript, buffers.catalog.CatalogLayer]>): void {
        if (scripts.length === 0) {
            return;
        }
        const catalog = this.ptr.assertNotNull();
        scripts.forEach(([, layer]) => assertLayer(layer));
        const natives = scripts.map(([script, layer]) => [script.ptr.assertNotNull(), layer] as const);
        const batch = new this.ptr.api.bindings.ScriptBatch();
        try {
            for (const [script, layer] of natives) {
                batch.add(script, layer);
            }
            catalog.loadScripts(batch);
            this.deleteSnapshot();
        } finally {
            batch.free();
        }
    }
    /// Drop a script from the registry
    public dropScript(script: DashQLScript) {
        this.deleteSnapshot();
        this.ptr.assertNotNull().dropScript(script.ptr.assertNotNull());
    }
    /// Get the catalog statistics.
    public getStatistics(): FlatBufferPtr<buffers.catalog.CatalogStatistics, buffers.catalog.CatalogStatisticsT> {
        const bytes = this.ptr.assertNotNull().statistics();
        return new FlatBufferPtr(CATALOG_STATISTICS_TYPE, this.ptr.api, bytes, () => new buffers.catalog.CatalogStatistics());
    }
}

export interface DashQLQueryGraphLayoutConfig {
    boardWidth: number;
    boardHeight: number;
    cellWidth: number;
    cellHeight: number;
    tableWidth: number;
    tableHeight: number;
}

export namespace ExternalObjectID {
    export type Value = bigint;

    /// Create the external id
    export function create(context: number, value: number): bigint {
        if (context == 0xffffffff) {
            throw new Error('context id 0xFFFFFFFF is reserved');
        }
        return (BigInt(context) << 32n) | BigInt(value);
    }
    /// Get the context id
    export function getOrigin(value: Value): number {
        return Number(value >> 32n);
    }
    /// Mask index
    export function getObject(value: Value): number {
        return Number(value & 0xffffffffn);
    }
    /// Is a null id?
    export function isNull(value: Value): boolean {
        return ExternalObjectID.getObject(value) == 0xffffffff;
    }
}

export namespace ContextObjectChildID {
    export type Value = bigint;

    /// Create the external id
    export function create(parent: bigint, child: number): bigint {
        return (parent << 32n) | BigInt(child);
    }
    /// Get the context id
    export function getParent(value: Value): bigint {
        return value >> 32n;
    }
    /// Mask index
    export function getChild(value: Value): number {
        return Number(value & 0xffffffffn);
    }
}

export class DashQLQueryProfile {
    public readonly ptr: Ptr<typeof QUERY_PROFILE_TYPE, NativeQueryProfile>;
    public layout: buffers.profile.ProfileLayoutConfigT;
    public buffer: FlatBufferPtr<buffers.profile.QueryProfile, buffers.profile.QueryProfileT> | null;

    public constructor(ptr: Ptr<typeof QUERY_PROFILE_TYPE, NativeQueryProfile>, layout: buffers.profile.ProfileLayoutConfigT) {
        this.ptr = ptr;
        this.layout = layout;
        this.reconfigure(layout);
        this.buffer = null;
    }
    /// Delete the query profile
    public destroy() {
        this.ptr.destroy();
    }
    /// Reconfigure the query profile
    public reconfigure(config: buffers.profile.ProfileLayoutConfigT) {
        this.layout = config;
        this.ptr.assertNotNull().configure(
            this.layout.levelHeight,
            this.layout.nodeHeight,
            this.layout.nodeMarginHorizontal,
            this.layout.nodePaddingLeft,
            this.layout.nodePaddingRight,
            this.layout.iconWidth,
            this.layout.iconMarginRight,
            this.layout.maxLabelChars,
            this.layout.widthPerLabelChar,
            this.layout.nodeMinWidth,
            this.layout.nodeMarginVertical,
            this.layout.orientation,
            this.layout.symbolWidth,
        );
    }
    /// Lay out the loaded plan again with another layout config, e.g. the other orientation. Keeps the execution state.
    public relayout(config: buffers.profile.ProfileLayoutConfigT): FlatBufferPtr<buffers.profile.QueryProfile, buffers.profile.QueryProfileT> {
        this.reconfigure(config);
        this.ptr.assertNotNull().computeLayout();
        return this.pack();
    }
    /// Pack the query profile as FlatBuffer
    public pack(): FlatBufferPtr<buffers.profile.QueryProfile, buffers.profile.QueryProfileT> {
        const bytes = this.ptr.assertNotNull().pack();
        this.buffer = new FlatBufferPtr(FLAT_QUERY_PROFILE_TYPE, this.ptr.api, bytes, () => new buffers.profile.QueryProfile());
        return this.buffer;
    }
    /// Reset the plan
    public reset(): FlatBufferPtr<buffers.profile.QueryProfile, buffers.profile.QueryProfileT> {
        this.ptr.assertNotNull().reset();
        return this.pack();
    }
    /// Reset the execution state. The structure that was registered at runtime is dropped, so the structure is
    /// repacked.
    public resetExecution(): FlatBufferPtr<buffers.profile.QueryProfile, buffers.profile.QueryProfileT> {
        this.ptr.assertNotNull().resetExecution();
        return this.pack();
    }
    /// Load a Hyper plan. An analyzed plan carries its execution state, read it with `snapshotEvents`.
    public loadHyperPlan(plan: string): FlatBufferPtr<buffers.profile.QueryProfile, buffers.profile.QueryProfileT> {
        this.ptr.assertNotNull().loadHyperPlan(this.ptr.api.encoder.encode(plan));
        return this.pack();
    }
    /// Load a Trino plan: the fragments of `EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON)` or a QueryInfo with the plans
    /// of its stages. Resets the execution state.
    public loadTrinoPlan(plan: string): FlatBufferPtr<buffers.profile.QueryProfile, buffers.profile.QueryProfileT> {
        this.ptr.assertNotNull().loadTrinoPlan(this.ptr.api.encoder.encode(plan));
        return this.pack();
    }
    /// Start an empty model for a query of an engine, the structure appears with the progress
    public startQuery(engine: buffers.profile.ProfileEngine): FlatBufferPtr<buffers.profile.QueryProfile, buffers.profile.QueryProfileT> {
        this.ptr.assertNotNull().startQuery(engine);
        return this.pack();
    }
    /// Apply input events (their JSON form, see `ProfileInputEvent` in dashql-core-profile) and return the updates of the
    /// effective state. When the events register structure, the structure is repacked: compare the structure
    /// version of the events with the one of `buffer`.
    public applyEvents(events: string): FlatBufferPtr<buffers.profile.QueryProfileEvents> {
        const bytes = this.ptr.assertNotNull().applyEvents(this.ptr.api.encoder.encode(events));
        return this.readEvents(bytes);
    }
    /// Apply the `stats` of a Trino `/v1/statement` response (JSON) received at a time in milliseconds since epoch.
    /// New stages register fragments, the structure is then repacked.
    public applyTrinoStatementStats(stats: string, time: number): FlatBufferPtr<buffers.profile.QueryProfileEvents> {
        const bytes = this.ptr.assertNotNull().applyTrinoStatementStats(this.ptr.api.encoder.encode(stats), time);
        return this.readEvents(bytes);
    }
    /// Apply a Trino QueryInfo (JSON, pruned or not) received at a time in milliseconds since epoch: the pipelines
    /// and slot statistics of the stages. New pipelines are registered, the structure is then repacked.
    public applyTrinoQueryInfo(info: string, time: number): FlatBufferPtr<buffers.profile.QueryProfileEvents> {
        const bytes = this.ptr.assertNotNull().applyTrinoQueryInfo(this.ptr.api.encoder.encode(info), time);
        return this.readEvents(bytes);
    }
    /// Wrap packed events, repack the structure if the events belong to a newer one
    private readEvents(bytes: Uint8Array): FlatBufferPtr<buffers.profile.QueryProfileEvents> {
        if (this.buffer == null || this.buffer.read().structureVersion() !== this.ptr.assertNotNull().structureVersion()) {
            this.pack();
        }
        return new FlatBufferPtr(QUERY_PROFILE_EVENTS_TYPE, this.ptr.api, bytes, () => new buffers.profile.QueryProfileEvents());
    }
    /// The current execution state: one update per entity that has a state
    public snapshotEvents(): FlatBufferPtr<buffers.profile.QueryProfileEvents> {
        const bytes = this.ptr.assertNotNull().snapshotEvents();
        return new FlatBufferPtr(QUERY_PROFILE_EVENTS_TYPE, this.ptr.api, bytes, () => new buffers.profile.QueryProfileEvents());
    }
}
