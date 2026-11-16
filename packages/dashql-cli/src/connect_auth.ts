// The logins of the connections of a session of `dashql connect` (docs/wip/agent_session.md, "Logins go through the
// page"): the process of `dashql connect` logs in to a Trino connection with OAuth and keeps its channel. The token
// never leaves the process: `dashql run` reaches the connection through the relay of the server, which adds the auth
// of the channel to the requests.
//
// The login is the Trino setup of the core in a runtime of this process: the PKCE challenge, the authorization URL, the
// code exchange, the account of the token and its refresh. This file adds only what Node does for it: the OAuth flow
// listens on the loopback address of the callback URL and hands the authorization URL to the tab, which opens it when
// the user clicks.
import http from 'node:http';

import type * as dashql from '@ankoh/dashql';
import type { TrinoConnectionParams } from '@ankoh/dashql-jsonschema/connection.js';
import { ConnectorType } from '@ankoh/dashql/platform/connections/connector_info';
import type { OAuthFlow, OAuthLoopbackCallback } from '@ankoh/dashql/platform/oauth/oauth_flow';
import { Logger } from '@ankoh/dashql/platform/platform/logger/logger';
import type { AgentSessionLogin } from '@ankoh/dashql/platform/session/agent_session_state';
import { createNodePlatform } from '@ankoh/dashql/runtime/node/node_platform';
import { createRuntime } from '@ankoh/dashql/runtime/runtime';

/// How long a login waits for the user
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/// The connection that a run needs a login for
export interface LoginConnection {
    connectionId: string;
    /// The label of the connection, the tab shows it
    name: string;
    /// The origin of the endpoint of the connection, the relay forwards only to it
    endpoint: string;
    /// The params of the connection, `{ trino: { endpoint, auth: { authType: 'AUTH_OAUTH', oauth } } }`
    params: unknown;
}

/// The auth of a connection as it goes with a request
export interface ConnectionAuthorization {
    /// The auth headers by name
    headers: Record<string, string>;
    /// The account of the token, it keys the cached results
    principal: string | null;
}

/// Does a connection log in to Trino with OAuth? Those go through the process of `dashql connect`.
export function isTrinoOAuth(params: unknown): boolean {
    const trino = (params as { trino?: { auth?: { authType?: unknown; oauth?: unknown } } })?.trino;
    return trino?.auth?.authType === 'AUTH_OAUTH' && trino.auth.oauth != null;
}

/// The part of the runtime that the logins use, the tests pass their own
export interface LoginRuntime {
    /// Register a connection with its params, once
    createConnection(connection: LoginConnection): void;
    /// Set a connection up, its OAuth flow is the one that the runtime was created with
    setupConnection(connectionId: string): Promise<{ status: string; message?: string | null }>;
    /// The auth of the channel of a connection with a fresh token, null without a channel
    authorization(connectionId: string): Promise<ConnectionAuthorization | null>;
}

/// What the logins take from the process
export interface ConnectAuthHost {
    /// Create the runtime of the logins with an OAuth flow
    runtime: (oauthFlow: OAuthFlow) => Promise<LoginRuntime>;
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

/// The logins of the connections of a session: one channel per connection in the runtime of the logins, one login at
/// a time, so the OAuth flow knows the connection it is for
export class ConnectAuth {
    private runtime: Promise<LoginRuntime> | null = null;
    private readonly connections = new Map<string, LoginConnection>();
    private readonly logins = new Map<string, AgentSessionLogin>();
    private readonly listeners = new Set<(logins: AgentSessionLogin[]) => void>();
    private readonly closed = new AbortController();
    /// The logins run one after the other
    private queue: Promise<unknown> = Promise.resolve();
    /// The connection whose setup runs
    private current: LoginConnection | null = null;

    constructor(private readonly host: ConnectAuthHost) { }

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

