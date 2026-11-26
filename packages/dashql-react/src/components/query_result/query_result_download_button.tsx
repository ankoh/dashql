import * as React from 'react';

import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import type { QueryModel } from '../../models/query_model.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { ButtonSize, ButtonVariant, IconButton } from '../button.js';
import { DownloadIcon } from '../symbol_icon.js';
import { useLogger } from '../../logger.js';
import { useHost } from '../../host.js';

/// Write all rows of an analyzed result, the table of a computation, as Parquet
export type ExportParquet = (tableId: number) => Promise<Uint8Array>;

export interface QueryResultDownloadButtonProps {
    /// The query, the download writes all of its result
    model: QueryModel;
    /// Write the result as Parquet from the compute database, without it the button is disabled
    exportParquet: ExportParquet | null;
}

/// Download the result of a query as Parquet. Hyper writes the file from the data frame of the computation of the
/// result, the rows don't pass through JavaScript.
export function QueryResultDownloadButton({ model, exportParquet }: QueryResultDownloadButtonProps) {
    const { query } = model;
    const { downloadFile } = useHost();
    const logger = useLogger();
    const [downloading, setDownloading] = React.useState(false);
    const computation = model.computation?.computation ?? null;
    const tableId = exportParquet != null && query.status === QueryExecutionStatus.SUCCEEDED && computation?.dataFrame != null
        ? computation.tableId
        : null;

    const download = async () => {
        if (exportParquet == null || tableId == null || downloading) return;
        setDownloading(true);
        try {
            const bytes = await exportParquet(tableId);
            await downloadFile(bytes, `query-result-${query.queryId}.parquet`);
        } catch (error) {
            logger.error('Failed to download query result', { error: stringifyError(error) }, 'query_result_download');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <IconButton
            variant={ButtonVariant.Invisible}
            size={ButtonSize.Small}
            aria-label="Download query result as Parquet"
            data-testid="download-query-result"
            disabled={tableId == null || downloading}
            onClick={download}
        >
            <DownloadIcon size={16} />
        </IconButton>
    );
}
