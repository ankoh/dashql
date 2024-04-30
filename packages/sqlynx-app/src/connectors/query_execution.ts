import * as arrow from 'apache-arrow';

import { VariantKind } from '../utils/index.js';
import { SALESFORCE_DATA_CLOUD } from './connector_info.js';
import { SalesforceAPIClientInterface, SalesforceDataCloudAccessToken } from './salesforce_api_client.js';
import { SalesforceAuthParams } from './connector_configs.js';

export type QueryExecutionTaskVariant = VariantKind<typeof SALESFORCE_DATA_CLOUD, ExecuteDataCloudQueryTask>;

export interface ExecuteDataCloudQueryTask {
    /// The salesforce api client
    api: SalesforceAPIClientInterface;
    /// The auth params
    authParams: SalesforceAuthParams;
    /// The access token
    dataCloudAccessToken: SalesforceDataCloudAccessToken;
    /// The script text
    scriptText: string;
}

export enum QueryExecutionTaskStatus {
    ACCEPTED = 0,
    STARTED = 1,
    RECEIVED_SCHEMA = 2,
    RECEIVED_FIRST_RESULT = 3,
    SUCCEEDED = 4,
    FAILED = 5,
    CANCELLED = 6,
}

export interface QueryExecutionProgress { }

export interface QueryExecutionResponseStream {
    /// Await the schema message
    getSchema(): Promise<arrow.Schema | null>;
    /// Await the next progress update
    nextProgressUpdate(): Promise<QueryExecutionProgress | null>;
    /// Await the next record batch
    nextRecordBatch(): Promise<arrow.RecordBatch | null>;
}

export interface QueryExecutionTaskState {
    /// The script text that is executed
    task: QueryExecutionTaskVariant;
    /// The status
    status: QueryExecutionTaskStatus;
    /// The cancellation signal
    cancellation: AbortController;
    /// The response stream
    resultStream: QueryExecutionResponseStream | null;
    /// The loading error (if any)
    error: Error | null;
    /// The time at which the query execution started (if any)
    startedAt: Date | null;
    /// The time at which the query execution finished (if any)
    finishedAt: Date | null;
    /// The time at which the query execution was last updated
    lastUpdatedAt: Date | null;
    /// The latest update for the query execution
    latestProgressUpdate: QueryExecutionProgress | null;
    /// The number of record batches that are already buffered
    resultSchema: arrow.Schema | null;
    /// The number of record batches that are already buffered
    resultBatches: Immutable.List<arrow.RecordBatch>;
}

export interface QueryExecutionResult {
    /// The time at which the query execution started (if any)
    startedAt: Date | null;
    /// The time at which the query execution finished (if any)
    finishedAt: Date | null;
    /// The latest update for the query execution
    latestProgressUpdate: QueryExecutionProgress;
    /// The result table
    resultTable: arrow.Table;
}
