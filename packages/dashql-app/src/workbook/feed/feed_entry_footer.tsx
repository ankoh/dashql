import * as React from 'react';
import * as styles from './feed_entry_footer.module.css';

import icons from '@akohn/dashql-svg-symbols';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { QueryResultView } from '../../results/query_result_view.js';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { VisualizationDispatch } from '../../results/visualization_dispatch.js';
import { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { TraceLogPanel } from '../trace_log_panel.js';
import { QueryProgressPanel } from '../../results/query_progress_panel.js';
import { hasQueryProgress } from '@akohn/dashql-react/components/query_progress/query_progress_panel';
import { TabHeader, formatRowCountDetail } from '@akohn/dashql-react/components/tab_header';
import { resultRowCount } from '@akohn/dashql-react/components/query_result/query_result_toolbar';
import { QueryResultHeader } from '../../results/query_result_header.js';
import { ChartDownloadButton } from '@akohn/dashql-react/components/visualization/chart_download_button';
import { Deferred } from '@akohn/dashql-react/components/deferred';
import { Skeleton } from '@akohn/dashql-react/components/skeleton';

const FEED_LIMIT_RESULT_ROWS = 6;
/// The height of the table of a feed entry that shows more rows in place, with the column plots. It scrolls the rows
/// that don't fit.
const FEED_MORE_ROWS_TABLE_HEIGHT = 480;
/// The Log tab's viewport auto-expands to fit its rows and caps at this many (then scrolls).
const FEED_LIMIT_LOG_ROWS = 6;
/// Cap the Vega-Lite chart height in the feed footer so a single vis entry doesn't dominate the
/// feed while scrolling. Only the vega-lite renderer honors this.
const FEED_VISUALIZATION_HEIGHT = 180;
/// The height of the plan in the Progress tab. The plan and its statistics are fetched while the tab is open.
export const FEED_PROFILE_HEIGHT = 240;

/// The result tabs of a feed entry. The tab strip lives in the entry status bar and the panel of the
/// selected tab below it, so the row owns the selection through `useFeedEntryTabs`.
export enum FeedEntryTab {
    ExecutionLog = 0,
    Table = 1,
    Visualization = 2,
    Progress = 3,
}

export interface FeedEntryTabProps {
    tab: FeedEntryTab;
    icon: string;
    description: string;
}

const FEED_ENTRY_TAB_PROPS: Record<FeedEntryTab, FeedEntryTabProps> = {
    [FeedEntryTab.Progress]: {
        tab: FeedEntryTab.Progress,
        icon: `${icons}#pulse_24`,
        description: 'Query progress',
    },
    [FeedEntryTab.ExecutionLog]: {
        tab: FeedEntryTab.ExecutionLog,
        icon: `${icons}#log_24`,
        description: 'Execution log',
    },
    [FeedEntryTab.Table]: {
        tab: FeedEntryTab.Table,
        icon: `${icons}#table_24`,
        description: 'Query results',
    },
    [FeedEntryTab.Visualization]: {
        tab: FeedEntryTab.Visualization,
        icon: `${icons}#graph_24`,
        description: 'Visualization',
    },
};

export interface FeedEntryTabs {
    /// The usable tabs, in display order
    tabs: FeedEntryTabProps[];
    selectedTab: FeedEntryTab;
    selectTab: (tab: FeedEntryTab) => void;
}

/// Track the tabs of a feed entry result. A query with structured progress (Trino) selects its progress
/// tab, which sits right of the log. A result that arrives switches to its table (or to its chart
/// when the script visualizes it), a result that goes away falls back to the progress or the log. The
/// Details view passes the tab it was opened on as `initialTab`.
export function useFeedEntryTabs(
    model: QueryModel | null,
    visualizeQuery: ResolvedVisualizeQuery | null,
    initialTab?: FeedEntryTab,
): FeedEntryTabs {
    const queryState = model?.query ?? null;
    const { hasResult } = resultRowCount(model);
    const hasVisualization = hasResult && visualizeQuery != null && visualizeQuery.renderer !== 'table';
    const hasLog = queryState?.traceId != null;
    const hasProgress = hasQueryProgress(queryState);
    const fallbackTab = hasProgress ? FeedEntryTab.Progress : FeedEntryTab.ExecutionLog;

    const [selectedTab, selectTab] = React.useState<FeedEntryTab>(
        () => initialTab != null ? initialTab
            : hasVisualization ? FeedEntryTab.Visualization
            : hasResult ? FeedEntryTab.Table
                : fallbackTab
    );

    const prevHasResult = React.useRef(hasResult);
    const prevHasVisualization = React.useRef(hasVisualization);
    const prevHasProgress = React.useRef(hasProgress);
    React.useEffect(() => {
        if (hasResult && !prevHasResult.current) {
            selectTab(hasVisualization ? FeedEntryTab.Visualization : FeedEntryTab.Table);
        } else if (!hasResult && prevHasResult.current) {
            selectTab(fallbackTab);
        } else if (hasVisualization && !prevHasVisualization.current) {
            // A chart for the shown result, e.g. written by the agent after it ran the query
            selectTab(FeedEntryTab.Visualization);
        } else if (hasProgress && !prevHasProgress.current && !hasResult) {
            // The first progress of a running query replaces the log
            selectTab(current => current === FeedEntryTab.ExecutionLog ? FeedEntryTab.Progress : current);
        }
        prevHasResult.current = hasResult;
        prevHasVisualization.current = hasVisualization;
        prevHasProgress.current = hasProgress;
    }, [hasResult, hasVisualization, hasProgress, fallbackTab]);

    // Only surface the tabs that are actually usable
    const tabs = React.useMemo(() => {
        const tabs: FeedEntryTabProps[] = [];
        if (hasLog) tabs.push(FEED_ENTRY_TAB_PROPS[FeedEntryTab.ExecutionLog]);
        if (hasProgress) tabs.push(FEED_ENTRY_TAB_PROPS[FeedEntryTab.Progress]);
        if (hasResult) tabs.push(FEED_ENTRY_TAB_PROPS[FeedEntryTab.Table]);
        if (hasVisualization) tabs.push(FEED_ENTRY_TAB_PROPS[FeedEntryTab.Visualization]);
        return tabs;
    }, [hasProgress, hasLog, hasResult, hasVisualization]);
    React.useEffect(() => {
        if (tabs.length > 0 && !tabs.some(t => t.tab === selectedTab)) {
            selectTab(tabs[0].tab);
        }
    }, [tabs, selectedTab]);

    return { tabs, selectedTab, selectTab };
}

interface FeedEntryTabStripProps {
    tabs: FeedEntryTabs;
    /// Is the result shown? A collapsed result selects none of the tabs.
    expanded?: boolean;
    /// Called after a tab was picked, e.g. to expand a collapsed result
    onSelect?: () => void;
}

/// The result tabs as a compact strip for the entry status bar
export const FeedEntryTabStrip: React.FC<FeedEntryTabStripProps> = ({ tabs, expanded = true, onSelect }) => {
    if (tabs.tabs.length === 0) {
        return null;
    }
    return (
        <div className={styles.tab_strip} role="tablist" aria-label="Result views">
            {tabs.tabs.map(t => {
                const active = expanded && t.tab === tabs.selectedTab;
                return (
                    <button
                        key={t.tab}
                        type="button"
                        role="tab"
                        className={classNames(styles.tab, { [styles.tab_active]: active })}
                        aria-selected={active}
                        aria-label={t.description}
                        title={t.description}
                        data-tab={t.tab}
                        onClick={() => {
                            tabs.selectTab(t.tab);
                            onSelect?.();
                        }}
                    >
                        <svg width="14px" height="14px">
                            <use xlinkHref={t.icon} />
                        </svg>
                    </button>
                );
            })}
        </div>
    );
};

interface FeedEntryFooterProps {
    workbookId: string;
    /// The latest query of the script
    model: QueryModel | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
    /// The tab to show, picked in the tab strip of the entry status bar
    selectedTab: FeedEntryTab;
    /// Open the full result table, makes the header and the column names of the preview clickable
    onShowTable?: () => void;
    /// The table shows all rows in place with a scroller and the column plots, not only the first ones
    moreRows?: boolean;
    /// Show more rows in place, makes the row that counts the rows of the preview clickable. Without it, that row opens
    /// the full result table.
    onShowMoreRows?: () => void;
    /// Show only the first rows again
    onShowFewerRows?: () => void;
}

// Memoized, the card renders it with the props of its result only
export const FeedEntryFooter: React.FC<FeedEntryFooterProps> = React.memo(function FeedEntryFooter(props: FeedEntryFooterProps) {
    const model = props.model;
    const { totalRows } = resultRowCount(model);
    const queryTraceId = model?.query.traceId ?? null;

    // The visualization renders the full cloud (no feed row cap), so the header just shows the
    // total row count.
    const pointCountDetail = formatRowCountDetail(totalRows);

    switch (props.selectedTab) {
        case FeedEntryTab.Progress: return model == null ? null : (
            <QueryProgressPanel query={model.query} showProfile profileHeight={FEED_PROFILE_HEIGHT} />
        );
        case FeedEntryTab.ExecutionLog: return (
            <TraceLogPanel
                traceId={queryTraceId}
                title="Execution Logs"
                maxRows={FEED_LIMIT_LOG_ROWS}
            />
        );
        // The preview shows the first rows. More rows grow the card in place: the rows scroll below the column plots, the
        // full result table opens from the header.
        case FeedEntryTab.Table: return model == null ? null : (
            <>
                <QueryResultHeader
                    model={model}
                    maxRows={props.moreRows ? undefined : FEED_LIMIT_RESULT_ROWS}
                    onShowTable={props.onShowTable}
                />
                <QueryResultView
                    model={model}
                    maxRows={props.moreRows ? undefined : FEED_LIMIT_RESULT_ROWS}
                    columnHeader={props.moreRows ? TableColumnHeader.WithColumnPlots : TableColumnHeader.OnlyColumnName}
                    onShowTable={props.onShowTable}
                    onShowMoreRows={props.onShowMoreRows}
                    onShowFewerRows={props.moreRows ? props.onShowFewerRows : undefined}
                    fitHeight={props.moreRows}
                    maxHeight={props.moreRows ? FEED_MORE_ROWS_TABLE_HEIGHT : undefined}
                    compact
                />
            </>
        );
        case FeedEntryTab.Visualization: return (
            <div className={styles.visualization_tab}>
                <TabHeader
                    title="Visualization"
                    detail={pointCountDetail}
                    actions={model != null && props.visualizeQuery?.renderer === 'vegalite' ? (
                        <ChartDownloadButton model={model} spec={props.visualizeQuery.vegaLiteSpec} />
                    ) : undefined}
                />
                {model != null && (
                    <div className={styles.visualization_body}>
                        {/* The chart shows its skeleton while the sidebar is dragged, it lays out once after the drag */}
                        <Deferred immediate fallback={<Skeleton />}>
                            <VisualizationDispatch
                                model={model}
                                visualizeQuery={props.visualizeQuery}
                                height={FEED_VISUALIZATION_HEIGHT}
                            />
                        </Deferred>
                    </div>
                )}
            </div>
        );
    }
});
