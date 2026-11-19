import { ProgressCounter } from "@akohn/dashql/platform/utils/progress";

export type AppLoadingProgressConsumer = (progress: AppLoadingProgress) => void;

export interface AppLoadingProgress {
    /// Restore the connections
    restoreConnections: ProgressCounter;
    /// Restore the catalogs
    restoreCatalogs: ProgressCounter;
    /// Restore the workbook scripts
    restoreWorkbookScripts: ProgressCounter;
}
