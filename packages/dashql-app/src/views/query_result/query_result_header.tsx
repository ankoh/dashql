import * as React from 'react';
import * as styles from './query_result_header.module.css';

import type { QueryExecutionState } from '../../query/query_execution_state.js';
import { TabHeader, useResultRowCount } from '../../session/tab_header.js';
import { QueryResultView } from './query_result_view.js';
import { TableColumnHeader } from './data_table_cell.js';
import { QueryResultToolbar, useQueryResultRowCounts } from './query_result_toolbar.js';
import { QueryResultDownloadButton } from './query_result_download_button.js';

export interface QueryResultHeaderDependencies {
    useQueryResultRowCounts: typeof useQueryResultRowCounts;
    QueryResultToolbar: typeof QueryResultToolbar;
    QueryResultDownloadButton: typeof QueryResultDownloadButton;
}

const DEFAULT_HEADER_DEPENDENCIES: QueryResultHeaderDependencies = {
    useQueryResultRowCounts,
    QueryResultToolbar,
    QueryResultDownloadButton,
};

/// The row count of a result table: "3 rows", "2 of 3 rows" while searching, "6 of 1000 rows" for a
/// preview that shows at most `maxRows` rows. Null while the total is unknown.
export function formatResultRowCount(counts: ReturnType<typeof useQueryResultRowCounts>, maxRows: number = Infinity): string | null {
    const { totalRows, currentRows, matchingRows } = counts;
    if (totalRows == null) return null;
    if (matchingRows != null) {
        return matchingRows > maxRows
            ? `${maxRows} of ${matchingRows} matching rows`
            : `${matchingRows} of ${currentRows ?? totalRows} rows`;
    }
    return totalRows > maxRows
        ? `${maxRows} of ${totalRows} rows`
        : `${totalRows} ${totalRows === 1 ? 'row' : 'rows'}`;
}

interface HeaderProps {
    query: QueryExecutionState;
    /// The rows the table below shows at most, a preview of more rows counts as "6 of 1000 rows"
    maxRows?: number;
    /// Open the full result table, makes the header clickable
    onShowTable?: () => void;
    /// Draw a border above the header
    topBorder?: boolean;
    dependencies?: QueryResultHeaderDependencies;
}

/// The header over a result table: the title, the row count, the search and the download.
/// The feed entries, the dashboard cards and the dataflow boxes show the same header.
export function QueryResultHeader(props: HeaderProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_HEADER_DEPENDENCIES;
    const counts = dependencies.useQueryResultRowCounts(props.query);
    const maxRows = props.maxRows ?? Infinity;
    const displayedRows = counts.matchingRows ?? counts.totalRows;
    return (
        <TabHeader
            title="Query Results"
            detail={formatResultRowCount(counts, maxRows)}
            onClick={props.onShowTable}
            detailIsLink={displayedRows != null && displayedRows > maxRows}
            borderless
            topBorder={props.topBorder}
            actions={(
                <>
                    <dependencies.QueryResultToolbar query={props.query} />
                    <dependencies.QueryResultDownloadButton query={props.query} />
                </>
            )}
        />
    );
}

interface PanelProps {
    query: QueryExecutionState | null;
    cellBackground?: string;
    /// Draw a border above the header
    headerTopBorder?: boolean;
}

/// A result table with its header that fills its host, for the table renderer of a script in the dashboard and the dataflow
export function QueryResultPanel(props: PanelProps): React.ReactElement {
    const { hasResult } = useResultRowCount(props.query);
    return (
        <div className={styles.panel}>
            {hasResult && props.query != null && <QueryResultHeader query={props.query} topBorder={props.headerTopBorder} />}
            <div className={styles.panel_body}>
                <QueryResultView
                    query={props.query}
                    debugMode={false}
                    columnHeader={TableColumnHeader.OnlyColumnName}
                    cellBackground={props.cellBackground}
                    fitHeight={false}
                    compact
                />
            </div>
        </div>
    );
}
