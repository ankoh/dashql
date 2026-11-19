import * as React from 'react';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { VisualizationPanel as VisualizationPanelView } from '@akohn/dashql-react/components/visualization/visualization_panel';
import { useQueryResultTable } from '@akohn/dashql-react/hooks';
import { useResultRowCount } from '../query_result/query_result_toolbar.js';
import { QueryResultPanel } from '../query_result/query_result_header.js';
import { useResultComputation } from './vegalite_view.js';
import { useDownloadFile } from '../../platform/file/file_downloader_hook.js';

// The visualization panel of the app (VisualizationPanel of @akohn/dashql-react): the result, its computation and its
// rows from the runtime, the result panel of the app for the table renderer

interface Props {
    query: QueryExecutionState | null;
    visualizeQuery: ResolvedVisualizeQuery;
    /// The width and height of the whole panel in px, the visualization gets the height below the header
    width?: number;
    height?: number;
    hideLegend?: boolean;
    preview?: boolean;
    /// The background of the cells of a result table
    cellBackground?: string;
}

/// The visualization of a script with the header bar of the feed above it, for the dataflow boxes
export function VisualizationPanel({ cellBackground, ...props }: Props): React.ReactElement {
    const rowCount = useResultRowCount(props.query);
    const resultTable = useQueryResultTable(props.query);
    const resultComputation = useResultComputation(props.query?.queryId ?? null);
    const downloadFile = useDownloadFile();
    return (
        <VisualizationPanelView
            {...props}
            rowCount={rowCount}
            resultTable={resultTable}
            resultComputation={resultComputation}
            downloadFile={downloadFile}
            table={() => <QueryResultPanel query={props.query} cellBackground={cellBackground} />}
        />
    );
}
