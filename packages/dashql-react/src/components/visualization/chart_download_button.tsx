import * as React from 'react';
import type { TopLevelSpec } from 'vega-lite';

import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import type { QueryModel } from '../../models/query_model.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { ButtonSize, ButtonVariant, IconButton } from '../button.js';
import { DownloadIcon } from '../symbol_icon.js';
import { arrowTableToRows, CHART_ROWS } from '../../vegalite/vegalite_rows.js';
import { renderVegaLitePng } from '../../vegalite/vegalite_image.js';
import { useLogger } from '../../logger.js';
import { useHost } from '../../host.js';

export interface ChartDownloadButtonProps {
    /// The query, the first rows of its result are the data of the chart, at most `CHART_ROWS` like the chart shows
    model: QueryModel;
    /// The Vega-Lite spec of the chart
    spec: TopLevelSpec;
    dependencies?: {
        renderVegaLitePng: typeof renderVegaLitePng;
    };
}

const DEFAULT_DEPENDENCIES: NonNullable<ChartDownloadButtonProps['dependencies']> = {
    renderVegaLitePng,
};

/// Download the chart of a query result as PNG
export function ChartDownloadButton({ model, spec, dependencies = DEFAULT_DEPENDENCIES }: ChartDownloadButtonProps) {
    const { query, computation } = model;
    const { downloadFile } = useHost();
    const logger = useLogger();
    const [downloading, setDownloading] = React.useState(false);
    const hasResult = query.status === QueryExecutionStatus.SUCCEEDED && computation != null;

    const download = async () => {
        if (!hasResult || downloading) return;
        setDownloading(true);
        try {
            const rows = await computation!.previewRows(0, CHART_ROWS, false);
            const image = await dependencies.renderVegaLitePng(spec, arrowTableToRows(rows));
            await downloadFile(image.png, `chart-${query.queryId}.png`);
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
