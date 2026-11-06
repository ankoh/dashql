import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpFetchResult } from '../../platform/http/http_client.js';
import { PlatformType } from '../../platform/platform_type.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { TrinoApiClient, TrinoApiEndpoint } from './trino_api_client.js';
import { TrinoChannel } from './trino_channel.js';
import { createTrinoSetup, setupTrinoConnection } from './trino_connection_setup.js';
import { TRINO_CHANNEL_READY, TRINO_CHANNEL_SETUP_CANCELLED, TRINO_CHANNEL_SETUP_STARTED, type TrinoConnectorAction } from './trino_connection_state.js';
import { RESET_CONNECTION } from '../connection_state.js';
import type { Dispatch } from '../../utils/variant.js';

const OAUTH_PARAMS: connection.TrinoConnectionParams = {
    endpoint: 'https://trino.example.com',
    catalogName: 'hive',
    auth: {
        authType: 'AUTH_OAUTH',
        oauth: {
            authorizationUrl: 'https://idp.example.com/realms/test/protocol/openid-connect/auth',
            tokenUrl: 'https://idp.example.com/realms/test/protocol/openid-connect/token',
            clientId: 'test-client',
            callbackUrl: 'http://localhost:56512/Callback',
            scopes: ['openid', 'offline_access'],
        },
    },
} as connection.TrinoConnectionParams;

function jsonResponse(body: unknown): HttpFetchResult {
    return new Response(JSON.stringify(body), { status: 200 });
}

class FakeHttpClient implements HttpClient {
    requests: { url: string, headers: Headers, body: string }[] = [];
    tokens = 0;
    async fetch(input: URL | Request | string, init?: RequestInit): Promise<HttpFetchResult> {
        const url = input.toString();
        this.requests.push({ url, headers: new Headers(init?.headers), body: init?.body?.toString() ?? '' });
        if (url === OAUTH_PARAMS.auth!.oauth!.tokenUrl) {
            this.tokens += 1;
            return jsonResponse({ access_token: `access-${this.tokens}`, refresh_token: `refresh-${this.tokens}`, token_type: 'Bearer', expires_in: 300, scope: 'openid' });
        }
        return jsonResponse({ id: 'query-id' });
    }
}

function installBridge(callback: (authUrl: URL) => DashQLOAuthLoopbackResult) {
    let authUrl: URL | null = null;
    const bridge = {
        openExternal: vi.fn(async (url: string) => { authUrl = new URL(url); }),
        oauthLoopback: {
            listen: vi.fn(async () => 7),
            wait: vi.fn(async () => callback(authUrl!)),
            close: vi.fn(async () => { }),
        },
    };
    globalThis.dashqlElectron = bridge as unknown as DashQLElectronBridge;
    return bridge;
}

async function setup(
    httpClient: HttpClient,
    params = OAUTH_PARAMS,
    dispatch: Dispatch<TrinoConnectorAction> = () => { },
    signal = new AbortController().signal,
) {
    const logger = new TestLogger();
    return await setupTrinoConnection(dispatch, logger, params, {} as never, new TrinoApiClient(logger, httpClient), httpClient, PlatformType.WEB, false, signal);
}

describe('Trino OAuth setup', () => {
    afterEach(() => {
        delete globalThis.dashqlElectron;
    });

    it('authorizes through the loopback server with the configured scopes', async () => {
        const bridge = installBridge(authUrl => ({ code: 'auth-code', state: authUrl.searchParams.get('state')! }));
        const http = new FakeHttpClient();
        const channel = await setup(http) as TrinoChannel;

        expect(bridge.oauthLoopback.listen).toHaveBeenCalledWith('http://localhost:56512/Callback');
        const authUrl = new URL(bridge.openExternal.mock.calls[0][0]);
        expect(`${authUrl.origin}${authUrl.pathname}`).toBe(OAUTH_PARAMS.auth!.oauth!.authorizationUrl);
        expect(authUrl.searchParams.get('client_id')).toBe('test-client');
        expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:56512/Callback');
        expect(authUrl.searchParams.get('scope')).toBe('openid offline_access');
        expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');

        const tokenBody = new URLSearchParams(http.requests[0].body);
        expect(tokenBody.get('grant_type')).toBe('authorization_code');
        expect(tokenBody.get('code')).toBe('auth-code');
        expect(tokenBody.get('redirect_uri')).toBe('http://localhost:56512/Callback');
        expect(tokenBody.get('code_verifier')).toBeTruthy();
        expect(channel.endpoint.oauthState?.accessToken.accessToken).toBe('access-1');
    });

    it('rejects a callback with a foreign state', async () => {
        installBridge(() => ({ code: 'auth-code', state: 'forged' }));
        await expect(setup(new FakeHttpClient())).rejects.toThrow('state');
    });

    it('forwards authorization errors', async () => {
        installBridge(() => ({ error: 'access_denied', errorDescription: 'User denied access' }));
        await expect(setup(new FakeHttpClient())).rejects.toThrow('User denied access');
    });
});