    /// The auth of a connection with a fresh token: the channel that the runtime has, or a new login that the user
    /// opens in the tab
    async authorization(connection: LoginConnection): Promise<ConnectionAuthorization> {
        const runtime = await this.runtimeOf();
        if (!this.connections.has(connection.connectionId)) {
            runtime.createConnection(connection);
            this.connections.set(connection.connectionId, connection);
        }
        const current = await runtime.authorization(connection.connectionId);
        if (current != null) return current;
        const login = this.queue.then(async () => {
            // A login of another run of the same connection may have ended meanwhile
            const ready = await runtime.authorization(connection.connectionId);
            if (ready != null) return ready;
            this.current = connection;
            try {
                const outcome = await runtime.setupConnection(connection.connectionId);
                if (outcome.status !== 'succeeded') throw new Error(outcome.message ?? `the setup of ${connection.name} did not succeed`);
            } finally {
                this.current = null;
            }
            const authorization = await runtime.authorization(connection.connectionId);
            if (authorization == null) throw new Error(`the setup of ${connection.name} left no channel`);
            return authorization;
        });
        this.queue = login.catch(() => { });
        return await login;
    }

    /// Stop the logins that wait
    close(): void {
        this.closed.abort();
    }

    private runtimeOf(): Promise<LoginRuntime> {
        this.runtime ??= this.host.runtime(this.oauthFlow());
        return this.runtime;
    }

    private publish(): void {
        const logins = this.pending();
        for (const listener of this.listeners) listener(logins);
    }

    /// The OAuth flow of the runtime: the tab opens the authorization URL, the identity provider redirects to the
    /// listener of this process
    private oauthFlow(): OAuthFlow {
        return {
            redirectVariant: 'NATIVE_LINK_FLOW',
            redirectCallbackUrl: null,
            debugMode: false,
            flavor: null,
            authorizeWithRedirectPage: () => Promise.reject(new Error('dashql connect logs in to Trino connections with OAuth only')),
            authorizeWithLoopback: async (authorizationUrl, callbackUrl, signal) => {
                const connection = this.current;
                if (connection == null) throw new Error('dashql connect logs in when a run needs a connection');
                const timeout = AbortSignal.timeout(LOGIN_TIMEOUT_MS);
                const { callback } = await this.host.listen(callbackUrl, AbortSignal.any([signal, timeout, this.closed.signal]));
                this.logins.set(connection.connectionId, { connectionId: connection.connectionId, name: connection.name, url: authorizationUrl.toString() });
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
                const answer: OAuthLoopbackCallback = {};
                for (const [key, field] of [['code', 'code'], ['state', 'state'], ['error', 'error'], ['error_description', 'errorDescription']] as const) {
                    const value = params.get(key);
                    if (value != null) answer[field] = value;
                }
                return answer;
            },
        };
    }
}

/// A logger that keeps nothing, the runtime of the logins runs in the terminal of the harness
class QuietLogger extends Logger {
    public destroy(): void { }

    protected flushPendingRecords(): void {
        this.pendingRecords = [];
    }
}

/// The runtime of the logins over the core: a runtime without storage that holds the Trino connections of the session
export async function coreLoginRuntime(core: dashql.DashQL, oauthFlow: OAuthFlow): Promise<LoginRuntime> {
    const runtime = createRuntime({ ...await createNodePlatform({ logger: new QuietLogger(), storage: null, core, oauthFlow }), catalogLoader: false });
    return {
        createConnection: connection => {
            const trino = (connection.params as { trino: TrinoConnectionParams }).trino;
            runtime.createConnection({ connectorType: ConnectorType.TRINO, setupParams: trino, params: { trino }, active: false }, connection.connectionId);
        },
        setupConnection: connectionId => runtime.setupConnection(connectionId),
        authorization: async connectionId => {
            const authorization = await runtime.module.connectionAuthorization(connectionId);
            // A connection that never logged in has a channel without a token
            if (authorization == null || authorization.headers.Authorization == null) return null;
            return { headers: authorization.headers, principal: authorization.principal ?? null };
        },
    };
}
