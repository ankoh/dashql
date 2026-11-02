import * as React from 'react';
import * as styles from '../query_result/query_result_header.module.css';

import type { QueryExecutionState } from '../../query/query_execution_state.js';
import type { ResolvedVisualizeQuery } from '../../session/scripts/script_types.js';
import { TabHeader, formatRowCountDetail, useResultRowCount } from '../../session/tab_header.js';
import { QueryResultPanel } from '../query_result/query_result_header.js';
import { ChartDownloadButton } from './chart_download_button.js';
import { VisualizationDispatch } from './visualization_dispatch.js';
import { classNames } from '../../utils/classnames.js';

/// The height of the header bar over the visualization, see `tab_header.module.css`
const HEADER_HEIGHT = 32;

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

/// The visualization of a script with the header bar of the feed above it: a table gets the header of a
/// query result, a chart the visualization header with the row count and the chart download.
/// The dataflow boxes show their visualizations in it.
export function VisualizationPanel(props: Props): React.ReactElement {
    const { hasResult, totalRows } = useResultRowCount(props.query);
    const vq = props.visualizeQuery;
    if (vq.renderer === 'table') {
        return <QueryResultPanel query={props.query} cellBackground={props.cellBackground} />;
    }
    const showHeader = hasResult && props.query != null;
    return (
        <div className={classNames(styles.panel, styles.chart_panel)}>
            {showHeader && (
                <TabHeader
                    title="Visualization"
                    detail={formatRowCountDetail(totalRows)}
                    actions={vq.renderer === 'vegalite' ? <ChartDownloadButton query={props.query!} spec={vq.vegaLiteSpec} /> : undefined}
                />
            )}
            <div className={styles.panel_body}>
                <VisualizationDispatch
                    query={props.query}
                    visualizeQuery={vq}
                    width={props.width}
                    height={props.height == null ? undefined : Math.max(0, props.height - (showHeader ? HEADER_HEIGHT : 0))}
                    hideLegend={props.hideLegend}
                    preview={props.preview}
                />
            </div>
        </div>
    );
}
