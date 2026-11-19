import * as React from 'react';

/// Stops a writer of the app storage before the app is handed over to another tab
export type AppHandOverHook = () => Promise<void>;

/// Registers a hand over hook and returns its unregistration
export type AppHandOverRegistry = (hook: AppHandOverHook) => () => void;

export const APP_HAND_OVER_CTX = React.createContext<AppHandOverRegistry | null>(null);

/// Stop a writer of the app storage before another tab takes over the app.
/// A no-op outside of an `AppOwnershipGate`.
export function useAppHandOver(hook: AppHandOverHook): void {
    const register = React.useContext(APP_HAND_OVER_CTX);
    const latest = React.useRef(hook);
    latest.current = hook;
    React.useEffect(() => register?.(() => latest.current()), [register]);
}

/// Restarts the app in this tab, e.g. to start the embedded database with other options
export type AppRestart = () => Promise<void>;

export const APP_RESTART_CTX = React.createContext<AppRestart | null>(null);

/// Leave the app. The reload stops everything the tab still runs, and the browser releases the lock of the app
/// when the page unloads. After a hand over the tab boots into the "open elsewhere" page.
export function reloadTab(): Promise<void> {
    window.location.reload();
    return new Promise(() => { });
}

/// Restart the app: stop the writers of the app storage like before a hand over, then reload the tab.
/// Outside of an `AppOwnershipGate` it only reloads the tab.
export function useAppRestart(): AppRestart {
    return React.useContext(APP_RESTART_CTX) ?? reloadTab;
}
