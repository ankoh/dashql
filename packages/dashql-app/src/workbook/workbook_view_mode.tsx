import * as React from 'react';

import { useLocation, useNavigate } from 'react-router-dom';
import type * as core from '@akohn/dashql';

/// How a workbook is shown
export enum WorkbookViewMode {
    Workbook = 0,
    Shell = 1,
    Dashboard = 2,
    Dataflow = 3,
}

/// The view mode that a workbook opens in, the workbook (its feed) unless it names the dashboard or the dataflow. A
/// view that the workbook file doesn't name reads as the feed.
export function viewModeOfDefaultView(view: core.WorkbookDefaultView | null | undefined): WorkbookViewMode {
    switch (view) {
        case 'dashboard': return WorkbookViewMode.Dashboard;
        case 'dataflow': return WorkbookViewMode.Dataflow;
        default: return WorkbookViewMode.Workbook;
    }
}

/// The default view of a view mode, the shell is no view a workbook opens in
export function defaultViewOfViewMode(mode: WorkbookViewMode): core.WorkbookDefaultView {
    switch (mode) {
        case WorkbookViewMode.Dashboard: return 'dashboard';
        case WorkbookViewMode.Dataflow: return 'dataflow';
        default: return 'feed';
    }
}

/// Does the URL name a view? A link that names one opens in it, not in the default view of the workbook.
export function searchNamesView(search: string): boolean {
    return new URLSearchParams(search).has('view');
}

/// The views that are part of the URL, as the value of the `view` query parameter
const VIEW_PARAMETERS: [WorkbookViewMode, string][] = [
    [WorkbookViewMode.Dashboard, 'dashboard'],
    [WorkbookViewMode.Dataflow, 'dataflow'],
];

export interface WorkbookViewModeContextValue {
    mode: WorkbookViewMode;
    setMode: (mode: WorkbookViewMode) => void;
}
const WORKBOOK_VIEW_MODE_CTX = React.createContext<WorkbookViewModeContextValue | null>(null);
export const useWorkbookViewMode = () => React.useContext(WORKBOOK_VIEW_MODE_CTX)!;

/// The view of the `view` query parameter, the workbook if the view is unknown
export function workbookViewModeFromSearch(search: string): WorkbookViewMode {
    const value = new URLSearchParams(search).get('view');
    const view = VIEW_PARAMETERS.find(([, parameter]) => parameter === value);
    return view != null ? view[0] : WorkbookViewMode.Workbook;
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

/// The view mode of the workbook. The dashboard and dataflow views are part of the URL, the shell is a state of the
/// app that a view in the URL closes.
export const WorkbookViewModeProvider: React.FC<React.PropsWithChildren> = (props: React.PropsWithChildren) => {
    const location = useLocation();
    const navigate = useNavigate();

    const [shellOpen, setShellOpen] = React.useState(false);
    const requested = workbookViewModeFromSearch(location.search);
    const mode = inSearch(requested) ? requested : shellOpen ? WorkbookViewMode.Shell : WorkbookViewMode.Workbook;
    const setMode = React.useCallback((next: WorkbookViewMode) => {
        setShellOpen(next === WorkbookViewMode.Shell);
        const navigation = workbookViewNavigation(location, next);
        if (navigation.to.search !== location.search) navigate(navigation.to, navigation.options);
    }, [location, navigate]);
    const workbookViewModeValue = React.useMemo<WorkbookViewModeContextValue>(() => ({ mode, setMode }), [mode, setMode]);

    // The fallback to the workbook keeps the rest of the current location
    const showWorkbookInUrl = React.useEffectEvent(() => {
        const navigation = workbookViewNavigation(location, WorkbookViewMode.Workbook);
        navigate(navigation.to, navigation.options);
    });
    React.useEffect(() => {
        const parameter = new URLSearchParams(location.search).get('view');
        if (parameter == null) return;
        // An unknown view falls back to the workbook, also in the URL, a known one closes the shell
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
