import * as React from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

/// How a session is shown
export enum SessionViewMode {
    Session = 0,
    Shell = 1,
    Dashboard = 2,
    Dataflow = 3,
}

/// The views that are part of the URL, as the value of the `view` query parameter
const VIEW_PARAMETERS: [SessionViewMode, string][] = [
    [SessionViewMode.Dashboard, 'dashboard'],
    [SessionViewMode.Dataflow, 'dataflow'],
];

export interface SessionViewModeContextValue {
    mode: SessionViewMode;
    setMode: React.Dispatch<React.SetStateAction<SessionViewMode>>;
}
const SESSION_VIEW_MODE_CTX = React.createContext<SessionViewModeContextValue | null>(null);
export const useSessionViewMode = () => React.useContext(SESSION_VIEW_MODE_CTX)!;

/// The view of the `view` query parameter, the session if the view is unknown
export function sessionViewModeFromSearch(search: string): SessionViewMode {
    const value = new URLSearchParams(search).get('view');
    const view = VIEW_PARAMETERS.find(([, parameter]) => parameter === value);
    return view != null ? view[0] : SessionViewMode.Session;
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

/// The view mode of the session. The dashboard and dataflow views are part of the URL.
export const SessionViewModeProvider: React.FC<React.PropsWithChildren> = (props: React.PropsWithChildren) => {
    const location = useLocation();
    const navigate = useNavigate();

    const [sessionViewMode, setSessionViewModeState] = React.useState(() => sessionViewModeFromSearch(location.search));
    const sessionViewModeRef = React.useRef(sessionViewMode);
    const pendingViewSearchRef = React.useRef<string | null>(null);
    sessionViewModeRef.current = sessionViewMode;
    const setSessionViewMode = React.useCallback<React.Dispatch<React.SetStateAction<SessionViewMode>>>((update) => {
        const next = typeof update === 'function' ? update(sessionViewModeRef.current) : update;
        sessionViewModeRef.current = next;
        setSessionViewModeState(next);
        const navigation = sessionViewNavigation(location, next);
        if (navigation.to.search !== location.search) {
            pendingViewSearchRef.current = navigation.to.search;
            navigate(navigation.to, navigation.options);
        }
    }, [location.pathname, location.search, location.hash, location.state, navigate]);
    const sessionViewModeValue = React.useMemo<SessionViewModeContextValue>(
        () => ({ mode: sessionViewMode, setMode: setSessionViewMode }),
        [sessionViewMode, setSessionViewMode],
    );

    React.useEffect(() => {
        const requested = sessionViewModeFromSearch(location.search);
        const parameter = new URLSearchParams(location.search).get('view');
        // An unknown view falls back to the session, also in the URL
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
    }, [location.search, navigate]);

    return (
        <SESSION_VIEW_MODE_CTX.Provider value={sessionViewModeValue}>
            {props.children}
        </SESSION_VIEW_MODE_CTX.Provider>
    );
};
