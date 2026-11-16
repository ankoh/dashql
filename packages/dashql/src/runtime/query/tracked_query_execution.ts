import type * as arrow from 'apache-arrow';
import type * as core from '../../core/index.js';

import type { QueryExecutionMetrics, QueryMetadata } from '../../platform/query/query_execution_state.js';
import { LoggableException, stringifyError } from '../../platform/platform/logger/logger.js';
import { createTrace, type TraceContext } from '../../platform/platform/logger/trace_context.js';
import type { HandleTable } from '../store/handles.js';

/// Where the host tracks the queries that it runs itself, e.g. the queries of the computations or of the shell: the
/// history of a connection or a history without a connection of a runtime
export interface QueryTracker {
    /// The runtime that holds the history
    runtime: {
        readonly handles: HandleTable;
        dispatch(target: core.Target, action: core.RuntimeAction): core.DispatchOutcome;
    };
    /// The history: a connection or a history without one, e.g. `{ history: 'shell' }`
    target: core.Target;
}

export interface TrackedQueryExecutionContext {
    readonly queryId: number;
    readonly trace: TraceContext;
    readonly cancellation: AbortController;
    readonly isDone: () => boolean;
    readonly sending: () => void;
    readonly running: () => void;
    /// The result arrived, the history keeps the table
    readonly receivedAllBatches: (table: arrow.Table, metrics?: QueryExecutionMetrics | null) => void;
    readonly processingResults: () => void;
    readonly processedResults: () => void;
    readonly succeed: () => void;
    readonly fail: (error: unknown, metrics?: QueryExecutionMetrics | null) => void;
    readonly cancel: (error: unknown, metrics?: QueryExecutionMetrics | null) => void;
}

export interface TrackedQueryExecutionArgs<T> {
    query: string;
    metadata: QueryMetadata;
    tracker: QueryTracker;
    execute: (context: TrackedQueryExecutionContext) => Promise<T>;
    trace?: TraceContext;
    cancellation?: AbortController;
    autoStart?: boolean;
    errorTarget?: string;
}

function asLoggableException(error: unknown, target: string): LoggableException {
    return error instanceof LoggableException
        ? error
        : new LoggableException(stringifyError(error), {}, target);
}

/// Run a query that the host runs itself and track it in a history of the runtime: the history hands out its id and
/// keeps its record under a handle, an abort of the handle (a reset of the connection) cancels it
export async function executeTrackedQuery<T>(args: TrackedQueryExecutionArgs<T>): Promise<T> {
    const { runtime, target } = args.tracker;
    const trace = args.trace ?? createTrace();
    const cancellation = args.cancellation ?? new AbortController();
    const record = { abort: (reason?: unknown) => cancellation.abort(reason) };
    const handle = runtime.handles.register(record);
    // The runtime owns the handle of the record from here on, a query without a history runs untracked
    const tracked = runtime.dispatch(target, {
        kind: 'trackQuery',
        value: { traceId: trace.traceId, text: args.query, metadata: args.metadata as core.QueryMetadataView, handle },
    });
    const queryId = typeof tracked.id === 'number' ? tracked.id : 0;
    let done = !tracked.ok;
    const dispatch = (action: core.RuntimeAction) => {
        if (tracked.ok) runtime.dispatch(target, action);
    };
    const errorTarget = args.errorTarget ?? 'query_execution';
    const ended = (kind: 'queryFailed' | 'queryCancelled', error: unknown, metrics: QueryExecutionMetrics | null = null) => {
        if (done) return;
        done = true;
        const exception = asLoggableException(error, errorTarget);
        const details = Object.keys(exception.keyValues ?? {}).length === 0 ? undefined : JSON.stringify(exception.keyValues);
        dispatch({ kind, value: { queryId, message: exception.message, details, metrics: metrics ?? undefined } });
    };
    const context: TrackedQueryExecutionContext = {
        queryId,
        trace,
        cancellation,
        isDone: () => done,
        sending: () => dispatch({ kind: 'querySending', value: { queryId } }),
        running: () => dispatch({ kind: 'queryRunning', value: { queryId } }),
        receivedAllBatches: (table, metrics = null) => {
            if (!tracked.ok) return;
            dispatch({
                kind: 'queryReceivedAllBatches',
                value: { queryId, table: runtime.handles.register(table), rows: table.numRows, metrics: metrics ?? undefined },
            });
        },
        processingResults: () => dispatch({ kind: 'queryProcessingResults', value: { queryId } }),
        processedResults: () => dispatch({ kind: 'queryProcessedResults', value: { queryId } }),
        succeed: () => {
            if (done) return;
            done = true;
            dispatch({ kind: 'querySucceeded', value: { queryId } });
        },
        fail: (error, metrics) => ended('queryFailed', error, metrics),
        cancel: (error, metrics) => ended('queryCancelled', error, metrics),
    };
    if (args.autoStart !== false) {
        context.sending();
        context.running();
    }

    try {
        cancellation.signal.throwIfAborted();
        const result = await args.execute(context);
        context.succeed();
        return result;
    } catch (error: any) {
        if (!done) {
            if (cancellation.signal.aborted || error?.name === 'AbortError' || error?.message === 'AbortError') {
                context.cancel(error);
            } else {
                context.fail(error);
            }
        }
        throw error;
    }
}
