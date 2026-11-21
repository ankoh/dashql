import type * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './query_result_details.module.css';

import { TabHeader, formatRowCountDetail } from '../tab_header.js';
import { ButtonSize, ButtonVariant, IconButton } from '../button.js';
import { SymbolIcon } from '../symbol_icon.js';
import { classNames } from '../../dom/classnames.js';
import { formatResultDetail } from './query_result_header.js';
import { TableSearchToolbar, useResultRowCounts } from './query_result_toolbar.js';
import type { ComputationModel } from '../../models/computation_model.js';
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

export interface TableDetailsProps {
    /// The title of the header
    title: string;
    /// The computation of the table: its rows, its search and its cross filters, none before the table is analyzed
    computation: ComputationModel | null;
    /// The Arrow table whose size the header shows after the row count, none shows only the row count
    resultTable?: arrow.Table | null;
    /// The controls after the search and the button that clears the cross filters: the download and the actions of the host
    actions?: React.ReactNode;
    fitHeight?: boolean;
    maxHeight?: number;
    /// The table in the layout that the details leave it
    table: (layout: QueryResultDetailsLayout) => React.ReactNode;
}

/// Any analyzed table in full: a header with the row count, the search, the button that clears the cross filters and
/// the controls of the host, over the table
export function TableDetails(props: TableDetailsProps): React.ReactElement {
    const computation = props.computation;
    const counts = useResultRowCounts(computation);
    const hasCrossFilters = (computation?.computation.crossFilters.length ?? 0) > 0;
    const clearCrossFilters = React.useCallback(() => {
        computation?.dispatch({ kind: 'clearCrossFilters' });
    }, [computation]);
    return (
        <div className={classNames(styles.root, { [styles.root_fit_height]: props.fitHeight })}>
            <TabHeader
                title={props.title}
                detail={formatResultDetail(counts.matchingRows == null
                    ? formatRowCountDetail(counts.totalRows)
                    : `${counts.matchingRows} of ${counts.currentRows ?? counts.totalRows ?? 0} rows`, props.resultTable ?? null)}
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

/// The full result of a query: the details of its table with the size of its result
export function QueryResultDetails(props: QueryResultDetailsProps): React.ReactElement {
    return (
        <TableDetails
            title="Query Results"
            computation={props.model.computation}
            resultTable={props.model.result}
            actions={props.actions}
            fitHeight={props.fitHeight}
            maxHeight={props.maxHeight}
            table={props.table}
        />
    );
}
