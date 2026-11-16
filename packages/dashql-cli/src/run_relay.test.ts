import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ConnectionParams } from '@ankoh/dashql/platform/connections/connection_params';
import { ConnectorType } from '@ankoh/dashql/platform/connections/connector_info';
import { answerSalesforceMock, type SalesforceConnectorMockConfig } from '@ankoh/dashql/platform/connections/salesforce/salesforce_api_client_mock';
import { createDashQLCoreSetup } from '@ankoh/dashql/platform/node/node_core';
import type { OAuthState } from '@ankoh/dashql/platform/oauth_types';
import { Logger } from '@ankoh/dashql/platform/logger/logger';
import { fetchAgentSession } from '@ankoh/dashql/platform/session/agent_session_protocol';
import { createNodePlatform } from '@ankoh/dashql/runtime/node/node_platform';
import { createRuntime } from '@ankoh/dashql/runtime/runtime';

import { ConnectAuth, coreLoginRuntime } from './connect_auth.js';
import { RELAYED_TOKEN, RelayedConnections } from './run_relay.js';
import { startSessionServer } from './session_server.js';
import { testFiles } from './test_process.js';

const setupCore = createDashQLCoreSetup();
const CONNECTION_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
/// The tenant of Data Cloud that the exchange names
const TENANT = 'https://tenant.c360a.example';

/// A logger that keeps nothing
class QuietLogger extends Logger {
    public destroy(): void { }

    protected flushPendingRecords(): void {
        this.pendingRecords = [];
    }
}

