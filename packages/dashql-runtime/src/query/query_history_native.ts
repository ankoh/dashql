import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import { LoggableException } from '../platform/logger/logger.js';
import {
    EXECUTE_QUERY,
    QUERY_CACHE_DELETED,
    QUERY_CACHE_RECORDED,
    QUERY_CANCELLED,
    QUERY_FAILED,
    QUERY_PROCESSED_RESULTS,
    QUERY_PROCESSING_RESULTS,
    QUERY_PROGRESS_UPDATED,
    QUERY_RECEIVED_ALL_BATCHES,
    QUERY_RECEIVED_BATCH,
    QUERY_RUNNING,
    QUERY_SENDING,
    QUERY_SUCCEEDED,
    type QueryExecutionAction,
    type QueryExecutionProgress,
    type QueryExecutionState,
    type QueryMetadata,
} from './query_execution_state.js';

/// The query actions of a Rust history: the queries of a connection (`DashQLConnection`) or a history of its own
/// (`DashQLQueryHistory`, its effects are the ones of the queries of a connection)
export type NativeQueryActions = Pick<core.DashQLConnection,
    | 'executeQuery' | 'querySending' | 'queryRunning' | 'queryProgressUpdated' | 'queryReceivedBatch'
    | 'queryReceivedAllBatches' | 'queryProcessingResults' | 'queryProcessedResults' | 'querySucceeded' | 'queryFailed'
    | 'queryCancelled' | 'queryCacheRecorded' | 'queryCacheDeleted'>;

/// The JavaScript objects of the queries of a Rust history, the history knows them by the ids of the queries and tables
export interface NativeQueryObjects {
    /// Keep the objects of a new query
    registerQuery(state: QueryExecutionState): void;
    /// Keep the latest progress of a query
    setQueryProgress(queryId: number, progress: QueryExecutionProgress): void;
    /// Keep the error of a failed or cancelled query
    setQueryError(queryId: number, error: LoggableException): void;
    /// Keep a result table, returns its id
    registerTable(table: arrow.Table): number;
    releaseTable(id: number): void;
}

/// What an adapter keeps of a query: the JavaScript objects that don't cross into Rust
export interface QueryRecord {
    traceId: number;
    queryText: string;
    queryMetadata: QueryMetadata;
    cancellation: AbortController;
    error: LoggableException | null;
    progress: QueryExecutionProgress | null;
}

/// The record of a new query
export function queryRecord(state: QueryExecutionState): QueryRecord {
    return {
        traceId: state.traceId,
        queryText: state.queryText,
        queryMetadata: state.queryMetadata,
        cancellation: state.cancellation,
        error: state.error,
        progress: state.latestProgressUpdate,
    };
}

/// Keep the latest progress of a query, an update without structured progress keeps the one of the previous update
export function updateQueryRecordProgress(record: QueryRecord, progress: QueryExecutionProgress): void {
    const profileProgress = progress.profileProgress ?? record.progress?.profileProgress ?? null;
    record.progress = { ...progress, profileProgress };
}

