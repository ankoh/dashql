import type * as core from '@ankoh/dashql-core';

import type { OAuthFlow, OAuthFlowEvent } from '../oauth/oauth_flow.js';
import type { OAuthRedirectData } from '../oauth/oauth_types.js';
import type { HttpClient } from '../platform/http/http_client.js';
import { LoggableException, type Logger } from '../platform/logger/logger.js';
import { loadRuntimeCore } from '../storage/workbook_format.js';
import { generatePKCEChallenge } from '../utils/pkce.js';

// The setups of the connectors and the health checks run in the Rust runtime
// (`packages/dashql-core-runtime/src/connection_setup/`, see docs/wip/core_runtime.md). A run has a host of its own: it
// applies the actions of the setup to the connection, runs the OAuth flow of the platform, sends the requests over the
// HTTP client of the platform and keeps the channels of the setup. The channels are the objects that the query
// executor reads today, the host creates them from what the setup describes.

/// What a run needs of the platform, the rest of the host throws
export interface SetupRunOptions {
    logger: Logger;
    /// Sends the requests of the setup, e.g. the token requests of OAuth
    http?: HttpClient | null;
    /// Takes the user through the authorization page
    oauthFlow?: OAuthFlow | null;
    /// The signal that cancels the run
    signal: AbortSignal;
    /// Apply an action of the setup to the connection, the channel of an action is the object of the host
    dispatch: (action: core.ConnectionSetupAction, channel: unknown) => void;
    /// Keep a Trino channel
    openTrinoChannel?: (description: core.ConnectionSetupTrinoChannel) => unknown;
    /// Connect the Hyper channel of a Salesforce connection
    connectSalesforceChannel?: (description: core.ConnectionSetupSalesforceChannel) => Promise<unknown>;
    /// Connect a Hyper channel of a kind with its params
    connectHyperChannel?: (kind: 'embedded' | 'grpc' | 'http', params: any) => Promise<unknown>;
    /// The token of the link to a Hyper that the page holds
    hyperLinkToken?: () => string | null;
    /// Close a channel that the setup doesn't hand out
    closeChannel?: (channel: unknown) => void;
    /// Run the probe query of a health check on a channel
    runProbe?: (channel: unknown, query: string, metadata: { title: string | null; issuer: string | null }) => Promise<boolean>;
}

/// A run of a setup on a host, with the channels and the error of the host
export class SetupRun {
    /// The channels of the run by id
    readonly channels = new Map<number, unknown>();
    /// What a step of the host failed with last, the caller gets it back
    hostError: unknown = null;
    private nextChannel = 1;
    private readonly fetchAborts = new Map<number, AbortController>();

    constructor(readonly options: SetupRunOptions) { }

    /// Register a channel of the caller, its id
    registerChannel(channel: unknown): number {
        const id = this.nextChannel++;
        this.channels.set(id, channel);
        return id;
    }

    /// Keep what a step failed with
    private async kept<T>(step: () => Promise<T>): Promise<T> {
        try {
            return await step();
        } catch (error) {
            this.hostError = error;
            throw error;
        }
    }

