import { createServer } from 'node:net';

import type { OAuthFlow } from '@ankoh/dashql/platform/oauth/oauth_flow';

import { ConnectAuth, flowIdOf, listenForCallback, loginKind, type ConnectAuthHost, type ConnectionAuthorization, type LoginConnection, type LoginSetupOptions } from './connect_auth.js';

const OAUTH = { authorizationUrl: 'https://idp.example/authorize', tokenUrl: 'https://idp.example/token', clientId: 'dashql' };
const PARAMS = { trino: { endpoint: 'https://trino.example', auth: { authType: 'AUTH_OAUTH', oauth: OAUTH } } };
const CONNECTION: LoginConnection = { connectionId: 'c1', name: 'Trino prod', params: PARAMS };
const BASIC: LoginConnection = { connectionId: 'c2', name: 'Trino dev', params: { trino: { endpoint: 'https://trino.example', auth: { authType: 'AUTH_BASIC', basic: { username: 'ann', secret: '' } } } } };
const SALESFORCE: LoginConnection = { connectionId: 'c3', name: 'Data 360', params: { salesforce: { instanceUrl: 'https://org.my.salesforce.com', appConsumerKey: 'key' } } };
const OAUTH_SETTINGS = { redirect: 'https://dashql.app/oauth.html', redirectVariant: 'WEB_OPENER_FLOW' as const, redirectCallbackUrl: 'http://localhost:9002/oauth.html', flavor: null };

/// The authorization URL of a Salesforce login with the state of its flow
function salesforceAuthorization(flowId: string): URL {
    const state = Buffer.from(JSON.stringify({ flowId, flowVariant: 'WEB_OPENER_FLOW' })).toString('base64url');
    return new URL(`https://org.my.salesforce.com/services/oauth2/authorize?client_id=key&state=${state}`);
}

/// A runtime whose setup drives the OAuth flow like the Trino setup of the core: the authorization URL with a state,
/// the callback with the code, a channel with the token
function fakeHost() {
    let flow: OAuthFlow | null = null;
    const channels = new Map<string, ConnectionAuthorization>();
    const created: string[] = [];
    const setups: string[] = [];
    let callback: ((params: URLSearchParams) => void) | null = null;
    const options: LoginSetupOptions[] = [];
    const host: ConnectAuthHost = {
        runtime: async oauthFlow => {
            flow = oauthFlow;
            return {
                createConnection: connection => { created.push(connection.connectionId); },
                setupConnection: async (connectionId, setup) => {
                    setups.push(connectionId);
                    options.push(setup);
                    if (connectionId === BASIC.connectionId) {
                        channels.set(connectionId, { endpoints: { 'https://trino.example': { Authorization: 'Basic tab' } }, principal: 'ann', standIns: {} });
                        return { status: 'succeeded' };
                    }
                    if (connectionId === SALESFORCE.connectionId) {
                        const flowId = `flow-${setups.length}`;
                        const redirect = await flow!.authorizeWithRedirectPage(salesforceAuthorization(flowId), callback => callback.state?.flowId === flowId, new AbortController().signal, () => { });
                        channels.set(connectionId, { endpoints: { 'https://org.my.salesforce.com': { Authorization: `Bearer core-${redirect.code}` } }, principal: 'ann@org', standIns: { 'https://org.my.salesforce.com/services/oauth2/token': { access_token: 'dashql-relay' } } });
                        return { status: 'succeeded' };
                    }
                    const state = `state-${setups.length}`;
                    const answer = await flow!.authorizeWithLoopback(new URL(`${OAUTH.authorizationUrl}?client_id=dashql&state=${state}`), 'http://localhost:56512/Callback', new AbortController().signal, () => { });
                    if (answer.error != null) return { status: 'failed', message: `OAuth failed: ${answer.errorDescription ?? answer.error}` };
                    if (answer.state !== state) return { status: 'failed', message: 'OAuth callback state does not match the authorization request' };
                    channels.set(connectionId, { endpoints: { 'https://trino.example': { Authorization: `Bearer token-${answer.code}` } }, principal: 'ann', standIns: {} });
                    return { status: 'succeeded' };
                },
                authorization: async connectionId => channels.get(connectionId) ?? null,
            };
        },
        listen: async (_callbackUrl, signal) => ({
            callback: new Promise<URLSearchParams>((resolve, reject) => {
                callback = resolve;
                signal.addEventListener('abort', () => reject(new Error('the login was cancelled')));
            }),
        }),
    };
    return {
        host,
        created,
        setups,
        options,
        flow: () => flow!,
        /// The user logs in in the tab: the identity provider redirects with the code
        callback: (params: Record<string, string>) => callback!(new URLSearchParams(params)),
    };
}

