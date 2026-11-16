import * as auth from '@ankoh/dashql-jsonschema/auth.js';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { HttpClient, HttpFetchResult } from '../../platform/http/http_client.js';
import type { OAuthFlow } from '../../oauth/oauth_flow.js';
import type { OAuthRedirectData } from '../../oauth/oauth_types.js';
import { BASE64URL_CODEC } from '../../utils/base64.js';

// The mock of Salesforce that the config of the app chooses: the setup of the runtime runs as it does against an org,
// the requests of the setup and of the catalog loader are answered from the config and the redirect page of the
// OAuth flow answers at once. The channel connector of the app connects a mock of the Hyper channel.

export interface SalesforceConnectorMockConfig {
    enabled: boolean;
    pkceChallenge?: auth.OAuthPKCEChallenge;
    coreAccess: connection.SalesforceCoreAccessToken;
    coreUserInfo: connection.SalesforceCoreUserInfo;
    dataCloudAccess: connection.SalesforceDataCloudAccessToken;
    dataCloudMetadata: connection.SalesforceDataCloudMetadata;
}

/// The code of the authorization that the mock hands out
export const SALESFORCE_MOCK_AUTH_CODE = 'core-access-auth-code';

function json(body: unknown, status = 200): HttpFetchResult {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function encodePart(value: unknown): string {
    return BASE64URL_CODEC.encode(new TextEncoder().encode(JSON.stringify(value)).buffer);
}

/// The fields of an object in snake case, as the REST APIs of Salesforce name them
function snakeCase(value: object): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`), v]));
}

/// The JWT of the Data Cloud token of the mock, its payload expires when the token of the config does
function dataCloudJwt(access: connection.SalesforceDataCloudAccessToken): string {
    const expiresAt = Date.parse(access.expiresAt ?? '');
    const exp = Number.isFinite(expiresAt) ? Math.floor(expiresAt / 1000) : Math.floor(Date.now() / 1000) + 3600;
    const payload = { ...(access.jwt?.payload ?? {}), exp: access.jwt?.payload?.exp ?? exp };
    return `${encodePart(access.jwt?.header ?? { alg: 'none' })}.${encodePart(payload)}.mock`;
}

/// Answer a request of the setup or of the catalog loader from the mock, null for a request that isn't one of them
export function answerSalesforceMock(mock: SalesforceConnectorMockConfig, input: URL | Request | string): HttpFetchResult | null {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === '/services/oauth2/token') {
        return json({ ...snakeCase(mock.coreAccess), instance_url: mock.coreAccess.instanceUrl ?? url.origin });
    }
    if (url.pathname === '/services/oauth2/userinfo') {
        return json(snakeCase(mock.coreUserInfo));
    }
    if (url.pathname === '/services/a360/token') {
        const access = mock.dataCloudAccess;
        return json({
            access_token: dataCloudJwt(access),
            instance_url: access.instanceUrl,
            token_type: access.tokenType ?? 'Bearer',
            issued_token_type: access.issuedTokenType,
        });
    }
    if (url.pathname.endsWith('/ssot/metadata')) {
        // The entities of every type come with the first one
        const first = url.searchParams.get('entityType') === 'DataModelObject';
        return json({ metadata: first ? mock.dataCloudMetadata.metadata : [] });
    }
    return null;
}

/// The HTTP client of the platform with the requests of Salesforce answered by the mock while the config chooses it
export function mockSalesforceHttp(mock: () => SalesforceConnectorMockConfig | null, http: HttpClient): HttpClient {
    return {
        fetch: async (input, init) => {
            const config = mock();
            const answer = config == null ? null : answerSalesforceMock(config, input);
            return answer ?? await http.fetch(input, init);
        },
    };
}

/// The OAuth flow of the platform whose redirect page answers at once with a code while the config chooses the mock
export function mockSalesforceOAuthFlow(mock: () => SalesforceConnectorMockConfig | null, flow: OAuthFlow): OAuthFlow {
    return {
        get redirectVariant() { return flow.redirectVariant; },
        get redirectCallbackUrl() { return flow.redirectCallbackUrl; },
        get debugMode() { return flow.debugMode; },
        get flavor() { return flow.flavor; },
        authorizeWithRedirectPage: async (authorizationUrl, accepts, signal, onEvent) => {
            if (mock() == null) return await flow.authorizeWithRedirectPage(authorizationUrl, accepts, signal, onEvent);
            signal.throwIfAborted();
            const encoded = authorizationUrl.searchParams.get('state') ?? '';
            const state = JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(encoded)));
            const callback: OAuthRedirectData = { state, code: SALESFORCE_MOCK_AUTH_CODE };
            if (!accepts(callback)) throw new Error('The mock of Salesforce got a callback of another flow');
            return callback;
        },
        authorizeWithLoopback: (authorizationUrl, callbackUrl, signal, onEvent) => flow.authorizeWithLoopback(authorizationUrl, callbackUrl, signal, onEvent),
    };
}
