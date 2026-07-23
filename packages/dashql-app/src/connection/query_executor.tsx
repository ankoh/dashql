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
import { useComputeDatabase } from '../compute/compute_connection_provider.js';
import { useStorageReader } from '../platform/storage/storage_provider.js';
import { type CachedQueryResult } from '../platform/storage/storage_backend.js';
import { getConnectionParamsFromStateDetails, createConnectionParamsSignature } from './connection_params.js';
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

/// The query executor function
export type QueryExecutor = (sessionId: string, args: QueryExecutionArgs) => [number, Promise<arrow.Table | null>];
/// The React context to resolve the active query executor
const EXECUTOR_CTX = React.createContext<QueryExecutor | null>(null);
/// The hook to resolve the query executor
export const useQueryExecutor = () => React.useContext(EXECUTOR_CTX)!;
/// Use the query state
export function useQueryState(sessionId: string | null, queryId: number | null) {
    const [connReg, _connDispatch] = useConnectionState(sessionId);
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

    // Execute a query with pre-allocated query id
    const executeImpl = React.useCallback(async (sessionId: string, args: QueryExecutionArgs, queryId: number): Promise<arrow.Table | null> => {
        // Start a new trace for this query execution
        const trace = createTrace();
        const traced = logger.withTrace(trace);
        if (!computeDb) {
            throw new Error(`Compute database is not yet ready`);
        }
        // Check if we know the session id.
        const conn = connMap.get(sessionId);
        if (!conn) {
            traced.error("Connection not configured", { "session": sessionId, "query": queryId.toString() }, LOG_CTX);
            throw new Error(`Couldn't find a connection with session id ${sessionId}`);
        }
        traced.info("Executing query", {
            "session": sessionId,
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
            cancellation: new AbortController(),
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
        connDispatch(sessionId, {
            type: EXECUTE_QUERY,
            value: [queryId, initialState],
        });

        // XXX Add explicit query preparation here later

        // Compute the cache key up front for cacheable queries. This is best-effort: if the
        // connection has no recoverable params/signature (e.g. before setup completes) we simply skip
        // caching and execute normally. Never let a cache concern surface into the query path.
        let cacheHash: string | null = null;
        if (args.cacheable) {
            try {
                const params = getConnectionParamsFromStateDetails(conn.details);
                const sig = params ? createConnectionParamsSignature(params) : null;
                if (sig != null) {
                    cacheHash = await computeQueryResultCacheKey(sig, args.query);
                }
            } catch (e: any) {
                traced.warn("Failed to compute query cache key", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
                cacheHash = null;
            }
        }

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
                    cached = await storageReader.backend.loadQueryResultCache(sessionId, cacheHash);
                } catch (e: any) {
                    traced.warn("Failed to read query cache", { query: queryId.toString(), error: stringifyError(e) }, LOG_CTX);
                    cached = null;
                }
                // A user cancel during the async cache read should behave like any other cancel:
                // let the catch below route it to QUERY_CANCELLED.
                if (initialState.cancellation.signal.aborted) {
                    throw new Error('AbortError');
                }
                if (cached != null) {
                    table = arrow.tableFromIPC(cached.bytes);
                    servedFromCache = true;
                    traced.info("Served query from cache", {
                        "session": sessionId,
                        "query": queryId.toString(),
                        "numRows": table.numRows.toString(),
                        "numCols": table.numCols.toString(),
                        "cachedAt": new Date(cached.cachedAtMs).toISOString(),
                    }, LOG_CTX);
                    // No live stream, so synthesize empty metadata and zeroed stream metrics.
                    connDispatch(sessionId, {
                        type: QUERY_RECEIVED_ALL_BATCHES,
                        value: [queryId, table, new Map<string, string>(), createQueryResponseStreamMetrics()],
                    });
                    // Record the cache key and the entry's write time so the UI can show how old the
                    // cached result is and offer to delete it.
                    connDispatch(sessionId, {
                        type: QUERY_CACHE_RECORDED,
                        value: [queryId, cacheHash, true, cached.cachedAtMs],
                    });
                }
            }

            if (!servedFromCache) {
                connDispatch(sessionId, {
                    type: QUERY_SENDING,
                    value: [queryId],
                });

                // Start the query
                switch (conn.details.type) {
                    case SALESFORCE_DATA_CLOUD_CONNECTOR:
                        resultStream = await executeSalesforceQuery(conn.details.value, args);
                        break;
                    case HYPER_CONNECTOR:
                        resultStream = await executeHyperQuery(conn.details.value, args);
                        break;
                    case TRINO_CONNECTOR:
                        resultStream = await executeTrinoQuery(conn.details.value, args);
                        break;
                    case DATALESS_CONNECTOR:
                        resultStream = await executeDemoQuery(conn.details.value, args);
                        break;
                }
                traced.debug("Received query results", {
                    "session": sessionId,
                    "query": queryId.toString()
                }, LOG_CTX);

                if (resultStream != null) {
                    connDispatch(sessionId, {
                        type: QUERY_RUNNING,
                        value: [queryId, resultStream],
                    });

                    // Helper to forward progress updates
                    const consumeProgress = new AsyncConsumerLambdas<QueryExecutionResponseStream, QueryExecutionProgress>(
                        (_: QueryExecutionResponseStream, progress: QueryExecutionProgress) => {
                            connDispatch(sessionId, {
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
                                "session": sessionId,
                                "query": queryId.toString(),
                                "batchColumns": batch.numCols.toString(),
                                "batchRows": batch.numRows.toString(),
                            }, LOG_CTX);
                            connDispatch(sessionId, {
                                type: QUERY_RECEIVED_BATCH,
                                value: [queryId, batch, ctx.getMetrics()],
                            });
                        },
                    );

                    // Subscribe to query_status and result messages
                    await resultStream.produce(consumeBatches, consumeProgress);
                    table = new arrow.Table(batches.length > 0 ? batches[0].schema : new arrow.Schema(), batches);

                    traced.info("Executed query", {
                        "session": sessionId,
                        "query": queryId.toString(),
                        "numRows": table.numRows.toString(),
                        "numCols": table.numCols.toString(),
                        "batchesReceived": resultStream.getMetrics().totalBatchesReceived.toString(),
                        "dataBytesReceived": resultStream.getMetrics().totalDataBytesReceived.toString(),
                    }, LOG_CTX);

                    // Is there any metadata?
                    const metadata = resultStream.getMetadata();
                    connDispatch(sessionId, {
                        type: QUERY_RECEIVED_ALL_BATCHES,
                        value: [queryId, table!, metadata, resultStream!.getMetrics()],
                    });
                } else {
                    traced.error("Query returned no results", { "session": sessionId, "query": queryId.toString() }, LOG_CTX);
                }
            }
        } catch (e: any) {
            if ((e.message === 'AbortError')) {
                traced.warn("Cancelled query", {
                    query: queryId.toString(),
                    session: sessionId
                }, LOG_CTX);
                connDispatch(sessionId, {
                    type: QUERY_CANCELLED,
                    value: [queryId, e, resultStream?.getMetrics() ?? null],
                });
            } else {
                if (e instanceof LoggableException) {
                    traced.exception(e);
                } else {
                    traced.error("Query failed with unknown error", {
                        query: queryId.toString(),
                        session: sessionId,
                        raw: stringifyError(e),
                    });
                }
                connDispatch(sessionId, {
                    type: QUERY_FAILED,
                    value: [queryId, e, resultStream?.getMetrics() ?? null],
                });
            }
            return null;
        }


        // Compute all table summaries of the result
        if (table && args.analyzeResults) {
            try {
                connDispatch(sessionId, {
                    type: QUERY_PROCESSING_RESULTS,
                    value: [queryId],
                });

                await analyzeTable(queryId, table!, computeDispatch, computeDb, traced, args.projection);

                connDispatch(sessionId, {
                    type: QUERY_PROCESSED_RESULTS,
                    value: [queryId],
                });
            } catch (e: any) {
                console.error(e);
                connDispatch(sessionId, {
                    type: QUERY_FAILED,
                    value: [queryId, e, null],
                });
                throw e;
            }
        }

        // Mark as succeeded
        connDispatch(sessionId, {
            type: QUERY_SUCCEEDED,
            value: [queryId],
        });

        // Cache write path: after a successful miss, store the result for next time. Fire-and-forget
        // (not awaited) so a large eviction scan never stalls the caller's promise, and never fatal —
        // a quota/permission failure just logs.
        if (!servedFromCache && cacheHash != null && table != null) {
            const bytes = arrow.tableToIPC(table, 'stream');
            void storageReader.backend.saveQueryResultCache(sessionId, cacheHash, bytes).then(() => {
                // The write landed: record the key (but not servedFromCache — this run hit the
                // backend) so the UI can offer to delete the freshly-cached entry. The "cached at"
                // time is the write we just made; a later hit reads the precise mtime from disk.
                connDispatch(sessionId, {
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
    const execute = React.useCallback<QueryExecutor>((sessionId: string, args: QueryExecutionArgs): [number, Promise<arrow.Table | null>] => {
        const queryId = NEXT_QUERY_ID++;
        const execution = executeImpl(sessionId, args, queryId);
        return [queryId, execution];
    }, [executeImpl]);

    return (
        <EXECUTOR_CTX.Provider value={execute}>
            {props.children}
        </EXECUTOR_CTX.Provider>
    );
}
