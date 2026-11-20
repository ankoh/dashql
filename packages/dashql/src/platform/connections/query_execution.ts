import * as arrow from 'apache-arrow';

import type { TracedLogger } from '../logger/logger.js';
import type { QueryExecutionProgress, QueryExecutionResponseStream } from '../query/query_execution_state.js';

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
    for await (const item of args.stream.read(args.abort)) {
        if (item.type === 'progress') {
            args.onProgress(item.progress);
            continue;
        }
        if (!args.publishResults) continue;
        const batch = item.batch;
        batches.push(batch);
        if (args.logger && args.logContext) {
            args.logger.debug("Received result batch", {
                workbookId: args.logContext.workbookId,
                query: args.logContext.queryId.toString(),
                batchColumns: batch.numCols.toString(),
                batchRows: batch.numRows.toString(),
            }, args.logContext.target);
        }
        args.onBatch?.(batch, args.stream);
    }
    args.onResultsReceived?.();
    if (!args.publishResults) return null;

    const schema = batches.length > 0
        ? batches[0].schema
        : await args.stream.getSchema() ?? new arrow.Schema();
    return new arrow.Table(schema, batches);
}
