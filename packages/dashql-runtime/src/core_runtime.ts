import * as core from '@ankoh/dashql-core';
import * as flatbuffers from 'flatbuffers';
import type * as arrow from 'apache-arrow';
import type * as auth from '@ankoh/dashql-jsonschema/auth.js';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { clientContextJson, createComputePlatform, type CreateComputeQueryExecution } from './compute/compute_platform.js';
import type { EmbeddedClientContext, EmbeddedComputeDatabase } from './platform/database/embedded_database.js';
import type { HttpClient } from './platform/http/http_client.js';
import { stringifyError, type Logger } from './platform/logger/logger.js';
import { HandleTable } from './store/handles.js';
import { RuntimeStore } from './store/runtime_store.js';
import { createRuntimeTables, isArrowTable, type PlatformTables } from './store/runtime_tables.js';
import type { UpdateScheduler } from './store/store.js';
import { QueryPlatform, type WatchQueryProfile } from './query/query_platform.js';
import type { QueryResultCache } from './query/query_result_cache.js';
import { createProgressLayoutConfig } from './query/profile/profile_layout_config.js';
import type { CancelQuery, QueryExecutor } from './connections/query_execution_args.js';
import { createConnectionAction, type ConnectionState, type NewConnection } from './connections/connection_state.js';
import type { ConnectionParams } from './connections/connection_params.js';
import { connectionRegistryOf, type ConnectionRegistry } from './connections/connection_registry_state.js';
import { ConnectorType } from './connections/connector_info.js';
import { loadClientFunctionSpec } from './connections/clfn/clfn_specs.js';
import { SalesforceApiClient, type SalesforceApiClientInterface } from './connections/salesforce/salesforce_api_client.js';
import { TrinoApiEndpoint } from './connections/trino/trino_api_client.js';
import { TrinoChannel } from './connections/trino/trino_channel.js';
import type { OAuthFlow, OAuthFlowEvent } from './oauth/oauth_flow.js';
import type { OAuthRedirectData } from './oauth/oauth_types.js';
import { generatePKCEChallenge } from './utils/pkce.js';
import { createRuntimeStorage, StorageWriter } from './storage/runtime_storage.js';
import type { StorageBackend } from './storage/storage_backend.js';
import { ScriptProjection, WORKBOOK_PROJECTION, WorkbookDerivedProjection } from './workbook/scripts/workbook_projection.js';
import type { ScriptData, ScriptDataMap, WorkbookAction, WorkbookScripts } from './workbook/scripts/workbook_scripts.js';

const LOG_CTX = 'runtime';

/// What the runtime of the module needs of the platform of TypeScript
export interface CoreRuntimeOptions {
    logger: Logger;
    /// When the store takes the changes of the runtime
    scheduler: UpdateScheduler;
    /// The core, or the setup of the core that the first command asks for. Without, the default core is instantiated.
    setupCore?: ((context: string) => Promise<core.DashQL>) | core.DashQL | null;
    /// The compute database of the computations, null until the platform set it up
    computeDatabase?: EmbeddedComputeDatabase | null;
    /// The HTTP client of the platform, the query executor sends its requests with it
    http?: HttpClient | null;
    /// The cache of query results, null without one
    resultCache?: QueryResultCache | null;
    /// How the setups take the user through the authorization of an OAuth provider, null without
    oauthFlow?: OAuthFlow | null;
    /// Connects the channels of the setups besides Trino, null without
    channels?: ChannelConnector | null;
    /// The API of Salesforce of the platform. One that isn't the client over the HTTP client, e.g. a mock, answers the
    /// metadata of the catalog.
    salesforce?: SalesforceApiClientInterface | null;
    /// The storage of the workbooks and the connections, null without one
    storage?: StorageBackend | null;
}

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

/// The outcome of saving a connection: the saved params, the write of the app manifest and the writes of the copies of
/// the workbooks
export type ConnectionSaveResult = core.ConnectionSaveOutcome;

