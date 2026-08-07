import { UmapRequest } from "../compute/umap/umap_projection.js";
import { HyperDatabaseChannel } from "./hyper/hyperdb_grpc_client.js";
import { QueryMetadata } from "./query_execution_state.js";
import { SalesforceDatabaseChannel } from "./salesforce/salesforce_api_client.js";
import { TrinoChannelInterface } from "./trino/trino_channel.js";

/// The query executor args
export interface QueryExecutionArgs {
    query: string;
    analyzeResults?: boolean;
    /// Computation from the previous execution of the same notebook entry. It can be retired before
    /// analyzing this result so its temporary DuckDB tables do not accumulate across reruns.
    replaceComputationId?: number | null;
    metadata: QueryMetadata;
    /// When true, the executor consults the file-based query result cache: it serves a matching
    /// cached `.arrow` result instead of hitting the backend, and stores the result after a miss.
    /// Only user-provided queries should set this; catalog/health-check queries leave it unset so
    /// they never touch the cache. Cache failures are always non-fatal (fall back to execution).
    cacheable?: boolean;
    /// When true, the query runs *only* if its result is already cached: it's served from the cache
    /// exactly like `cacheable`, but a cache miss is a no-op — the backend is never hit and no query
    /// state is registered (the returned promise resolves to `null`). This backs auto-running a
    /// visualization when the user scrolls to it: show it instantly if the data is on disk, otherwise
    /// leave it un-run. Implies `cacheable` for the purpose of key computation.
    cacheOnly?: boolean;
    /// Optional UMAP projection request. When present (a resolved `'umap'` visualize
    /// spec), the result post-processing step computes per-row 2D coordinates, appends
    /// them to the analyzed table, and records their field names on the embedding
    /// column's group. Requires `analyzeResults`.
    projection?: UmapRequest;
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
