import { createServer } from 'node:net';

import type { OAuthFlow } from '@ankoh/dashql/platform/oauth/oauth_flow';

import { ConnectAuth, isTrinoOAuth, listenForCallback, type ConnectAuthHost, type ConnectionAuthorization, type LoginConnection } from './connect_auth.js';

const OAUTH = { authorizationUrl: 'https://idp.example/authorize', tokenUrl: 'https://idp.example/token', clientId: 'dashql' };
const PARAMS = { trino: { endpoint: 'https://trino.example', auth: { authType: 'AUTH_OAUTH', oauth: OAUTH } } };
const CONNECTION: LoginConnection = { connectionId: 'c1', name: 'Trino prod', endpoint: 'https://trino.example', params: PARAMS };

/// A runtime whose setup drives the OAuth flow like the Trino setup of the core: the authorization URL with a state,
/// the callback with the code, a channel with the token
function fakeHost() {
    let flow: OAuthFlow | null = null;
    const channels = new Map<string, ConnectionAuthorization>();
    const created: string[] = [];
    const setups: string[] = [];
    let callback: ((params: URLSearchParams) => void) | null = null;
    const host: ConnectAuthHost = {
        runtime: async oauthFlow => {
            flow = oauthFlow;
            return {
                createConnection: connection => { created.push(connection.connectionId); },
                setupConnection: async connectionId => {
                    setups.push(connectionId);
                    const state = `state-${setups.length}`;
                    const answer = await flow!.authorizeWithLoopback(new URL(`${OAUTH.authorizationUrl}?client_id=dashql&state=${state}`), 'http://localhost:56512/Callback', new AbortController().signal, () => { });
                    if (answer.error != null) return { status: 'failed', message: `OAuth failed: ${answer.errorDescription ?? answer.error}` };
                    if (answer.state !== state) return { status: 'failed', message: 'OAuth callback state does not match the authorization request' };
                    channels.set(connectionId, { headers: { Authorization: `Bearer token-${answer.code}` }, principal: 'ann' });
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
        expect(auth.pending()[0]).toEqual({ connectionId: 'c1', name: 'Trino prod', url: url.toString() });
        fake.callback({ code: 'code1', state: url.searchParams.get('state')! });
        expect(await first).toEqual({ headers: { Authorization: 'Bearer token-code1' }, principal: 'ann' });
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

    it('knows the connections that log in to Trino with OAuth', () => {
        expect(isTrinoOAuth(PARAMS)).toBe(true);
        expect(isTrinoOAuth({ trino: { auth: { authType: 'AUTH_BASIC' } } })).toBe(false);
        expect(isTrinoOAuth({ trino: { auth: { authType: 'AUTH_OAUTH' } } })).toBe(false);
        expect(isTrinoOAuth({ hyper: {} })).toBe(false);
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
