// The logins of the connections of a session of `dashql connect` (docs/wip/agent_session.md, "Logins go through the
// page"): the process of `dashql connect` logs in to a connection through the tab and keeps its channel. The tokens and
// the passwords never leave the process: `dashql run` reaches the connection through the relay of the server, which
// adds the auth of the channel to the requests.
//
// The login is the setup of the core in a runtime of this process: the PKCE challenge, the authorization URL, the
// code exchange, the account of the token and its refresh. This file adds only what Node and the tab do for it:
// - Trino with OAuth: the OAuth flow listens on the loopback address of the callback URL and hands the authorization
//   URL to the tab, which opens it when the user clicks.
// - Salesforce: the tab opens the authorization URL, the redirect page of the app hands the callback to the tab and
//   the tab sends it to the server. The tab says beforehand how its redirect page works (`AgentSessionOAuth`).
// - Trino with basic auth: the tab sends the user and the password of its connection, the channel connects with them.
import http from 'node:http';

import type * as dashql from '@ankoh/dashql';
import type { ConnectionParams } from '@ankoh/dashql/platform/connections/connection_params';
import { ConnectorType } from '@ankoh/dashql/platform/connections/connector_info';
import type { OAuthFlow, OAuthLoopbackCallback } from '@ankoh/dashql/platform/oauth/oauth_flow';
import type { OAuthRedirectData, OAuthState } from '@ankoh/dashql/platform/oauth/oauth_types';
import type { HttpClient } from '@ankoh/dashql/platform/platform/http/http_client';
import { Logger } from '@ankoh/dashql/platform/platform/logger/logger';
import type {
    AgentSessionLogin,
    AgentSessionLoginAnswer,
    AgentSessionLoginKind,
    AgentSessionOAuth,
} from '@ankoh/dashql/platform/session/agent_session_state';
import { createNodePlatform } from '@ankoh/dashql/runtime/node/node_platform';
import { createRuntime } from '@ankoh/dashql/runtime/runtime';

/// How long a login waits for the user
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/// The connection that a run needs a login for
export interface LoginConnection {
    connectionId: string;
    /// The label of the connection, the tab shows it
    name: string;
    /// The params of the connection as the workbook of the run has them: `{ trino }`, `{ salesforce }` or `{ dbcom }`
    params: unknown;
}

/// The auth of a connection as it goes with its requests
export interface ConnectionAuthorization {
    /// The auth headers by name, by the origin of the endpoint: the relay reaches only these origins
    endpoints: Record<string, Record<string, string>>;
    /// The account that keys the cached results
    principal: string | null;
    /// The responses of the token requests of the login by their URL, with a stand-in token: a run sets the connection
    /// up with them
    standIns: Record<string, unknown>;
}

