import type * as buffers from './buffers.js';
import { DashQL, Ptr, type FlatBufferPtr } from './api.js';
import type * as glue from './wasm/dashql_core.js';
import type {
    ConnectionOutcome,
    QueriesView,
    QueryMetadataView,
    QueryProfileKeys,
    QueryProfileProgressView,
    QueryStreamMetrics,
    QueryView,
} from './wasm/dashql_core.js';

/// A history of queries of its own in the Rust runtime (`packages/dashql-core-runtime`, see docs/wip/core_runtime.md),
/// e.g. the one of the shell. It takes the query actions of a connection and is read like the queries of a connection.
/// The result tables stay with the host, the history knows them by their ids.

const QUERY_HISTORY_TYPE = Symbol('QUERY_HISTORY_TYPE');

/// The views of the queries, declared by the module (`packages/dashql-core-wasm/src/query_history/view.rs`)
export type {
    ProfileLayoutView,
    QueriesView,
    QueryErrorView,
    QueryHistoryMetrics,
    QueryLatestProgressView,
    QueryMetadataView,
    QueryMetricsView,
    QueryOutcomeMetrics,
    QueryProfileKeys,
    QueryProfileProgressView,
    QueryProgressView,
    QueryResultTableView,
    QueryStreamMetrics,
    QueryView,
} from './wasm/dashql_core.js';
/// A progress update of the query executor with the structured progress of the query, the host hands it to a history
export type { QueryProgressUpdate } from './wasm/dashql_core.js';
/// The status and the kind of a query, numeric enums of the module
export { QueryExecutionStatus, QueryType } from './wasm/dashql_core.js';

/// A history of the module: the history of a connection or a history of its own, they take the same query actions
type NativeQueries = glue.Connection | glue.QueryHistory;

/// The query actions and the views of a history of the module, shared by `DashQLConnection` and `DashQLQueryHistory`.
/// An action returns the outcome with the effects for the host, the history knows the records of the queries and their
/// result tables by their handles of the host.
export abstract class DashQLQueryActions {
    protected abstract queriesNative(): NativeQueries;
    protected abstract queriesApi(): DashQL;

    /// Start tracking a requested query, only the plain fields of the metadata cross. The host keeps the record of the
    /// query under the handle, a query id that the history knows throws and leaves the handle with the host.
    public executeQuery(queryId: number, handle: number, traceId: number, text: string, metadata: QueryMetadataView, requestedAt = Date.now()): ConnectionOutcome {
        return this.queriesNative().executeQuery(queryId, handle, traceId, text, metadata, requestedAt);
    }
    /// The handle of the record of a query, null for a query that the history doesn't know
    public queryHandle(queryId: number): number | null {
        return this.queriesNative().queryHandle(queryId) ?? null;
    }
    public querySending(queryId: number, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().querySending(queryId, now);
    }
    public queryRunning(queryId: number, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryRunning(queryId, now);
    }
    /// The backend reported progress: an update of the query executor with the structured progress of the query
    public queryProgressUpdated(queryId: number, update: glue.QueryProgressUpdate, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryProgressUpdated(queryId, update, now);
    }
    public queryReceivedBatch(queryId: number, metrics: QueryStreamMetrics, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryReceivedBatch(queryId, metrics, now);
    }
    /// All batches arrived, the host keeps the table under its handle. The history releases a table that it doesn't
    /// take.
    public queryReceivedAllBatches(queryId: number, tableId: number, rows: number, metrics: QueryStreamMetrics, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryReceivedAllBatches(queryId, tableId, rows, metrics, now);
    }
    public queryProcessingResults(queryId: number, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryProcessingResults(queryId, now);
    }
    public queryProcessedResults(queryId: number, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryProcessedResults(queryId, now);
    }
    public querySucceeded(queryId: number, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().querySucceeded(queryId, now);
    }
    public queryFailed(queryId: number, message: string, details: string | null, metrics: QueryStreamMetrics | null, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryFailed(queryId, message, details, metrics, now);
    }
    public queryCancelled(queryId: number, message: string, details: string | null, metrics: QueryStreamMetrics | null, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryCancelled(queryId, message, details, metrics, now);
    }
    public queryCacheRecorded(queryId: number, cacheKey: string, servedFromCache: boolean, cachedAt: number | null): ConnectionOutcome {
        return this.queriesNative().queryCacheRecorded(queryId, cacheKey, servedFromCache, cachedAt);
    }
    public queryCacheDeleted(queryId: number): ConnectionOutcome {
        return this.queriesNative().queryCacheDeleted(queryId);
    }

