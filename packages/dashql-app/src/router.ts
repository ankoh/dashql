import { useLocation } from "react-router-dom";

export interface RouteContext {
    connectionId: number | null;
    workbookId: number | null;
    setupDone: boolean;
}

export function useRouteContext() {
    const location = useLocation();
    const route = location.state as RouteContext;
    if (!route) {
        return {
            connectionId: null,
            workbookId: null,
            setupDone: false,
        };
    } else {
        return route;
    }
}
