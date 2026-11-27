import type * as core from '../core/index.js';
import { connectEmbeddedHyper } from '../platform/connections/embedded_database_channel.js';
import { connectionClientContext } from '../platform/connections/hyper/hyper_client_context.js';
import type { EmbeddedComputeDatabase } from '../platform/embedded_database.js';
import type { ChannelConnector } from './runtime.js';

/// Sets up the embedded database of a platform when a channel or a computation first needs it
export type EmbeddedDatabaseSetup = (context: string) => Promise<EmbeddedComputeDatabase>;

/// Connect the channel to the embedded Hyper that a setup of a connection asks for, on the session of the request. The
/// Hyper log attributes the queries of the channel to the connection by its client context.
export async function connectEmbeddedChannel(setup: EmbeddedDatabaseSetup, connectionId: string, request: core.RuntimeChannelRequest): Promise<unknown> {
    const database = await setup('hyper_wasm_connector');
    return await connectEmbeddedHyper(database, request.session, connectionClientContext(connectionId));
}

/// The channels of a platform with the embedded Hyper only: Hyper over gRPC is refused, the runtime speaks Trino, Hyper
/// over HTTP and the Hyper of Salesforce itself
export function createEmbeddedChannelConnector(setup: EmbeddedDatabaseSetup): ChannelConnector {
    return {
        connect: async (connectionId, request) => {
            if (request.kind !== 'embedded') throw new Error(`the channel ${request.kind} of a ${request.type} connection is not available here`);
            return await connectEmbeddedChannel(setup, connectionId, request);
        },
    };
}
