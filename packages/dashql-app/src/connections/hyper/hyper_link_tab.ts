import * as React from 'react';

import { confirmHyperLink as confirmHyperLinkWith, HyperLinkTabStore, type HyperLinkTabState, type HyperLinkTarget } from './hyper_link.js';

/// The storage of the tab, null if the browser refuses it
function tabStorage(): Storage | null {
    try {
        return globalThis.sessionStorage ?? null;
    } catch {
        return null;
    }
}

/// The Hyper links of this tab
const HYPER_LINK_TAB = new HyperLinkTabStore(tabStorage());

/// Get the Hyper links of the tab
export function getHyperLinkTabState(): HyperLinkTabState {
    return HYPER_LINK_TAB.get();
}

/// Remember the token of the connection that a link was bound to, new workbooks start on the connection
export function setHyperLinkToken(connectionId: string, token: string): void {
    HYPER_LINK_TAB.setToken(connectionId, token);
}

/// The Hyper links of the tab, they change with every link
export function useHyperLinkTabState(): HyperLinkTabState {
    return React.useSyncExternalStore(HYPER_LINK_TAB.subscribe, HYPER_LINK_TAB.get);
}

/// Confirm a link before the app uses it, in a dialog of the browser
export function confirmHyperLink(target: HyperLinkTarget, confirm: (message: string) => boolean = message => globalThis.confirm(message)): boolean {
    return confirmHyperLinkWith(target, confirm);
}
