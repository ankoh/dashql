import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';
import * as baseStyles from '../../shared/ui/banner/banner_page.module.css';
import * as styles from './file_loader.module.css';

import { IndicatorStatus, StatusIndicator } from '../../shared/ui/foundations/status_indicator.js';
import { PlatformFile } from "../../shared/platform/file/file.js";
import { classNames } from '../../shared/utils/classnames.js';
import { formatBytes } from '../../shared/utils/format.js';
import { useRouterNavigate, NOTEBOOK_PATH } from '../router/router.js';
import { useStorageReader } from '../notebook/persistence/storage_provider.js';
import { importAndRestoreNotebook } from '../loading/app_setup_events.js';
import { destroyRestoredNotebook, type RestoredNotebook } from '../notebook/persistence/app_state_loader.js';
import { useDashQLCoreSetup } from '../providers/core_provider.js';
import { useLogger } from '../../shared/platform/logger/logger_provider.js';
import { useConnectionRegistry } from '../notebook/connections/connection_registry.js';
import { useNotebookScriptsRegistry } from '../notebook/scripts/notebook_scripts_registry.js';

interface ProgressState {
    // The file size
    fileByteCount: number | null;
    // The time when the file reading started
    fileReadingStartedAt: Date | null;
    // The time when the file finished
    fileReadingFinishedAt: Date | null;
    // The time when the file failed
    fileReadingFailedAt: Date | null;

    // The time when the import started
    importStartedAt: Date | null;
    // The time when the import finished
    importFinishedAt: Date | null;
    // The time when the import failed
    importFailedAt: Date | null;

    // The imported notebook id
    notebookId: string | null;
}

type UpdateProgressFn = (state: ProgressState) => void;

async function loadNotebookFromFile(
    file: PlatformFile,
    updateProgress: UpdateProgressFn,
    signal: AbortSignal
): Promise<Blob> {
    const progress: ProgressState = {
        fileByteCount: null,
        fileReadingStartedAt: null,
        fileReadingFinishedAt: null,
        fileReadingFailedAt: null,
        importStartedAt: null,
        importFinishedAt: null,
        importFailedAt: null,
        notebookId: null,
    };

    // Read the file
    progress.fileReadingStartedAt = new Date();
    updateProgress({ ...progress });

    let fileBuffer: ArrayBuffer;
    try {
        const uint8Array = await file.readAsArrayBuffer();
        fileBuffer = uint8Array.buffer as ArrayBuffer;
        progress.fileByteCount = uint8Array.length;
        progress.fileReadingFinishedAt = new Date();
        updateProgress({ ...progress });
    } catch (e: any) {
        progress.fileReadingFailedAt = new Date();
        updateProgress({ ...progress });
        throw e;
    }

    signal.throwIfAborted();

    // Import the notebook from ZIP
    progress.importStartedAt = new Date();
    updateProgress({ ...progress });

    try {
        return new Blob([fileBuffer], { type: 'application/zip' });
    } catch (e: any) {
        progress.importFailedAt = new Date();
        updateProgress({ ...progress });
        throw e;
    }
}

interface Props {
    file: PlatformFile;
    onDone: () => void;
}

