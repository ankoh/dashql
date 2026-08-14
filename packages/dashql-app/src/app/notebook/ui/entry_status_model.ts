import { AgentRunPhase, AgentRunState, agentRunIsActive } from '../agent/agent_run_state.js';
import { QueryExecutionState, QueryExecutionStatus, queryIsDone } from '../connections/query_execution_state.js';
import { IndicatorStatus } from '../../../shared/ui/foundations/status_indicator.js';

/// Which source produced the status shown in the bar. The footer log tab keys off this to reveal
/// the matching trace when the bar is clicked.
export const enum EntryStatusKind {
    Agent = 0,
    Query = 1,
    Idle = 2,
}

/// The presentation-ready status for one notebook entry, derived from whichever of its agent run /
/// query execution is currently worth showing. Every entry has a status, including entries that
/// have not run yet, so the server card always has a stable status header.
export interface EntryStatus {
    kind: EntryStatusKind;
    /// The spinner/check/cross state.
    indicator: IndicatorStatus;
    /// The single-line message (latest agent log line, or the query status text).
    message: string;
    /// The trace to reveal in the footer log when the bar is clicked.
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
            return 'Statement execution failed';
        case QueryExecutionStatus.CANCELLED:
            return 'Statement execution was cancelled';
        case QueryExecutionStatus.SUCCEEDED:
            return 'Statement executed successfully';
    }
}

/// Derive the status bar contents for a notebook entry from its agent run and query execution.
///
/// A single, persistent bar with a fixed priority (agent state wins while a run is active,
/// otherwise the query):
///   1. An active agent run → spinner + latest agent log line.
///   2. A query that hasn't finished → spinner + query status text.
///   3. A failed/cancelled query → cross + the failure text.
///   4. A completed query/agent run → terminal indicator + completion text.
///   5. No execution → neutral indicator + "Not run yet".
/// A staged agent rewrite doesn't override the bar: its Accept/Reject controls live on the body
/// overlay, leaving the bar free to show the execution status of the rewritten statement.
export function deriveEntryStatus(
    agentRun: AgentRunState | null,
    query: QueryExecutionState | null,
): EntryStatus {
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
        const queryUpdatedAt = query.metrics?.lastUpdatedAt?.getTime() ?? 0;
        const agentUpdatedAt = agentRun != null && agentRun.log.length > 0
            ? agentRun.log[agentRun.log.length - 1].timestamp
            : 0;
        if (agentRun == null || agentUpdatedAt <= queryUpdatedAt) {
            return {
                kind: EntryStatusKind.Query,
                indicator: IndicatorStatus.Failed,
                message: query.error?.message ?? getQueryStatusText(query.status),
                traceId: query.traceId,
                errorDetail,
            };
        }
    }
    if (query != null) {
        const queryUpdatedAt = query.metrics?.lastUpdatedAt?.getTime() ?? 0;
        const agentUpdatedAt = agentRun != null && agentRun.log.length > 0
            ? agentRun.log[agentRun.log.length - 1].timestamp
            : 0;
        if (agentRun == null || agentUpdatedAt <= queryUpdatedAt) {
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
    }
    if (agentRun != null) {
        const latest = agentRun.log.length > 0 ? agentRun.log[agentRun.log.length - 1].message : null;
        if (agentRun.phase === AgentRunPhase.IDLE) {
            return {
                kind: EntryStatusKind.Idle,
                indicator: IndicatorStatus.None,
                message: 'Not run yet',
                traceId: null,
                errorDetail: null,
            };
        }
        const failed = agentRun.phase === AgentRunPhase.FAILED || agentRun.phase === AgentRunPhase.CANCELLED;
        return {
            kind: EntryStatusKind.Agent,
            indicator: failed ? IndicatorStatus.Failed : IndicatorStatus.Succeeded,
            message: agentRun.error ?? latest ?? (failed ? 'Agent run failed' : 'Agent run completed'),
            traceId: agentRun.traceId,
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
