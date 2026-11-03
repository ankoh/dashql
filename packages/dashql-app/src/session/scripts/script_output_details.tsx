import * as React from 'react';

import type { QueryExecutionState } from '../../query/query_execution_state.js';
import type { ResolvedVisualizeQuery } from './script_types.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { QueryResultDetails } from '../../views/query_result/query_result_details.js';
import { VisualizationDispatch } from '../../views/visualization/visualization_dispatch.js';
import { ChartDownloadButton } from '../../views/visualization/chart_download_button.js';
import { ColumnAggregationBar } from '../../views/visualization/column_aggregation_bar.js';
import { IndicatorStatus } from '../../ui/foundations/status_indicator.js';
import { EntryStatusBar } from '../entry_status_bar.js';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { TabHeader, formatRowCountDetail, useResultRowCount } from '../tab_header.js';
import { FeedEntryTab, FeedEntryTabStrip, useFeedEntryTabs } from '../feed/feed_entry_footer.js';
import { QueryProgressPanel } from '../../views/query_progress/query_progress_panel.js';
import { TraceLogPanel } from '../trace_log_panel.js';
import * as styles from './script_output_details.module.css';
import { classNames } from '../../utils/classnames.js';

/// The tabs a Details view can be opened on. The result tabs map onto the tabs of the feed entry
/// card, whose tab strip the Details view shares.
export enum ScriptDetailsTab {
    Editor = 0,
    QueryStatusPanel = 1,
    QueryResultView = 2,
    Visualization = 3,
}

interface Props {
    className?: string;
    embedded?: boolean;
    query: QueryExecutionState | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
    initialTab?: ScriptDetailsTab;
    tableDebugMode: boolean;
    statusActions?: React.ReactNode;
    onCancelQuery?: () => void;
    expanded?: boolean;
    onToggleExpanded?: () => void;
    contentId?: string;
}

const RESULT_TABS: Partial<Record<ScriptDetailsTab, FeedEntryTab>> = {
    [ScriptDetailsTab.QueryStatusPanel]: FeedEntryTab.ExecutionLog,
    [ScriptDetailsTab.QueryResultView]: FeedEntryTab.Table,
    [ScriptDetailsTab.Visualization]: FeedEntryTab.Visualization,
};

/// The result card of the Details view. It follows the feed entry card: the result tabs sit in the
/// status bar and the selected tab fills the content below it.
export const ScriptOutputDetails: React.FC<Props> = (props) => {
    const { totalRows } = useResultRowCount(props.query);
    const entryStatus = deriveEntryStatus(props.query);
    const resultTabs = useFeedEntryTabs(props.query, props.visualizeQuery, undefined,
        props.initialTab != null ? RESULT_TABS[props.initialTab] : undefined);

    const { tabs, selectTab } = resultTabs;
    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [{
        key: 'j',
        ctrlKey: true,
        callback: () => {
            if (tabs.length === 0) return;
            const currentIndex = tabs.findIndex(t => t.tab === resultTabs.selectedTab);
            selectTab(tabs[(currentIndex + 1) % tabs.length].tab);
        },
    }], [tabs, selectTab, resultTabs.selectedTab]);
    useKeyEvents(keyHandlers);

    const renderTab = () => {
        switch (resultTabs.selectedTab) {
            case FeedEntryTab.Progress: return props.query != null && (
                <div className={styles.tab_body}>
                    <QueryProgressPanel query={props.query} showProfile />
                </div>
            );
            case FeedEntryTab.ExecutionLog: return (
                <div className={styles.tab_body}>
                    <TraceLogPanel traceId={props.query?.traceId ?? null} title="Execution Logs" />
                </div>
            );
            case FeedEntryTab.Table: return props.query != null && (
                <QueryResultDetails query={props.query} debugMode={props.tableDebugMode} />
            );
            case FeedEntryTab.Visualization: return props.query != null && (
                <div className={styles.visualization}>
                    <TabHeader
                        title="Visualization"
                        detail={formatRowCountDetail(totalRows)}
                        actions={props.visualizeQuery?.renderer === 'vegalite' ? (
                            <ChartDownloadButton query={props.query} spec={props.visualizeQuery.vegaLiteSpec} />
                        ) : undefined}
                    />
                    <ColumnAggregationBar query={props.query} debugMode={props.tableDebugMode} />
                    <div className={styles.visualization_body}>
                        <VisualizationDispatch query={props.query} visualizeQuery={props.visualizeQuery} />
                    </div>
                </div>
            );
        }
    };

    const cancel = entryStatus.kind === EntryStatusKind.Query ? props.onCancelQuery : undefined;
    const expanded = props.expanded !== false;
    return (
        <div className={classNames(styles.card, props.className, { [styles.embedded]: props.embedded })}>
            <EntryStatusBar
                status={entryStatus}
                onToggleExpanded={props.onToggleExpanded}
                expanded={props.expanded}
                controls={props.contentId}
                onCancel={entryStatus.indicator === IndicatorStatus.Running ? cancel : undefined}
                cancelLabel="Cancel query"
                compact
                tabs={
                    <FeedEntryTabStrip
                        tabs={resultTabs}
                        expanded={expanded}
                        onSelect={!expanded ? props.onToggleExpanded : undefined}
                    />
                }
                actions={props.statusActions}
            />
            <div id={props.contentId} className={styles.content} hidden={!expanded}>
                {tabs.length > 0 && renderTab()}
            </div>
        </div>
    );
};
