import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

import { ConnectAuth, listenForCallback, readTokenResponse, trinoOAuthOf, type ConnectAuthHost, type LoginConnection } from './connect_auth.js';

const OAUTH = { authorizationUrl: 'https://idp.example/authorize', tokenUrl: 'https://idp.example/token', clientId: 'dashql', callbackUrl: '', scopes: [] };
const CONNECTION: LoginConnection = { connectionId: 'c1', name: 'Trino prod', endpoint: 'https://trino.example', oauth: OAUTH };

/// A JWT with a subject, unsigned: the account of a token is read without checking it
const jwt = (sub: string) => `e30.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.sig`;

/// A host whose identity provider answers the token requests of the test, and whose callback the test sends
function fakeHost() {
    let now = 1_000_000;
    const requests: URLSearchParams[] = [];
    let callback: ((params: URLSearchParams) => void) | null = null;
    let answer: (fields: URLSearchParams) => object = () => ({ access_token: 'a1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r1', id_token: jwt('ann') });
    const host: ConnectAuthHost = {
        now: () => now,
        fetch: (async (_url: string, init: RequestInit) => {
            const fields = new URLSearchParams(String(init.body));
            requests.push(fields);
            return new Response(JSON.stringify(answer(fields)), { status: 200 });
        }) as typeof fetch,
        listen: async (_callbackUrl, signal) => ({
            callback: new Promise<URLSearchParams>((resolve, reject) => {
                callback = resolve;
                signal.addEventListener('abort', () => reject(new Error('the login was cancelled')));
            }),
        }),
    };
    return {
        host,
        requests,
        advance: (ms: number) => { now += ms; },
        respond: (next: (fields: URLSearchParams) => object) => { answer = next; },
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
    it('logs in through the tab with PKCE and keeps the token', async () => {
        const fake = fakeHost();
        const auth = new ConnectAuth(fake.host);
        const logins: number[] = [];
        auth.onLogins(pending => logins.push(pending.length));
        const token = auth.token(CONNECTION);
        // Two runs at once share the login
        const second = auth.token(CONNECTION);
        const url = await shownLogin(auth);
        expect(auth.pending()[0]).toMatchObject({ connectionId: 'c1', name: 'Trino prod' });
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            client_id: 'dashql',
            redirect_uri: 'http://localhost:56512/Callback',
            response_type: 'code',
            code_challenge_method: 'S256',
            scope: 'openid email profile offline_access',
        });
        fake.callback({ code: 'code1', state: url.searchParams.get('state')! });
        expect(await token).toEqual({ accessToken: 'a1', tokenType: 'Bearer', refreshToken: 'r1', expiresAt: 1_000_000 + 3_600_000, principal: 'ann' });
        expect(await second).toEqual(await token);
        expect(logins).toEqual([1, 0]);
        // The code goes with the verifier of the challenge
        const [exchange] = fake.requests;
        expect(Object.fromEntries(exchange)).toMatchObject({ grant_type: 'authorization_code', client_id: 'dashql', code: 'code1', redirect_uri: 'http://localhost:56512/Callback' });
        expect(createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
        // A valid token is kept
        expect(await auth.token(CONNECTION)).toEqual(await token);
        expect(fake.requests).toHaveLength(1);
        expect(auth.connection('c1')).toEqual(CONNECTION);
    });

    it('refreshes a token before it expires and logs in again when the refresh fails', async () => {
        const fake = fakeHost();
        const auth = new ConnectAuth(fake.host);
        const first = auth.token(CONNECTION);
        fake.callback({ code: 'code1', state: (await shownLogin(auth)).searchParams.get('state')! });
        await first;
        fake.advance(3_600_000 - 30_000);
        fake.respond(() => ({ access_token: 'a2', expires_in: 3600 }));
        const refreshed = await auth.token(CONNECTION);
        expect(Object.fromEntries(fake.requests[1])).toEqual({ grant_type: 'refresh_token', client_id: 'dashql', refresh_token: 'r1' });
        // The server sent no new refresh token, the old one stays
        expect(refreshed).toMatchObject({ accessToken: 'a2', refreshToken: 'r1' });

        fake.advance(3_600_000);
        fake.respond(fields => fields.get('grant_type') === 'refresh_token' ? {} : { access_token: 'a3' });
        const again = auth.token(CONNECTION);
        fake.callback({ code: 'code2', state: (await shownLogin(auth)).searchParams.get('state')! });
        expect((await again).accessToken).toBe('a3');
    });

    it('refuses a callback of another request or with an error, and gives up when the session ends', async () => {
        const fake = fakeHost();
        const auth = new ConnectAuth(fake.host);
        const wrong = auth.token(CONNECTION);
        await shownLogin(auth);
        fake.callback({ code: 'code1', state: 'other' });
        await expect(wrong).rejects.toThrow('the login answered another request');
        const denied = auth.token(CONNECTION);
        await shownLogin(auth);
        fake.callback({ error: 'access_denied', error_description: 'The user said no' });
        await expect(denied).rejects.toThrow('the login failed: The user said no');
        const waiting = auth.token(CONNECTION);
        await shownLogin(auth);
        auth.close();
        await expect(waiting).rejects.toThrow('the login was cancelled');
        expect(auth.pending()).toEqual([]);
        expect(fake.requests).toEqual([]);
    });

    it('reads the OAuth settings of a connection and the account of a token like the runtime', () => {
        const oauth = { authorizationUrl: 'a', tokenUrl: 't', clientId: 'c', scopes: ['openid', 7] };
        expect(trinoOAuthOf({ trino: { endpoint: 'e', auth: { authType: 'AUTH_OAUTH', oauth } } })).toEqual({ authorizationUrl: 'a', tokenUrl: 't', clientId: 'c', callbackUrl: '', scopes: ['openid'] });
        expect(trinoOAuthOf({ trino: { auth: { authType: 'AUTH_BASIC' } } })).toBeNull();
        expect(trinoOAuthOf({ hyper: {} })).toBeNull();
        expect(readTokenResponse({ access_token: 'x', sub: 'bob', id_token: jwt('ann'), expires_in: 0 }, 5)).toEqual({ accessToken: 'x', tokenType: 'Bearer', refreshToken: null, expiresAt: null, principal: 'bob' });
        expect(readTokenResponse({ access_token: 'x', id_token: 'broken' }, 5).principal).toBeNull();
        expect(() => readTokenResponse({ token_type: 'Bearer' }, 5)).toThrow('no access token');
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
