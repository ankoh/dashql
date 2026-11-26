import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './query_result_download_button.module.css';

import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import type { QueryModel } from '../../models/query_model.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { ButtonSize, ButtonVariant, IconButton } from '../button.js';
import * as ActionList from '../action_list.js';
import { AnchorAlignment, AnchorSide } from '../../dom/anchored_position.js';
import { AnchoredOverlay } from '../anchored_overlay.js';
import { DownloadIcon } from '../symbol_icon.js';
import { useLogger } from '../../logger.js';
import { useHost } from '../../host.js';

const enum DownloadFormat {
    Arrow = 'arrow',
    Parquet = 'parquet',
}

/// Write all rows of an analyzed result, the table of a computation, as Parquet
export type ExportParquet = (tableId: number) => Promise<Uint8Array>;

export interface QueryResultDownloadButtonProps {
    /// The query, the download writes all of its result
    model: QueryModel;
    /// Write the result as Parquet from the compute database, without it the menu offers Parquet disabled
    exportParquet: ExportParquet | null;
}

/// Download the result of a query as an Arrow IPC file or, with a database that exports it, as Parquet. Hyper writes
/// the Parquet file from the data frame of the computation of the result, the rows don't pass through JavaScript.
export function QueryResultDownloadButton({ model, exportParquet }: QueryResultDownloadButtonProps) {
    const { query, result: resultTable } = model;
    const { downloadFile } = useHost();
    const logger = useLogger();
    const [open, setOpen] = React.useState(false);
    const [downloading, setDownloading] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const hasResult = query.status === QueryExecutionStatus.SUCCEEDED && resultTable != null;
    // Hyper writes the Parquet file from the data frame of the computation of the result
    const computation = model.computation?.computation ?? null;
    const parquetTableId = exportParquet != null && query.status === QueryExecutionStatus.SUCCEEDED && computation?.dataFrame != null
        ? computation.tableId
        : null;

    const downloadResult = async (format: DownloadFormat) => {
        setOpen(false);
        if (downloading) return;
        setDownloading(true);
        try {
            switch (format) {
                case DownloadFormat.Arrow: {
                    if (!hasResult) return;
                    const bytes = arrow.tableToIPC(resultTable!, 'file');
                    await downloadFile(bytes, `query-result-${query.queryId}.arrow`);
                    break;
                }
                case DownloadFormat.Parquet: {
                    if (exportParquet == null || parquetTableId == null) return;
                    const bytes = await exportParquet(parquetTableId);
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
                    disabled={(!hasResult && parquetTableId == null) || downloading}
                >
                    <DownloadIcon size={16} />
                </IconButton>
            )}
        >
            <div className={styles.menu} role="dialog" aria-label="Download query result">
                <ActionList.List aria-label="Download formats">
                    <ActionList.ListItem data-testid="download-format-arrow" disabled={!hasResult} onClick={() => downloadResult(DownloadFormat.Arrow)}>
                        <ActionList.ItemText>Download as Arrow</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem
                        data-testid="download-format-parquet"
                        disabled={parquetTableId == null}
                        onClick={() => downloadResult(DownloadFormat.Parquet)}
                    >
                        <ActionList.ItemText>Download as Parquet</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
}
