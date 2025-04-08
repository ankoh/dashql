
import { Dispatch } from '../../utils/index.js';
import { Logger } from '../../platform/logger.js';
import { HEALTH_CHECK_SUCCEEDED } from '../connection_state.js';
import { DEMO_CHANNEL_READY, DEMO_CHANNEL_SETUP_CANCELLED, DEMO_CHANNEL_SETUP_FAILED, DemoConnectionParams, DemoConnectorAction } from './demo_connection_state.js';
import { DemoDatabaseChannel } from './demo_database_channel.js';

const LOG_CTX = "demo_setup";

export async function setupDemoConnection(modifyState: Dispatch<DemoConnectorAction>, logger: Logger, params: DemoConnectionParams, abortSignal?: AbortSignal): Promise<DemoDatabaseChannel> {
    try {
        modifyState({
            type: DEMO_CHANNEL_READY,
            value: params.channel,
        });
        abortSignal?.throwIfAborted();


    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.warn("setup was aborted", {}, LOG_CTX);
            modifyState({
                type: DEMO_CHANNEL_SETUP_CANCELLED,
                value: error.message,
            });
        } else {
            logger.error("setup failed", { "message": error.message, "details": error.details }, LOG_CTX);
            modifyState({
                type: DEMO_CHANNEL_SETUP_FAILED,
                value: error,
            });
        }
        throw error;
    }

    console.log("foo");
    modifyState({
        type: HEALTH_CHECK_SUCCEEDED,
        value: null,
    });
    return params.channel;
}
