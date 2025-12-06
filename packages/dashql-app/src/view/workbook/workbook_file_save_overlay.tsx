import * as React from 'react';
import * as zstd from '../../utils/zstd.js';
import * as styles from './workbook_file_save_overlay.module.css';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { Box } from '@primer/react';
import { DownloadIcon, FileIcon } from '@primer/octicons-react';

import { AnchorAlignment } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { WorkbookExportSettings, WorkbookExportSettingsView } from './workbook_export_settings_view.js';
import { WorkbookState } from '../../workbook/workbook_state.js';
import { classNames } from '../../utils/classnames.js';
import { encodeWorkbookAsFile } from '../../workbook/workbook_export.js';
import { formatBytes } from '../../utils/format.js';
import { useFileDownloader } from '../../platform/file_downloader_provider.js';
import { IconButton } from '../../view/foundations/button.js';
import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../globals.js';

const SLNX_COMPRESSION_LEVEL = 5;

async function packAndCompressFile(conn: ConnectionState, workbook: WorkbookState, withCatalog: boolean): Promise<Uint8Array> {
    const file = encodeWorkbookAsFile(workbook, conn, withCatalog);
    const fileBytes = buf.toBinary(pb.dashql.file.FileSchema, file);
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
    const buttonRef = React.createRef<HTMLButtonElement>();
    const fileDownloader = useFileDownloader();
    const fileName = `${props.workbook?.workbookMetadata.fileName ?? "workbook"}.${DASHQL_ARCHIVE_FILENAME_EXT}`;

    const [settings, setSettings] = React.useState<WorkbookExportSettings>({
        withCatalog: true,
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
            const fileBytes = await packAndCompressFile(conn, workbook, settings.withCatalog);
            if (!cancellation.signal.aborted) {
                setFileBytes(fileBytes);
            }
        };
        pack();
        return () => cancellation.abort();
    }, [settings, props.conn, props.workbook, props.isOpen]);

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
            <Box className={classNames(styles.overlay, props.className)}>
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
                            aria-labelledby="save-file"
                            aria-label="Save File"
                        >
                            <DownloadIcon />
                        </IconButton>
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
