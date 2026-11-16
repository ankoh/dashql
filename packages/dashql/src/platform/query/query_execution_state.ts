import * as arrow from 'apache-arrow';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import type * as core from '../../core/index.js';
import { QueryExecutionStatus, QueryType } from '../../core/index.js';

import { AsyncConsumer } from '../utils/async_consumer.js';
import type { EngineProgressPayload, QueryProfileProgress } from './query_progress.js';

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
    /// The raw progress payload of the engine that a channel of the host reports, the query executor of the runtime
    /// feeds it into the progress model of the query
    engineProgress?: EngineProgressPayload | null;
    /// The structured progress (stages, pipelines, the plan) of the progress model of the query
    profileProgress?: QueryProfileProgress | null;
}

export interface QueryExecutionResponseStream {
    /// Ask the backend to stop the query, when the connector supports explicit cancellation.
    cancel?(): Promise<void>;
    /// Is the profile of the query shown? Connectors fetch the plan and its statistics only then (Trino).
    setProfileDetail?(wanted: boolean): void;
    /// Get the stream metrics
    getMetrics(): QueryExecutionMetrics;
    /// Await the schema message
    getSchema(): Promise<arrow.Schema | null>;
    /// Await the next record batch
    produce(batches: AsyncConsumer<QueryExecutionResponseStream, arrow.RecordBatch>, progress: AsyncConsumer<QueryExecutionResponseStream, QueryExecutionProgress>, abort?: AbortSignal): Promise<void>;
}

/// The kind of a query, a numeric enum of the module
export { QueryType };

export interface QueryMetadata {
    /// The query type
    queryType: QueryType;
    /// The title of the query (if any)
    title: string | null;
    /// The description
    description: string | null;
    /// The issuer
    issuer: string | null;
    /// Authored by the user or the app?
    userProvided: boolean;
    /// The workbook that issued the query, if any.
    /// Several workbooks may share a connection, the workbook scopes the query result cache and the
    /// cleanup of the workbook's queries.
    workbookId?: string;
    /// The owner of the result, e.g. a script of a workbook. A succeeded query releases the result table of the
    /// earlier queries of its owner, the owner shows only its latest result.
    resultOwner?: string;
    /// Where a statement of a plan of workbook scripts comes from
    planned?: PlannedStatement;
}

/// A statement of a plan of workbook scripts (docs/design/planner_dependencies.md)
export interface PlannedStatement {
    /// A run of the whole workbook or of a script
    run: 'workbook' | 'script';
    /// The script that a run of a script runs
    target: string | null;
    /// The node of the plan
    node: number;
    /// The script of the statement
    script: string;
    /// The statement within the statements of the script in the plan, from 1
    statement: number;
    statements: number;
    /// The type of the statement, e.g. SELECT
    statementType: string;
    /// Is the statement the result of its script?
    result: boolean;
    /// Is the statement the cached result of its script? The executor reads the file instead of running it.
    cached: boolean;
    /// The scripts whose queries the statement inlines as common table expressions
    inlined: string[];
    /// The materialized results of the scripts of other connections that the statement scans, cached if the host
    /// provides the file of an earlier run
    scans: Array<{ script: string; path: string; cached: boolean }>;
    /// The file that the result of the statement is written to, for statements of other connections
    materializes: string | null;
    /// The nodes the statement runs after and why
    after: Array<{ node: number; reason: string }>;
}

/// A query, the view of the slice `query` of the runtime (docs/wip/runtime_api.md). The points in time are
/// milliseconds since epoch, the result table is a handle of the handle table of the runtime (`useTable`).
export type QueryExecutionState = Omit<core.QueryView, 'queryMetadata'> & {
    queryMetadata: QueryMetadata;
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
