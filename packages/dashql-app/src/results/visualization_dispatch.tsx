import * as React from 'react';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { VisualizationDispatch as VisualizationDispatchView } from '@akohn/dashql-react/components/visualization/visualization_dispatch';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { QueryResultView } from './query_result_view.js';

// The visualization of a query in the app (VisualizationDispatch of @akohn/dashql-react): the result table of the app
// for the table renderer

interface Props {
    model: QueryModel | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
    width?: number;
    height?: number;
    scale?: number;
    hideLegend?: boolean;
    preview?: boolean;
}

/// Renders the visualization of a query with `@vis` tags, dispatching on the renderer named by the tag
export function VisualizationDispatch(props: Props): React.ReactElement {
    return (
        <VisualizationDispatchView
            {...props}
            table={() => (
                <QueryResultView
                    model={props.model}
                    columnHeader={TableColumnHeader.OnlyColumnName}
                    fitHeight={false}
                    compact
                />
            )}
        />
    );
}
