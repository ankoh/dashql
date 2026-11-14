import * as arrow from 'apache-arrow';

import type * as core from '@ankoh/dashql-core';

import { RELATIONS_TOUCHED } from './connection_state.js';
import type { ConnectionRegistry, DynamicConnectionDispatch } from './connection_registry_state.js';
import { SALESFORCE_DATA_CLOUD_CONNECTOR } from './connector_info.js';
import {
    createQueryResponseStreamMetrics,
    QUERY_CACHE_RECORDED,
    QUERY_PROCESSING_RESULTS,
    QUERY_PROCESSED_RESULTS,
    QUERY_PROGRESS_UPDATED,
    QUERY_RECEIVED_ALL_BATCHES,
    QUERY_RECEIVED_BATCH,
    QueryExecutionResponseStream,
    QueryExecutionTracker,
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
import { allocateQueryId, executeTrackedQuery } from '../query/tracked_query_execution.js';
import { consumeQueryResponseStream, executeConnectionQuery } from './query_execution.js';
import { yieldToBrowser } from '../utils/yield_to_browser.js';
import { supportsParquet, type ParquetDatabase } from '../platform/hyperdb/hyperdb_parquet_export.js';
import { QueryProgressModels, type EngineProgressPayload } from '../query/query_progress_model.js';
import { createProgressLayoutConfig } from '../query/profile/profile_layout_config.js';
import type { Dispatch } from '../utils/variant.js';

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
    /// Instantiate the core, null without one. The progress of queries is structured once the core is ready.
    setupCore: ((context: string) => Promise<core.DashQL>) | null;
}

interface QueryExecutionRuntime {
    /// Aborted by cancel() and by the abort signal of the caller, both stop the query at the backend
    cancellation: AbortController;
    resultStream: QueryExecutionResponseStream | null;
    /// The cancellation of the result stream at the backend, sent once
    backendCancellation: Promise<void> | null;
    execution: Promise<arrow.Table | null> | null;
    /// The views that show the profile of the query
    profileViewers: number;
}

/// Runs queries on connections: the cache of results, the progress of the engines, the analysis of the results and
/// the relations that statements touch. One executor serves every connection, the queries of all of them share the
/// ids of one sequence.
export class QueryExecutorService {
    private deps: QueryExecutorDependencies;
    private readonly runtimes = new Map<number, QueryExecutionRuntime>();
    private readonly resultComputations = new ResultComputations();
    // The progress models of the running queries, they need the core. The core is requested with the first
    // structured progress, until it is ready the progress has no structure.
    private readonly progressModels = new QueryProgressModels(createProgressLayoutConfig());
    private progressCore: core.DashQL | null = null;
    private progressCoreRequested = false;

    constructor(deps: QueryExecutorDependencies) {
        this.deps = deps;
    }

    /// Replace the dependencies, the running queries keep the ones they started with
    setDependencies(deps: QueryExecutorDependencies): void {
        this.deps = deps;
    }

    private applyEngineProgress(queryId: number, payload: EngineProgressPayload) {
        const setupCore = this.deps.setupCore;
        if (this.progressCore == null && !this.progressCoreRequested && setupCore != null) {
            this.progressCoreRequested = true;
            setupCore('query_progress').then(
                instance => { this.progressCore = instance; },
                () => { /* Queries run without structured progress */ },
            );
        }
        return this.progressModels.apply(this.progressCore, queryId, payload);
    }

