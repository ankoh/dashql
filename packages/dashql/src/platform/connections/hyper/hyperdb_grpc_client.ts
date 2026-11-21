import * as connection from '@akohn/dashql-jsonschema/connection.js';

import type { EmbeddedClientContext } from '../../embedded_database.js';
import type { QueryExecutionResponseStream } from "../../query/query_execution_state.js";

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
    /// Connect a channel with the params of a connection. Its queries carry the attached databases, the query
    /// parameters and the client context, which Hyper logs as ctx.client of the query events.
    connect(params: connection.HyperConnectionParams, clientContext: EmbeddedClientContext | null): Promise<HyperDatabaseChannel>;
}
