import type * as core from '@ankoh/dashql';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { ChannelConnector } from '@ankoh/dashql/runtime/runtime';
import { HyperDatabaseClient, type HyperDatabaseConnectionContext } from '@ankoh/dashql/platform/connections/hyper/hyperdb_grpc_client';
import { SalesforceDatabaseChannel } from '@ankoh/dashql/platform/connections/salesforce/salesforce_api_client';
import { HyperDatabaseChannelMock } from '@ankoh/dashql/platform/connections/hyper/hyperdb_grpc_client_mock';
import { connectEmbeddedHyper } from '@ankoh/dashql/platform/connections/embedded/embedded_database_channel';
import { connectionClientContext, type HyperLogMetrics } from './hyper_log_metrics.js';
import type { EmbeddedDatabaseSetupFn } from '../../platform/database/embedded_database_provider.js';
import { HyperChannelDatabase } from './hyper_channel_database.js';
import { hyperConnectionContext } from './hyper_connection_context.js';
import { getHyperLinkTabState } from './hyper_link_tab.js';

// The runtime sets up the connections (`connection_setup/` of the Rust runtime): it picks the channel of the params and
// resolves the params of a link with its token, the app connects the channel. The embedded Hyper and gRPC through the
// native proxy stay channels of the app, HTTP channels describe themselves to the query executor.

/// What connects the channels of the app
export interface ChannelClients {
    grpcClient: HyperDatabaseClient | null;
    httpClient: HyperDatabaseClient | null;
    setupEmbeddedDatabase: EmbeddedDatabaseSetupFn;
    logMetrics: HyperLogMetrics | null;
    /// Does the config choose the mock of Salesforce? Its channel is a mock of Hyper.
    salesforceMock: boolean;
}

/// The params of the Hyper channel of a Salesforce connection over HTTP
function salesforceChannelParams(endpoint: string): connection.HyperConnectionParams {
    return {
        protocol: 'V3_HTTP',
        endpoint,
        tls: { clientKeyPath: "", clientCertPath: "", caCertsPath: "" },
        attachedDatabases: [],
        metadata: {},
    } as connection.HyperConnectionParams;
}

/// Connect a channel that a setup of a connection asks for
export async function connectChannel(clients: ChannelClients, connectionId: string, request: core.RuntimeChannelRequest): Promise<unknown> {
    // The Hyper log attributes the queries of the channel to the connection by its client context
    const clientContext = connectionClientContext(connectionId);
    switch (request.type) {
        case 'hyper': {
            const params = request.params as connection.HyperConnectionParams;
            if (request.kind === 'embedded') {
                const database = await clients.setupEmbeddedDatabase('hyper_wasm_connector');
                const channel = await connectEmbeddedHyper(database, params, clientContext);
                clients.logMetrics?.watch({ database, sessions: true }, connectionId);
                return channel;
            }
            const client = request.kind === 'http' ? clients.httpClient : clients.grpcClient;
            if (!client) {
                throw new Error(request.kind === 'http' ? "HTTP client is not available" : `gRPC client is not available (required for protocol ${params.protocol})`);
            }
            const channel = await client.connect(params, hyperConnectionContext(params, clientContext));
            // Every query of a remote channel runs in a session of its own
            const database = new HyperChannelDatabase(context => client.connect(params, hyperConnectionContext(params, context)));
            clients.logMetrics?.watch({ database, sessions: false }, connectionId);
            return channel;
        }
        case 'salesforce': {
            const { core: coreToken, dataCloud: dataCloudToken } = request.tokens as { core: never; dataCloud: never };
            if (clients.salesforceMock) return new SalesforceDatabaseChannel(coreToken, dataCloudToken, new HyperDatabaseChannelMock());
            if (!clients.httpClient) throw new Error(`No client available for protocol V3_HTTP`);
            // The database name, the audience header and the bearer token go with every request
            const context: HyperDatabaseConnectionContext = {
                getAttachedDatabases: () => request.attachedDatabases,
                getRequestMetadata: async () => request.requestMetadata,
                getQueryParameters: () => ({}),
            };
            const hyperChannel = await clients.httpClient.connect(salesforceChannelParams(request.endpoint), context);
            return new SalesforceDatabaseChannel(coreToken, dataCloudToken, hyperChannel);
        }
    }
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
