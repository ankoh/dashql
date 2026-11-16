// The logins of the connections of a session of `dashql connect` (docs/wip/agent_session.md, "Logins go through the
// page"): the process of `dashql connect` logs in to a Trino connection with OAuth, keeps the token and refreshes it.
// The token never leaves the process: `dashql run` reaches the connection through the relay of the server, which adds
// the token to the requests. The tab opens the login when the user clicks, the identity provider redirects to the
// loopback address of the connection, where this process listens.
//
// The authorization request, the token request and the account of a token mirror the Trino setup of the runtime
// (`trino/setup.rs`, `trino/protocol.rs` of dashql-core-runtime), the cache keys of the results of a run name the same
// account.
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

import type { AgentSessionLogin } from '@ankoh/dashql/platform/session/agent_session_state';

/// The redirect of the OAuth flow if the connection doesn't configure one, the one of the runtime
export const DEFAULT_OAUTH_CALLBACK_URL = 'http://localhost:56512/Callback';
/// The scopes of the OAuth flow if the connection doesn't configure any
export const DEFAULT_OAUTH_SCOPES = ['openid', 'email', 'profile', 'offline_access'];
/// How long a login waits for the user
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
/// A token is refreshed this long before it expires
const REFRESH_MARGIN_MS = 60 * 1000;

/// The OAuth settings of a Trino connection
export interface TrinoOAuth {
    authorizationUrl: string;
    tokenUrl: string;
    clientId: string;
    callbackUrl: string;
    scopes: string[];
}

/// The connection that a run needs a login for
export interface LoginConnection {
    connectionId: string;
    /// The label of the connection, the tab shows it
    name: string;
    /// The endpoint of the connection, the relay forwards only to it
    endpoint: string;
    oauth: TrinoOAuth;
}

/// A token of a connection
export interface ConnectionToken {
    accessToken: string;
    tokenType: string;
    refreshToken: string | null;
    expiresAt: number | null;
    /// The account that logged in, it keys the cached results
    principal: string | null;
}

/// The OAuth settings of the params of a Trino connection, `{ trino: { auth: { authType: 'AUTH_OAUTH', oauth } } }` or
/// the Trino params themselves; null for a connection without OAuth
export function trinoOAuthOf(params: unknown): TrinoOAuth | null {
    const trino = (params as { trino?: unknown })?.trino ?? params;
    const auth = (trino as { auth?: { authType?: unknown; oauth?: Record<string, unknown> } })?.auth;
    if (auth?.authType !== 'AUTH_OAUTH' || auth.oauth == null) return null;
    const text = (key: string) => typeof auth.oauth?.[key] === 'string' ? auth.oauth[key] as string : '';
    const scopes = Array.isArray(auth.oauth.scopes) ? auth.oauth.scopes.filter((scope): scope is string => typeof scope === 'string') : [];
    return { authorizationUrl: text('authorizationUrl'), tokenUrl: text('tokenUrl'), clientId: text('clientId'), callbackUrl: text('callbackUrl'), scopes };
}

/// The `sub` of a JWT, without checking its signature: the token response of the identity provider names the account
function jwtSubject(jwt: string): string | null {
    try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown };
        return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
    } catch {
        return null;
    }
}

/// The token of a token response, as the runtime reads it
export function readTokenResponse(body: unknown, now: number): ConnectionToken {
    const token = body as Record<string, unknown> | null;
    const text = (key: string) => typeof token?.[key] === 'string' && (token[key] as string).length > 0 ? token[key] as string : null;
    const accessToken = text('access_token');
    if (accessToken == null) throw new Error('the token response has no access token');
    const expiresIn = typeof token?.expires_in === 'number' && Number.isFinite(token.expires_in) && token.expires_in !== 0 ? token.expires_in : null;
    const idToken = text('id_token');
    return {
        accessToken,
        tokenType: text('token_type') ?? 'Bearer',
        refreshToken: text('refresh_token'),
        expiresAt: expiresIn == null ? null : now + expiresIn * 1000,
        principal: text('sub') ?? (idToken == null ? null : jwtSubject(idToken)),
    };
}

/// What the logins take from the process, the tests pass their own
export interface ConnectAuthHost {
    fetch: typeof fetch;
    now: () => number;
    /// Listen on the callback URL, resolves once the listener is up, with the first callback that comes in
    listen: (callbackUrl: string, signal: AbortSignal) => Promise<{ callback: Promise<URLSearchParams> }>;
}

/// Listen on the loopback address of a callback URL for the redirect of the identity provider
export function listenForCallback(callbackUrl: string, signal: AbortSignal): Promise<{ callback: Promise<URLSearchParams> }> {
    const url = new URL(callbackUrl);
    return new Promise((resolveListening, rejectListening) => {
        let resolveCallback: (params: URLSearchParams) => void = () => { };
        let rejectCallback: (error: Error) => void = () => { };
        const callback = new Promise<URLSearchParams>((resolve, reject) => {
            resolveCallback = resolve;
            rejectCallback = reject;
        });
        const server = http.createServer((request, response) => {
            const received = new URL(request.url ?? '/', url);
            if (received.pathname !== url.pathname) {
                response.writeHead(404).end();
                return;
            }
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                .end('<!doctype html><title>DashQL</title><p>DashQL got the login for the agent, you can close this window.</p>');
            close();
            resolveCallback(received.searchParams);
        });
        const close = () => {
            signal.removeEventListener('abort', abort);
            server.close();
        };
        const abort = () => {
            close();
            rejectCallback(new Error('the login was cancelled'));
        };
        signal.addEventListener('abort', abort, { once: true });
        server.once('error', error => {
            close();
            rejectListening((error as { code?: string }).code === 'EADDRINUSE'
                ? new Error(`the login redirects to ${url.host}, which another program listens on, e.g. the desktop app of DashQL`)
                : error);
        });
        server.listen(Number(url.port || 80), url.hostname === 'localhost' ? '127.0.0.1' : url.hostname, () => resolveListening({ callback }));
    });
}

