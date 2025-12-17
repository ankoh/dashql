import * as shell from '@tauri-apps/plugin-shell';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

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
import { Dispatch } from '../../utils/index.js';
import { LoggableException, Logger } from '../../platform/logger.js';
import { HEALTH_CHECK_CANCELLED, HEALTH_CHECK_FAILED, HEALTH_CHECK_STARTED, HEALTH_CHECK_SUCCEEDED, RESET_CONNECTION } from '../connection_state.js';
import { TrinoApiClientInterface, TrinoApiEndpoint } from './trino_api_client.js';
import { TrinoChannel, TrinoChannelInterface } from './trino_channel.js';
import { TrinoConnectorConfig } from '../connector_configs.js';
import { generatePKCEChallenge } from '../../utils/pkce.js';
import { PlatformType } from '../../platform/platform_type.js';
import { isNativePlatform } from '../../platform/native_globals.js';
import { HttpClient } from '../../platform/http_client.js';
import { dateToTimestamp } from '../proto_helper.js';

const LOG_CTX = "trino_setup";

// OAuth callback channel name (must match the Rust side)
const OAUTH_CALLBACK_CHANNEL = "dashql:oauth-callback";

// Default OAuth callback URL for Trino
const DEFAULT_OAUTH_CALLBACK_URL = "http://localhost:56512/Callback";

interface OAuthCallbackData {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
}

/// Setup Trino connection with basic auth (username/password)
async function setupTrinoConnectionBasic(
    modifyState: Dispatch<TrinoConnectorAction>,
    logger: Logger,
    params: pb.dashql.connection.TrinoConnectionParams,
    client: TrinoApiClientInterface,
    abortSignal: AbortSignal
): Promise<TrinoChannelInterface> {
    let channel: TrinoChannelInterface;
    try {
        // Start the channel setup
        modifyState({
            type: TRINO_CHANNEL_SETUP_STARTED,
            value: params,
        });
        abortSignal.throwIfAborted();

        // Create the channel
        const auth = params.auth ?? buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
            authType: pb.dashql.auth.AuthType.AUTH_BASIC,
            basic: buf.create(pb.dashql.auth.BasicAuthParamsSchema, {
                username: "",
                secret: "",
            })
        });
        const endpoint = new TrinoApiEndpoint(params.endpoint, auth);
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

    return channel;
}

/// Wait for OAuth callback from the native server
async function waitForOAuthCallback(abortSignal: AbortSignal): Promise<OAuthCallbackData> {
    // Dynamic import to avoid issues in web builds
    const { listen } = await import("@tauri-apps/api/event");

    return new Promise<OAuthCallbackData>((resolve, reject) => {
        let unlisten: (() => void) | null = null;

        const abortHandler = () => {
            if (unlisten) {
                unlisten();
            }
            reject({ name: 'AbortError', message: 'OAuth callback was aborted' });
        };

        abortSignal.addEventListener('abort', abortHandler);

        listen(OAUTH_CALLBACK_CHANNEL, (event: any) => {
            abortSignal.removeEventListener('abort', abortHandler);
            if (unlisten) {
                unlisten();
            }
            resolve(event.payload as OAuthCallbackData);
        }).then((unlistenFn) => {
            unlisten = unlistenFn;
            // Check if already aborted
            if (abortSignal.aborted) {
                unlisten();
                reject({ name: 'AbortError', message: 'OAuth callback was aborted' });
            }
        });
    });
}

/// Start the OAuth callback server in Tauri
async function startOAuthCallbackServer(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("start_oauth_callback_server");
}

/// Exchange the authorization code for an access token
async function exchangeCodeForToken(
    tokenEndpoint: string,
    clientId: string,
    code: string,
    codeVerifier: string,
    redirectUri: string,
    httpClient: HttpClient,
    logger: Logger
): Promise<pb.dashql.connection.TrinoAccessToken> {
    logger.debug("exchanging code for token", { tokenEndpoint }, LOG_CTX);

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
    });

    const response = await httpClient.fetch(new URL(tokenEndpoint), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });

    if (response.status < 200 || response.status >= 300) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();

    const now = new Date();
    const accessToken = buf.create(pb.dashql.connection.TrinoAccessTokenSchema, {
        createdAt: dateToTimestamp(now),
        accessToken: tokenData.access_token,
        tokenType: tokenData.token_type || 'Bearer',
        refreshToken: tokenData.refresh_token,
        scope: tokenData.scope,
    });

    // Set expiration if provided
    if (tokenData.expires_in) {
        const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
        accessToken.expiresAt = dateToTimestamp(expiresAt);
    }

    return accessToken;
}

