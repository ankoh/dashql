import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as auth from '@ankoh/dashql-jsonschema/auth.js';

import {
    TRINO_CHANNEL_READY,
    TRINO_CHANNEL_SETUP_CANCELLED,
    TRINO_CHANNEL_SETUP_FAILED,
    TRINO_CHANNEL_SETUP_STARTED,
    TrinoConnectorAction,
    OAUTH_STARTED,
    OAUTH_CANCELLED,
    OAUTH_FAILED,
    GENERATING_PKCE_CHALLENGE,
    GENERATED_PKCE_CHALLENGE,
    OAUTH_BROWSER_OPENED,
    RECEIVED_OAUTH_CODE,
    REQUESTING_ACCESS_TOKEN,
    RECEIVED_ACCESS_TOKEN,
} from './trino_connection_state.js';
import { Dispatch } from '../../utils/variant.js';
import { Logger } from '../../platform/logger/logger.js';
import { RESET_CONNECTION } from '../connection_state.js';
import { TrinoApiClientInterface, TrinoApiEndpoint } from './trino_api_client.js';
import { TrinoChannel, TrinoChannelInterface } from './trino_channel.js';
import { TrinoConnectorConfig } from '../connector_configs.js';
import type { OAuthFlow } from '../../oauth/oauth_flow.js';
import { HttpClient } from '../../platform/http/http_client.js';
import { loadSetupCore, SetupRun } from '../connection_setup_native.js';

const LOG_CTX = "trino_setup";

/// The actions of the Trino setup by their names in the Rust runtime
const ACTIONS: Record<string, TrinoConnectorAction['type']> = {
    OAUTH_STARTED,
    OAUTH_CANCELLED,
    OAUTH_FAILED,
    GENERATING_PKCE_CHALLENGE,
    GENERATED_PKCE_CHALLENGE,
    OAUTH_BROWSER_OPENED,
    RECEIVED_OAUTH_CODE,
    REQUESTING_ACCESS_TOKEN,
    RECEIVED_ACCESS_TOKEN,
    TRINO_CHANNEL_SETUP_STARTED,
    TRINO_CHANNEL_SETUP_CANCELLED,
    TRINO_CHANNEL_SETUP_FAILED,
    TRINO_CHANNEL_READY,
};

/// Set up a Trino connection: basic auth opens the channel, OAuth logs in through the loopback server of the platform
/// first. The setup runs in the Rust runtime (`connection_setup/trino.rs`), the channel is a `TrinoChannel` on the
/// client.
export async function setupTrinoConnection(
    modifyState: Dispatch<TrinoConnectorAction>,
    logger: Logger,
    params: connection.TrinoConnectionParams,
    _config: TrinoConnectorConfig,
    client: TrinoApiClientInterface,
    httpClient: HttpClient,
    oauthFlow: OAuthFlow,
    forceReLogin: boolean,
    abortSignal: AbortSignal
): Promise<TrinoChannelInterface> {
    const core = await loadSetupCore();
    // The OAuth state of the channel, from the steps of the flow
    let oauthPkce: auth.OAuthPKCEChallenge | null = null;
    let authCode: auth.TemporaryToken | null = null;
    const run = new SetupRun({
        logger,
        http: httpClient,
        oauthFlow,
        signal: abortSignal,
        dispatch: (action, channel) => {
            const type = ACTIONS[action.type];
            if (type == null) return;
            if (type === GENERATED_PKCE_CHALLENGE) oauthPkce = action.value;
            if (type === RECEIVED_OAUTH_CODE) authCode = action.value;
            modifyState({ type, value: type === TRINO_CHANNEL_READY ? channel : action.value } as TrinoConnectorAction);
        },
        openTrinoChannel: description => {
            const auth = params.auth ?? { authType: "AUTH_BASIC", basic: { username: "", secret: "" } };
            const endpoint = new TrinoApiEndpoint(description.endpoint, auth);
            if (description.accessToken != null) {
                endpoint.oauthState = {
                    oauthPkce: oauthPkce ?? undefined,
                    authCode: authCode ?? undefined,
                    accessToken: description.accessToken,
                } as connection.TrinoOAuthState;
            }
            return new TrinoChannel(logger, client, endpoint, { catalog: description.catalog, schema: description.schema });
        },
    });
    const { channel } = await run.result<{ channel: number }>(core.connectionSetup.trino(run.host(), params, forceReLogin), LOG_CTX);
    return run.channels.get(channel) as TrinoChannelInterface;
}

export interface TrinoSetupApi {
    setup(dispatch: Dispatch<TrinoConnectorAction>, params: connection.TrinoConnectionParams, abortSignal: AbortSignal): Promise<TrinoChannelInterface | null>
    reset(dispatch: Dispatch<TrinoConnectorAction>): Promise<void>
}

export function createTrinoSetup(
    trinoClient: TrinoApiClientInterface,
    config: TrinoConnectorConfig,
    logger: Logger,
    httpClient: HttpClient,
    oauthFlow: OAuthFlow,
    forceReLogin: boolean
): (TrinoSetupApi | null) {
    const setup = async (modifyState: Dispatch<TrinoConnectorAction>, params: connection.TrinoConnectionParams, abort: AbortSignal) => {
        return await setupTrinoConnection(modifyState, logger, params, config, trinoClient, httpClient, oauthFlow, forceReLogin, abort);
    };
    const reset = async (updateState: Dispatch<TrinoConnectorAction>) => {
        updateState({
            type: RESET_CONNECTION,
            value: null,
        })
    };
    return { setup, reset };
};