/// The runtime of the module on the platform of TypeScript (docs/wip/runtime_api.md): the `Runtime` class of the core
/// with its platform object (the clock, the log, the handle table, the Arrow tables by handle, fetch, the channels of
/// the host, the queries that the runtime runs itself, the query result cache, the compute database, the OAuth flows,
/// the specs of the extensions, the storage) and the store that the app reads its views from. It holds the
/// computations, the connections with the histories of their queries, the histories without a connection, the query
/// executor, the setups of the connections, the catalog loader, the workbooks with their scripts, the storage writer and
/// the restore.
///
/// The runtime of the module needs the instantiated core. The app creates this object before the core is set up: the
/// views are empty and a dispatch fails until the core is there, a command asks the platform for it.
export class CoreRuntime {
    /// The handle table of the platform: the Arrow tables, the channels, the records of the queries of the host, the
    /// lifetimes of the computations
    readonly handles = new HandleTable();
    /// The views of the runtime
    readonly store: RuntimeStore;
    /// The commands of the storage writer of the runtime
    readonly storage: StorageWriter;
    private readonly logger: Logger;
    private readonly setupCore: ((context: string) => Promise<core.DashQL>) | null;
    private computeDatabase: EmbeddedComputeDatabase | null;
    private http: HttpClient | null;
    private resultCache: QueryResultCache | null;
    private readonly tables: PlatformTables;
    private readonly queries: QueryPlatform;
    private queryExecution: CreateComputeQueryExecution | null = null;
    private compute: core.ComputePlatform | null = null;
    private instance: core.DashQL | null = null;
    private module: core.Runtime | null = null;
    private pending: Promise<core.Runtime> | null = null;
    /// The catalogs of the connections, one handle each
    private readonly catalogs = new Map<string, core.DashQLCatalog>();
    /// The fetches of the runtime by id
    private readonly fetches = new Map<number, AbortController>();
    private oauthFlow: OAuthFlow | null;
    /// The flows of single logins by the id of their setup
    private readonly loginFlows = new Map<string, OAuthFlow>();
    /// The OAuth flows that run, by id
    private readonly flows = new Map<number, AbortController>();
    private channelConnector: ChannelConnector | null;
    private salesforce: SalesforceApiClientInterface | null;
    private storageBackend: StorageBackend | null;
    private runtimeStorage: core.RuntimeStorage | null = null;
    /// The projection of the scripts of the workbooks, with the session handles of the scripts
    private scripts: ScriptProjection | null = null;
    /// Does the catalog loader run, and the refreshes requested before the core was there
    private catalogLoading = true;
    private readonly pendingRefreshes: [string, boolean][] = [];
    /// The registry of the connections of the last flush, with the views it was built from
    private registryCache: { list: unknown; connections: unknown; registry: ConnectionRegistry } | null = null;
    private destroyed = false;

    constructor(options: CoreRuntimeOptions) {
        this.logger = options.logger;
        this.store = new RuntimeStore(this.handles, options.scheduler);
        this.computeDatabase = options.computeDatabase ?? null;
        this.http = options.http ?? null;
        this.resultCache = options.resultCache ?? null;
        this.oauthFlow = options.oauthFlow ?? null;
        this.channelConnector = options.channels ?? null;
        this.salesforce = options.salesforce ?? null;
        this.storageBackend = options.storage ?? null;
        this.storage = new StorageWriter(this);
        this.tables = createRuntimeTables(this.handles);
        this.queries = new QueryPlatform({
            logger: this.logger,
            handles: this.handles,
            tables: this.tables,
            computeDatabase: () => this.computeDatabase,
            resultCache: () => this.resultCache,
        });
        const setupCore = options.setupCore ?? null;
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
    private platform(): core.RuntimePlatform {
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
            queries: {
                describe: (queryId, connectionId, query) => this.queries.describeQuery(queryId, this.connection(connectionId), connectionId, query),
                forget: queryId => this.queries.forget(queryId),
            },
            get resultCache() {
                return runtime.queries.resultCache();
            },
            crypto: { randomUuid: () => crypto.randomUUID() },
            oauth: this.oauth(),
            extensions: { loadSpec: async extension => JSON.stringify(await loadClientFunctionSpec(extension)) },
            get salesforce() {
                return runtime.salesforceMetadata();
            },
            get storage() {
                return runtime.storagePlatform();
            },
            changed: urgent => this.store.changed(urgent),
        };
    }

