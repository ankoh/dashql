import * as pb from '@ankoh/dashql-protobuf';

import { TRINO_CHANNEL_READY, TRINO_CHANNEL_SETUP_CANCELLED, TRINO_CHANNEL_SETUP_FAILED, TRINO_CHANNEL_SETUP_STARTED, TrinoConnectorAction } from './trino_connection_state.js';
import { Dispatch } from '../../utils/index.js';
import { Logger } from '../../platform/logger.js';
import { HEALTH_CHECK_CANCELLED, HEALTH_CHECK_FAILED, HEALTH_CHECK_STARTED, HEALTH_CHECK_SUCCEEDED, RESET } from '../connection_state.js';
import { TrinoApiClientInterface, TrinoApiEndpoint } from './trino_api_client.js';
import { TrinoChannel, TrinoChannelInterface } from './trino_channel.js';
import { TrinoConnectorConfig } from '../connector_configs.js';

const LOG_CTX = "trino_setup";

export async function setupTrinoConnection(modifyState: Dispatch<TrinoConnectorAction>, logger: Logger, params: pb.dashql.connection.TrinoConnectionParams, _config: TrinoConnectorConfig, client: TrinoApiClientInterface, abortSignal: AbortSignal): Promise<TrinoChannelInterface> {
    // First prepare the channel
    let channel: TrinoChannelInterface;
    try {
        // Start the channel setup
        modifyState({
            type: TRINO_CHANNEL_SETUP_STARTED,
            value: params,
        });
        abortSignal.throwIfAborted();

        // Create the channel
        const endpoint: TrinoApiEndpoint = {
            endpoint: params.endpoint,
            auth: params.auth ?? null,
        };
        channel = new TrinoChannel(logger, client, endpoint, params.catalogName);

        // Mark the channel as ready
        modifyState({
            type: TRINO_CHANNEL_READY,
            value: channel,
        });
        abortSignal.throwIfAborted();


    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.warn("setup was aborted", {}, LOG_CTX);
            modifyState({
                type: TRINO_CHANNEL_SETUP_CANCELLED,
                value: error.message,
            });
        } else {
            logger.error("setup failed", { "message": error.message, "details": error.details }, LOG_CTX);
            modifyState({
                type: TRINO_CHANNEL_SETUP_FAILED,
                value: error,
            });
        }
        throw error;
    }

    try {
        // Start the health check
        modifyState({
            type: HEALTH_CHECK_STARTED,
            value: null
        });
        abortSignal.throwIfAborted();

        // Check the health
        const health = await channel.checkHealth();
        abortSignal.throwIfAborted();

        if (health.ok) {
            modifyState({
                type: HEALTH_CHECK_SUCCEEDED,
                value: null,
            });
        } else {
            throw health.error;
        }
    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.warn("setup was aborted", {});
            modifyState({
                type: HEALTH_CHECK_CANCELLED,
                value: error,
            });
        } else {
            logger.error("setup failed", { "message": error.message, "details": error.details }, LOG_CTX);
            modifyState({
                type: HEALTH_CHECK_FAILED,
                value: error,
            });
        }
        throw error;
    }
    return channel;
}
export interface TrinoSetupApi {
    setup(dispatch: Dispatch<TrinoConnectorAction>, params: pb.dashql.connection.TrinoConnectionParams, abortSignal: AbortSignal): Promise<TrinoChannelInterface | null>
    reset(dispatch: Dispatch<TrinoConnectorAction>): Promise<void>
}

export function createTrinoSetup(trinoClient: TrinoApiClientInterface, config: TrinoConnectorConfig, logger: Logger): (TrinoSetupApi | null) {
    const setup = async (modifyState: Dispatch<TrinoConnectorAction>, params: pb.dashql.connection.TrinoConnectionParams, abort: AbortSignal) => {
        return await setupTrinoConnection(modifyState, logger, params, config, trinoClient, abort);
    };
    const reset = async (updateState: Dispatch<TrinoConnectorAction>) => {
        updateState({
            type: RESET,
            value: null,
        })
    };
    return { setup, reset };
};
