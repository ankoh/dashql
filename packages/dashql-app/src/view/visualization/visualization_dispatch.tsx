import * as React from 'react';

import { QueryExecutionState } from '../../connection/query_execution_state.js';
import { ResolvedVisualizeQuery } from '../../notebook/notebook_types.js';
import { VegaLiteView } from './vegalite_view.js';
import { UmapView } from './umap/umap_view.js';

interface Props {
    query: QueryExecutionState | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
    /// Render the umap scatter with a transparent background (feed footer preview).
    transparent?: boolean;
    /// Enable pan/drag on renderers that support it. Defaults to true.
    interactive?: boolean;
    /// Enable scroll-wheel zoom. Disabled in the feed footer so the wheel scrolls the feed
    /// instead of being captured by the chart. Defaults to true.
    wheelZoom?: boolean;
}

/// Renders the visualization for a resolved VISUALIZE query, dispatching on the
/// renderer named after `USING`. Vega-Lite goes to the vega-embed VegaLiteView;
/// umap goes to the WebGPU/WebGL2 scatter UmapView.
export function VisualizationDispatch(props: Props): React.ReactElement | null {
    const vq = props.visualizeQuery;
    if (vq == null) {
        return <VegaLiteView query={props.query} vegaLiteSpec={null} />;
    }
    switch (vq.renderer) {
        case 'umap':
            return (
                <UmapView
                    query={props.query}
                    spec={vq.umapSpec}
                    transparent={props.transparent}
                    interactive={props.interactive}
                    wheelZoom={props.wheelZoom}
                />
            );
        case 'vegalite':
        default:
            return <VegaLiteView query={props.query} vegaLiteSpec={vq.vegaLiteSpec} />;
    }
}
