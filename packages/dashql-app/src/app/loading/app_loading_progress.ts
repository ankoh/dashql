import { ProgressCounter } from "@akohn/dashql/platform/utils/progress";

/// The progress of the restore that the loading page shows
export interface AppLoadingProgress {
    /// Restore the connections
    restoreConnections: ProgressCounter;
    /// Restore the workbook scripts
    restoreWorkbookScripts: ProgressCounter;
}

/// The progress before the restore started
export function initialLoadingProgress(): AppLoadingProgress {
    return {
        restoreConnections: new ProgressCounter(),
        restoreWorkbookScripts: new ProgressCounter(),
    };
}
