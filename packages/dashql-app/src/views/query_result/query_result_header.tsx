import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './query_result_header.module.css';

import { QueryExecutionStatus, type QueryExecutionState } from '../../query/query_execution_state.js';
import { TabHeader } from '../../session/tab_header.js';
import { QueryResultView } from './query_result_view.js';
import { TableColumnHeader } from './data_table_cell.js';
import { QueryResultToolbar, useQueryResultRowCounts } from './query_result_toolbar.js';
import { QueryResultDownloadButton } from './query_result_download_button.js';
import { QueryResultActionMenu } from './query_result_action_menu.js';
import { fittingRowCount } from './data_table.js';
import { QueryStatusPlaceholder } from '../card_placeholder.js';
import { formatBytes } from '../../utils/format.js';

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

/// The bytes of a result table, weakly keyed by the table so a size never outlives it.
const resultTableBytes = new WeakMap<arrow.Table, number>();

/// The bytes the buffers of a result table hold in memory. Sums the buffer sizes of every column of every batch without
/// reading a row, and adds every dictionary once since the batches of a column share it.
export function getResultTableBytes(table: arrow.Table): number {
    const cached = resultTableBytes.get(table);
    if (cached !== undefined) return cached;
    const dictionaries = new Set<arrow.Vector>();
    const collectDictionaries = (data: arrow.Data) => {
        if (data.dictionary != null) dictionaries.add(data.dictionary);
        for (const child of data.children) collectDictionaries(child);
    };
    let bytes = 0;
    for (const batch of table.batches) {
        bytes += batch.data.byteLength;
        collectDictionaries(batch.data);
    }
    for (const dictionary of dictionaries) {
        for (const data of dictionary.data) bytes += data.byteLength;
    }
    resultTableBytes.set(table, bytes);
    return bytes;
}

/// The detail of a result header: the row count followed by the size of the result table, "3 rows, 1.2 kB".
/// Null while the row count is unknown, only the row count while the result table is not there yet.
export function formatResultDetail(rowCount: string | null, resultTable: arrow.Table | null): string | null {
    if (rowCount == null || resultTable == null) return rowCount;
    return `${rowCount}, ${formatBytes(getResultTableBytes(resultTable))}`;
}

interface HeaderProps {
    query: QueryExecutionState;
    /// The rows the table below shows at most, a preview of more rows counts as "6 of 1000 rows"
    maxRows?: number;
    /// Open the full result table, makes the header clickable
    onShowTable?: () => void;
    dependencies?: QueryResultHeaderDependencies;
}

/// The header over a result table: the title, the row count, the search, the download and the actions.
/// The feed entries, the dashboard cards and the dataflow boxes show the same header.
export function QueryResultHeader(props: HeaderProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_HEADER_DEPENDENCIES;
    const counts = dependencies.useQueryResultRowCounts(props.query);
    const maxRows = props.maxRows ?? Infinity;
    const displayedRows = counts.matchingRows ?? counts.totalRows;
    return (
        <TabHeader
            title="Query Results"
            detail={formatResultDetail(formatResultRowCount(counts, maxRows), props.query.resultTable)}
            onClick={props.onShowTable}
            detailIsLink={displayedRows != null && displayedRows > maxRows}
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

/// A result table with its header that fills its host, for the table renderer of a script in the dashboard and the dataflow.
/// The table shows the rows that fit into the host and does not scroll, like the preview of a feed entry. It fills the host,
/// a last row that does not fit is cut off at the bottom.
export function QueryResultPanel(props: PanelProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_PANEL_DEPENDENCIES;
    const bodyRef = React.useRef<HTMLDivElement | null>(null);
    const [bodyHeight, setBodyHeight] = React.useState<number | null>(null);
    // Measured before the first paint, the table never shows more rows than fit
    React.useLayoutEffect(() => {
        const body = bodyRef.current;
        if (body == null) return;
        setBodyHeight(body.clientHeight);
        const observer = new ResizeObserver(entries => setBodyHeight(entries[0]?.contentRect.height ?? body.clientHeight));
        observer.observe(body);
        return () => observer.disconnect();
    }, []);
    const maxRows = bodyHeight == null ? 0 : fittingRowCount(bodyHeight);
    return (
        <div className={styles.panel}>
            {/* The header stays while a query runs, like in the feed: the table may show before the query succeeds and must
                not lose the height of the header then */}
            {props.query != null && <QueryResultHeader query={props.query} maxRows={maxRows} onShowTable={props.onShowTable} dependencies={dependencies} />}
            <div ref={bodyRef} className={styles.panel_body}>
                {/* Before the first run and while a query has no rows yet, the body shows the logo with the status below it */}
                {props.query == null || (props.query.resultTable == null && props.query.status !== QueryExecutionStatus.SUCCEEDED)
                    ? <QueryStatusPlaceholder query={props.query} />
                    : <dependencies.QueryResultView
                        query={props.query}
                        debugMode={false}
                        maxRows={maxRows}
                        columnHeader={TableColumnHeader.OnlyColumnName}
                        cellBackground={props.cellBackground}
                        onShowTable={props.onShowTable}
                        fitHeight={false}
                        fillHeight
                        compact
                    />}
            </div>
        </div>
    );
}
