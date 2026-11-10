import * as React from 'react';
import * as styles from './workbook_file_save_overlay.module.css';

import { DownloadIcon, FileIcon } from '../../ui/foundations/symbol_icon.js';

import { AnchorAlignment } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { ConnectionState } from '../../connections/connection_state.js';
import { WorkbookExportSettings, WorkbookExportSettingsView } from './workbook_export_settings_view.js';
import { WorkbookScripts } from '../scripts/workbook_scripts.js';
import { classNames } from '../../utils/classnames.js';
import { exportWorkbookAsSharedZip } from './workbook_export.js';
import { connectionParamsHaveLoginHint, getConnectionParamsFromStateDetails } from '../../connections/connection_params.js';
import { formatBytes } from '../../utils/format.js';
import { useFileDownloader } from '../../platform/file/file_downloader_hook.js';
import { useStorageReader } from '../../storage/storage_provider.js';
import { StorageBackend } from '../../storage/storage_backend.js';
import { IconButton } from '../../ui/foundations/button.js';
import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../globals.js';
import { resolveWorkbookConnections, useConnectionReferences, useConnectionRegistry, useWorkbookConnections } from '../../connections/connection_registry.js';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import type { QueryResultCache } from '../../query/query_result_cache.js';
import { scriptRunServices } from '../scripts/script_run.js';
import { countWorkbookQueryResults, retainWorkbookQueryResults, type WorkbookQueryResultCounts } from './workbook_query_results.js';
import { stringifyError, type LoggerLike } from '../../platform/logger/logger.js';
import { useLogger } from '../../platform/logger/logger_provider.js';

const LOG_CTX = 'workbook_export';

/// Pack the workbook into an archive. The cached results go in only if the settings ask for them and a cache is given.
async function packAndCompressFile(
    backend: StorageBackend,
    databases: ConnectionState[],
    workbookScripts: WorkbookScripts,
    settings: WorkbookExportSettings,
    cache: QueryResultCache | null,
    signal: AbortSignal,
    logger: LoggerLike | null,
): Promise<Blob> {
    const connectionParams = new Map();
    const connectionNames = new Map<string, string>();
    for (const database of databases) {
        const params = database.params;
        if (params != null) connectionParams.set(database.connectionId, params);
        if (database.name != null) connectionNames.set(database.connectionId, database.name);
    }
    // The cached results stay pinned until the archive holds them
    const retained = settings.withQueryResults && cache != null
        ? await retainWorkbookQueryResults(scriptRunServices(workbookScripts.instance), workbookScripts, cache)
        : null;
    const workbookId = workbookScripts.workbookId;
    if (retained != null) {
        logger?.info('Packing the cached query results of a workbook', {
            workbookId, cachedScripts: retained.cachedScripts.toString(), totalScripts: retained.totalScripts.toString(),
            results: retained.results.length.toString(), bytes: retained.results.reduce((sum, result) => sum + result.bytes.size, 0).toString(),
        }, LOG_CTX);
    }
    const started = performance.now();
    try {
        // The archive stays a Blob that the browser keeps, a large one is paged out of memory
        const archive = await exportWorkbookAsSharedZip(backend, workbookId, connectionParams, {
            ...settings, connectionNames, queryResults: retained?.results, signal,
        });
        const fields = {
            workbookId, bytes: archive.size.toString(), results: (retained?.results.length ?? 0).toString(),
            durationMs: Math.round(performance.now() - started).toString(),
        };
        // The archive without results is packed with every change of the workbook, only a save with results is news
        if (retained != null) logger?.info('Packed a workbook file', fields, LOG_CTX);
        else logger?.debug('Packed a workbook file', fields, LOG_CTX);
        return archive;
    } finally {
        await retained?.release();
    }
}

/// The line below the toggle of the query results
function queryResultsHint(counts: WorkbookQueryResultCounts | null): string {
    const cached = counts == null ? '' : `${counts.cachedScripts} of ${counts.totalScripts} scripts have a cached result. `;
    return `${cached}Results contain query data.`;
}

interface Props {
    className?: string;
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    anchorRef?: React.RefObject<HTMLButtonElement | null>;
    workbookScripts: WorkbookScripts | null;
    fileName?: string;
}

