import * as React from 'react';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import {
    QueryResultHeader as QueryResultHeaderView,
    QueryResultPanel as QueryResultPanelView,
} from '@akohn/dashql-react/components/query_result/query_result_header';
import { useQueryResultTable } from '@akohn/dashql-react/hooks';
import { QueryResultView } from './query_result_view.js';
import { QueryResultToolbar, useQueryResultRowCounts } from './query_result_toolbar.js';
import { QueryResultDownloadButton } from './query_result_download_button.js';
import { QueryResultActionMenu } from './query_result_action_menu.js';

// The header and the panel of the result of a query in the app (QueryResultHeader and QueryResultPanel of
// @akohn/dashql-react): the row counts and the table of the runtime, the search, the download and the actions of the app

export interface QueryResultHeaderDependencies {
    useQueryResultRowCounts: typeof useQueryResultRowCounts;
    QueryResultToolbar: typeof QueryResultToolbar;
    QueryResultDownloadButton: typeof QueryResultDownloadButton;
    QueryResultActionMenu: typeof QueryResultActionMenu;
}

const DEFAULT_HEADER_DEPENDENCIES: QueryResultHeaderDependencies = {
    useQueryResultRowCounts,
    QueryResultToolbar,
    QueryResultDownloadButton,
    QueryResultActionMenu,
};

interface HeaderProps {
    query: QueryExecutionState;
    /// The rows the table below shows at most, a preview of more rows counts as "6 of 1000 rows"
    maxRows?: number;
    /// Open the full result table, makes the header clickable
    onShowTable?: () => void;
    dependencies?: QueryResultHeaderDependencies;
}

/// The header over the result of a query: the title, the row count, the search, the download and the actions
export function QueryResultHeader(props: HeaderProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_HEADER_DEPENDENCIES;
    const counts = dependencies.useQueryResultRowCounts(props.query);
    const resultTable = useQueryResultTable(props.query);
    return (
        <QueryResultHeaderView
            counts={counts}
            resultTable={resultTable}
            maxRows={props.maxRows}
            onShowTable={props.onShowTable}
            actions={(
                <>
                    <dependencies.QueryResultToolbar query={props.query} />
                    <dependencies.QueryResultDownloadButton query={props.query} />
                    <dependencies.QueryResultActionMenu query={props.query} />
                </>
            )}
        />
    );
}

interface PanelProps {
    query: QueryExecutionState | null;
    cellBackground?: string;
    /// Open the full result table, makes the row count in the header and the column names clickable
    onShowTable?: () => void;
    dependencies?: QueryResultPanelDependencies;
}

export interface QueryResultPanelDependencies extends QueryResultHeaderDependencies {
    QueryResultView: typeof QueryResultView;
}

const DEFAULT_PANEL_DEPENDENCIES: QueryResultPanelDependencies = {
    ...DEFAULT_HEADER_DEPENDENCIES,
    QueryResultView,
};

/// The result of a query with its header that fills its host, for the dashboard and the dataflow
export function QueryResultPanel(props: PanelProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_PANEL_DEPENDENCIES;
    return (
        <QueryResultPanelView
            query={props.query}
            header={maxRows => props.query != null && (
                <QueryResultHeader query={props.query} maxRows={maxRows} onShowTable={props.onShowTable} dependencies={dependencies} />
            )}
            table={maxRows => props.query != null && (
                <dependencies.QueryResultView
                    query={props.query}
                    debugMode={false}
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
