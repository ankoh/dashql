import {
    EXECUTE_QUERY,
    QUERY_CANCELLED,
    QUERY_FAILED,
    QUERY_RUNNING,
    QUERY_SENDING,
    QUERY_SUCCEEDED,
    type QueryExecutionAction,
} from './connection_state.js';
import {
    createQueryExecutionState,
    type QueryExecutionMetrics,
    type QueryExecutionResponseStream,
    type QueryExecutionState,
    type QueryExecutionTracker,
    type QueryMetadata,
} from './query_execution_state.js';
import { LoggableException, stringifyError } from '../../../shared/platform/logger/logger.js';
import { createTrace, type TraceContext } from '../../../shared/platform/logger/trace_context.js';

let NEXT_QUERY_ID = 1;

export function allocateQueryId(): number {
    return NEXT_QUERY_ID++;
}

export interface TrackedQueryExecutionContext {
    readonly queryId: number;
    readonly trace: TraceContext;
    readonly cancellation: AbortController;
    readonly initialState: QueryExecutionState;
    readonly isDone: () => boolean;
    readonly dispatch: (action: QueryExecutionAction) => void;
    readonly sending: () => void;
    readonly running: (stream?: QueryExecutionResponseStream | null) => void;
    readonly succeed: () => void;
    readonly fail: (error: unknown, metrics?: QueryExecutionMetrics | null) => void;
    readonly cancel: (error: unknown, metrics?: QueryExecutionMetrics | null) => void;
}

export interface TrackedQueryExecutionArgs<T> {
    query: string;
    metadata: QueryMetadata;
    tracker: QueryExecutionTracker;
    execute: (context: TrackedQueryExecutionContext) => Promise<T>;
    queryId?: number;
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

export async function executeTrackedQuery<T>(args: TrackedQueryExecutionArgs<T>): Promise<T> {
    const queryId = args.queryId ?? allocateQueryId();
    const trace = args.trace ?? createTrace();
    const cancellation = args.cancellation ?? new AbortController();
    const initialState = createQueryExecutionState(
        queryId,
        trace.traceId,
        args.query,
        args.metadata,
        cancellation,
    );
    let done = false;
    const dispatch = (action: QueryExecutionAction) => args.tracker.dispatch(action);
    const finish = (action: QueryExecutionAction) => {
        if (done) return;
        done = true;
        dispatch(action);
    };
    const errorTarget = args.errorTarget ?? 'query_execution';
    const context: TrackedQueryExecutionContext = {
        queryId,
        trace,
        cancellation,
        initialState,
        isDone: () => done,
        dispatch,
        sending: () => dispatch({ type: QUERY_SENDING, value: [queryId] }),
        running: stream => dispatch({ type: QUERY_RUNNING, value: [queryId, stream ?? null] }),
        succeed: () => finish({ type: QUERY_SUCCEEDED, value: [queryId] }),
        fail: (error, metrics = null) => finish({ type: QUERY_FAILED, value: [queryId, asLoggableException(error, errorTarget), metrics] }),
        cancel: (error, metrics = null) => finish({ type: QUERY_CANCELLED, value: [queryId, asLoggableException(error, errorTarget), metrics] }),
    };

    dispatch({ type: EXECUTE_QUERY, value: [queryId, initialState] });
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
