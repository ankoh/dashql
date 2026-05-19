import * as React from 'react';
import * as buf from "@bufbuild/protobuf";
import * as pb from "../../proto.js";
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import {
    HYPER_CHANNEL_READY,
    HYPER_CHANNEL_SETUP_CANCELLED,
    HYPER_CHANNEL_SETUP_FAILED,
    HYPER_CHANNEL_SETUP_STARTED,
    HyperConnectorAction,
} from './hyper_connection_state.js';
import { Logger, stringifyError } from '../../platform/logger/logger.js';
import { HyperConnectorConfig } from '../connector_configs.js';
import { Dispatch } from '../../utils/index.js';
import {
    HyperDatabaseChannel,
    HyperDatabaseClient,
    HyperDatabaseConnectionContext,
} from '../../connection/hyper/hyperdb_grpc_client.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useAppConfig } from '../../app_config.js';
import { useHyperGrpcClient, useHyperHttpClient } from '../../connection/hyper/hyperdb_grpc_client_provider.js';
import { RESET_CONNECTION } from '../connection_state.js';

const LOG_CTX = "hyper_setup";

function resolveClient(protocol: connection.HyperProtocol, grpcClient: HyperDatabaseClient | null, httpClient: HyperDatabaseClient | null): HyperDatabaseClient {
    if (protocol === 'V3_HTTP') {
        if (!httpClient) throw new Error("HTTP client is not available");
        return httpClient;
    }
    if (!grpcClient) throw new Error(`gRPC client is not available (required for protocol ${protocol})`);
    return grpcClient;
}

export async function setupHyperConnection(updateState: Dispatch<HyperConnectorAction>, logger: Logger, params: connection.HyperConnectionParams, _config: HyperConnectorConfig, grpcClient: HyperDatabaseClient | null, httpClient: HyperDatabaseClient | null, abortSignal: AbortSignal): Promise<HyperDatabaseChannel | null> {
    let channel: HyperDatabaseChannel;
    try {
        // Start the channel setup
        updateState({
            type: HYPER_CHANNEL_SETUP_STARTED,
            value: params,
        });
        abortSignal.throwIfAborted()

        const client = resolveClient(params.protocol, grpcClient, httpClient);

        // Static connection context.
        // The direct gRPC Hyper connector never changes the headers it injects.
        const connectionContext: HyperDatabaseConnectionContext = {
            getAttachedDatabases(): pb.salesforce_hyperdb_grpc_v1.pb.AttachedDatabase[] {
                return (params.attachedDatabases ?? []) as any;
            },
            async getRequestMetadata(): Promise<Record<string, string>> {
                return (params.metadata as any)?.data ?? {};
            }
        };

        // Create the channel
        channel = await client.connect(params, connectionContext);
        abortSignal.throwIfAborted();

        // Mark the channel as ready
        updateState({
            type: HYPER_CHANNEL_READY,
            value: channel,
        });
        abortSignal.throwIfAborted();

    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.warn("Cancelled setup", {}, LOG_CTX);
            updateState({
                type: HYPER_CHANNEL_SETUP_CANCELLED,
                value: {
                    message: stringifyError(error)
                },
            });
        } else if (error instanceof Error) {
            logger.error("Setup failed", { "error": error?.message }, LOG_CTX);
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
    setup(dispatch: Dispatch<HyperConnectorAction>, params: connection.HyperConnectionParams, abortSignal: AbortSignal): Promise<HyperDatabaseChannel | null>
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

    const api = React.useMemo<HyperSetupApi | null>(() => {
        if (!connectorConfig || (!grpcClient && !httpClient)) {
            return null;
        }
        const setup = async (dispatch: Dispatch<HyperConnectorAction>, params: connection.HyperConnectionParams, abort: AbortSignal) => {
            return await setupHyperConnection(dispatch, logger, params, connectorConfig, grpcClient, httpClient, abort);
        };
        const reset = async (dispatch: Dispatch<HyperConnectorAction>) => {
            dispatch({
                type: RESET_CONNECTION,
                value: null,
            });
        };
        return { setup, reset };
    }, [connectorConfig, grpcClient, httpClient, logger]);

    return (
        <SETUP_CTX.Provider value={api} > {props.children} </SETUP_CTX.Provider>
    );
};
