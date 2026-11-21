import * as React from 'react';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { ResultTableOverlay as ResultTableOverlayView } from '@akohn/dashql-react/components/query_result/result_table_overlay';
import { QueryResultDetails } from './query_result_details.js';

interface Props {
    scriptName: string;
    model: QueryModel;
    onClose: () => void;
}

/// The full result table of a feed entry or a dashboard card in a card over the page (ResultTableOverlay of
/// @akohn/dashql-react) with the details of the result in the app
export function ResultTableOverlay(props: Props): React.ReactElement {
    return (
        <ResultTableOverlayView scriptName={props.scriptName} onClose={props.onClose}>
            {layout => (
                <QueryResultDetails
                    model={props.model}
                    fitHeight={layout.fitHeight}
                    maxHeight={layout.maxHeight}
                    columnHeader={TableColumnHeader.WithColumnPlots}
                />
            )}
        </ResultTableOverlayView>
    );
}