    /// Connect a channel of a setup: a Trino channel holds what the executor speaks, the connector of the platform
    /// connects the others
    private async connectChannel(connectionId: string, request: core.RuntimeChannelRequest): Promise<unknown> {
        if (request.type === 'trino') {
            const endpoint = new TrinoApiEndpoint(request.endpoint, request.auth as auth.TrinoAuthParams);
            if (request.accessToken != null) endpoint.oauthState = { accessToken: request.accessToken } as connection.TrinoOAuthState;
            return new TrinoChannel(endpoint, { catalog: request.catalog, schema: request.schema });
        }
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

    /// The metadata of Salesforce from an API of the platform that isn't the client over the HTTP client, e.g. the
    /// mock of the app. Null lets the runtime fetch it.
    private salesforceMetadata(): core.RuntimeSalesforce | null {
        const api = this.salesforce;
        if (api == null || api instanceof SalesforceApiClient) return null;
        return {
            metadata: async (connectionId, dataSpace) => {
                const conn = this.connection(connectionId);
                if (conn?.connectorType !== ConnectorType.SALESFORCE_DATA_CLOUD || conn.details.connector.kind !== 'salesforce') return null;
                const token = conn.details.connector.oauthState?.coreAccessToken;
                if (token == null) throw new Error('Salesforce core access token is missing');
                const metadata = await api.getDataCloudMetadata(JSON.parse(token), dataSpace, new AbortController().signal);
                return JSON.stringify(metadata);
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

    private computePlatform(): core.ComputePlatform | null {
        if (this.compute == null && this.computeDatabase != null) {
            this.compute = createComputePlatform(this.computeDatabase, () => this.queryExecution);
        }
        return this.compute;
    }

    /// Give the runtime its core, e.g. the one that the runtime of the app restored with. Later cores are ignored.
    setCore(instance: core.DashQL): void {
        if (this.destroyed || this.module != null) return;
        this.instance = instance;
        this.module = instance.createRuntime(this.platform());
        // The progress shows the plan in short panels, it grows left-to-right
        this.module.setProgressLayout(createProgressLayoutConfig());
        this.module.runCatalogLoader(this.catalogLoading);
        for (const [connectionId, force] of this.pendingRefreshes.splice(0)) this.module.refreshCatalog(connectionId, force);
        this.scripts = new ScriptProjection(instance, this.module);
        this.store.attach(this.module, {
            script: this.scripts,
            workbook: WORKBOOK_PROJECTION,
            workbookDerived: new WorkbookDerivedProjection(workbookId => this.store.get('workbook', workbookId)),
        });
    }

    /// The core of the runtime, null until it is set
    get core(): core.DashQL | null {
        return this.instance;
    }

    /// The runtime of the module, null until the core is set. Read through the store, the module is for the commands.
    get runtime(): core.Runtime | null {
        return this.module;
    }

    /// The runtime of the module, the core is set up with the first call
    ready(): Promise<core.Runtime> {
        if (this.module != null) return Promise.resolve(this.module);
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
                if (this.module == null) throw new Error('the runtime was destroyed');
                return this.module;
            })();
            this.pending.catch(() => { this.pending = null; });
        }
        return this.pending;
    }

    /// The runtime of the module, throws without a core
    private required(): core.Runtime {
        if (this.module == null) throw new Error('the runtime has no core yet');
        return this.module;
    }

    /// Set the compute database once the platform set it up, the tasks and queries that start later use it
    setComputeDatabase(database: EmbeddedComputeDatabase | null): void {
        if (database === this.computeDatabase) return;
        this.computeDatabase = database;
        this.compute = null;
    }

    /// Set the HTTP client of the platform, the requests that start later use it
    setHttp(http: HttpClient | null): void {
        this.http = http;
    }

    /// Set the query result cache of the platform
    setResultCache(cache: QueryResultCache | null): void {
        this.resultCache = cache;
    }

    /// Set the OAuth flow of the platform, the setups that start later use it
    setOAuthFlow(flow: OAuthFlow | null): void {
        this.oauthFlow = flow;
    }

    /// Set what connects the channels of the setups, e.g. once the clients of the app are there
    setChannelConnector(connector: ChannelConnector | null): void {
        this.channelConnector = connector;
    }

    /// Set the API of Salesforce of the platform, e.g. the mock that the config of the app chose
    setSalesforce(api: SalesforceApiClientInterface | null): void {
        this.salesforce = api;
    }

    /// Track the queries of the tasks, e.g. in the query history of the connection of a computation
    setQueryExecution(create: CreateComputeQueryExecution | null): void {
        this.queryExecution = create;
    }

    /// Set the storage backend of the platform, the writes and the restores that start later use it
    setStorage(backend: StorageBackend | null): void {
        this.storageBackend = backend;
        this.runtimeStorage = null;
    }

    /// Apply an action to a slice. Fails without a core.
    dispatch(target: core.Target, action: core.RuntimeAction): core.DispatchOutcome {
        if (this.module == null) return { ok: false, changed: false, error: 'the runtime has no core yet', id: null };
        return this.module.dispatch(target, action);
    }

    // The computations

    /// Delete the computation of a result
    deleteComputation(tableId: number): void {
        this.dispatch({ computation: tableId }, { kind: 'deleteComputation' });
    }

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
        // The registry shows the connection right away
        this.store.flush();
        const created = this.connection(outcome.id);
        if (created == null) throw new Error(`the connection ${outcome.id} was not created`);
        return created;
    }

