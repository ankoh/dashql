import * as React from 'react';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import {
    HYPER_CHANNEL_READY,
    HYPER_CHANNEL_SETUP_CANCELLED,
    HYPER_CHANNEL_SETUP_FAILED,
    HYPER_CHANNEL_SETUP_STARTED,
    HyperConnectorAction,
} from '@ankoh/dashql-runtime/connections/hyper/hyper_connection_state';
import { Logger } from '@ankoh/dashql-runtime/platform/logger/logger';
import { HyperConnectorConfig } from '@ankoh/dashql-runtime/connections/connector_configs';
import { Dispatch } from '@ankoh/dashql-runtime/utils/variant';
import {
    HyperDatabaseChannel,
    HyperDatabaseClient,
} from '@ankoh/dashql-runtime/connections/hyper/hyperdb_grpc_client';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useAppConfig } from '../../config/app_config.js';
import { useHyperGrpcClient, useHyperHttpClient } from './hyperdb_grpc_client_provider.js';
import { RESET_CONNECTION } from '@ankoh/dashql-runtime/connections/connection_state';
import { useEmbeddedDatabaseSetup, type EmbeddedDatabaseSetupFn } from '../../platform/database/embedded_database_provider.js';
import { connectEmbeddedHyper } from '@ankoh/dashql-runtime/connections/embedded/embedded_database_channel';
import { connectionClientContext, type HyperLogMetrics } from './hyper_log_metrics.js';
import { useHyperLogMetrics } from './hyper_log_metrics_provider.js';
import { HyperChannelDatabase } from './hyper_channel_database.js';
import { hyperConnectionContext } from './hyper_connection_context.js';
import { loadSetupCore, SetupRun } from '@ankoh/dashql-runtime/connections/connection_setup_native';
import { getHyperLinkTabState } from './hyper_link_tab.js';

const LOG_CTX = "hyper_setup";

/// The actions of the Hyper setup by their names in the Rust runtime
const ACTIONS: Record<string, HyperConnectorAction['type']> = {
    HYPER_CHANNEL_SETUP_STARTED,
    HYPER_CHANNEL_SETUP_CANCELLED,
    HYPER_CHANNEL_SETUP_FAILED,
    HYPER_CHANNEL_READY,
};

/// Set up a Hyper connection. The setup runs in the Rust runtime (`connection_setup/hyper.rs`): it picks the channel of
/// the protocol and resolves the params of a link with its token, the host connects the channel. The embedded Hyper and
/// gRPC through the native proxy stay channels of the host, HTTP channels describe themselves to the query executor.
export async function setupHyperConnection(updateState: Dispatch<HyperConnectorAction>, logger: Logger, params: connection.HyperConnectionParams, _config: HyperConnectorConfig, grpcClient: HyperDatabaseClient | null, httpClient: HyperDatabaseClient | null, setupEmbeddedDatabase: EmbeddedDatabaseSetupFn, abortSignal: AbortSignal, logMetrics: HyperLogMetrics | null = null, connectionId: string | null = null): Promise<HyperDatabaseChannel | null> {
    const core = await loadSetupCore();
    // The Hyper log attributes the queries of the channel to the connection by its client context
    const clientContext = connectionId == null ? null : connectionClientContext(connectionId);
    const run = new SetupRun({
        logger,
        signal: abortSignal,
        dispatch: (action, channel) => {
            const type = ACTIONS[action.type];
            if (type == null) return;
            const value = type === HYPER_CHANNEL_READY ? [channel, action.value.params] : action.value;
            updateState({ type, value } as HyperConnectorAction);
        },
        connectHyperChannel: async (kind, channelParams: connection.HyperConnectionParams) => {
            if (kind === 'embedded') {
                const database = await setupEmbeddedDatabase('hyper_wasm_connector');
                const channel = await connectEmbeddedHyper(database, channelParams, clientContext ?? undefined);
                if (connectionId != null) logMetrics?.watch({ database, sessions: true }, connectionId);
                return channel;
            }
            const client = kind === 'http' ? httpClient : grpcClient;
            if (!client) {
                throw new Error(kind === 'http' ? "HTTP client is not available" : `gRPC client is not available (required for protocol ${channelParams.protocol})`);
            }
            const channel = await client.connect(channelParams, hyperConnectionContext(channelParams, clientContext));
            // Every query of a remote channel runs in a session of its own
            const database = new HyperChannelDatabase(context => client.connect(channelParams, hyperConnectionContext(channelParams, context)));
            if (connectionId != null) logMetrics?.watch({ database, sessions: false }, connectionId);
            return channel;
        },
        // The Hyper of a link is reached with the token of the link, it is never stored
        hyperLinkToken: () => connectionId == null ? null : (getHyperLinkTabState().tokens[connectionId] ?? null),
        closeChannel: channel => void (channel as HyperDatabaseChannel).close(),
    });
    const { channel } = await run.result<{ channel: number }>(core.connectionSetup.hyper(run.host(), params), LOG_CTX);
    return (run.channels.get(channel) ?? null) as HyperDatabaseChannel | null;
}
export interface HyperSetupApi {
    setup(dispatch: Dispatch<HyperConnectorAction>, params: connection.HyperConnectionParams, abortSignal: AbortSignal, connectionId: string): Promise<HyperDatabaseChannel | null>
    reset(dispatch: Dispatch<HyperConnectorAction>): Promise<void>
}

export const SETUP_CTX = React.createContext<HyperSetupApi | null>(null);
export const useHyperSetup = () => React.useContext(SETUP_CTX!);

interface Props {
    /// The children
    children: React.ReactElement;
}

export const HyperSetupProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const appConfig = useAppConfig();
    const connectorConfig = appConfig?.connectors?.hyper ?? null;
    const grpcClient = useHyperGrpcClient();
    const httpClient = useHyperHttpClient();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const logMetrics = useHyperLogMetrics();

    const api = React.useMemo<HyperSetupApi | null>(() => {
        if (!connectorConfig) {
            return null;
        }
        const setup = async (dispatch: Dispatch<HyperConnectorAction>, params: connection.HyperConnectionParams, abort: AbortSignal, connectionId: string) => {
            return await setupHyperConnection(dispatch, logger, params, connectorConfig, grpcClient, httpClient, setupEmbeddedDatabase, abort, logMetrics, connectionId);
        };
        const reset = async (dispatch: Dispatch<HyperConnectorAction>) => {
            dispatch({
                type: RESET_CONNECTION,
                value: null,
            });
        };
        return { setup, reset };
    }, [connectorConfig, grpcClient, httpClient, logger, setupEmbeddedDatabase, logMetrics]);

    return (
        <SETUP_CTX.Provider value={api} > {props.children} </SETUP_CTX.Provider>
    );
};
