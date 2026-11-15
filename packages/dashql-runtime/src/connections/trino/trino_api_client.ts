import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as auth from '@ankoh/dashql-jsonschema/auth.js';

import type { HttpClient } from "../../platform/http/http_client.js";
import type { Logger } from "../../platform/logger/logger.js";
import { dateToTimestamp } from '../proto_helper.js';

export class TrinoApiEndpoint {
    // The endpoint url
    endpoint: string;
    // The auth params
    authParams: auth.TrinoAuthParams;
    // The auth state
    oauthState: connection.TrinoOAuthState | null;

    constructor(endpoint: string, params: auth.TrinoAuthParams) {
        this.endpoint = endpoint;
        this.authParams = params;
        this.oauthState = null;
    }
}

/// Request an access token from an OAuth token endpoint
export async function requestTrinoAccessToken(httpClient: HttpClient, tokenUrl: string, body: URLSearchParams): Promise<connection.TrinoAccessToken> {
    const response = await httpClient.fetch(new URL(tokenUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });
    if (response.status < 200 || response.status >= 300) {
        const errorText = await response.text();
        throw new Error(`Token request failed: ${response.status} ${errorText}`);
    }
    const tokenData = await response.json();
    const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + (tokenData.expires_in * 1000))
        : null;
    return {
        createdAt: dateToTimestamp(new Date())!,
        accessToken: tokenData.access_token,
        tokenType: tokenData.token_type || 'Bearer',
        refreshToken: tokenData.refresh_token,
        expiresAt: dateToTimestamp(expiresAt),
        scope: tokenData.scope,
    };
}

/// The API client of a Trino channel. The query executor of the core speaks the protocol of Trino over the HTTP client
/// of the platform (`QueryExecutorService`).
export class TrinoApiClient {
    /// The logger
    logger: Logger;
    /// The http client
    httpClient: HttpClient;

    constructor(logger: Logger, httpClient: HttpClient) {
        this.logger = logger;
        this.httpClient = httpClient;
    }
}

/// The API client of a Trino channel
export type TrinoApiClientInterface = TrinoApiClient;
