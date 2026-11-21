import * as connection from '@akohn/dashql-jsonschema/connection.js';

import { ChannelMetadataProvider } from '../../channel_common.js';
import type { EmbeddedClientContext } from '../../embedded_database.js';
import type { QueryExecutionResponseStream } from "../../query/query_execution_state.js";

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

export interface HyperQueryExecutionOptions {
    /// Maximum time to wait for the next result batch from the native gRPC proxy.
    readTimeoutMs?: number;
}

export interface HyperDatabaseChannel {
    /// Run the text of a query
    executeQuery(query: string, abort?: AbortSignal, options?: HyperQueryExecutionOptions): Promise<QueryExecutionResponseStream>;
    /// Destroy the connection
    close(): Promise<void>;
}

export interface HyperDatabaseClient {
    /// Create a database connection
    connect(args: connection.HyperConnectionParams, context: HyperDatabaseConnectionContext): Promise<HyperDatabaseChannel>;
}
