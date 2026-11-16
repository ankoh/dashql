import type * as core from '@ankoh/dashql';
import { TracedLogger } from '@ankoh/dashql/platform/platform/logger/logger';
import { AppLoadingProgress, AppLoadingProgressConsumer } from './app_loading_progress.js';
import { ProgressCounter } from '@ankoh/dashql/platform/utils/progress';
import type { InvalidWorkbook } from '../../workbook/workbook_lifecycle.js';
import { AppLoadingStatus } from './app_loading_status.js';
import type { RouteContext } from '../router/router.js';
import { isEphemeralWorkbook, type WorkbookScripts } from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';

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
    /// The connections that the runtime restored, in the order of the app manifest
    restoredConnections: string[];
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

/// What a restore of the persisted app state restored into the runtime
export interface RestoredAppState {
    /// The connections that the runtime took, in the order of the app manifest
    connectionIds: string[];
    /// The workbooks that the runtime took, in the order of the workbook tree
    workbooks: ReadonlyMap<string, WorkbookScripts>;
    /// The workbooks that were refused a load (keyed by bare UUID)
    invalidWorkbooks: Map<string, InvalidWorkbook>;
}

/// Restores the persisted app state
export interface AppStateRestorer {
    /// Restore the connections and the workbooks into the runtime
    restoreAppState(progressConsumer: (progress: AppLoadingProgress) => void): Promise<RestoredAppState>;
}

/// A counter of the progress of a restore of the runtime
function progressCounter(counter: core.RestoreProgressCounter): ProgressCounter {
    const out = new ProgressCounter(counter.total);
    out.started = counter.started;
    out.succeeded = counter.succeeded;
    out.skipped = counter.skipped;
    out.failed = counter.failed;
    return out;
}

/// The progress of a restore of the runtime as the loading page shows it
export function restoreProgress(progress: core.RestoreProgress): AppLoadingProgress {
    return {
        restoreConnections: progressCounter(progress.restoreConnections),
        restoreCatalogs: progressCounter(progress.restoreCatalogs),
        restoreWorkbookScripts: progressCounter(progress.restoreWorkbookScripts),
    };
}

/// Main logic to setup the application
export async function loadApp(logger: TracedLogger, storage: AppStateRestorer, consumer: AppLoadingProgressConsumer) {
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
    const state = await storage.restoreAppState(partialProgressConsumer);

    const restoreDuration = performance.now() - restoreStartTime;
    traced.info("Restored application state", {
        connections: state.connectionIds.length.toString(),
        workbooks: state.workbooks.size.toString(),
        durationMs: restoreDuration.toFixed(2)
    }, "app_loading");

    const totalAppLoadDuration = performance.now() - appLoadStartTime;
    traced.info("Application loading complete", {
        totalDurationMs: totalAppLoadDuration.toFixed(2)
    }, "app_loading");

    return {
        invalidWorkbooks: state.invalidWorkbooks,
        restoredWorkbooks: state.workbooks,
        restoredConnections: state.connectionIds,
    };
}
