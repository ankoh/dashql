import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { generatePKCEChallenge } from '@ankoh/dashql-platform/utils/pkce';
import { sleep } from '@ankoh/dashql-platform/utils/sleep';
import { Logger, stringifyError } from '@ankoh/dashql-platform/platform/logger/logger';
import { SalesforceApiClientInterface, SalesforceDatabaseChannel } from '@ankoh/dashql-platform/connections/salesforce/salesforce_api_client';
import { SalesforceConnectorConfig } from '@ankoh/dashql-platform/connections/connector_configs';
import { setupStepAction } from '@ankoh/dashql-platform/connections/connection_state';
import { HyperDatabaseChannelMock } from '@ankoh/dashql-platform/connections/hyper/hyperdb_grpc_client_mock';
import type { Runtime } from '@ankoh/dashql-runtime/runtime';

/// The setup of a Salesforce connection with the mock of the API that the config of the app chose: the steps of a
/// setup without an OAuth flow and without requests, over a mock of the Hyper channel. The runtime applies the steps.
export async function setupSalesforceConnectionMock(
    runtime: Runtime,
    connectionId: string,
    params: connection.SalesforceConnectionParams,
    config: SalesforceConnectorConfig,
    apiClient: SalesforceApiClientInterface,
    logger: Logger,
    abortSignal: AbortSignal,
): Promise<void> {
    const step = (name: string, value?: unknown, channel?: number) => runtime.dispatch({ connection: connectionId }, setupStepAction(name, value, channel));
    try {
        step('SETUP_STARTED', params);
        abortSignal.throwIfAborted();
        step('GENERATING_PKCE_CHALLENGE');
        const pkceChallenge = await generatePKCEChallenge();
        abortSignal.throwIfAborted();
        step('GENERATED_PKCE_CHALLENGE', pkceChallenge);

        // The code arrives after a while, like from a window of the user
        await sleep(200);
        abortSignal.throwIfAborted();
        const code = 'core-access-auth-code';
        step('RECEIVED_CORE_AUTH_CODE', { token: code, createdAt: new Date().toISOString() });
        step('REQUESTING_CORE_AUTH_TOKEN');
        if (!config.auth?.oauthRedirect) {
            throw new Error(`Missing oauth redirect url`);
        }
        const coreAccessToken = await apiClient.getCoreAccessToken(config.auth, params, code, pkceChallenge.verifier, abortSignal);
        step('RECEIVED_CORE_AUTH_TOKEN', coreAccessToken);
        abortSignal.throwIfAborted();

        step('REQUESTING_DATA_CLOUD_ACCESS_TOKEN');
        const token = await apiClient.getDataCloudAccessToken(coreAccessToken, abortSignal);
        abortSignal.throwIfAborted();
        step('RECEIVED_DATA_CLOUD_ACCESS_TOKEN', token);
        step('SF_CHANNEL_SETUP_STARTED');
        abortSignal.throwIfAborted();

        const channel = new SalesforceDatabaseChannel(apiClient, coreAccessToken, token, new HyperDatabaseChannelMock());
        step('SF_CHANNEL_READY', null, runtime.handles.register(channel));
        // The mock of the channel answers every query
        step('HEALTH_CHECK_STARTED');
        step('HEALTH_CHECK_SUCCEEDED');
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            logger.warn("Oauth flow was aborted", {});
            step('SETUP_CANCELLED', { message: error.message });
        } else {
            logger.warn("Oauth flow failed", { "error": stringifyError(error) });
            step('SETUP_FAILED', { message: error instanceof Error ? error.message : String(error) });
        }
    }
}
