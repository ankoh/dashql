import { AgentRunState, agentRunIsActive } from '../../agent/agent_run_state.js';
import { QueryExecutionState, QueryExecutionStatus, queryIsDone } from '../../connection/query_execution_state.js';
import { IndicatorStatus } from '../foundations/status_indicator.js';

/// Which source produced the status shown in the bar. The footer log tab keys off this to reveal
/// the matching trace when the bar is clicked.
export const enum EntryStatusKind {
    Agent = 0,
    Query = 1,
    /// A staged agent rewrite awaiting Accept/Reject. Has no spinner and no trace — it's a decision
    /// prompt, not progress.
    PendingDiff = 2,
}

/// The presentation-ready status for one notebook entry, derived from whichever of its agent run /
/// query execution is currently worth showing. `null` (see deriveEntryStatus) means "nothing to
/// show" — the bar auto-hides on idle and on success.
export interface EntryStatus {
    kind: EntryStatusKind;
    /// The spinner/check/cross state.
    indicator: IndicatorStatus;
    /// The single-line message (latest agent log line, or the query status text).
    message: string;
    /// The trace to reveal in the footer log when the bar is clicked (null for PendingDiff).
    traceId: number | null;
    /// Structured error detail for a failed/cancelled query, surfaced on hover over the bar's
    /// message (the one-line bar can't carry the key-values inline). Null when there's no error.
    errorDetail: Record<string, string | null | undefined> | null;
}

/// Human-readable label for a query execution status. Shared by the feed status bar and the Details
/// query status panel so both stay in sync.
export function getQueryStatusText(status: QueryExecutionStatus): string {
    switch (status) {
        case QueryExecutionStatus.REQUESTED:
            return 'Requested query';
        case QueryExecutionStatus.PREPARING:
            return 'Preparing query';
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
            return 'Query execution failed';
        case QueryExecutionStatus.CANCELLED:
            return 'Query was cancelled';
        case QueryExecutionStatus.SUCCEEDED:
            return 'Query executed successfully';
    }
}

/// Derive the status bar contents for a notebook entry from its agent run and query execution.
///
/// A single bar with a fixed priority (agent state wins while a run is active, otherwise the query):
///   1. A staged rewrite (pendingDiff) → the Accept/Reject prompt.
///   2. An active agent run → spinner + latest agent log line.
///   3. A query that hasn't finished → spinner + query status text.
///   4. A failed/cancelled query → cross + the failure text.
/// Everything else — idle, and (per the auto-hide choice) a succeeded query — returns null so the
/// bar disappears once work lands (the result/data tab already conveys success).
export function deriveEntryStatus(
    agentRun: AgentRunState | null,
    query: QueryExecutionState | null,
    hasPendingDiff: boolean,
): EntryStatus | null {
    if (hasPendingDiff) {
        return {
            kind: EntryStatusKind.PendingDiff,
            indicator: IndicatorStatus.None,
            message: 'Suggested rewrite',
            traceId: null,
            errorDetail: null,
        };
    }
    if (agentRun != null && agentRunIsActive(agentRun.phase)) {
        const latest = agentRun.log.length > 0 ? agentRun.log[agentRun.log.length - 1].message : null;
        return {
            kind: EntryStatusKind.Agent,
            indicator: IndicatorStatus.Running,
            message: latest ?? 'Working…',
            traceId: agentRun.traceId,
            errorDetail: null,
        };
    }
    if (query != null && !queryIsDone(query.status)) {
        return {
            kind: EntryStatusKind.Query,
            indicator: IndicatorStatus.Running,
            message: getQueryStatusText(query.status),
            traceId: query.traceId,
            errorDetail: null,
        };
    }
    if (query != null && (query.status === QueryExecutionStatus.FAILED || query.status === QueryExecutionStatus.CANCELLED)) {
        // Carry the error's key-values so the bar can reveal them on hover (a failed query's detail
        // no longer lives in a dedicated status panel — the message is the one-liner, the rest is
        // in the overlay). Empty object → null so the bar skips the hover affordance.
        const keyValues = query.error?.keyValues ?? {};
        const errorDetail = Object.keys(keyValues).length > 0 ? keyValues : null;
        return {
            kind: EntryStatusKind.Query,
            indicator: IndicatorStatus.Failed,
            message: query.error?.message ?? getQueryStatusText(query.status),
            traceId: query.traceId,
            errorDetail,
        };
    }
    return null;
}
