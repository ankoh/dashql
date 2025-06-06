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
import { DEMO_CONNECTOR, HYPER_GRPC_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';
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
} from './connection_state.js';
import { useComputationRegistry } from '../compute/computation_registry.js';
import { analyzeTable } from '../compute/computation_actions.js';
import { useDashQLComputeWorker } from '../compute/compute_provider.js';
import { useLogger } from '../platform/logger_provider.js';
import { QueryExecutionArgs } from './query_execution_args.js';
import { executeTrinoQuery } from './trino/trino_query_execution.js';
import { executeSalesforceQuery } from './salesforce/salesforce_query_execution.js';
import { executeHyperQuery } from './hyper/hyper_query_execution.js';
import { executeDemoQuery } from './demo/demo_query_execution.js';
import { AsyncConsumerLambdas } from '../utils/async_consumer.js';

const LOG_CTX = 'query_executor';

let NEXT_QUERY_ID = 1;

/// The query executor function
export type QueryExecutor = (connectionId: number, args: QueryExecutionArgs) => [number, Promise<arrow.Table | null>];
/// The React context to resolve the active query executor
const EXECUTOR_CTX = React.createContext<QueryExecutor | null>(null);
/// The hook to resolve the query executor
export const useQueryExecutor = () => React.useContext(EXECUTOR_CTX)!;
/// Use the query state
export function useQueryState(connectionId: number | null, queryId: number | null) {
    const [connReg, _connDispatch] = useConnectionState(connectionId);
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

    // We auto-register each successfull query result with the dashql-compute worker
    const [_, computeDispatch] = useComputationRegistry();
    // Use the compute worker
    const computeWorker = useDashQLComputeWorker();

    // Execute a query with pre-allocated query id
    const executeImpl = React.useCallback(async (connectionId: number, args: QueryExecutionArgs, queryId: number): Promise<arrow.Table | null> => {
        // Make sure the compute worker is available
        if (!computeWorker) {
            throw new Error(`compute worker is not yet ready`);
        }
        // Check if we know the connection id.
        const conn = connMap.get(connectionId);
        if (!conn) {
            logger.error("connection is not configured", { "connection": connectionId.toString(), "query": queryId.toString() }, LOG_CTX);
            throw new Error(`couldn't find a connection with id ${connectionId}`);
        }
        logger.debug("executing query", { "connection": connectionId.toString(), "query": queryId.toString(), "text": args.query }, LOG_CTX);

        // Accept the query and clear the request
        const initialState: QueryExecutionState = {
            queryId,
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
        };
        connDispatch(connectionId, {
            type: EXECUTE_QUERY,
            value: [queryId, initialState],
        });

        // XXX Add explicit query preparation here later

        // Execute the query and consume the results
        let resultStream: QueryExecutionResponseStream | null = null;
        let table: arrow.Table | null = null;
        try {
            connDispatch(connectionId, {
                type: QUERY_SENDING,
                value: [queryId],
            });

            // Start the query
            switch (conn.details.type) {
                case SALESFORCE_DATA_CLOUD_CONNECTOR:
                    resultStream = await executeSalesforceQuery(conn.details.value, args);
                    break;
                case HYPER_GRPC_CONNECTOR:
                    resultStream = await executeHyperQuery(conn.details.value, args);
                    break;
                case TRINO_CONNECTOR:
                    resultStream = await executeTrinoQuery(conn.details.value, args);
                    break;
                case DEMO_CONNECTOR:
                    resultStream = await executeDemoQuery(conn.details.value, args);
                    break;
            }
            logger.debug("retrieved query results", { "connection": connectionId.toString(), "query": queryId.toString() }, LOG_CTX);

            if (resultStream != null) {
                connDispatch(connectionId, {
                    type: QUERY_RUNNING,
                    value: [queryId, resultStream],
                });

                // Helper to forward progress updates
                const consumeProgress = new AsyncConsumerLambdas<QueryExecutionResponseStream, QueryExecutionProgress>(
                    (_: QueryExecutionResponseStream, progress: QueryExecutionProgress) => {
                        connDispatch(connectionId, {
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

                        logger.info("received result batch", { "connection": connectionId.toString(), "query": queryId.toString() }, LOG_CTX);
                        connDispatch(connectionId, {
                            type: QUERY_RECEIVED_BATCH,
                            value: [queryId, batch, ctx.getMetrics()],
                        });
                    },
                );

                // Subscribe to query_status and result messages
                await resultStream.produce(consumeBatches, consumeProgress);
                table = new arrow.Table(batches.length > 0 ? batches[0].schema : new arrow.Schema(), batches);

                // Is there any metadata?
                const metadata = resultStream.getMetadata();
                connDispatch(connectionId, {
                    type: QUERY_RECEIVED_ALL_BATCHES,
                    value: [queryId, table!, metadata, resultStream!.getMetrics()],
                });
            } else {
                logger.error("query returned no results", { "connection": connectionId.toString(), "query": queryId.toString() }, LOG_CTX);
            }
        } catch (e: any) {
            if ((e.message === 'AbortError')) {
                connDispatch(connectionId, {
                    type: QUERY_CANCELLED,
                    value: [queryId, e, resultStream?.getMetrics() ?? null],
                });
            } else {
                console.error(e);
                connDispatch(connectionId, {
                    type: QUERY_FAILED,
                    value: [queryId, e, resultStream?.getMetrics() ?? null],
                });
            }
            throw e;
        }


        // Compute all table summaries of the result
        if (table && args.analyzeResults) {
            try {
                connDispatch(connectionId, {
                    type: QUERY_PROCESSING_RESULTS,
                    value: [queryId],
                });

                await analyzeTable(queryId, table!, computeDispatch, computeWorker, logger);

                connDispatch(connectionId, {
                    type: QUERY_PROCESSED_RESULTS,
                    value: [queryId],
                });
            } catch (e: any) {
                console.error(e);
                connDispatch(connectionId, {
                    type: QUERY_FAILED,
                    value: [queryId, e, null],
                });
                throw e;
            }
        }

        // Mark as succeeded
        connDispatch(connectionId, {
            type: QUERY_SUCCEEDED,
            value: [queryId],
        });
        return table;

    }, [connMap, sfApi]);

    // Allocate the next query id and start the execution
    const execute = React.useCallback<QueryExecutor>((connectionId: number, args: QueryExecutionArgs): [number, Promise<arrow.Table | null>] => {
        const queryId = NEXT_QUERY_ID++;
        const execution = executeImpl(connectionId, args, queryId);
        return [queryId, execution];
    }, [executeImpl]);

    return (
        <EXECUTOR_CTX.Provider value={execute}>
            {props.children}
        </EXECUTOR_CTX.Provider>
    );
}
