import * as React from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import { VariantKind } from "./utils/variant.js";
import { AppLoadingStatus } from './app_loading_status.js';
import { SessionSetupStatus } from './session_setup_status.js';
import { LoggableException } from './platform/logger/logger.js';

export interface RouteContext {
    /// The app loading status
    appLoadingStatus: AppLoadingStatus;
    /// Confirmed the finished setup?
    confirmedFinishedSetup: boolean;
    /// The focused session id (replaces both connectionId and notebookId)
    sessionId: string | null;
    /// The session setup status
    sessionSetupStatus: SessionSetupStatus;
}

export const NOTEBOOK_PATH = Symbol("NAVIGATE_NOTEBOOK");
export const TOOL_PATH = Symbol("NAVIGATE_TOOLS");
export const FINISH_SETUP = Symbol("FINISH_SETUP");
export const CONFIRM_FINISHED_SETUP = Symbol("CONFIRM_FINISHED_SETUP");
export const SKIP_SETUP = Symbol("SKIP_SETUP");
export const SELECT_SESSION = Symbol("SELECT_SESSION");
export const CHANGE_SESSION = Symbol("CHANGE_SESSION");
export const BEGIN_SESSION_SETUP = Symbol("BEGIN_SESSION_SETUP");
export const CANCEL_SESSION_SETUP = Symbol("CANCEL_SESSION_SETUP");
export const SKIP_SESSION_SETUP = Symbol("SKIP_SESSION_SETUP");

export type RouteTarget =
    VariantKind<typeof NOTEBOOK_PATH, string | null>
    | VariantKind<typeof TOOL_PATH, null>
    | VariantKind<typeof FINISH_SETUP, null>
    | VariantKind<typeof CONFIRM_FINISHED_SETUP, boolean>
    | VariantKind<typeof SKIP_SETUP, null>
    | VariantKind<typeof SELECT_SESSION, string>
    | VariantKind<typeof CHANGE_SESSION, null>
    | VariantKind<typeof BEGIN_SESSION_SETUP, string>
    | VariantKind<typeof CANCEL_SESSION_SETUP, null>
    | VariantKind<typeof SKIP_SESSION_SETUP, null>
    ;

export function useRouteContext() {
    const location = useLocation();
    const route = location.state as RouteContext;
    if (!route) {
        return {
            appLoadingStatus: AppLoadingStatus.NOT_STARTED,
            confirmedFinishedSetup: false,
            sessionId: null,
            sessionSetupStatus: SessionSetupStatus.NONE,
        };
    } else {
        return {
            ...route,
            sessionSetupStatus: route.sessionSetupStatus ?? SessionSetupStatus.NONE,
        };
    }
}

export function useRouterNavigate() {
    const navigate = useNavigate();
    const location = useLocation();
    const context = useRouteContext();
    return React.useCallback((route: RouteTarget) => {
        switch (route.type) {
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
                        sessionSetupStatus: SessionSetupStatus.NONE,
                    }
                });
                break;
            case SELECT_SESSION:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        sessionId: route.value,
                        sessionSetupStatus: SessionSetupStatus.NONE,
                    }
                });
                break;
            case CHANGE_SESSION:
                navigate("/", {
                    state: {
                        ...context,
                        sessionId: null,
                        sessionSetupStatus: SessionSetupStatus.NONE,
                    }
                });
                break;
            case BEGIN_SESSION_SETUP:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        sessionId: route.value,
                        sessionSetupStatus: SessionSetupStatus.CONFIGURING,
                    }
                });
                break;
            case CANCEL_SESSION_SETUP:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        sessionId: null,
                        sessionSetupStatus: SessionSetupStatus.NONE,
                    }
                });
                break;
            case SKIP_SESSION_SETUP:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        sessionSetupStatus: SessionSetupStatus.NONE,
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
