import { QueryExecutionState, QueryExecutionStatus, queryIsDone } from '@ankoh/dashql-runtime/query/query_execution_state';
import { IndicatorStatus } from '../ui/foundations/status_indicator.js';
import { summarizeQueryProgress } from '../views/query_progress/query_progress_format.js';

/// Which source produced the status shown in the bar.
export const enum EntryStatusKind {
    Query = 0,
    Idle = 1,
}

/// The presentation-ready status for one workbook entry, derived from its latest query execution.
/// Every entry has a status, including entries that
/// have not run yet, so the server card always has a stable status header.
export interface EntryStatus {
    kind: EntryStatusKind;
    /// The spinner/check/cross state.
    indicator: IndicatorStatus;
    /// The single-line query status message.
    message: string;
    /// The trace to reveal in the footer log when the bar is clicked.
    traceId: number | null;
    /// Everything known about a failed query, shown in the status bar's error-details overlay.
    /// Null for non-error statuses.
    errorDetail: Record<string, unknown> | null;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null));
}

function getQueryErrorDetail(query: QueryExecutionState, message: string): Record<string, unknown> {
    const error = query.error;
    return compactObject({
        status: query.status === QueryExecutionStatus.FAILED ? 'failed' : 'cancelled',
        message,
        target: error?.target,
        queryId: query.queryId,
        traceId: query.traceId,
        query: query.queryText,
        metadata: query.queryMetadata,
        details: error != null && Object.keys(error.keyValues).length > 0 ? error.keyValues : undefined,
    });
}

/// Human-readable label for a query execution status. Shared by the feed status bar and the Details
/// query status panel so both stay in sync.
export function getQueryStatusText(status: QueryExecutionStatus): string {
    switch (status) {
        case QueryExecutionStatus.REQUESTED:
            return 'Requested query';
        case QueryExecutionStatus.SENDING:
            return 'Sending query';
        case QueryExecutionStatus.QUEUED:
            return 'Queued query';
        case QueryExecutionStatus.RUNNING:
            return 'Executing query';
        case QueryExecutionStatus.RECEIVED_FIRST_BATCH:
            return 'Executing query, fetching results';
        case QueryExecutionStatus.RECEIVED_ALL_BATCHES:
            return 'Executing query, received all results';
        case QueryExecutionStatus.PROCESSING_RESULTS:
            return 'Processing results';
        case QueryExecutionStatus.PROCESSED_RESULTS:
            return 'Processed results';
        case QueryExecutionStatus.FAILED:
            return 'Statement execution failed';
        case QueryExecutionStatus.CANCELLED:
            return 'Statement execution was cancelled';
        case QueryExecutionStatus.SUCCEEDED:
            return 'Statement executed successfully';
    }
}

/// Derive the status bar contents for a workbook entry from its query execution.
export function deriveEntryStatus(query: QueryExecutionState | null): EntryStatus {
    if (query != null && !queryIsDone(query.status)) {
        const statusText = getQueryStatusText(query.status);
        // Engines with structured progress add the phase, the progress and the throughput
        const progress = summarizeQueryProgress(query.latestProgressUpdate);
        return {
            kind: EntryStatusKind.Query,
            indicator: IndicatorStatus.Running,
            message: progress == null ? statusText : `${statusText} · ${progress}`,
            traceId: query.traceId,
            errorDetail: null,
        };
    }
    if (query != null && (query.status === QueryExecutionStatus.FAILED || query.status === QueryExecutionStatus.CANCELLED)) {
        const message = query.error?.message ?? getQueryStatusText(query.status);
        return {
            kind: EntryStatusKind.Query,
            indicator: IndicatorStatus.Failed,
            message,
            traceId: query.traceId,
            errorDetail: getQueryErrorDetail(query, message),
        };
    }
    if (query != null) {
        return {
            kind: EntryStatusKind.Query,
            indicator: IndicatorStatus.Succeeded,
            message: query.status === QueryExecutionStatus.SUCCEEDED && query.servedFromCache
                ? 'Result loaded from cache'
                : getQueryStatusText(query.status),
            traceId: query.traceId,
            errorDetail: null,
        };
    }
    return {
        kind: EntryStatusKind.Idle,
        indicator: IndicatorStatus.None,
        message: 'Not run yet',
        traceId: null,
        errorDetail: null,
    };
}
