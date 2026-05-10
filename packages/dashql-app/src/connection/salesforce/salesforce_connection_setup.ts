import * as shell from '@tauri-apps/plugin-shell';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { OAuthState } from '../connection_types.js';
import { dateToTimestamp } from '../proto_helper.js';

import {
    SETUP_CANCELLED,
    SETUP_FAILED,
    SETUP_STARTED,
    GENERATED_PKCE_CHALLENGE,
    GENERATING_PKCE_CHALLENGE,
    OAUTH_NATIVE_LINK_OPENED,
    OAUTH_WEB_WINDOW_CLOSED,
    OAUTH_WEB_WINDOW_OPENED,
    RECEIVED_CORE_AUTH_CODE,
    RECEIVED_CORE_AUTH_TOKEN,
    RECEIVED_DATA_CLOUD_ACCESS_TOKEN,
    REQUESTING_CORE_AUTH_TOKEN,
    REQUESTING_DATA_CLOUD_ACCESS_TOKEN,
    SalesforceConnectionStateAction,
    SF_CHANNEL_READY,
    SF_CHANNEL_SETUP_STARTED,
} from './salesforce_connection_state.js';
import { generatePKCEChallenge } from '../../utils/pkce.js';
import { BASE64URL_CODEC } from '../../utils/base64.js';
import { isDebugBuild } from '../../globals.js';
import { PlatformType } from '../../platform/platform_type.js';
import { SalesforceConnectorConfig } from '../connector_configs.js';
import { collectSalesforceAuthInfo, SalesforceApiClientInterface, SalesforceDatabaseChannel } from './salesforce_api_client.js';
import { Dispatch } from '../../utils/variant.js';
import { Logger } from '../../platform/logger/logger.js';
import { PlatformEventListener } from '../../platform/events/event_listener.js';
import { RESET_CONNECTION } from './../connection_state.js';
import { AttachedDatabase, HyperDatabaseChannel, HyperDatabaseClient, HyperDatabaseConnectionContext } from '../../connection/hyper/hyperdb_grpc_client.js';

const LOG_CTX = "salesforce_setup";

// By default, a Salesforce OAuth Access Token expires after 2 hours = 7200 seconds
const DEFAULT_EXPIRATION_TIME_MS = 2 * 60 * 60 * 1000;

// We use the web-server OAuth Flow with or without consumer secret.
//
// !! Don't embed a client secret of a connected Salesforce App !!
//
// For untrusted clients, like this SPA, the web server OAuth flow can be configure to NOT require a consumer secret but
// still use PKCE. PKCE makes this more preferrable than the alternative user-agent flow for untrusted clients since it
// ensures that the application that starts the authentication flow is the same one that finishes it.
// (Salesforce discourages using the user-agent flow, see https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_user_agent_flow.htm&type=5)
//
// Make sure this is checked (should be by default):
//      Setup > App Manager > Your App > "Require Proof Key for Code Exchange (PKCE)"
// Uncheck this:
//      Setup > App Manager > Your App > "Require Secret for Web Server Flow"
// What you'll eventually need as well (not, if you only use the native apps):
//      Setup > CORS > Enable CORS for OAuth endpoints
//      Setup > CORS > Allowed Origins List > Add your Origin
//
// Docs:
//  - Web Server Flow: https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm&type=5
//  - User Agent Flow: https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_user_agent_flow.htm&type=5
//  - PKCE: https://oauth.net/2/pkce/
//
// PKCE flow:
//  1. Client creates the code_verifier. (RFC 7636, Section 4.1)
//  2. Client creates the code_challenge by transforming the code_verifier using S256 encryption. (RFC 7636, Section 4.2)
//  3. Client sends the code_challenge and code_challenge_method with the initial authorization request. (RFC 7636, Section 4.3)
//  4. Server responds with an authorization_code. (RFC 7636, Section 4.4)
//  5. Client sends authorization_code and code_verifier to the token endpoint. (RFC 7636, Section 4.5)
//  6. Server transforms the code_verifier using the code_challenge_method from the initial authorization request and checks the result against the code_challenge. If the value of both strings match, then the server has verified that the requests came from the same client and will issue an access_token. (RFC 7636, Section 4.6)

const OAUTH_POPUP_NAME = 'DashQL OAuth';
const OAUTH_POPUP_SETTINGS = 'toolbar=no, menubar=no, width=600, height=700, top=100, left=100';

