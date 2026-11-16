import * as core from '../core/index.js';
import * as flatbuffers from 'flatbuffers';
import type * as arrow from 'apache-arrow';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { clientContextJson, createComputePlatform } from './compute/compute_platform.js';
import type { EmbeddedClientContext, EmbeddedComputeDatabase } from '../platform/platform/database/embedded_database.js';
import type { HttpClient } from '../platform/platform/http/http_client.js';
import { stringifyError, type Logger } from '../platform/platform/logger/logger.js';
import { HandleTable } from './store/handles.js';
import { RuntimeStore } from './store/runtime_store.js';
import { createRuntimeTables, isArrowTable, type PlatformTables } from './store/runtime_tables.js';
import type { UpdateScheduler } from './store/update_scheduler.js';
import { QueryChannels } from './query/query_channels.js';
import { createQueryProjection } from './query/query_projection.js';
import type { QueryResultCache } from '../platform/query/query_result_cache.js';
import { createProgressLayoutConfig } from '../platform/query/profile/profile_layout_config.js';
import type { CancelQuery, QueryExecutor, WatchQueryProfile } from '../platform/connections/query_execution_args.js';
import { createConnectionAction, type ConnectionState, type NewConnection } from '../platform/connections/connection_state.js';
import type { ConnectionParams } from '../platform/connections/connection_params.js';
import { loadClientFunctionSpec } from '../platform/connections/clfn/clfn_specs.js';
import type { OAuthFlow } from '../platform/oauth/oauth_flow.js';
import { PlatformRequests } from './platform_requests.js';
import { createRuntimeStorage, StorageWriter } from './storage/runtime_storage.js';
import type { StorageBackend } from '../platform/storage/storage_backend.js';
import { ScriptProjection, WORKBOOK_PROJECTION, WorkbookDerivedProjection } from './workbook/scripts/workbook_projection.js';
import type { ScriptData, WorkbookScripts } from '../platform/workbook/scripts/workbook_scripts.js';
import { createRunMounts } from './workbook/scripts/run_mounts.js';
import { scriptRunEvent, workbookRunError, type ScriptRunEvent } from '../platform/workbook/scripts/workbook_execution.js';
import { emptyWorkbookTables, provideWorkbookTables, WORKBOOK_TABLE_NAMES, type WorkbookTables } from '../platform/storage/workbook_tables.js';
import { provideStorageVersions } from '../platform/storage/storage_versions.js';

const LOG_CTX = 'runtime';

/// What a platform passes to the runtime: the browser, the desktop app, Node or a test. The platform creates the runtime
/// once its core is there, and owns what it passes for the lifetime of the runtime. Every member but the logger, the
/// scheduler and the core is optional, a runtime without storage keeps nothing and one without HTTP sends no requests.
export interface RuntimePlatform {
    logger: Logger;
    /// When the store takes the changes of the runtime
    scheduler: UpdateScheduler;
    /// The core of the runtime
    core: core.DashQL;
    /// Where the workbooks and connections are kept
    storage?: StorageBackend | null;
    /// The HTTP client, the query executor and the setups send their requests with it
    http?: HttpClient | null;
    /// How connectors authorize
    oauthFlow?: OAuthFlow | null;
    /// Connects the channels of the setups besides Trino, e.g. the embedded Hyper
    channels?: ChannelConnector | null;
    /// The database of the computations, the runs and the query result cache. The runtime asks for it when a task, a
    /// run or the cache first needs it and waits until the platform set it up.
    computeDatabase?: ComputeDatabaseProvider | null;
    /// The cache of query results, null without one
    resultCache?: QueryResultCache | null;
    /// The `.dashql` archives over the handle table of the runtime, e.g. `createRuntimeArchives` of
    /// `storage/workbook_archives.ts`. Without, the runtime imports and exports no archives.
    archives?: RuntimeArchivesFactory | null;
    /// Run the catalog loader, true by default. A run of the command line tool and most tests don't describe their
    /// connections.
    catalogLoader?: boolean;
}

/// The compute database of a platform, it resolves once the platform set it up
export type ComputeDatabaseProvider = () => Promise<EmbeddedComputeDatabase>;

/// Creates the `.dashql` archives of a platform over the handle table of the runtime
export type RuntimeArchivesFactory = (handles: HandleTable) => core.RuntimeArchives;