export function FileLoader(props: Props) {
    const { file, onDone } = props;
    const navigate = useRouterNavigate();
    const storageReader = useStorageReader();
    const setupCore = useDashQLCoreSetup();
    const logger = useLogger();
    const [connectionRegistry, setConnectionRegistry] = useConnectionRegistry();
    const connectionSignatures = connectionRegistry.connectionsBySignature;
    const [, setNotebookScriptsRegistry] = useNotebookScriptsRegistry();
    const abortController = React.useMemo(() => new AbortController(), []);

    const [error, setError] = React.useState<Error | null>(null);
    const [progress, setProgress] = React.useState<ProgressState>({
        fileByteCount: null,
        fileReadingStartedAt: null,
        fileReadingFinishedAt: null,
        fileReadingFailedAt: null,
        importStartedAt: null,
        importFinishedAt: null,
        importFailedAt: null,
        notebookId: null,
    });

    // Load the file
    React.useEffect(() => {
        (async () => {
            let restoredNotebook: RestoredNotebook | null = null;
            let registered = false;
            try {
                const zipBlob = await loadNotebookFromFile(
                    file,
                    setProgress,
                    abortController.signal
                );
                abortController.signal.throwIfAborted();

                // Imports happen after startup restoration, so load the persisted notebook into the
                // live registries before navigating to it.
                const core = await setupCore('file_import');
                const restored = await importAndRestoreNotebook(
                    zipBlob,
                    logger,
                    core,
                    storageReader.backend,
                    connectionSignatures,
                );
                restoredNotebook = restored;
                const notebookId = restored.notebookId;
                abortController.signal.throwIfAborted();
                setConnectionRegistry(registry => {
                    registry.connectionMap.set(restored.connection.connectionId, restored.connection);
                    registry.connectionByNotebook.set(notebookId, restored.connection.connectionId);
                    registry.connectionsByType[restored.connectorType].push(restored.connection.connectionId);
                    registry.connectionsBySignature.set(
                        restored.connection.connectionSignature.signatureString,
                        restored.connection.connectionId,
                    );
                    return { ...registry };
                });
                setNotebookScriptsRegistry(registry => {
                    registry.notebookScriptsMap.set(notebookId, restored.notebookScripts);
                    registry.notebookScriptsByConnection.set(restored.connection.connectionId, notebookId);
                    registry.notebookScriptsByConnectionType[restored.connectorType].push(notebookId);
                    return { ...registry };
                });
                registered = true;
                setProgress(current => ({ ...current, importFinishedAt: new Date(), notebookId }));
                // Navigate to the imported notebook
                navigate({ type: NOTEBOOK_PATH, value: notebookId });
                onDone();
            } catch (e: any) {
                if (restoredNotebook && !registered) {
                    destroyRestoredNotebook(restoredNotebook);
                    try {
                        await storageReader.backend.deleteNotebook(restoredNotebook.notebookId);
                    } catch {
                        // Preserve the cancellation/restoration error when cleanup fails.
                    }
                }
                setProgress(current => ({ ...current, importFailedAt: new Date() }));
                setError(e);
            }
        })();
        return () => abortController.abort();
    }, [file, onDone, storageReader, setupCore, logger, connectionSignatures, setConnectionRegistry, setNotebookScriptsRegistry, abortController, navigate]);

    // Close button
    const close = React.useCallback(() => {
        abortController.abort();
        onDone();
    }, [abortController, onDone]);

    // Determine the status
    let status = IndicatorStatus.Running;
    if (error != null) {
        status = IndicatorStatus.Failed;
    } else if (progress.importFinishedAt != null) {
        status = IndicatorStatus.Succeeded;
    }

    // Compute the duration
    const durationMs = progress.importFinishedAt
        ? progress.importFinishedAt.getTime() - (progress.fileReadingStartedAt?.getTime() ?? 0)
        : null;

    return (
        <div className={baseStyles.banner_page}>
            <div className={baseStyles.banner_page_icon}>
                <svg width="120px" height="120px">
                    <use xlinkHref={`${symbols}#dashql`} />
                </svg>
            </div>
            <div className={baseStyles.banner_page_title}>Loading Notebook</div>
            <div className={classNames(baseStyles.banner_page_body, styles.loader_status)}>
                <div className={styles.status_row}>
                    <div className={styles.status_icon}>
                        <StatusIndicator status={status} />
                    </div>
                    <div className={styles.status_text}>
                        {error ? (
                            <span className={styles.status_error}>
                                Import failed: {error.message}
                            </span>
                        ) : progress.importFinishedAt ? (
                            <span>
                                Notebook imported successfully
                                {durationMs && ` in ${(durationMs / 1000).toFixed(2)}s`}
                            </span>
                        ) : progress.importStartedAt ? (
                            <span>Importing notebook...</span>
                        ) : progress.fileReadingFinishedAt ? (
                            <span>
                                File read ({progress.fileByteCount ? formatBytes(progress.fileByteCount) : 'unknown size'})
                            </span>
                        ) : (
                            <span>Reading file...</span>
                        )}
                    </div>
                </div>
            </div>
            <div className={baseStyles.banner_page_button}>
                <button onClick={close}>Close</button>
            </div>
        </div>
    );
}
