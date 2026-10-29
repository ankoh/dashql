import * as arrow from 'apache-arrow';

import { AsyncConsumerLambdas } from '../../utils/async_consumer.js';
import type { TracedLogger } from '../../platform/logger/logger.js';
import type { QueryExecutionProgress, QueryExecutionResponseStream } from '../../query/query_execution_state.js';
import { connectorOfDetails } from './connector_descriptor.js';
import type { ConnectionStateDetailsVariant } from './connection_state_details.js';
import type { QueryExecutionArgs } from './query_execution_args.js';

/// Execute a query on the channel of a connection
export function executeConnectionQuery(
    details: ConnectionStateDetailsVariant,
    args: QueryExecutionArgs,
    abort?: AbortSignal,
): Promise<QueryExecutionResponseStream> {
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
        sessionId: string;
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
                    sessionId: args.logContext.sessionId,
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
