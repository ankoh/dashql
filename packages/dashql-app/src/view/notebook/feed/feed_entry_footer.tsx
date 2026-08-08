import * as React from 'react';
import * as styles from './feed_entry_footer.module.css';

import icons from '@ankoh/dashql-svg-symbols';

import { QueryExecutionState } from '../../../connection/query_execution_state.js';
import { QueryResultView } from '../../query_result/query_result_view.js';
import { TableColumnHeader } from '../../query_result/data_table_cell.js';
import { VerticalTabs, VerticalTabVariant, type VerticalTabProps } from '../../foundations/vertical_tabs.js';
import { VisualizationDispatch } from '../../visualization/visualization_dispatch.js';
import { ResolvedVisualizeQuery } from '../../../scripts/script_types.js';
import { TraceLogPanel } from '../trace_log_panel.js';
import { TabHeader, useResultRowCount, formatRowCountDetail } from '../tab_header.js';

const FEED_LIMIT_RESULT_ROWS = 6;
/// The Log tab's viewport auto-expands to fit its rows and caps at this many (then scrolls).
const FEED_LIMIT_LOG_ROWS = 6;
/// Cap the Vega-Lite chart height in the feed footer so a single vis entry doesn't dominate the
/// feed while scrolling. Only the vega-lite renderer honors this; the umap scatter fills its
/// container as before.
const FEED_VISUALIZATION_HEIGHT = 180;

const enum FooterTab {
    ExecutionLog = 0,
    AgentLog = 1,
    Table = 2,
    Visualization = 3,
}

interface FeedEntryFooterProps {
    notebookId: string;
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
    onShowAgentStatus?: () => void;
    onShowTable?: () => void;
    onShowVisualization?: () => void;
}

export const FeedEntryFooter: React.FC<FeedEntryFooterProps> = (props) => {
    const { hasResult, totalRows } = useResultRowCount(props.queryState);
    const hasVisualization = hasResult && props.visualizeQuery != null;

    // Query execution and agent traces are separate vertical tabs. Each TraceLogPanel only owns its
    // selected trace's viewer and row count.
    const queryTraceId = props.queryState?.traceId ?? null;
    const agentTraceId = props.agentTraceId;

    const [selectedTab, setSelectedTab] = React.useState<FooterTab>(
        () => hasVisualization ? FooterTab.Visualization
            : hasResult ? FooterTab.Table
                : queryTraceId != null ? FooterTab.ExecutionLog : FooterTab.AgentLog
    );

    const prevHasResult = React.useRef(hasResult);
    React.useEffect(() => {
        if (hasResult && !prevHasResult.current) {
            setSelectedTab(hasVisualization ? FooterTab.Visualization : FooterTab.Table);
        } else if (!hasResult && prevHasResult.current) {
            setSelectedTab(queryTraceId != null ? FooterTab.ExecutionLog : FooterTab.AgentLog);
        }
        prevHasResult.current = hasResult;
    }, [hasResult, hasVisualization, queryTraceId]);

    const requestNonce = props.logRequest?.nonce;
    const requestTraceId = props.logRequest?.traceId ?? null;
    const previousRequestNonce = React.useRef(requestNonce);
    React.useEffect(() => {
        if (requestNonce != null && requestNonce !== previousRequestNonce.current) {
            if (requestTraceId != null && requestTraceId === agentTraceId) {
                setSelectedTab(FooterTab.AgentLog);
            } else if (queryTraceId != null) {
                setSelectedTab(FooterTab.ExecutionLog);
            }
        }
        previousRequestNonce.current = requestNonce;
    }, [requestNonce, requestTraceId, queryTraceId, agentTraceId]);

    const tabProps = React.useMemo<Record<FooterTab, VerticalTabProps>>(() => ({
        [FooterTab.ExecutionLog]: {
            tabId: FooterTab.ExecutionLog,
            icon: `${icons}#log_24`,
            labelShort: 'Log',
            ariaLabel: 'Execution log',
            description: 'Execution log',
            disabled: queryTraceId == null,
        },
        [FooterTab.AgentLog]: {
            tabId: FooterTab.AgentLog,
            icon: `${icons}#sparkles_fill_24`,
            labelShort: 'Agent',
            ariaLabel: 'Agent log',
            description: 'Agent log',
            disabled: agentTraceId == null,
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
    }), [queryTraceId, agentTraceId, hasResult, hasVisualization]);

    // Only surface tabs that are actually usable in the sidebar. Rendering the disabled tabs
    // (e.g. Data/Chart before a result exists) padded the vertical tab bar out to its full height,
    // which looked odd next to a footer body that only holds a one-row table or a short log.
    const tabKeys = React.useMemo(() => {
        const keys: FooterTab[] = [FooterTab.ExecutionLog];
        if (agentTraceId != null) keys.push(FooterTab.AgentLog);
        if (hasResult) keys.push(FooterTab.Table);
        if (hasVisualization) keys.push(FooterTab.Visualization);
        return keys;
    }, [agentTraceId, hasResult, hasVisualization]);
    const enabledTabKeys = React.useMemo(
        () => tabKeys.filter(tab => !tabProps[tab].disabled),
        [tabKeys, tabProps],
    );
    React.useEffect(() => {
        if (enabledTabKeys.length > 0 && !enabledTabKeys.includes(selectedTab)) {
            setSelectedTab(enabledTabKeys[0]);
        }
    }, [enabledTabKeys, selectedTab]);

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
        [FooterTab.ExecutionLog]: () => (
            <TraceLogPanel
                traceId={queryTraceId}
                title="Execution Logs"
                maxRows={FEED_LIMIT_LOG_ROWS}
                onHeaderClick={props.onShowStatus}
            />
        ),
        [FooterTab.AgentLog]: () => (
            <TraceLogPanel
                traceId={agentTraceId}
                title="Agent Logs"
                maxRows={FEED_LIMIT_LOG_ROWS}
                onHeaderClick={props.onShowAgentStatus}
            />
        ),
        [FooterTab.Table]: () => (
            <>
                <TabHeader
                    title="Query Results"
                    detail={rowCountDetail}
                    onClick={props.onShowTable}
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
                />
                {props.queryState != null && (
                    <div className={styles.visualization_body}>
                        <VisualizationDispatch
                            query={props.queryState}
                            visualizeQuery={props.visualizeQuery}
                            height={FEED_VISUALIZATION_HEIGHT}
                            transparent
                            wheelZoom={false}
                        />
                    </div>
                )}
            </div>
        ),
    }), [queryTraceId, agentTraceId, props.queryState, props.visualizeQuery, rowCountDetail, pointCountDetail, props.onShowStatus, props.onShowAgentStatus, props.onShowTable, props.onShowVisualization]);

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