    /// The active and the finished queries with their revisions and the metrics of the finished ones
    public queries(): QueriesView {
        return this.queriesNative().queries();
    }
    /// A query with its latest progress. The payloads of the structured progress whose keys the host holds don't
    /// cross again, they are null then.
    public query(queryId: number, known: QueryProfileKeys | null = null): QueryView | null {
        return this.queriesNative().query(queryId, known) ?? null;
    }
    /// The recording of the progress of a query as JSON, null without structured progress. Replaying it reproduces
    /// the progress, see `ProfileRecording` of the runtime crate.
    public queryProgressRecording(queryId: number): string | null {
        return this.queriesNative().queryProgressRecording(queryId) ?? null;
    }
    /// Follow the progress of a query with the layout of a follower, null without structured progress
    public followQueryProgress(queryId: number, follower: DashQLQueryProgressFollower, known: QueryProfileKeys | null = null): QueryProfileProgressView | null {
        return this.queriesNative().followQueryProgress(queryId, follower.ptr.assertNotNull(), known) ?? null;
    }
    /// The packed query profile of a progress view as the FlatBuffer of the core
    public readQueryProfile(bytes: Uint8Array): FlatBufferPtr<buffers.profile.QueryProfile, buffers.profile.QueryProfileT> {
        return this.queriesApi().readQueryProfile(bytes);
    }
}

const QUERY_PROGRESS_FOLLOWER_TYPE = Symbol('QUERY_PROGRESS_FOLLOWER_TYPE');

/// A follower of the progress of a query: it replays the recording of the progress of a query with a layout of its
/// own, e.g. the other orientation of the plan, and applies the later payloads as they come
export class DashQLQueryProgressFollower {
    public readonly ptr: Ptr<typeof QUERY_PROGRESS_FOLLOWER_TYPE, glue.QueryProgressFollower>;

    public constructor(ptr: Ptr<typeof QUERY_PROGRESS_FOLLOWER_TYPE, glue.QueryProgressFollower>) {
        this.ptr = ptr;
    }

    /// A follower with the layout of its plans
    public static create(api: DashQL, layout: buffers.profile.ProfileLayoutConfigT): DashQLQueryProgressFollower {
        return new DashQLQueryProgressFollower(new Ptr(QUERY_PROGRESS_FOLLOWER_TYPE, api, new api.bindings.QueryProgressFollower(layout)));
    }

    public destroy(): void {
        this.ptr.destroy();
    }
}

export class DashQLQueryHistory extends DashQLQueryActions {
    public readonly ptr: Ptr<typeof QUERY_HISTORY_TYPE, glue.QueryHistory>;

    public constructor(ptr: Ptr<typeof QUERY_HISTORY_TYPE, glue.QueryHistory>) {
        super();
        this.ptr = ptr;
    }

    /// An empty history that keeps at most `limit` queries: a query that starts beyond the limit drops the oldest
    /// finished queries, then the oldest active ones. Without a limit it keeps every query.
    public static create(api: DashQL, limit: number | null = null): DashQLQueryHistory {
        return new DashQLQueryHistory(new Ptr(QUERY_HISTORY_TYPE, api, new api.bindings.QueryHistory(limit ?? undefined)));
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    protected queriesNative(): glue.QueryHistory {
        return this.ptr.assertNotNull();
    }

    protected queriesApi(): DashQL {
        return this.ptr.api;
    }

    /// The revision of the history, it changes with every change of a query
    public revision(): number {
        return this.queriesNative().revision();
    }

    /// Drop every query, e.g. before the history is freed. The effects abort the active queries and release the
    /// handles of all queries.
    public clear(): ConnectionOutcome {
        return this.queriesNative().clear();
    }
}
