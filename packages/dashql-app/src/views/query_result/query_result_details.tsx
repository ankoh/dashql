import * as React from 'react';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { TabHeader, formatRowCountDetail } from '../../workbook/tab_header.js';
import { QueryResultView } from './query_result_view.js';
import { TableColumnHeader } from './data_table_cell.js';
import { classNames } from '../../utils/classnames.js';
import { useComputation, useComputationDispatch, useQueryResultTable } from '../../runtime/runtime_hooks.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import * as styles from './query_result_details.module.css';
import { QueryResultToolbar, useQueryResultRowCounts } from './query_result_toolbar.js';
import { QueryResultDownloadButton } from './query_result_download_button.js';
import { QueryResultActionMenu } from './query_result_action_menu.js';
import { formatResultDetail } from './query_result_header.js';

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

const HEADER_HEIGHT = 32;
const ClearFiltersIcon = SymbolIcon('filter_remove_24');

export const QueryResultDetails: React.FC<Props> = ({ query, debugMode, actions, fitHeight, maxHeight, columnHeader, dependencies = DEFAULT_DEPENDENCIES }) => {
    const searchRows = dependencies.useQueryResultRowCounts(query);
    const tableComputation = dependencies.useComputation(query.queryId);
    const computationDispatch = dependencies.useComputationDispatch(query.queryId);
    const QueryResultToolbarComponent = dependencies.QueryResultToolbar;
    const QueryResultViewComponent = dependencies.QueryResultView;
    const QueryResultDownloadButtonComponent = dependencies.QueryResultDownloadButton;
    const QueryResultActionMenuComponent = dependencies.QueryResultActionMenu;
    const hasCrossFilters = tableComputation != null && tableComputation.crossFilters.length > 0;
    const clearCrossFilters = React.useCallback(() => {
        computationDispatch({ kind: 'clearCrossFilters' });
    }, [computationDispatch]);
    const resultTable = useQueryResultTable(query);
    return (
        <div className={classNames(styles.root, { [styles.root_fit_height]: fitHeight })}>
            <TabHeader
                title="Query Results"
                detail={formatResultDetail(searchRows.matchingRows == null
                    ? formatRowCountDetail(searchRows.totalRows)
                    : `${searchRows.matchingRows} of ${searchRows.currentRows ?? searchRows.totalRows ?? 0} rows`, resultTable)}
                actions={(
                    <>
                        <QueryResultToolbarComponent query={query} />
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label="Clear all cross-filters"
                            data-testid="clear-cross-filters"
                            onClick={clearCrossFilters}
                            disabled={!hasCrossFilters}
                        >
                            <ClearFiltersIcon size={16} />
                        </IconButton>
                        <QueryResultDownloadButtonComponent query={query} />
                        <QueryResultActionMenuComponent query={query} />
                        {actions}
                    </>
                )}
            />
            <div className={classNames(styles.body, { [styles.body_fit_height]: fitHeight })}>
                <QueryResultViewComponent
                    query={query}
                    debugMode={debugMode}
                    compact
                    fitHeight={fitHeight}
                    maxHeight={maxHeight == null ? undefined : Math.max(0, maxHeight - HEADER_HEIGHT)}
                    columnHeader={columnHeader}
                />
            </div>
        </div>
    );
};
