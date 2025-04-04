import * as React from 'react';
import * as zstd from '../../utils/zstd.js';
import * as styles from './workbook_file_save_overlay.module.css';

import { Box, IconButton } from '@primer/react';
import { DownloadIcon, FileIcon } from '@primer/octicons-react';

import { AnchorAlignment } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { WorkbookExportSettings } from '../../workbook/workbook_export_settings.js';
import { WorkbookExportSettingsView } from './workbook_export_settings_view.js';
import { WorkbookState } from '../../workbook/workbook_state.js';
import { classNames } from '../../utils/classnames.js';
import { encodeWorkbookAsFile } from '../../workbook/workbook_export_file.js';
import { formatBytes } from '../../utils/format.js';
import { useFileDownloader } from '../../platform/file_downloader_provider.js';

const SLNX_COMPRESSION_LEVEL = 5;

async function packSdql(conn: ConnectionState, workbook: WorkbookState, settings: WorkbookExportSettings): Promise<Uint8Array> {
    const file = encodeWorkbookAsFile(workbook, conn, settings);
    const fileBytes = file.toBinary();
    await zstd.init();
    return zstd.compress(fileBytes, SLNX_COMPRESSION_LEVEL);
}

interface Props {
    className?: string;
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    workbook: WorkbookState | null;
    conn: ConnectionState | null;
}

export const WorkbookFileSaveOverlay: React.FC<Props> = (props: Props) => {
    const anchorRef = React.createRef<HTMLDivElement>();
    const buttonRef = React.createRef<HTMLAnchorElement>();
    const fileDownloader = useFileDownloader();

    const [settings, setSettings] = React.useState<WorkbookExportSettings>({
        exportCatalog: true,
        exportUsername: true
    });

    const [fileBytes, setFileBytes] = React.useState<Uint8Array>(new Uint8Array());
    React.useEffect(() => {
        if (!props.isOpen) {
            return;
        }
        const conn = props.conn;
        const workbook = props.workbook;
        if (conn == null || workbook == null) {
            return;
        }
        const cancellation = new AbortController();
        const pack = async () => {
            const fileBytes = await packSdql(conn, workbook, settings);
            if (!cancellation.signal.aborted) {
                setFileBytes(fileBytes);
            }
        };
        pack();
        return () => cancellation.abort();
    }, [settings, props.conn, props.workbook, props.isOpen]);

    const downloadFile = React.useCallback(async () => {
        await fileDownloader.downloadBufferAsFile(fileBytes, "workbook.dashql");
    }, [fileBytes]);

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
            <Box className={classNames(styles.overlay, props.className)}>
                <div className={styles.header}>
                    <div className={styles.file_icon_container}>
                        <FileIcon />
                    </div>
                    <div className={styles.file_info}>
                        <div className={styles.file_name}>workbook.dashql</div>
                        <div className={styles.file_size}>~&nbsp;{formatBytes(fileBytes.length)}</div>
                    </div>
                    <div className={styles.download}>
                        <IconButton
                            ref={buttonRef}
                            icon={DownloadIcon}
                            aria-labelledby="save-file"
                            onClick={downloadFile}
                        />
                    </div>
                </div>
                <WorkbookExportSettingsView
                    withCatalog={true}
                    settings={settings}
                    setSettings={setSettings}
                />
            </Box>
        </AnchoredOverlay>
    );
};
