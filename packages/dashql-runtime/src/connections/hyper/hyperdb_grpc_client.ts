import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as pb from "../../proto.js";

import { ChannelMetadataProvider } from '../../platform/channel_common.js';
import type { EmbeddedClientContext } from '../../platform/database/embedded_database.js';
import { QueryExecutionResponseStream } from "../../query/query_execution_state.js";

export interface AttachedDatabase {
    path: string;
    alias?: string;
}

export interface HyperDatabaseConnectionContext extends ChannelMetadataProvider {
    /// Get the attached databases for a call
    getAttachedDatabases(): AttachedDatabase[];
    /// Get the query parameters that are added to every query
    getQueryParameters(): Record<string, string>;
    /// Get the client context of every query, which Hyper logs as ctx.client of the query events
    getClientContext?(): EmbeddedClientContext | null;
}

export interface HyperQueryResultStream extends QueryExecutionResponseStream { }

export interface HyperQueryExecutionOptions {
    /// Maximum time to wait for the next result batch from the native gRPC proxy.
    readTimeoutMs?: number;
}

/// A channel over the HTTP API of Hyper as the query executor of the core speaks it: the params with the endpoint, the
/// attached databases and the query parameters, the client context and the auth headers of the requests
export interface HyperHttpChannelDescription {
    params: { endpoint: string; attachedDatabases: AttachedDatabase[]; queryParameters: Record<string, string> };
    clientContext: EmbeddedClientContext | null;
    auth: Record<string, string>;
    /// The chunks that a result fetches in parallel
    parallelChunks: number;
}

export interface HyperDatabaseChannel {
    /// Execute Query
    executeQuery(param: pb.salesforce_hyperdb_grpc_v1.pb.QueryParam, abort?: AbortSignal, options?: HyperQueryExecutionOptions): Promise<HyperQueryResultStream>;
    /// Destroy the connection
    close(): Promise<void>;
    /// A channel over the HTTP API describes itself, the query executor of the core then sends its requests. Null
    /// without one, the channel runs the queries.
    describeHttp?(): Promise<HyperHttpChannelDescription | null>;
}

export interface HyperDatabaseClient {
    /// Create a database connection
    connect(args: connection.HyperConnectionParams, context: HyperDatabaseConnectionContext): Promise<HyperDatabaseChannel>;
}
