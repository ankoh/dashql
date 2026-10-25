import * as React from 'react';
import type * as dashql from '@ankoh/dashql-core';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { createConnectionStateFromParams, type ConnectionParams } from '../connections/connection_params.js';
import type { ConnectionAllocator } from '../connections/connection_registry.js';
import type { ConnectionState } from '../connections/connection_state.js';

/// The session storage key of the tokens of the Hyper links of a tab
const HYPER_LINK_SESSION_STORAGE_KEY = 'dashql.hyper_links';

/// Hosts of this machine, e.g. of `hyperd run --ui`
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/// A Hyper that a link points the app at, e.g. the hyperd of `hyperd run --ui`.
/// The link is an app event, `?data=` with the base64url JSON `{"hyperLink": {"endpoint": ..., "token": ...}}`.
export interface HyperLinkTarget {
    /// The base url of the HTTP v3 API of the Hyper
    endpoint: string;
    /// The bearer token of the Hyper
    token: string;
}

/// Parse the target of a Hyper link, null unless it names an endpoint and a token.
/// An endpoint on this machine may speak http, any other endpoint must speak https.
export function parseHyperLinkTarget(endpoint: string | null, token: string | null): HyperLinkTarget | null {
    if (endpoint == null || token == null || token.length === 0) return null;
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) return null;
    return { endpoint: url.origin, token };
}

/// Does the link point at a Hyper on this machine?
export function isLoopbackHyperLink(target: HyperLinkTarget): boolean {
    return LOOPBACK_HOSTS.has(new URL(target.endpoint).hostname);
}

/// Confirm a link before the app uses it.
/// A link to another machine would receive the queries of the new sessions, the user confirms its host first.
export function confirmHyperLink(target: HyperLinkTarget, confirm: (message: string) => boolean = message => globalThis.confirm(message)): boolean {
    if (isLoopbackHyperLink(target)) return true;
    return confirm(`Run new sessions on the Hyper at ${target.endpoint}? Only continue if you trust the link that opened DashQL.`);
}

/// The Hyper links of a tab
export interface HyperLinkTabState {
    /// The tokens of the connections to the Hyper of a link (connectionId -> token), they are never stored durably
    tokens: Record<string, string>;
    /// The connection of the latest link, new sessions start on it
    current: string | null;
}

const NO_HYPER_LINKS: HyperLinkTabState = { tokens: {}, current: null };

/// The storage of the tab, null if the browser refuses it
function tabStorage(): Storage | null {
    try {
        return globalThis.sessionStorage ?? null;
    } catch {
        return null;
    }
}

/// Read the Hyper links of the tab, a reload keeps them and closing the tab ends them
export function readHyperLinkTabState(storage: Storage | null = tabStorage()): HyperLinkTabState {
    try {
        const parsed = JSON.parse(storage?.getItem(HYPER_LINK_SESSION_STORAGE_KEY) ?? 'null');
        if (parsed == null || typeof parsed !== 'object') return NO_HYPER_LINKS;
        const tokens = Object.fromEntries(Object.entries(parsed.tokens ?? {}).filter(([, token]) => typeof token === 'string')) as Record<string, string>;
        return { tokens, current: typeof parsed.current === 'string' ? parsed.current : null };
    } catch {
        return NO_HYPER_LINKS;
    }
}

let HYPER_LINK_TAB_STATE: HyperLinkTabState | null = null;
const HYPER_LINK_LISTENERS = new Set<() => void>();

/// Get the Hyper links of the tab
export function getHyperLinkTabState(): HyperLinkTabState {
    HYPER_LINK_TAB_STATE ??= readHyperLinkTabState();
    return HYPER_LINK_TAB_STATE;
}

/// Remember the token of the connection that a link was bound to, new sessions start on the connection
export function setHyperLinkToken(connectionId: string, token: string, storage: Storage | null = tabStorage()): void {
    const prev = getHyperLinkTabState();
    HYPER_LINK_TAB_STATE = { tokens: { ...prev.tokens, [connectionId]: token }, current: connectionId };
    try {
        storage?.setItem(HYPER_LINK_SESSION_STORAGE_KEY, JSON.stringify(HYPER_LINK_TAB_STATE));
    } catch {
        // Without storage, a reload forgets the links
    }
    for (const listener of HYPER_LINK_LISTENERS) listener();
}

/// Subscribe to the Hyper links of the tab
function subscribeHyperLinkTabState(listener: () => void): () => void {
    HYPER_LINK_LISTENERS.add(listener);
    return () => HYPER_LINK_LISTENERS.delete(listener);
}

/// The Hyper links of the tab, they change with every link
export function useHyperLinkTabState(): HyperLinkTabState {
    return React.useSyncExternalStore(subscribeHyperLinkTabState, getHyperLinkTabState);
}

/// Does a connection speak to the Hyper of a link?
export function isHyperLinkParams(params: ConnectionParams): boolean {
    return 'hyper' in params && params.hyper.protocol === 'V3_HTTP_LINK';
}

/// The params of a new connection to the Hyper of a link, its token is never stored
export function createHyperLinkConnectionParams(endpoint: string): ConnectionParams {
    return {
        hyper: {
            protocol: 'V3_HTTP_LINK',
            endpoint,
            tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
        },
    };
}

/// The params of the channel to the Hyper of a link, its HTTP v3 API with the token of the link
export function hyperLinkChannelParams(params: connection.HyperConnectionParams, token: string): connection.HyperConnectionParams {
    return {
        ...params,
        protocol: 'V3_HTTP',
        metadata: {
            'x-hyperdb-workload': 'dashql',
            ...params.metadata,
            authorization: `Bearer ${token}`,
        },
    };
}

/// The connection that a link is bound to
export interface HyperLinkBinding {
    /// The connection
    connection: ConnectionState;
    /// The params that the connection is saved with, null if they don't change
    params: ConnectionParams | null;
}

/// Bind a link to a connection.
///
/// A connection to the endpoint of the link is reused. Otherwise the user may reuse the connection of an earlier link,
/// e.g. of an earlier run of hyperd on another port, which then moves to the endpoint of the link. Declining creates a
/// new connection, so the app can speak to several Hyper of links at once.
export function bindHyperLink(
    target: HyperLinkTarget,
    connections: Iterable<ConnectionState>,
    allocate: ConnectionAllocator,
    dql: dashql.DashQL,
    recentConnectionId: string | null,
    confirmReuse: (connection: ConnectionState) => boolean,
): HyperLinkBinding {
    const linked = [...connections].filter(connection => isHyperLinkParams(connection.params));
    const endpointOf = (connection: ConnectionState) => 'hyper' in connection.params ? connection.params.hyper.endpoint : null;
    const same = linked.find(connection => endpointOf(connection) === target.endpoint);
    if (same != null) return { connection: same, params: null };
    const recent = linked.find(connection => connection.connectionId === recentConnectionId) ?? linked[linked.length - 1];
    if (recent != null && 'hyper' in recent.params && confirmReuse(recent)) {
        return { connection: recent, params: { hyper: { ...recent.params.hyper, endpoint: target.endpoint } } };
    }
    return {
        connection: allocate({ ...createConnectionStateFromParams(dql, createHyperLinkConnectionParams(target.endpoint)), active: true }),
        params: null,
    };
}
