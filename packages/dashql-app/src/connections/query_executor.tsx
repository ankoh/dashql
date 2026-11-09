import * as arrow from 'apache-arrow';
import * as React from 'react';

import type * as core from '@ankoh/dashql-core';

import { useConnectionDispatch, useConnectionRegistryStore, useDynamicConnectionDispatch } from './connection_registry.js';
import { RELATIONS_TOUCHED } from './connection_state.js';
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
import { useComputationDispatch } from '../compute/computation_registry.js';
import { analyzeTable } from '../compute/analyze_table.js';
import { DELETE_COMPUTATION } from '../compute/computation_state.js';
import { ResultComputations } from './result_computations.js';
import { useComputeDatabase } from '../compute/compute_connection_provider.js';
import { QueryCacheMissError, type QueryResultCacheEntry } from '../query/query_result_cache.js';
import { getConnectionParamsFromStateDetails, createConnectionParamsSignature } from './connection_params.js';
import { ConnectionStateDetailsVariant } from './connection_state_details.js';
import { computeQueryResultCacheKey } from '../query/query_result_cache_key.js';
import { useHttpClient } from '../platform/http/http_client_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { createTrace, type TraceContext } from '../platform/logger/trace_context.js';
import { QueryExecutionArgs } from './query_execution_args.js';
import { LoggableException, stringifyError, type TracedLogger } from '../platform/logger/logger.js';
import type { LogRecord } from '../platform/logger/log_buffer.js';
import { allocateQueryId, executeTrackedQuery } from '../query/tracked_query_execution.js';
import { consumeQueryResponseStream, executeConnectionQuery } from './query_execution.js';
import { yieldToBrowser } from '../utils/yield_to_browser.js';
import { supportsParquet, type ParquetDatabase } from '../platform/hyperdb/hyperdb_parquet_export.js';
import { useQueryResultCache } from '../storage/query_result_cache_provider.js';
import { QueryProgressModels, type EngineProgressPayload } from '../query/query_progress_model.js';
import { createProgressLayoutConfig } from '../views/query_profile/profile_layout_config.js';
import { useDashQLCoreSetup, type DashQLSetupFn } from '../runtime/core_provider.js';

const LOG_CTX = 'query_executor';