export async function setupSalesforceConnection(modifyState: Dispatch<SalesforceConnectionStateAction>, logger: Logger, params: connection.SalesforceConnectionParams, config: SalesforceConnectorConfig, platformType: PlatformType, apiClient: SalesforceApiClientInterface, hyperClient: HyperDatabaseClient, appEvents: PlatformEventListener, abortSignal: AbortSignal): Promise<SalesforceDatabaseChannel> {
    let hyperChannel: HyperDatabaseChannel;
    let sfChannel: SalesforceDatabaseChannel;
    let oauthPopup: Window | null = null;
    const closeOAuthPopup = () => {
        if (oauthPopup && !oauthPopup.closed) {
            oauthPopup.close();
        }
        if (oauthPopup) {
            oauthPopup = null;
            modifyState({ type: OAUTH_WEB_WINDOW_CLOSED, value: null });
        }
    };
    try {
        // Start the authorization process
        modifyState({
            type: SETUP_STARTED,
            value: params,
        });
        abortSignal.throwIfAborted()

        // Generate new PKCE challenge
        modifyState({
            type: GENERATING_PKCE_CHALLENGE,
            value: null,
        });
        const pkceChallenge = await generatePKCEChallenge();
        abortSignal.throwIfAborted();
        modifyState({
            type: GENERATED_PKCE_CHALLENGE,
            value: pkceChallenge,
        });

        // Select the oauth flow variant.
        // This will instruct the redirect to dashql.app/oauth.html about the "actual" target.
        // When initiating the OAuth flow from the native app, the redirect will then open a deep link with the OAuth code.
        // When initiating from the web, the redirect will assume there's an opener that it can post the code to.
        const flowVariant: OAuthState['flowVariant'] = platformType !== PlatformType.WEB
            ? "NATIVE_LINK_FLOW"
            : "WEB_OPENER_FLOW";

        // Construct the auth state.
        // For WEB_OPENER_FLOW, embed the actual app origin so that dashql.app/oauth.html
        // can redirect back to the same origin as the initiating app before posting the
        // event. This is needed when the app runs on a different origin than dashql.app
        // (e.g. localhost dev server), because BroadcastChannel is same-origin only and
        // COOP severs window.opener after the popup crosses origins to Salesforce.
        const callbackUrl = flowVariant === "WEB_OPENER_FLOW"
            ? `${window.location.origin}/oauth.html`
            : undefined;
        const authState: OAuthState = {
            flowVariant: flowVariant,
            debugMode: isDebugBuild(),
            ...(callbackUrl ? { callbackUrl } : {}),
            salesforceProvider: {
                instanceUrl: params.instanceUrl,
                appConsumerKey: params.appConsumerKey,
                requestedAt: Date.now(),
                expiresAt: Date.now() + DEFAULT_EXPIRATION_TIME_MS
            }
        };
        // Encode to JSON
        const authStateJson = JSON.stringify(authState);
        const authStateBuffer = new TextEncoder().encode(authStateJson);
        const authStateBase64 = BASE64URL_CODEC.encode(authStateBuffer.buffer);

        // Collect the oauth parameters
        const paramParts = [
            `client_id=${params.appConsumerKey}`,
            `redirect_uri=${config.auth?.oauthRedirect}`,
            `code_challenge=${pkceChallenge.value}`,
            `code_challange_method=S256`,
            `response_type=code`,
            `state=${authStateBase64}`
        ];
        if (params.login != null) {
            paramParts.push(`login_hint=${params.login}`);
        }
        const url = `${params.instanceUrl}/services/oauth2/authorize?${paramParts.join('&')}`;

        // Either start request the oauth flow through a browser popup or by opening a url using the shell plugin
        if (flowVariant == "WEB_OPENER_FLOW") {
            logger.debug("Opening popup", { "url": url.toString() }, LOG_CTX);
            // Open popup window
            const popup = window.open(url, OAUTH_POPUP_NAME, OAUTH_POPUP_SETTINGS);
            if (!popup) {
                // Something went wrong, Browser might prevent the popup.
                // (E.g. FF blocks by default)
                throw new Error('could not open oauth window');
            }
            popup.focus();
            oauthPopup = popup;
            modifyState({ type: OAUTH_WEB_WINDOW_OPENED, value: null });
        } else {
            // Just open the link with the default browser
            logger.debug("Opening URL", { "url": url.toString() }, LOG_CTX);
            shell.open(url);
            modifyState({ type: OAUTH_NATIVE_LINK_OPENED, value: null });
        }

        // Await the oauth redirect
        const authCode = await appEvents.waitForOAuthRedirect(abortSignal);
        abortSignal.throwIfAborted();
        logger.debug("Received OAuth code", { "code": JSON.stringify(authCode) }, LOG_CTX);

        closeOAuthPopup();

        // Received an oauth error?
        if (authCode.error) {
            throw new Error(authCode.error);
        }
        modifyState({
            type: RECEIVED_CORE_AUTH_CODE,
            value: {
                token: authCode.code,
                createdAt: dateToTimestamp(new Date())!
            },
        });

        // Request the core access token
        modifyState({
            type: REQUESTING_CORE_AUTH_TOKEN,
            value: null,
        });

        // Missing the oauth redirect?
        if (!config.auth?.oauthRedirect) {
            throw new Error(`missing oauth redirect url`);
        }
        const coreAccessToken = await apiClient.getCoreAccessToken(
            config.auth,
            params,
            authCode.code,
            pkceChallenge.verifier,
            abortSignal,
        );
        logger.debug("Received core access token", { "token": JSON.stringify(coreAccessToken) }, LOG_CTX);
        modifyState({
            type: RECEIVED_CORE_AUTH_TOKEN,
            value: coreAccessToken,
        });
        abortSignal.throwIfAborted();

        // Request the data cloud access token
        modifyState({
            type: REQUESTING_DATA_CLOUD_ACCESS_TOKEN,
            value: null,
        });
        const dcToken = await apiClient.getDataCloudAccessToken(coreAccessToken, abortSignal);
        logger.debug("Received data cloud token", { "token": JSON.stringify(dcToken) }, LOG_CTX);
        modifyState({
            type: RECEIVED_DATA_CLOUD_ACCESS_TOKEN,
            value: dcToken,
        });
        abortSignal.throwIfAborted();

        // Start the channel setup
        // const dcAuthInfo = getAuthI
        const connParams: connection.HyperConnectionParams = {
            protocol: params.hyperProtocol,
            endpoint: dcToken.instanceUrl ?? "",
            tls: {
                clientKeyPath: "",
                clientCertPath: "",
                caCertsPath: ""
            },
            attachedDatabases: [],
            metadata: {
                message: "",
                details: {}
            } as any,
        };
        modifyState({
            type: SF_CHANNEL_SETUP_STARTED,
            value: connParams,
        });
        abortSignal.throwIfAborted()

        // Static connection context.
        // Inject the database name, the audience header and the bearer token
        const authInfo = collectSalesforceAuthInfo(coreAccessToken, dcToken);
        const connectionContext: HyperDatabaseConnectionContext = {
            getAttachedDatabases(): AttachedDatabase[] {
                return [{
                    path: "lakehouse:" + authInfo?.offcoreTenantId + ";default",
                }];
            },
            async getRequestMetadata(): Promise<Record<string, string>> {
                return {
                    audience: authInfo?.offcoreTenantId ?? "",
                    authorization: `Bearer ${authInfo?.offcoreRawJwt}`,
                };
            }
        };

        // Create the channel
        hyperChannel = await hyperClient.connect(connParams, connectionContext);
        sfChannel = new SalesforceDatabaseChannel(apiClient, coreAccessToken, dcToken, hyperChannel);
        abortSignal.throwIfAborted();

        // Mark the channel as ready
        modifyState({
            type: SF_CHANNEL_READY,
            value: sfChannel,
        });
        abortSignal.throwIfAborted();

    } catch (error: any) {
        closeOAuthPopup();
        if (error.name === 'AbortError') {
            logger.warn("Cancelled OAuth flow", {}, LOG_CTX);
            modifyState({
                type: SETUP_CANCELLED,
                value: error,
            });
        } else if (error instanceof Error) {
            logger.error("Failed OAuth flow", { "error": error.toString() }, LOG_CTX);
            modifyState({
                type: SETUP_FAILED,
                value: {
                    message: error.message,
                },
            });
        }
        // Rethrow the error
        throw error;
    }

    return sfChannel;
}

export interface SalesforceSetupApi {
    setup(dispatch: Dispatch<SalesforceConnectionStateAction>, params: connection.SalesforceConnectionParams, abortSignal: AbortSignal): Promise<SalesforceDatabaseChannel>
    reset(dispatch: Dispatch<SalesforceConnectionStateAction>): Promise<void>
}

export function createSalesforceSetup(hyperClient: HyperDatabaseClient, salesforceApi: SalesforceApiClientInterface, platformType: PlatformType, appEvents: PlatformEventListener, config: SalesforceConnectorConfig, logger: Logger): (SalesforceSetupApi | null) {
    const setup = async (updateState: Dispatch<SalesforceConnectionStateAction>, params: connection.SalesforceConnectionParams, abort: AbortSignal) => {
        return setupSalesforceConnection(updateState, logger, params, config, platformType, salesforceApi, hyperClient, appEvents, abort);
    };
    const reset = async (updateState: Dispatch<SalesforceConnectionStateAction>) => {
        updateState({
            type: RESET_CONNECTION,
            value: null,
        });
    };
    return { setup, reset };
};
