import * as React from 'react';
import type { QueryModel } from '../../models/query_model.js';
import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { VegaLiteView } from '../vegalite_view.js';
import { VegaLitePreview } from './vegalite_preview.js';
import { MarkdownView } from './markdown_view.js';
import { KpiView } from './kpi_view.js';

export interface VisualizationDispatchProps {
    /// The query, a chart shows its result and follows the cross filters of its computation
    model: QueryModel | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
    /// Optional exact chart width/height in px. Currently honored by the Vega-Lite renderer (sizes
    /// the whole plot to `fit`).
    width?: number;
    height?: number;
    /// Suppress legends (they crowd out a cramped host like a grid card). Honored by the Vega-Lite
    /// renderer.
    hideLegend?: boolean;
    /// Render a Vega-Lite chart as a preview into the width×height box, see `VegaLitePreview`
    preview?: boolean;
    /// The result as a table, for the table renderer
    table: () => React.ReactNode;
}

/// Renders the visualization of a query with `@vis` tags, dispatching on the renderer named by the tag
export function VisualizationDispatch(props: VisualizationDispatchProps): React.ReactElement {
    const vq = props.visualizeQuery;
    const result = { model: props.model };
    if (vq == null) {
        return <VegaLiteView {...result} vegaLiteSpec={null} />;
    }
    switch (vq.renderer) {
        case 'vegalite':
            if (props.preview && props.width != null && props.height != null) {
                return <VegaLitePreview {...result} vegaLiteSpec={vq.vegaLiteSpec} width={props.width} height={props.height} />;
            }
            return (
                <VegaLiteView
                    {...result}
                    vegaLiteSpec={vq.vegaLiteSpec}
                    width={props.width}
                    height={props.height}
                    hideLegend={props.hideLegend}
                />
            );
        case 'markdown':
            return <MarkdownView model={props.model} spec={vq.markdownSpec} />;
        case 'kpi':
            return <KpiView model={props.model} spec={vq.kpiSpec} />;
        case 'table':
            return <>{props.table()}</>;
    }
}
