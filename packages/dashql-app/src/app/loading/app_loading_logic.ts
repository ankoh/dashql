import * as dashql from '@ankoh/dashql-core';

import { TracedLogger } from '@ankoh/dashql-sdk/platform/logger/logger';
import type { AppStateRestorationProgress, RestoredAppState } from '../../workbook/persistence/app_state_loader.js';
import { AppLoadingProgress, AppLoadingProgressConsumer } from './app_loading_progress.js';
import { SetConnectionRegistryAction } from '../../connections/connection_registry.js';
import type { ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { Dispatch } from '@ankoh/dashql-sdk/utils/variant';
import { SetWorkbookScriptsRegistryAction } from '../../workbook/scripts/workbook_scripts_registry.js';
import { ProgressCounter } from '../../utils/progress.js';
import { InvalidWorkbook } from '@ankoh/dashql-sdk/storage/workbook_validation';
import { AppLoadingStatus } from './app_loading_status.js';
import type { RouteContext } from '../router/router.js';
import { isEphemeralWorkbook, type WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';

export function canShowWorkbook(route: RouteContext, pauseAfterSetup: boolean): boolean {
    return route.appLoadingStatus === AppLoadingStatus.SETUP_DONE
        && route.workbookId != null
        && (!pauseAfterSetup || route.confirmedFinishedSetup);
}

export interface AppLoadingResult {
    /// Workbooks whose metadata failed validation and were refused a load (keyed by bare UUID).
    invalidWorkbooks: Map<string, InvalidWorkbook>;
    /// Valid restored workbooks in persisted manifest order.
    restoredWorkbooks: ReadonlyMap<string, WorkbookScripts>;
    /// The restored connections
    restoredConnections: Map<string, ConnectionState>;
}

/// The workbook that the app opens with: the restored workbook of the path, otherwise the app opens the greeter
export function selectStartupWorkbook(
    requestedWorkbookId: string | null,
    restoredWorkbooks: ReadonlyMap<string, WorkbookScripts>,
): string | null {
    const requested = requestedWorkbookId == null ? undefined : restoredWorkbooks.get(requestedWorkbookId);
    return requested != null && !isEphemeralWorkbook(requested) ? requested.workbookId : null;
}

/// Delete the ephemeral workbooks beyond the first one, the app keeps a single one.
/// A workbook that cannot be deleted is reported and the next launch deletes it again, it stays hidden until then.
export async function deleteSurplusEphemeralWorkbooks(
    workbooks: Iterable<WorkbookScripts>,
    deleteWorkbook: (workbookId: string) => Promise<void>,
    onFailure: (workbookId: string, error: unknown) => void,
): Promise<void> {
    for (const { workbookId } of [...workbooks].filter(isEphemeralWorkbook).slice(1)) {
        try {
            await deleteWorkbook(workbookId);
        } catch (error) {
            onFailure(workbookId, error);
        }
    }
}

export async function shouldFinishInitialNavigation(initialInlineSetup: Promise<boolean> | null): Promise<boolean> {
    return initialInlineSetup == null || !await initialInlineSetup;
}

/// Restores the persisted app state
export interface AppStateRestorer {
    /// Restore the connections and workbooks
    restoreAppState(core: dashql.DashQL, progressConsumer: (progress: AppStateRestorationProgress) => void): Promise<RestoredAppState>;
}

/// Main logic to setup the application
export async function loadApp(logger: TracedLogger, core: dashql.DashQL, storage: AppStateRestorer, resetConnections: Dispatch<SetConnectionRegistryAction>, resetWorkbookScripts: Dispatch<SetWorkbookScriptsRegistryAction>, consumer: AppLoadingProgressConsumer) {
    const traced = logger.childSpan();
    traced.info("Loading application", {}, "app_loading");
    const appLoadStartTime = performance.now();

    let progress: AppLoadingProgress = {
        restoreConnections: new ProgressCounter(),
        restoreCatalogs: new ProgressCounter(),
        restoreWorkbookScripts: new ProgressCounter(),
    };
    const partialProgressConsumer = (update: Partial<AppLoadingProgress>) => {
        progress = {
            ...progress,
            ...update
        };
        consumer(progress);
    };

    traced.info("Restoring application state", {}, "app_loading");
    const restoreStartTime = performance.now();

    /// First restore the previous app state
    const state = await storage.restoreAppState(core, partialProgressConsumer);

    const restoreDuration = performance.now() - restoreStartTime;
    traced.info("Restored application state", {
        connections: state.connectionStates.size.toString(),
        workbooks: state.workbookScripts.size.toString(),
        durationMs: restoreDuration.toFixed(2)
    }, "app_loading");

    // Reset the connection registry
    traced.info("Updating connection registry", {
        connectionCount: state.connectionStates.size.toString()
    }, "app_loading");
    resetConnections({
        connections: state.connectionStates,
        connectionsByType: state.connectionStatesByType,
    });

    // Reset the workbook scripts registry
    traced.info("Updating workbook scripts registry", {
        workbookCount: state.workbookScripts.size.toString()
    }, "app_loading");
    resetWorkbookScripts({
        workbookScriptsMap: state.workbookScripts,
        workbookScriptsByConnection: state.workbookScriptsByConnection,
        invalidWorkbooks: state.invalidWorkbooks,
    });

    const totalAppLoadDuration = performance.now() - appLoadStartTime;
    traced.info("Application loading complete", {
        totalDurationMs: totalAppLoadDuration.toFixed(2)
    }, "app_loading");

    return {
        invalidWorkbooks: state.invalidWorkbooks,
        restoredWorkbooks: state.workbookScripts,
        restoredConnections: state.connectionStates,
    };
}