/// Setup Trino connection with OAuth
async function setupTrinoConnectionOAuth(
    modifyState: Dispatch<TrinoConnectorAction>,
    logger: Logger,
    params: pb.dashql.connection.TrinoConnectionParams,
    _config: TrinoConnectorConfig,
    client: TrinoApiClientInterface,
    httpClient: HttpClient,
    abortSignal: AbortSignal
): Promise<TrinoChannelInterface> {
    let channel: TrinoChannelInterface;

    if (params.auth?.authType != pb.dashql.auth.AuthType.AUTH_OAUTH || !params.auth?.oauth) {
        throw new LoggableException("OAuth configuration is required for OAuth authentication", {}, LOG_CTX);
    }
    const oauthConfig = params.auth.oauth;

    try {
        // Start OAuth flow
        modifyState({ type: OAUTH_STARTED, value: params });
        abortSignal.throwIfAborted();

        // Generate PKCE challenge
        modifyState({ type: GENERATING_PKCE_CHALLENGE, value: null });
        const pkceChallenge = await generatePKCEChallenge();
        abortSignal.throwIfAborted();
        modifyState({ type: GENERATED_PKCE_CHALLENGE, value: pkceChallenge });

        // Start the OAuth callback server (native only)
        if (isNativePlatform()) {
            await startOAuthCallbackServer();
        }

        // Build the authorization URL
        const callbackUrl = oauthConfig.callbackUrl || DEFAULT_OAUTH_CALLBACK_URL;
        const authBody = new URLSearchParams({
            client_id: oauthConfig.clientId,
            redirect_uri: callbackUrl,
            response_type: 'code',
            code_challenge: pkceChallenge.value,
            code_challenge_method: 'S256',
        });

        if (oauthConfig.scopes) {
            authBody.set('scope', oauthConfig.scopes);
        }

        const authUrl = `${oauthConfig.authorizationEndpoint}?${authBody.toString()}`;
        logger.debug("opening OAuth URL", { url: authUrl }, LOG_CTX);

        // Open the browser for OAuth
        await shell.open(authUrl);
        modifyState({
            type: OAUTH_BROWSER_OPENED,
            value: null,
        });
        abortSignal.throwIfAborted();

        // Wait for the OAuth callback
        const callbackData = await waitForOAuthCallback(abortSignal);
        abortSignal.throwIfAborted();

        // Check for errors
        if (callbackData.error) {
            throw new Error(callbackData.error_description || callbackData.error);
        }
        if (!callbackData.code) {
            throw new Error("No authorization code received");
        }
        const authCode = buf.create(pb.dashql.auth.TemporaryTokenSchema, {
            token: callbackData.code
        });

        logger.debug("received OAuth code", {}, LOG_CTX);
        modifyState({
            type: RECEIVED_OAUTH_CODE,
            value: buf.create(pb.dashql.auth.TemporaryTokenSchema, {
                token: authCode.token,
            }),
        });

        // Exchange the code for an access token
        modifyState({
            type: REQUESTING_ACCESS_TOKEN,
            value: null,
        });
        const accessToken = await exchangeCodeForToken(
            oauthConfig.tokenEndpoint,
            oauthConfig.clientId,
            callbackData.code,
            pkceChallenge.verifier,
            callbackUrl,
            httpClient,
            logger
        );
        abortSignal.throwIfAborted();

        logger.debug("received access token", {}, LOG_CTX);
        modifyState({
            type: RECEIVED_ACCESS_TOKEN,
            value: accessToken,
        });

        // Now setup the channel with the access token
        modifyState({
            type: TRINO_CHANNEL_SETUP_STARTED,
            value: params,
        });
        abortSignal.throwIfAborted();

        // Create the channel
        const endpoint = new TrinoApiEndpoint(params.endpoint, params.auth);
        endpoint.oauthState = buf.create(pb.dashql.connection.TrinoOAuthStateSchema, {
            oauthPkce: pkceChallenge,
            authCode,
            accessToken
        });
        channel = new TrinoChannel(logger, client, endpoint, params.catalogName);

        // Mark the channel as ready
        modifyState({
            type: TRINO_CHANNEL_READY,
            value: channel,
        });
        abortSignal.throwIfAborted();

    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.warn("OAuth flow was aborted", {}, LOG_CTX);
            modifyState({
                type: OAUTH_CANCELLED,
                value: buf.create(pb.dashql.error.DetailedErrorSchema, {
                    message: error.message || "OAuth flow was aborted",
                }),
            });
        } else {
            logger.error("OAuth flow failed", { "error": error.toString() }, LOG_CTX);
            modifyState({
                type: OAUTH_FAILED,
                value: buf.create(pb.dashql.error.DetailedErrorSchema, {
                    message: error.message || "OAuth flow failed",
                }),
            });
        }
        throw error;
    }

    return channel;
}

/// Main setup function that routes to the appropriate auth method
export async function setupTrinoConnection(
    modifyState: Dispatch<TrinoConnectorAction>,
    logger: Logger,
    params: pb.dashql.connection.TrinoConnectionParams,
    config: TrinoConnectorConfig,
    client: TrinoApiClientInterface,
    httpClient: HttpClient,
    _platformType: PlatformType,
    abortSignal: AbortSignal
): Promise<TrinoChannelInterface> {
    let channel: TrinoChannelInterface;

    // Determine auth type
    const authType = params.auth?.authType ?? pb.dashql.auth.AuthType.AUTH_BASIC;

    if (authType === pb.dashql.auth.AuthType.AUTH_OAUTH) {
        // OAuth flow
        channel = await setupTrinoConnectionOAuth(modifyState, logger, params, config, client, httpClient, abortSignal);
    } else {
        // Basic auth or no auth
        channel = await setupTrinoConnectionBasic(modifyState, logger, params, client, abortSignal);
    }

    // Health check
    try {
        modifyState({
            type: HEALTH_CHECK_STARTED,
            value: null
        });
        abortSignal.throwIfAborted();

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
            logger.warn("setup was aborted", {}, LOG_CTX);
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

export function createTrinoSetup(
    trinoClient: TrinoApiClientInterface,
    config: TrinoConnectorConfig,
    logger: Logger,
    httpClient: HttpClient,
    platformType: PlatformType
): (TrinoSetupApi | null) {
    const setup = async (modifyState: Dispatch<TrinoConnectorAction>, params: pb.dashql.connection.TrinoConnectionParams, abort: AbortSignal) => {
        return await setupTrinoConnection(modifyState, logger, params, config, trinoClient, httpClient, platformType, abort);
    };
    const reset = async (updateState: Dispatch<TrinoConnectorAction>) => {
        updateState({
            type: RESET_CONNECTION,
            value: null,
        })
    };
    return { setup, reset };
};
