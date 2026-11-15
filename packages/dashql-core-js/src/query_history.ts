import { DashQL, Ptr } from './api.js';
import type {
    DashQLConnectionQueries,
    DashQLQueryMetadata,
    DashQLQueryProgress,
    DashQLQuerySnapshot,
    DashQLStreamMetrics,
} from './connection.js';
import type * as glue from './wasm/dashql_core.js';

/// A history of queries of its own in the Rust runtime (`packages/dashql-core-runtime`, see docs/wip/core_runtime.md),
/// e.g. the one of the shell. It takes the query actions of a connection and is read like the queries of a connection.
/// The result tables stay with the host, the history knows them by their ids.

const QUERY_HISTORY_TYPE = Symbol('QUERY_HISTORY_TYPE');

/// What the host does after an action on a history
export type DashQLQueryHistoryEffect =
    /// Nothing shows the result table of a query anymore
    { type: 'releaseResultTable'; queryId: number; tableId: number };

/// What an action on a history did
export interface DashQLQueryHistoryOutcome {
    /// Did the action change the history?
    changed: boolean;
    /// The effects for the host, in order
    effects: DashQLQueryHistoryEffect[];
}

/// The fields of the metadata of a query that cross into Rust
export function plainQueryMetadata(metadata: DashQLQueryMetadata): DashQLQueryMetadata {
    return {
        queryType: metadata.queryType,
        title: metadata.title,
        description: metadata.description,
        issuer: metadata.issuer,
        userProvided: metadata.userProvided,
        workbookId: metadata.workbookId,
        resultOwner: metadata.resultOwner,
    };
}

/// The fields of a progress update that cross into Rust
export function plainQueryProgress(progress: DashQLQueryProgress): DashQLQueryProgress {
    return {
        isQueued: progress.isQueued,
        progressPercent: progress.progressPercent,
        resultRows: progress.resultRows,
        rowsProcessed: progress.rowsProcessed,
        executionTimeMs: progress.executionTimeMs,
        metrics: progress.metrics,
        phase: progress.phase ?? null,
    };
}

type NativeQueryHistory = glue.QueryHistory;

const json = (value: unknown): string => JSON.stringify(value);
const optionalJson = (value: unknown): string | undefined => value == null ? undefined : JSON.stringify(value);

export class DashQLQueryHistory {
    public readonly ptr: Ptr<typeof QUERY_HISTORY_TYPE, NativeQueryHistory>;

    public constructor(ptr: Ptr<typeof QUERY_HISTORY_TYPE, NativeQueryHistory>) {
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

    private native(): NativeQueryHistory {
        return this.ptr.assertNotNull();
    }

    private outcome(outcome: glue.ConnectionOutcome): DashQLQueryHistoryOutcome {
        try {
            return { changed: outcome.changed, effects: JSON.parse(outcome.effects) as DashQLQueryHistoryEffect[] };
        } finally {
            outcome.free();
        }
    }

    // The actions, the ones of the queries of a connection

    public executeQuery(queryId: number, traceId: number, text: string, metadata: DashQLQueryMetadata, requestedAt = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().executeQuery(queryId, traceId, text, json(plainQueryMetadata(metadata)), requestedAt));
    }
    public querySending(queryId: number, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().querySending(queryId, now));
    }
    public queryRunning(queryId: number, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryRunning(queryId, now));
    }
    /// The backend reported progress, only the plain fields cross
    public queryProgressUpdated(queryId: number, progress: DashQLQueryProgress, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryProgressUpdated(queryId, json(plainQueryProgress(progress)), now));
    }
    public queryReceivedBatch(queryId: number, metrics: DashQLStreamMetrics, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryReceivedBatch(queryId, json(metrics), now));
    }
    /// All batches arrived, the host keeps the table under its id
    public queryReceivedAllBatches(queryId: number, tableId: number, rows: number, metrics: DashQLStreamMetrics, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryReceivedAllBatches(queryId, tableId, rows, json(metrics), now));
    }
    public queryProcessingResults(queryId: number, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryProcessingResults(queryId, now));
    }
    public queryProcessedResults(queryId: number, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryProcessedResults(queryId, now));
    }
    public querySucceeded(queryId: number, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().querySucceeded(queryId, now));
    }
    public queryFailed(queryId: number, message: string, details: string | null, metrics: DashQLStreamMetrics | null, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryFailed(queryId, message, details ?? undefined, optionalJson(metrics), now));
    }
    public queryCancelled(queryId: number, message: string, details: string | null, metrics: DashQLStreamMetrics | null, now = Date.now()): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryCancelled(queryId, message, details ?? undefined, optionalJson(metrics), now));
    }
    public queryCacheRecorded(queryId: number, cacheKey: string, servedFromCache: boolean, cachedAt: number | null): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryCacheRecorded(queryId, cacheKey, servedFromCache, cachedAt ?? undefined));
    }
    public queryCacheDeleted(queryId: number): DashQLQueryHistoryOutcome {
        return this.outcome(this.native().queryCacheDeleted(queryId));
    }

    // Reading the state

    /// The revision of the history, it changes with every change of a query
    public revision(): number {
        return this.native().revision();
    }
    /// The queries in the shape of the queries of a connection
    public queries(): DashQLConnectionQueries {
        return JSON.parse(this.native().queries()) as DashQLConnectionQueries;
    }
    public query(queryId: number): DashQLQuerySnapshot | null {
        const text = this.native().query(queryId);
        return text == null ? null : JSON.parse(text) as DashQLQuerySnapshot;
    }
}