/// The source of an import: a `.dashql` archive, a workbook folder, or the workbook tables of a cloud
export type ImportSource =
    | { archive: Blob }
    | { folder: core.RuntimeImportFolder }
    | { tables: { rows: Record<string, Uint8Array>; data: { tableName: string; file: Blob | Uint8Array; crc32?: number | null }[]; errorPrefix?: string } };

/// The options of an export of a workbook, without its format
export type ExportOptions = Omit<core.ExportOptions, 'format' | 'linkBase'>;

/// Connects the channels of the setups that the runtime asks for besides Trino: the embedded Hyper, Hyper over gRPC and
/// HTTP, the Hyper of Salesforce. Node connects the embedded Hyper.
export interface ChannelConnector {
    /// Connect a channel of a setup of a connection, the object that the handle table keeps
    connect(connectionId: string, request: core.RuntimeChannelRequest): Promise<unknown>;
    /// The token of the link to a Hyper that the page holds, null without
    hyperLinkToken?(connectionId: string): string | null;
}

/// What a login of Salesforce takes besides its params and options
export interface SalesforceLogin {
    /// The flow of this login, e.g. with a window that the click of the user opened. The flow of the runtime without.
    oauthFlow?: OAuthFlow | null;
    /// Hears the steps of the login, `{ connector, type, value }` with the names of the actions of a setup
    onStep?: (step: { connector: string; type: string; value: any }) => void;
}

/// The options of the analysis of a result
export interface AnalyzeTableOptions {
    /// The connection that ran the query of the result, its query history lists the queries of the computation
    connectionId?: string | null;
    /// The client context of the queries of a result without a connection, e.g. of the connection overview
    clientContext?: EmbeddedClientContext | null;
    /// The history without a connection that lists the queries of the computation, e.g. the one of the shell
    history?: string | null;
    /// Compute the summaries of the columns, false for a table that shows no column plots
    columnAggregates?: boolean;
    /// Order the rows before the analysis settles, e.g. like the result that the result replaces
    ordering?: core.ComputationOrderBy[];
}

/// What hears a run of a workbook
export interface RunWorkbookListener {
    /// Something happened to a script of the run, by its file name
    onScript?: (file: string, event: ScriptRunEvent) => void;
    /// Set up a connection that statements run on before the first statement, e.g. with the credentials of the command
    /// line tool. The scripts of a connection whose setup rejects are skipped. A run with it takes every connection of
    /// the workbook and needs no compute database.
    prepareConnection?: (connectionId: string) => Promise<void>;
}

/// How a run ended: the outcome of the runtime, and what the platform failed with
export interface RunResult {
    outcome: core.RunOutcome;
    /// The error of a failed run: what the platform failed with, a plan error, the cancellation or the error of a failed
    /// statement
    error: unknown;
}

/// The error of a run that failed, null for a run that succeeded or didn't start
function runError(outcome: core.RunOutcome, value: unknown): unknown {
    return outcome.failure == null ? null : workbookRunError(outcome.failure, value);
}

/// Create the runtime of a platform once its core is there. The app creates it in its RuntimeProvider, the shell of
/// Hyper one without storage, the command line tool and the tests their own.
export function createRuntime(platform: RuntimePlatform): Runtime {
    return new Runtime(platform);
}

/// The runtime of DashQL (docs/design/dashql_runtime.md): the `Runtime` class of the core module with its platform
/// object, and the store that the app reads its views from. The one object that the app and the command line tool hold.
///
/// The module holds the state and the services: the computations, the connections with the histories of their queries,
/// the histories without a connection, the query executor with the description of its queries and the keys of the query
/// result cache, the setups of the connections, the catalog loader, the workbooks with their scripts, the runs of the
/// workbooks, the storage writer, the restore, the imports and the exports. This class is the platform object of the
/// module (the clock, the log, the handle table, the Arrow tables by handle, fetch, the channels of the host, the query
/// result cache, the compute database, the OAuth flows, the specs of the extensions, the storage, the files of the
/// runs, the archives), the store, and typed commands where a caller needs more than the module returns: the flush of
/// the store after a command, handles for the objects that cross. The app reads views through the store and calls the
/// module directly (`module`) for everything else.
export class Runtime {
    /// The handle table of the platform: the Arrow tables, the channels, the records of the queries of the host, the
    /// lifetimes of the computations
    readonly handles = new HandleTable();
    /// The views of the runtime
    readonly store: RuntimeStore;
    /// The commands of the storage writer of the runtime
    readonly storage: StorageWriter;
    /// What the platform passed to the runtime
    readonly platform: RuntimePlatform;
    readonly logger: Logger;
    /// The core of the runtime
    readonly core: core.DashQL;
    /// The runtime of the module. The app reads its views through the store and calls it for the commands that need
    /// nothing of this class, e.g. `stopRun`, `cancelSetup` or `dropImport`.
    readonly module: core.Runtime;
    private readonly tables: PlatformTables;
    private readonly queries: QueryChannels;
    /// The catalogs of the connections by the identity of the catalog (`catalogId` of the view of a connection), one
    /// handle each that reads only
    private readonly catalogs = new Map<number, core.DashQLCatalog>();
    /// The fetches and the OAuth flows of the runtime
    private readonly requests: PlatformRequests;
    /// The projection of the scripts of the workbooks, with the session handles of the scripts
    private readonly scriptProjection: ScriptProjection;
    private freed = false;
    private destroying: Promise<void> | null = null;

