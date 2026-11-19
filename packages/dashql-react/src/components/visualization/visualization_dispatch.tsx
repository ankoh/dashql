import * as React from 'react';
import type { QueryModel } from '../../models/query_model.js';
import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { VegaLiteView, type VegaLiteViewDependencies } from '../vegalite_view.js';
import { VegaLitePreview } from './vegalite_preview.js';
import { MarkdownView } from './markdown_view.js';

export interface VisualizationDispatchProps {
    /// The query, a chart shows its result and follows the cross filters of its computation
    model: QueryModel | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
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
    const result = { model: props.model };
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
            return <MarkdownView query={props.model?.query ?? null} resultTable={props.model?.result ?? null} spec={vq.markdownSpec} />;
        case 'table':
            return <>{props.table()}</>;
    }
}
