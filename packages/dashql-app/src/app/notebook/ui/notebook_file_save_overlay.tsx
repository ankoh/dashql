import * as React from 'react';
import * as styles from './notebook_file_save_overlay.module.css';

import { DownloadIcon, FileIcon } from '@primer/octicons-react';

import { AnchorAlignment } from '../../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../../ui/foundations/anchored_overlay.js';
import { ConnectionState } from '../connections/connection_state.js';
import { NotebookExportSettings, NotebookExportSettingsView } from './notebook_export_settings_view.js';
import { NotebookScripts } from '../scripts/notebook_scripts.js';
import { classNames } from '../../../utils/classnames.js';
import { exportNotebookAsSharedZip } from '../persistence/notebook_export.js';
import { connectionParamsHaveLoginHint, getConnectionParamsFromStateDetails } from '../connections/connection_params.js';
import { formatBytes } from '../../../utils/format.js';
import { useFileDownloader } from '../../../platform/file/file_downloader_provider.js';
import { useStorageReader } from '../persistence/storage_provider.js';
import { StorageBackend } from '../persistence/storage_backend.js';
import { IconButton } from '../../../ui/foundations/button.js';
import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../../globals.js';

async function packAndCompressFile(
    backend: StorageBackend,
    conn: ConnectionState,
    notebookScripts: NotebookScripts,
    settings: NotebookExportSettings,
): Promise<Uint8Array> {
    const connectionParams = await import('../connections/connection_params.js').then(m =>
        m.getConnectionParamsFromStateDetails(conn.details)
    );
    const zipBlob = await exportNotebookAsSharedZip(backend, notebookScripts.notebookId, connectionParams, settings);
    const arrayBuffer = await zipBlob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
}

interface Props {
    className?: string;
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    notebookScripts: NotebookScripts | null;
    conn: ConnectionState | null;
}

export const NotebookFileSaveOverlay: React.FC<Props> = (props: Props) => {
    const anchorRef = React.createRef<HTMLDivElement>();
    const buttonRef = React.createRef<HTMLButtonElement>();
    const fileDownloader = useFileDownloader();
    const storage = useStorageReader();
    const fileName = `${props.notebookScripts?.notebookMetadata.originalFileName ?? "notebook"}.${DASHQL_ARCHIVE_FILENAME_EXT}`;

    const [settings, setSettings] = React.useState<NotebookExportSettings>({
        withCatalog: true,
        withLoginHint: true,
    });

    const [fileBytes, setFileBytes] = React.useState<Uint8Array>(new Uint8Array());
    React.useEffect(() => {
        if (!props.isOpen) {
            return;
        }
        const conn = props.conn;
        const notebookScripts = props.notebookScripts;
        if (conn == null || notebookScripts == null) {
            return;
        }
        const cancellation = new AbortController();
        setFileBytes(new Uint8Array());
        const pack = async () => {
            const fileBytes = await packAndCompressFile(storage.backend, conn, notebookScripts, settings);
            if (!cancellation.signal.aborted) {
                setFileBytes(fileBytes);
            }
        };
        pack().catch(() => {
            if (!cancellation.signal.aborted) setFileBytes(new Uint8Array());
        });
        return () => cancellation.abort();
    }, [settings, props.conn, props.notebookScripts, props.isOpen, storage.backend]);

    const hasLoginHint = React.useMemo(
        () => props.conn != null && connectionParamsHaveLoginHint(getConnectionParamsFromStateDetails(props.conn.details)),
        [props.conn],
    );

    const downloadFile = React.useCallback(async () => {
        await fileDownloader.downloadBufferAsFile(fileBytes, fileName);
    }, [fileBytes, fileName]);

    return (
        <AnchoredOverlay
            renderAnchor={() => <div ref={anchorRef} />}
            open={props.isOpen}
            onClose={() => props.setIsOpen(false)}
            anchorRef={anchorRef}
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
                        <div className={styles.file_size}>~&nbsp;{formatBytes(fileBytes.length)}</div>
                    </div>
                    <div className={styles.download}>
                        <IconButton
                            ref={buttonRef}
                            onClick={downloadFile}
                            disabled={fileBytes.length === 0}
                            aria-labelledby="save-file"
                            aria-label="Save File"
                        >
                            <DownloadIcon />
                        </IconButton>
                    </div>
                </div>
                <NotebookExportSettingsView
                    withCatalog={true}
                    withLoginHint={hasLoginHint}
                    settings={settings}
                    setSettings={setSettings}
                />
            </div>
        </AnchoredOverlay>
    );
};