export const WorkbookFileSaveOverlay: React.FC<Props> = (props: Props) => {
    const anchorRef = React.createRef<HTMLDivElement>();
    const buttonRef = React.createRef<HTMLButtonElement>();
    const fileDownloader = useFileDownloader();
    const storage = useStorageReader();
    const [databaseRegistry] = useConnectionRegistry();
    const references = useConnectionReferences();
    const fileName = `${props.fileName ?? props.workbookScripts?.workbookMetadata.originalFileName ?? "workbook"}.${DASHQL_ARCHIVE_FILENAME_EXT}`;

    const [settings, setSettings] = React.useState<WorkbookExportSettings>({
        withCatalog: true,
        withLoginHint: true,
        preserveUUIDs: false,
        withQueryResults: false,
    });
    const cache = useQueryResultCache();
    const logger = useLogger() as LoggerLike | null;

    // The scripts with cached results, counted when the overlay opens
    const [resultCounts, setResultCounts] = React.useState<WorkbookQueryResultCounts | null>(null);
    React.useEffect(() => {
        const workbookScripts = props.workbookScripts;
        setResultCounts(null);
        if (!props.isOpen || workbookScripts == null || cache == null) return;
        let cancelled = false;
        countWorkbookQueryResults(scriptRunServices(workbookScripts.instance), workbookScripts, cache)
            .then(counts => { if (!cancelled) setResultCounts(counts); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [props.isOpen, props.workbookScripts, cache]);

    // The archive without the results is packed whenever the workbook or the settings change, it is small. The results
    // can be gigabytes, they are streamed into the archive when it is saved.
    const { withCatalog, withLoginHint, preserveUUIDs, withQueryResults } = settings;
    const [file, setFile] = React.useState<Blob | null>(null);
    const [packError, setPackError] = React.useState<string | null>(null);
    React.useEffect(() => {
        if (!props.isOpen) {
            return;
        }
        const workbookScripts = props.workbookScripts;
        if (workbookScripts == null) {
            return;
        }
        const cancellation = new AbortController();
        setFile(null);
        setPackError(null);
        const pack = async () => {
            const attached = resolveWorkbookConnections(databaseRegistry, references, workbookScripts.workbookId);
            if (attached == null) return;
            const file = await packAndCompressFile(storage.backend, attached, workbookScripts,
                { withCatalog, withLoginHint, preserveUUIDs }, null, cancellation.signal, logger);
            if (!cancellation.signal.aborted) {
                setFile(file);
            }
        };
        pack().catch(error => {
            if (cancellation.signal.aborted) return;
            logger?.warn('Packing a workbook file failed', { workbookId: workbookScripts.workbookId, error: stringifyError(error) }, LOG_CTX);
            setFile(null);
            setPackError(`The export failed: ${stringifyError(error)}`);
        });
        return () => cancellation.abort();
    }, [databaseRegistry, references, withCatalog, withLoginHint, preserveUUIDs, props.workbookScripts, props.isOpen, storage.backend, logger]);

    const connections = useWorkbookConnections(props.workbookScripts?.workbookId ?? null);
    const hasLoginHint = React.useMemo(
        () => (connections ?? []).some(connection => connectionParamsHaveLoginHint(getConnectionParamsFromStateDetails(connection.details))),
        [connections],
    );

    // A save with the results packs them, closing the overlay stops it
    const [saving, setSaving] = React.useState(false);
    const saveRun = React.useRef<AbortController | null>(null);
    React.useEffect(() => {
        if (props.isOpen) return;
        saveRun.current?.abort();
    }, [props.isOpen]);
    React.useEffect(() => () => saveRun.current?.abort(), []);
    const downloadFile = React.useCallback(async () => {
        const workbookScripts = props.workbookScripts;
        if (file == null || workbookScripts == null || saveRun.current != null) return;
        if (!withQueryResults || cache == null) {
            await fileDownloader.downloadBufferAsFile(file, fileName);
            return;
        }
        const attached = resolveWorkbookConnections(databaseRegistry, references, workbookScripts.workbookId);
        if (attached == null) return;
        const run = new AbortController();
        saveRun.current = run;
        setSaving(true);
        setPackError(null);
        try {
            const packed = await packAndCompressFile(storage.backend, attached, workbookScripts, settings, cache, run.signal, logger);
            run.signal.throwIfAborted();
            await fileDownloader.downloadBufferAsFile(packed, fileName);
        } catch (error) {
            if (run.signal.aborted) {
                logger?.info('Stopped saving a workbook file with query results', { workbookId: workbookScripts.workbookId }, LOG_CTX);
            } else {
                logger?.warn('Saving a workbook file with query results failed', { workbookId: workbookScripts.workbookId, error: stringifyError(error) }, LOG_CTX);
                setPackError(`The export failed: ${stringifyError(error)}`);
            }
        } finally {
            saveRun.current = null;
            setSaving(false);
        }
    }, [file, fileName, withQueryResults, cache, settings, databaseRegistry, references, props.workbookScripts, storage.backend, logger]);
    // The results are stored as they are, the archive grows by about their size
    const fileSize = file == null ? 0 : file.size + (withQueryResults ? resultCounts?.bytes ?? 0 : 0);

    return (
        <AnchoredOverlay
            renderAnchor={props.anchorRef ? null : () => <div ref={anchorRef} />}
            open={props.isOpen}
            onClose={() => props.setIsOpen(false)}
            anchorRef={props.anchorRef ?? anchorRef}
            returnFocusRef={props.anchorRef}
            align={AnchorAlignment.End}
            overlayProps={{
                initialFocusRef: buttonRef,
            }}
        >
            <div className={classNames(styles.overlay, props.className)}>
                <div className={styles.header}>
                    <div className={styles.file_icon_container}>
                        <FileIcon />
                    </div>
                    <div className={styles.file_info}>
                        <div className={styles.file_name}>{fileName}</div>
                        <div className={styles.file_size}>~&nbsp;{formatBytes(fileSize)}</div>
                    </div>
                    <div className={styles.download}>
                        <IconButton
                            ref={buttonRef}
                            onClick={downloadFile}
                            disabled={file == null || file.size === 0 || saving}
                            aria-busy={saving || undefined}
                            aria-labelledby="save-file"
                            aria-label="Save File"
                        >
                            <DownloadIcon />
                        </IconButton>
                    </div>
                </div>
                <WorkbookExportSettingsView
                    withCatalog={true}
                    withLoginHint={hasLoginHint}
                    settings={settings}
                    setSettings={setSettings}
                    queryResults={cache != null ? { hint: queryResultsHint(resultCounts) } : undefined}
                />
                {packError != null && <div className={styles.error} role="alert" data-testid="export-error">{packError}</div>}
            </div>
        </AnchoredOverlay>
    );
};