/// Apply a query action to a Rust history, the objects of the query stay with the host. Returns the outcome, the host
/// applies its effects.
export function applyQueryAction(history: NativeQueryActions, objects: NativeQueryObjects, action: QueryExecutionAction, now: number): core.DashQLConnectionOutcome {
    switch (action.type) {
        case EXECUTE_QUERY: {
            const [queryId, query] = action.value;
            objects.registerQuery(query);
            return history.executeQuery(queryId, query.traceId, query.queryText, query.queryMetadata, query.metrics.queryRequestedAt?.getTime() ?? now);
        }
        case QUERY_SENDING:
            return history.querySending(action.value[0], now);
        case QUERY_RUNNING:
            return history.queryRunning(action.value[0], now);
        case QUERY_PROGRESS_UPDATED: {
            const [queryId, progress] = action.value;
            const outcome = history.queryProgressUpdated(queryId, progress, now);
            if (outcome.changed) objects.setQueryProgress(queryId, progress);
            return outcome;
        }
        case QUERY_RECEIVED_BATCH:
            return history.queryReceivedBatch(action.value[0], action.value[1], now);
        case QUERY_RECEIVED_ALL_BATCHES: {
            const [queryId, table, metrics] = action.value;
            const tableId = objects.registerTable(table);
            const outcome = history.queryReceivedAllBatches(queryId, tableId, table.numRows, metrics, now);
            // The result of a query that isn't active is dropped right away
            if (!outcome.changed) objects.releaseTable(tableId);
            return outcome;
        }
        case QUERY_PROCESSING_RESULTS:
            return history.queryProcessingResults(action.value[0], now);
        case QUERY_PROCESSED_RESULTS:
            return history.queryProcessedResults(action.value[0], now);
        case QUERY_SUCCEEDED:
            return history.querySucceeded(action.value[0], now);
        case QUERY_FAILED:
        case QUERY_CANCELLED: {
            const [queryId, error, metrics] = action.value;
            const details = error.keyValues == null || Object.keys(error.keyValues).length === 0 ? null : JSON.stringify(error.keyValues);
            const outcome = action.type === QUERY_FAILED
                ? history.queryFailed(queryId, error.message, details, metrics, now)
                : history.queryCancelled(queryId, error.message, details, metrics, now);
            if (outcome.changed) objects.setQueryError(queryId, error);
            return outcome;
        }
        case QUERY_CACHE_RECORDED: {
            const [queryId, cacheKey, servedFromCache, cachedAt] = action.value;
            return history.queryCacheRecorded(queryId, cacheKey, servedFromCache, cachedAt);
        }
        case QUERY_CACHE_DELETED:
            return history.queryCacheDeleted(action.value[0]);
    }
}

const toDate = (ms: number | null): Date | null => ms == null ? null : new Date(ms);

/// The state of a query of the app from the snapshot of a Rust history and the record of the host
export function projectQuery(snapshot: core.DashQLQuerySnapshot, record: QueryRecord, resultTable: arrow.Table | null, errorTarget: string): QueryExecutionState {
    const m = snapshot.metrics;
    return {
        queryId: snapshot.queryId,
        traceId: record.traceId,
        queryText: record.queryText,
        queryMetadata: record.queryMetadata,
        status: snapshot.status,
        metrics: {
            queryRequestedAt: toDate(m.queryRequestedAt),
            querySendingStartedAt: toDate(m.querySendingStartedAt),
            queryQueuedStartedAt: toDate(m.queryQueuedStartedAt),
            queryRunningStartedAt: toDate(m.queryRunningStartedAt),
            receivedFirstBatchAt: toDate(m.receivedFirstBatchAt),
            receivedLastBatchAt: toDate(m.receivedLastBatchAt),
            receivedAllBatchesAt: toDate(m.receivedAllBatchesAt),
            processingResultsStartedAt: toDate(m.processingResultsStartedAt),
            processedResultsAt: toDate(m.processedResultsAt),
            querySucceededAt: toDate(m.querySucceededAt),
            queryFailedAt: toDate(m.queryFailedAt),
            queryCancelledAt: toDate(m.queryCancelledAt),
            lastUpdatedAt: toDate(m.lastUpdatedAt),
            progressUpdatesReceived: m.progressUpdatesReceived,
            queryDurationMs: m.queryDurationMs,
            textLength: m.textLength,
            streamMetrics: m.streamMetrics,
        },
        cancellation: record.cancellation,
        error: snapshot.error == null ? null : (record.error ?? new LoggableException(snapshot.error.message, {}, errorTarget)),
        latestProgressUpdate: record.progress,
        resultTable,
        cacheKey: snapshot.cacheKey,
        servedFromCache: snapshot.servedFromCache,
        cacheDeleted: snapshot.cacheDeleted,
        cachedAt: toDate(snapshot.cachedAt),
    };
}
