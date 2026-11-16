import * as pb from "@ankoh/dashql/platform/proto";
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import {
    HyperDatabaseChannel,
    HyperDatabaseClient,
    HyperDatabaseConnectionContext,
    HyperHttpChannelDescription,
    HyperQueryResultStream,
} from '@ankoh/dashql/platform/connections/hyper/hyperdb_grpc_client';

/// The chunks of a result that the query executor fetches at once
export const DEFAULT_PARALLEL_CHUNKS = 4;

/// A channel over the HTTP API of Hyper. It only describes itself, the query executor of the runtime sends the
/// requests of its queries with the HTTP client of the platform.
class WebHyperDatabaseChannel implements HyperDatabaseChannel {
    constructor(private readonly connection: HyperDatabaseConnectionContext, private readonly parallelChunks: number, private readonly endpoint: string) { }

    /// The endpoint, the attached databases, the query parameters, the client context and the auth headers of the
    /// context at the time of the call
    async describeHttp(): Promise<HyperHttpChannelDescription> {
        return {
            params: {
                endpoint: this.endpoint,
                attachedDatabases: this.connection.getAttachedDatabases(),
                queryParameters: this.connection.getQueryParameters(),
            },
            clientContext: this.connection.getClientContext?.() ?? null,
            auth: await this.connection.getRequestMetadata(),
            parallelChunks: this.parallelChunks,
        };
    }

    async executeQuery(_params: pb.salesforce_hyperdb_grpc_v1.pb.QueryParam): Promise<HyperQueryResultStream> {
        throw new Error('The runtime sends the queries of a Hyper channel over HTTP itself');
    }

    async close(): Promise<void> { }
}

export interface WebHyperDatabaseClientConfig {
    /// Maximum number of chunk fetches in flight per query result
    parallelChunks?: number;
}

/// The client of the channels over the HTTP API of Hyper
export class WebHyperDatabaseClient implements HyperDatabaseClient {
    parallelChunks: number;

    constructor(config: WebHyperDatabaseClientConfig = {}) {
        this.parallelChunks = Math.max(1, config.parallelChunks ?? DEFAULT_PARALLEL_CHUNKS);
    }

    async connect(hyperArgs: connection.HyperConnectionParams, context: HyperDatabaseConnectionContext): Promise<HyperDatabaseChannel> {
        if (!hyperArgs.endpoint) {
            throw new Error("missing hyper endpoint");
        }
        // The endpoint is a URL
        new URL(hyperArgs.endpoint);
        return new WebHyperDatabaseChannel(context, this.parallelChunks, hyperArgs.endpoint);
    }
}
