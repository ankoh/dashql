import * as React from 'react';

import { QueryExecutionState } from '../../connection/query_execution_state.js';
import { ResolvedVisualizeQuery } from '../../notebook/notebook_types.js';
import { VisualizationView } from './visualization_view.js';
import { EmbeddingAtlasView } from './embeddingatlas/embeddingatlas_view.js';

interface Props {
    query: QueryExecutionState | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
}

/// Renders the visualization for a resolved VISUALIZE query, dispatching on the
/// renderer named after `USING`. Vega-Lite goes to the vega-embed VisualizationView;
/// embedding-atlas goes to the WebGPU/WebGL2 scatter EmbeddingAtlasView.
export function VisualizationDispatch(props: Props): React.ReactElement | null {
    const vq = props.visualizeQuery;
    if (vq == null) {
        return <VisualizationView query={props.query} vegaLiteSpec={null} />;
    }
    switch (vq.renderer) {
        case 'embeddingatlas':
            return <EmbeddingAtlasView query={props.query} spec={vq.embeddingAtlasSpec} />;
        case 'vegalite':
        default:
            return <VisualizationView query={props.query} vegaLiteSpec={vq.vegaLiteSpec} />;
    }
}
