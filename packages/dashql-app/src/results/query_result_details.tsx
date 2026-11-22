import * as React from 'react';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { TableDetails } from '@akohn/dashql-react/components/query_result/query_result_details';
import { QueryResultView } from './query_result_view.js';
import { QueryResultDownloadButton } from './query_result_download_button.js';
import { QueryResultActionMenu } from './query_result_action_menu.js';

// The full result of a query in the app (TableDetails of @akohn/dashql-react with the size of the result): the download,
// the actions and the table of the app

interface Props {
    model: QueryModel;
    actions?: React.ReactNode;
    fitHeight?: boolean;
    maxHeight?: number;
    columnHeader?: TableColumnHeader;
}

export function QueryResultDetails({ model, actions, fitHeight, maxHeight, columnHeader }: Props): React.ReactElement {
    return (
        <TableDetails
            title="Query Results"
            computation={model.computation}
            resultTable={model.result}
            actions={(
                <>
                    <QueryResultDownloadButton model={model} />
                    <QueryResultActionMenu query={model.query} />
                    {actions}
                </>
            )}
            fitHeight={fitHeight}
            maxHeight={maxHeight}
            table={layout => (
                <QueryResultView
                    model={model}
                    compact
                    fitHeight={layout.fitHeight}
                    maxHeight={layout.maxHeight}
                    columnHeader={columnHeader}
                />
            )}
        />
    );
}