    constructor(platform: RuntimePlatform) {
        this.platform = platform;
        this.logger = platform.logger;
        this.core = platform.core;
        this.store = new RuntimeStore(this.handles, platform.scheduler, message => this.logger.error(message, {}, LOG_CTX));
        this.storage = new StorageWriter(this);
        this.requests = new PlatformRequests(platform);
        this.tables = createRuntimeTables(this.handles);
        const database = platform.computeDatabase ?? null;
        this.queries = new QueryChannels({ logger: this.logger, handles: this.handles, tables: this.tables, computeDatabase: database, resultCache: platform.resultCache ?? null });
        provideWorkbookTables(this.core);
        provideStorageVersions(this.core);
        this.module = this.core.createRuntime(this.modulePlatform(database));
        // The progress shows the plan in short panels, it grows left-to-right
        this.module.setProgressLayout(createProgressLayoutConfig());
        this.module.runCatalogLoader(platform.catalogLoader !== false);
        this.scriptProjection = new ScriptProjection(this.core, this.module);
        this.store.attach(this.module, {
            query: createQueryProjection(this.core, this.module),
            script: this.scriptProjection,
            workbook: WORKBOOK_PROJECTION,
            workbookDerived: new WorkbookDerivedProjection(),
        });
        // A catalog handle goes with the catalog of its connection
        this.store.subscribeKind('connection', () => {
            const live = new Set([...this.store.all('connection').values()].map(connection => connection.catalogId));
            for (const [catalogId, catalog] of this.catalogs) {
                if (!live.has(catalogId)) {
                    catalog.destroy();
                    this.catalogs.delete(catalogId);
                }
            }
        });
    }

    /// The platform object that the runtime of the module calls
    private modulePlatform(database: ComputeDatabaseProvider | null): core.RuntimePlatform {
        const logger = this.logger;
        const platform = this.platform;
        return {
            clock: {
                now: () => Date.now(),
                sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
            },
            log: (level, message, details, target) => logger[level](message, Object.fromEntries(details), target ?? LOG_CTX),
            handles: this.handles,
            tables: this.tables,
            compute: database == null ? null : createComputePlatform(database),
            http: this.requests.http(),
            channels: {
                ...this.queries.channels,
                connect: async (setupId, request) => {
                    // A Trino connection owns its channel in the runtime, it never asks the platform
                    if (platform.channels == null) throw new Error(`The platform connects no ${request.type} channels`);
                    return this.handles.register(await platform.channels.connect(setupId, request));
                },
                hyperLinkToken: connectionId => platform.channels?.hyperLinkToken?.(connectionId) ?? null,
            },
            resultCache: this.queries.resultCache,
            mounts: database == null ? null : createRunMounts(database, platform.resultCache ?? null, this.handles),
            crypto: {
                randomUuid: () => crypto.randomUUID(),
                sha256: async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
            },
            oauth: this.requests.oauth(),
            extensions: { loadSpec: async extension => JSON.stringify(await loadClientFunctionSpec(extension)) },
            storage: platform.storage == null ? null : createRuntimeStorage(platform.storage),
            archives: platform.archives?.(this.handles) ?? null,
            changed: urgent => this.store.changed(urgent),
        };
    }

    /// Wait for a command of the module and take its changes, the views are in the store once it settled
    private async settled<T>(command: Promise<T>): Promise<T> {
        try {
            return await command;
        } finally {
            this.store.flush();
        }
    }

