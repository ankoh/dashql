import type * as core from '../../core/index.js';
import type * as arrow from 'apache-arrow';

/// A query that a caller in TypeScript runs on a connection. A failure rejects the result with its error.
export interface QueryExecutionArgs {
    query: string;
    metadata: core.QueryMetadataView;
    /// Optional caller-owned cancellation signal. The executor links this to its
    /// own query cancellation controller without taking ownership of it.
    abortSignal?: AbortSignal;
    analyzeResults?: boolean;
    /// Receives trace-scoped query execution log messages as they are emitted. Intended for
    /// transient progress surfaces such as the workbook shell.
    onLog?: (message: string) => void;
    /// Reports the milliseconds until the result arrived, before the complete execution promise resolves.
    onTiming?: (elapsedMs: number) => void;
}

/// Run a query on a connection, returns the id of the query and its result table, null for a query without one
export type QueryExecutor = (connectionId: string, args: QueryExecutionArgs) => [number, Promise<arrow.Table | null>];
/// Cancel a query, resolves once it ended
export type CancelQuery = (queryId: number) => Promise<void>;
/// Show the profile of a running query, returns the function that stops showing it
export type WatchQueryProfile = (queryId: number) => () => void;
