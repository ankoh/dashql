import * as React from 'react';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { QueryResultDetails as QueryResultDetailsView } from '@akohn/dashql-react/components/query_result/query_result_details';
import { useComputation, useComputationDispatch, useQueryResultTable } from '@akohn/dashql-react/hooks';
import { QueryResultView } from './query_result_view.js';
import { QueryResultToolbar, useQueryResultRowCounts } from './query_result_toolbar.js';
import { QueryResultDownloadButton } from './query_result_download_button.js';
import { QueryResultActionMenu } from './query_result_action_menu.js';

// The full result of a query in the app (QueryResultDetails of @akohn/dashql-react): the computation of the runtime, the
// search, the download and the actions of the app

export interface QueryResultDetailsDependencies {
    QueryResultToolbar: typeof QueryResultToolbar;
    QueryResultView: typeof QueryResultView;
    useComputation: typeof useComputation;
    useComputationDispatch: typeof useComputationDispatch;
    useQueryResultRowCounts: typeof useQueryResultRowCounts;
    QueryResultDownloadButton: typeof QueryResultDownloadButton;
    QueryResultActionMenu: typeof QueryResultActionMenu;
}

const DEFAULT_DEPENDENCIES: QueryResultDetailsDependencies = {
    QueryResultToolbar,
    QueryResultView,
    useComputation,
    useComputationDispatch,
    useQueryResultRowCounts,
    QueryResultDownloadButton,
    QueryResultActionMenu,
};

interface Props {
    query: QueryExecutionState;
    debugMode: boolean;
    actions?: React.ReactNode;
    fitHeight?: boolean;
    maxHeight?: number;
    columnHeader?: TableColumnHeader;
    dependencies?: QueryResultDetailsDependencies;
}

export const QueryResultDetails: React.FC<Props> = ({ query, debugMode, actions, fitHeight, maxHeight, columnHeader, dependencies = DEFAULT_DEPENDENCIES }) => {
    const counts = dependencies.useQueryResultRowCounts(query);
    const tableComputation = dependencies.useComputation(query.queryId);
    const computationDispatch = dependencies.useComputationDispatch(query.queryId);
    const clearCrossFilters = React.useCallback(() => {
        computationDispatch({ kind: 'clearCrossFilters' });
    }, [computationDispatch]);
    const resultTable = useQueryResultTable(query);
    return (
        <QueryResultDetailsView
            counts={counts}
            resultTable={resultTable}
            toolbar={<dependencies.QueryResultToolbar query={query} />}
            hasCrossFilters={tableComputation != null && tableComputation.crossFilters.length > 0}
            onClearCrossFilters={clearCrossFilters}
            actions={(
                <>
                    <dependencies.QueryResultDownloadButton query={query} />
                    <dependencies.QueryResultActionMenu query={query} />
                    {actions}
                </>
            )}
            fitHeight={fitHeight}
            maxHeight={maxHeight}
            table={layout => (
                <dependencies.QueryResultView
                    query={query}
                    debugMode={debugMode}
                    compact
                    fitHeight={layout.fitHeight}
                    maxHeight={layout.maxHeight}
                    columnHeader={columnHeader}
                />
            )}
        />
    );
};
