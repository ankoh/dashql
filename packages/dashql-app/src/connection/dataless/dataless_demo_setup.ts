import { Dispatch } from '../../utils/index.js';
import { LoggerLike } from '../../platform/logger/logger.js';
import { HEALTH_CHECK_SUCCEEDED } from '../connection_state.js';
import { DATALESS_CHANNEL_READY, DATALESS_CHANNEL_SETUP_CANCELLED, DATALESS_CHANNEL_SETUP_FAILED, DatalessConnectorAction } from './dataless_connection_state.js';
import { DemoDatabaseChannel } from './dataless_demo_channel.js';

const LOG_CTX = "dataless_demo_setup";

export async function setupDatalessDemoConnection(modifyState: Dispatch<DatalessConnectorAction>, logger: LoggerLike, channel: DemoDatabaseChannel, abortSignal?: AbortSignal): Promise<DemoDatabaseChannel> {
    try {
        modifyState({
            type: DATALESS_CHANNEL_READY,
            value: channel,
        });
        abortSignal?.throwIfAborted();


    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.warn("Cancelled setup", {}, LOG_CTX);
            modifyState({
                type: DATALESS_CHANNEL_SETUP_CANCELLED,
                value: error.message,
            });
        } else {
            logger.error("Setup failed", { "message": error.message, "details": error.data }, LOG_CTX);
            modifyState({
                type: DATALESS_CHANNEL_SETUP_FAILED,
                value: error,
            });
        }
        throw error;
    }

    modifyState({
        type: HEALTH_CHECK_SUCCEEDED,
        value: null,
    });
    return channel;
}
