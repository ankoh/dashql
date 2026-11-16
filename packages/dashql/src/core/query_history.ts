import type * as buffers from './buffers.js';
import { DashQL, Ptr } from './api.js';
import type * as glue from '@ankoh/dashql-wasm/dashql_core.js';

/// The views of the queries of the runtime, declared by the module (`packages/dashql-core-wasm/src/query_history/view.rs`):
/// a query is a slice `query` of the `Runtime`.
export type {
    ProfileLayoutView,
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
} from '@ankoh/dashql-wasm/dashql_core.js';
/// The status and the kind of a query, numeric enums of the module
export { QueryExecutionStatus, QueryType } from '@ankoh/dashql-wasm/dashql_core.js';

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

    /// Follow the progress of a query of a runtime, null without structured progress. The payloads with the keys that
    /// the host holds don't cross again.
    public follow(runtime: glue.Runtime, queryId: number, known: glue.QueryProfileKeys | null = null): glue.QueryProfileProgressView | null {
        return runtime.followQueryProgress(queryId, this.ptr.assertNotNull(), known ?? undefined) ?? null;
    }

    public destroy(): void {
        this.ptr.destroy();
    }
}
