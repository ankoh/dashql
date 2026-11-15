import type * as buffers from './buffers.js';
import { DashQL, Ptr } from './api.js';
import type * as glue from './wasm/dashql_core.js';

/// The query executor of the Rust runtime (`packages/dashql-core-runtime/src/executor`, see docs/wip/core_runtime.md):
/// a query is an async task that streams its result over the HTTP client and the timers of the host, or over a channel
/// of the host, and reports its events. The host keeps the result tables, the cache and the analysis of results.

export type {
    QueryExecutorHost,
    QueryExecutorHttpRequest,
    QueryExecutorHttpResponse,
    QueryExecutorChannelMessage,
} from './wasm/dashql_core.js';

const QUERY_EXECUTOR_TYPE = Symbol('QUERY_EXECUTOR_TYPE');

/// Where a query runs
export type DashQLQueryTarget =
    /// The channel of the connection is an object of the host, the host runs the query
    | { type: 'host' }
    /// A Trino channel: the endpoint, the auth of the params, the OAuth access token and the defaults of the session
    | { type: 'trino'; endpoint: string; auth: unknown; accessToken: unknown; catalog: string | null; schema: string | null }
    /// The HTTP API of a Hyper: the params of the connection, the client context and the auth headers of every request
    | { type: 'hyperHttp'; params: unknown; clientContext: unknown; auth: Record<string, string>; parallelChunks?: number }
    /// A client function call: the connector, the spec as JSON text, the description of the core and the tokens
    | { type: 'clientFunction'; connector: number; spec: string | null; description: unknown; tokens: { core: unknown; dataCloud: unknown } | null };

/// A query to run
export interface DashQLQueryRequest {
    connectionId: string;
    text: string;
    target: DashQLQueryTarget;
    publishResults: boolean;
    analyzeResults: boolean;
    /// The query result cache, null if the query doesn't use it. A refresh runs the query and stores the new result.
    cache: { key: string; refresh: boolean } | null;
    /// Serve the cached result or fail, never run the query. A query without a cache fails.
    cacheOnly: boolean;
    /// May the statement change the relations of the connection?
    touchesRelations: boolean;
    throwOnError: boolean;
    /// Fail the query with this error instead of running it, what the host fails with goes next to the request
    failure: { message: string } | null;
    /// The details of the log messages of the query
    logDetails: Record<string, string>;
}

/// The failure of a query
export interface DashQLQueryFailure {
    kind: 'error' | 'cancelled' | 'cacheMiss' | 'processing';
    message: string;
    details: Record<string, string>;
    target: string;
    /// Did the host fail with a value? It comes next to the failure.
    hostValue: boolean;
}

/// How a query ended for the caller, with what the host failed with
export type DashQLQueryOutcome =
    | { status: 'resolved'; hasResult: boolean }
    | { status: 'rejected'; failure: DashQLQueryFailure; value: unknown };

export class DashQLQueryExecutor {
    public readonly ptr: Ptr<typeof QUERY_EXECUTOR_TYPE, glue.QueryExecutor>;

    public constructor(ptr: Ptr<typeof QUERY_EXECUTOR_TYPE, glue.QueryExecutor>) {
        this.ptr = ptr;
    }

    /// An executor on a host
    public static create(api: DashQL, host: glue.QueryExecutorHost): DashQLQueryExecutor {
        return new DashQLQueryExecutor(new Ptr(QUERY_EXECUTOR_TYPE, api, new api.bindings.QueryExecutor(host)));
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    /// Run a query that the host registered. The failure is what a query fails with that the request fails.
    public async execute(queryId: number, request: DashQLQueryRequest, failure?: unknown): Promise<DashQLQueryOutcome> {
        const result = await this.ptr.assertNotNull().execute(queryId, JSON.stringify(request), failure) as { outcome: string; value: unknown };
        const outcome = JSON.parse(result.outcome) as { status: 'resolved'; hasResult: boolean } | { status: 'rejected'; failure: DashQLQueryFailure };
        return outcome.status === 'resolved' ? outcome : { ...outcome, value: result.value };
    }

    /// Cancel a query, resolves once it ended
    public async cancel(queryId: number): Promise<void> {
        await this.ptr.assertNotNull().cancel(queryId);
    }

    public isRunning(queryId: number): boolean {
        return this.ptr.assertNotNull().isRunning(queryId);
    }

    /// The layout of the plans of the progress of the queries that start later, null for the default one
    public setProgressLayout(layout: buffers.profile.ProfileLayoutConfigT | null): void {
        this.ptr.assertNotNull().setProgressLayout(layout);
    }

    /// A view starts (1) or stops (-1) showing the profile of a running query
    public watchProfile(queryId: number, delta: 1 | -1): void {
        this.ptr.assertNotNull().watchProfile(queryId, delta);
    }

    /// Wait for the writes into the query result cache that run
    public async flushCacheWrites(): Promise<void> {
        await this.ptr.assertNotNull().flushCacheWrites();
    }
}
