import { ProgressCounter } from "../../shared/utils/progress.js";

export type AppLoadingPartialProgressConsumer = (progress: Partial<AppLoadingProgress>) => void;
export type AppLoadingProgressConsumer = (progress: AppLoadingProgress) => void;

export interface AppLoadingProgress {
    /// Restore the connections
    restoreConnections: ProgressCounter;
    /// Restore the catalogs
    restoreCatalogs: ProgressCounter;
    /// Restore the notebook scripts
    restoreNotebookScripts: ProgressCounter;
    /// Analyze the restored scripts
    analyzeScripts: ProgressCounter;
    /// Setup default connections
    setupDefaultConnections: ProgressCounter;
    /// Setup defualt notebooks
    setupDefaultNotebooks: ProgressCounter;
}