    /// The connections of the last flush of the store by id, the same object until a connection or the list changes
    registry(): ConnectionRegistry {
        const list = this.store.get('connectionList', 'root');
        const connections = this.store.all('connection');
        const cached = this.registryCache;
        if (cached != null && cached.list === list && cached.connections === connections) return cached.registry;
        const registry = connectionRegistryOf(list, id => (connections.get(id) ?? null) as ConnectionState | null);
        this.registryCache = { list, connections, registry };
        return registry;
    }

    /// Apply an action to a connection, nothing without an id
    dispatchConnection = (connectionId: string | null, action: core.RuntimeAction): core.DispatchOutcome => {
        if (connectionId == null) return { ok: false, changed: false, error: 'no connection', id: null };
        const outcome = this.dispatch({ connection: connectionId }, action);
        if (!outcome.ok) this.logger.warn('A connection refused an action', { connectionId, error: outcome.error ?? '' }, 'connection_registry');
        return outcome;
    };

    /// A connection as the runtime holds it now, not as the store saw it at the last flush, e.g. for a service that
    /// reads it right after an action
    connection(connectionId: string): ConnectionState | null {
        return (this.module?.views('connection', [connectionId])[0] ?? null) as ConnectionState | null;
    }

    /// The connections as the runtime holds them now, in the order they were registered
    connections(): Map<string, ConnectionState> {
        const list = this.module?.views('connectionList', ['root'])[0];
        const ids = list?.connections.map(connection => connection.connectionId) ?? [];
        const views = ids.length === 0 ? [] : this.module!.views('connection', ids);
        const connections = new Map<string, ConnectionState>();
        views.forEach((view, i) => {
            if (view != null) connections.set(ids[i], view as ConnectionState);
        });
        return connections;
    }

