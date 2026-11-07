import * as arrow from 'apache-arrow';

import type { Logger } from '../../platform/logger/logger.js';
import { createQueryResponseStreamMetrics, QueryExecutionMetrics, QueryExecutionProgress, QueryExecutionResponseStream, QueryExecutionStatus } from '../../query/query_execution_state.js';
import type { AsyncConsumer } from '../../utils/async_consumer.js';
import { translateAnyRowsToArrowBatch } from '../trino/arrow_conversion.js';
import type { ClientFunctionResult } from './clfn_runtime.js';

/// The metadata key that says a call is still running, `_poll` holds the value to poll
export const CLIENT_FUNCTION_PENDING_METADATA = 'dashql.clfn.pending';

/// The result of a client function call as a query result. A call has finished once its table exists, so this holds one batch.
export class ClientFunctionResultStream implements QueryExecutionResponseStream {
    private readonly metrics: QueryExecutionMetrics = createQueryResponseStreamMetrics();
    private status: QueryExecutionStatus = QueryExecutionStatus.RECEIVED_FIRST_BATCH;

    constructor(private readonly logger: Logger, private readonly result: ClientFunctionResult) { }

    getMetadata(): Map<string, string> {
        return new Map(this.result.pending ? [[CLIENT_FUNCTION_PENDING_METADATA, 'true']] : []);
    }
    getMetrics(): QueryExecutionMetrics {
        return this.metrics;
    }
    getStatus(): QueryExecutionStatus {
        return this.status;
    }
    async getSchema(): Promise<arrow.Schema | null> {
        return this.result.schema;
    }
    async produce(batches: AsyncConsumer<QueryExecutionResponseStream, arrow.RecordBatch>, _progress: AsyncConsumer<QueryExecutionResponseStream, QueryExecutionProgress>, abort?: AbortSignal): Promise<void> {
        abort?.throwIfAborted();
        if (this.result.rows.length > 0) {
            const rows = this.result.rows as any[][];
            batches.resolve(this, translateAnyRowsToArrowBatch(this.result.schema, rows, this.logger));
            this.metrics.totalBatchesReceived += 1;
            this.metrics.totalRowsReceived += rows.length;
        }
        this.status = QueryExecutionStatus.RECEIVED_ALL_BATCHES;
    }
}