    /// Apply an action to a slice. It applies at once, the views follow with the next flush. A refused action is
    /// logged. Never throws: the runtime refuses an action that it can't read. The handles that an action carries are
    /// the runtime's from the call on, it releases the ones of a refused action.
    dispatch(target: core.Target, action: core.RuntimeAction): core.DispatchOutcome {
        if (this.freed) return { ok: false, changed: false, error: 'the runtime was destroyed', id: null };
        const outcome = this.module.dispatch(target, action);
        if (!outcome.ok) this.logger.warn('The runtime refused an action', { target: JSON.stringify(target), action: action.kind, error: outcome.error ?? '' }, LOG_CTX);
        return outcome;
    }

    // The computations

    /// Analyze a result as the computation of a table: its statistics, the system columns that the filters use, the
    /// summaries of its columns and the ordering of the options. Settles once the analysis is done and its views are
    /// in the store, fails with the error of a failed task. A result without columns has nothing to analyze.
    async analyzeTable(tableId: number, table: arrow.Table, options: AnalyzeTableOptions = {}): Promise<void> {
        if (table.numCols === 0) return;
        const handle = this.handles.register(table);
        let analysis: Promise<void>;
        try {
            analysis = this.module.analyzeTable(tableId, handle, {
                connectionId: options.connectionId ?? undefined,
                clientContext: clientContextJson(options.clientContext) ?? undefined,
                history: options.history ?? undefined,
                columnAggregates: options.columnAggregates !== false,
                ordering: options.ordering,
            });
        } catch (e) {
            // The analysis didn't start, the table stays with the caller
            this.handles.release(handle);
            throw e;
        }
        await this.settled(analysis);
    }

    /// An Arrow table of the handle table, undefined for none
    table(handle: number | null | undefined): arrow.Table | undefined {
        const table = this.handles.get(handle);
        return isArrowTable(table) ? table : undefined;
    }

    // The connections

    /// Create a connection with an empty catalog, returns its view. An active connection is written into the app
    /// manifest right away.
    createConnection(connection: NewConnection, connectionId?: string): ConnectionState {
        const outcome = this.dispatch('app', createConnectionAction(connection, connectionId));
        if (!outcome.ok || typeof outcome.id !== 'string') throw new Error(outcome.error ?? 'the connection was not created');
        // The list shows the connection right away
        this.store.flush();
        const created = this.connection(outcome.id);
        if (created == null) throw new Error(`the connection ${outcome.id} was not created`);
        return created;
    }

    /// A connection as the runtime holds it now, not as the store saw it at the last flush, e.g. for a service that
    /// reads it right after an action. A connection that a task holds reads as the store saw it.
    connection(connectionId: string): ConnectionState | null {
        if (this.freed) return null;
        const view = this.module.views('connection', [connectionId])[0] ?? null;
        return (view === 'busy' ? this.store.get('connection', connectionId) : view) as ConnectionState | null;
    }

    /// The catalog of a connection, shared with the connection and the scripts that analyze with it. One handle per
    /// connection, it goes with the connection.
    catalog(connectionId: string): core.DashQLCatalog | null {
        const catalogId = this.connection(connectionId)?.catalogId;
        if (catalogId == null) return null;
        let catalog = this.catalogs.get(catalogId) ?? null;
        if (catalog == null && !this.freed) {
            catalog = this.core.runtimeCatalog(this.module, connectionId);
            if (catalog != null) this.catalogs.set(catalogId, catalog);
        }
        return catalog;
    }

    /// The channel of a connection, an object of the handle table
    channel<T>(connection: Pick<ConnectionState, 'details'> | null | undefined): T | null {
        return this.handles.get<T>(connection?.details.channel) ?? null;
    }

    /// Save a connection: the given params, else its draft, else its params. The app manifest first, the copies of
    /// the workbooks that use the connection after; the view of the connection shows the save while it runs.
    saveConnection(connectionId: string, params?: ConnectionParams): Promise<core.ConnectionSaveOutcome> {
        return this.settled(this.module.saveConnection(connectionId, params as core.JsonParams | undefined));
    }

    /// Write the copies of the last save of a connection into workbooks again, null without a save that wrote the app
    /// manifest
    retrySave(connectionId: string, workbookIds: string[]): Promise<core.ConnectionSaveOutcome | null> {
        return this.settled(this.module.retrySave(connectionId, workbookIds));
    }

