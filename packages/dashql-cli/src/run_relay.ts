// A run in a session of `dashql connect` reaches a connection that logs in through the tab (Trino with OAuth or basic
// auth, Salesforce) through the process of `dashql connect` (docs/wip/agent_session.md, "Logins go through the page"):
// that process logs in and keeps the tokens and the passwords, the run never sees them. The runtime of the run sets the
// connection up as usual: its OAuth flow gets a stand-in code once the process has logged in, its token requests get
// the stand-in responses of the process, with a token that authorizes nothing, and every request to an endpoint of the
// connection goes through the relay, which puts the real auth in.
import type { OAuthFlow } from '@ankoh/dashql/platform/oauth_flow';
import type { OAuthRedirectData, OAuthState } from '@ankoh/dashql/platform/oauth_types';
import type { ClientOptions, HttpClient, HttpFetchResult } from '@ankoh/dashql/platform/http_client';

import { flowIdOf, loginKind } from './connect_auth.js';

/// The stand-in of the code of a relayed login, the stand-in token of the core is the same text
export const RELAYED_TOKEN = 'dashql-relay';
/// How often a run asks again while a login waits for the user
const LOGIN_RETRY_MS = 500;

/// The address of the server of a session
export interface SessionServerAddress {
    endpoint: string;
    token: string;
}

/// The server of the session has no logins, e.g. `dashql session serve` without `dashql connect`
export class NoSessionLogins extends Error { }

/// Where a login authorizes: the OAuth flow of the run answers an authorization there with a stand-in code
interface Authorize {
    origin: string;
    clientId: string;
}

interface Relayed {
    connectionId: string;
    /// The origins of the endpoints that the relay reaches for the connection
    origins: Set<string>;
    /// The stand-in responses of the token requests of the login, by the URL of the request without its query
    standIns: Map<string, unknown>;
    authorize: Authorize | null;
}

/// A URL without its query and fragment
function resource(url: URL): string {
    return `${url.origin}${url.pathname}`;
}

/// Where the login of a connection authorizes, null for one without OAuth
function authorizeOf(params: unknown): Authorize | null {
    const of = (url: unknown, clientId: unknown): Authorize | null => {
        try {
            return typeof url === 'string' && typeof clientId === 'string' ? { origin: new URL(url).origin, clientId } : null;
        } catch {
            return null;
        }
    };
    const value = params as {
        trino?: { auth?: { authType?: unknown; oauth?: { authorizationUrl?: unknown; clientId?: unknown } } };
        salesforce?: { instanceUrl?: unknown; appConsumerKey?: unknown };
        dbcom?: { instanceUrl?: unknown; appConsumerKey?: unknown };
    } | null;
    const oauth = value?.trino?.auth?.authType === 'AUTH_OAUTH' ? value.trino.auth.oauth : undefined;
    if (oauth != null) return of(oauth.authorizationUrl, oauth.clientId);
    const salesforce = value?.salesforce ?? value?.dbcom;
    return salesforce == null ? null : of(salesforce.instanceUrl, salesforce.appConsumerKey);
}

/// The connections of a run that go through the relay of the server of the session
export class RelayedConnections {
    private readonly relayed = new Map<string, Relayed>();

    constructor(private readonly server: SessionServerAddress, private readonly send: typeof fetch = fetch) { }

    /// Does a connection log in through the tab? Those go through the relay.
    static relays(params: unknown): boolean {
        return loginKind(params) != null;
    }

    /// Have the process of `dashql connect` log in to a connection, the user logs in through the tab if it has no
    /// channel. Resolves with the account of the login once the process has one, rejects with why it has none, with
    /// `NoSessionLogins` if the server logs in to nothing.
    async login(connectionId: string, name: string, params: unknown, signal?: AbortSignal): Promise<{ principal: string | null }> {
        if (!RelayedConnections.relays(params)) throw new Error('the connection does not log in through the tab');
        const url = new URL(`/v1/auth/${encodeURIComponent(this.server.token)}/${encodeURIComponent(connectionId)}`, this.server.endpoint);
        const body = JSON.stringify({ name, params });
        while (true) {
            signal?.throwIfAborted();
            const response = await this.send(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, signal });
            const answer = await response.json().catch(() => ({})) as {
                principal?: string | null;
                origins?: unknown;
                standIns?: Record<string, unknown>;
                error?: string;
            };
            if (response.status === 200) {
                const standIns = new Map<string, unknown>();
                for (const [target, standIn] of Object.entries(answer.standIns ?? {})) {
                    try {
                        standIns.set(resource(new URL(target)), standIn);
                    } catch {
                        // A token request that the run can't send
                    }
                }
                const origins = new Set(Array.isArray(answer.origins) ? answer.origins.filter((origin): origin is string => typeof origin === 'string') : []);
                this.relayed.set(connectionId, { connectionId, origins, standIns, authorize: authorizeOf(params) });
                return { principal: answer.principal ?? null };
            }
            if (response.status === 404) throw new NoSessionLogins(answer.error ?? 'the session has no logins');
            if (response.status !== 202) throw new Error(answer.error ?? `the session answered the login with ${response.status}`);
            await new Promise(resolve => setTimeout(resolve, LOGIN_RETRY_MS));
        }
    }

    /// The OAuth flow of the runtime of the run: a relayed connection logged in already, its login gets a stand-in code
    oauthFlow(): OAuthFlow {
        return {
            redirectVariant: 'WEB_OPENER_FLOW',
            redirectCallbackUrl: null,
            debugMode: false,
            flavor: null,
            authorizeWithRedirectPage: async (authorizationUrl: URL, accepts: (callback: OAuthRedirectData) => boolean) => {
                if (this.relayedOfAuthorization(authorizationUrl) == null) throw new Error('dashql run logs in through the tab of DashQL only');
                // The state of the flow comes back as the redirect page would hand it back
                const state = JSON.parse(Buffer.from(authorizationUrl.searchParams.get('state') ?? '', 'base64url').toString('utf8')) as OAuthState;
                const callback: OAuthRedirectData = { state, code: RELAYED_TOKEN };
                if (flowIdOf(authorizationUrl) == null || !accepts(callback)) throw new Error('the login of the run has no flow');
                return callback;
            },
            authorizeWithLoopback: async (authorizationUrl: URL) => {
                if (this.relayedOfAuthorization(authorizationUrl) == null) throw new Error('dashql run logs in through the tab of DashQL only');
                return { code: RELAYED_TOKEN, state: authorizationUrl.searchParams.get('state') ?? '' };
            },
        };
    }

    /// The HTTP client of the runtime of the run: the stand-in responses for the token requests of a relayed login, the
    /// relay for the requests to its endpoints, fetch for the rest
    http(): HttpClient {
        return {
            fetch: async (input: URL | Request | string, init?: RequestInit & ClientOptions): Promise<HttpFetchResult> => {
                const url = new URL(input instanceof Request ? input.url : input.toString());
                const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
                if (method === 'POST') {
                    for (const relayed of this.relayed.values()) {
                        const standIn = relayed.standIns.get(resource(url));
                        if (standIn !== undefined) return new Response(JSON.stringify(standIn), { status: 200, headers: { 'Content-Type': 'application/json' } });
                    }
                }
                const relayed = [...this.relayed.values()].find(relayed => relayed.origins.has(url.origin));
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
        return [...this.relayed.values()].find(relayed => relayed.authorize != null && relayed.authorize.clientId === clientId && relayed.authorize.origin === url.origin) ?? null;
    }
}
