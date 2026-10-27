import * as React from 'react';
import type { TopLevelSpec } from 'vega-lite';

import { QueryExecutionStatus, type QueryExecutionState } from '../../../../../query/query_execution_state.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../../../../ui/foundations/button.js';
import { DownloadIcon } from '../../../../../ui/foundations/symbol_icon.js';
import { arrowTableToRows } from '../../../../../ui/vegalite/vegalite_rows.js';
import { renderVegaLitePng } from '../../../../../ui/vegalite/vegalite_image.js';
import { useFileDownloader } from '../../../../../platform/file/file_downloader_hook.js';
import { useLogger } from '../../../../../platform/logger/logger_provider.js';
import { stringifyError } from '../../../../../platform/logger/logger.js';

interface Props {
    query: QueryExecutionState;
    /// The Vega-Lite spec of the chart, the query result is its data
    spec: TopLevelSpec;
    dependencies?: {
        useFileDownloader: () => Pick<ReturnType<typeof useFileDownloader>, 'downloadBufferAsFile'>;
        useLogger: () => Pick<ReturnType<typeof useLogger>, 'error'>;
        renderVegaLitePng: typeof renderVegaLitePng;
    };
}

const DEFAULT_DEPENDENCIES: NonNullable<Props['dependencies']> = {
    useFileDownloader,
    useLogger,
    renderVegaLitePng,
};

/// Download the chart of a query result as PNG
export function ChartDownloadButton({ query, spec, dependencies = DEFAULT_DEPENDENCIES }: Props) {
    const fileDownloader = dependencies.useFileDownloader();
    const logger = dependencies.useLogger();
    const [downloading, setDownloading] = React.useState(false);
    const hasResult = query.status === QueryExecutionStatus.SUCCEEDED && query.resultTable != null;

    const download = async () => {
        if (!hasResult || downloading) return;
        setDownloading(true);
        try {
            const image = await dependencies.renderVegaLitePng(spec, arrowTableToRows(query.resultTable!));
            await fileDownloader.downloadBufferAsFile(image.png, `chart-${query.queryId}.png`);
        } catch (error) {
            logger.error('Failed to download chart', { error: stringifyError(error) }, 'chart_download');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <IconButton
            variant={ButtonVariant.Invisible}
            size={ButtonSize.Small}
            aria-label="Download chart as PNG"
            data-testid="download-chart-png"
            disabled={!hasResult || downloading}
            onClick={download}
        >
            <DownloadIcon size={16} />
        </IconButton>
    );
}