/// The logins of the connections of a session: one token per connection, one login at a time per connection
export class ConnectAuth {
    private readonly tokens = new Map<string, ConnectionToken>();
    private readonly running = new Map<string, Promise<ConnectionToken>>();
    private readonly logins = new Map<string, AgentSessionLogin>();
    private readonly connections = new Map<string, LoginConnection>();
    private readonly listeners = new Set<(logins: AgentSessionLogin[]) => void>();
    private readonly closed = new AbortController();

    constructor(private readonly host: ConnectAuthHost = { fetch, now: () => Date.now(), listen: listenForCallback }) { }

    /// The logins that wait for the user, the tab shows them
    pending(): AgentSessionLogin[] {
        return [...this.logins.values()];
    }

    /// Hear when the logins that wait for the user change
    onLogins(listener: (logins: AgentSessionLogin[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /// A connection that a run logged in to, the relay forwards only to its endpoint
    connection(connectionId: string): LoginConnection | null {
        return this.connections.get(connectionId) ?? null;
    }

    /// A token of a connection that is valid for a while: the one that the process has, refreshed, or a new login
    async token(connection: LoginConnection): Promise<ConnectionToken> {
        this.connections.set(connection.connectionId, connection);
        const running = this.running.get(connection.connectionId);
        if (running != null) return await running;
        const token = this.tokens.get(connection.connectionId);
        const now = this.host.now();
        if (token != null && (token.expiresAt == null || token.expiresAt - REFRESH_MARGIN_MS > now)) return token;
        const next = (async () => {
            try {
                if (token?.refreshToken != null) {
                    try {
                        return await this.refresh(connection, token.refreshToken);
                    } catch {
                        // The refresh token expired, the user logs in again
                    }
                }
                return await this.login(connection);
            } finally {
                this.running.delete(connection.connectionId);
            }
        })();
        this.running.set(connection.connectionId, next);
        const fresh = await next;
        this.tokens.set(connection.connectionId, fresh);
        return fresh;
    }

    /// The token of a connection right now, null without one, e.g. for a request of the relay that came after the login
    current(connectionId: string): ConnectionToken | null {
        return this.tokens.get(connectionId) ?? null;
    }

    /// Stop the logins that wait
    close(): void {
        this.closed.abort();
    }

    private publish(): void {
        const logins = this.pending();
        for (const listener of this.listeners) listener(logins);
    }

    private async login(connection: LoginConnection): Promise<ConnectionToken> {
        const { oauth } = connection;
        const callbackUrl = oauth.callbackUrl || DEFAULT_OAUTH_CALLBACK_URL;
        const verifier = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const state = randomBytes(16).toString('base64url');
        const url = new URL(oauth.authorizationUrl);
        const fields: [string, string][] = [
            ['client_id', oauth.clientId],
            ['redirect_uri', callbackUrl],
            ['response_type', 'code'],
            ['code_challenge', challenge],
            ['code_challenge_method', 'S256'],
            ['scope', (oauth.scopes.length > 0 ? oauth.scopes : DEFAULT_OAUTH_SCOPES).join(' ')],
            ['state', state],
        ];
        for (const [key, value] of fields) url.searchParams.set(key, value);
        const timeout = AbortSignal.timeout(LOGIN_TIMEOUT_MS);
        const signal = AbortSignal.any([timeout, this.closed.signal]);
        const { callback } = await this.host.listen(callbackUrl, signal);
        this.logins.set(connection.connectionId, { connectionId: connection.connectionId, name: connection.name, url: url.toString() });
        this.publish();
        let params: URLSearchParams;
        try {
            params = await callback;
        } catch (error) {
            throw timeout.aborted ? new Error(`nobody logged in to ${connection.name} in the tab of DashQL in time`) : error;
        } finally {
            this.logins.delete(connection.connectionId);
            this.publish();
        }
        const error = params.get('error');
        if (error != null) throw new Error(`the login failed: ${params.get('error_description') ?? error}`);
        if (params.get('state') !== state) throw new Error('the login answered another request');
        const code = params.get('code');
        if (code == null || code.length === 0) throw new Error('the login sent no code');
        return await this.requestToken(oauth, {
            grant_type: 'authorization_code',
            client_id: oauth.clientId,
            code,
            redirect_uri: callbackUrl,
            code_verifier: verifier,
        });
    }

    private async refresh(connection: LoginConnection, refreshToken: string): Promise<ConnectionToken> {
        const token = await this.requestToken(connection.oauth, { grant_type: 'refresh_token', client_id: connection.oauth.clientId, refresh_token: refreshToken });
        // A server that sends no new refresh token keeps the old one valid
        return { ...token, refreshToken: token.refreshToken ?? refreshToken };
    }

    private async requestToken(oauth: TrinoOAuth, fields: Record<string, string>): Promise<ConnectionToken> {
        const response = await this.host.fetch(oauth.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams(fields).toString(),
        });
        // The body may echo credentials, it stays out of the error
        if (!response.ok) throw new Error(`the token request failed: ${response.status}`);
        return readTokenResponse(await response.json(), this.host.now());
    }
}
