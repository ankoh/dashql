import * as connection from '@akohn/dashql-jsonschema/connection.js';
import * as core from '@akohn/dashql';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpFetchResult } from '@akohn/dashql/platform/http_client';
import { PlatformType } from '../platform/platform_type.js';
import { AppOAuthFlow } from '../oauth/app_oauth_flow.js';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { createRuntime } from '@akohn/dashql/runtime/runtime';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { TASK_UPDATE_SCHEDULER } from '@akohn/dashql/runtime/store/update_scheduler';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

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

/// Answers the token requests of the identity provider and the probe of the health check like Trino
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
        return jsonResponse({ id: 'query-id', columns: [{ name: '_col0', type: 'integer' }], data: [[1]], stats: { state: 'FINISHED' } });
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

/// Set up a Trino connection with the runtime, returns the outcome and the runtime with the connection
async function setup(http: HttpClient, params = OAUTH_PARAMS, cancelled = false) {
    const runtime = createRuntime({
        logger: new TestLogger(),
        scheduler: TASK_UPDATE_SCHEDULER,
        core: dql,
        http,
        oauthFlow: new AppOAuthFlow({} as never, PlatformType.DESKTOP),
    });
    runtime.module.runCatalogLoader(false);
    runtime.createConnection({ connectorType: ConnectorType.TRINO, setupParams: params, params: { trino: params } }, 'trino');
    const done = runtime.setupConnection('trino');
    if (cancelled) runtime.module.cancelSetup('trino');
    const outcome = await done;
    return { outcome, runtime, connection: runtime.connection('trino')! };
}

describe('Trino OAuth setup', () => {
    afterEach(() => {
        delete globalThis.dashqlElectron;
    });

    it('authorizes through the loopback server with the configured scopes', async () => {
        const bridge = installBridge(authUrl => ({ code: 'auth-code', state: authUrl.searchParams.get('state')! }));
        const http = new FakeHttpClient();
        const { outcome, runtime, connection } = await setup(http);
        expect(outcome.status).toBe('succeeded');

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
        // The connection owns the channel with the token, the probe of the health check sends it
        expect(http.requests[1].headers.get('authorization')).toBe('Bearer access-1');
        expect(connection.connectionHealth).toBe(ConnectionHealth.ONLINE);
        runtime.destroy();
    });

    it('rejects a callback with a foreign state', async () => {
        installBridge(() => ({ code: 'auth-code', state: 'forged' }));
        const { outcome, runtime } = await setup(new FakeHttpClient());
        expect(outcome).toMatchObject({ status: 'failed', message: expect.stringContaining('state') });
        runtime.destroy();
    });

    it('forwards authorization errors', async () => {
        installBridge(() => ({ error: 'access_denied', errorDescription: 'User denied access' }));
        const { outcome, runtime } = await setup(new FakeHttpClient());
        expect(outcome).toMatchObject({ status: 'failed', message: expect.stringContaining('User denied access') });
        runtime.destroy();
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
        const http = new FakeHttpClient();
        const { outcome, runtime, connection } = await setup(http, BASIC_PARAMS);
        expect(outcome.status).toBe('succeeded');
        // The probe of the health check runs on the channel of the connection with its auth and defaults
        const [probe] = http.requests;
        expect(probe.url).toBe('https://trino.example.com/v1/statement');
        expect(probe.headers.get('authorization')).toBe(`Basic ${btoa('user:secret')}`);
        expect(probe.headers.get('x-trino-user')).toBe('user');
        expect(probe.headers.get('x-trino-catalog')).toBe('hive');
        expect(probe.headers.get('x-trino-schema')).toBe('sales');
        expect(connection.connectionHealth).toBe(ConnectionHealth.ONLINE);
        runtime.destroy();
    });

    it('reports a cancelled setup', async () => {
        const { outcome, runtime, connection } = await setup(new FakeHttpClient(), BASIC_PARAMS, true);
        expect(outcome.status).toBe('cancelled');
        expect(connection.connectionHealth).not.toBe(ConnectionHealth.ONLINE);
        runtime.destroy();
    });
});
