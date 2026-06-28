import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';
import * as baseStyles from './banner_page.module.css';
import * as styles from './file_loader.module.css';

import { IndicatorStatus, StatusIndicator } from './foundations/status_indicator.js';
import { PlatformFile } from "../platform/file/file.js";
import { classNames } from '../utils/classnames.js';
import { formatBytes } from '../utils/format.js';
import { useRouterNavigate, NOTEBOOK_PATH } from '../router.js';
import { useStorageReader } from '../platform/storage/storage_provider.js';
import { importSessionFromZip } from '../platform/storage/session_import.js';

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

    // The imported session path
    sessionPath: string | null;
}

type UpdateProgressFn = (state: ProgressState) => void;

async function loadSessionFromFile(
    file: PlatformFile,
    backend: any,
    updateProgress: UpdateProgressFn,
    signal: AbortSignal
): Promise<string> {
    const progress: ProgressState = {
        fileByteCount: null,
        fileReadingStartedAt: null,
        fileReadingFinishedAt: null,
        fileReadingFailedAt: null,
        importStartedAt: null,
        importFinishedAt: null,
        importFailedAt: null,
        sessionPath: null,
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

    // Import the session from ZIP
    progress.importStartedAt = new Date();
    updateProgress({ ...progress });

    try {
        const zipBlob = new Blob([fileBuffer], { type: 'application/zip' });
        const sessionId = await importSessionFromZip(
            zipBlob,
            backend,
            () => crypto.randomUUID()
        );

        progress.importFinishedAt = new Date();
        updateProgress({ ...progress });

        return sessionId;
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
    const navigate = useRouterNavigate();
    const storageReader = useStorageReader();
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
        sessionPath: null,
    });

    // Load the file
    React.useEffect(() => {
        (async () => {
            try {
                const sessionPath = await loadSessionFromFile(
                    props.file,
                    storageReader.backend,
                    setProgress,
                    abortController.signal
                );
                // Navigate to the imported session
                navigate({ type: NOTEBOOK_PATH, value: sessionPath });
                props.onDone();
            } catch (e: any) {
                setError(e);
            }
        })();
        return () => abortController.abort();
    }, [props.file, storageReader, abortController, navigate, props]);

    // Close button
    const close = React.useCallback(() => {
        abortController.abort();
        props.onDone();
    }, [abortController, props.onDone]);

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
            <div className={baseStyles.banner_page_title}>Loading Session</div>
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
                                Session imported successfully
                                {durationMs && ` in ${(durationMs / 1000).toFixed(2)}s`}
                            </span>
                        ) : progress.importStartedAt ? (
                            <span>Importing session...</span>
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
