import * as React from 'react';
import type * as arrow from 'apache-arrow';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { VegaLiteView, type ResultComputation, type VegaLiteViewDependencies } from '../vegalite_view.js';
import { VegaLitePreview } from './vegalite_preview.js';
import { MarkdownView } from './markdown_view.js';

export interface VisualizationDispatchProps {
    query: QueryExecutionState | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
    /// The result table of the query
    resultTable: arrow.Table | null;
    /// The computation of the result, a chart shows its table and follows its cross filters
    resultComputation: ResultComputation | null;
    /// Optional exact chart width/height in px. Currently honored by the Vega-Lite renderer (sizes
    /// the whole plot to `fit`).
    width?: number;
    height?: number;
    /// Optional uniform scale (<1 shrinks fonts/marks/axes). Honored by the Vega-Lite renderer.
    scale?: number;
    /// Suppress legends (they crowd out a cramped host like a grid card). Honored by the Vega-Lite
    /// renderer.
    hideLegend?: boolean;
    /// Render a Vega-Lite chart as a preview into the width×height box, see `VegaLitePreview`
    preview?: boolean;
    /// The result as a table, for the table renderer
    table: () => React.ReactNode;
    chartDependencies?: VegaLiteViewDependencies;
}

/// Renders the visualization of a query with `@vis` tags, dispatching on the renderer named by the tag
export function VisualizationDispatch(props: VisualizationDispatchProps): React.ReactElement {
    const vq = props.visualizeQuery;
    const result = { query: props.query, resultTable: props.resultTable, resultComputation: props.resultComputation };
    if (vq == null) {
        return <VegaLiteView {...result} vegaLiteSpec={null} dependencies={props.chartDependencies} />;
    }
    switch (vq.renderer) {
        case 'vegalite':
            if (props.preview && props.width != null && props.height != null) {
                return <VegaLitePreview {...result} vegaLiteSpec={vq.vegaLiteSpec} width={props.width} height={props.height} dependencies={props.chartDependencies} />;
            }
            return (
                <VegaLiteView
                    {...result}
                    vegaLiteSpec={vq.vegaLiteSpec}
                    width={props.width}
                    height={props.height}
                    scale={props.scale}
                    hideLegend={props.hideLegend}
                    dependencies={props.chartDependencies}
                />
            );
        case 'markdown':
            return <MarkdownView query={props.query} resultTable={props.resultTable} spec={vq.markdownSpec} />;
        case 'table':
            return <>{props.table()}</>;
    }
}
