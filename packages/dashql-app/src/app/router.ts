import * as React from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import { VariantKind } from "@akohn/dashql/platform/utils/variant";

/// The workbook of a route. The setup of the app is not part of it, the app loader holds it.
export interface RouteContext {
    /// The focused workbook id
    workbookId: string | null;
    /// Is the workbook being opened? The app loader selects it once the app is set up.
    openingWorkbook: boolean;
    /// The workbook that was just imported from outside the app, a dropped file or a shared link. While it shows, its
    /// dashboard or dataflow opens without the workbench. Where the workbook comes from decides that, not the workbook.
    importedWorkbookId?: string | null;
}

export const WORKBOOK_PATH = Symbol("NAVIGATE_WORKBOOK");
export const SELECT_WORKBOOK = Symbol("SELECT_WORKBOOK");
export const OPEN_LINK_WORKBOOK = Symbol("OPEN_LINK_WORKBOOK");
export const OPEN_IMPORTED_WORKBOOK = Symbol("OPEN_IMPORTED_WORKBOOK");
export const SELECT_IMPORTED_WORKBOOK = Symbol("SELECT_IMPORTED_WORKBOOK");
export const SETTLE_IMPORTED_WORKBOOK = Symbol("SETTLE_IMPORTED_WORKBOOK");
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
    | VariantKind<typeof SELECT_WORKBOOK, string>
    | VariantKind<typeof OPEN_LINK_WORKBOOK, string>
    | VariantKind<typeof OPEN_IMPORTED_WORKBOOK, string>
    | VariantKind<typeof SELECT_IMPORTED_WORKBOOK, string>
    | VariantKind<typeof SETTLE_IMPORTED_WORKBOOK, null>
    | VariantKind<typeof OPEN_WORKBOOK, string>
    | VariantKind<typeof OPEN_EPHEMERAL_WORKBOOK, string>
    | VariantKind<typeof PROMOTE_WORKBOOK, string>
    ;

/// The imported workbook of a route stays imported only while the route keeps showing it
function keptImport(context: RouteContext, workbookId: string | null): string | null {
    return context.importedWorkbookId != null && context.importedWorkbookId === workbookId ? context.importedWorkbookId : null;
}

export function useRouteContext() {
    const location = useLocation();
    const route = location.state as RouteContext;
    const pathname = location.pathname;
    // Memoized on the location, callers depend on the context in callbacks and effects
    return React.useMemo(() => {
        if (!route) {
            return {
                workbookId: workbookIdFromPathname(pathname),
                openingWorkbook: false,
                importedWorkbookId: null,
            };
        } else {
            return {
                workbookId: route.workbookId ?? null,
                openingWorkbook: route.openingWorkbook ?? false,
                importedWorkbookId: route.importedWorkbookId ?? null,
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
                        workbookId: route.value ?? null,
                        openingWorkbook: context.openingWorkbook,
                        importedWorkbookId: keptImport(context, route.value),
                    } satisfies RouteContext
                });
                break;
            case SELECT_WORKBOOK:
                navigate(workbookPath(route.value), {
                    state: {
                        workbookId: route.value,
                        openingWorkbook: false,
                        importedWorkbookId: keptImport(context, route.value),
                    } satisfies RouteContext
                });
                break;
            case OPEN_WORKBOOK:
                navigate(workbookPath(route.value), {
                    state: {
                        workbookId: route.value,
                        openingWorkbook: true,
                        importedWorkbookId: keptImport(context, route.value),
                    } satisfies RouteContext
                });
                break;
            case OPEN_LINK_WORKBOOK:
                // A workbook arrived via a shared link and has been restored into the registries.
                // Start the common opening flow atomically so embedded connections can initialize
                // without briefly showing the connection setup screen.
                navigate(workbookPath(route.value), {
                    state: {
                        workbookId: route.value,
                        openingWorkbook: true,
                        importedWorkbookId: null,
                    } satisfies RouteContext
                });
                break;
            case OPEN_IMPORTED_WORKBOOK:
                // Like a link workbook, a dropped file or a shared link that the user just imported. The workbook
                // remembers in the route where it came from, see `importedWorkbookId`.
                navigate(workbookPath(route.value), {
                    state: {
                        workbookId: route.value,
                        openingWorkbook: true,
                        importedWorkbookId: route.value,
                    } satisfies RouteContext
                });
                break;
            case SELECT_IMPORTED_WORKBOOK:
                // Like a selected workbook, one that the running app just imported, e.g. a version of a published
                // workbook that opens from its cloud
                navigate(workbookPath(route.value), {
                    state: {
                        workbookId: route.value,
                        openingWorkbook: false,
                        importedWorkbookId: route.value,
                    } satisfies RouteContext
                });
                break;
            case SETTLE_IMPORTED_WORKBOOK:
                // The imported workbook becomes one like any other, e.g. once the user shows the workbench. Keeps the
                // view of the URL.
                navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, {
                    replace: true,
                    state: {
                        workbookId: context.workbookId,
                        openingWorkbook: context.openingWorkbook,
                        importedWorkbookId: null,
                    } satisfies RouteContext
                });
                break;
            case OPEN_EPHEMERAL_WORKBOOK:
                // The greeter stays at the root until a script promotes the workbook. The startup replaces its entry:
                // going back to it would find a root without a route context and show the loading page.
                // The workbook is not opening, the loader would open the path of the workbook.
                navigate("/", {
                    replace: location.pathname === "/",
                    state: {
                        workbookId: route.value,
                        openingWorkbook: false,
                        importedWorkbookId: null,
                    } satisfies RouteContext
                });
                break;
            case PROMOTE_WORKBOOK:
                // Replaces the root, going back would promote the workbook again
                navigate(workbookPath(route.value), {
                    replace: true,
                    state: {
                        workbookId: route.value,
                        openingWorkbook: false,
                        importedWorkbookId: keptImport(context, route.value),
                    } satisfies RouteContext
                });
                break;
        }
    }, [navigate, context, location]);
}

/// Select the workbook that is opening, once the app shows it, see `openingWorkbook` of the route context. The app
/// loader does it.
export function useSelectOpeningWorkbook(): void {
    const navigate = useRouterNavigate();
    const context = useRouteContext();
    React.useEffect(() => {
        if (context.openingWorkbook && context.workbookId != null) {
            navigate({ type: SELECT_WORKBOOK, value: context.workbookId });
        }
    }, [navigate, context.workbookId, context.openingWorkbook]);
}
