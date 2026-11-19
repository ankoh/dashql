import * as React from 'react';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { ResultTableOverlay as ResultTableOverlayView } from '@akohn/dashql-react/components/query_result/result_table_overlay';
import { QueryResultDetails } from './query_result_details.js';

export interface ResultTableOverlayDependencies {
    QueryResultDetails: typeof QueryResultDetails;
}

const DEFAULT_DEPENDENCIES: ResultTableOverlayDependencies = {
    QueryResultDetails,
};

interface Props {
    scriptName: string;
    query: QueryExecutionState;
    onClose: () => void;
    dependencies?: ResultTableOverlayDependencies;
}

/// The full result table of a feed entry or a dashboard card in a card over the page (ResultTableOverlay of
/// @akohn/dashql-react) with the details of the result in the app
export function ResultTableOverlay(props: Props): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    return (
        <ResultTableOverlayView scriptName={props.scriptName} onClose={props.onClose}>
            {layout => (
                <dependencies.QueryResultDetails
                    query={props.query}
                    debugMode={false}
                    fitHeight={layout.fitHeight}
                    maxHeight={layout.maxHeight}
                    columnHeader={TableColumnHeader.WithColumnPlots}
                />
            )}
        </ResultTableOverlayView>
    );
}
