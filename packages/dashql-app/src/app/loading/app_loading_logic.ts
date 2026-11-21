import type * as core from '@akohn/dashql';
import type { AppLoadingProgress } from './app_loading_progress.js';
import { ProgressCounter } from '@akohn/dashql/platform/utils/progress';
import type { RouteContext } from '../router.js';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';

export function canShowWorkbook(route: RouteContext, pauseAfterSetup: boolean): boolean {
    return route.setupDone
        && route.workbookId != null
        && (!pauseAfterSetup || route.confirmedFinishedSetup);
}

/// The workbook that the app opens with: the restored workbook of the path, otherwise the app opens the greeter
export function selectStartupWorkbook(
    requestedWorkbookId: string | null,
    restoredWorkbooks: ReadonlyMap<string, WorkbookScripts>,
): string | null {
    const requested = requestedWorkbookId == null ? undefined : restoredWorkbooks.get(requestedWorkbookId);
    return requested != null && !requested.ephemeral ? requested.workbookId : null;
}

/// Delete the ephemeral workbooks beyond the first one, the app keeps a single one.
/// A workbook that cannot be deleted is reported and the next launch deletes it again, it stays hidden until then.
export async function deleteSurplusEphemeralWorkbooks(
    workbooks: Iterable<WorkbookScripts>,
    deleteWorkbook: (workbookId: string) => Promise<void>,
    onFailure: (workbookId: string, error: unknown) => void,
): Promise<void> {
    for (const { workbookId } of [...workbooks].filter(workbook => workbook.ephemeral).slice(1)) {
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
        restoreWorkbookScripts: progressCounter(progress.restoreWorkbookScripts),
    };
}