/// Wait until the login shows in the tab, returns its authorization URL
async function shownLogin(auth: ConnectAuth): Promise<URL> {
    await vi.waitFor(() => expect(auth.pending()).toHaveLength(1));
    return new URL(auth.pending()[0].url);
}

describe('the logins of dashql connect', () => {
    it('logs in with the setup of the runtime, the tab opens the login', async () => {
        const fake = fakeHost();
        const auth = new ConnectAuth(fake.host);
        const logins: number[] = [];
        auth.onLogins(pending => logins.push(pending.length));
        const first = auth.authorization(CONNECTION);
        // Two runs at once share the login
        const second = auth.authorization(CONNECTION);
        const url = await shownLogin(auth);
        expect(auth.pending()[0]).toEqual({ connectionId: 'c1', name: 'Trino prod', kind: 'loopback', url: url.toString() });
        fake.callback({ code: 'code1', state: url.searchParams.get('state')! });
        expect(await first).toEqual({ endpoints: { 'https://trino.example': { Authorization: 'Bearer token-code1' } }, principal: 'ann', standIns: {} });
        expect(await second).toEqual(await first);
        expect(logins).toEqual([1, 0]);
        // The channel of the runtime serves the next runs, the connection was created once
        expect(await auth.authorization(CONNECTION)).toEqual(await first);
        expect(fake.created).toEqual(['c1']);
        expect(fake.setups).toEqual(['c1']);
        expect(auth.connection('c1')).toEqual(CONNECTION);
    });

    it('fails a login that the user denied or that answers another request, and gives up when the session ends', async () => {
        const fake = fakeHost();
        const auth = new ConnectAuth(fake.host);
        const denied = auth.authorization(CONNECTION);
        await shownLogin(auth);
        fake.callback({ error: 'access_denied', error_description: 'The user said no' });
        await expect(denied).rejects.toThrow('OAuth failed: The user said no');
        const wrong = auth.authorization(CONNECTION);
        await shownLogin(auth);
        fake.callback({ code: 'code1', state: 'other' });
        await expect(wrong).rejects.toThrow('OAuth callback state does not match');
        const waiting = auth.authorization(CONNECTION);
        await shownLogin(auth);
        auth.close();
        await expect(waiting).rejects.toThrow('the login was cancelled');
        expect(auth.pending()).toEqual([]);
    });

    it('sets up a Trino connection with basic auth with the password that the tab sends, which stays in the process', async () => {
        const fake = fakeHost();
        const auth = new ConnectAuth(fake.host);
        const logged = auth.authorization(BASIC);
        await vi.waitFor(() => expect(auth.pending()).toEqual([{ connectionId: 'c2', name: 'Trino dev', kind: 'credentials', url: '' }]));
        // Another answer than credentials doesn't fit, neither does a connection that waits for none
        expect(auth.answer('c2', { oauthRedirect: { state: { flowId: 'f', flowVariant: 'WEB_OPENER_FLOW', debugMode: false } } })).toBe(false);
        expect(auth.answer('c9', { basic: { username: 'ann', secret: 'pw' } })).toBe(false);
        expect(auth.answer('c2', { basic: { username: 'ann', secret: 'pw' } })).toBe(true);
        expect(await logged).toEqual({ endpoints: { 'https://trino.example': { Authorization: 'Basic tab' } }, principal: 'ann', standIns: {} });
        expect(auth.pending()).toEqual([]);
        expect(fake.options).toEqual([{ channelParams: { trino: { endpoint: 'https://trino.example', auth: { authType: 'AUTH_BASIC', basic: { username: 'ann', secret: 'pw' } } } } }]);
    });

    it('logs in to Salesforce with the redirect page of the tab, which hands the callback on', async () => {
        const fake = fakeHost();
        const auth = new ConnectAuth(fake.host);
        // Without the OAuth settings of the tab there is no redirect page to log in with
        await expect(auth.authorization(SALESFORCE)).rejects.toThrow('the tab of DashQL did not say how it logs in to Data 360');
        auth.setOAuth(OAUTH_SETTINGS);
        expect(fake.flow().redirectVariant).toBe('WEB_OPENER_FLOW');
        expect(fake.flow().redirectCallbackUrl).toBe('http://localhost:9002/oauth.html');
        const logged = auth.authorization(SALESFORCE);
        await vi.waitFor(() => expect(auth.pending()).toHaveLength(1));
        const login = auth.pending()[0];
        expect(login).toEqual({ connectionId: 'c3', name: 'Data 360', kind: 'redirect', url: salesforceAuthorization('flow-1').toString(), flowId: 'flow-1' });
        expect(fake.options).toEqual([{ oauthRedirect: 'https://dashql.app/oauth.html' }]);
        // The callback of another flow doesn't fit
        const state = { flowId: 'other', flowVariant: 'WEB_OPENER_FLOW' as const, debugMode: false };
        expect(auth.answer('c3', { oauthRedirect: { state, code: 'code0' } })).toBe(false);
        expect(auth.answer('c3', { oauthRedirect: { state: { ...state, flowId: 'flow-1' }, code: 'code1' } })).toBe(true);
        expect(await logged).toMatchObject({ endpoints: { 'https://org.my.salesforce.com': { Authorization: 'Bearer core-code1' } }, principal: 'ann@org' });
        expect(auth.pending()).toEqual([]);
    });

    it('knows the connections that log in through the tab', () => {
        expect(loginKind(PARAMS)).toBe('loopback');
        expect(loginKind({ trino: { auth: { authType: 'AUTH_BASIC' } } })).toBe('credentials');
        expect(loginKind({ trino: { endpoint: 'https://trino.example' } })).toBe('credentials');
        expect(loginKind({ trino: { auth: { authType: 'AUTH_OAUTH' } } })).toBeNull();
        expect(loginKind(SALESFORCE.params)).toBe('redirect');
        expect(loginKind({ dbcom: { instanceUrl: 'https://org.my.salesforce.com' } })).toBe('redirect');
        expect(loginKind({ hyper: {} })).toBeNull();
        expect(flowIdOf(salesforceAuthorization('f1'))).toBe('f1');
        expect(flowIdOf(new URL('https://org.my.salesforce.com/services/oauth2/authorize?state=nonsense'))).toBeNull();
    });

    it('listens for the redirect on the loopback address of the callback URL', async () => {
        const probe = createServer();
        await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', () => resolve()));
        const port = (probe.address() as { port: number }).port;
        await new Promise<void>(resolve => probe.close(() => resolve()));

        const { callback } = await listenForCallback(`http://localhost:${port}/Callback`, new AbortController().signal);
        expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
        const page = await fetch(`http://127.0.0.1:${port}/Callback?code=c1&state=s1`);
        expect(await page.text()).toContain('you can close this window');
        expect(Object.fromEntries(await callback)).toEqual({ code: 'c1', state: 's1' });
        // The listener is gone with the first callback
        await expect(fetch(`http://127.0.0.1:${port}/Callback`)).rejects.toThrow();

        // A port that another program listens on fails at once
        const holder = new AbortController();
        const taken = await listenForCallback(`http://localhost:${port}/Callback`, holder.signal);
        await expect(listenForCallback(`http://localhost:${port}/Callback`, new AbortController().signal)).rejects.toThrow('another program listens on');
        // The session ends, the login waits no more
        holder.abort();
        await expect(taken.callback).rejects.toThrow('the login was cancelled');
    });
});
