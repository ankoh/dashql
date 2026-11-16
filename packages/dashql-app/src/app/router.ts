import * as React from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import { VariantKind } from "@akohn/dashql/platform/utils/variant";
import { AppLoadingStatus } from './loading/app_loading_status.js';
import { WorkbookSetupStatus } from './loading/workbook_setup_status.js';
import { LoggableException } from '@akohn/dashql/platform/logger/logger';

export interface RouteContext {
    /// The app loading status
    appLoadingStatus: AppLoadingStatus;
    /// Confirmed the finished setup?
    confirmedFinishedSetup: boolean;
    /// The focused workbook id
    workbookId: string | null;
    /// The workbook setup status
    workbookSetupStatus: WorkbookSetupStatus;
}

export const WORKBOOK_PATH = Symbol("NAVIGATE_WORKBOOK");
export const FINISH_SETUP = Symbol("FINISH_SETUP");
export const CONFIRM_FINISHED_SETUP = Symbol("CONFIRM_FINISHED_SETUP");
export const SKIP_SETUP = Symbol("SKIP_SETUP");
export const SELECT_WORKBOOK = Symbol("SELECT_WORKBOOK");
export const CHANGE_WORKBOOK = Symbol("CHANGE_WORKBOOK");
export const BEGIN_WORKBOOK_SETUP = Symbol("BEGIN_WORKBOOK_SETUP");
export const CANCEL_WORKBOOK_SETUP = Symbol("CANCEL_WORKBOOK_SETUP");
export const SKIP_WORKBOOK_SETUP = Symbol("SKIP_WORKBOOK_SETUP");
export const OPEN_LINK_WORKBOOK = Symbol("OPEN_LINK_WORKBOOK");
export const OPEN_WORKBOOK = Symbol("OPEN_WORKBOOK");
export const OPEN_EPHEMERAL_WORKBOOK = Symbol("OPEN_EPHEMERAL_WORKBOOK");
export const PROMOTE_WORKBOOK = Symbol("PROMOTE_WORKBOOK");

export function workbookPath(workbookId: string): string {
    return `/workbooks/${encodeURIComponent(workbookId)}`;
}

export function workbookIdFromPathname(pathname: string): string | null {
    const match = /^\/workbooks\/([^/]+)\/?$/.exec(pathname);
    if (match == null) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return null;
    }
}

export type RouteTarget =
    VariantKind<typeof WORKBOOK_PATH, string | null>
    | VariantKind<typeof FINISH_SETUP, null>
    | VariantKind<typeof CONFIRM_FINISHED_SETUP, boolean>
    | VariantKind<typeof SKIP_SETUP, null>
    | VariantKind<typeof SELECT_WORKBOOK, string>
    | VariantKind<typeof CHANGE_WORKBOOK, null>
    | VariantKind<typeof BEGIN_WORKBOOK_SETUP, string>
    | VariantKind<typeof CANCEL_WORKBOOK_SETUP, null>
    | VariantKind<typeof SKIP_WORKBOOK_SETUP, null>
    | VariantKind<typeof OPEN_LINK_WORKBOOK, string>
    | VariantKind<typeof OPEN_WORKBOOK, string>
    | VariantKind<typeof OPEN_EPHEMERAL_WORKBOOK, string>
    | VariantKind<typeof PROMOTE_WORKBOOK, string>
    ;

export function useRouteContext() {
    const location = useLocation();
    const route = location.state as RouteContext;
    const pathname = location.pathname;
    // Memoized on the location, callers depend on the context in callbacks and effects
    return React.useMemo(() => {
        if (!route) {
            return {
                appLoadingStatus: AppLoadingStatus.NOT_STARTED,
                confirmedFinishedSetup: false,
                workbookId: workbookIdFromPathname(pathname),
                workbookSetupStatus: WorkbookSetupStatus.NONE,
            };
        } else {
            return {
                ...route,
                workbookSetupStatus: route.workbookSetupStatus ?? WorkbookSetupStatus.NONE,
            };
        }
    }, [route, pathname]);
}

export function useRouterNavigate() {
    const navigate = useNavigate();
    const location = useLocation();
    const context = useRouteContext();
    return React.useCallback((route: RouteTarget) => {
        switch (route.type) {
            case WORKBOOK_PATH:
                navigate(route.value == null ? "/" : workbookPath(route.value), {
                    state: {
                        ...context,
                        workbookId: route.value ?? null,
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
                        workbookId: null,
                        workbookSetupStatus: WorkbookSetupStatus.NONE,
                    }
                });
                break;
            case SELECT_WORKBOOK:
                navigate(workbookPath(route.value), {
                    state: {
                        ...context,
                        workbookId: route.value,
                        workbookSetupStatus: WorkbookSetupStatus.NONE,
                    }
                });
                break;
            case OPEN_WORKBOOK:
                navigate(workbookPath(route.value), {
                    state: {
                        ...context,
                        workbookId: route.value,
                        workbookSetupStatus: WorkbookSetupStatus.OPENING,
                    }
                });
                break;
            case CHANGE_WORKBOOK:
                navigate("/", {
                    state: {
                        ...context,
                        workbookId: null,
                        workbookSetupStatus: WorkbookSetupStatus.NONE,
                    }
                });
                break;
            case BEGIN_WORKBOOK_SETUP:
                navigate(workbookPath(route.value), {
                    state: {
                        ...context,
                        workbookId: route.value,
                        workbookSetupStatus: WorkbookSetupStatus.CONFIGURING,
                    }
                });
                break;
            case CANCEL_WORKBOOK_SETUP:
                navigate("/", {
                    state: {
                        ...context,
                        workbookId: null,
                        workbookSetupStatus: WorkbookSetupStatus.NONE,
                    }
                });
                break;
            case SKIP_WORKBOOK_SETUP:
                navigate(location.pathname, {
                    state: {
                        ...context,
                        workbookSetupStatus: WorkbookSetupStatus.NONE,
                    }
                });
                break;
            case OPEN_LINK_WORKBOOK:
                // A workbook arrived via a shared link and has been restored into the registries.
                // Start the common opening flow atomically so embedded connections can initialize
                // without briefly showing the connection setup screen.
                navigate(workbookPath(route.value), {
                    state: {
                        appLoadingStatus: AppLoadingStatus.SETUP_DONE,
                        confirmedFinishedSetup: false,
                        workbookId: route.value,
                        workbookSetupStatus: WorkbookSetupStatus.OPENING,
                    }
                });
                break;
            case OPEN_EPHEMERAL_WORKBOOK:
                // The greeter stays at the root until a script promotes the workbook. The startup replaces its entry:
                // going back to it would find a root without a route context and show the loading page.
                // The status is not OPENING, the loader would open the path of the workbook.
                navigate("/", {
                    replace: location.pathname === "/",
                    state: {
                        appLoadingStatus: AppLoadingStatus.SETUP_DONE,
                        confirmedFinishedSetup: context.confirmedFinishedSetup,
                        workbookId: route.value,
                        workbookSetupStatus: WorkbookSetupStatus.NONE,
                    }
                });
                break;
            case PROMOTE_WORKBOOK:
                // Replaces the root, going back would promote the workbook again
                navigate(workbookPath(route.value), {
                    replace: true,
                    state: {
                        ...context,
                        workbookId: route.value,
                        workbookSetupStatus: WorkbookSetupStatus.NONE,
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
