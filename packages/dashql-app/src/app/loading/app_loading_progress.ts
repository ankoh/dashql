import { ProgressCounter } from "@ankoh/dashql-sdk/utils/progress";

export type AppLoadingPartialProgressConsumer = (progress: Partial<AppLoadingProgress>) => void;
export type AppLoadingProgressConsumer = (progress: AppLoadingProgress) => void;

export interface AppLoadingProgress {
    /// Restore the connections
    restoreConnections: ProgressCounter;
    /// Restore the catalogs
    restoreCatalogs: ProgressCounter;
    /// Restore the workbook scripts
    restoreWorkbookScripts: ProgressCounter;
}