    /// The host of the run
    host(): core.ConnectionSetupHost {
        const { logger, signal } = this.options;
        const notAvailable = (what: string) => new Error(`The setup has no ${what}`);
        const events = (onEvent: (event: string) => void) => (event: OAuthFlowEvent) => {
            try {
                onEvent(event);
            } catch {
                // The flow ended, a late event changes nothing
            }
        };
        return {
            now: () => Date.now(),
            setTimer: (ms, callback) => setTimeout(callback, ms),
            clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
            log: (level, message, details, target) => logger[level](message, JSON.parse(details), target),
            fetch: async (requestId, request) => {
                const http = this.options.http;
                if (http == null) throw notAvailable('HTTP client');
                const abort = new AbortController();
                const stop = () => abort.abort(signal.reason);
                signal.addEventListener('abort', stop, { once: true });
                this.fetchAborts.set(requestId, abort);
                try {
                    const response = await http.fetch(request.url, {
                        method: request.method,
                        headers: request.headers,
                        body: request.body ?? undefined,
                        signal: abort.signal,
                    });
                    const headers: [string, string][] = [];
                    response.headers.forEach((value, name) => headers.push([name, value]));
                    const body = new Uint8Array(await response.arrayBuffer());
                    return { status: response.status, statusText: response.statusText, headers, body };
                } finally {
                    signal.removeEventListener('abort', stop);
                    this.fetchAborts.delete(requestId);
                }
            },
            abortFetch: requestId => {
                this.fetchAborts.get(requestId)?.abort(new DOMException('The request was cancelled', 'AbortError'));
            },
            generatePkce: () => generatePKCEChallenge(),
            randomId: () => crypto.randomUUID(),
            oauthFlowInfo: () => {
                const flow = this.options.oauthFlow;
                return {
                    redirectVariant: flow?.redirectVariant ?? 'WEB_OPENER_FLOW',
                    redirectCallbackUrl: flow?.redirectCallbackUrl ?? null,
                    debugMode: flow?.debugMode ?? false,
                    flavor: flow?.flavor ?? null,
                };
            },
            authorizeWithLoopback: (url, callbackUrl, onEvent) => this.kept(async () => {
                const flow = this.options.oauthFlow;
                if (flow == null) throw notAvailable('OAuth flow');
                return await flow.authorizeWithLoopback(new URL(url), callbackUrl, signal, events(onEvent));
            }),
            authorizeWithRedirectPage: (url, flowId, onEvent) => this.kept(async () => {
                const flow = this.options.oauthFlow;
                if (flow == null) throw notAvailable('OAuth flow');
                const accepts = (callback: OAuthRedirectData) => callback.state?.flowId === flowId;
                return await flow.authorizeWithRedirectPage(new URL(url), accepts, signal, events(onEvent));
            }),
            dispatch: action => {
                const channelId = channelOfAction(action);
                this.options.dispatch(action, channelId == null ? null : (this.channels.get(channelId) ?? null));
            },
            openTrinoChannel: (id, description) => {
                const open = this.options.openTrinoChannel;
                if (open == null) throw notAvailable('Trino channel');
                this.channels.set(id, open(description));
            },
            connectSalesforceChannel: description => this.kept(async () => {
                const connect = this.options.connectSalesforceChannel;
                if (connect == null) throw notAvailable('Salesforce channel');
                return this.registerChannel(await connect(description));
            }),
            connectHyperChannel: (kind, params) => this.kept(async () => {
                const connect = this.options.connectHyperChannel;
                if (connect == null) throw notAvailable('Hyper channel');
                return this.registerChannel(await connect(kind, params));
            }),
            hyperLinkToken: () => this.options.hyperLinkToken?.() ?? null,
            closeChannel: id => {
                const channel = this.channels.get(id);
                this.channels.delete(id);
                if (channel != null) this.options.closeChannel?.(channel);
            },
            runProbe: async (id, query, metadata) => {
                const probe = this.options.runProbe;
                if (probe == null) throw notAvailable('query executor');
                try {
                    return { hasTable: await probe(this.channels.get(id) ?? null, query, metadata) };
                } catch (error) {
                    // The check fails with the error of the query, the caller gets it back
                    this.hostError = error;
                    return { error: detailedErrorOf(error) };
                }
            },
        };
    }

    /// Await the outcome of a run, the result of a success. A failure throws what the host failed with or an error of
    /// the message, a cancellation the reason of the signal.
    async result<T>(run: core.DashQLConnectionSetupRun, target: string): Promise<T> {
        const { signal } = this.options;
        const cancel = () => run.cancel();
        if (signal.aborted) {
            cancel();
        } else {
            signal.addEventListener('abort', cancel, { once: true });
        }
        let outcome: core.ConnectionSetupOutcome;
        try {
            outcome = await run.done;
        } finally {
            signal.removeEventListener('abort', cancel);
        }
        switch (outcome.status) {
            case 'succeeded':
                return outcome.result as T;
            case 'cancelled':
                throw signal.reason ?? new DOMException(outcome.message, 'AbortError');
            case 'failed':
                if (outcome.hasValue) throw outcome.value;
                if (this.hostError != null) throw this.hostError;
                throw new LoggableException(outcome.message, outcome.data, target);
        }
    }
}

/// The id of the channel that an action names
function channelOfAction(action: core.ConnectionSetupAction): number | null {
    switch (action.type) {
        case 'TRINO_CHANNEL_READY':
        case 'SF_CHANNEL_READY':
            return typeof action.value === 'number' ? action.value : null;
        case 'HYPER_CHANNEL_READY':
            return typeof action.value?.channel === 'number' ? action.value.channel : null;
        default:
            return null;
    }
}

/// The error of a failed query for the connection: the message and the string details of a loggable exception
export function detailedErrorOf(error: unknown): { message: string; data?: Record<string, string> } {
    if (error instanceof LoggableException) {
        const data = Object.fromEntries(Object.entries(error.keyValues).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        return Object.keys(data).length > 0 ? { message: error.message, data } : { message: error.message };
    }
    if (error instanceof Error) {
        return { message: error.message };
    }
    if (error != null && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
        return { message: (error as { message: string }).message };
    }
    return { message: String(error ?? 'health check failed') };
}

/// The core of the setups
export function loadSetupCore(): Promise<core.DashQL> {
    return loadRuntimeCore();
}
