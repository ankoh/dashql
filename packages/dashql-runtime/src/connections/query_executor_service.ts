import * as arrow from 'apache-arrow';

import type * as core from '@ankoh/dashql-core';

import { RELATIONS_TOUCHED, type ConnectionState } from './connection_state.js';
import type { ConnectionRegistry, DynamicConnectionDispatch } from './connection_registry_state.js';
import { SALESFORCE_DATA_CLOUD_CONNECTOR } from './connector_info.js';
import {
    createQueryExecutionState,
    EXECUTE_QUERY,
    QUERY_CACHE_RECORDED,
    QUERY_CANCELLED,
    QUERY_FAILED,
    QUERY_PROCESSING_RESULTS,
    QUERY_PROCESSED_RESULTS,
    QUERY_PROGRESS_UPDATED,
    QUERY_RECEIVED_ALL_BATCHES,
    QUERY_RECEIVED_BATCH,
    QUERY_RUNNING,
    QUERY_SENDING,
    QUERY_SUCCEEDED,
    type QueryExecutionAction,
    type QueryExecutionMetrics,
    type QueryExecutionProgress,
    type QueryExecutionResponseStream,
} from '../query/query_execution_state.js';
import { analyzeTable } from '../compute/analyze_table.js';
import { DELETE_COMPUTATION, type ComputationAction } from '../compute/computation_state.js';
import { ResultComputations } from './result_computations.js';
import { QueryCacheMissError, type QueryResultCache, type QueryResultCacheEntry } from '../query/query_result_cache.js';
import { getConnectionParamsFromStateDetails, createConnectionParamsSignature } from './connection_params.js';
import { ConnectionStateDetailsVariant } from './connection_state_details.js';
import { computeQueryResultCacheKey } from '../query/query_result_cache_key.js';
import { createTrace, type TraceContext } from '../platform/logger/trace_context.js';
import type { CancelQuery, QueryExecutionArgs, QueryExecutor } from './query_execution_args.js';
import { LoggableException, stringifyError, type Logger, type TracedLogger } from '../platform/logger/logger.js';
import type { LogRecord } from '../platform/logger/log_buffer.js';
import type { HttpClient } from '../platform/http/http_client.js';
import type { EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { allocateQueryId } from '../query/tracked_query_execution.js';
import { yieldToBrowser } from '../utils/yield_to_browser.js';
import { supportsParquet, type ParquetDatabase } from '../platform/hyperdb/hyperdb_parquet_export.js';
import { createProgressLayoutConfig } from '../query/profile/profile_layout_config.js';
import type { Dispatch } from '../utils/variant.js';
import { connectorOfDetails } from './connector_descriptor.js';
import { TrinoChannel } from './trino/trino_channel.js';
import type { HyperDatabaseChannel } from './hyper/hyperdb_grpc_client.js';
import type { SalesforceDatabaseChannel } from './salesforce/salesforce_api_client.js';

const LOG_CTX = 'query_executor';

/// Query failures are logged as warnings.
/// The failed run already shows the error inline, error toasts are reserved for failures of the app itself.
export function logQueryFailure(logger: TracedLogger, error: unknown, queryId: number, workbookId: string): void {
    if (error instanceof LoggableException) {
        logger.warn(error.message, {
            ...error.keyValues,
            queryId: queryId.toString(),
            workbookId,
        }, error.target);
    } else {
        logger.warn('Query failed with unknown error', {
            queryId: queryId.toString(),
            workbookId,
            raw: stringifyError(error),
        }, LOG_CTX);
    }
}

/// Compute the file-based cache key for a query against a connection, or null when the connection has
/// no recoverable params/signature (e.g. before setup completes). This is the same derivation the
/// executor uses on its cacheable path. Never throws — a failure to derive the key is reported as
/// null (treat as "not cacheable / a miss").
export async function computeQueryCacheKeyForConnection(
    details: ConnectionStateDetailsVariant,
    cacheSignature: string,
): Promise<string | null> {
    try {
        const params = getConnectionParamsFromStateDetails(details);
        const sig = params ? createConnectionParamsSignature(params) : null;
        if (sig == null) {
            return null;
        }
        return await computeQueryResultCacheKey(sig, cacheSignature);
    } catch {
        return null;
    }
}

/// Show the profile of a running query, returns the function that stops showing it
export type WatchQueryProfile = (queryId: number) => () => void;

/// What the executor needs. The host can replace them while queries run, e.g. once the compute database is ready.
export interface QueryExecutorDependencies {
    logger: Logger;
    http: HttpClient;
    /// The latest connection registry
    readConnections: () => Pick<ConnectionRegistry, 'connections'>;
    /// Apply an action to a connection
    dispatchConnection: DynamicConnectionDispatch;
    /// Apply an action to the computations
    dispatchComputation: Dispatch<ComputationAction>;
    /// The database of the computations, null until it is ready
    computeDatabase: EmbeddedComputeDatabase | null;
    /// The cache of query results, null without one
    resultCache: QueryResultCache | null;
    /// Instantiate the core, null without one. The query executor of the core of the first connection runs the queries.
    setupCore: ((context: string) => Promise<core.DashQL>) | null;
}

/// A message of a channel of the host, what the stream produced
type ChannelMessage =
    | { type: 'progress'; progress: QueryExecutionProgress }
    | { type: 'batch'; ipc: Uint8Array; metrics: string }
    | { type: 'end'; schema: Uint8Array | null; metrics: string }
    | { type: 'error'; error: unknown };

/// The JavaScript side of a query: the arguments, the cancellation, the result table and the stream of a channel of the
/// host. The Rust executor decides what happens, the record runs it.
interface QueryRecord {
    queryId: number;
    connectionId: string;
    args: QueryExecutionArgs;
    /// Aborted by cancel() and by the abort signal of the caller, both stop the query at the backend
    cancellation: AbortController;
    trace: TraceContext;
    traced: TracedLogger;
    workbookId: string;
    /// The connection when the query started
    connection: ConnectionState | null;
    /// The views that show the profile of the query
    profileViewers: number;
    /// Is the query in the Rust executor?
    started: boolean;
    /// The result table, decoded from the Arrow IPC of the executor or read from the cache
    table: arrow.Table | null;
    /// The cache entry of a hit
    cacheEntry: QueryResultCacheEntry | null;
    /// The error of a failed or cancelled query, the history and the caller get the same one
    error: unknown;
    /// Is the query done in the history?
    done: boolean;
    /// The Trino channel that the executor speaks, it keeps a refreshed access token
    trino: TrinoChannel | null;
    /// The stream of a channel of the host and its messages
    stream: QueryExecutionResponseStream | null;
    producing: boolean;
    messages: ChannelMessage[];
    wakeMessages: (() => void) | null;
    /// The writes into the cache that run, the record stays until they reported
    pendingWrites: number;
    /// Did the execution settle?
    settled: boolean;
    /// The execution
    execution: Promise<arrow.Table | null> | null;
}

/// The cancellation of a query as an error
function abortError(): DOMException {
    return new DOMException('Query was cancelled', 'AbortError');
}

/// A query error as the history keeps it
function asLoggableException(error: unknown, target: string): LoggableException {
    return error instanceof LoggableException ? error : new LoggableException(stringifyError(error), {}, target);
}

/// The Arrow IPC stream of a table
function tableIPC(table: arrow.Table): Uint8Array {
    return arrow.tableToIPC(table, 'stream');
}

/// Runs queries on connections: the cache of results, the progress of the engines, the analysis of the results and
/// the relations that statements touch. One executor serves every connection, the queries of all of them share the
/// ids of one sequence.
///
/// An adapter over the query executor of the Rust runtime (`dashql_core_runtime::executor`): the executor runs a query
/// as a task, streams Trino, Hyper over HTTP and client functions itself and reports what happens, a progress update
/// with the structured progress of the progress model of the query. The adapter applies the events to the connection,
/// keeps the result tables, the query result cache, the analysis of results and the channels of the host (the gRPC
/// channel of Hyper, the embedded Hyper, channels of tests).
export class QueryExecutorService {
    private readonly deps: QueryExecutorDependencies;
    private readonly records = new Map<number, QueryRecord>();
    private readonly resultComputations = new ResultComputations();
    private native: core.DashQLQueryExecutor | null = null;
    private fetchAborts = new Map<number, AbortController>();

    constructor(deps: QueryExecutorDependencies) {
        this.deps = deps;
    }

    /// The executor of the core, created with the first query on the core of its connection. The cores of the
    /// connections are instances of one module.
    private nativeOf(instance: core.DashQL): core.DashQLQueryExecutor {
        if (this.native == null) {
            this.native = instance.createQueryExecutor(this.createHost());
            // The progress shows the plan in short panels, it grows left-to-right
            this.native.setProgressLayout(createProgressLayoutConfig());
        }
        return this.native;
    }

    /// Wait for the results that are written into the query result cache, e.g. before a process ends
    async flushCacheWrites(): Promise<void> {
        await this.native?.flushCacheWrites();
    }

    /// Allocate the next query id and start the execution
    execute: QueryExecutor = (connectionId: string, args: QueryExecutionArgs): [number, Promise<arrow.Table | null>] => {
        const logger = this.deps.logger;
        const queryId = allocateQueryId();
        const trace = createTrace();
        const record: QueryRecord = {
            queryId,
            connectionId,
            args,
            cancellation: new AbortController(),
            trace,
            traced: logger.withTrace(trace),
            workbookId: args.metadata.workbookId ?? '',
            connection: null,
            profileViewers: 0,
            started: false,
            table: null,
            cacheEntry: null,
            error: null,
            done: false,
            trino: null,
            stream: null,
            producing: false,
            messages: [],
            wakeMessages: null,
            pendingWrites: 0,
            settled: false,
            execution: null,
        };
        // Every abort stops the query in the executor, it cancels the query at the backend
        record.cancellation.signal.addEventListener('abort', () => {
            if (record.started) void this.native?.cancel(queryId);
        }, { once: true });
        const cancelFromCaller = () => record.cancellation.abort(args.abortSignal?.reason);
        if (args.abortSignal?.aborted) {
            cancelFromCaller();
        } else {
            args.abortSignal?.addEventListener('abort', cancelFromCaller, { once: true });
        }
        this.records.set(queryId, record);
        const logObserver = args.onLog == null ? null : (entry: LogRecord) => {
            try {
                args.onLog?.(entry.message);
            } catch {
                // A progress surface must never interrupt query execution or logger delivery.
            }
        };
        if (logObserver != null) logger.buffer.subscribeTrace(trace.traceId, logObserver);
        const execution = this.executeWithId(record);
        record.execution = execution;
        const settle = () => {
            args.abortSignal?.removeEventListener('abort', cancelFromCaller);
            if (logObserver != null) logger.buffer.unsubscribeTrace(trace.traceId, logObserver);
            record.settled = true;
            this.forget(record);
        };
        void execution.then(settle, settle);
        return [queryId, execution];
    };

    /// Forget a query once it settled and its writes into the cache reported
    private forget(record: QueryRecord): void {
        if (record.settled && record.pendingWrites === 0 && this.records.get(record.queryId) === record) {
            this.records.delete(record.queryId);
        }
    }

    /// Cancel a query, resolves once its execution settled
    cancel: CancelQuery = async (_connectionId, queryId) => {
        const record = this.records.get(queryId);
        if (record == null || record.settled) return;
        record.cancellation.abort();
        if (record.started) await this.native?.cancel(queryId);
        await record.execution?.catch(() => null);
    };

    /// Show the profile of a running query: the connector then fetches the plan and its statistics (Trino)
    watchProfile: WatchQueryProfile = queryId => {
        const update = (delta: 1 | -1) => {
            const record = this.records.get(queryId);
            if (record == null || record.settled) return;
            record.profileViewers = Math.max(0, record.profileViewers + delta);
            if (record.started) this.native?.watchProfile(queryId, delta);
        };
        update(1);
        return () => update(-1);
    };

    /// Apply an action to the connection of a query
    private dispatch(record: QueryRecord, action: QueryExecutionAction): void {
        this.deps.dispatchConnection(record.connectionId, action);
    }

    /// Execute a query with pre-allocated query id
    private async executeWithId(record: QueryRecord): Promise<arrow.Table | null> {
        const { queryId, connectionId, args, traced } = record;
        const computeDb = this.deps.computeDatabase;
        // The analysis of results computes on the compute database, a query without one runs without it
        if (!computeDb && args.analyzeResults) {
            throw new Error(`Compute database is not yet ready`);
        }
        const conn = this.deps.readConnections().connections.get(connectionId);
        if (!conn) {
            traced.error("Connection not configured", { connectionId, "query": queryId.toString() }, LOG_CTX);
            throw new Error(`Couldn't find a connection with id ${connectionId}`);
        }
        record.connection = conn;
        // The query is in the history of the connection from the start
        const initialState = createQueryExecutionState(queryId, record.trace.traceId, args.query, args.metadata, record.cancellation);
        this.dispatch(record, { type: EXECUTE_QUERY, value: [queryId, initialState] });

        let request: core.DashQLQueryRequest;
        let native: core.DashQLQueryExecutor;
        try {
            native = this.nativeOf(conn.instance);
            request = await this.describeRequest(record, conn);
        } catch (error) {
            this.finish(record, { type: QUERY_FAILED, value: [queryId, asLoggableException(error, LOG_CTX), null] });
            throw error;
        }
        record.started = true;
        const outcome = native.execute(queryId, request, args.failure);
        // The executor knows the query now, a cancel before it started cancels it there
        if (record.cancellation.signal.aborted) void native.cancel(queryId);
        for (let i = 0; i < record.profileViewers; ++i) native.watchProfile(queryId, 1);
        const result = await outcome;
        if (result.status === 'resolved') {
            return result.hasResult ? record.table : null;
        }
        throw record.error ?? this.errorOf(record, result.failure, result.value);
    }

    /// The error of a failure. What the host failed with stays, the cancellation of the caller is its reason.
    private errorOf(record: QueryRecord, failure: core.DashQLQueryFailure, value: unknown): unknown {
        if (failure.hostValue) {
            if (failure.kind === 'processing') {
                return value instanceof LoggableException
                    ? value
                    : new LoggableException('Query result processing failed', { error: stringifyError(value) }, LOG_CTX);
            }
            return value;
        }
        switch (failure.kind) {
            case 'cacheMiss':
                return new QueryCacheMissError();
            case 'cancelled':
                return record.cancellation.signal.reason ?? abortError();
            default:
                return new LoggableException(failure.message, failure.details, failure.target);
        }
    }

    /// Where the query runs and what the executor does around it
    private async describeRequest(record: QueryRecord, conn: ConnectionState): Promise<core.DashQLQueryRequest> {
        const { args } = record;
        const computeDb = this.deps.computeDatabase;
        const resultCache = this.deps.resultCache;
        // The cache of the app holds Parquet files that the compute database writes and reads
        let cacheKey: string | null = null;
        if (args.cacheable && args.cacheSignature && resultCache != null && supportsParquet(computeDb)) {
            cacheKey = await computeQueryCacheKeyForConnection(conn.details, args.cacheSignature);
        }
        const logDetails: Record<string, string> = { workbookId: record.workbookId };
        // Where a statement of a plan of workbook scripts comes from, e.g. `bar.sql 2/3 · inlines foo.sql`
        if (args.metadata.planned != null) {
            logDetails.planned = args.metadata.title ?? '';
            logDetails.node = args.metadata.planned.node.toString();
        }
        return {
            connectionId: record.connectionId,
            text: args.query,
            target: await this.describeTarget(record, conn),
            publishResults: args.publishResults !== false,
            analyzeResults: args.analyzeResults === true,
            cache: cacheKey == null ? null : { key: cacheKey, refresh: args.refreshCache === true },
            cacheOnly: args.cacheOnly === true,
            // Nothing that runs on Salesforce changes its relations
            touchesRelations: args.metadata.userProvided && conn.details.type !== SALESFORCE_DATA_CLOUD_CONNECTOR,
            throwOnError: args.throwOnError === true,
            failure: args.failure == null ? null : { message: args.failure.message },
            logDetails,
        };
    }

    /// The target of a query: a channel that the executor speaks itself, or a channel of the host
    private async describeTarget(record: QueryRecord, conn: ConnectionState): Promise<core.DashQLQueryTarget> {
        const { args } = record;
        const details = conn.details;
        if (args.clientFunctionCall != null) {
            const binding = connectorOfDetails(details).clientFunctions;
            const spec = binding == null ? null : JSON.stringify(await binding.loadSpec());
            const channel = details.value.channel as SalesforceDatabaseChannel | null;
            const tokens = channel?.coreToken != null && channel.dataCloudToken != null
                ? { core: channel.coreToken, dataCloud: channel.dataCloudToken }
                : null;
            return {
                type: 'clientFunction',
                connector: conn.connectorInfo.connectorType,
                spec,
                description: args.clientFunctionCall,
                tokens,
            };
        }
        const override = args.channelOverride;
        const channel: unknown = override != null ? override.channel : details.value.channel;
        // A Trino channel whose requests go over the HTTP client of the platform
        if (channel instanceof TrinoChannel && (override == null || override.type === 'trino')) {
            const endpoint = channel.endpoint;
            record.trino = channel;
            return {
                type: 'trino',
                endpoint: endpoint.endpoint,
                auth: endpoint.authParams,
                accessToken: endpoint.oauthState?.accessToken ?? null,
                catalog: channel.defaults.catalog,
                schema: channel.defaults.schema,
            };
        }
        // A Hyper channel over the HTTP API, also the one of a Salesforce connection
        const hyper = channel as HyperDatabaseChannel | null;
        if (hyper?.describeHttp != null) {
            const described = await hyper.describeHttp();
            if (described != null) {
                return {
                    type: 'hyperHttp',
                    params: described.params,
                    clientContext: described.clientContext,
                    auth: described.auth,
                    parallelChunks: described.parallelChunks,
                };
            }
        }
        return { type: 'host' };
    }

    /// Finish a query in the history once
    private finish(record: QueryRecord, action: QueryExecutionAction): void {
        if (record.done) return;
        record.done = true;
        this.dispatch(record, action);
    }

    /// The statement may have changed relations, the catalog loader asks the connection about them
    private touchRelations(record: QueryRecord): void {
        const conn = record.connection;
        if (conn == null) return;
        try {
            const touched = conn.instance.touchedRelations(record.args.query);
            if (touched.length > 0) this.deps.dispatchConnection(record.connectionId, { type: RELATIONS_TOUCHED, value: touched });
        } catch (e: any) {
            // Following the catalog must not change the outcome of the statement
            record.traced.warn("Failed to read the relations of a statement", { query: record.queryId.toString(), error: stringifyError(e) }, LOG_CTX);
        }
    }

    /// Apply an event of the executor
    private report(queryId: number, text: string, payload: unknown): void {
        const record = this.records.get(queryId);
        if (record == null) return;
        const event = JSON.parse(text);
        const { args, traced } = record;
        switch (event.type) {
            case 'sending':
                this.dispatch(record, { type: QUERY_SENDING, value: [queryId] });
                break;
            case 'running':
                this.dispatch(record, { type: QUERY_RUNNING, value: [queryId] });
                break;
            case 'progress':
                // The update of the executor carries the structured progress, the history of the connection keeps it
                this.dispatch(record, { type: QUERY_PROGRESS_UPDATED, value: [queryId, payload as core.QueryProgressUpdate] });
                break;
            case 'receivedBatch':
                this.dispatch(record, { type: QUERY_RECEIVED_BATCH, value: [queryId, event.metrics as QueryExecutionMetrics] });
                break;
            case 'receivedAllBatches': {
                if (!event.host) record.table = arrow.tableFromIPC(payload as Uint8Array);
                if (record.table != null) {
                    this.dispatch(record, { type: QUERY_RECEIVED_ALL_BATCHES, value: [queryId, record.table, event.metrics as QueryExecutionMetrics] });
                }
                break;
            }
            case 'processingResults':
                this.dispatch(record, { type: QUERY_PROCESSING_RESULTS, value: [queryId] });
                break;
            case 'processedResults':
                this.dispatch(record, { type: QUERY_PROCESSED_RESULTS, value: [queryId] });
                break;
            case 'succeeded':
                this.finish(record, { type: QUERY_SUCCEEDED, value: [queryId] });
                break;
            case 'failed': {
                const failure = event.failure as core.DashQLQueryFailure;
                const error = this.errorOf(record, failure, payload);
                record.error = error;
                // The preset failure and a failed analysis are logged already
                if (args.failure == null && failure.kind !== 'processing') logQueryFailure(traced, error, queryId, record.workbookId);
                this.finish(record, { type: QUERY_FAILED, value: [queryId, asLoggableException(error, LOG_CTX), event.metrics ?? null] });
                break;
            }
            case 'cancelled': {
                const failure = event.failure as core.DashQLQueryFailure;
                const error = this.errorOf(record, failure, payload);
                record.error = error;
                const cancellation = error instanceof LoggableException ? error : new LoggableException('Query was cancelled', {}, LOG_CTX);
                this.finish(record, { type: QUERY_CANCELLED, value: [queryId, cancellation, event.metrics ?? null] });
                break;
            }
            case 'cacheRecorded':
                this.dispatch(record, { type: QUERY_CACHE_RECORDED, value: [queryId, event.key, event.servedFromCache, event.cachedAt ?? null] });
                if (!event.servedFromCache) this.writeReported(record);
                break;
            case 'touchRelations':
                this.touchRelations(record);
                break;
            case 'timing':
                try {
                    args.onTiming?.(event.label, event.elapsedMs);
                } catch {
                    // Timing observers must not interrupt query execution.
                }
                break;
            case 'resultsReady':
                try {
                    args.onResultsReady?.();
                } catch {
                    // Scheduler notifications must not interrupt query execution.
                }
                break;
            case 'log': {
                const log = traced[event.level as 'debug' | 'info' | 'warn' | 'error'].bind(traced);
                log(event.message, event.details, event.target);
                if (event.message === 'Failed to write query cache') this.writeReported(record);
                break;
            }
            case 'trinoTokenRefreshed': {
                // The channel keeps the refreshed token for the next queries
                const oauth = record.trino?.endpoint.oauthState;
                if (oauth != null) oauth.accessToken = event.token;
                break;
            }
        }
    }

    /// A write into the cache reported, the record may go
    private writeReported(record: QueryRecord): void {
        record.pendingWrites = Math.max(0, record.pendingWrites - 1);
        this.forget(record);
    }

    /// A query of a record
    private recordOf(queryId: number): QueryRecord {
        const record = this.records.get(queryId);
        if (record == null) throw new Error(`Unknown query ${queryId}`);
        return record;
    }

    /// Run a query on the channel of its connection
    private async openChannel(record: QueryRecord): Promise<boolean> {
        const conn = record.connection;
        if (conn == null) throw new Error(`Couldn't find a connection with id ${record.connectionId}`);
        const stream = await connectorOfDetails(conn.details).executeQuery(conn.details.value, record.args, record.cancellation.signal);
        if (stream == null) return false;
        record.stream = stream;
        return true;
    }

    /// Queue a message of a channel
    private pushMessage(record: QueryRecord, message: ChannelMessage): void {
        record.messages.push(message);
        const wake = record.wakeMessages;
        record.wakeMessages = null;
        wake?.();
    }

    /// Start producing the result of a channel
    private produce(record: QueryRecord, stream: QueryExecutionResponseStream): void {
        const publish = record.args.publishResults !== false;
        let batches = 0;
        const batchConsumer = {
            resolve: (_stream: QueryExecutionResponseStream, batch: arrow.RecordBatch) => {
                if (!publish) return;
                ++batches;
                const ipc = tableIPC(new arrow.Table([batch]));
                this.pushMessage(record, { type: 'batch', ipc, metrics: JSON.stringify(stream.getMetrics()) });
            },
            reject: () => { },
        };
        const progressConsumer = {
            resolve: (_stream: QueryExecutionResponseStream, progress: QueryExecutionProgress) => {
                this.pushMessage(record, { type: 'progress', progress });
            },
            reject: () => { },
        };
        Promise.resolve().then(() => stream.produce(batchConsumer, progressConsumer, record.cancellation.signal)).then(
            async () => {
                let schema: Uint8Array | null = null;
                if (publish && batches === 0) {
                    const empty = new arrow.Table(await stream.getSchema() ?? new arrow.Schema(), []);
                    schema = tableIPC(empty);
                }
                this.pushMessage(record, { type: 'end', schema, metrics: JSON.stringify(stream.getMetrics()) });
            },
        ).catch((error: unknown) => this.pushMessage(record, { type: 'error', error }));
    }

    /// The next message of a channel
    private async nextMessage(record: QueryRecord): Promise<core.QueryExecutorChannelMessage> {
        const stream = record.stream;
        if (stream == null) throw new Error('The query has no stream');
        if (!record.producing) {
            record.producing = true;
            this.produce(record, stream);
        }
        while (record.messages.length === 0) {
            await new Promise<void>(resolve => { record.wakeMessages = resolve; });
        }
        const message = record.messages.shift()!;
        if (message.type === 'error') throw message.error;
        return message;
    }

    /// The host of the executor
    private createHost(): core.QueryExecutorHost {
        const { logger } = this.deps;
        return {
            now: () => Date.now(),
            setTimer: (ms, callback) => setTimeout(callback, ms),
            clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
            log: (level, message, details) => {
                logger[level](message, JSON.parse(details), LOG_CTX);
            },
            fetch: async (requestId, request) => {
                const abort = new AbortController();
                this.fetchAborts.set(requestId, abort);
                try {
                    const response = await this.deps.http.fetch(request.url, {
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
                    // core keeps only the message
                    const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
                    if (error instanceof Error && cause instanceof Error) {
                        throw new Error(`${error.message}: ${cause.message}`);
                    }
                    throw error;
                } finally {
                    this.fetchAborts.delete(requestId);
                }
            },
            abortFetch: requestId => {
                this.fetchAborts.get(requestId)?.abort(new DOMException('The request was cancelled', 'AbortError'));
            },
            report: (queryId, event, payload) => this.report(queryId, event, payload),
            cacheLookup: async (queryId, key) => {
                const record = this.recordOf(queryId);
                const entry = await this.deps.resultCache!.lookup(key);
                record.cacheEntry = entry;
                return entry == null ? null : { name: entry.name, cachedAt: entry.cachedAtMs };
            },
            cacheRead: async (queryId, name) => {
                const record = this.recordOf(queryId);
                const table = await this.deps.resultCache!.readTable(this.deps.computeDatabase as ParquetDatabase, name);
                record.table = table;
                return { rows: table.numRows, columns: table.numCols };
            },
            cacheTouch: async (_queryId, name) => {
                await this.deps.resultCache!.touch(name);
            },
            cacheWrite: async (queryId, key) => {
                const record = this.recordOf(queryId);
                // The record stays until the executor reported the write
                ++record.pendingWrites;
                const table = record.table;
                const resultCache = this.deps.resultCache!;
                if (table == null) throw new Error('The query has no result');
                // Hyper writes the file into the mounted cache, the new file stays pinned until it is complete
                const name = resultCache.newFileName(key);
                const release = await resultCache.pin(name);
                try {
                    await resultCache.writeTable(this.deps.computeDatabase as ParquetDatabase, table, name);
                } finally {
                    await release();
                }
            },
            analyzeResult: async queryId => {
                const record = this.recordOf(queryId);
                const computeDb = this.deps.computeDatabase;
                const table = record.table;
                if (computeDb == null || table == null) return;
                try {
                    await yieldToBrowser();
                    await analyzeTable(queryId, table, this.deps.dispatchComputation, computeDb, record.traced, record.connectionId);
                    record.cancellation.signal.throwIfAborted();
                } catch (e) {
                    // The previous result of the owner stays
                    this.deps.dispatchComputation({ type: DELETE_COMPUTATION, value: [queryId] });
                    throw e;
                }
                // The result replaces the previous result of its owner, or a later result replaced it already
                const owner = record.args.metadata.resultOwner;
                const unused = owner == null ? null : this.resultComputations.retain(owner, queryId);
                if (unused != null) {
                    this.deps.dispatchComputation({ type: DELETE_COMPUTATION, value: [unused] });
                }
            },
            channelOpen: queryId => this.openChannel(this.recordOf(queryId)),
            channelNext: queryId => this.nextMessage(this.recordOf(queryId)),
            channelCancel: async queryId => {
                await this.records.get(queryId)?.stream?.cancel?.();
            },
            channelProfileDetail: (queryId, wanted) => {
                this.records.get(queryId)?.stream?.setProfileDetail?.(wanted);
            },
        };
    }
}