    /// Allocate the next query id and start the execution
    execute: QueryExecutor = (connectionId: string, args: QueryExecutionArgs): [number, Promise<arrow.Table | null>] => {
        const logger = this.deps.logger;
        const queryId = allocateQueryId();
        const trace = createTrace();
        const runtime: QueryExecutionRuntime = {
            cancellation: new AbortController(),
            resultStream: null,
            backendCancellation: null,
            execution: null,
            profileViewers: 0,
        };
        // Every abort stops the query at the backend, a stream that arrives later is cancelled when it arrives
        runtime.cancellation.signal.addEventListener('abort', () => {
            const stream = runtime.resultStream;
            if (stream?.cancel == null) return;
            runtime.backendCancellation = stream.cancel().catch((e: any) => {
                logger.warn('Failed to cancel query at the backend', {
                    query: queryId.toString(),
                    connectionId,
                    error: stringifyError(e),
                }, LOG_CTX);
            });
        }, { once: true });
        const cancelFromCaller = () => runtime.cancellation.abort(args.abortSignal?.reason);
        if (args.abortSignal?.aborted) {
            cancelFromCaller();
        } else {
            args.abortSignal?.addEventListener('abort', cancelFromCaller, { once: true });
        }
        this.runtimes.set(queryId, runtime);
        const logObserver = args.onLog == null ? null : (record: LogRecord) => {
            try {
                args.onLog?.(record.message);
            } catch {
                // A progress surface must never interrupt query execution or logger delivery.
            }
        };
        if (logObserver != null) logger.buffer.subscribeTrace(trace.traceId, logObserver);
        const execution = this.executeWithId(connectionId, args, queryId, runtime, trace);
        runtime.execution = execution;
        const removeRuntime = () => {
            args.abortSignal?.removeEventListener('abort', cancelFromCaller);
            this.runtimes.delete(queryId);
            this.progressModels.release(queryId);
            if (logObserver != null) logger.buffer.unsubscribeTrace(trace.traceId, logObserver);
        };
        void execution.then(removeRuntime, removeRuntime);
        return [queryId, execution];
    };

    /// Cancel a query, resolves once its execution settled
    cancel: CancelQuery = async (_connectionId, queryId) => {
        const runtime = this.runtimes.get(queryId);
        if (runtime == null) return;
        runtime.cancellation.abort();
        await runtime.backendCancellation;
        await runtime.execution?.catch(() => null);
    };

    /// Show the profile of a running query: the connector then fetches the plan and its statistics (Trino)
    watchProfile: WatchQueryProfile = queryId => {
        const update = (delta: number) => {
            const runtime = this.runtimes.get(queryId);
            if (runtime == null) return;
            runtime.profileViewers = Math.max(0, runtime.profileViewers + delta);
            runtime.resultStream?.setProfileDetail?.(runtime.profileViewers > 0);
        };
        update(1);
        return () => update(-1);
    };

