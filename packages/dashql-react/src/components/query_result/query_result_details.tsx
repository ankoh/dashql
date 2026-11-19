import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './query_result_details.module.css';

import { TabHeader, formatRowCountDetail } from '../tab_header.js';
import { ButtonSize, ButtonVariant, IconButton } from '../button.js';
import { SymbolIcon } from '../symbol_icon.js';
import { classNames } from '../../dom/classnames.js';
import { formatResultDetail } from './query_result_header.js';
import type { ResultRowCounts } from './query_result_toolbar.js';

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
    /// The rows of the result
    counts: ResultRowCounts;
    /// The result table, for its size
    resultTable: arrow.Table | null;
    /// The search of the header, before the button that clears the cross filters
    toolbar?: React.ReactNode;
    /// Do the rows pass cross filters? The button that clears them is enabled then
    hasCrossFilters: boolean;
    onClearCrossFilters: () => void;
    /// The controls after it: the download and the actions of the host
    actions?: React.ReactNode;
    fitHeight?: boolean;
    maxHeight?: number;
    /// The table in the layout that the details leave it
    table: (layout: QueryResultDetailsLayout) => React.ReactNode;
}

/// The full result of a query: a header with the row count, the search, the button that clears the cross filters and the
/// controls of the host, over the table
export function QueryResultDetails(props: QueryResultDetailsProps): React.ReactElement {
    const counts = props.counts;
    return (
        <div className={classNames(styles.root, { [styles.root_fit_height]: props.fitHeight })}>
            <TabHeader
                title="Query Results"
                detail={formatResultDetail(counts.matchingRows == null
                    ? formatRowCountDetail(counts.totalRows)
                    : `${counts.matchingRows} of ${counts.currentRows ?? counts.totalRows ?? 0} rows`, props.resultTable)}
                actions={(
                    <>
                        {props.toolbar}
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label="Clear all cross-filters"
                            data-testid="clear-cross-filters"
                            onClick={props.onClearCrossFilters}
                            disabled={!props.hasCrossFilters}
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