/// The params of a connection by the field of its connector, null for none
function connectorParams(params: unknown, connector: 'trino' | 'salesforce' | 'dbcom'): Record<string, unknown> | null {
    const value = (params as Record<string, unknown> | null)?.[connector];
    return value != null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/// How a connection logs in through the tab, null for one that needs no login of the tab
export function loginKind(params: unknown): AgentSessionLoginKind | null {
    const trino = connectorParams(params, 'trino');
    if (trino != null) {
        const auth = trino.auth as { authType?: unknown; oauth?: unknown } | undefined;
        if (auth?.authType === 'AUTH_OAUTH') return auth.oauth != null ? 'loopback' : null;
        return 'credentials';
    }
    if (connectorParams(params, 'salesforce') != null || connectorParams(params, 'dbcom') != null) return 'redirect';
    return null;
}

/// How the logins set a connection up
export interface LoginSetupOptions {
    /// The redirect page of the app that a Salesforce login returns to
    oauthRedirect?: string;
    /// The params that the channel connects with and that are never kept, e.g. the password of the tab
    channelParams?: ConnectionParams;
}

/// The part of the runtime that the logins use, the tests pass their own
export interface LoginRuntime {
    /// Register a connection with its params, once
    createConnection(connection: LoginConnection): void;
    /// Set a connection up, its OAuth flow is the one that the runtime was created with. `channelParams` are params
    /// that the channel connects with and that are never kept, e.g. the password of the tab.
    setupConnection(connectionId: string, options: LoginSetupOptions): Promise<{ status: string; message?: string | null }>;
    /// The auth of the channel of a connection with fresh tokens, null without a channel or a token
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

/// The flow id in the state of an authorization URL of Salesforce, the base64url JSON of an `OAuthState`
export function flowIdOf(authorizationUrl: URL): string | null {
    try {
        const state = JSON.parse(Buffer.from(authorizationUrl.searchParams.get('state') ?? '', 'base64url').toString('utf8')) as OAuthState;
        return typeof state?.flowId === 'string' && state.flowId.length > 0 ? state.flowId : null;
    } catch {
        return null;
    }
}

/// A login that waits for an answer of the tab
interface WaitingAnswer {
    /// Takes an answer of the tab, false if it doesn't fit the login
    take: (answer: AgentSessionLoginAnswer) => boolean;
}

/// The logins of the connections of a session: one channel per connection in the runtime of the logins, one login at
/// a time, so the OAuth flow knows the connection it is for
export class ConnectAuth {
    private runtime: Promise<LoginRuntime> | null = null;
    private readonly connections = new Map<string, LoginConnection>();
    private readonly logins = new Map<string, AgentSessionLogin>();
    private readonly waiting = new Map<string, WaitingAnswer>();
    private readonly listeners = new Set<(logins: AgentSessionLogin[]) => void>();
    private readonly closed = new AbortController();
    /// How the redirect page of the tab hands back a Salesforce login, the tab says it with its connections
    private oauth: AgentSessionOAuth | null = null;
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

    /// The tab says how its redirect page hands back a Salesforce login
    setOAuth(oauth: AgentSessionOAuth | null): void {
        this.oauth = oauth;
    }

    /// The tab answers a login that waits: the callback of the redirect page or the credentials of its connection.
    /// False if no login of the connection waits for such an answer.
    answer(connectionId: string, answer: AgentSessionLoginAnswer): boolean {
        return this.waiting.get(connectionId)?.take(answer) ?? false;
    }

    /// A connection that a run logged in to, the relay serves only these
    connection(connectionId: string): LoginConnection | null {
        return this.connections.get(connectionId) ?? null;
    }

    /// The auth of a connection with fresh tokens: the channel that the runtime has, or a new login through the tab
    async authorization(connection: LoginConnection): Promise<ConnectionAuthorization> {
        const kind = loginKind(connection.params);
        if (kind == null) throw new Error(`${connection.name} logs in without the tab of DashQL`);
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
            const options: LoginSetupOptions = {};
            if (kind === 'credentials') options.channelParams = await this.credentials(connection);
            if (kind === 'redirect') {
                if (this.oauth == null) throw new Error(`the tab of DashQL did not say how it logs in to ${connection.name}, connect the tab again`);
                options.oauthRedirect = this.oauth.redirect;
            }
            this.current = connection;
            try {
                const outcome = await runtime.setupConnection(connection.connectionId, options);
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

    /// Show a login in the tab once `start` waits for it, until its answer arrives. `start` resolves when it waits,
    /// e.g. once the listener of the callback is up, a failure to wait fails before the tab shows the login. Rejects
    /// when the login takes too long or the session ends.
    private async showLogin<T>(login: AgentSessionLogin, signal: AbortSignal, start: (signal: AbortSignal) => Promise<{ answer: Promise<T> }>): Promise<T> {
        const timeout = AbortSignal.timeout(LOGIN_TIMEOUT_MS);
        const { answer } = await start(AbortSignal.any([signal, timeout, this.closed.signal]));
        this.logins.set(login.connectionId, login);
        this.publish();
        try {
            return await answer;
        } catch (error) {
            throw timeout.aborted ? new Error(`nobody logged in to ${login.name} in the tab of DashQL in time`) : error;
        } finally {
            this.logins.delete(login.connectionId);
            this.publish();
        }
    }

    /// Wait for an answer of the tab that `take` accepts, `take` returns null for one that doesn't fit
    private async waitForAnswer<T>(connectionId: string, signal: AbortSignal, take: (answer: AgentSessionLoginAnswer) => T | null): Promise<{ answer: Promise<T> }> {
        const answer = new Promise<T>((resolve, reject) => {
            const abort = () => {
                this.waiting.delete(connectionId);
                reject(new Error('the login was cancelled'));
            };
            if (signal.aborted) return abort();
            signal.addEventListener('abort', abort, { once: true });
            this.waiting.set(connectionId, {
                take: answer => {
                    const value = take(answer);
                    if (value == null) return false;
                    this.waiting.delete(connectionId);
                    signal.removeEventListener('abort', abort);
                    resolve(value);
                    return true;
                },
            });
        });
        return { answer };
    }

    /// The params that a Trino connection with basic auth connects with: the user and the password of the tab
    private async credentials(connection: LoginConnection): Promise<ConnectionParams> {
        const login: AgentSessionLogin = { connectionId: connection.connectionId, name: connection.name, kind: 'credentials', url: '' };
        const basic = await this.showLogin(login, this.closed.signal, signal => this.waitForAnswer(connection.connectionId, signal, answer =>
            'basic' in answer && typeof answer.basic?.username === 'string' && typeof answer.basic.secret === 'string' ? answer.basic : null));
        const trino = connectorParams(connection.params, 'trino') ?? {};
        return { trino: { ...trino, auth: { authType: 'AUTH_BASIC', basic: { username: basic.username, secret: basic.secret } } } } as ConnectionParams;
    }

    /// The OAuth flow of the runtime: Trino redirects to the listener of this process, Salesforce to the redirect page
    /// of the app, which hands the callback to the tab
    private oauthFlow(): OAuthFlow {
        // The tab says how its redirect page works, the setup reads it when it starts
        const oauth = () => this.oauth;
        return {
            get redirectVariant() { return oauth()?.redirectVariant ?? 'WEB_OPENER_FLOW'; },
            get redirectCallbackUrl() { return oauth()?.redirectCallbackUrl ?? null; },
            debugMode: false,
            get flavor() { return oauth()?.flavor ?? null; },
            authorizeWithRedirectPage: async (authorizationUrl, accepts, signal) => {
                const connection = this.current;
                if (connection == null) throw new Error('dashql connect logs in when a run needs a connection');
                const flowId = flowIdOf(authorizationUrl);
                if (flowId == null) throw new Error('the authorization URL has no flow');
                const login: AgentSessionLogin = { connectionId: connection.connectionId, name: connection.name, kind: 'redirect', url: authorizationUrl.toString(), flowId };
                return await this.showLogin(login, signal, all => this.waitForAnswer<OAuthRedirectData>(connection.connectionId, all, answer =>
                    'oauthRedirect' in answer && answer.oauthRedirect != null && accepts(answer.oauthRedirect) ? answer.oauthRedirect : null));
            },
            authorizeWithLoopback: async (authorizationUrl, callbackUrl, signal) => {
                const connection = this.current;
                if (connection == null) throw new Error('dashql connect logs in when a run needs a connection');
                const login: AgentSessionLogin = { connectionId: connection.connectionId, name: connection.name, kind: 'loopback', url: authorizationUrl.toString() };
                const params = await this.showLogin(login, signal, async all => ({ answer: (await this.host.listen(callbackUrl, all)).callback }));
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

/// The connector of the params of a connection that logs in through the tab
function connectorOf(params: unknown): { connectorType: ConnectorType; field: 'trino' | 'salesforce' | 'dbcom'; params: Record<string, unknown> } | null {
    for (const [field, connectorType] of [['trino', ConnectorType.TRINO], ['salesforce', ConnectorType.SALESFORCE_DATA_CLOUD], ['dbcom', ConnectorType.DBCOM]] as const) {
        const value = connectorParams(params, field);
        if (value != null) return { connectorType, field, params: value };
    }
    return null;
}

/// The runtime of the logins over the core: a runtime without storage that holds the connections of the session. It
/// sends its requests with the HTTP client of Node unless it is given one.
export async function coreLoginRuntime(core: dashql.DashQL, oauthFlow: OAuthFlow, http?: HttpClient): Promise<LoginRuntime> {
    const platform = await createNodePlatform({ logger: new QuietLogger(), storage: null, core, oauthFlow });
    const runtime = createRuntime({ ...platform, http: http ?? platform.http, catalogLoader: false });
    return {
        createConnection: connection => {
            const connector = connectorOf(connection.params);
            if (connector == null) throw new Error(`${connection.name} is no connection that dashql connect logs in to`);
            const params = { [connector.field]: connector.params } as unknown as ConnectionParams;
            runtime.createConnection({ connectorType: connector.connectorType, setupParams: connector.params, params, active: false }, connection.connectionId);
        },
        setupConnection: (connectionId, options) => runtime.setupConnection(connectionId, options),
        authorization: async connectionId => {
            const authorization = await runtime.module.connectionAuthorization(connectionId);
            if (authorization == null) return null;
            return { endpoints: authorization.endpoints, principal: authorization.principal ?? null, standIns: authorization.standIns };
        },
    };
}
