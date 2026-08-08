import * as arrow from 'apache-arrow';
import * as React from 'react';

import { useConnectionState, useDynamicConnectionDispatch } from './connection_registry.js';
import {
    createQueryResponseStreamMetrics,
    QueryExecutionProgress,
    QueryExecutionResponseStream,
    QueryExecutionState,
    QueryExecutionStatus,
} from './query_execution_state.js';
import { useSalesforceAPI } from './salesforce/salesforce_connector.js';
import { DATALESS_CONNECTOR, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';
import {
    EXECUTE_QUERY,
    QUERY_CANCELLED,
    QUERY_FAILED,
    QUERY_PROGRESS_UPDATED,
    QUERY_RECEIVED_BATCH,
    QUERY_RUNNING,
    QUERY_RECEIVED_ALL_BATCHES,
    QUERY_PROCESSED_RESULTS,
    QUERY_SUCCEEDED,
    QUERY_PROCESSING_RESULTS,
    QUERY_SENDING,
    QUERY_CACHE_RECORDED,
} from './connection_state.js';
import { useComputationRegistry } from '../compute/computation_registry.js';
import { analyzeTable } from '../compute/computation_logic.js';
import { DELETE_COMPUTATION } from '../compute/computation_state.js';
import { useComputeDatabase } from '../compute/compute_connection_provider.js';
import { useStorageReader } from '../platform/storage/storage_provider.js';
import { type CachedQueryResult } from '../platform/storage/storage_backend.js';
import { getConnectionParamsFromStateDetails, createConnectionParamsSignature } from './connection_params.js';
import { ConnectionStateDetailsVariant } from './connection_state_details.js';
import { computeQueryResultCacheKey } from './query_result_cache_key.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { createTrace } from '../platform/logger/trace_context.js';
import { QueryExecutionArgs } from './query_execution_args.js';
import { executeTrinoQuery } from './trino/trino_query_execution.js';
import { executeSalesforceQuery } from './salesforce/salesforce_query_execution.js';
import { executeHyperQuery } from './hyper/hyper_query_execution.js';
import { executeDemoQuery } from './dataless/dataless_demo_query_execution.js';
import { AsyncConsumerLambdas } from '../utils/async_consumer.js';
import { LoggableException, stringifyError } from '../platform/logger/logger.js';

const LOG_CTX = 'query_executor';

let NEXT_QUERY_ID = 1;

/// Compute the file-based cache key for a query against a connection, or null when the connection has
/// no recoverable params/signature (e.g. before setup completes). This is the same derivation the
/// executor uses on its cacheable path. Never throws — a failure to derive the key is reported as
/// null (treat as "not cacheable / a miss").
export async function computeQueryCacheKeyForConnection(
    details: ConnectionStateDetailsVariant,
    queryText: string,
): Promise<string | null> {
    try {
        const params = getConnectionParamsFromStateDetails(details);
        const sig = params ? createConnectionParamsSignature(params) : null;
        if (sig == null) {
            return null;
        }
        return await computeQueryResultCacheKey(sig, queryText);
    } catch {
        return null;
    }
}

/// The query executor function
export type QueryExecutor = (notebookId: string, args: QueryExecutionArgs) => [number, Promise<arrow.Table | null>];
export type CancelQuery = (notebookId: string, queryId: number) => void;
interface QueryExecutionRuntime {
    cancellation: AbortController;
    resultStream: QueryExecutionResponseStream | null;
}
/// The React context to resolve the active query executor
interface QueryExecutorContextValue {
    execute: QueryExecutor;
    cancel: CancelQuery;
}
const EXECUTOR_CTX = React.createContext<QueryExecutorContextValue | null>(null);
/// The hook to resolve the query executor
export const useQueryExecutor = () => React.useContext(EXECUTOR_CTX)!.execute;
export const useCancelQuery = () => React.useContext(EXECUTOR_CTX)!.cancel;
/// Use the query state
export function useQueryState(notebookId: string | null, queryId: number | null) {
    const [connReg, _connDispatch] = useConnectionState(notebookId);
    if (queryId == null) return null;
    return connReg?.queriesActive.get(queryId) ?? connReg?.queriesFinished.get(queryId) ?? null;
}

export function QueryExecutorProvider(props: { children?: React.ReactElement }) {
    const logger = useLogger();
    const sfApi = useSalesforceAPI();

    // The connection registry changes frequently, the connection map is stable.
    // This executor will depend on the map directly since it can resolve everything ad-hoc.
    const [connReg, connDispatch] = useDynamicConnectionDispatch();
    const connMap = connReg.connectionMap;

    const [_, computeDispatch] = useComputationRegistry();
    const computeDb = useComputeDatabase();
    const storageReader = useStorageReader();
    const queryRuntimes = React.useRef(new Map<number, QueryExecutionRuntime>());

    // Execute a query with pre-allocated query id
    const executeImpl = React.useCallback(async (notebookId: string, args: QueryExecutionArgs, queryId: number, runtime: QueryExecutionRuntime): Promise<arrow.Table | null> => {
        // Start a new trace for this query execution
        const trace = createTrace();
        const traced = logger.withTrace(trace);
        if (!computeDb) {
            throw new Error(`Compute database is not yet ready`);
        }
        // Check if we know the notebook id.
        const conn = connMap.get(notebookId);
        if (!conn) {
            traced.error("Connection not configured", { notebookId, "query": queryId.toString() }, LOG_CTX);
            throw new Error(`Couldn't find a connection with notebook id ${notebookId}`);
        }
        traced.info("Executing query", {
            notebookId,
            "query": queryId.toString(),
            "text": args.query
        }, LOG_CTX);

        // Accept the query and clear the request
        const initialState: QueryExecutionState = {
            queryId,
            traceId: trace.traceId,
            queryText: args.query,
            queryMetadata: args.metadata,
            status: QueryExecutionStatus.REQUESTED,
            cancellation: runtime.cancellation,
            resultStream: null,
            error: null,
            metrics: {
                textLength: args.query.length,
                queryRequestedAt: new Date(),
                queryPreparingStartedAt: null,
                querySendingStartedAt: null,
                queryQueuedStartedAt: null,
                queryRunningStartedAt: null,
                receivedFirstBatchAt: null,
                receivedLastBatchAt: null,
                receivedAllBatchesAt: null,
                processingResultsStartedAt: null,
                processedResultsAt: null,
                querySucceededAt: null,
                queryFailedAt: null,
                queryCancelledAt: null,
                lastUpdatedAt: null,
                progressUpdatesReceived: 0,
                queryDurationMs: null,
                streamMetrics: createQueryResponseStreamMetrics(),
            },
            latestProgressUpdate: null,
            resultMetadata: null,
            resultSchema: null,
            resultBatches: [],
            resultTable: null,
            cacheKey: null,
            servedFromCache: false,
            cacheDeleted: false,
            cachedAt: null,
        };

        // Compute the cache key up front for cacheable queries. This is best-effort: if the
        // connection has no recoverable params/signature (e.g. before setup completes) we simply skip
        // caching and execute normally. Never let a cache concern surface into the query path.
        let cacheHash: string | null = null;
        if (args.cacheable) {
            cacheHash = await computeQueryCacheKeyForConnection(conn.details, args.query);
        }

        connDispatch(notebookId, {
            type: EXECUTE_QUERY,
            value: [queryId, initialState],
        });

        // XXX Add explicit query preparation here later

        // Execute the query and consume the results
        let resultStream: QueryExecutionResponseStream | null = null;
        let table: arrow.Table | null = null;
        let servedFromCache = false;
        try {
            // Cache read path: on a hit, load the Arrow IPC bytes and drive the state machine as if
            // the result had just streamed in, skipping the backend entirely.
            if (cacheHash != null) {
                let cached: CachedQueryResult | null = null;
                try {
                    cached = await storageReader.backend.loadQueryResultCache(notebookId, cacheHash);
                } catch (e: any) {
                    traced.warn("Failed to read query cache", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
                }
                // A user cancel during the async cache read should behave like any other cancel:
                // let the catch below route it to QUERY_CANCELLED.
                if (initialState.cancellation.signal.aborted) {
                    throw new Error('AbortError');
                }
                if (cached != null) {
                    table = arrow.tableFromIPC(cached.bytes);
                    servedFromCache = true;
                    // Record the access so eviction sees this as a recently-used (LRU) entry. This
                    // bumps only the empty `.last_access` marker, never the payload, so it is cheap and
                    // leaves the payload's "cached at" write time intact. Best-effort: a failure here
                    // must never surface into the query path (it only means the entry looks colder to
                    // eviction than it is).
                    void storageReader.backend.touchQueryResultCacheAccess(notebookId, cacheHash).catch((e: any) => {
                        traced.warn("Failed to record query cache access", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
                    });
                    traced.info("Served query from cache", {
                        notebookId,
                        "query": queryId.toString(),
                        "numRows": table.numRows.toString(),
                        "numCols": table.numCols.toString(),
                        "cachedAt": new Date(cached.cachedAtMs).toISOString(),
                    }, LOG_CTX);
                    // No live stream, so synthesize empty metadata and zeroed stream metrics.
                    connDispatch(notebookId, {
                        type: QUERY_RECEIVED_ALL_BATCHES,
                        value: [queryId, table, new Map<string, string>(), createQueryResponseStreamMetrics()],
                    });
                    // Record the cache key and the entry's write time so the UI can show how old the
                    // cached result is and offer to delete it.
                    connDispatch(notebookId, {
                        type: QUERY_CACHE_RECORDED,
                        value: [queryId, cacheHash, true, cached.cachedAtMs],
                    });
                }
            }

            if (!servedFromCache) {
                connDispatch(notebookId, {
                    type: QUERY_SENDING,
                    value: [queryId],
                });

                // Start the query
                switch (conn.details.type) {
                    case SALESFORCE_DATA_CLOUD_CONNECTOR:
                        resultStream = await executeSalesforceQuery(conn.details.value, args, initialState.cancellation.signal);
                        break;
                    case HYPER_CONNECTOR:
                        resultStream = await executeHyperQuery(conn.details.value, args, initialState.cancellation.signal);
                        break;
                    case TRINO_CONNECTOR:
                        resultStream = await executeTrinoQuery(conn.details.value, args, initialState.cancellation.signal);
                        break;
                    case DATALESS_CONNECTOR:
                        resultStream = await executeDemoQuery(conn.details.value, args, initialState.cancellation.signal);
                        break;
                }
                traced.debug("Received query results", {
                    notebookId,
                    "query": queryId.toString()
                }, LOG_CTX);

                if (resultStream != null) {
                    runtime.resultStream = resultStream;
                    connDispatch(notebookId, {
                        type: QUERY_RUNNING,
                        value: [queryId, resultStream],
                    });

                    // Helper to forward progress updates
                    const consumeProgress = new AsyncConsumerLambdas<QueryExecutionResponseStream, QueryExecutionProgress>(
                        (_: QueryExecutionResponseStream, progress: QueryExecutionProgress) => {
                            connDispatch(notebookId, {
                                type: QUERY_PROGRESS_UPDATED,
                                value: [queryId, progress],
                            });
                        },
                    );

                    // Helper to consume result batches
                    const batches: arrow.RecordBatch[] = [];
                    const consumeBatches = new AsyncConsumerLambdas<QueryExecutionResponseStream, arrow.RecordBatch>(
                        (ctx: QueryExecutionResponseStream, batch: arrow.RecordBatch) => {
                            batches.push(batch);

                            traced.debug("Received result batch", {
                                notebookId,
                                "query": queryId.toString(),
                                "batchColumns": batch.numCols.toString(),
                                "batchRows": batch.numRows.toString(),
                            }, LOG_CTX);
                            connDispatch(notebookId, {
                                type: QUERY_RECEIVED_BATCH,
                                value: [queryId, batch, ctx.getMetrics()],
                            });
                        },
                    );

                    // Subscribe to query_status and result messages
                    await resultStream.produce(consumeBatches, consumeProgress, initialState.cancellation.signal);
                    const schema = batches.length > 0
                        ? batches[0].schema
                        : await resultStream.getSchema() ?? new arrow.Schema();
                    table = new arrow.Table(schema, batches);

                    traced.info("Executed query", {
                        notebookId,
                        "query": queryId.toString(),
                        "numRows": table.numRows.toString(),
                        "numCols": table.numCols.toString(),
                        "batchesReceived": resultStream.getMetrics().totalBatchesReceived.toString(),
                        "dataBytesReceived": resultStream.getMetrics().totalDataBytesReceived.toString(),
                    }, LOG_CTX);

                    // Is there any metadata?
                    const metadata = resultStream.getMetadata();
                    connDispatch(notebookId, {
                        type: QUERY_RECEIVED_ALL_BATCHES,
                        value: [queryId, table!, metadata, resultStream!.getMetrics()],
                    });
                } else {
                    traced.warn("Query returned no results", { notebookId, "query": queryId.toString() }, LOG_CTX);
                }
            }
        } catch (e: any) {
            if (initialState.cancellation.signal.aborted || e?.name === 'AbortError' || e?.message === 'AbortError') {
                const cancellationError = e instanceof LoggableException
                    ? e
                    : new LoggableException('Query was cancelled', {}, LOG_CTX);
                traced.warn("Cancelled query", {
                    query: queryId.toString(),
                    notebookId
                }, LOG_CTX);
                connDispatch(notebookId, {
                    type: QUERY_CANCELLED,
                    value: [queryId, cancellationError, resultStream?.getMetrics() ?? null],
                });
            } else {
                if (e instanceof LoggableException) {
                    traced.warn(e.message, e.keyValues, e.target);
                } else {
                    traced.warn("Query failed with unknown error", {
                        query: queryId.toString(),
                        notebookId,
                        raw: stringifyError(e),
                    }, LOG_CTX);
                }
                connDispatch(notebookId, {
                    type: QUERY_FAILED,
                    value: [queryId, e, resultStream?.getMetrics() ?? null],
                });
            }
            return null;
        }


        // Compute all table summaries of the result
        if (table && args.analyzeResults) {
            try {
                if (args.replaceComputationId != null && args.replaceComputationId !== queryId) {
                    computeDispatch({
                        type: DELETE_COMPUTATION,
                        value: [args.replaceComputationId],
                    });
                }
                connDispatch(notebookId, {
                    type: QUERY_PROCESSING_RESULTS,
                    value: [queryId],
                });

                await analyzeTable(queryId, table!, computeDispatch, computeDb, traced, args.projection);
                initialState.cancellation.signal.throwIfAborted();

                connDispatch(notebookId, {
                    type: QUERY_PROCESSED_RESULTS,
                    value: [queryId],
                });
            } catch (e: any) {
                if (initialState.cancellation.signal.aborted || e?.name === 'AbortError') {
                    const cancellationError = e instanceof LoggableException
                        ? e
                        : new LoggableException('Query was cancelled', {}, LOG_CTX);
                    traced.warn("Cancelled query during result processing", {
                        query: queryId.toString(),
                        notebookId,
                    }, LOG_CTX);
                    connDispatch(notebookId, {
                        type: QUERY_CANCELLED,
                        value: [queryId, cancellationError, resultStream?.getMetrics() ?? null],
                    });
                    return null;
                }
                const processingError = e instanceof LoggableException
                    ? e
                    : new LoggableException("Query result processing failed", {
                        error: stringifyError(e),
                    }, LOG_CTX);
                traced.warn("Query result processing failed", {
                    query: queryId.toString(),
                    notebookId,
                    error: processingError.message,
                    ...processingError.keyValues,
                }, LOG_CTX);
                connDispatch(notebookId, {
                    type: QUERY_FAILED,
                    value: [queryId, processingError, null],
                });
                throw processingError;
            }
        }

        // Mark as succeeded
        connDispatch(notebookId, {
            type: QUERY_SUCCEEDED,
            value: [queryId],
        });

        // Cache write path: after a successful miss, store the result for next time. Fire-and-forget
        // (not awaited) so a large eviction scan never stalls the caller's promise, and never fatal —
        // a quota/permission failure just logs.
        if (!servedFromCache && cacheHash != null && table != null) {
            const bytes = arrow.tableToIPC(table, 'stream');
            void storageReader.backend.saveQueryResultCache(notebookId, cacheHash, bytes).then(() => {
                // The write landed: record the key (but not servedFromCache — this run hit the
                // backend) so the UI can offer to delete the freshly-cached entry. The "cached at"
                // time is the write we just made; a later hit reads the precise mtime from disk.
                connDispatch(notebookId, {
                    type: QUERY_CACHE_RECORDED,
                    value: [queryId, cacheHash, false, null],
                });
            }).catch((e: any) => {
                traced.warn("Failed to write query cache", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
            });
        }

        return table;

    }, [computeDb, connMap, computeDispatch, logger, sfApi, storageReader]);

    // Allocate the next query id and start the execution
    const execute = React.useCallback<QueryExecutor>((notebookId: string, args: QueryExecutionArgs): [number, Promise<arrow.Table | null>] => {
        const queryId = NEXT_QUERY_ID++;
        const runtime: QueryExecutionRuntime = {
            cancellation: new AbortController(),
            resultStream: null,
        };
        queryRuntimes.current.set(queryId, runtime);
        const execution = executeImpl(notebookId, args, queryId, runtime);
        const removeRuntime = () => queryRuntimes.current.delete(queryId);
        void execution.then(removeRuntime, removeRuntime);
        return [queryId, execution];
    }, [executeImpl]);

    const cancel = React.useCallback<CancelQuery>((notebookId, queryId) => {
        const runtime = queryRuntimes.current.get(queryId);
        if (runtime == null) return;
        runtime.cancellation.abort();
        const cancellation = runtime.resultStream?.cancel?.();
        void cancellation?.catch((e: any) => {
            logger.warn('Failed to cancel query at the backend', {
                query: queryId.toString(),
                notebookId,
                error: stringifyError(e),
            }, LOG_CTX);
        });
    }, [logger]);

    const value = React.useMemo(() => ({ execute, cancel }), [execute, cancel]);

    return (
        <EXECUTOR_CTX.Provider value={value}>
            {props.children}
        </EXECUTOR_CTX.Provider>
    );
}
