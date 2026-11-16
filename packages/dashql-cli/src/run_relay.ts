// A run in a session of `dashql connect` reaches a Trino connection with OAuth through the process of `dashql connect`
// (docs/wip/agent_session.md, "Logins go through the page"): that process logs in and keeps the token, the run never
// sees it. The runtime of the run sets the connection up as usual: its OAuth flow gets a stand-in code once the
// process has a token, the token request gets a stand-in token with the account of the real one, which keys the cached
// results, and every request to the endpoint of the connection goes through the relay, which puts the real token in.
import type { OAuthFlow } from '@ankoh/dashql/platform/oauth/oauth_flow';
import type { ClientOptions, HttpClient, HttpFetchResult } from '@ankoh/dashql/platform/platform/http/http_client';

/// The fields of the OAuth settings of a Trino connection that a run matches its requests with
interface TrinoOAuth {
    authorizationUrl: string;
    tokenUrl: string;
    clientId: string;
}

/// The OAuth settings of the params of a Trino connection, null for a connection without OAuth
function trinoOAuthOf(params: unknown): TrinoOAuth | null {
    const auth = (params as { trino?: { auth?: { authType?: unknown; oauth?: Record<string, unknown> } } })?.trino?.auth;
    if (auth?.authType !== 'AUTH_OAUTH' || auth.oauth == null) return null;
    const text = (key: string) => typeof auth.oauth?.[key] === 'string' ? auth.oauth[key] as string : '';
    return { authorizationUrl: text('authorizationUrl'), tokenUrl: text('tokenUrl'), clientId: text('clientId') };
}

/// The stand-in of the code and the token of a relayed connection, the relay replaces the token
export const RELAYED_TOKEN = 'dashql-relay';
/// How often a run asks again while a login waits for the user
const LOGIN_RETRY_MS = 500;

/// The address of the server of a session
export interface SessionServerAddress {
    endpoint: string;
    token: string;
}

interface Relayed {
    connectionId: string;
    /// The origin of the endpoint of the connection
    origin: string;
    oauth: TrinoOAuth;
    principal: string | null;
}

/// The connections of a run that go through the relay of the server of the session
export class RelayedConnections {
    private readonly relayed = new Map<string, Relayed>();

    constructor(private readonly server: SessionServerAddress, private readonly send: typeof fetch = fetch) { }

    /// Does a connection log in with OAuth? Those go through the relay.
    static relays(params: unknown): boolean {
        return trinoOAuthOf(params) != null;
    }

    /// Have the process of `dashql connect` log in to a connection, the user logs in through the tab if it has no
    /// token. Resolves once it has one, rejects with why it has none.
    async login(connectionId: string, name: string, endpoint: string, params: unknown, signal?: AbortSignal): Promise<void> {
        const oauth = trinoOAuthOf(params);
        if (oauth == null) throw new Error('the connection does not log in with OAuth');
        const url = new URL(`/v1/auth/${encodeURIComponent(this.server.token)}/${encodeURIComponent(connectionId)}`, this.server.endpoint);
        const body = JSON.stringify({ name, endpoint, params });
        while (true) {
            signal?.throwIfAborted();
            const response = await this.send(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, signal });
            const answer = await response.json().catch(() => ({})) as { principal?: string | null; error?: string };
            if (response.status === 200) {
                this.relayed.set(connectionId, { connectionId, origin: new URL(endpoint).origin, oauth, principal: answer.principal ?? null });
                return;
            }
            if (response.status !== 202) throw new Error(answer.error ?? `the session answered the login with ${response.status}`);
            await new Promise(resolve => setTimeout(resolve, LOGIN_RETRY_MS));
        }
    }

    /// The OAuth flow of the runtime of the run: a relayed connection logged in already, its login gets a stand-in code
    oauthFlow(): OAuthFlow {
        return {
            redirectVariant: 'NATIVE_LINK_FLOW',
            redirectCallbackUrl: null,
            debugMode: false,
            flavor: null,
            authorizeWithRedirectPage: () => Promise.reject(new Error('dashql run logs in to Trino connections with OAuth only')),
            authorizeWithLoopback: async (authorizationUrl: URL) => {
                if (this.relayedOfAuthorization(authorizationUrl) == null) throw new Error('dashql run logs in through the tab of DashQL only');
                return { code: RELAYED_TOKEN, state: authorizationUrl.searchParams.get('state') ?? '' };
            },
        };
    }

    /// The HTTP client of the runtime of the run: the stand-in token for the token request of a relayed connection, the
    /// relay for its requests, fetch for the rest
    http(): HttpClient {
        return {
            fetch: async (input: URL | Request | string, init?: RequestInit & ClientOptions): Promise<HttpFetchResult> => {
                const url = new URL(input instanceof Request ? input.url : input.toString());
                const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
                const tokenOf = method === 'POST' ? [...this.relayed.values()].find(relayed => sameUrl(relayed.oauth.tokenUrl, url)) : undefined;
                if (tokenOf != null) {
                    const token = { access_token: RELAYED_TOKEN, token_type: 'Bearer', ...(tokenOf.principal == null ? {} : { sub: tokenOf.principal }) };
                    return new Response(JSON.stringify(token), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                const relayed = [...this.relayed.values()].find(relayed => relayed.origin === url.origin);
                if (relayed == null) return await this.send(input, init);
                const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
                headers.delete('authorization');
                headers.set('X-DashQL-Url', url.toString());
                const relay = new URL(`/v1/relay/${encodeURIComponent(this.server.token)}/${encodeURIComponent(relayed.connectionId)}`, this.server.endpoint);
                return await this.send(relay, { ...init, method, headers });
            },
        };
    }

    private relayedOfAuthorization(url: URL): Relayed | null {
        const clientId = url.searchParams.get('client_id');
        return [...this.relayed.values()].find(relayed => relayed.oauth.clientId === clientId && sameUrl(relayed.oauth.authorizationUrl, new URL(`${url.origin}${url.pathname}`))) ?? null;
    }
}

/// Do two URLs name the same resource, without their queries?
function sameUrl(text: string, url: URL): boolean {
    try {
        const other = new URL(text);
        return other.origin === url.origin && other.pathname === url.pathname;
    } catch {
        return false;
    }
}