    /// The catalog of a connection, shared with the connection and the scripts that analyze with it. One handle per
    /// connection, it goes with the connection.
    catalog(connectionId: string): core.DashQLCatalog | null {
        let catalog = this.catalogs.get(connectionId) ?? null;
        if (catalog == null && this.module != null && this.instance != null) {
            catalog = this.instance.runtimeCatalog(this.module, connectionId);
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
    async saveConnection(connectionId: string, params?: ConnectionParams): Promise<ConnectionSaveResult> {
        const module = await this.ready();
        try {
            return await module.saveConnection(connectionId, params as core.JsonParams | undefined);
        } finally {
            this.store.flush();
        }
    }

    /// Write the copies of the last save of a connection into workbooks again, null without a save that wrote the app
    /// manifest
    async retrySave(connectionId: string, workbookIds: string[]): Promise<ConnectionSaveResult | null> {
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
        const module = this.module ?? await this.ready();
        try {
            return await module.setupConnection(connectionId, options);
        } finally {
            this.store.flush();
        }
    }

    /// Cancel the setup of a connection or a login that runs
    cancelSetup(setupId: string): void {
        this.module?.cancelSetup(setupId);
    }

    /// Log in to Salesforce with the params of the connector, without a connection, e.g. the login of the shell.
    /// `cancelSetup` with the id stops it. The outcome of a success has the tokens and the user.
    async authenticateSalesforce(setupId: string, params: connection.SalesforceConnectionParams, options: core.SetupOptions, login: SalesforceLogin = {}): Promise<core.SetupOutcome> {
        if (login.oauthFlow != null) this.loginFlows.set(setupId, login.oauthFlow);
        try {
            // A runtime with its core starts the login in the call, a cancellation right after the call reaches it
            const module = this.module ?? await this.ready();
            return await module.authenticateSalesforce(setupId, params, options, login.onStep ?? null);
        } finally {
            this.loginFlows.delete(setupId);
        }
    }

    /// Request a refresh of the catalog of a connection, a forced one supersedes a running update. The catalog loader
    /// runs it once the connection is online.
    refreshCatalog(connectionId: string, force: boolean): void {
        if (this.module == null) {
            this.pendingRefreshes.push([connectionId, force]);
            return;
        }
        this.module.refreshCatalog(connectionId, force);
    }

    /// Start or stop the catalog loader, e.g. a run of the command line tool doesn't describe its connections
    runCatalogLoader(running: boolean): void {
        this.catalogLoading = running;
        this.module?.runCatalogLoader(running);
    }

    // The queries

    /// Run a query on a connection: it is in the history of the connection right away. Returns its id and its result
    /// table, null for a query without one.
    execute: QueryExecutor = (connectionId, args) => {
        return this.queries.execute(this.required(), id => this.connection(id), connectionId, args);
    };

    /// Cancel a query, resolves once it ended
    cancel: CancelQuery = async (connectionId, queryId) => {
        if (this.module == null) return;
        await this.queries.cancel(this.module)(connectionId, queryId);
    };

    /// Show the profile of a running query: the connector then fetches the plan and its statistics (Trino)
    watchProfile: WatchQueryProfile = queryId => {
        const module = this.module;
        if (module == null) return () => { };
        module.watchProfile(queryId, true);
        let watching = true;
        return () => {
            if (!watching || this.module !== module) return;
            watching = false;
            module.watchProfile(queryId, false);
        };
    };

    /// Wait for the results that are written into the query result cache, e.g. before a process ends
    async flushCacheWrites(): Promise<void> {
        await this.module?.flushCacheWrites();
    }

    /// An id of the sequence of the queries without a query, e.g. for the computation of a result that no query of the
    /// runtime produced
    allocateId(): number {
        return this.required().allocateId();
    }

    /// A query as the runtime holds it now
    query(queryId: number): core.QueryView | null {
        return this.module?.views('query', [queryId])[0] ?? null;
    }

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

    /// Apply an action to a workbook. It applies at once, the views follow with the next flush.
    dispatchWorkbook = (workbookId: string, action: WorkbookAction): core.DispatchOutcome => {
        const outcome = this.dispatch({ workbook: workbookId }, action);
        if (!outcome.ok) this.logger.warn('A workbook refused an action', { workbookId, action: action.kind, error: outcome.error ?? '' }, 'workbook_scripts');
        return outcome;
    };

    /// Report the update of an event that the editor of a script applied to the shared session of the script. The
    /// projection holds the update instead of reading it again. An editor that holds no staged rewrite accepted the one
    /// of the script.
    reportEditorUpdate(script: Pick<ScriptData, 'workbookId' | 'scriptKey' | 'sessionId'>, update: core.buffers.editor.EditorUpdateT, holdsPendingDiff: boolean): boolean {
        const module = this.module;
        if (module == null) return false;
        this.scripts?.report(script.scriptKey, update);
        const builder = new flatbuffers.Builder();
        builder.finish(update.pack(builder));
        return module.reportEditorUpdate(script.workbookId, script.scriptKey, script.sessionId, builder.asUint8Array(), holdsPendingDiff);
    }

    /// A workbook of the last flush
    workbook(workbookId: string): WorkbookScripts | null {
        return this.store.get('workbook', workbookId);
    }

    /// The scripts of a workbook of the last flush by key
    workbookScripts(workbookId: string): ScriptDataMap {
        const scripts: ScriptDataMap = {};
        for (const key of this.store.get('workbook', workbookId)?.scriptKeys ?? []) {
            const script = this.store.get('script', key);
            if (script != null) scripts[key] = script;
        }
        return scripts;
    }

    /// Give the table parameters of a workbook to a session that is no script of it, e.g. the draft of the composer.
    /// Returns whether the analysis of the session is outdated by them.
    attachTableParameters(workbookId: string, session: core.DashQLScriptSession): boolean {
        return this.module?.attachTableParameters(workbookId, session.ptr.assertNotNull()) ?? false;
    }

    /// Does storage hold the scripts of a workbook as they are?
    matchesStoredScripts(workbookId: string, scripts: core.StoredScriptView[]): boolean {
        return this.module?.matchesStoredScripts(workbookId, scripts) ?? false;
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

    /// Start a run of the scripts of a workbook
    startWorkbookRun(workbookId: string, host: core.WorkbookRunHost, options: core.WorkbookRunOptions): core.DashQLWorkbookRun {
        return new core.DashQLWorkbookRun(this.required().startWorkbookRun(workbookId, host, options));
    }

    /// The result keys of the scripts of a workbook, see `Runtime.resultKeys`
    async resultKeys(workbookId: string, targets: readonly number[] | null, host: core.WorkbookResultKeyHost): Promise<Array<core.WorkbookResultKey | null>> {
        return await this.required().resultKeys(workbookId, targets == null ? undefined : Uint32Array.from(targets), host) as Array<core.WorkbookResultKey | null>;
    }

    /// The plan of a run of a workbook with the analyses as they are
    planRun(workbookId: string, targets: readonly number[] | null, mountPrefix: string): core.buffers.execution.ExecutionGraphT {
        const bytes = this.required().planRun(workbookId, targets == null ? undefined : Uint32Array.from(targets), mountPrefix);
        return core.buffers.execution.ExecutionGraph.getRootAsExecutionGraph(new flatbuffers.ByteBuffer(bytes)).unpack();
    }

    /// Analyze a script whose analysis is outdated, returns the script once its view is in the store
    analyzeScript(workbookId: string, scriptKey: number): ScriptData | null {
        this.dispatchWorkbook(workbookId, { kind: 'analyzeOutdatedScript', value: { scriptKey } });
        this.store.flush();
        return this.store.get('script', scriptKey);
    }

    /// Analyze every script of a workbook for a run and publish its declarations, throws the message of a script that
    /// doesn't analyze
    analyzeForRun(workbookId: string): void {
        this.required().analyzeForRun(workbookId);
    }

    /// Take the changes of the runtime now
    flush(): void {
        this.store.flush();
    }

    /// Stop the runtime: its queries are cancelled, its computations go, their runs are cancelled and their tables
    /// released
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        const module = this.module;
        this.module = null;
        for (const catalog of this.catalogs.values()) catalog.destroy();
        this.catalogs.clear();
        this.scripts?.destroy();
        if (module != null) {
            module.destroy();
            this.store.flush();
            module.free();
        }
        this.store.dispose();
    }
}
