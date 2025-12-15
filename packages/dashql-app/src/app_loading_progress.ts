import { ProgressCounter } from "./utils/progress.js";

export type AppLoadingProgressConsumer = (progress: AppLoadingProgress) => void;

export interface AppLoadingProgress {
    /// Restore the connections
    restoreConnections: ProgressCounter;
    /// Restore the catalogs
    restoreCatalogs: ProgressCounter;
    /// Restore the workbooks
    restoreWorkbooks: ProgressCounter;
}
