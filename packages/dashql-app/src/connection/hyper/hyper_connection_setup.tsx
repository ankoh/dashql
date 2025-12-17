import * as React from 'react';
import * as buf from "@bufbuild/protobuf";
import * as pb from '@ankoh/dashql-protobuf';

import {
    HYPER_CHANNEL_READY,
    HYPER_CHANNEL_SETUP_CANCELLED,
    HYPER_CHANNEL_SETUP_FAILED,
    HYPER_CHANNEL_SETUP_STARTED,
    HyperConnectorAction,
} from './hyper_connection_state.js';
import { Logger } from '../../platform/logger.js';
import { HyperConnectorConfig } from '../connector_configs.js';
import { Dispatch } from '../../utils/index.js';
import {
    HyperDatabaseChannel,
    HyperDatabaseClient,
    HyperDatabaseConnectionContext,
} from '../../connection/hyper/hyperdb_client.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useAppConfig } from '../../app_config.js';
import { useHyperDatabaseClient } from '../../connection/hyper/hyperdb_client_provider.js';
import { HEALTH_CHECK_CANCELLED, HEALTH_CHECK_FAILED, HEALTH_CHECK_STARTED, HEALTH_CHECK_SUCCEEDED, RESET_CONNECTION } from '../connection_state.js';

const LOG_CTX = "hyper_setup";

export async function setupHyperConnection(updateState: Dispatch<HyperConnectorAction>, logger: Logger, params: pb.dashql.connection.HyperConnectionParams, _config: HyperConnectorConfig, client: HyperDatabaseClient, abortSignal: AbortSignal): Promise<HyperDatabaseChannel | null> {
    let channel: HyperDatabaseChannel;
    try {
        // Start the channel setup
        updateState({
            type: HYPER_CHANNEL_SETUP_STARTED,
            value: params,
        });
        abortSignal.throwIfAborted()

        // Static connection context.
        // The direct gRPC Hyper connector never changes the headers it injects.
        const connectionContext: HyperDatabaseConnectionContext = {
            getAttachedDatabases(): pb.salesforce_hyperdb_grpc_v1.pb.AttachedDatabase[] {
                return params.attachedDatabases;
            },
            async getRequestMetadata(): Promise<Record<string, string>> {
                return params.metadata;
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
            logger.warn("setup was aborted", {}, LOG_CTX);
            updateState({
                type: HYPER_CHANNEL_SETUP_CANCELLED,
                value: buf.create(pb.dashql.error.DetailedErrorSchema, {
                    message: error.toString(),
                }),
            });
        } else if (error instanceof Error) {
            logger.error("setup failed", { "error": error?.message }, LOG_CTX);
            updateState({
                type: HYPER_CHANNEL_SETUP_FAILED,
                value: buf.create(pb.dashql.error.DetailedErrorSchema, {
                    message: error.message,
                }),
            });
        }
        throw error;
    }

    // Then perform an initial health check
    try {
        // Start the channel setup
        updateState({
            type: HEALTH_CHECK_STARTED,
            value: null,
        });
        abortSignal.throwIfAborted();

        // Create the channel
        const health = await channel.checkHealth();
        abortSignal.throwIfAborted();

        if (health.ok) {
            updateState({
                type: HEALTH_CHECK_SUCCEEDED,
                value: null,
            });
        } else {
            throw new Error(health.error?.message ?? "health check failed");
        }
    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.warn("health was aborted", {}, LOG_CTX);
            updateState({
                type: HEALTH_CHECK_CANCELLED,
                value: null,
            });
        } else if (error instanceof Error) {
            logger.error("health check failed", { "error": error.toString() }, LOG_CTX);
            updateState({
                type: HEALTH_CHECK_FAILED,
                value: buf.create(pb.dashql.error.DetailedErrorSchema, {
                    message: error.message,
                }),
            });
        }
        throw error;
    }
    return channel;
}
export interface HyperSetupApi {
    setup(dispatch: Dispatch<HyperConnectorAction>, params: pb.dashql.connection.HyperConnectionParams, abortSignal: AbortSignal): Promise<void>
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
    const hyperClient = useHyperDatabaseClient();

    const api = React.useMemo<HyperSetupApi | null>(() => {
        if (!connectorConfig || !hyperClient) {
            return null;
        }
        const setup = async (dispatch: Dispatch<HyperConnectorAction>, params: pb.dashql.connection.HyperConnectionParams, abort: AbortSignal) => {
            await setupHyperConnection(dispatch, logger, params, connectorConfig, hyperClient, abort);
        };
        const reset = async (dispatch: Dispatch<HyperConnectorAction>) => {
            dispatch({
                type: RESET_CONNECTION,
                value: null,
            })
        };
        return { setup, reset };
    }, [connectorConfig]);

    return (
        <SETUP_CTX.Provider value={api} > {props.children} </SETUP_CTX.Provider>
    );
};
