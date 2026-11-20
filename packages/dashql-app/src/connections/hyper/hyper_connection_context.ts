import type * as connection from '@akohn/dashql-jsonschema/connection.js';

import type { EmbeddedClientContext } from '@akohn/dashql/platform/embedded_database';
import type { AttachedDatabase, HyperDatabaseConnectionContext } from '@akohn/dashql/platform/connections/hyper/hyperdb_grpc_client';

/// The context of the channels of a remote Hyper connection, whose queries have a client context.
/// The direct gRPC Hyper connector never changes the headers it injects.
export function hyperConnectionContext(params: connection.HyperConnectionParams, clientContext: EmbeddedClientContext | null): HyperDatabaseConnectionContext {
    return {
        getAttachedDatabases(): AttachedDatabase[] {
            // The settings store the attached databases as objects of a path and an alias
            return (params.attachedDatabases ?? []) as AttachedDatabase[];
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
