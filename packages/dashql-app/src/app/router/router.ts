import * as React from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import { VariantKind } from "../../shared/utils/variant.js";
import { AppLoadingStatus } from './app_loading_status.js';
import { NotebookSetupStatus } from './notebook_setup_status.js';
import { LoggableException } from '../../shared/platform/logger/logger.js';

export interface RouteContext {
    /// The app loading status
    appLoadingStatus: AppLoadingStatus;
    /// Confirmed the finished setup?
    confirmedFinishedSetup: boolean;
    /// The focused notebook id
    notebookId: string | null;
    /// The notebook setup status
    notebookSetupStatus: NotebookSetupStatus;
}

export const NOTEBOOK_PATH = Symbol("NAVIGATE_NOTEBOOK");
export const TOOL_PATH = Symbol("NAVIGATE_TOOLS");
export const FINISH_SETUP = Symbol("FINISH_SETUP");
export const CONFIRM_FINISHED_SETUP = Symbol("CONFIRM_FINISHED_SETUP");
export const SKIP_SETUP = Symbol("SKIP_SETUP");
export const SELECT_NOTEBOOK = Symbol("SELECT_NOTEBOOK");
export const CHANGE_NOTEBOOK = Symbol("CHANGE_NOTEBOOK");
export const BEGIN_NOTEBOOK_SETUP = Symbol("BEGIN_NOTEBOOK_SETUP");
export const CANCEL_NOTEBOOK_SETUP = Symbol("CANCEL_NOTEBOOK_SETUP");
export const SKIP_NOTEBOOK_SETUP = Symbol("SKIP_NOTEBOOK_SETUP");
export const OPEN_LINK_NOTEBOOK = Symbol("OPEN_LINK_NOTEBOOK");

export type RouteTarget =
    VariantKind<typeof NOTEBOOK_PATH, string | null>
    | VariantKind<typeof TOOL_PATH, null>
    | VariantKind<typeof FINISH_SETUP, null>
    | VariantKind<typeof CONFIRM_FINISHED_SETUP, boolean>
    | VariantKind<typeof SKIP_SETUP, null>
    | VariantKind<typeof SELECT_NOTEBOOK, string>
    | VariantKind<typeof CHANGE_NOTEBOOK, null>
    | VariantKind<typeof BEGIN_NOTEBOOK_SETUP, string>
    | VariantKind<typeof CANCEL_NOTEBOOK_SETUP, null>
    | VariantKind<typeof SKIP_NOTEBOOK_SETUP, null>
    | VariantKind<typeof OPEN_LINK_NOTEBOOK, string>
    ;

export function useRouteContext() {
    const location = useLocation();
    const route = location.state as RouteContext;
    if (!route) {
        return {
            appLoadingStatus: AppLoadingStatus.NOT_STARTED,
            confirmedFinishedSetup: false,
            notebookId: null,
            notebookSetupStatus: NotebookSetupStatus.NONE,
        };
    } else {
        return {
            ...route,
            notebookSetupStatus: route.notebookSetupStatus ?? NotebookSetupStatus.NONE,
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
                        notebookId: route.value ?? null,
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
                        notebookId: null,
                        notebookSetupStatus: NotebookSetupStatus.NONE,
                    }
                });
                break;
            case SELECT_NOTEBOOK:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        notebookId: route.value,
                        notebookSetupStatus: NotebookSetupStatus.NONE,
                    }
                });
                break;
            case CHANGE_NOTEBOOK:
                navigate("/", {
                    state: {
                        ...context,
                        notebookId: null,
                        notebookSetupStatus: NotebookSetupStatus.NONE,
                    }
                });
                break;
            case BEGIN_NOTEBOOK_SETUP:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        notebookId: route.value,
                        notebookSetupStatus: NotebookSetupStatus.CONFIGURING,
                    }
                });
                break;
            case CANCEL_NOTEBOOK_SETUP:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        notebookId: null,
                        notebookSetupStatus: NotebookSetupStatus.NONE,
                    }
                });
                break;
            case SKIP_NOTEBOOK_SETUP:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        notebookSetupStatus: NotebookSetupStatus.NONE,
                    }
                });
                break;
            case OPEN_LINK_NOTEBOOK:
                // A notebook arrived via a shared link (URL / deep-link) and has been restored into
                // the registries. Land directly on that notebook's connection setup screen: finish
                // app setup AND select the notebook with CONFIGURING in a single atomic state, so it
                // doesn't depend on the (possibly stale) prior route context the way chained
                // FINISH_SETUP + BEGIN_NOTEBOOK_SETUP navigations would. The notebook selector renders
                // the connection config card whenever notebookSetupStatus is CONFIGURING.
                navigate(location.pathname, {
                    state: {
                        appLoadingStatus: AppLoadingStatus.SETUP_DONE,
                        confirmedFinishedSetup: false,
                        notebookId: route.value,
                        notebookSetupStatus: NotebookSetupStatus.CONFIGURING,
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
