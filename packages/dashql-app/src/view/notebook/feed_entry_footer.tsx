import * as React from 'react';
import * as styles from './feed_entry_footer.module.css';

import icons from '@ankoh/dashql-svg-symbols';
import type { TopLevelSpec } from 'vega-lite';
import { SparklesFillIcon } from '@primer/octicons-react';

import { QueryExecutionState, QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { LogRecord } from '../../platform/logger/log_buffer.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { TraceLogViewer } from '../internals/trace_log_viewer.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { TableColumnHeader } from '../query_result/data_table_cell.js';
import { useComputationRegistry } from '../../compute/computation_registry.js';
import { SegmentedControl, SegmentedControlSize, SegmentedControlVariant } from '../foundations/segmented_control.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { VerticalTabs, VerticalTabVariant, type VerticalTabProps } from '../foundations/vertical_tabs.js';
import { VisualizationView } from '../visualization/visualization_view.js';

const FEED_LIMIT_RESULT_ROWS = 8;
/// The Log tab's viewport auto-expands to fit its rows and caps at this many (then scrolls).
const FEED_LIMIT_LOG_ROWS = 8;

const enum FooterTab {
    Log = 0,
    Table = 1,
    Visualization = 2,
}

/// Which trace the log tab is showing.
const enum LogSource {
    Query = 0,
    Agent = 1,
}

interface FeedEntryFooterProps {
    sessionId: string;
    /// The latest query execution for this script (null if only an agent run has happened).
    queryState: QueryExecutionState | null;
    /// The latest agent-run trace id for this script (null if no agent run has happened).
    agentTraceId: number | null;
    vegaLiteSpec: TopLevelSpec | null;
    onShowTable?: () => void;
    onShowVisualization?: () => void;
}

function useResultRowCount(queryState: QueryExecutionState | null): { hasResult: boolean; totalRows: number | null } {
    const [computationState] = useComputationRegistry();
    const hasResult = queryState != null
        && queryState.status === QueryExecutionStatus.SUCCEEDED
        && computationState.tableComputations[queryState.queryId] != null;
    const totalRows = hasResult
        ? (computationState.tableComputations[queryState!.queryId]?.dataTable.numRows ?? null)
        : null;
    return { hasResult, totalRows };
}

/// Track the timestamp of the most recent log record on a trace. Returns 0 when the trace has no
/// id or no records yet. Used to decide which log source (query vs agent) is "most recent" so the
/// Log tab can auto-follow whichever trace is currently producing output.
function useTraceLastTimestamp(traceId: number | null): number {
    const logger = useLogger();
    const [lastTimestamp, setLastTimestamp] = React.useState(0);
    React.useEffect(() => {
        if (traceId == null) {
            setLastTimestamp(0);
            return;
        }
        const initial = logger.buffer.collectTraceLogs(traceId);
        setLastTimestamp(initial.length > 0 ? initial[initial.length - 1].timestamp : 0);
        const observer = (record: LogRecord) => {
            setLastTimestamp(prev => Math.max(prev, record.timestamp));
        };
        logger.buffer.subscribeTrace(traceId, observer);
        return () => logger.buffer.unsubscribeTrace(traceId, observer);
    }, [traceId, logger]);
    return lastTimestamp;
}

/// Track the number of log records on a trace, updating as records stream in. Returns 0 when the
/// trace has no id. Drives the Log tab's "N of M rows" indicator (mirrors the Data tab's row count).
function useTraceLogCount(traceId: number | null): number {
    const logger = useLogger();
    const [count, setCount] = React.useState(0);
    React.useEffect(() => {
        if (traceId == null) {
            setCount(0);
            return;
        }
        setCount(logger.buffer.collectTraceLogs(traceId).length);
        const observer = () => setCount(prev => prev + 1);
        logger.buffer.subscribeTrace(traceId, observer);
        return () => logger.buffer.unsubscribeTrace(traceId, observer);
    }, [traceId, logger]);
    return count;
}

interface TabHeaderProps {
    title: string;
    detail?: string | null;
    onClick?: () => void;
}

const TabHeader: React.FC<TabHeaderProps> = ({ title, detail, onClick }) => (
    <div className={onClick ? styles.tab_header_clickable : styles.tab_header} onClick={onClick}>
        <span className={styles.tab_header_title}>{title}</span>
        {detail && <span className={styles.tab_header_detail}>{detail}</span>}
    </div>
);

export const FeedEntryFooter: React.FC<FeedEntryFooterProps> = (props) => {
    const { hasResult, totalRows } = useResultRowCount(props.queryState);
    const hasVisualization = hasResult && props.vegaLiteSpec != null;

    // The two log sources: the query execution's trace and the latest agent run's trace.
    const queryTraceId = props.queryState?.traceId ?? null;
    const agentTraceId = props.agentTraceId;
    const [logSource, setLogSource] = React.useState<LogSource>(LogSource.Query);
    // Fall back to whichever source is available if the selected one has no trace.
    const resolvedLogSource = (logSource === LogSource.Query && queryTraceId != null) ? LogSource.Query
        : (logSource === LogSource.Agent && agentTraceId != null) ? LogSource.Agent
            : (queryTraceId != null) ? LogSource.Query
                : LogSource.Agent;
    const activeLogTraceId = resolvedLogSource === LogSource.Query ? queryTraceId : agentTraceId;

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

    // Auto-follow the log source that most recently produced output: whichever trace's last-message
    // timestamp just advanced becomes the selected source. A manual segmented-control click persists
    // until the next message arrives on either trace.
    const queryLastTs = useTraceLastTimestamp(queryTraceId);
    const agentLastTs = useTraceLastTimestamp(agentTraceId);
    const prevQueryTs = React.useRef(queryLastTs);
    const prevAgentTs = React.useRef(agentLastTs);
    React.useEffect(() => {
        const queryAdvanced = queryLastTs > prevQueryTs.current;
        const agentAdvanced = agentLastTs > prevAgentTs.current;
        prevQueryTs.current = queryLastTs;
        prevAgentTs.current = agentLastTs;
        if (queryAdvanced && agentAdvanced) {
            setLogSource(agentLastTs >= queryLastTs ? LogSource.Agent : LogSource.Query);
        } else if (agentAdvanced) {
            setLogSource(LogSource.Agent);
        } else if (queryAdvanced) {
            setLogSource(LogSource.Query);
        }
    }, [queryLastTs, agentLastTs]);

    // A freshly started agent run (new trace id) pulls the footer to the Log tab so its progress is
    // visible in the card immediately after the user submits the prompt.
    const prevAgentTraceId = React.useRef(agentTraceId);
    React.useEffect(() => {
        if (agentTraceId != null && agentTraceId !== prevAgentTraceId.current) {
            setSelectedTab(FooterTab.Log);
            setLogSource(LogSource.Agent);
        }
        prevAgentTraceId.current = agentTraceId;
    }, [agentTraceId]);

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

    const dataRowCount = totalRows != null ? Math.min(totalRows, FEED_LIMIT_RESULT_ROWS) : null;
    const rowCountDetail = totalRows != null
        ? (totalRows > FEED_LIMIT_RESULT_ROWS
            ? `${dataRowCount} of ${totalRows} rows`
            : `${totalRows} ${totalRows === 1 ? 'row' : 'rows'}`)
        : null;

    // "N of M rows" indicator for the Log tab, mirroring the Data tab. Only the last
    // FEED_LIMIT_LOG_ROWS rows are visible in the scrollless preview, so we surface the total.
    const totalLogRows = useTraceLogCount(activeLogTraceId);
    const shownLogRows = Math.min(totalLogRows, FEED_LIMIT_LOG_ROWS);
    const logCountDetail = totalLogRows > FEED_LIMIT_LOG_ROWS
        ? `${shownLogRows} of ${totalLogRows} rows`
        : `${totalLogRows} ${totalLogRows === 1 ? 'row' : 'rows'}`;

    // Query and Agent share the command-list icons (query = search_16, agent = SparklesFillIcon).
    const QueryLogIcon = SymbolIcon('search_16');

    const tabRenderers = React.useMemo(() => ({
        [FooterTab.Log]: () => (
            <>
                <div className={styles.log_tab_header}>
                    <span className={styles.tab_header_title}>Logs</span>
                    <span className={styles.tab_header_detail}>{logCountDetail}</span>
                    <SegmentedControl
                        className={styles.log_source_control}
                        aria-label="Log source"
                        size={SegmentedControlSize.Tiny}
                        variant={SegmentedControlVariant.Invisible}
                        onChange={(index) => setLogSource(index === 1 ? LogSource.Agent : LogSource.Query)}
                    >
                        <SegmentedControl.Button
                            leadingVisual={QueryLogIcon}
                            selected={resolvedLogSource === LogSource.Query}
                            disabled={queryTraceId == null}
                        >
                            Execution
                        </SegmentedControl.Button>
                        <SegmentedControl.Button
                            leadingVisual={SparklesFillIcon}
                            selected={resolvedLogSource === LogSource.Agent}
                            disabled={agentTraceId == null}
                        >
                            Agent
                        </SegmentedControl.Button>
                    </SegmentedControl>
                </div>
                <TraceLogViewer traceId={activeLogTraceId ?? undefined} maxRows={FEED_LIMIT_LOG_ROWS} />
            </>
        ),
        [FooterTab.Table]: () => (
            <>
                <TabHeader title="Query Results" detail={rowCountDetail} onClick={props.onShowTable} />
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
            <>
                <TabHeader title="Visualization" onClick={props.onShowVisualization} />
                {props.queryState != null && (
                    <VisualizationView query={props.queryState} vegaLiteSpec={props.vegaLiteSpec} />
                )}
            </>
        ),
    }), [activeLogTraceId, resolvedLogSource, queryTraceId, agentTraceId, QueryLogIcon, props.queryState, props.vegaLiteSpec, rowCountDetail, logCountDetail, props.onShowTable, props.onShowVisualization]);

    return (
        <VerticalTabs
            className={styles.footer_container}
            variant={VerticalTabVariant.Stacked}
            tabKeys={[FooterTab.Log, FooterTab.Table, FooterTab.Visualization]}
            tabProps={tabProps}
            tabRenderers={tabRenderers}
            selectedTab={selectedTab}
            selectTab={setSelectedTab}
        />
    );
};
