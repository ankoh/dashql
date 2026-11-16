import * as React from 'react';
import * as styles from './workbook_file_save_overlay.module.css';

import { DownloadIcon, FileIcon } from '../../ui/foundations/symbol_icon.js';

import { AnchorAlignment } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { WorkbookExportSettings, WorkbookExportSettingsView } from './workbook_export_settings_view.js';
import { WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { classNames } from '../../utils/classnames.js';
import { connectionParamsHaveLoginHint, getConnectionSetupParams } from '@ankoh/dashql-runtime/connections/connection_params';
import { formatBytes } from '../../utils/format.js';
import { useFileDownloader } from '../../platform/file/file_downloader_hook.js';
import { IconButton } from '../../ui/foundations/button.js';
import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../globals.js';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { useOptionalRuntime, useConnectionViews } from '../../runtime/runtime_hooks.js';
import type { Runtime } from '@ankoh/dashql-runtime/runtime';
import type { ExportedResults } from '@ankoh/dashql-core';
import { stringifyError, type LoggerLike } from '@ankoh/dashql-runtime/platform/logger/logger';
import { useLogger } from '../../platform/logger/logger_provider.js';

const LOG_CTX = 'workbook_export';

/// Pack the workbook into an archive with the runtime. The cached results go in only if the settings ask for them.
async function packAndCompressFile(
    runtime: Runtime,
    workbookId: string,
    settings: WorkbookExportSettings,
    withResults: boolean,
    logger: LoggerLike | null,
): Promise<Blob> {
    const started = performance.now();
    // The archive stays a Blob that the browser keeps, a large one is paged out of memory. The runtime keeps the cached
    // results pinned until the archive holds them.
    const { archive, results } = await runtime.exportArchive(workbookId, {
        withCatalog: settings.withCatalog,
        withLoginHint: settings.withLoginHint,
        preserveUuids: settings.preserveUUIDs,
        results: withResults,
    });
    const fields = {
        workbookId, bytes: archive.size.toString(), results: results.files.toString(), resultBytes: results.bytes.toString(),
        cachedScripts: results.cachedScripts.toString(), totalScripts: results.totalScripts.toString(),
        durationMs: Math.round(performance.now() - started).toString(),
    };
    // The archive without results is packed with every change of the workbook, only a save with results is news
    if (withResults) logger?.info('Packed a workbook file', fields, LOG_CTX);
    else logger?.debug('Packed a workbook file', fields, LOG_CTX);
    return archive;
}

/// The line below the toggle of the query results
function queryResultsHint(counts: ExportedResults | null): string {
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
    const fileName = `${props.fileName ?? props.workbookScripts?.workbookMetadata.originalFileName ?? "workbook"}.${DASHQL_ARCHIVE_FILENAME_EXT}`;

    const [settings, setSettings] = React.useState<WorkbookExportSettings>({
        withCatalog: true,
        withLoginHint: true,
        preserveUUIDs: false,
        withQueryResults: false,
    });
    const cache = useQueryResultCache();
    const logger = useLogger() as LoggerLike | null;
    const runtime = useOptionalRuntime();

    // The scripts with cached results, counted when the overlay opens
    const [resultCounts, setResultCounts] = React.useState<ExportedResults | null>(null);
    React.useEffect(() => {
        const workbookScripts = props.workbookScripts;
        setResultCounts(null);
        if (!props.isOpen || workbookScripts == null || cache == null || runtime == null) return;
        let cancelled = false;
        runtime.ready()
            .then(module => module.exportedResults(workbookScripts.workbookId))
            .then(counts => { if (!cancelled) setResultCounts(counts); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [props.isOpen, props.workbookScripts, cache, runtime]);

    // The archive without the results is packed whenever the workbook, its connections or the settings change, it is
    // small. The results can be gigabytes, they are streamed into the archive when it is saved. A pack of settings that
    // changed in the meantime is ignored.
    const { withCatalog, withLoginHint, preserveUUIDs, withQueryResults } = settings;
    const connections = useConnectionViews(props.workbookScripts?.connectionIds);
    const [file, setFile] = React.useState<Blob | null>(null);
    const [packError, setPackError] = React.useState<string | null>(null);
    React.useEffect(() => {
        if (!props.isOpen) {
            return;
        }
        const workbookScripts = props.workbookScripts;
        if (workbookScripts == null || runtime == null) {
            return;
        }
        let cancelled = false;
        setFile(null);
        setPackError(null);
        packAndCompressFile(runtime, workbookScripts.workbookId, { withCatalog, withLoginHint, preserveUUIDs }, false, logger)
            .then(file => {
                if (!cancelled) setFile(file);
            })
            .catch(error => {
                if (cancelled) return;
                logger?.warn('Packing a workbook file failed', { workbookId: workbookScripts.workbookId, error: stringifyError(error) }, LOG_CTX);
                setFile(null);
                setPackError(`The export failed: ${stringifyError(error)}`);
            });
        return () => { cancelled = true; };
    }, [connections, withCatalog, withLoginHint, preserveUUIDs, props.workbookScripts, props.isOpen, runtime, logger]);

    const hasLoginHint = React.useMemo(
        () => (connections ?? []).some(connection => connectionParamsHaveLoginHint(getConnectionSetupParams(connection))),
        [connections],
    );

    // A save with the results packs them, closing the overlay drops the archive
    const [saving, setSaving] = React.useState(false);
    const saveRun = React.useRef<{ cancelled: boolean } | null>(null);
    React.useEffect(() => {
        if (props.isOpen || saveRun.current == null) return;
        saveRun.current.cancelled = true;
    }, [props.isOpen]);
    React.useEffect(() => () => {
        if (saveRun.current != null) saveRun.current.cancelled = true;
    }, []);
    const downloadFile = React.useCallback(async () => {
        const workbookScripts = props.workbookScripts;
        if (file == null || workbookScripts == null || runtime == null || saveRun.current != null) return;
        if (!withQueryResults || cache == null) {
            await fileDownloader.downloadBufferAsFile(file, fileName);
            return;
        }
        const run = { cancelled: false };
        saveRun.current = run;
        setSaving(true);
        setPackError(null);
        try {
            const packed = await packAndCompressFile(runtime, workbookScripts.workbookId, settings, true, logger);
            if (run.cancelled) {
                logger?.info('Dropped a workbook file with query results, the overlay was closed', { workbookId: workbookScripts.workbookId }, LOG_CTX);
                return;
            }
            await fileDownloader.downloadBufferAsFile(packed, fileName);
        } catch (error) {
            logger?.warn('Saving a workbook file with query results failed', { workbookId: workbookScripts.workbookId, error: stringifyError(error) }, LOG_CTX);
            if (!run.cancelled) setPackError(`The export failed: ${stringifyError(error)}`);
        } finally {
            saveRun.current = null;
            setSaving(false);
        }
    }, [file, fileName, withQueryResults, cache, runtime, settings, props.workbookScripts, logger]);
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
