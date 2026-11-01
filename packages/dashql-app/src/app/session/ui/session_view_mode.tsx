import * as React from 'react';

import { useLocation, useNavigate } from 'react-router-dom';
import { useAppConfig } from '../../config/app_config.js';
import { useAppSettingsReady } from '../../config/app_settings_sync.js';

/// How a session is shown
export enum SessionViewMode {
    Session = 0,
    Shell = 1,
    Dashboard = 2,
    Dataflow = 3,
}

/// The experimental views that the settings enable
export interface SessionViewsEnabled {
    dashboard: boolean;
    dataflow: boolean;
}

/// The views that are part of the URL, as the value of the `view` query parameter
const VIEW_PARAMETERS: [SessionViewMode, string, keyof SessionViewsEnabled][] = [
    [SessionViewMode.Dashboard, 'dashboard', 'dashboard'],
    [SessionViewMode.Dataflow, 'dataflow', 'dataflow'],
];

/// Is a view mode available with the settings?
export function sessionViewModeEnabled(mode: SessionViewMode, enabled: SessionViewsEnabled): boolean {
    const view = VIEW_PARAMETERS.find(([m]) => m === mode);
    return view == null || enabled[view[2]];
}

/// The experimental views of the app settings
export function useSessionViewsEnabled(): SessionViewsEnabled {
    const settings = useAppConfig()?.settings;
    const dashboard = settings?.experimental_dashboards === true;
    const dataflow = settings?.experimental_dataflow === true;
    return React.useMemo(() => ({ dashboard, dataflow }), [dashboard, dataflow]);
}

export interface SessionViewModeContextValue {
    mode: SessionViewMode;
    setMode: React.Dispatch<React.SetStateAction<SessionViewMode>>;
}
const SESSION_VIEW_MODE_CTX = React.createContext<SessionViewModeContextValue | null>(null);
export const useSessionViewMode = () => React.useContext(SESSION_VIEW_MODE_CTX)!;

/// The view of the `view` query parameter, the session if the view is unknown or not enabled
export function sessionViewModeFromSearch(search: string, enabled: SessionViewsEnabled): SessionViewMode {
    const value = new URLSearchParams(search).get('view');
    const view = VIEW_PARAMETERS.find(([, parameter]) => parameter === value);
    return view != null && enabled[view[2]] ? view[0] : SessionViewMode.Session;
}

export function sessionViewSearch(search: string, mode: SessionViewMode): string {
    const params = new URLSearchParams(search);
    const view = VIEW_PARAMETERS.find(([m]) => m === mode);
    if (view != null) params.set('view', view[1]);
    else params.delete('view');
    const next = params.toString();
    return next ? `?${next}` : '';
}

export function sessionViewNavigation(
    location: { pathname: string; search: string; hash: string; state: unknown },
    mode: SessionViewMode,
) {
    return {
        to: {
            pathname: location.pathname,
            search: sessionViewSearch(location.search, mode),
            hash: location.hash,
        },
        options: { replace: true as const, state: location.state },
    };
}

/// Is a view mode part of the URL?
function inSearch(mode: SessionViewMode): boolean {
    return VIEW_PARAMETERS.some(([m]) => m === mode);
}

/// The view mode of the session. The dashboard and dataflow views are part of the URL and only exist while they are
/// enabled in the settings.
export const SessionViewModeProvider: React.FC<React.PropsWithChildren> = (props: React.PropsWithChildren) => {
    const location = useLocation();
    const navigate = useNavigate();
    const enabled = useSessionViewsEnabled();
    const settingsReady = useAppSettingsReady();

    const [sessionViewMode, setSessionViewModeState] = React.useState(() => sessionViewModeFromSearch(location.search, enabled));
    const visibleViewMode = sessionViewModeEnabled(sessionViewMode, enabled) ? sessionViewMode : SessionViewMode.Session;
    const sessionViewModeRef = React.useRef(visibleViewMode);
    const pendingViewSearchRef = React.useRef<string | null>(null);
    sessionViewModeRef.current = visibleViewMode;
    const setSessionViewMode = React.useCallback<React.Dispatch<React.SetStateAction<SessionViewMode>>>((update) => {
        const next = typeof update === 'function' ? update(sessionViewModeRef.current) : update;
        const allowed = sessionViewModeEnabled(next, enabled) ? next : SessionViewMode.Session;
        sessionViewModeRef.current = allowed;
        setSessionViewModeState(allowed);
        const navigation = sessionViewNavigation(location, allowed);
        if (navigation.to.search !== location.search) {
            pendingViewSearchRef.current = navigation.to.search;
            navigate(navigation.to, navigation.options);
        }
    }, [enabled, location.pathname, location.search, location.hash, location.state, navigate]);
    const sessionViewModeValue = React.useMemo<SessionViewModeContextValue>(
        () => ({ mode: visibleViewMode, setMode: setSessionViewMode }),
        [visibleViewMode, setSessionViewMode],
    );

    React.useEffect(() => {
        if (!settingsReady) return;
        // A view that the settings disabled falls back to the session, also in the URL
        if (!sessionViewModeEnabled(sessionViewMode, enabled)) {
            pendingViewSearchRef.current = null;
            sessionViewModeRef.current = SessionViewMode.Session;
            setSessionViewModeState(SessionViewMode.Session);
        }
        const requested = sessionViewModeFromSearch(location.search, enabled);
        const parameter = new URLSearchParams(location.search).get('view');
        if (parameter != null && !inSearch(requested)) {
            pendingViewSearchRef.current = null;
            const navigation = sessionViewNavigation(location, SessionViewMode.Session);
            navigate(navigation.to, navigation.options);
            return;
        }
        if (pendingViewSearchRef.current != null) {
            if (pendingViewSearchRef.current === location.search) pendingViewSearchRef.current = null;
            return;
        }
        if (inSearch(requested) && sessionViewModeRef.current !== requested) {
            sessionViewModeRef.current = requested;
            setSessionViewModeState(requested);
        } else if (!inSearch(requested) && inSearch(sessionViewModeRef.current)) {
            sessionViewModeRef.current = SessionViewMode.Session;
            setSessionViewModeState(SessionViewMode.Session);
        }
    }, [enabled, settingsReady, location.search, navigate]);

    return (
        <SESSION_VIEW_MODE_CTX.Provider value={sessionViewModeValue}>
            {props.children}
        </SESSION_VIEW_MODE_CTX.Provider>
    );
};
