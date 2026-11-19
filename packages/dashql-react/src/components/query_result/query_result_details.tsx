import * as React from 'react';
import * as styles from './query_result_details.module.css';

import { TabHeader, formatRowCountDetail } from '../tab_header.js';
import { ButtonSize, ButtonVariant, IconButton } from '../button.js';
import { SymbolIcon } from '../symbol_icon.js';
import { classNames } from '../../dom/classnames.js';
import { formatResultDetail } from './query_result_header.js';
import { TableSearchToolbar, useResultRowCounts } from './query_result_toolbar.js';
import type { QueryModel } from '../../models/query_model.js';

/// The height of the header of the details
const HEADER_HEIGHT = 32;
const ClearFiltersIcon = SymbolIcon('filter_remove_24');

/// How the table of the details is laid out
export interface QueryResultDetailsLayout {
    /// The table takes the height of its rows, up to `maxHeight`
    fitHeight?: boolean;
    /// The height the table may take at most
    maxHeight?: number;
}

export interface QueryResultDetailsProps {
    /// The query of the result: its rows, its size, its search and its cross filters
    model: QueryModel;
    /// The controls after the search and the button that clears the cross filters: the download and the actions of the host
    actions?: React.ReactNode;
    fitHeight?: boolean;
    maxHeight?: number;
    /// The table in the layout that the details leave it
    table: (layout: QueryResultDetailsLayout) => React.ReactNode;
}

/// The full result of a query: a header with the row count, the search, the button that clears the cross filters and the
/// controls of the host, over the table
export function QueryResultDetails(props: QueryResultDetailsProps): React.ReactElement {
    const computation = props.model.computation;
    const counts = useResultRowCounts(computation);
    const hasCrossFilters = (computation?.computation.crossFilters.length ?? 0) > 0;
    const clearCrossFilters = React.useCallback(() => {
        computation?.dispatch({ kind: 'clearCrossFilters' });
    }, [computation]);
    return (
        <div className={classNames(styles.root, { [styles.root_fit_height]: props.fitHeight })}>
            <TabHeader
                title="Query Results"
                detail={formatResultDetail(counts.matchingRows == null
                    ? formatRowCountDetail(counts.totalRows)
                    : `${counts.matchingRows} of ${counts.currentRows ?? counts.totalRows ?? 0} rows`, props.model.result)}
                actions={(
                    <>
                        <TableSearchToolbar computation={computation} />
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
                        {props.actions}
                    </>
                )}
            />
            <div className={classNames(styles.body, { [styles.body_fit_height]: props.fitHeight })}>
                {props.table({
                    fitHeight: props.fitHeight,
                    maxHeight: props.maxHeight == null ? undefined : Math.max(0, props.maxHeight - HEADER_HEIGHT),
                })}
            </div>
        </div>
    );
}
