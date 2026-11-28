import * as React from 'react';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { VisualizationPanel as VisualizationPanelView } from '@akohn/dashql-react/components/visualization/visualization_panel';
import { QueryResultPanel } from './query_result_header.js';

// The visualization panel of the app (VisualizationPanel of @akohn/dashql-react): the result panel of the app for the
// table renderer

interface Props {
    model: QueryModel | null;
    visualizeQuery: ResolvedVisualizeQuery;
    /// The width and height of the whole panel in px, the visualization gets the height below the header
    width?: number;
    height?: number;
    preview?: boolean;
}

/// The visualization of a script with the header bar of the feed above it, for the dataflow boxes
export function VisualizationPanel(props: Props): React.ReactElement {
    return (
        <VisualizationPanelView
            {...props}
            table={() => <QueryResultPanel model={props.model} />}
        />
    );
}
