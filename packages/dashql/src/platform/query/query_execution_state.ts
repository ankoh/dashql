import * as arrow from 'apache-arrow';
import * as connection from '@akohn/dashql-jsonschema/connection.js';
import type * as core from '../../core/index.js';
import { QueryExecutionStatus, QueryType } from '../../core/index.js';

import type { QueryProfileProgress } from './query_progress.js';

/// The status of the execution of a query, a numeric enum of the module
export { QueryExecutionStatus };

export function queryIsDone(status: QueryExecutionStatus) {
    switch (status) {
        case QueryExecutionStatus.SUCCEEDED:
        case QueryExecutionStatus.FAILED:
        case QueryExecutionStatus.CANCELLED:
            return true;
        default:
            return false;
    }
}

/// The metrics of the response stream of a query, as the connector counts them
export type QueryExecutionMetrics = core.QueryStreamMetrics;

/// The progress of a query: the plain fields and the structured progress of the progress model of the query in the
/// runtime, projected once per change of the query view (`progress` of `QueryExecutionState`)
export interface QueryExecutionProgress {
    /// Is queued?
    isQueued: boolean | null;
    /// The progress in percent, as reported by the server
    progressPercent: number | null;
    /// The number of result rows, as reported by the server
    resultRows: number | null;
    /// The number of rows the server processed
    rowsProcessed: number | null;
    /// The execution time on the server in milliseconds
    executionTimeMs: number | null;
    /// The query execution metrics
    metrics: QueryExecutionMetrics;
    /// The phase the engine reports, e.g. the Trino query state (QUEUED, PLANNING, RUNNING, FINISHING)
    phase?: string | null;
    /// The structured progress (stages, pipelines, the plan) of the progress model of the query
    profileProgress?: QueryProfileProgress | null;
}

/// What the stream of a query result yields: a record batch of the result or the progress of the query
export type QueryStreamItem =
    | { type: 'batch'; batch: arrow.RecordBatch }
    | { type: 'progress'; progress: QueryExecutionProgress };

/// The result of a query on a channel of the host: the embedded Hyper, Hyper over gRPC, the channels of tests
export interface QueryExecutionResponseStream {
    /// Ask the backend to stop the query, when the connector supports explicit cancellation.
    cancel?(): Promise<void>;
    /// Is the profile of the query shown? Connectors fetch the plan and its statistics only then (Trino).
    setProfileDetail?(wanted: boolean): void;
    /// Get the stream metrics
    getMetrics(): QueryExecutionMetrics;
    /// Await the schema message
    getSchema(): Promise<arrow.Schema | null>;
    /// The batches and the progress of the query in order, read once. The reader pulls the next item when it is done
    /// with the last one, the abort signal of the query stops the stream.
    read(abort?: AbortSignal): AsyncIterable<QueryStreamItem>;
}

/// The record batches of a stream, read to the end
export async function readStreamBatches(stream: QueryExecutionResponseStream, abort?: AbortSignal): Promise<arrow.RecordBatch[]> {
    const batches: arrow.RecordBatch[] = [];
    for await (const item of stream.read(abort)) {
        if (item.type === 'batch') batches.push(item.batch);
    }
    return batches;
}

/// The kind of a query, a numeric enum of the module
export { QueryType };

/// A query, the view of the slice `query` of the runtime (docs/design/dashql_runtime.md). The points in time are
/// milliseconds since epoch, the result table is a handle of the handle table of the runtime (`useTable`).
export type QueryExecutionState = core.QueryView & {
    /// The progress of the latest progress update with its structured progress, the store of the runtime projects it
    /// once per change of the view (`runtime/query/query_projection.ts`), null without an update
    progress?: QueryExecutionProgress | null;
};

/// The details of the error of a failed or cancelled query, null without any
export function queryErrorDetails(error: core.QueryErrorView | null | undefined): Record<string, string> | null {
    if (error?.details == null) return null;
    try {
        const details = JSON.parse(error.details) as Record<string, string>;
        return Object.keys(details).length > 0 ? details : null;
    } catch {
        return null;
    }
}

/// The metrics of the response stream of a query that received nothing yet
export function createQueryResponseStreamMetrics(): QueryExecutionMetrics {
    return {
        totalDataBytesReceived: 0,
        totalBatchesReceived: 0,
        totalRowsReceived: 0,

        totalQueryRequestsStarted: 0,
        totalQueryRequestsSucceeded: 0,
        totalQueryRequestsFailed: 0,
        totalQueryRequestDurationMs: 0,

        durationUntilFirstBatchMs: null,
    };
}
