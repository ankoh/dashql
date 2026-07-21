import { UmapRequest } from "../compute/umap/umap_projection.js";
import { HyperDatabaseChannel } from "./hyper/hyperdb_grpc_client.js";
import { QueryMetadata } from "./query_execution_state.js";
import { SalesforceDatabaseChannel } from "./salesforce/salesforce_api_client.js";
import { TrinoChannelInterface } from "./trino/trino_channel.js";

/// The query executor args
export interface QueryExecutionArgs {
    query: string;
    analyzeResults?: boolean;
    metadata: QueryMetadata;
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