    // The setups

    /// Set up a connection with its connector: the channel of its params or of the params of the options, then the
    /// health check unless the connection is online with its channel. A setup of the connection that runs is cancelled.
    /// Resolves with the outcome once its view is in the store, a failure is in the view of the connection as well.
    setupConnection(connectionId: string, options: core.SetupOptions = {}): Promise<core.SetupOutcome> {
        return this.settled(this.module.setupConnection(connectionId, options));
    }

    /// Log in to Salesforce with the params of the connector, without a connection, e.g. the login of the shell.
    /// `cancelSetup` of the module with the id stops it. The outcome of a success has the tokens and the user.
    async authenticateSalesforce(setupId: string, params: connection.SalesforceConnectionParams, options: core.SetupOptions, login: SalesforceLogin = {}): Promise<core.SetupOutcome> {
        return await this.requests.withLoginFlow(setupId, login.oauthFlow, () => this.module.authenticateSalesforce(setupId, params, options, login.onStep ?? null));
    }

    // The queries

    /// Run a query on a connection: it is in the history of the connection right away. Returns its id and its result
    /// table, null for a query without one. A test may replace it.
    execute: QueryExecutor = (connectionId, args) => {
        return this.queries.execute(this.module, connectionId, args);
    };

    /// Cancel a query, resolves once it ended. A test may replace it.
    cancel: CancelQuery = async queryId => {
        if (this.freed) return;
        await this.module.cancelQuery(queryId);
    };

    /// Show the profile of a running query: the connector then fetches the plan and its statistics (Trino). A test may
    /// replace it.
    watchProfile: WatchQueryProfile = queryId => {
        this.module.watchProfile(queryId, true);
        let watching = true;
        return () => {
            if (!watching || this.freed) return;
            watching = false;
            this.module.watchProfile(queryId, false);
        };
    };

    // The workbooks

    /// Create a workbook without scripts on a connection and write it, returns its view. The ephemeral workbook of the
    /// greeter is promoted by its first script.
    createWorkbook(connectionId: string, name: string | null, ephemeral: boolean, originalFileName?: string, workbookId?: string): WorkbookScripts {
        const outcome = this.dispatch('app', {
            kind: 'createWorkbook',
            value: { connectionId, name: name ?? undefined, ephemeral, originalFileName, workbookId },
        });
        if (!outcome.ok || typeof outcome.id !== 'string') throw new Error(outcome.error ?? 'the workbook was not created');
        this.store.flush();
        const created = this.store.get('workbook', outcome.id);
        if (created == null) throw new Error(`the workbook ${outcome.id} was not created`);
        return created;
    }

    /// Drop a workbook, its scripts leave the catalogs of their connections. Its files stay.
    deleteWorkbook(workbookId: string): void {
        this.dispatch('app', { kind: 'deleteWorkbook', value: { workbookId } });
        this.store.flush();
    }

