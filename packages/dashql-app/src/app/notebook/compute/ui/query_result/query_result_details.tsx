import * as React from 'react';

import type { QueryExecutionState } from '../../../connections/query_execution_state.js';
import { TabHeader, formatRowCountDetail, useResultRowCount } from '../../../ui/tab_header.js';
import { QueryResultView } from './query_result_view.js';
import { TableColumnHeader } from './data_table_cell.js';
import { classNames } from '../../../../../utils/classnames.js';
import { SET_CROSS_FILTERS } from '../../../../../compute/computation_state.js';
import { CrossFilters } from '../../../../../compute/cross_filters.js';
import { useComputationRegistry } from '../../../../../compute/computation_registry.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../../../../ui/foundations/button.js';
import { SymbolIcon } from '../../../../../ui/foundations/symbol_icon.js';
import * as styles from './query_result_details.module.css';

interface Props {
    query: QueryExecutionState;
    debugMode: boolean;
    actions?: React.ReactNode;
    fitHeight?: boolean;
    maxHeight?: number;
    columnHeader?: TableColumnHeader;
}

const HEADER_HEIGHT = 32;
const ClearFiltersIcon = SymbolIcon('filter_remove_24');

export const QueryResultDetails: React.FC<Props> = ({ query, debugMode, actions, fitHeight, maxHeight, columnHeader }) => {
    const { totalRows } = useResultRowCount(query);
    const [computationState, computationDispatch] = useComputationRegistry();
    const tableComputation = computationState.tableComputations[query.queryId] ?? null;
    const hasCrossFilters = tableComputation != null
        && Object.keys(tableComputation.crossFilters.columnFilters).length > 0;
    const clearCrossFilters = React.useCallback(() => {
        computationDispatch({ type: SET_CROSS_FILTERS, value: [query.queryId, new CrossFilters()] });
    }, [computationDispatch, query.queryId]);
    return (
        <div className={classNames(styles.root, { [styles.root_fit_height]: fitHeight })}>
            <TabHeader
                title="Query Results"
                detail={formatRowCountDetail(totalRows)}
                actions={(
                    <>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label="Clear all cross-filters"
                            onClick={clearCrossFilters}
                            disabled={!hasCrossFilters}
                        >
                            <ClearFiltersIcon size={16} />
                        </IconButton>
                        {actions}
                    </>
                )}
            />
            <div className={classNames(styles.body, { [styles.body_fit_height]: fitHeight })}>
                <QueryResultView
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
