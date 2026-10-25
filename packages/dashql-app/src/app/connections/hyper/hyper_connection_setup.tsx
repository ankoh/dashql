import * as React from 'react';
import * as buf from "@bufbuild/protobuf";
import * as pb from "../../../proto.js";
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import {
    HYPER_CHANNEL_READY,
    HYPER_CHANNEL_SETUP_CANCELLED,
    HYPER_CHANNEL_SETUP_FAILED,
    HYPER_CHANNEL_SETUP_STARTED,
    HyperConnectorAction,
} from './hyper_connection_state.js';
import { Logger, stringifyError } from '../../../platform/logger/logger.js';
import { HyperConnectorConfig } from '../connector_configs.js';
import { Dispatch } from '../../../utils/variant.js';
import {
    HyperDatabaseChannel,
    HyperDatabaseClient,
    HyperDatabaseConnectionContext,
} from './hyperdb_grpc_client.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { useAppConfig } from '../../config/app_config.js';
import { useHyperGrpcClient, useHyperHttpClient } from './hyperdb_grpc_client_provider.js';
import { RESET_CONNECTION } from '../connection_state.js';
import { useEmbeddedDatabaseSetup, type EmbeddedDatabaseSetupFn } from '../../../platform/database/embedded_database_provider.js';
import { EmbeddedDatabaseChannel, EmbeddedHyperDatabaseChannel } from '../embedded/embedded_database_channel.js';
import { connectionClientContext, type HyperLogMetrics } from './hyper_log_metrics.js';
import { useHyperLogMetrics } from './hyper_log_metrics_provider.js';
import { HyperChannelDatabase } from './hyper_channel_database.js';
import type { EmbeddedClientContext } from '../../../platform/database/embedded_database.js';

const LOG_CTX = "hyper_setup";

function resolveClient(protocol: connection.HyperProtocol, grpcClient: HyperDatabaseClient | null, httpClient: HyperDatabaseClient | null): HyperDatabaseClient {
    if (protocol === 'V3_HTTP') {
        if (!httpClient) throw new Error("HTTP client is not available");
        return httpClient;
    }
    if (!grpcClient) throw new Error(`gRPC client is not available (required for protocol ${protocol})`);
    return grpcClient;
}

/// The context of the channels of a remote Hyper connection, whose queries have a client context.
/// The direct gRPC Hyper connector never changes the headers it injects.
function hyperConnectionContext(params: connection.HyperConnectionParams, clientContext: EmbeddedClientContext | null): HyperDatabaseConnectionContext {
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

export async function setupHyperConnection(updateState: Dispatch<HyperConnectorAction>, logger: Logger, params: connection.HyperConnectionParams, _config: HyperConnectorConfig, grpcClient: HyperDatabaseClient | null, httpClient: HyperDatabaseClient | null, setupEmbeddedDatabase: EmbeddedDatabaseSetupFn, abortSignal: AbortSignal, logMetrics: HyperLogMetrics | null = null, connectionId: string | null = null): Promise<HyperDatabaseChannel | null> {
    params = structuredClone(params);
    delete params.draftRows;
    let channel: HyperDatabaseChannel | null = null;
    try {
        // Start the channel setup
        updateState({
            type: HYPER_CHANNEL_SETUP_STARTED,
            value: params,
        });
        abortSignal.throwIfAborted()

        if (params.protocol === 'WASM') {
            const database = await setupEmbeddedDatabase('hyper_wasm_connector');
            // The Hyper log attributes the queries of the session to the connection by its client context
            const embeddedConnection = await database.connect({
                defaultDatabase: 'hyper',
                clientContext: connectionId == null ? undefined : connectionClientContext(connectionId),
            });
            if (connectionId != null) logMetrics?.watch({ database, sessions: true }, connectionId);
            channel = new EmbeddedHyperDatabaseChannel(new EmbeddedDatabaseChannel(embeddedConnection));
        } else {
            const client = resolveClient(params.protocol, grpcClient, httpClient);
            const connectParams = params;
            // The Hyper log attributes the queries of the channel to the connection by its client context
            channel = await client.connect(params, hyperConnectionContext(params, connectionId == null ? null : connectionClientContext(connectionId)));
            // Every query of a remote channel runs in a session of its own
            const database = new HyperChannelDatabase(clientContext => client.connect(connectParams, hyperConnectionContext(connectParams, clientContext)));
            if (connectionId != null) logMetrics?.watch({ database, sessions: false }, connectionId);
        }
        abortSignal.throwIfAborted();

        // Mark the channel as ready
        updateState({
            type: HYPER_CHANNEL_READY,
            value: [channel, params],
        });
        abortSignal.throwIfAborted();

    } catch (error: any) {
        await channel?.close();
        if (error.name === 'AbortError') {
            logger.warn("Cancelled setup", {}, LOG_CTX);
            updateState({
                type: HYPER_CHANNEL_SETUP_CANCELLED,
                value: {
                    message: stringifyError(error)
                },
            });
        } else if (error instanceof Error) {
            logger.warn("Setup failed", { "error": error?.message }, LOG_CTX);
            updateState({
                type: HYPER_CHANNEL_SETUP_FAILED,
                value: {
                    message: error.message,
                },
            });
        }
        throw error;
    }
    return channel;
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
