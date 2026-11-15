import * as core from '@ankoh/dashql-core';
import type * as arrow from 'apache-arrow';

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
import { cancelConnectionSetup } from './connections/connection_setup_cancellation.js';
import {
    createConnectionAction,
    runtimeActionOf,
    type ConnectionAction,
    type ConnectionState,
    type NewConnection,
} from './connections/connection_state.js';
import type { ConnectionParams } from './connections/connection_params.js';
import { connectionRegistryOf, type ConnectionRegistry } from './connections/connection_registry_state.js';

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
/// the host, the query result cache, the compute database) and the store that the app reads its views from. It holds
/// the computations, the connections with the histories of their queries, the histories without a connection and the
/// query executor.
///
/// The runtime of the module needs the instantiated core. The app creates this object before the core is set up: the
/// views are empty and a dispatch fails until the core is there, a command asks the platform for it.
export class CoreRuntime {
    /// The handle table of the platform: the Arrow tables, the channels, the records of the queries of the host, the
    /// lifetimes of the computations
    readonly handles = new HandleTable();
    /// The views of the runtime
    readonly store: RuntimeStore;
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
    /// The registry of the connections of the last flush, with the views it was built from
    private registryCache: { list: unknown; connections: unknown; registry: ConnectionRegistry } | null = null;
    private destroyed = false;

    constructor(options: CoreRuntimeOptions) {
        this.logger = options.logger;
        this.store = new RuntimeStore(this.handles, options.scheduler);
        this.computeDatabase = options.computeDatabase ?? null;
        this.http = options.http ?? null;
        this.resultCache = options.resultCache ?? null;
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
            channels: this.queries.channels,
            get resultCache() {
                return runtime.queries.resultCache();
            },
            crypto: { randomUuid: () => crypto.randomUUID() },
            cancelSetup: connectionId => cancelConnectionSetup(connectionId),
            changed: urgent => this.store.changed(urgent),
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
        this.store.attach(this.module);
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

    /// Track the queries of the tasks, e.g. in the query history of the connection of a computation
    setQueryExecution(create: CreateComputeQueryExecution | null): void {
        this.queryExecution = create;
    }

    /// The writer of the storage that the changes and the saves of the connections write through
    setStorageWriter(writer: core.DashQLStorageWriter): void {
        this.module?.setStorageWriter(writer.ptr.assertNotNull());
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

    /// Apply an action of a setup or the settings to a connection, nothing without an id
    dispatchConnection = (connectionId: string | null, action: ConnectionAction): core.DispatchOutcome => {
        if (connectionId == null) return { ok: false, changed: false, error: 'no connection', id: null };
        const outcome = this.dispatch({ connection: connectionId }, runtimeActionOf(action, this.handles));
        if (!outcome.ok) this.logger.warn('A connection refused an action', { connectionId, error: outcome.error ?? '' }, 'connection_registry');
        return outcome;
    };

    /// The workbooks that use the connections, until the workbooks are part of the runtime
    setConnectionReferences(references: [string, string[]][]): void {
        this.dispatch('app', { kind: 'setConnectionReferences', value: { references } });
    }

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
        if (module != null) {
            module.destroy();
            this.store.flush();
            module.free();
        }
        this.store.dispose();
    }
}
