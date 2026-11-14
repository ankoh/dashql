import * as pb from "@ankoh/dashql-runtime/proto";
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { EmbeddedClientContext } from '@ankoh/dashql-runtime/platform/database/embedded_database';
import type { HyperDatabaseConnectionContext } from '@ankoh/dashql-runtime/connections/hyper/hyperdb_grpc_client';

/// The context of the channels of a remote Hyper connection, whose queries have a client context.
/// The direct gRPC Hyper connector never changes the headers it injects.
export function hyperConnectionContext(params: connection.HyperConnectionParams, clientContext: EmbeddedClientContext | null): HyperDatabaseConnectionContext {
    return {
        getAttachedDatabases(): pb.salesforce_hyperdb_grpc_v1.pb.AttachedDatabase[] {
            return (params.attachedDatabases ?? []) as any;
        },
        async getRequestMetadata(): Promise<Record<string, string>> {
            return params.metadata ?? {};
        },
        getQueryParameters(): Record<string, string> {
            return params.queryParameters ?? {};
        },
        getClientContext(): EmbeddedClientContext | null {
            return clientContext;
        },
    };
}
