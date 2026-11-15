import { DashQL, Ptr } from './api.js';
import type * as glue from './wasm/dashql_core.js';
import type {
    ConnectionOutcome,
    QueriesView,
    QueryMetadataView,
    QueryProgressView,
    QueryStreamMetrics,
    QueryView,
} from './wasm/dashql_core.js';

/// A history of queries of its own in the Rust runtime (`packages/dashql-core-runtime`, see docs/wip/core_runtime.md),
/// e.g. the one of the shell. It takes the query actions of a connection and is read like the queries of a connection.
/// The result tables stay with the host, the history knows them by their ids.

const QUERY_HISTORY_TYPE = Symbol('QUERY_HISTORY_TYPE');

/// The views of the queries, declared by the module (`packages/dashql-core-wasm/src/query_history/view.rs`)
export type {
    QueriesView,
    QueryErrorView,
    QueryHistoryMetrics,
    QueryMetadataView,
    QueryMetricsView,
    QueryOutcomeMetrics,
    QueryProgressView,
    QueryResultTableView,
    QueryStreamMetrics,
    QueryView,
} from './wasm/dashql_core.js';
/// The status and the kind of a query, numeric enums of the module
export { QueryExecutionStatus, QueryType } from './wasm/dashql_core.js';

/// A history of the module: the history of a connection or a history of its own, they take the same query actions
type NativeQueries = glue.Connection | glue.QueryHistory;

/// The query actions and the views of a history of the module, shared by `DashQLConnection` and `DashQLQueryHistory`.
/// An action returns the outcome with the effects for the host, the history knows the result tables by their ids.
export abstract class DashQLQueryActions {
    protected abstract queriesNative(): NativeQueries;

    /// Start tracking a requested query, only the plain fields of the metadata cross
    public executeQuery(queryId: number, traceId: number, text: string, metadata: QueryMetadataView, requestedAt = Date.now()): ConnectionOutcome {
        return this.queriesNative().executeQuery(queryId, traceId, text, metadata, requestedAt);
    }
    public querySending(queryId: number, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().querySending(queryId, now);
    }
    public queryRunning(queryId: number, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryRunning(queryId, now);
    }
    /// The backend reported progress, only the plain fields cross
    public queryProgressUpdated(queryId: number, progress: QueryProgressView, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryProgressUpdated(queryId, progress, now);
    }
    public queryReceivedBatch(queryId: number, metrics: QueryStreamMetrics, now = Date.now()): ConnectionOutcome {
        return this.queriesNative().queryReceivedBatch(queryId, metrics, now);
    }
    /// All batches arrived, the host keeps the table under its id
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
    public query(queryId: number): QueryView | null {
        return this.queriesNative().query(queryId) ?? null;
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

    /// The revision of the history, it changes with every change of a query
    public revision(): number {
        return this.queriesNative().revision();
    }
}
