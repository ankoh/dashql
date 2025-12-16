import * as React from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import { VariantKind } from "./utils/variant.js";
import { AppLoadingStatus } from './app_loading_status.js';
import { LoggableException } from './platform/logger.js';

export interface RouteContext {
    /// The app loading status
    appLoadingStatus: AppLoadingStatus;
    /// Confirmed the finished setup?
    confirmedFinishedSetup: boolean;
    /// This is the focused connection id on the connection settings page
    connectionId: number | null;
    /// This is the focused workbook id on the workbook settings page.
    /// Note that the connection id might not match the workbook connection.
    workbookId: number | null;
    /// Edit a workbook entry?
    workbookEditMode: boolean | null;
}

export const CONNECTION_PATH = Symbol("NAVIGATE_CONNECTION");
export const WORKBOOK_PATH = Symbol("NAVIGATE_WORKBOOK");
export const FINISH_SETUP = Symbol("FINISH_SETUP");
export const CONFIRM_FINISHED_SETUP = Symbol("CONFIRM_FINISHED_SETUP");
export const SKIP_SETUP = Symbol("SKIP_SETUP");

export type RouteTarget =
    VariantKind<typeof CONNECTION_PATH, { connectionId: number | null }>
    | VariantKind<typeof WORKBOOK_PATH, { workbookId: number, connectionId: number, workbookEditMode: boolean }>
    | VariantKind<typeof FINISH_SETUP, { workbookId: number | null /* XXX */; connectionId: number; }>
    | VariantKind<typeof CONFIRM_FINISHED_SETUP, boolean>
    | VariantKind<typeof SKIP_SETUP, null>
    ;

export function useRouteContext() {
    const location = useLocation();
    const route = location.state as RouteContext;
    if (!route) {
        return {
            appLoadingStatus: AppLoadingStatus.NOT_STARTED,
            confirmedFinishedSetup: false,
            connectionId: null,
            workbookId: null,
            workbookEditMode: null,
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
                        ...context,
                        connectionId: route.value.connectionId,
                    }
                });
                break;
            case WORKBOOK_PATH:
                navigate("/workbook", {
                    state: {
                        ...context,
                        connectionId: route.value.connectionId,
                        workbookId: route.value.workbookId,
                        workbookEditMode: route.value.workbookEditMode,
                    }
                });
                break;
            case SKIP_SETUP:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        appLoadingStatus: AppLoadingStatus.SETUP_DONE,
                    }
                });
                break;
            case FINISH_SETUP:
                navigate(location.pathname, {
                    state: {
                        appLoadingStatus: AppLoadingStatus.SETUP_DONE,
                        confirmedFinishedSetup: false,
                        connectionId: route.value.connectionId,
                        workbookId: route.value.workbookId,
                        workbookEditMode: false,
                    }
                });
                break;
            case CONFIRM_FINISHED_SETUP:
                if (context.appLoadingStatus != AppLoadingStatus.SETUP_DONE) {
                    throw new LoggableException("tried to confirm a non-finished setup");
                }
                navigate(location.pathname, {
                    state: {
                        ...context,
                        appLoadingStatus: AppLoadingStatus.SETUP_DONE,
                        confirmedFinishedSetup: route.value,
                    }
                });
                break;
        }
    }, [navigate, context, location]);
}
