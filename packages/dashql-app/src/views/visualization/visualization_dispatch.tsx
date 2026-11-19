import * as React from 'react';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { VisualizationDispatch as VisualizationDispatchView } from '@akohn/dashql-react/components/visualization/visualization_dispatch';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { useQueryResultTable } from '@akohn/dashql-react/hooks';
import { useResultComputation } from './vegalite_view.js';
import { QueryResultView } from '../query_result/query_result_view.js';

// The visualization of a query in the app (VisualizationDispatch of @akohn/dashql-react): the result table and the
// computation of the runtime, the result table of the app for the table renderer

interface Props {
    query: QueryExecutionState | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
    width?: number;
    height?: number;
    scale?: number;
    hideLegend?: boolean;
    preview?: boolean;
}

/// Renders the visualization of a query with `@vis` tags, dispatching on the renderer named by the tag
export function VisualizationDispatch(props: Props): React.ReactElement {
    const resultTable = useQueryResultTable(props.query);
    const resultComputation = useResultComputation(props.query?.queryId ?? null);
    return (
        <VisualizationDispatchView
            {...props}
            resultTable={resultTable}
            resultComputation={resultComputation}
            table={() => (
                <QueryResultView
                    query={props.query}
                    debugMode={false}
                    columnHeader={TableColumnHeader.OnlyColumnName}
                    fitHeight={false}
                    compact
                />
            )}
        />
    );
}
