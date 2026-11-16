import * as core from '../core/index.js';
import * as flatbuffers from 'flatbuffers';
import type * as arrow from 'apache-arrow';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { clientContextJson, createComputePlatform, type CreateComputeQueryExecution } from './compute/compute_platform.js';
import type { EmbeddedClientContext, EmbeddedComputeDatabase } from '../platform/platform/database/embedded_database.js';
import type { HttpClient } from '../platform/platform/http/http_client.js';
import { stringifyError, type Logger } from '../platform/platform/logger/logger.js';
import { HandleTable } from './store/handles.js';
import { RuntimeStore } from './store/runtime_store.js';
import { createRuntimeTables, isArrowTable, type PlatformTables } from './store/runtime_tables.js';
import type { UpdateScheduler } from './store/store.js';
import { QueryChannels } from './query/query_channels.js';
import type { QueryResultCache } from '../platform/query/query_result_cache.js';
import { createProgressLayoutConfig } from '../platform/query/profile/profile_layout_config.js';
import type { CancelQuery, QueryExecutor, WatchQueryProfile } from '../platform/connections/query_execution_args.js';
import { createConnectionAction, type ConnectionState, type NewConnection } from '../platform/connections/connection_state.js';
import type { ConnectionParams } from '../platform/connections/connection_params.js';
import { loadClientFunctionSpec } from '../platform/connections/clfn/clfn_specs.js';
import type { OAuthFlow, OAuthFlowEvent } from '../platform/oauth/oauth_flow.js';
import type { OAuthRedirectData } from '../platform/oauth/oauth_types.js';
import { generatePKCEChallenge } from '../platform/utils/pkce.js';
import { createRuntimeStorage, StorageWriter } from './storage/runtime_storage.js';
import type { StorageBackend } from '../platform/storage/storage_backend.js';
import { ScriptProjection, WORKBOOK_PROJECTION, WorkbookDerivedProjection } from './workbook/scripts/workbook_projection.js';
import type { ScriptData, WorkbookScripts } from '../platform/workbook/scripts/workbook_scripts.js';
import { createRunMounts } from './workbook/scripts/run_mounts.js';
import { scriptRunEvent, workbookRunError, type ScriptRunEvent } from '../platform/workbook/scripts/workbook_execution.js';
import { supportsParquet } from '../platform/platform/hyperdb/hyperdb_parquet_export.js';
import { emptyWorkbookTables, provideWorkbookTables, WORKBOOK_TABLE_NAMES, type WorkbookTables } from '../platform/storage/workbook_tables.js';
import { provideStorageVersions } from '../platform/storage/storage_versions.js';

const LOG_CTX = 'runtime';

/// What a platform passes to the runtime: the browser, the desktop app, Node or a test. Every member but the logger and
/// the scheduler is optional, a runtime without storage keeps nothing and one without HTTP sends no requests.
export interface RuntimePlatform {
    logger: Logger;
    /// When the store takes the changes of the runtime
    scheduler: UpdateScheduler;
    /// The core, or the setup of the core that the first command asks for. Without, the default core is instantiated.
    setupCore?: ((context: string) => Promise<core.DashQL>) | core.DashQL | null;
    /// Where the workbooks and connections are kept
    storage?: StorageBackend | null;
    /// The HTTP client, the query executor and the setups send their requests with it
    http?: HttpClient | null;
    /// How connectors authorize
    oauthFlow?: OAuthFlow | null;
    /// Connects the channels of the setups besides Trino, e.g. the embedded Hyper. The app sets it once its clients are
    /// there (`setChannelConnector`).
    channels?: ChannelConnector | null;
    /// The database of the computations, null until the platform set it up (`setComputeDatabase`)
    computeDatabase?: EmbeddedComputeDatabase | null;
    /// The cache of query results, null without one
    resultCache?: QueryResultCache | null;
    /// The `.dashql` archives over the handle table of the runtime, e.g. `createRuntimeArchives` of
    /// `storage/workbook_archives.ts`. Without, the runtime imports and exports no archives.
    archives?: RuntimeArchivesFactory | null;
}

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
/// HTTP, the Hyper of Salesforce. The app sets it once its clients are there, Node connects the embedded Hyper.
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

