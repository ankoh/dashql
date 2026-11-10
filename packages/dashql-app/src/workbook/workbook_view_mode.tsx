import * as React from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

/// How a workbook is shown
export enum WorkbookViewMode {
    Workbook = 0,
    Shell = 1,
    Dashboard = 2,
    Dataflow = 3,
}

/// The views that are part of the URL, as the value of the `view` query parameter
const VIEW_PARAMETERS: [WorkbookViewMode, string][] = [
    [WorkbookViewMode.Dashboard, 'dashboard'],
    [WorkbookViewMode.Dataflow, 'dataflow'],
];

export interface WorkbookViewModeContextValue {
    mode: WorkbookViewMode;
    setMode: React.Dispatch<React.SetStateAction<WorkbookViewMode>>;
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

/// The view mode of the workbook. The dashboard and dataflow views are part of the URL.
export const WorkbookViewModeProvider: React.FC<React.PropsWithChildren> = (props: React.PropsWithChildren) => {
    const location = useLocation();
    const navigate = useNavigate();

    const [workbookViewMode, setWorkbookViewModeState] = React.useState(() => workbookViewModeFromSearch(location.search));
    const workbookViewModeRef = React.useRef(workbookViewMode);
    const pendingViewSearchRef = React.useRef<string | null>(null);
    workbookViewModeRef.current = workbookViewMode;
    const setWorkbookViewMode = React.useCallback<React.Dispatch<React.SetStateAction<WorkbookViewMode>>>((update) => {
        const next = typeof update === 'function' ? update(workbookViewModeRef.current) : update;
        workbookViewModeRef.current = next;
        setWorkbookViewModeState(next);
        const navigation = workbookViewNavigation(location, next);
        if (navigation.to.search !== location.search) {
            pendingViewSearchRef.current = navigation.to.search;
            navigate(navigation.to, navigation.options);
        }
    }, [location.pathname, location.search, location.hash, location.state, navigate]);
    const workbookViewModeValue = React.useMemo<WorkbookViewModeContextValue>(
        () => ({ mode: workbookViewMode, setMode: setWorkbookViewMode }),
        [workbookViewMode, setWorkbookViewMode],
    );

    React.useEffect(() => {
        const requested = workbookViewModeFromSearch(location.search);
        const parameter = new URLSearchParams(location.search).get('view');
        // An unknown view falls back to the workbook, also in the URL
        if (parameter != null && !inSearch(requested)) {
            pendingViewSearchRef.current = null;
            const navigation = workbookViewNavigation(location, WorkbookViewMode.Workbook);
            navigate(navigation.to, navigation.options);
            return;
        }
        if (pendingViewSearchRef.current != null) {
            if (pendingViewSearchRef.current === location.search) pendingViewSearchRef.current = null;
            return;
        }
        if (inSearch(requested) && workbookViewModeRef.current !== requested) {
            workbookViewModeRef.current = requested;
            setWorkbookViewModeState(requested);
        } else if (!inSearch(requested) && inSearch(workbookViewModeRef.current)) {
            workbookViewModeRef.current = WorkbookViewMode.Workbook;
            setWorkbookViewModeState(WorkbookViewMode.Workbook);
        }
    }, [location.search, navigate]);

    return (
        <WORKBOOK_VIEW_MODE_CTX.Provider value={workbookViewModeValue}>
            {props.children}
        </WORKBOOK_VIEW_MODE_CTX.Provider>
    );
};
