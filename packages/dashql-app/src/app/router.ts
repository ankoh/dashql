import * as React from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import { VariantKind } from "@akohn/dashql/platform/utils/variant";
import { LoggableException } from '@akohn/dashql/platform/logger/logger';

export interface RouteContext {
    /// Did the setup of the app finish?
    setupDone: boolean;
    /// Confirmed the finished setup?
    confirmedFinishedSetup: boolean;
    /// The focused workbook id
    workbookId: string | null;
    /// Is the workbook being opened? The app loader selects it once the app is set up.
    openingWorkbook: boolean;
}

export const WORKBOOK_PATH = Symbol("NAVIGATE_WORKBOOK");
export const CONFIRM_FINISHED_SETUP = Symbol("CONFIRM_FINISHED_SETUP");
export const SELECT_WORKBOOK = Symbol("SELECT_WORKBOOK");
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
    | VariantKind<typeof CONFIRM_FINISHED_SETUP, boolean>
    | VariantKind<typeof SELECT_WORKBOOK, string>
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
                setupDone: false,
                confirmedFinishedSetup: false,
                workbookId: workbookIdFromPathname(pathname),
                openingWorkbook: false,
            };
        } else {
            return {
                ...route,
                openingWorkbook: route.openingWorkbook ?? false,
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
            case SELECT_WORKBOOK:
                navigate(workbookPath(route.value), {
                    state: {
                        ...context,
                        workbookId: route.value,
                        openingWorkbook: false,
                    }
                });
                break;
            case OPEN_WORKBOOK:
                navigate(workbookPath(route.value), {
                    state: {
                        ...context,
                        workbookId: route.value,
                        openingWorkbook: true,
                    }
                });
                break;
            case OPEN_LINK_WORKBOOK:
                // A workbook arrived via a shared link and has been restored into the registries.
                // Start the common opening flow atomically so embedded connections can initialize
                // without briefly showing the connection setup screen.
                navigate(workbookPath(route.value), {
                    state: {
                        setupDone: true,
                        confirmedFinishedSetup: false,
                        workbookId: route.value,
                        openingWorkbook: true,
                    }
                });
                break;
            case OPEN_EPHEMERAL_WORKBOOK:
                // The greeter stays at the root until a script promotes the workbook. The startup replaces its entry:
                // going back to it would find a root without a route context and show the loading page.
                // The workbook is not opening, the loader would open the path of the workbook.
                navigate("/", {
                    replace: location.pathname === "/",
                    state: {
                        setupDone: true,
                        confirmedFinishedSetup: context.confirmedFinishedSetup,
                        workbookId: route.value,
                        openingWorkbook: false,
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
                        openingWorkbook: false,
                    }
                });
                break;
            case CONFIRM_FINISHED_SETUP:
                if (!context.setupDone) {
                    throw new LoggableException("tried to confirm a non-finished setup");
                }
                navigate(location.pathname, {
                    state: {
                        ...context,
                        setupDone: true,
                        confirmedFinishedSetup: route.value,
                    }
                });
                break;
        }
    }, [navigate, context, location]);
}
