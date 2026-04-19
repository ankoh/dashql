import * as React from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import { VariantKind } from "./utils/variant.js";
import { AppLoadingStatus } from './app_loading_status.js';
import { LoggableException } from './platform/logger/logger.js';

export interface RouteContext {
    /// The app loading status
    appLoadingStatus: AppLoadingStatus;
    /// Confirmed the finished setup?
    confirmedFinishedSetup: boolean;
    /// The focused session id (replaces both connectionId and notebookId)
    sessionId: string | null;
}

export const CONNECTION_PATH = Symbol("NAVIGATE_CONNECTION");
export const NOTEBOOK_PATH = Symbol("NAVIGATE_NOTEBOOK");
export const TOOL_PATH = Symbol("NAVIGATE_TOOLS");
export const FINISH_SETUP = Symbol("FINISH_SETUP");
export const CONFIRM_FINISHED_SETUP = Symbol("CONFIRM_FINISHED_SETUP");
export const SKIP_SETUP = Symbol("SKIP_SETUP");
export const SELECT_SESSION = Symbol("SELECT_SESSION");
export const CHANGE_SESSION = Symbol("CHANGE_SESSION");

export type RouteTarget =
    VariantKind<typeof CONNECTION_PATH, string | null>
    | VariantKind<typeof NOTEBOOK_PATH, string | null>
    | VariantKind<typeof TOOL_PATH, null>
    | VariantKind<typeof FINISH_SETUP, null>
    | VariantKind<typeof CONFIRM_FINISHED_SETUP, boolean>
    | VariantKind<typeof SKIP_SETUP, null>
    | VariantKind<typeof SELECT_SESSION, string>
    | VariantKind<typeof CHANGE_SESSION, null>
    ;

export function useRouteContext() {
    const location = useLocation();
    const route = location.state as RouteContext;
    if (!route) {
        return {
            appLoadingStatus: AppLoadingStatus.NOT_STARTED,
            confirmedFinishedSetup: false,
            sessionId: null,
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
                        sessionId: route.value ?? null,
                    }
                });
                break;
            case NOTEBOOK_PATH:
                navigate("/notebook", {
                    state: {
                        ...context,
                        sessionId: route.value ?? null,
                    }
                });
                break;
            case TOOL_PATH:
                navigate("/tool", {
                    state: {
                        ...context,
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
                        sessionId: null,
                    }
                });
                break;
            case SELECT_SESSION:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        sessionId: route.value,
                    }
                });
                break;
            case CHANGE_SESSION:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        sessionId: null,
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
