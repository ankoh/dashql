import { newConnectionFromParams, type ConnectionParams } from '../connection_params.js';
import type { KeyValueStorage } from '../../platform/key_value_storage.js';
import type { ConnectionAllocator, ConnectionState } from '../connection_state.js';
import { isLoopbackHyperLink, type HyperLinkTarget } from '../../platform/events/hyper_link_target.js';

export { hyperLinkChannelParams, isLoopbackHyperLink, parseHyperLinkTarget, type HyperLinkTarget } from '../../platform/events/hyper_link_target.js';

/// The session storage key of the tokens of the Hyper links of a tab
const HYPER_LINKS_STORAGE_KEY = 'dashql.hyper_links';

/// Confirm a link before the app uses it.
/// A link to another machine would receive the queries of the new workbooks, the user confirms its host first.
export function confirmHyperLink(target: HyperLinkTarget, confirm: (message: string) => boolean): boolean {
    if (isLoopbackHyperLink(target)) return true;
    return confirm(`Run new workbooks on the Hyper at ${target.endpoint}? Only continue if you trust the link that opened DashQL.`);
}

/// The Hyper links of a tab
export interface HyperLinkTabState {
    /// The tokens of the connections to the Hyper of a link (connectionId -> token), they are never stored durably
    tokens: Record<string, string>;
    /// The connection of the latest link, new workbooks start on it
    current: string | null;
}

const NO_HYPER_LINKS: HyperLinkTabState = { tokens: {}, current: null };

/// Read the Hyper links of a tab, a reload keeps them and closing the tab ends them
export function readHyperLinkTabState(storage: KeyValueStorage | null): HyperLinkTabState {
    try {
        const parsed = JSON.parse(storage?.getItem(HYPER_LINKS_STORAGE_KEY) ?? 'null');
        if (parsed == null || typeof parsed !== 'object') return NO_HYPER_LINKS;
        const tokens = Object.fromEntries(Object.entries(parsed.tokens ?? {}).filter(([, token]) => typeof token === 'string')) as Record<string, string>;
        return { tokens, current: typeof parsed.current === 'string' ? parsed.current : null };
    } catch {
        return NO_HYPER_LINKS;
    }
}

/// The Hyper links of a tab, kept in the storage of the tab, null if there is none
export class HyperLinkTabStore {
    protected state: HyperLinkTabState | null = null;
    protected readonly listeners = new Set<() => void>();

    constructor(protected readonly storage: KeyValueStorage | null) {}

    /// The Hyper links of the tab
    get = (): HyperLinkTabState => {
        this.state ??= readHyperLinkTabState(this.storage);
        return this.state;
    };

    /// Remember the token of the connection that a link was bound to, new workbooks start on the connection
    setToken(connectionId: string, token: string): void {
        const prev = this.get();
        this.state = { tokens: { ...prev.tokens, [connectionId]: token }, current: connectionId };
        try {
            this.storage?.setItem(HYPER_LINKS_STORAGE_KEY, JSON.stringify(this.state));
        } catch {
            // Without storage, a reload forgets the links
        }
        for (const listener of this.listeners) listener();
    }

    /// Subscribe to the Hyper links of the tab
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };
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
        connection: allocate(newConnectionFromParams(createHyperLinkConnectionParams(target.endpoint), { active: true })),
        params: null,
    };
}
