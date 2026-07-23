import * as React from 'react';
import * as styles from './feed_entry_footer.module.css';

import icons from '@ankoh/dashql-svg-symbols';

import { QueryExecutionState } from '../../connection/query_execution_state.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { TableColumnHeader } from '../query_result/data_table_cell.js';
import { VerticalTabs, VerticalTabVariant, type VerticalTabProps } from '../foundations/vertical_tabs.js';
import { VisualizationDispatch } from '../visualization/visualization_dispatch.js';
import { ResolvedVisualizeQuery } from '../../notebook/notebook_types.js';
import { TraceLogPanel } from './trace_log_panel.js';
import { TabHeader, useResultRowCount, formatRowCountDetail } from './tab_header.js';
import { QueryResultCacheLabel, QueryResultRerunButton } from './query_result_cache_controls.js';

const FEED_LIMIT_RESULT_ROWS = 8;
/// The Log tab's viewport auto-expands to fit its rows and caps at this many (then scrolls).
const FEED_LIMIT_LOG_ROWS = 8;

const enum FooterTab {
    Log = 0,
    Table = 1,
    Visualization = 2,
}

interface FeedEntryFooterProps {
    sessionId: string;
    /// The latest query execution for this script (null if only an agent run has happened).
    queryState: QueryExecutionState | null;
    /// The latest agent-run trace id for this script (null if no agent run has happened).
    agentTraceId: number | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
    /// A log-reveal request from the card's status bar: whenever `nonce` advances, jump to the Log
    /// tab and select the source matching `traceId` (query vs agent). Bumped when the user clicks the
    /// status bar, so the footer reveals the trace on demand instead of auto-hijacking the tab the
    /// moment work starts.
    logRequest?: { nonce: number; traceId: number | null };
    onShowStatus?: () => void;
    onShowTable?: () => void;
    onShowVisualization?: () => void;
    /// Re-execute this entry's query (surfaced on cached results); receives the result's cache key so
    /// the stale entry can be dropped before re-running.
    onRerun?: (cacheKey: string | null) => void;
}

