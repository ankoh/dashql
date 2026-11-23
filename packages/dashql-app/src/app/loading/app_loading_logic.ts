import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { AppSetupPhase } from './app_setup.js';

/// Does the app show the workbook of the route? Once it is set up, and the user confirmed the setup if the app pauses
/// after it.
export function canShowWorkbook(setup: { phase: AppSetupPhase; confirmed: boolean; pauseAfterSetup: boolean }, workbookId: string | null): boolean {
    return setup.phase === 'opened'
        && workbookId != null
        && (!setup.pauseAfterSetup || setup.confirmed);
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