/// Query failures are logged as warnings.
/// The failed run already shows the error inline, error toasts are reserved for failures of the app itself.
export function logQueryFailure(logger: TracedLogger, error: unknown, queryId: number, sessionId: string): void {
    if (error instanceof LoggableException) {
        logger.warn(error.message, {
            ...error.keyValues,
            queryId: queryId.toString(),
            sessionId,
        }, error.target);
    } else {
        logger.warn('Query failed with unknown error', {
            queryId: queryId.toString(),
            sessionId,
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

/// The query executor function
export type QueryExecutor = (connectionId: string, args: QueryExecutionArgs) => [number, Promise<arrow.Table | null>];
export type CancelQuery = (connectionId: string, queryId: number) => Promise<void>;
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
/// Show the profile of a running query, returns the function that stops showing it
export type WatchQueryProfile = (queryId: number) => () => void;
/// The React context to resolve the active query executor
export interface QueryExecutorContextValue {
    execute: QueryExecutor;
    cancel: CancelQuery;
    watchProfile: WatchQueryProfile;
}
export const EXECUTOR_CTX = React.createContext<QueryExecutorContextValue | null>(null);
/// The hook to resolve the query executor
export const useQueryExecutor = () => React.useContext(EXECUTOR_CTX)!.execute;
export const useCancelQuery = () => React.useContext(EXECUTOR_CTX)!.cancel;
/// Show the profile of a query while the component is mounted: the connector then fetches the plan and its
/// statistics (Trino). Without executor, e.g. in tests, nothing is fetched.
export function useQueryProfileDetail(queryId: number | null, enabled = true) {
    const watchProfile = React.useContext(EXECUTOR_CTX)?.watchProfile;
    React.useEffect(() => {
        if (!enabled || queryId == null || watchProfile == null) return;
        return watchProfile(queryId);
    }, [watchProfile, queryId, enabled]);
}
/// Use the query state
export function useQueryState(sessionId: string | null, queryId: number | null) {
    // Subscribe to the single query instead of the registry.
    // The registry changes with every lifecycle event of every query, including the internal queries of computations.
    const store = useConnectionRegistryStore();
    const getQueryState = React.useCallback(() => {
        if (queryId == null || sessionId == null) return null;
        // Query ids are unique across connections. A script that moved to another connection keeps
        // the result of its last query on the connection it left.
        for (const database of store.current.connections.values()) {
            const query = database.queriesActive.get(queryId) ?? database.queriesFinished.get(queryId);
            if (query != null) return query;
        }
        return null;
    }, [store, sessionId, queryId]);
    return React.useSyncExternalStore(store.subscribe, getQueryState);
}

function createConnectionQueryExecutionTracker(connectionId: string, dispatch: ReturnType<typeof useDynamicConnectionDispatch>[1]): QueryExecutionTracker {
    return {
        dispatch: action => dispatch(connectionId, action),
    };
}

export function QueryExecutorProvider(props: { children?: React.ReactElement }) {
    const logger = useLogger();
    const http = useHttpClient();

    // The connection registry changes frequently.
    // This executor resolves everything ad-hoc through the registry store and never re-renders for registry changes.
    const connStore = useConnectionRegistryStore();
    const connDispatch = useConnectionDispatch();

    const computeDispatch = useComputationDispatch();
    const computeDb = useComputeDatabase();
    const queryResultCache = useQueryResultCache();
    const queryRuntimes = React.useRef(new Map<number, QueryExecutionRuntime>());
    const resultComputations = React.useRef(new ResultComputations());

    // The progress models of the running queries, they need the core. The core is requested with the first
    // structured progress, until it is ready the progress has no structure.
    const coreSetup = useDashQLCoreSetup() as DashQLSetupFn | null;
    const progressModels = React.useRef(new QueryProgressModels(createProgressLayoutConfig()));
    const progressCore = React.useRef<core.DashQL | null>(null);
    const progressCoreRequested = React.useRef(false);
    const applyEngineProgress = React.useCallback((queryId: number, payload: EngineProgressPayload) => {
        if (progressCore.current == null && !progressCoreRequested.current && coreSetup != null) {
            progressCoreRequested.current = true;
            coreSetup('query_progress').then(
                instance => { progressCore.current = instance; },
                () => { /* Queries run without structured progress */ },
            );
        }
        return progressModels.current.apply(progressCore.current, queryId, payload);
    }, [coreSetup]);

    // Execute a query with pre-allocated query id
    const executeImpl = React.useCallback(async (connectionId: string, args: QueryExecutionArgs, queryId: number, runtime: QueryExecutionRuntime, trace: TraceContext): Promise<arrow.Table | null> => {
        const traced = logger.withTrace(trace);
        if (!computeDb) {
            throw new Error(`Compute database is not yet ready`);
        }
        const conn = connStore.current.connections.get(connectionId);
        if (!conn) {
            traced.error("Connection not configured", { connectionId, "query": queryId.toString() }, LOG_CTX);
            throw new Error(`Couldn't find a connection with id ${connectionId}`);
        }
        // Results are cached per session, queries without a session are never cached
        const querySessionId = args.metadata.sessionId ?? null;
        // Log contexts carry strings
        const sessionId = querySessionId ?? '';
        const queryTracker = createConnectionQueryExecutionTracker(connectionId, connDispatch);
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
                    sessionId,
                    "query": queryId.toString(),
                    // Where a statement of a plan of session scripts comes from, e.g. `bar.sql 2/3 · inlines foo.sql`
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
                        sessionId,
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
                    if (!args.analyzeResults) return;
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
                    const unused = owner == null ? null : resultComputations.current.retain(owner, queryId);
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

                // Compute the cache key up front for cacheable queries. This is best-effort: if the
                // connection has no recoverable params/signature (e.g. before setup completes) we simply skip
                // caching and execute normally. Never let a cache concern surface into the query path.
                // XXX Add explicit query preparation here later

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
                            sessionId,
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
                                        : applyEngineProgress(queryId, progress.engineProgress);
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
                                logContext: { sessionId, queryId, target: LOG_CTX },
                            });

                            traced.info("Executed query", {
                                sessionId,
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
                            traced.warn("Query returned no results", { sessionId, "query": queryId.toString() }, LOG_CTX);
                        }
                    }
                } catch (e: any) {
                    if (initialState.cancellation.signal.aborted || e?.name === 'AbortError' || e?.message === 'AbortError') {
                        const cancellationError = e instanceof LoggableException
                            ? e
                            : new LoggableException('Query was cancelled', {}, LOG_CTX);
                        traced.warn("Cancelled query", {
                            query: queryId.toString(),
                            sessionId
                        }, LOG_CTX);
                        tracked.cancel(cancellationError, resultStream?.getMetrics() ?? null);
                    } else {
                        logQueryFailure(traced, e, queryId, sessionId);
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
                                sessionId,
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
                            sessionId,
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

    }, [computeDb, connStore, connDispatch, computeDispatch, logger, http, queryResultCache, applyEngineProgress]);

    // Allocate the next query id and start the execution
    const execute = React.useCallback<QueryExecutor>((connectionId: string, args: QueryExecutionArgs): [number, Promise<arrow.Table | null>] => {
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
        queryRuntimes.current.set(queryId, runtime);
        const logObserver = args.onLog == null ? null : (record: LogRecord) => {
            try {
                args.onLog?.(record.message);
            } catch {
                // A progress surface must never interrupt query execution or logger delivery.
            }
        };
        if (logObserver != null) logger.buffer.subscribeTrace(trace.traceId, logObserver);
        const execution = executeImpl(connectionId, args, queryId, runtime, trace);
        runtime.execution = execution;
        const removeRuntime = () => {
            args.abortSignal?.removeEventListener('abort', cancelFromCaller);
            queryRuntimes.current.delete(queryId);
            progressModels.current.release(queryId);
            if (logObserver != null) logger.buffer.unsubscribeTrace(trace.traceId, logObserver);
        };
        void execution.then(removeRuntime, removeRuntime);
        return [queryId, execution];
    }, [executeImpl, logger]);

    const cancel = React.useCallback<CancelQuery>(async (connectionId, queryId) => {
        const runtime = queryRuntimes.current.get(queryId);
        if (runtime == null) return;
        runtime.cancellation.abort();
        await runtime.backendCancellation;
        await runtime.execution?.catch(() => null);
    }, []);

    const watchProfile = React.useCallback<WatchQueryProfile>(queryId => {
        const update = (delta: number) => {
            const runtime = queryRuntimes.current.get(queryId);
            if (runtime == null) return;
            runtime.profileViewers = Math.max(0, runtime.profileViewers + delta);
            runtime.resultStream?.setProfileDetail?.(runtime.profileViewers > 0);
        };
        update(1);
        return () => update(-1);
    }, []);

    const value = React.useMemo(() => ({ execute, cancel, watchProfile }), [execute, cancel, watchProfile]);

    return (
        <EXECUTOR_CTX.Provider value={value}>
            {props.children}
        </EXECUTOR_CTX.Provider>
    );
}
