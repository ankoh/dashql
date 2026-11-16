import * as React from 'react';
import type * as core from '@ankoh/dashql-core';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { ChannelConnector } from '@ankoh/dashql-runtime/runtime';
import { HyperDatabaseClient, type HyperDatabaseConnectionContext } from '@ankoh/dashql-runtime/connections/hyper/hyperdb_grpc_client';
import { SalesforceDatabaseChannel, type SalesforceApiClientInterface } from '@ankoh/dashql-runtime/connections/salesforce/salesforce_api_client';
import { connectEmbeddedHyper } from '@ankoh/dashql-runtime/connections/embedded/embedded_database_channel';
import { useHyperGrpcClient, useHyperHttpClient } from './hyperdb_grpc_client_provider.js';
import { useEmbeddedDatabaseSetup, type EmbeddedDatabaseSetupFn } from '../../platform/database/embedded_database_provider.js';
import { connectionClientContext, type HyperLogMetrics } from './hyper_log_metrics.js';
import { useHyperLogMetrics } from './hyper_log_metrics_provider.js';
import { HyperChannelDatabase } from './hyper_channel_database.js';
import { hyperConnectionContext } from './hyper_connection_context.js';
import { getHyperLinkTabState } from './hyper_link_tab.js';
import { useSalesforceAPI } from '../salesforce/salesforce_connector.js';
import { useOptionalRuntime } from '../../runtime/runtime_hooks.js';

// The runtime sets up the connections (`connection_setup/` of the Rust runtime): it picks the channel of the params and
// resolves the params of a link with its token, the app connects the channel. The embedded Hyper and gRPC through the
// native proxy stay channels of the app, HTTP channels describe themselves to the query executor.

/// What connects the channels of the app
export interface ChannelClients {
    grpcClient: HyperDatabaseClient | null;
    httpClient: HyperDatabaseClient | null;
    setupEmbeddedDatabase: EmbeddedDatabaseSetupFn;
    logMetrics: HyperLogMetrics | null;
    salesforce: SalesforceApiClientInterface | null;
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
            if (!clients.httpClient || !clients.salesforce) throw new Error(`No client available for protocol V3_HTTP`);
            // The database name, the audience header and the bearer token go with every request
            const context: HyperDatabaseConnectionContext = {
                getAttachedDatabases: () => request.attachedDatabases,
                getRequestMetadata: async () => request.requestMetadata,
                getQueryParameters: () => ({}),
            };
            const hyperChannel = await clients.httpClient.connect(salesforceChannelParams(request.endpoint), context);
            return new SalesforceDatabaseChannel(clients.salesforce, request.tokens.core as never, request.tokens.dataCloud as never, hyperChannel);
        }
        case 'trino':
            throw new Error('The runtime keeps the Trino channels itself');
    }
}

interface Props {
    children: React.ReactElement;
}

/// Give the runtime the clients of the app that connect the channels of the setups
export const ChannelConnectorProvider: React.FC<Props> = (props: Props) => {
    const runtime = useOptionalRuntime();
    const grpcClient = useHyperGrpcClient();
    const httpClient = useHyperHttpClient();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const logMetrics = useHyperLogMetrics();
    const salesforce = useSalesforceAPI();

    const connector = React.useMemo<ChannelConnector>(() => {
        const clients: ChannelClients = { grpcClient, httpClient, setupEmbeddedDatabase, logMetrics, salesforce };
        return {
            connect: (connectionId, request) => connectChannel(clients, connectionId, request),
            // The Hyper of a link is reached with the token of the link, it is never stored
            hyperLinkToken: connectionId => getHyperLinkTabState().tokens[connectionId] ?? null,
        };
    }, [grpcClient, httpClient, setupEmbeddedDatabase, logMetrics, salesforce]);

    // Set during the render: a setup that a handler of a child starts in the same render connects with the clients
    const attached = React.useRef<ChannelConnector | null>(null);
    if (runtime != null && attached.current !== connector) {
        attached.current = connector;
        runtime.setChannelConnector(connector);
    }
    return props.children;
};
