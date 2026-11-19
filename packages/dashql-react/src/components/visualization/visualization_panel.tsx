import * as React from 'react';
import * as styles from './visualization_panel.module.css';

import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { TabHeader, formatRowCountDetail } from '../tab_header.js';
import { ChartDownloadButton } from './chart_download_button.js';
import { VisualizationDispatch, type VisualizationDispatchProps } from './visualization_dispatch.js';
import type { DownloadFile } from '../../host.js';

/// The height of the header bar over the visualization, see `tab_header.module.css`
const HEADER_HEIGHT = 32;

export interface VisualizationPanelProps extends Omit<VisualizationDispatchProps, 'visualizeQuery' | 'scale'> {
    visualizeQuery: ResolvedVisualizeQuery;
    /// Whether the query has a result, and its rows
    rowCount: { hasResult: boolean; totalRows: number | null };
    /// Save the image of a chart
    downloadFile: DownloadFile;
    /// The width and height of the whole panel in px, the visualization gets the height below the header
    width?: number;
    height?: number;
    /// The result of the table renderer, with the header of a query result, in place of the panel
    table: () => React.ReactNode;
}

/// The visualization of a script with the header bar of the feed above it: a table gets the header of a
/// query result, a chart the visualization header with the row count and the chart download.
/// The dataflow boxes show their visualizations in it.
export function VisualizationPanel(props: VisualizationPanelProps): React.ReactElement {
    const { hasResult, totalRows } = props.rowCount;
    const vq = props.visualizeQuery;
    if (vq.renderer === 'table') {
        return <>{props.table()}</>;
    }
    const showHeader = hasResult && props.query != null;
    return (
        <div className={styles.panel}>
            {showHeader && (
                <TabHeader
                    title="Visualization"
                    detail={formatRowCountDetail(totalRows)}
                    actions={vq.renderer === 'vegalite'
                        ? <ChartDownloadButton query={props.query!} resultTable={props.resultTable} spec={vq.vegaLiteSpec} downloadFile={props.downloadFile} />
                        : undefined}
                />
            )}
            <div className={styles.panel_body}>
                <VisualizationDispatch
                    query={props.query}
                    visualizeQuery={vq}
                    resultTable={props.resultTable}
                    resultComputation={props.resultComputation}
                    width={props.width}
                    height={props.height == null ? undefined : Math.max(0, props.height - (showHeader ? HEADER_HEIGHT : 0))}
                    hideLegend={props.hideLegend}
                    preview={props.preview}
                    table={props.table}
                    chartDependencies={props.chartDependencies}
                />
            </div>
        </div>
    );
}
