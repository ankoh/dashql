import * as auth from '@ankoh/dashql-jsonschema/auth.js';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { OAuthFlow } from '../../oauth/oauth_flow.js';
import type { HttpClient } from '../../platform/http/http_client.js';
import { Logger } from '../../platform/logger/logger.js';
import { SalesforceApiClientInterface } from './salesforce_api_client.js';
import { salesforceHttpClient } from './salesforce_connection_setup.js';
import { loadSetupCore, SetupRun } from '../connection_setup_native.js';

const LOG_CTX = 'salesforce_authentication';

export type SalesforceAuthenticationProgress =
    | { stage: 'GENERATING_PKCE_CHALLENGE' }
    | { stage: 'GENERATED_PKCE_CHALLENGE'; pkceChallenge: auth.OAuthPKCEChallenge }
    | { stage: 'OAUTH_NATIVE_LINK_OPENED' }
    | { stage: 'OAUTH_WEB_WINDOW_OPENED' }
    | { stage: 'OAUTH_WEB_WINDOW_CLOSED' }
    | { stage: 'RECEIVED_CORE_AUTH_CODE'; code: string }
    | { stage: 'REQUESTING_CORE_AUTH_TOKEN' }
    | { stage: 'RECEIVED_CORE_AUTH_TOKEN'; coreAccessToken: connection.SalesforceCoreAccessToken }
    | { stage: 'RECEIVED_CORE_USER_INFO'; coreUserInfo: connection.SalesforceCoreUserInfo }
    | { stage: 'REQUESTING_DATA_CLOUD_ACCESS_TOKEN' }
    | { stage: 'RECEIVED_DATA_CLOUD_ACCESS_TOKEN'; dataCloudAccessToken: connection.SalesforceDataCloudAccessToken };

export interface SalesforceAuthenticationResult {
    coreAccessToken: connection.SalesforceCoreAccessToken;
    dataCloudAccessToken: connection.SalesforceDataCloudAccessToken;
    coreUserInfo?: connection.SalesforceCoreUserInfo;
}

export interface SalesforceAuthenticationOptions {
    logger: Logger;
    params: connection.SalesforceConnectionParams;
    authConfig: connection.SalesforceOAuthConfig;
    /// How the platform opens the authorization page and receives the redirect
    oauthFlow: OAuthFlow;
    /// The API client, its HTTP client sends the requests unless `http` is given
    apiClient: SalesforceApiClientInterface;
    /// The HTTP client of the requests
    http?: HttpClient | null;
    forceReLogin: boolean;
    abortSignal: AbortSignal;
    onProgress?: (progress: SalesforceAuthenticationProgress) => void;
}

/// The progress of an action of the setup, null for the actions that aren't steps of the login
function progressOf(type: string, value: any): SalesforceAuthenticationProgress | null {
    switch (type) {
        case 'GENERATING_PKCE_CHALLENGE':
        case 'OAUTH_NATIVE_LINK_OPENED':
        case 'OAUTH_WEB_WINDOW_OPENED':
        case 'OAUTH_WEB_WINDOW_CLOSED':
        case 'REQUESTING_CORE_AUTH_TOKEN':
        case 'REQUESTING_DATA_CLOUD_ACCESS_TOKEN':
            return { stage: type };
        case 'GENERATED_PKCE_CHALLENGE':
            return { stage: type, pkceChallenge: value };
        case 'RECEIVED_CORE_AUTH_CODE':
            return { stage: type, code: value.token };
        case 'RECEIVED_CORE_AUTH_TOKEN':
            return { stage: type, coreAccessToken: value };
        case 'RECEIVED_CORE_USER_INFO':
            return { stage: type, coreUserInfo: value };
        case 'RECEIVED_DATA_CLOUD_ACCESS_TOKEN':
            return { stage: type, dataCloudAccessToken: value };
        default:
            return null;
    }
}

/// Log in to Salesforce with the OAuth flow of the platform and get the core and the Data Cloud token, e.g. for the
/// login of the shell. The login runs in the Rust runtime (`connection_setup/salesforce.rs`), the steps arrive as
/// progress. The user info is optional, the login goes on without it.
export async function authenticateSalesforce(options: SalesforceAuthenticationOptions): Promise<SalesforceAuthenticationResult> {
    const { logger, params, authConfig, oauthFlow, apiClient, forceReLogin, abortSignal, onProgress = () => { } } = options;
    const core = await loadSetupCore();
    const run = new SetupRun({
        logger,
        http: salesforceHttpClient(apiClient, options.http ?? null),
        oauthFlow,
        signal: abortSignal,
        dispatch: action => {
            const progress = action.connector === 'salesforce' ? progressOf(action.type, action.value) : null;
            if (progress != null) onProgress(progress);
        },
    });
    const result = await run.result<{ tokens: { core: connection.SalesforceCoreAccessToken; dataCloud: connection.SalesforceDataCloudAccessToken }; userInfo: connection.SalesforceCoreUserInfo | null }>(
        core.connectionSetup.authenticateSalesforce(run.host(), params, authConfig, forceReLogin),
        LOG_CTX,
    );
    return {
        coreAccessToken: result.tokens.core,
        dataCloudAccessToken: result.tokens.dataCloud,
        coreUserInfo: result.userInfo ?? undefined,
    };
}
