import * as React from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import { VariantKind } from "./utils/variant.js";

export interface RouteContext {
    connectionId: number | null;
    workbookId: number | null;
    setupDone: boolean;
}

export const CONNECTION_PATH = Symbol("NAVIGATE_CONNECTION");
export const WORKBOOK_PATH = Symbol("NAVIGATE_WORKBOOK");
export const FINISH_SETUP = Symbol("SETUP_DONE");
export const SKIP_SETUP = Symbol("SKIP_SETUP");

export type RouteTarget =
    VariantKind<typeof CONNECTION_PATH, { workbookId: number | null, connectionId: number }>
    | VariantKind<typeof WORKBOOK_PATH, { workbookId: number, connectionId: number }>
    | VariantKind<typeof FINISH_SETUP, { workbookId: number | null /* XXX */; connectionId: number; }>
    | VariantKind<typeof SKIP_SETUP, null>
    ;

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

export function useRouterNavigate() {
    const navigate = useNavigate();
    const location = useLocation();
    const context = useRouteContext();
    return React.useCallback((route: RouteTarget) => {
        switch (route.type) {
            case CONNECTION_PATH:
                navigate("/connection", {
                    state: {
                        connectionId: route.value.connectionId,
                        workbookId: route.value.workbookId,
                        setupDone: context.setupDone,
                    }
                });
                break;
            case WORKBOOK_PATH:
                navigate("/workbook", {
                    state: {
                        connectionId: route.value.connectionId,
                        workbookId: route.value.workbookId,
                        setupDone: context.setupDone,
                    }
                });
                break;
            case SKIP_SETUP:
                navigate(location.pathname, {
                    state: {
                        setupDone: true,
                    }
                });
                break;
            case FINISH_SETUP:
                navigate(location.pathname, {
                    state: {
                        connectionId: route.value.connectionId,
                        workbookId: route.value.workbookId,
                        setupDone: true,
                    }
                });
                break;
        }
    }, [navigate, context, location]);
}
