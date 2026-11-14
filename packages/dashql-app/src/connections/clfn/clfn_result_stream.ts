import * as arrow from 'apache-arrow';

import type { Logger } from '@ankoh/dashql-sdk/platform/logger/logger';
import { createQueryResponseStreamMetrics, QueryExecutionMetrics, QueryExecutionProgress, QueryExecutionResponseStream, QueryExecutionStatus } from '@ankoh/dashql-sdk/query/query_execution_state';
import type { AsyncConsumer } from '@ankoh/dashql-sdk/utils/async_consumer';
import { translateAnyRowsToArrowBatch } from '@ankoh/dashql-sdk/connections/trino/arrow_conversion';
import type { ClientFunctionResult } from '@ankoh/dashql-sdk/connections/clfn/clfn_runtime';

/// The result of a client function call as a query result. A call has finished once its table exists, so this holds one batch.
export class ClientFunctionResultStream implements QueryExecutionResponseStream {
    private readonly metrics: QueryExecutionMetrics = createQueryResponseStreamMetrics();
    private status: QueryExecutionStatus = QueryExecutionStatus.RECEIVED_FIRST_BATCH;

    constructor(private readonly logger: Logger, private readonly result: ClientFunctionResult) { }

    getMetadata(): Map<string, string> {
        return new Map();
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