    /// Execute a query with pre-allocated query id
    private async executeWithId(connectionId: string, args: QueryExecutionArgs, queryId: number, runtime: QueryExecutionRuntime, trace: TraceContext): Promise<arrow.Table | null> {
        const { logger, http, dispatchConnection: connDispatch, dispatchComputation: computeDispatch, computeDatabase: computeDb, resultCache: queryResultCache } = this.deps;
        const traced = logger.withTrace(trace);
        // The analysis of results computes on the compute database, a query without one runs without it
        if (!computeDb && args.analyzeResults) {
            throw new Error(`Compute database is not yet ready`);
        }
        const conn = this.deps.readConnections().connections.get(connectionId);
        if (!conn) {
            traced.error("Connection not configured", { connectionId, "query": queryId.toString() }, LOG_CTX);
            throw new Error(`Couldn't find a connection with id ${connectionId}`);
        }
        // Results are cached per workbook, queries without a workbook are never cached
        const queryWorkbookId = args.metadata.workbookId ?? null;
        // Log contexts carry strings
        const workbookId = queryWorkbookId ?? '';
        const queryTracker: QueryExecutionTracker = { dispatch: action => connDispatch(connectionId, action) };
        const execution = await executeTrackedQuery({
            query: args.query,
            metadata: args.metadata,
            tracker: queryTracker,
            queryId,
            trace,
            cancellation: runtime.cancellation,
            autoStart: false,
            errorTarget: LOG_CTX,
            execute: async tracked => {
                if (args.failure != null) throw args.failure;
                const initialState = tracked.initialState;
                let queryExecutionStartedAt: number | null = null;
                let queryExecutionReported = false;
                const startQueryExecution = () => {
                    queryExecutionStartedAt = performance.now();
                };
                const reportQueryExecution = () => {
                    if (queryExecutionStartedAt == null || queryExecutionReported) return;
                    queryExecutionReported = true;
                    try {
                        args.onTiming?.('Results', performance.now() - queryExecutionStartedAt);
                    } catch {
                        // Timing observers must not interrupt query execution.
                    }
                };
                const measurePostprocessing = async (process: () => Promise<void>) => {
                    const startedAt = performance.now();
                    try {
                        await process();
                    } finally {
                        try {
                            args.onTiming?.('Postprocess', performance.now() - startedAt);
                        } catch {
                            // Timing observers must not interrupt query execution.
                        }
                    }
                };
                let resultsReady = false;
                const reportResultsReady = () => {
                    if (resultsReady) return;
                    resultsReady = true;
                    try {
                        args.onResultsReady?.();
                    } catch {
                        // Scheduler notifications must not interrupt query execution.
                    }
                };
                traced.info("Executing query", {
                    workbookId,
                    "query": queryId.toString(),
                    // Where a statement of a plan of workbook scripts comes from, e.g. `bar.sql 2/3 · inlines foo.sql`
                    ...(args.metadata.planned != null ? { "planned": args.metadata.title ?? '', "node": args.metadata.planned.node.toString() } : {}),
                    "text": args.query
                }, LOG_CTX);

                // The cache of the app holds Parquet files that the compute database writes and reads
                const resultCache = queryResultCache;
                let cacheHash: string | null = null;
                if (args.cacheable && args.cacheSignature && resultCache != null && supportsParquet(computeDb)) {
                    cacheHash = await computeQueryCacheKeyForConnection(conn.details, args.cacheSignature);
                }
                const parquetDb = computeDb as ParquetDatabase;

                // Cache read path: on a hit, read the Parquet file and drive the state machine as if
                // the result had just streamed in, skipping the backend entirely.
                const serveFromCache = async (): Promise<arrow.Table | null> => {
                    if (cacheHash == null || args.refreshCache) return null;
                    let cached: QueryResultCacheEntry | null = null;
                    try {
                        cached = await resultCache!.lookup(cacheHash);
                    } catch (e: any) {
                        traced.warn("Failed to read query cache", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
                    }
                    // A user cancel during the async cache read behaves like any other cancel
                    initialState.cancellation.signal.throwIfAborted();
                    if (cached == null) return null;
                    let table: arrow.Table;
                    try {
                        table = await resultCache!.readTable(parquetDb, cached.name);
                    } catch (e: any) {
                        // An unreadable entry is a miss
                        traced.warn("Failed to read cached query result", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
                        return null;
                    }
                    initialState.cancellation.signal.throwIfAborted();
                    // Record the access so eviction sees this as a recently-used (LRU) entry. This
                    // bumps only the empty `.last_access` marker, never the payload, so it is cheap and
                    // leaves the payload's "cached at" write time intact. Best-effort: a failure here
                    // must never surface into the query path (it only means the entry looks colder to
                    // eviction than it is).
                    void resultCache!.touch(cached.name).catch((e: any) => {
                        traced.warn("Failed to record query cache access", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
                    });
                    traced.info("Served query from cache", {
                        workbookId,
                        "query": queryId.toString(),
                        "numRows": table.numRows.toString(),
                        "numCols": table.numCols.toString(),
                        "cachedAt": new Date(cached.cachedAtMs).toISOString(),
                    }, LOG_CTX);
                    // No live stream, so synthesize empty metadata and zeroed stream metrics.
                    queryTracker.dispatch({
                        type: QUERY_RECEIVED_ALL_BATCHES,
                        value: [queryId, table, new Map<string, string>(), createQueryResponseStreamMetrics()],
                    });
                    // Record the cache key and the entry's write time so the UI can show how old the
                    // cached result is and offer to delete it.
                    queryTracker.dispatch({
                        type: QUERY_CACHE_RECORDED,
                        value: [queryId, cacheHash, true, cached.cachedAtMs],
                    });
                    return table;
                };
                // Compute all table summaries of the result
                const analyzeResults = async (table: arrow.Table) => {
                    if (!args.analyzeResults || computeDb == null) return;
                    queryTracker.dispatch({ type: QUERY_PROCESSING_RESULTS, value: [queryId] });
                    try {
                        await measurePostprocessing(async () => {
                            await yieldToBrowser();
                            await analyzeTable(queryId, table, computeDispatch, computeDb, traced, connectionId);
                            initialState.cancellation.signal.throwIfAborted();
                        });
                    } catch (e) {
                        // The previous result of the owner stays
                        computeDispatch({ type: DELETE_COMPUTATION, value: [queryId] });
                        throw e;
                    }
                    // The result replaces the previous result of its owner, or a later result replaced it already
                    const owner = args.metadata.resultOwner;
                    const unused = owner == null ? null : this.resultComputations.retain(owner, queryId);
                    if (unused != null) {
                        computeDispatch({ type: DELETE_COMPUTATION, value: [unused] });
                    }
                    queryTracker.dispatch({ type: QUERY_PROCESSED_RESULTS, value: [queryId] });
                };
                // Cache write path: after a successful miss, store the result for next time. Fire-and-forget
                // (not awaited) so a large eviction scan never stalls the caller's promise, and never fatal —
                // a quota/permission failure just logs.
                const storeInCache = (table: arrow.Table | null) => {
                    if (cacheHash == null || table == null) return;
                    // Hyper writes the file into the mounted cache, the new file stays pinned until it is complete
                    const write = async () => {
                        const name = resultCache!.newFileName(cacheHash!);
                        const release = await resultCache!.pin(name);
                        try {
                            await resultCache!.writeTable(parquetDb, table, name);
                        } finally {
                            await release();
                        }
                    };
                    void write().then(() => {
                        // The write landed: record the key (but not servedFromCache — this run hit the
                        // backend) so the UI can offer to delete the freshly-cached entry. The "cached at"
                        // time is the write we just made; a later hit reads the precise mtime from disk.
                        queryTracker.dispatch({
                            type: QUERY_CACHE_RECORDED,
                            value: [queryId, cacheHash!, false, null],
                        });
                    }).catch((e: any) => {
                        traced.warn("Failed to write query cache", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
                    });
                };

                // The statement may have changed relations, the catalog loader asks the connection about them. Also after
                // a failure: a statement of many may have run, and a cancelled one may have run all the same. Nothing that
                // runs on Salesforce changes its relations.
                const followRelations = () => {
                    if (!args.metadata.userProvided || args.cacheOnly || conn.details.type === SALESFORCE_DATA_CLOUD_CONNECTOR) return;
                    try {
                        const touched = conn.instance.touchedRelations(args.query);
                        if (touched.length > 0) connDispatch(connectionId, { type: RELATIONS_TOUCHED, value: touched });
                    } catch (e: any) {
                        // Following the catalog must not change the outcome of the statement
                        traced.warn("Failed to read the relations of a statement", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
                    }
                };

                // Execute the query and consume the results
                let resultStream: QueryExecutionResponseStream | null = null;
                let table: arrow.Table | null = null;
                let servedFromCache = false;
                try {
                    table = await serveFromCache();
                    servedFromCache = table != null;
                    if (!servedFromCache && args.cacheOnly) throw new QueryCacheMissError();

                    if (!servedFromCache) {
                        tracked.sending();

                        // Start the query
                        startQueryExecution();
                        resultStream = await executeConnectionQuery(conn.details, args, { http, logger }, initialState.cancellation.signal);
                        if (initialState.cancellation.signal.aborted) {
                            await resultStream?.cancel?.();
                            initialState.cancellation.signal.throwIfAborted();
                        }
                        traced.debug("Received query results", {
                            workbookId,
                            "query": queryId.toString()
                        }, LOG_CTX);

                        if (resultStream != null) {
                            runtime.resultStream = resultStream;
                            resultStream.setProfileDetail?.(runtime.profileViewers > 0);
                            tracked.running(resultStream);

                            // Subscribe to query_status and result messages
                            table = await consumeQueryResponseStream({
                                stream: resultStream,
                                abort: initialState.cancellation.signal,
                                publishResults: args.publishResults !== false,
                                onProgress: progress => {
                                    const profileProgress = progress.engineProgress == null
                                        ? null
                                        : this.applyEngineProgress(queryId, progress.engineProgress);
                                    queryTracker.dispatch({
                                        type: QUERY_PROGRESS_UPDATED,
                                        value: [queryId, profileProgress == null ? progress : { ...progress, profileProgress }],
                                    });
                                },
                                onBatch: (batch, stream) => queryTracker.dispatch({
                                    type: QUERY_RECEIVED_BATCH,
                                    value: [queryId, batch, stream.getMetrics()],
                                }),
                                onResultsReceived: reportQueryExecution,
                                logger: traced,
                                logContext: { workbookId, queryId, target: LOG_CTX },
                            });

                            traced.info("Executed query", {
                                workbookId,
                                "query": queryId.toString(),
                                "numRows": table?.numRows.toString(),
                                "numCols": table?.numCols.toString(),
                                "batchesReceived": resultStream.getMetrics().totalBatchesReceived.toString(),
                                "dataBytesReceived": resultStream.getMetrics().totalDataBytesReceived.toString(),
                            }, LOG_CTX);

                            // Is there any metadata?
                            const metadata = resultStream.getMetadata();
                            if (table != null) queryTracker.dispatch({
                                type: QUERY_RECEIVED_ALL_BATCHES,
                                value: [queryId, table!, metadata, resultStream!.getMetrics()],
                            });
                        } else {
                            reportQueryExecution();
                            traced.warn("Query returned no results", { workbookId, "query": queryId.toString() }, LOG_CTX);
                        }
                    }
                } catch (e: any) {
                    if (initialState.cancellation.signal.aborted || e?.name === 'AbortError' || e?.message === 'AbortError') {
                        const cancellationError = e instanceof LoggableException
                            ? e
                            : new LoggableException('Query was cancelled', {}, LOG_CTX);
                        traced.warn("Cancelled query", {
                            query: queryId.toString(),
                            workbookId
                        }, LOG_CTX);
                        tracked.cancel(cancellationError, resultStream?.getMetrics() ?? null);
                    } else {
                        logQueryFailure(traced, e, queryId, workbookId);
                        tracked.fail(e, resultStream?.getMetrics() ?? null);
                    }
                    followRelations();
                    if (args.throwOnError) {
                        throw e;
                    }
                    return null;
                }
                if (!servedFromCache) followRelations();

                reportResultsReady();

                if (table != null) {
                    try {
                        await analyzeResults(table);
                    } catch (e: any) {
                        if (initialState.cancellation.signal.aborted || e?.name === 'AbortError') {
                            const cancellationError = e instanceof LoggableException
                                ? e
                                : new LoggableException('Query was cancelled', {}, LOG_CTX);
                            traced.warn("Cancelled query during result processing", {
                                query: queryId.toString(),
                                workbookId,
                            }, LOG_CTX);
                            tracked.cancel(cancellationError, resultStream?.getMetrics() ?? null);
                            if (args.throwOnError) throw e;
                            return null;
                        }
                        const processingError = e instanceof LoggableException
                            ? e
                            : new LoggableException("Query result processing failed", {
                                error: stringifyError(e),
                            }, LOG_CTX);
                        traced.warn("Query result processing failed", {
                            query: queryId.toString(),
                            workbookId,
                            error: processingError.message,
                            ...processingError.keyValues,
                        }, LOG_CTX);
                        tracked.fail(processingError);
                        throw processingError;
                    }
                }

                if (!servedFromCache) storeInCache(table);
                return table;
            },
        });
        return execution;
    }
}