/// Create the runtime of a platform. The app creates it in its RuntimeProvider, the shell of Hyper one without storage,
/// the command line tool and the tests their own.
export function createRuntime(platform: RuntimePlatform): Runtime {
    return new Runtime(platform);
}

/// The runtime of DashQL (docs/wip/runtime_api.md): the `Runtime` class of the core module with its platform object,
/// and the store that the app reads its views from. The one object that the app and the command line tool hold.
///
/// The module holds the state and the services: the computations, the connections with the histories of their queries,
/// the histories without a connection, the query executor with the description of its queries and the keys of the query
/// result cache, the setups of the connections, the catalog loader, the workbooks with their scripts, the runs of the
/// workbooks, the storage writer, the restore, the imports and the exports. This class is the platform object of the
/// module (the clock, the log, the handle table, the Arrow tables by handle, fetch, the channels of the host, the query
/// result cache, the compute database, the OAuth flows, the specs of the extensions, the storage, the files of the
/// runs, the archives), the store, and typed commands where a caller needs more than the module returns: the core set
/// up on the first command, the flush of the store after a command, handles for the objects that cross. The app reads
/// views through the store and calls the module directly (`module`) for everything else.
///
/// The app creates the runtime before the core is set up: the views are empty and a dispatch fails until the core is
/// there, a command asks the platform for it.
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
    private readonly setupCore: ((context: string) => Promise<core.DashQL>) | null;
    private computeDatabase: EmbeddedComputeDatabase | null;
    private http: HttpClient | null;
    private readonly resultCache: QueryResultCache | null;
    private readonly tables: PlatformTables;
    private readonly queries: QueryChannels;
    private queryExecution: CreateComputeQueryExecution | null = null;
    private compute: core.ComputePlatform | null = null;
    private instance: core.DashQL | null = null;
    private runtimeModule: core.Runtime | null = null;
    private pending: Promise<core.Runtime> | null = null;
    /// The catalogs of the connections, one handle each
    private readonly catalogs = new Map<string, core.DashQLCatalog>();
    /// The fetches of the runtime by id
    private readonly fetches = new Map<number, AbortController>();
    private readonly oauthFlow: OAuthFlow | null;
    /// The flows of single logins by the id of their setup
    private readonly loginFlows = new Map<string, OAuthFlow>();
    /// The OAuth flows that run, by id
    private readonly flows = new Map<number, AbortController>();
    private channelConnector: ChannelConnector | null;
    private readonly storageBackend: StorageBackend | null;
    private runtimeStorage: core.RuntimeStorage | null = null;
    private readonly archivesFactory: RuntimeArchivesFactory | null;
    private archives: core.RuntimeArchives | null = null;
    /// The projection of the scripts of the workbooks, with the session handles of the scripts
    private scriptProjection: ScriptProjection | null = null;
    /// The files of the runs of workbooks in the compute database
    private mounts: core.RuntimeMounts | null = null;
    /// Does the catalog loader run, and the refreshes requested before the core was there
    private catalogLoading = true;
    private readonly pendingRefreshes: [string, boolean][] = [];
    private destroyed = false;

    constructor(platform: RuntimePlatform) {
        this.platform = platform;
        this.logger = platform.logger;
        this.store = new RuntimeStore(this.handles, platform.scheduler);
        this.computeDatabase = platform.computeDatabase ?? null;
        this.http = platform.http ?? null;
        this.resultCache = platform.resultCache ?? null;
        this.oauthFlow = platform.oauthFlow ?? null;
        this.channelConnector = platform.channels ?? null;
        this.storageBackend = platform.storage ?? null;
        this.archivesFactory = platform.archives ?? null;
        this.storage = new StorageWriter(this);
        this.tables = createRuntimeTables(this.handles);
        this.queries = new QueryChannels({
            logger: this.logger,
            handles: this.handles,
            tables: this.tables,
            computeDatabase: () => this.computeDatabase,
            resultCache: () => this.resultCache,
        });
        const setupCore = platform.setupCore ?? null;
        this.setupCore = typeof setupCore === 'function' ? setupCore : null;
        if (setupCore != null && typeof setupCore !== 'function') this.setCore(setupCore);
        // A catalog handle goes with its connection
        this.store.subscribeKind('connection', () => {
            for (const [connectionId, catalog] of this.catalogs) {
                if (this.store.get('connection', connectionId) == null) {
                    catalog.destroy();
                    this.catalogs.delete(connectionId);
                }
            }
        });
    }

    /// The platform object that the runtime of the module calls
    private modulePlatform(): core.RuntimePlatform {
        const logger = this.logger;
        const runtime = this;
        return {
            clock: {
                now: () => Date.now(),
                sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
            },
            log: (level, message, details, target) => logger[level](message, Object.fromEntries(details), target ?? LOG_CTX),
            handles: this.handles,
            tables: this.tables,
            get compute() {
                return runtime.computePlatform();
            },
            http: {
                fetch: (id, request) => this.fetch(id, request),
                abort: id => {
                    this.fetches.get(id)?.abort(new DOMException('The request was cancelled', 'AbortError'));
                },
            },
            channels: {
                ...this.queries.channels,
                connect: async (setupId, request) => this.handles.register(await this.connectChannel(setupId, request)),
                hyperLinkToken: connectionId => this.channelConnector?.hyperLinkToken?.(connectionId) ?? null,
            },
            get resultCache() {
                return runtime.queries.resultCache();
            },
            get mounts() {
                return runtime.runMounts();
            },
            crypto: {
                randomUuid: () => crypto.randomUUID(),
                sha256: async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
            },
            oauth: this.oauth(),
            extensions: { loadSpec: async extension => JSON.stringify(await loadClientFunctionSpec(extension)) },
            get storage() {
                return runtime.storagePlatform();
            },
            get archives() {
                return runtime.archivesPlatform();
            },
            changed: urgent => this.store.changed(urgent),
        };
    }

    /// Connect a channel of a setup with the connector of the platform. A Trino connection owns its channel in the
    /// runtime, it never asks the platform.
    private async connectChannel(connectionId: string, request: core.RuntimeChannelRequest): Promise<unknown> {
        const connector = this.channelConnector;
        if (connector == null) throw new Error(`The platform connects no ${request.type} channels`);
        return await connector.connect(connectionId, request);
    }

    /// The OAuth flows of the setups over the flow of the platform, a login may bring a flow of its own
    private oauth(): core.RuntimeOAuth {
        const flowOf = (setupId: string) => {
            const flow = this.loginFlows.get(setupId) ?? this.oauthFlow;
            if (flow == null) throw new Error('The platform has no OAuth flow');
            return flow;
        };
        const events = (onEvent: (event: string) => void) => (event: OAuthFlowEvent) => {
            try {
                onEvent(event);
            } catch {
                // The flow ended, a late event changes nothing
            }
        };
        const run = async <T>(id: number, authorize: (signal: AbortSignal) => Promise<T>): Promise<T> => {
            const abort = new AbortController();
            this.flows.set(id, abort);
            try {
                return await authorize(abort.signal);
            } finally {
                this.flows.delete(id);
            }
        };
        return {
            pkce: () => generatePKCEChallenge(),
            flowInfo: setupId => {
                const flow = this.loginFlows.get(setupId) ?? this.oauthFlow;
                return {
                    redirectVariant: flow?.redirectVariant ?? 'WEB_OPENER_FLOW',
                    redirectCallbackUrl: flow?.redirectCallbackUrl ?? null,
                    debugMode: flow?.debugMode ?? false,
                    flavor: flow?.flavor ?? null,
                };
            },
            authorizeWithLoopback: (setupId, id, url, callbackUrl, onEvent) => run(id, signal =>
                flowOf(setupId).authorizeWithLoopback(new URL(url), callbackUrl, signal, events(onEvent))),
            authorizeWithRedirectPage: (setupId, id, url, flowId, onEvent) => run(id, signal => {
                const accepts = (callback: OAuthRedirectData) => callback.state?.flowId === flowId;
                return flowOf(setupId).authorizeWithRedirectPage(new URL(url), accepts, signal, events(onEvent));
            }),
            abort: id => {
                this.flows.get(id)?.abort(new DOMException('The connection setup was cancelled', 'AbortError'));
            },
        };
    }

    /// Send a request of the runtime with the HTTP client of the platform
    private async fetch(id: number, request: core.RuntimeHttpRequest): Promise<core.RuntimeHttpResponse> {
        const http = this.http;
        if (http == null) throw new Error('the platform has no HTTP client');
        const abort = new AbortController();
        this.fetches.set(id, abort);
        try {
            const response = await http.fetch(request.url, {
                method: request.method,
                headers: request.headers,
                body: request.body ?? undefined,
                signal: abort.signal,
                sensitive: request.sensitive === true,
            });
            const headers: [string, string][] = [];
            response.headers.forEach((value, name) => headers.push([name, value]));
            const body = new Uint8Array(await response.arrayBuffer());
            return { status: response.status, statusText: response.statusText, headers, body };
        } catch (error) {
            // fetch names the reason of a failed request only in the cause, e.g. a refused connection, and the
            // runtime keeps only the message
            const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
            if (error instanceof Error && cause instanceof Error) {
                throw new Error(`${error.message}: ${cause.message}`);
            }
            throw error;
        } finally {
            this.fetches.delete(id);
        }
    }

    /// The storage of the platform over the storage backend
    private storagePlatform(): core.RuntimeStorage | null {
        if (this.runtimeStorage == null && this.storageBackend != null) {
            this.runtimeStorage = createRuntimeStorage(this.storageBackend);
        }
        return this.runtimeStorage;
    }

    /// The `.dashql` archives of the imports and exports
    private archivesPlatform(): core.RuntimeArchives | null {
        const factory = this.archivesFactory;
        if (factory == null) return null;
        this.archives ??= factory(this.handles);
        return this.archives;
    }

    /// The files of the runs of workbooks, with a compute database that reads Parquet files
    private runMounts(): core.RuntimeMounts | null {
        const database = this.computeDatabase;
        if (!supportsParquet(database)) return null;
        this.mounts ??= createRunMounts(database, this.resultCache, this.handles);
        return this.mounts;
    }

    private computePlatform(): core.ComputePlatform | null {
        if (this.compute == null && this.computeDatabase != null) {
            this.compute = createComputePlatform(this.computeDatabase, () => this.queryExecution);
        }
        return this.compute;
    }

    /// Give the runtime its core, e.g. the one that the app restores with. Later cores are ignored.
    setCore(instance: core.DashQL): void {
        if (this.destroyed || this.runtimeModule != null) return;
        this.instance = instance;
        provideWorkbookTables(instance);
        provideStorageVersions(instance);
        const module = instance.createRuntime(this.modulePlatform());
        this.runtimeModule = module;
        // The progress shows the plan in short panels, it grows left-to-right
        module.setProgressLayout(createProgressLayoutConfig());
        module.runCatalogLoader(this.catalogLoading);
        for (const [connectionId, force] of this.pendingRefreshes.splice(0)) module.refreshCatalog(connectionId, force);
        this.scriptProjection = new ScriptProjection(instance, module);
        this.store.attach(module, {
            script: this.scriptProjection,
            workbook: WORKBOOK_PROJECTION,
            workbookDerived: new WorkbookDerivedProjection(workbookId => this.store.get('workbook', workbookId)),
        });
    }

    /// The core of the runtime, null until it is set
    get core(): core.DashQL | null {
        return this.instance;
    }

    /// The runtime of the module, null until the core is set. The app reads its views through the store and calls it
    /// for the commands that need nothing of this class, e.g. `stopRun`, `cancelSetup` or `dropImport`.
    get module(): core.Runtime | null {
        return this.runtimeModule;
    }

    /// The runtime of the module, the core is set up with the first call
    ready(): Promise<core.Runtime> {
        if (this.runtimeModule != null) return Promise.resolve(this.runtimeModule);
        if (this.pending == null) {
            this.pending = (async () => {
                let instance: core.DashQL | null = null;
                if (this.setupCore != null) {
                    try {
                        instance = await this.setupCore('runtime');
                    } catch (e) {
                        this.logger.warn('The platform has no core for the runtime, instantiating the default one', { error: stringifyError(e) }, LOG_CTX);
                    }
                }
                this.setCore(instance ?? await core.DashQL.create());
                if (this.runtimeModule == null) throw new Error('the runtime was destroyed');
                return this.runtimeModule;
            })();
            this.pending.catch(() => { this.pending = null; });
        }
        return this.pending;
    }

    /// The runtime of the module, throws without a core
    private required(): core.Runtime {
        if (this.runtimeModule == null) throw new Error('the runtime has no core yet');
        return this.runtimeModule;
    }

    /// Set the compute database once the platform set it up, e.g. in the app after the settings loaded. The tasks,
    /// queries and runs that start later use it.
    setComputeDatabase(database: EmbeddedComputeDatabase | null): void {
        if (database === this.computeDatabase) return;
        this.computeDatabase = database;
        this.compute = null;
        this.mounts = null;
    }

    /// Set the HTTP client of the platform, the requests that start later use it
    setHttp(http: HttpClient | null): void {
        this.http = http;
    }

    /// Set what connects the channels of the setups, e.g. once the clients of the app are there
    setChannelConnector(connector: ChannelConnector | null): void {
        this.channelConnector = connector;
    }

    /// Track the queries of the tasks, e.g. in the query history of the connection of a computation
    setQueryExecution(create: CreateComputeQueryExecution | null): void {
        this.queryExecution = create;
    }

    /// Apply an action to a slice. It applies at once, the views follow with the next flush. Fails without a core, a
    /// refused action is logged.
    dispatch(target: core.Target, action: core.RuntimeAction): core.DispatchOutcome {
        if (this.runtimeModule == null) return { ok: false, changed: false, error: 'the runtime has no core yet', id: null };
        const outcome = this.runtimeModule.dispatch(target, action);
        if (!outcome.ok) this.logger.warn('The runtime refused an action', { target: JSON.stringify(target), action: action.kind, error: outcome.error ?? '' }, LOG_CTX);
        return outcome;
    }

    // The computations

    /// Analyze a result as the computation of a table: its statistics, the system columns that the filters use, the
    /// summaries of its columns and the ordering of the options. Settles once the analysis is done and its views are
    /// in the store, fails with the error of a failed task. A result without columns has nothing to analyze.
    async analyzeTable(tableId: number, table: arrow.Table, options: AnalyzeTableOptions = {}): Promise<void> {
        if (table.numCols === 0) return;
        const module = await this.ready();
        const handle = this.handles.register(table);
        let analysis: Promise<void>;
        try {
            analysis = module.analyzeTable(tableId, handle, {
                connectionId: options.connectionId ?? undefined,
                clientContext: clientContextJson(options.clientContext) ?? undefined,
                columnAggregates: options.columnAggregates !== false,
                ordering: options.ordering,
            });
        } catch (e) {
            // The analysis didn't start, the table stays with the caller
            this.handles.release(handle);
            throw e;
        }
        try {
            await analysis;
        } finally {
            this.store.flush();
        }
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
    /// reads it right after an action
    connection(connectionId: string): ConnectionState | null {
        return (this.runtimeModule?.views('connection', [connectionId])[0] ?? null) as ConnectionState | null;
    }

    /// The catalog of a connection, shared with the connection and the scripts that analyze with it. One handle per
    /// connection, it goes with the connection.
    catalog(connectionId: string): core.DashQLCatalog | null {
        let catalog = this.catalogs.get(connectionId) ?? null;
        if (catalog == null && this.runtimeModule != null && this.instance != null) {
            catalog = this.instance.runtimeCatalog(this.runtimeModule, connectionId);
            if (catalog != null) this.catalogs.set(connectionId, catalog);
        }
        return catalog;
    }

    /// The channel of a connection, an object of the handle table
    channel<T>(connection: Pick<ConnectionState, 'details'> | null | undefined): T | null {
        return this.handles.get<T>(connection?.details.channel) ?? null;
    }

    /// Save a connection: the given params, else its draft, else its params. The app manifest first, the copies of
    /// the workbooks that use the connection after; the view of the connection shows the save while it runs.
    async saveConnection(connectionId: string, params?: ConnectionParams): Promise<core.ConnectionSaveOutcome> {
        const module = await this.ready();
        try {
            return await module.saveConnection(connectionId, params as core.JsonParams | undefined);
        } finally {
            this.store.flush();
        }
    }

    /// Write the copies of the last save of a connection into workbooks again, null without a save that wrote the app
    /// manifest
    async retrySave(connectionId: string, workbookIds: string[]): Promise<core.ConnectionSaveOutcome | null> {
        const module = await this.ready();
        try {
            return await module.retrySave(connectionId, workbookIds);
        } finally {
            this.store.flush();
        }
    }

    // The setups and the catalog loader

    /// Set up a connection with its connector: the channel of its params or of the params of the options, then the
    /// health check unless the connection is online with its channel. A setup of the connection that runs is cancelled.
    /// Resolves with the outcome once its view is in the store, a failure is in the view of the connection as well.
    async setupConnection(connectionId: string, options: core.SetupOptions = {}): Promise<core.SetupOutcome> {
        // A runtime with its core starts the setup in the call, a cancellation right after the call reaches it
        const module = this.runtimeModule ?? await this.ready();
        try {
            return await module.setupConnection(connectionId, options);
        } finally {
            this.store.flush();
        }
    }

    /// Log in to Salesforce with the params of the connector, without a connection, e.g. the login of the shell.
    /// `cancelSetup` of the module with the id stops it. The outcome of a success has the tokens and the user.
    async authenticateSalesforce(setupId: string, params: connection.SalesforceConnectionParams, options: core.SetupOptions, login: SalesforceLogin = {}): Promise<core.SetupOutcome> {
        if (login.oauthFlow != null) this.loginFlows.set(setupId, login.oauthFlow);
        try {
            // A runtime with its core starts the login in the call, a cancellation right after the call reaches it
            const module = this.runtimeModule ?? await this.ready();
            return await module.authenticateSalesforce(setupId, params, options, login.onStep ?? null);
        } finally {
            this.loginFlows.delete(setupId);
        }
    }

    /// Request a refresh of the catalog of a connection, a forced one supersedes a running update. The catalog loader
    /// runs it once the connection is online, a refresh before the core waits for it.
    refreshCatalog(connectionId: string, force: boolean): void {
        if (this.runtimeModule == null) {
            this.pendingRefreshes.push([connectionId, force]);
            return;
        }
        this.runtimeModule.refreshCatalog(connectionId, force);
    }

    /// Start or stop the catalog loader, e.g. a run of the command line tool doesn't describe its connections
    runCatalogLoader(running: boolean): void {
        this.catalogLoading = running;
        this.runtimeModule?.runCatalogLoader(running);
    }

    // The queries

    /// Run a query on a connection: it is in the history of the connection right away. Returns its id and its result
    /// table, null for a query without one. A test may replace it.
    execute: QueryExecutor = (connectionId, args) => {
        return this.queries.execute(this.required(), connectionId, args);
    };

    /// Cancel a query, resolves once it ended. A test may replace it.
    cancel: CancelQuery = async queryId => {
        if (this.runtimeModule == null) return;
        await this.queries.cancel(this.runtimeModule, queryId);
    };

    /// Show the profile of a running query: the connector then fetches the plan and its statistics (Trino). A test may
    /// replace it.
    watchProfile: WatchQueryProfile = queryId => {
        const module = this.runtimeModule;
        if (module == null) return () => { };
        module.watchProfile(queryId, true);
        let watching = true;
        return () => {
            if (!watching || this.runtimeModule !== module) return;
            watching = false;
            module.watchProfile(queryId, false);
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
        const module = this.runtimeModule;
        if (module == null) return null;
        const analysis = known?.analysisAvailable === true ? known : null;
        event.knownAnalysis = analysis == null ? null : new core.buffers.editor.EditorAnalysisVersionT(analysis.textVersion, analysis.catalogRevision);
        const builder = new flatbuffers.Builder();
        builder.finish(event.pack(builder));
        // A refused event, e.g. an edit of a cloud preview or of a busy workbook, changes nothing: the editor shows the
        // text of the script again
        let bytes: Uint8Array | undefined;
        try {
            bytes = module.applyEditorEvent(script.workbookId, script.scriptKey, script.sessionGeneration, builder.asUint8Array());
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
            this.scriptProjection?.hold(script.scriptKey, update);
        }
        return update;
    }

    /// Give the table parameters of a workbook to a session that is no script of it, e.g. the draft of the composer.
    /// Returns whether the analysis of the session is outdated by them.
    attachTableParameters(workbookId: string, session: core.DashQLScriptSession): boolean {
        return this.runtimeModule?.attachTableParameters(workbookId, session.ptr.assertNotNull()) ?? false;
    }

    /// Bring the folder of a workbook that the storage keeps in a folder of its own to the current workbook format, e.g. the
    /// folder of a run of the command line tool before it reads the workbook id. Null for a workbook of the storage root.
    async migrateWorkbookFolder(workbookId: string): Promise<string | null> {
        return await (await this.ready()).migrateWorkbookFolder(workbookId);
    }

    /// Restore the connections and the workbooks of the storage, the runtime takes them. Resolves once their views are
    /// in the store.
    async restore(progress?: (progress: core.RestoreProgress) => void): Promise<core.RestoreOutcome> {
        const module = await this.ready();
        try {
            return await module.restore(progress ?? null);
        } finally {
            this.store.flush();
        }
    }

    /// Restore a single workbook of the storage against the connections of the runtime, e.g. an imported one. Rejects
    /// if it can't be restored.
    async restoreWorkbook(workbookId: string): Promise<core.RestoreOutcome> {
        const module = await this.ready();
        try {
            return await module.restoreWorkbook(workbookId);
        } finally {
            this.store.flush();
        }
    }

    /// Delete the files of a workbook that was refused a load and drop it from the list
    async deleteInvalidWorkbook(workbookId: string): Promise<void> {
        const module = await this.ready();
        try {
            await module.deleteInvalidWorkbook(workbookId);
        } finally {
            this.store.flush();
        }
    }

    // The runs of workbooks

    /// Run the scripts of a workbook: all of them, the targets with what they need, or the scripts that a change of
    /// inputs affects. One run holds a workbook at a time, a run of the workbook takes its connections and starts only
    /// while they are idle; a change of inputs while the workbook is busy stops its run and starts once it is free.
    /// Resolves once the run ended and its view is in the store, `outcome.refused` tells why a run didn't start.
    async runWorkbook(workbookId: string, options: core.RunWorkbookOptions = {}, listener: RunWorkbookListener = {}): Promise<RunResult> {
        const module = await this.ready();
        const script = listener.onScript;
        const result = await module.runWorkbook(workbookId, options, {
            script: script == null ? undefined : (file, event, value) => script(file, scriptRunEvent(event, value)),
            prepareConnection: listener.prepareConnection,
        });
        this.store.flush();
        return { outcome: result.outcome, error: runError(result.outcome, result.error) };
    }

    /// Run a script of a workbook with the scripts it references, a refresh reads no cached results. A plan that fails
    /// and a run that fails before its statements show their error on the script. Resolves once the run ended and its
    /// view is in the store.
    async runScript(workbookId: string, scriptKey: number, options: core.RunScriptOptions = {}): Promise<RunResult> {
        const module = await this.ready();
        const result = await module.runScript(workbookId, scriptKey, options);
        this.store.flush();
        return { outcome: result.outcome, error: runError(result.outcome, result.error) };
    }

    /// The reusable result keys of the scripts of a workbook in feed order, the keys that a run reads and writes: of the
    /// targets with what they need, of every script without. Null for a script without one.
    async resultKeys(workbookId: string, targets: readonly number[] | null = null): Promise<(string | null)[]> {
        const module = await this.ready();
        return await module.resultKeys(workbookId, targets == null ? undefined : Uint32Array.from(targets));
    }

    // The imports and exports of workbooks

    /// Export a workbook as a `.dashql` archive: the workbook tables as Parquet, the attachments and, if asked for, the
    /// cached results of the scripts. The connection params are sanitized for sharing. Resolves with the archive and
    /// the results it carries.
    async exportArchive(workbookId: string, options: ExportOptions = {}): Promise<{ archive: Blob; results: core.ExportedResults }> {
        const module = await this.ready();
        const outcome = await module.exportWorkbook(workbookId, { ...options, format: 'archive' }, null);
        const archive = this.handles.get<Blob>(outcome.archive);
        if (outcome.archive != null) this.handles.release(outcome.archive);
        if (archive == null) throw new Error('the export wrote no archive');
        return { archive, results: outcome.results };
    }

    /// Export a workbook as a link that carries its archive inline, without cached results and, by default, without
    /// the catalogs. `linkBase` is the URL of the app that opens the link.
    async exportLink(workbookId: string, linkBase: string, options: Omit<ExportOptions, 'results'> = {}): Promise<string> {
        const module = await this.ready();
        const outcome = await module.exportWorkbook(workbookId, { ...options, format: 'link', linkBase }, null);
        if (outcome.link == null) throw new Error('the export wrote no link');
        return outcome.link;
    }

    /// Export the workbook tables of a workbook, e.g. for a cloud. `consume` gets the rows and the Parquet files of the
    /// attachments and results, which stay readable until it settled. Resolves with the results that the tables carry.
    async exportTables(workbookId: string, options: ExportOptions, consume: (tables: WorkbookTables) => Promise<void>): Promise<core.ExportedResults> {
        const module = await this.ready();
        const outcome = await module.exportWorkbook(workbookId, { ...options, format: 'tables' }, async exported => {
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
        const module = await this.ready();
        if ('archive' in source) {
            const archive = this.handles.register(source.archive);
            try {
                return await module.readImport({ archive });
            } finally {
                this.handles.release(archive);
            }
        }
        return await module.readImport(source);
    }

    /// Import a workbook that was read, with the answers to its questions. Resolves once the workbook was written and,
    /// unless it replaced a workbook or registered a native folder, restored and in the store.
    async commitImport(importId: number, answers: core.ImportAnswers, onStep?: (step: core.ImportStep, results: core.ImportedResults | null) => void): Promise<core.ImportOutcome> {
        const module = await this.ready();
        try {
            return await module.commitImport(importId, answers, onStep ?? null);
        } finally {
            this.store.flush();
        }
    }

    /// Take the changes of the runtime now
    flush(): void {
        this.store.flush();
    }

    /// Stop the runtime: the runs stop, the catalog loader stops, the results that are written into the query result
    /// cache and the pending writes of the storage finish, then the queries are cancelled, the computations go, their
    /// runs are cancelled and their tables released
    async destroy(): Promise<void> {
        if (this.destroyed) return;
        const module = this.runtimeModule;
        if (module != null) {
            this.store.flush();
            for (const workbookId of this.store.all('run').keys()) module.stopRun(workbookId);
            module.runCatalogLoader(false);
            try {
                await module.flushCacheWrites();
                await this.storage.flush();
            } finally {
                this.free();
            }
            return;
        }
        this.free();
    }

    /// Free the runtime of the module without waiting for its writes
    private free(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        const module = this.runtimeModule;
        this.runtimeModule = null;
        for (const catalog of this.catalogs.values()) catalog.destroy();
        this.catalogs.clear();
        this.scriptProjection?.destroy();
        if (module != null) {
            module.destroy();
            this.store.flush();
            module.free();
        }
        this.store.dispose();
    }
}
