import * as React from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

/// How a workbook is shown
export enum WorkbookViewMode {
    /// The scripts one below the other, the view that a workbook opens in unless it names another one
    Feed = 0,
    Shell = 1,
    Dashboard = 2,
    Dataflow = 3,
    /// The scripts as tabs, the editor of one over its results, like the console of a database service. A workbook
    /// doesn't open in it.
    Console = 4,
}

/// The views that a workbook opens in besides the feed, by the name that the workbook file stores (`defaultView`). The
/// name is the app's, the core keeps it without reading it.
const DEFAULT_VIEW_NAMES: [WorkbookViewMode, string][] = [
    [WorkbookViewMode.Dashboard, 'dashboard'],
    [WorkbookViewMode.Dataflow, 'dataflow'],
];

/// The view mode that a workbook opens in, the feed unless it names the dashboard or the dataflow. A
/// name that the app doesn't know reads as the feed, e.g. one of a newer app.
export function viewModeOfDefaultView(view: string | null | undefined): WorkbookViewMode {
    return DEFAULT_VIEW_NAMES.find(([, name]) => name === view)?.[0] ?? WorkbookViewMode.Feed;
}

/// Does a workbook open in a view mode? The feed and the views of `DEFAULT_VIEW_NAMES`, not the shell.
export function isDefaultViewMode(mode: WorkbookViewMode): boolean {
    return mode === WorkbookViewMode.Feed || DEFAULT_VIEW_NAMES.some(([m]) => m === mode);
}

/// The name of the default view of a view mode, null for the feed. The shell is no view a workbook opens in.
export function defaultViewOfViewMode(mode: WorkbookViewMode): string | null {
    return DEFAULT_VIEW_NAMES.find(([m]) => m === mode)?.[1] ?? null;
}

/// Does the URL name a view? A link that names one opens in it, not in the default view of the workbook.
export function searchNamesView(search: string): boolean {
    return new URLSearchParams(search).has('view');
}

/// The views that are part of the URL, as the value of the `view` query parameter
const VIEW_PARAMETERS: [WorkbookViewMode, string][] = [
    [WorkbookViewMode.Console, 'console'],
    [WorkbookViewMode.Dashboard, 'dashboard'],
    [WorkbookViewMode.Dataflow, 'dataflow'],
];

export interface WorkbookViewModeContextValue {
    mode: WorkbookViewMode;
    setMode: (mode: WorkbookViewMode) => void;
}
const WORKBOOK_VIEW_MODE_CTX = React.createContext<WorkbookViewModeContextValue | null>(null);
export const useWorkbookViewMode = () => React.useContext(WORKBOOK_VIEW_MODE_CTX)!;

/// The view of the `view` query parameter, the feed if the view is unknown
export function workbookViewModeFromSearch(search: string): WorkbookViewMode {
    const value = new URLSearchParams(search).get('view');
    const view = VIEW_PARAMETERS.find(([, parameter]) => parameter === value);
    return view != null ? view[0] : WorkbookViewMode.Feed;
}

export function workbookViewSearch(search: string, mode: WorkbookViewMode): string {
    const params = new URLSearchParams(search);
    const view = VIEW_PARAMETERS.find(([m]) => m === mode);
    if (view != null) params.set('view', view[1]);
    else params.delete('view');
    const next = params.toString();
    return next ? `?${next}` : '';
}

export function workbookViewNavigation(
    location: { pathname: string; search: string; hash: string; state: unknown },
    mode: WorkbookViewMode,
) {
    return {
        to: {
            pathname: location.pathname,
            search: workbookViewSearch(location.search, mode),
            hash: location.hash,
        },
        options: { replace: true as const, state: location.state },
    };
}

/// Is a view mode part of the URL?
function inSearch(mode: WorkbookViewMode): boolean {
    return VIEW_PARAMETERS.some(([m]) => m === mode);
}

/// The view mode of the workbook. The console, the dashboard and the dataflow are part of the URL, the shell is a state
/// of the app that a view in the URL closes.
export const WorkbookViewModeProvider: React.FC<React.PropsWithChildren> = (props: React.PropsWithChildren) => {
    const location = useLocation();
    const navigate = useNavigate();

    const [shellOpen, setShellOpen] = React.useState(false);
    const requested = workbookViewModeFromSearch(location.search);
    const mode = inSearch(requested) ? requested : shellOpen ? WorkbookViewMode.Shell : WorkbookViewMode.Feed;
    const setMode = React.useCallback((next: WorkbookViewMode) => {
        setShellOpen(next === WorkbookViewMode.Shell);
        const navigation = workbookViewNavigation(location, next);
        if (navigation.to.search !== location.search) navigate(navigation.to, navigation.options);
    }, [location, navigate]);
    const workbookViewModeValue = React.useMemo<WorkbookViewModeContextValue>(() => ({ mode, setMode }), [mode, setMode]);

    // The fallback to the feed keeps the rest of the current location
    const showWorkbookInUrl = React.useEffectEvent(() => {
        const navigation = workbookViewNavigation(location, WorkbookViewMode.Feed);
        navigate(navigation.to, navigation.options);
    });
    React.useEffect(() => {
        const parameter = new URLSearchParams(location.search).get('view');
        if (parameter == null) return;
        // An unknown view falls back to the feed, also in the URL, a known one closes the shell
        if (!inSearch(workbookViewModeFromSearch(location.search))) {
            showWorkbookInUrl();
        } else {
            setShellOpen(false);
        }
    }, [location.search]);

    return (
        <WORKBOOK_VIEW_MODE_CTX.Provider value={workbookViewModeValue}>
            {props.children}
        </WORKBOOK_VIEW_MODE_CTX.Provider>
    );
};
