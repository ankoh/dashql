import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import type { KeyValueStorage } from '@akohn/dashql/platform/key_value_storage';

// The Hyper links of a tab: the runtime reads the target of a link, asks for confirmation and binds it to a connection
// (`Runtime.bindHyperLink`), the tab keeps the tokens of the links in its storage.

/// The session storage key of the tokens of the Hyper links of a tab
const HYPER_LINKS_STORAGE_KEY = 'dashql.hyper_links';

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
