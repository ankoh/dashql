import * as React from 'react';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import {
    QueryResultHeader as QueryResultHeaderView,
    QueryResultPanel as QueryResultPanelView,
} from '@akohn/dashql-react/components/query_result/query_result_header';
import { TableSearchToolbar } from '@akohn/dashql-react/components/query_result/query_result_toolbar';
import { QueryResultView } from './query_result_view.js';
import { QueryResultDownloadButton } from './query_result_download_button.js';
import { QueryResultActionMenu } from './query_result_action_menu.js';

// The header and the panel of the result of a query in the app (QueryResultHeader and QueryResultPanel of
// @akohn/dashql-react): the controls of the app in the header, the table of the app below it

interface HeaderProps {
    model: QueryModel;
    /// The rows the table below shows at most, a preview of more rows counts as "6 of 1000 rows"
    maxRows?: number;
    /// Open the full result table, makes the header clickable
    onShowTable?: () => void;
}

/// The header over the result of a query: the title, the row count, the search, the download and the actions
export function QueryResultHeader(props: HeaderProps): React.ReactElement {
    return (
        <QueryResultHeaderView
            model={props.model}
            maxRows={props.maxRows}
            onShowTable={props.onShowTable}
            actions={(
                <>
                    <TableSearchToolbar computation={props.model.computation} />
                    <QueryResultDownloadButton model={props.model} />
                    <QueryResultActionMenu query={props.model.query} />
                </>
            )}
        />
    );
}

interface PanelProps {
    model: QueryModel | null;
    cellBackground?: string;
    /// Open the full result table, makes the row count in the header and the column names clickable
    onShowTable?: () => void;
}

/// The result of a query with its header that fills its host, for the dashboard and the dataflow
export function QueryResultPanel(props: PanelProps): React.ReactElement {
    const model = props.model;
    return (
        <QueryResultPanelView
            query={model?.query ?? null}
            header={maxRows => model != null && (
                <QueryResultHeader model={model} maxRows={maxRows} onShowTable={props.onShowTable} />
            )}
            table={maxRows => model != null && (
                <QueryResultView
                    model={model}
                    maxRows={maxRows}
                    columnHeader={TableColumnHeader.OnlyColumnName}
                    cellBackground={props.cellBackground}
                    onShowTable={props.onShowTable}
                    fitHeight={false}
                    fillHeight
                    compact
                />
            )}
        />
    );
}