/// The JWT of Data Cloud: its claims are no secret, its signature is
const DATA_CLOUD_JWT = (() => {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${part({ alg: 'RS256' })}.${part({ exp: Math.floor(Date.now() / 1000) + 7200, audienceTenantId: 'tenant-1' })}.real-signature`;
})();

/// The Hyper of the tenant answers every query with one row, like the mock of the app. It records the auth of the
/// requests, null for a request to another origin.
function answerTenant(input: URL | Request | string, init: RequestInit | undefined, authorizations: Array<string | null>): Response | null {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== TENANT) return null;
    authorizations.push(new Headers(init?.headers).get('authorization'));
    return answerSalesforceMock({} as SalesforceConnectorMockConfig, url) as Response | null;
}

/// The login API of a Salesforce org: the code exchange, the user info and the exchange for the Data Cloud token
class FakeSalesforce {
    readonly requests: Array<{ path: string; authorization: string | undefined; form: URLSearchParams }> = [];
    private server: Server | null = null;

    get instanceUrl(): string {
        return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    }

    async start(): Promise<void> {
        this.server = createServer((request, response) => {
            let body = '';
            request.on('data', chunk => { body += chunk; });
            request.on('end', () => {
                const path = new URL(request.url!, this.instanceUrl).pathname;
                this.requests.push({ path, authorization: request.headers.authorization, form: new URLSearchParams(body) });
                const json = (status: number, value: object) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
                if (path === '/services/oauth2/token') {
                    return json(200, { access_token: 'real-core', refresh_token: 'real-refresh', instance_url: this.instanceUrl, id: `${this.instanceUrl}/id/org/user`, token_type: 'Bearer', issued_at: String(Date.now()) });
                }
                if (path === '/services/oauth2/userinfo') {
                    if (request.headers.authorization !== 'Bearer real-core') return json(401, { error: 'invalid_token' });
                    return json(200, { preferred_username: 'ann@org', email: 'ann@org.example' });
                }
                if (path === '/services/a360/token') {
                    return json(200, { access_token: DATA_CLOUD_JWT, instance_url: 'tenant.c360a.example', token_type: 'Bearer', issued_token_type: 'urn:ietf:params:oauth:token-type:jwt' });
                }
                json(404, { error: 'not_found' });
            });
        });
        await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
    }

    async stop(): Promise<void> {
        await new Promise(resolve => this.server?.close(resolve));
    }
}

describe('the relay of dashql connect', () => {
    let salesforce: FakeSalesforce;

    beforeEach(async () => {
        salesforce = new FakeSalesforce();
        await salesforce.start();
    });
    afterEach(async () => {
        await salesforce.stop();
    });

    it('logs in to Salesforce through the tab and sets the connection of a run up with stand-ins', async () => {
        const params = { salesforce: { instanceUrl: salesforce.instanceUrl, appConsumerKey: 'key', appConsumerSecret: '', login: '' } };
        // The process of dashql connect reaches the tenant, its login and its relay
        const tenant: Array<string | null> = [];
        const send = async (input: URL | Request | string, init?: RequestInit) => answerTenant(input, init, tenant) ?? await fetch(input, init);
        const auth = new ConnectAuth({
            runtime: async flow => await coreLoginRuntime(await setupCore('test'), flow, { fetch: send }),
            listen: async () => { throw new Error('Salesforce redirects to the redirect page of the app'); },
        });
        const server = await startSessionServer({ harness: 'claude', folder: testFiles([]), session: '51010', auth, fetch: send as typeof fetch });
        const base = `http://127.0.0.1:${server.port}`;
        try {
            // The tab says how its redirect page hands the login back
            const oauth = { redirect: 'https://dashql.app/oauth.html', redirectVariant: 'WEB_OPENER_FLOW', redirectCallbackUrl: 'http://localhost:9002/oauth.html', flavor: null };
            const put = await fetchAgentSession(`${base}/v1/connections/${server.token}`, { method: 'PUT', body: JSON.stringify({ connections: [{ connectionId: CONNECTION_ID, name: 'Data 360' }], oauth }) });
            expect(put.status).toBe(204);

            // The runtime of the run, wired like dashql run in a session
            const relayed = new RelayedConnections({ endpoint: base, token: server.token });
            const core = await setupCore('test');
            const platform = await createNodePlatform({ logger: new QuietLogger(), storage: null, core, oauthFlow: relayed.oauthFlow() });
            const run = createRuntime({ ...platform, http: relayed.http(), catalogLoader: false });
            run.createConnection({ connectorType: ConnectorType.SALESFORCE_DATA_CLOUD, setupParams: params.salesforce, params: params as ConnectionParams, active: false }, CONNECTION_ID);

            const login = relayed.login(CONNECTION_ID, 'Data 360', params);
            // The tab shows the login and opens the authorization page, the redirect page hands the callback to the tab
            await vi.waitFor(() => expect(server.state().logins).toHaveLength(1), { timeout: 20_000 });
            const shown = server.state().logins![0];
            expect(shown).toMatchObject({ connectionId: CONNECTION_ID, name: 'Data 360', kind: 'redirect' });
            const authorization = new URL(shown.url);
            expect(authorization.origin + authorization.pathname).toBe(`${salesforce.instanceUrl}/services/oauth2/authorize`);
            expect(authorization.searchParams.get('redirect_uri')).toBe('https://dashql.app/oauth.html');
            const state = JSON.parse(Buffer.from(authorization.searchParams.get('state')!, 'base64url').toString('utf8')) as OAuthState;
            expect(state).toMatchObject({ flowId: shown.flowId, flowVariant: 'WEB_OPENER_FLOW', callbackUrl: 'http://localhost:9002/oauth.html' });
            const answered = await fetchAgentSession(`${base}/v1/login/${server.token}/${CONNECTION_ID}`, { method: 'POST', body: JSON.stringify({ oauthRedirect: { state, code: 'code1' } }) });
            expect(answered.status).toBe(204);
            expect(await login).toEqual({ principal: 'ann@org' });

            // The process of dashql connect exchanged the code with its verifier, once
            const exchanges = salesforce.requests.filter(request => request.path === '/services/oauth2/token');
            expect(exchanges).toHaveLength(1);
            expect(exchanges[0].form.get('code')).toBe('code1');
            expect(exchanges[0].form.get('code_verifier')).not.toBeNull();
            salesforce.requests.length = 0;

            // The run sets the connection up with the stand-ins, its user info goes through the relay with the real token
            const outcome = await run.setupConnection(CONNECTION_ID, { oauthRedirect: 'https://dashql.app/oauth.html' });
            expect(outcome).toMatchObject({ status: 'succeeded' });
            expect(salesforce.requests.map(request => [request.path, request.authorization])).toEqual([['/services/oauth2/userinfo', 'Bearer real-core']]);
            // The probes of both health checks reached the tenant with the real token, the one of the run through the
            // relay, which handed the status of the query back
            expect(tenant).toEqual([`Bearer ${DATA_CLOUD_JWT}`, `Bearer ${DATA_CLOUD_JWT}`]);
            const secrets = JSON.stringify(run.module.revealConnectionSecrets(CONNECTION_ID));
            expect(secrets).toContain(RELAYED_TOKEN);
            for (const secret of ['real-core', 'real-refresh', 'real-signature']) expect(secrets).not.toContain(secret);

            // The relay reaches the instance and the tenant of the login, nothing else
            const relay = (url: string) => fetchAgentSession(`${base}/v1/relay/${server.token}/${CONNECTION_ID}`, { headers: { 'X-DashQL-Url': url } });
            expect((await relay('https://elsewhere.example/')).status).toBe(403);
            expect((await relay(`${salesforce.instanceUrl}/services/oauth2/userinfo`)).status).toBe(200);
            run.destroy();
        } finally {
            await server.close();
        }
    });
});