export const FeedEntryFooter: React.FC<FeedEntryFooterProps> = (props) => {
    const { hasResult, totalRows } = useResultRowCount(props.queryState);
    const hasVisualization = hasResult && props.visualizeQuery != null;

    // The two log sources: the query execution's trace and the latest agent run's trace. Source
    // selection, auto-follow, and the "N of M rows" count now live in the shared TraceLogPanel; the
    // footer only owns which tab is selected.
    const queryTraceId = props.queryState?.traceId ?? null;
    const agentTraceId = props.agentTraceId;

    const [selectedTab, setSelectedTab] = React.useState<FooterTab>(
        () => hasVisualization ? FooterTab.Visualization : (hasResult ? FooterTab.Table : FooterTab.Log)
    );

    const prevHasResult = React.useRef(hasResult);
    React.useEffect(() => {
        if (hasResult && !prevHasResult.current) {
            setSelectedTab(hasVisualization ? FooterTab.Visualization : FooterTab.Table);
        } else if (!hasResult && prevHasResult.current) {
            setSelectedTab(FooterTab.Log);
        }
        prevHasResult.current = hasResult;
    }, [hasResult, hasVisualization]);

    // The card's status bar drives the footer to the Log tab on demand: work no longer yanks the
    // footer to the log the moment it starts (the user is rarely interested in the raw trace — the
    // status bar's spinner + latest line is enough). The panel resolves the clicked trace to a
    // source; we only switch to the Log tab when it reports it handled the request.
    const revealLogTab = React.useCallback(() => setSelectedTab(FooterTab.Log), []);

    const tabProps = React.useMemo<Record<FooterTab, VerticalTabProps>>(() => ({
        [FooterTab.Log]: {
            tabId: FooterTab.Log,
            icon: `${icons}#log_24`,
            labelShort: 'Log',
            ariaLabel: 'Trace log',
            description: 'Trace log',
        },
        [FooterTab.Table]: {
            tabId: FooterTab.Table,
            icon: `${icons}#table_24`,
            labelShort: 'Data',
            ariaLabel: 'Query results',
            description: 'Query results',
            disabled: !hasResult,
        },
        [FooterTab.Visualization]: {
            tabId: FooterTab.Visualization,
            icon: `${icons}#graph_24`,
            labelShort: 'Chart',
            ariaLabel: 'Visualization',
            description: 'Visualization',
            disabled: !hasVisualization,
        },
    }), [hasResult, hasVisualization]);

    // Only surface tabs that are actually usable in the sidebar. Rendering the disabled tabs
    // (e.g. Data/Chart before a result exists) padded the vertical tab bar out to its full height,
    // which looked odd next to a footer body that only holds a one-row table or a short log.
    const tabKeys = React.useMemo(() => {
        const keys: FooterTab[] = [FooterTab.Log];
        if (hasResult) keys.push(FooterTab.Table);
        if (hasVisualization) keys.push(FooterTab.Visualization);
        return keys;
    }, [hasResult, hasVisualization]);

    const dataRowCount = totalRows != null ? Math.min(totalRows, FEED_LIMIT_RESULT_ROWS) : null;
    const rowCountDetail = totalRows != null
        ? (totalRows > FEED_LIMIT_RESULT_ROWS
            ? `${dataRowCount} of ${totalRows} rows`
            : `${totalRows} ${totalRows === 1 ? 'row' : 'rows'}`)
        : null;

    // The visualization renders the full cloud (no feed row cap), so the header just shows the
    // total row count.
    const pointCountDetail = formatRowCountDetail(totalRows);

    const tabRenderers = React.useMemo(() => ({
        [FooterTab.Log]: () => (
            <TraceLogPanel
                queryTraceId={queryTraceId}
                agentTraceId={agentTraceId}
                logRequest={props.logRequest}
                maxRows={FEED_LIMIT_LOG_ROWS}
                onLogRequestHandled={revealLogTab}
                onHeaderClick={props.onShowStatus}
            />
        ),
        [FooterTab.Table]: () => (
            <>
                <TabHeader
                    title="Query Results"
                    detail={rowCountDetail}
                    onClick={props.onShowTable}
                    actions={
                        <>
                            <QueryResultCacheLabel query={props.queryState} />
                            <QueryResultRerunButton query={props.queryState} onRerun={props.onRerun} />
                        </>
                    }
                />
                {props.queryState != null && (
                    <QueryResultView
                        query={props.queryState}
                        debugMode={false}
                        maxRows={FEED_LIMIT_RESULT_ROWS}
                        columnHeader={TableColumnHeader.OnlyColumnName}
                        cellBackground="var(--notebook_feed_entry_footer_background)"
                        onShowTable={props.onShowTable}
                    />
                )}
            </>
        ),
        [FooterTab.Visualization]: () => (
            <div className={styles.visualization_tab}>
                <TabHeader
                    title="Visualization"
                    detail={pointCountDetail}
                    onClick={props.onShowVisualization}
                    actions={
                        <>
                            <QueryResultCacheLabel query={props.queryState} />
                            <QueryResultRerunButton query={props.queryState} onRerun={props.onRerun} />
                        </>
                    }
                />
                {props.queryState != null && (
                    <div className={styles.visualization_body}>
                        <VisualizationDispatch
                            query={props.queryState}
                            visualizeQuery={props.visualizeQuery}
                            transparent
                            wheelZoom={false}
                        />
                    </div>
                )}
            </div>
        ),
    }), [props.sessionId, queryTraceId, agentTraceId, props.logRequest, revealLogTab, props.queryState, props.visualizeQuery, rowCountDetail, pointCountDetail, props.onShowStatus, props.onShowTable, props.onShowVisualization, props.onRerun]);

    return (
        <VerticalTabs
            className={styles.footer_container}
            variant={VerticalTabVariant.Stacked}
            tabKeys={tabKeys}
            tabProps={tabProps}
            tabRenderers={tabRenderers}
            selectedTab={selectedTab}
            selectTab={setSelectedTab}
        />
    );
};
