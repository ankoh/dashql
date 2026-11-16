import type * as core from '@akohn/dashql';
import * as connection from '@akohn/dashql-jsonschema/connection.js';

import type { ChannelConnector } from '@akohn/dashql/runtime/runtime';
import { HyperDatabaseClient } from '@akohn/dashql/platform/connections/hyper/hyperdb_grpc_client';
import { connectEmbeddedHyper } from '@akohn/dashql/platform/connections/embedded_database_channel';
import { connectionClientContext, type HyperLogMetrics } from './hyper_log_metrics.js';
import type { EmbeddedDatabaseSetupFn } from '../../platform/embedded_database_provider.js';
import { HyperChannelDatabase } from './hyper_channel_database.js';
import { hyperConnectionContext } from './hyper_connection_context.js';
import { getHyperLinkTabState } from './hyper_link_tab.js';

// The runtime sets up the connections (`connection_setup/` of the Rust runtime): it picks the channel of the params and
// resolves the params of a link with its token. The runtime speaks Hyper over HTTP and the Hyper of Salesforce itself,
// the app connects the channels of the host: the embedded Hyper and gRPC through the native proxy.

/// What connects the channels of the app
export interface ChannelClients {
    grpcClient: HyperDatabaseClient | null;
    setupEmbeddedDatabase: EmbeddedDatabaseSetupFn;
    logMetrics: HyperLogMetrics | null;
}

/// Connect a channel that a setup of a connection asks for
export async function connectChannel(clients: ChannelClients, connectionId: string, request: core.RuntimeChannelRequest): Promise<unknown> {
    // The Hyper log attributes the queries of the channel to the connection by its client context
    const clientContext = connectionClientContext(connectionId);
    const params = request.params as connection.HyperConnectionParams;
    if (request.kind === 'embedded') {
        const database = await clients.setupEmbeddedDatabase('hyper_wasm_connector');
        const channel = await connectEmbeddedHyper(database, params, clientContext);
        clients.logMetrics?.watch({ database, sessions: true }, connectionId);
        return channel;
    }
    const client = clients.grpcClient;
    if (!client) throw new Error(`gRPC client is not available (required for protocol ${params.protocol})`);
    const channel = await client.connect(params, hyperConnectionContext(params, clientContext));
    // Every query of a remote channel runs in a session of its own
    const database = new HyperChannelDatabase(context => client.connect(params, hyperConnectionContext(params, context)));
    clients.logMetrics?.watch({ database, sessions: false }, connectionId);
    return channel;
}

/// What connects the channels of the setups of the runtime of the app, with the clients of the app as they are when a
/// setup asks
export function createChannelConnector(clients: () => ChannelClients): ChannelConnector {
    return {
        connect: (connectionId, request) => connectChannel(clients(), connectionId, request),
        // The Hyper of a link is reached with the token of the link, it is never stored
        hyperLinkToken: connectionId => getHyperLinkTabState().tokens[connectionId] ?? null,
    };
}