    /// Apply an event of the editor of a script and return the update for the editor, the projection of the script
    /// holds it instead of reading it again. The event names the text version that the editor shows, an editor that
    /// missed a change of the text gets the status `STALE_TEXT_VERSION`. `known` is the update that the editor holds:
    /// the runtime leaves its analysis out if the script holds the same one, the update takes its arrays then. Null for
    /// a script that holds another session than the one the editor shows.
    applyEditorEvent(
        script: Pick<ScriptData, 'workbookId' | 'scriptKey' | 'sessionGeneration'>,
        event: core.buffers.editor.EditorEventT,
        known: core.buffers.editor.EditorUpdateT | null,
    ): core.buffers.editor.EditorUpdateT | null {
        if (this.freed) return null;
        const analysis = known?.analysisAvailable === true ? known : null;
        event.knownAnalysis = analysis == null ? null : new core.buffers.editor.EditorAnalysisVersionT(analysis.textVersion, analysis.catalogRevision);
        const builder = new flatbuffers.Builder();
        builder.finish(event.pack(builder));
        // A refused event, e.g. an edit of a cloud preview or of a busy workbook, changes nothing: the editor shows the
        // text of the script again
        let bytes: Uint8Array | undefined;
        try {
            bytes = this.module.applyEditorEvent(script.workbookId, script.scriptKey, script.sessionGeneration, builder.asUint8Array());
        } catch (e: unknown) {
            this.logger.warn('Refused an editor event', { workbookId: script.workbookId, scriptKey: script.scriptKey.toString(), error: stringifyError(e) }, 'workbook_editor');
            return null;
        }
        if (bytes == null) return null;
        const update = core.readFlatBuffer(bytes, bb => core.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb)).unpack();
        if (update.analysisOmitted && analysis != null) {
            update.diagnostics = analysis.diagnostics;
            update.syntaxSpans = analysis.syntaxSpans;
            update.vegaliteSpecs = analysis.vegaliteSpecs;
            update.commentTags = analysis.commentTags;
            update.semanticSpans = analysis.semanticSpans;
            update.scriptAnnotations = analysis.scriptAnnotations;
            update.processingStatistics = analysis.processingStatistics;
        }
        if (update.status === core.buffers.editor.EditorUpdateStatus.OK) {
            this.scriptProjection.hold(script.scriptKey, update);
        }
        return update;
    }

    /// Give the table parameters of a workbook to a session that is no script of it, e.g. the draft of the composer.
    /// Returns whether the analysis of the session is outdated by them.
    attachTableParameters(workbookId: string, session: core.DashQLScriptSession): boolean {
        return !this.freed && this.module.attachTableParameters(workbookId, session.ptr.assertNotNull());
    }

    /// Restore the connections and the workbooks of the storage, the runtime takes them. Resolves once their views are
    /// in the store.
    restore(progress?: (progress: core.RestoreProgress) => void): Promise<core.RestoreOutcome> {
        return this.settled(this.module.restore(progress ?? null));
    }

    /// Restore a single workbook of the storage against the connections of the runtime, e.g. an imported one. Rejects
    /// if it can't be restored.
    restoreWorkbook(workbookId: string): Promise<core.RestoreOutcome> {
        return this.settled(this.module.restoreWorkbook(workbookId));
    }

    /// Delete the files of a workbook that was refused a load and drop it from the list
    deleteInvalidWorkbook(workbookId: string): Promise<void> {
        return this.settled(this.module.deleteInvalidWorkbook(workbookId));
    }

    // The attachments of workbooks

    /// Attach files to a workbook: the runtime names every Parquet file past the scripts and the other attachments,
    /// writes it through its storage writer and lists it in the view of the workbook, the one list of its attachments.
    /// Resolves with the names the files got and the refused files once the view is in the store, rejects with what the
    /// storage failed with.
    attachFiles(workbookId: string, files: readonly core.AttachedFile[]): Promise<core.AttachFilesOutcome> {
        return this.settled(this.module.attachFiles(workbookId, [...files]));
    }

    /// List the attachments of a workbook again, e.g. after one was removed or renamed in the storage. Resolves once the
    /// view of the workbook is in the store.
    refreshAttachments(workbookId: string): Promise<void> {
        return this.settled(this.module.refreshAttachments(workbookId));
    }

    // The runs of workbooks

    /// Run the scripts of a workbook: all of them, the targets with what they need, or the scripts that a change of
    /// inputs affects. One run holds a workbook at a time, a run of the workbook takes its connections and starts only
    /// while they are idle; a change of inputs while the workbook is busy stops its run and starts once it is free.
    /// Resolves once the run ended and its view is in the store, `outcome.refused` tells why a run didn't start.
    async runWorkbook(workbookId: string, options: core.RunWorkbookOptions = {}, listener: RunWorkbookListener = {}): Promise<RunResult> {
        const script = listener.onScript;
        const result = await this.settled(this.module.runWorkbook(workbookId, options, {
            script: script == null ? undefined : (file, event, value) => script(file, scriptRunEvent(event, value)),
            prepareConnection: listener.prepareConnection,
        }));
        return { outcome: result.outcome, error: runError(result.outcome, result.error) };
    }

    /// Run a script of a workbook with the scripts it references, a refresh reads no cached results. A plan that fails
    /// and a run that fails before its statements show their error on the script. Resolves once the run ended and its
    /// view is in the store.
    async runScript(workbookId: string, scriptKey: number, options: core.RunScriptOptions = {}): Promise<RunResult> {
        const result = await this.settled(this.module.runScript(workbookId, scriptKey, options));
        return { outcome: result.outcome, error: runError(result.outcome, result.error) };
    }

    // The imports and exports of workbooks

    /// Export a workbook as a `.dashql` archive: the workbook tables as Parquet, the attachments and, if asked for, the
    /// cached results of the scripts. The connection params are sanitized for sharing. Resolves with the archive and
    /// the results it carries.
    async exportArchive(workbookId: string, options: ExportOptions = {}): Promise<{ archive: Blob; results: core.ExportedResults }> {
        const outcome = await this.module.exportWorkbook(workbookId, { ...options, format: 'archive' }, null);
        const archive = this.handles.get<Blob>(outcome.archive);
        if (outcome.archive != null) this.handles.release(outcome.archive);
        if (archive == null) throw new Error('the export wrote no archive');
        return { archive, results: outcome.results };
    }

    /// Export a workbook as a link that carries its archive inline, without cached results and, by default, without
    /// the catalogs. `linkBase` is the URL of the app that opens the link.
    async exportLink(workbookId: string, linkBase: string, options: Omit<ExportOptions, 'results'> = {}): Promise<string> {
        const outcome = await this.module.exportWorkbook(workbookId, { ...options, format: 'link', linkBase }, null);
        if (outcome.link == null) throw new Error('the export wrote no link');
        return outcome.link;
    }

    /// Export the workbook tables of a workbook, e.g. for a cloud. `consume` gets the rows and the Parquet files of the
    /// attachments and results, which stay readable until it settled. Resolves with the results that the tables carry.
    async exportTables(workbookId: string, options: ExportOptions, consume: (tables: WorkbookTables) => Promise<void>): Promise<core.ExportedResults> {
        const outcome = await this.module.exportWorkbook(workbookId, { ...options, format: 'tables' }, async exported => {
            const tables = emptyWorkbookTables();
            for (const name of WORKBOOK_TABLE_NAMES) (tables as unknown as Record<string, unknown>)[name] = exported.rows[name] ?? [];
            for (const entry of exported.data) {
                const file = this.handles.get<Blob | Uint8Array>(entry.file);
                if (file == null) continue;
                const bytes = file instanceof Blob ? file : new Blob([file as Uint8Array<ArrayBuffer>]);
                tables.data.set(entry.tableName, entry.crc32 == null ? { bytes } : { bytes, crc32: entry.crc32 });
            }
            await consume(tables);
        });
        return outcome.results;
    }

    /// Read a workbook to import: nothing is written until `commitImport`, `dropImport` of the module lets go of it.
    /// Resolves with the workbook, the registered workbook with the same id and the questions about its connections.
    async readImport(source: ImportSource): Promise<core.ImportPreview> {
        if (!('archive' in source)) return await this.module.readImport(source);
        const archive = this.handles.register(source.archive);
        try {
            return await this.module.readImport({ archive });
        } finally {
            this.handles.release(archive);
        }
    }

    /// Import a workbook that was read, with the answers to its questions. Resolves once the workbook was written and,
    /// unless it replaced a workbook or registered a native folder, restored and in the store.
    commitImport(importId: number, answers: core.ImportAnswers, onStep?: (step: core.ImportStep, results: core.ImportedResults | null) => void): Promise<core.ImportOutcome> {
        return this.settled(this.module.commitImport(importId, answers, onStep ?? null));
    }

    /// Was the runtime destroyed? The module is freed then, commands fail and views stay empty.
    get destroyed(): boolean {
        return this.freed;
    }

    /// Take the changes of the runtime now
    flush(): void {
        this.store.flush();
    }

    /// Stop the runtime: the runs stop, the catalog loader stops, the results that are written into the query result
    /// cache and the pending writes of the storage finish, then the queries are cancelled, the computations go, their
    /// runs are cancelled and their tables released, the requests and the OAuth flows of the platform are aborted
    destroy(): Promise<void> {
        this.destroying ??= (async () => {
            if (this.freed) return;
            this.store.flush();
            for (const workbookId of this.store.all('run').keys()) this.module.stopRun(workbookId);
            this.module.runCatalogLoader(false);
            try {
                await this.module.flushCacheWrites();
                await this.storage.flush();
            } finally {
                this.free();
            }
        })();
        return this.destroying;
    }

    /// Free the runtime of the module without waiting for its writes
    private free(): void {
        if (this.freed) return;
        this.freed = true;
        for (const catalog of this.catalogs.values()) catalog.destroy();
        this.catalogs.clear();
        this.scriptProjection.destroy();
        this.module.destroy();
        this.store.flush();
        this.module.free();
        this.store.dispose();
        this.requests.abortAll();
        this.queries.dispose();
    }
}