describe('Trino basic setup', () => {
    const BASIC_PARAMS = {
        endpoint: 'https://trino.example.com',
        defaultCatalog: 'hive',
        defaultSchema: 'sales',
        catalogs: ['hive.sales', 'iceberg'],
        auth: { authType: 'AUTH_BASIC', basic: { username: 'user', secret: 'secret' } },
    } as connection.TrinoConnectionParams;

    it('creates a channel for the endpoint and the default catalog and schema', async () => {
        const dispatch = vi.fn();
        const channel = await setup(new FakeHttpClient(), BASIC_PARAMS, dispatch) as TrinoChannel;
        expect(channel.endpoint.endpoint).toBe('https://trino.example.com');
        expect(channel.defaults).toEqual({ catalog: 'hive', schema: 'sales' });
        expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([TRINO_CHANNEL_SETUP_STARTED, TRINO_CHANNEL_READY]);
    });

    it('sets up and resets connections through the setup API', async () => {
        const http = new FakeHttpClient();
        const logger = new TestLogger();
        const api = createTrinoSetup(new TrinoApiClient(logger, http), {} as never, logger, http, PlatformType.WEB, false)!;
        const dispatch = vi.fn();
        expect(await api.setup(dispatch, BASIC_PARAMS, new AbortController().signal)).toBeInstanceOf(TrinoChannel);
        await api.reset(dispatch);
        expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([TRINO_CHANNEL_SETUP_STARTED, TRINO_CHANNEL_READY, RESET_CONNECTION]);
    });

    it('reports a cancelled setup', async () => {
        const dispatch = vi.fn();
        await expect(setup(new FakeHttpClient(), BASIC_PARAMS, dispatch, AbortSignal.abort())).rejects.toThrow();
        expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([TRINO_CHANNEL_SETUP_STARTED, TRINO_CHANNEL_SETUP_CANCELLED]);
    });
});

describe('Trino OAuth requests', () => {
    it('refreshes an expiring access token and authorizes follow-up requests', async () => {
        const http = new FakeHttpClient();
        const client = new TrinoApiClient(new TestLogger(), http);
        const endpoint = new TrinoApiEndpoint(OAUTH_PARAMS.endpoint, OAUTH_PARAMS.auth!);
        endpoint.oauthState = {
            oauthPkce: { value: '', verifier: '' },
            authCode: { token: '', createdAt: new Date().toISOString() },
            accessToken: { createdAt: new Date().toISOString(), accessToken: 'stale', tokenType: 'Bearer', refreshToken: 'refresh-0', expiresAt: new Date(Date.now() + 1000).toISOString() },
        } as connection.TrinoOAuthState;

        await Promise.all([
            client.getQueryResult(endpoint, 'https://trino.example.com/v1/statement/executing/1'),
            client.getQueryResult(endpoint, 'https://trino.example.com/v1/statement/executing/2'),
        ]);

        const refreshes = http.requests.filter(r => r.url === OAUTH_PARAMS.auth!.oauth!.tokenUrl);
        expect(refreshes.length).toBe(1);
        expect(new URLSearchParams(refreshes[0].body).get('refresh_token')).toBe('refresh-0');
        for (const request of http.requests.filter(r => r.url.startsWith('https://trino.example.com'))) {
            expect(request.headers.get('Authorization')).toBe('Bearer access-1');
        }
        expect(endpoint.oauthState.accessToken.refreshToken).toBe('refresh-1');
    });
});
