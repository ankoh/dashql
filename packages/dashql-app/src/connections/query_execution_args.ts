import { HyperDatabaseChannel } from "./hyper/hyperdb_grpc_client.js";
import { QueryMetadata } from "../query/query_execution_state.js";
import { SalesforceDatabaseChannel } from "./salesforce/salesforce_api_client.js";
import { TrinoChannelInterface } from "./trino/trino_channel.js";
import type { buffers } from '@ankoh/dashql-core';
import type { ClientFunctionCallDescription } from "./clfn/clfn_spec.js";

/// The query executor args
export interface QueryExecutionArgs {
    query: string;
    /// The statement is a call of a client function: the runtime sends this, `query` only tells what the statement says
    /// and never reaches the backend.
    clientFunctionCall?: ClientFunctionCallDescription;
    /// Optional caller-owned cancellation signal. The executor links this to its
    /// own query cancellation controller without taking ownership of it.
    abortSignal?: AbortSignal;
    /// Maximum time to wait for the next native gRPC result batch.
    readTimeoutMs?: number;
    analyzeResults?: boolean;
    /// Drain statements without materializing a result when the planner discards their output.
    publishResults?: boolean;
    /// Receives trace-scoped query execution log messages as they are emitted. Intended for
    /// transient progress surfaces such as the session shell.
    onLog?: (message: string) => void;
    /// Reports labeled query lifecycle timings before the complete execution promise resolves.
    onTiming?: (label: string, elapsedMs: number) => void;
    /// Called once after the backend result is fully consumed, but before optional result analysis.
    /// The normal execution promise still resolves only after postprocessing completes.
    onResultsReady?: () => void;
    metadata: QueryMetadata;
    /// Record the query as failed with this error instead of executing it, e.g. a script whose plan failed. The result
    /// of the owner of the query then shows the error like the error of a failed statement.
    failure?: Error;
    /// When true, the executor consults the file-based query result cache: it serves a matching
    /// cached Parquet result instead of hitting the backend, and stores the result after a miss.
    /// Only user-provided queries should set this; catalog/health-check queries leave it unset so
    /// they never touch the cache. Cache failures are always non-fatal (fall back to execution).
    cacheable?: boolean;
    /// With `cacheable`, run the query on the backend instead of serving a cached result and store the result as the
    /// newest file of its key, e.g. a refresh or a run of the session.
    refreshCache?: boolean;
    /// With `cacheable`, serve the cached result or fail with a `QueryCacheMissError` instead of running the query,
    /// e.g. a query whose text only holds without the statements before it.
    cacheOnly?: boolean;
    /// Versioned semantic AST signature for the complete script. Required for cacheable session
    /// queries so preceding statements affect identity without making formatting or comments do so.
    cacheSignature?: string;
    /// Reject the execution promise with the original connector error after recording the failed
    /// query state. Most session callers use the historical null-on-failure behavior; hosts such
    /// as the shell need the error text to complete their asynchronous effect.
    throwOnError?: boolean;
    /// Optional channel to run the query on. When present, the executor uses this
    /// channel instead of reading one from the ConnectionState. Callers need this
    /// when they hold the channel locally but haven't waited for the React state
    /// update that publishes it into the connection map (e.g. right after a
    /// connection setup resolves).
    channelOverride?: QueryExecutionChannelOverride;
}

export type QueryExecutionChannelOverride =
    | { type: 'hyper'; channel: HyperDatabaseChannel }
    | { type: 'salesforce'; channel: SalesforceDatabaseChannel }
    | { type: 'trino'; channel: TrinoChannelInterface };
