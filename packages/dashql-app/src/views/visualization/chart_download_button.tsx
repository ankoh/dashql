import * as React from 'react';
import type { TopLevelSpec } from 'vega-lite';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import {
    ChartDownloadButton as ChartDownloadButtonView,
    type ChartDownloadButtonProps,
} from '@akohn/dashql-react/components/visualization/chart_download_button';
import { renderVegaLitePng } from '@akohn/dashql-react/vegalite/vegalite_image';
import { useQueryResultTable } from '@akohn/dashql-react/hooks';
import { useDownloadFile } from '../../platform/file/file_downloader_hook.js';

// The chart download of the app (ChartDownloadButton of @akohn/dashql-react): the result table of the runtime and the
// file downloader of the app

export interface ChartDownloadButtonDependencies extends NonNullable<ChartDownloadButtonProps['dependencies']> {
    useDownloadFile: typeof useDownloadFile;
}

interface Props {
    query: QueryExecutionState;
    /// The Vega-Lite spec of the chart, the query result is its data
    spec: TopLevelSpec;
    dependencies?: ChartDownloadButtonDependencies;
}

const DEFAULT_DEPENDENCIES: ChartDownloadButtonDependencies = {
    useDownloadFile,
    renderVegaLitePng,
};

/// Download the chart of a query result as PNG
export function ChartDownloadButton({ query, spec, dependencies = DEFAULT_DEPENDENCIES }: Props) {
    const downloadFile = dependencies.useDownloadFile();
    const resultTable = useQueryResultTable(query);
    return <ChartDownloadButtonView query={query} resultTable={resultTable} spec={spec} downloadFile={downloadFile} dependencies={dependencies} />;
}
