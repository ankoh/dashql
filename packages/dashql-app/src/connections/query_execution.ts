import * as arrow from 'apache-arrow';

import { AsyncConsumerLambdas } from '@ankoh/dashql-sdk/utils/async_consumer';
import type { TracedLogger } from '@ankoh/dashql-sdk/platform/logger/logger';
import type { QueryExecutionProgress, QueryExecutionResponseStream } from '@ankoh/dashql-sdk/query/query_execution_state';
import { executeConnectionClientFunction, type ClientFunctionServices } from './connection_client_functions.js';
import { connectorOfDetails } from '@ankoh/dashql-sdk/connections/connector_descriptor';
import type { ConnectionStateDetailsVariant } from '@ankoh/dashql-sdk/connections/connection_state_details';
import type { QueryExecutionArgs } from '@ankoh/dashql-sdk/connections/query_execution_args';

/// Execute a query on the channel of a connection, a client function call as requests to its service
export function executeConnectionQuery(
    details: ConnectionStateDetailsVariant,
    args: QueryExecutionArgs,
    services: ClientFunctionServices,
    abort?: AbortSignal,
): Promise<QueryExecutionResponseStream> {
    if (args.clientFunctionCall != null) {
        return executeConnectionClientFunction(details, args.clientFunctionCall, services, abort);
    }
    return connectorOfDetails(details).executeQuery(details.value, args, abort);
}

interface ConsumeQueryResponseStreamArgs {
    stream: QueryExecutionResponseStream;
    abort?: AbortSignal;
    publishResults: boolean;
    onProgress: (progress: QueryExecutionProgress) => void;
    onBatch?: (batch: arrow.RecordBatch, stream: QueryExecutionResponseStream) => void;
    onResultsReceived?: () => void;
    logger?: TracedLogger;
    logContext?: {
        workbookId: string;
        queryId: number;
        target: string;
    };
}

export async function consumeQueryResponseStream(args: ConsumeQueryResponseStreamArgs): Promise<arrow.Table | null> {
    const batches: arrow.RecordBatch[] = [];
    const consumeProgress = new AsyncConsumerLambdas<QueryExecutionResponseStream, QueryExecutionProgress>(
        (_stream, progress) => args.onProgress(progress),
    );
    const consumeBatches = new AsyncConsumerLambdas<QueryExecutionResponseStream, arrow.RecordBatch>(
        (stream, batch) => {
            if (!args.publishResults) return;
            batches.push(batch);
            if (args.logger && args.logContext) {
                args.logger.debug("Received result batch", {
                    workbookId: args.logContext.workbookId,
                    query: args.logContext.queryId.toString(),
                    batchColumns: batch.numCols.toString(),
                    batchRows: batch.numRows.toString(),
                }, args.logContext.target);
            }
            args.onBatch?.(batch, stream);
        },
    );

    await args.stream.produce(consumeBatches, consumeProgress, args.abort);
    args.onResultsReceived?.();
    if (!args.publishResults) return null;

    const schema = batches.length > 0
        ? batches[0].schema
        : await args.stream.getSchema() ?? new arrow.Schema();
    return new arrow.Table(schema, batches);
}
