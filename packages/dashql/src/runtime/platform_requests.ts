import type * as core from '../core/index.js';

import type { HttpClient } from '../platform/http_client.js';
import type { OAuthFlow, OAuthFlowEvent } from '../platform/oauth_flow.js';
import type { OAuthRedirectData } from '../platform/oauth_types.js';
import { generatePKCEChallenge } from '../platform/utils/pkce.js';

/// The requests of the runtime to the platform that run until they end or the runtime aborts them: the fetches with
/// the HTTP client and the OAuth flows of the setups (`http` and `oauth` of the platform of the module). A login may
/// bring a flow of its own. `abortAll` ends them when the runtime goes.
export class PlatformRequests {
    /// The fetches by id
    private readonly fetches = new Map<number, AbortController>();
    /// The OAuth flows that run, by id
    private readonly flows = new Map<number, AbortController>();
    /// The flows of single logins by the id of their setup
    private readonly loginFlows = new Map<string, OAuthFlow>();

    constructor(private readonly platform: { readonly http?: HttpClient | null; readonly oauthFlow?: OAuthFlow | null }) { }

    /// Use a flow of its own for the login of a setup until it settled
    async withLoginFlow<T>(setupId: string, flow: OAuthFlow | null | undefined, login: () => Promise<T>): Promise<T> {
        if (flow != null) this.loginFlows.set(setupId, flow);
        try {
            return await login();
        } finally {
            this.loginFlows.delete(setupId);
        }
    }

    /// Abort every request that runs
    abortAll(): void {
        const reason = new DOMException('The runtime was destroyed', 'AbortError');
        for (const abort of this.fetches.values()) abort.abort(reason);
        for (const abort of this.flows.values()) abort.abort(reason);
        this.fetches.clear();
        this.flows.clear();
    }

    /// The HTTP client of the platform for the module, the platform reads it when a request starts
    http(): core.RuntimePlatform['http'] {
        return {
            fetch: (id, request) => this.fetch(id, request),
            abort: id => {
                this.fetches.get(id)?.abort(new DOMException('The request was cancelled', 'AbortError'));
            },
        };
    }

    /// Send a request of the runtime with the HTTP client of the platform
    private async fetch(id: number, request: core.RuntimeHttpRequest): Promise<core.RuntimeHttpResponse> {
        const http = this.platform.http;
        if (http == null) throw new Error('the platform has no HTTP client');
        const abort = new AbortController();
        this.fetches.set(id, abort);
        try {
            const response = await http.fetch(request.url, {
                method: request.method,
                headers: request.headers,
                body: request.body ?? undefined,
                signal: abort.signal,
                sensitive: request.sensitive === true,
            });
            const headers: [string, string][] = [];
            response.headers.forEach((value, name) => headers.push([name, value]));
            const body = new Uint8Array(await response.arrayBuffer());
            return { status: response.status, statusText: response.statusText, headers, body };
        } catch (error) {
            // fetch names the reason of a failed request only in the cause, e.g. a refused connection, and the
            // runtime keeps only the message
            const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
            if (error instanceof Error && cause instanceof Error) {
                throw new Error(`${error.message}: ${cause.message}`);
            }
            throw error;
        } finally {
            this.fetches.delete(id);
        }
    }

    /// The OAuth flows of the setups over the flow of the platform, a login may bring a flow of its own
    oauth(): core.RuntimeOAuth {
        const flowOf = (setupId: string) => this.loginFlows.get(setupId) ?? this.platform.oauthFlow ?? null;
        const events = (onEvent: (event: string) => void) => (event: OAuthFlowEvent) => {
            try {
                onEvent(event);
            } catch {
                // The flow ended, a late event changes nothing
            }
        };
        const run = async <T>(setupId: string, id: number, authorize: (flow: OAuthFlow, signal: AbortSignal) => Promise<T>): Promise<T> => {
            const flow = flowOf(setupId);
            if (flow == null) throw new Error('The platform has no OAuth flow');
            const abort = new AbortController();
            this.flows.set(id, abort);
            try {
                return await authorize(flow, abort.signal);
            } finally {
                this.flows.delete(id);
            }
        };
        return {
            pkce: () => generatePKCEChallenge(),
            flowInfo: setupId => {
                const flow = flowOf(setupId);
                return {
                    redirectVariant: flow?.redirectVariant ?? 'WEB_OPENER_FLOW',
                    redirectCallbackUrl: flow?.redirectCallbackUrl ?? null,
                    debugMode: flow?.debugMode ?? false,
                    flavor: flow?.flavor ?? null,
                };
            },
            authorizeWithLoopback: (setupId, id, url, callbackUrl, onEvent) => run(setupId, id, (flow, signal) =>
                flow.authorizeWithLoopback(new URL(url), callbackUrl, signal, events(onEvent))),
            authorizeWithRedirectPage: (setupId, id, url, flowId, onEvent) => run(setupId, id, (flow, signal) => {
                const accepts = (callback: OAuthRedirectData) => callback.state?.flowId === flowId;
                return flow.authorizeWithRedirectPage(new URL(url), accepts, signal, events(onEvent));
            }),
            abort: id => {
                this.flows.get(id)?.abort(new DOMException('The connection setup was cancelled', 'AbortError'));
            },
        };
    }
}
