import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './query_result_download_button.module.css';

import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { ButtonSize, ButtonVariant, IconButton } from '../button.js';
import * as ActionList from '../action_list.js';
import { AnchorAlignment, AnchorSide } from '../../dom/anchored_position.js';
import { AnchoredOverlay } from '../anchored_overlay.js';
import { DownloadIcon } from '../symbol_icon.js';
import { useLogger } from '../../logger.js';
import type { DownloadFile } from '../../host.js';

const enum DownloadFormat {
    Arrow = 'arrow',
    Parquet = 'parquet',
}

/// Write an Arrow table as Parquet
export type ExportParquet = (table: arrow.Table) => Promise<Uint8Array>;

export interface QueryResultDownloadButtonProps {
    query: QueryExecutionState;
    /// The result table of the query, the download writes all of it
    resultTable: arrow.Table | null;
    /// Save the file of the result
    downloadFile: DownloadFile;
    /// Write the result as Parquet, without it the menu offers Parquet disabled
    exportParquet: ExportParquet | null;
}

/// Download the result of a query as an Arrow IPC file or, with a database that exports it, as Parquet
export function QueryResultDownloadButton({ query, resultTable, downloadFile, exportParquet }: QueryResultDownloadButtonProps) {
    const logger = useLogger();
    const [open, setOpen] = React.useState(false);
    const [downloading, setDownloading] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const hasResult = query.status === QueryExecutionStatus.SUCCEEDED && resultTable != null;

    const downloadResult = async (format: DownloadFormat) => {
        setOpen(false);
        if (!hasResult || downloading) return;
        setDownloading(true);
        try {
            switch (format) {
                case DownloadFormat.Arrow: {
                    const bytes = arrow.tableToIPC(resultTable!, 'file');
                    await downloadFile(bytes, `query-result-${query.queryId}.arrow`);
                    break;
                }
                case DownloadFormat.Parquet: {
                    if (exportParquet == null) throw new Error('the host cannot export Parquet');
                    const bytes = await exportParquet(resultTable!);
                    await downloadFile(bytes, `query-result-${query.queryId}.parquet`);
                    break;
                }
            }
        } catch (error) {
            logger.error('Failed to download query result', { format, error: stringifyError(error) }, 'query_result_download');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={(anchorProps) => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label="Download query result"
                    data-testid="download-query-result"
                    disabled={!hasResult || downloading}
                >
                    <DownloadIcon size={16} />
                </IconButton>
            )}
        >
            <div className={styles.menu} role="dialog" aria-label="Download query result">
                <ActionList.List aria-label="Download formats">
                    <ActionList.ListItem data-testid="download-format-arrow" onClick={() => downloadResult(DownloadFormat.Arrow)}>
                        <ActionList.ItemText>Download as Arrow</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem
                        data-testid="download-format-parquet"
                        disabled={exportParquet == null}
                        onClick={() => downloadResult(DownloadFormat.Parquet)}
                    >
                        <ActionList.ItemText>Download as Parquet</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
}
