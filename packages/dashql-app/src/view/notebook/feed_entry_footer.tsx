import * as React from 'react';
import * as styles from './feed_entry_footer.module.css';

import icons from '@ankoh/dashql-svg-symbols';
import type { TopLevelSpec } from 'vega-lite';

import { QueryExecutionState, QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { TraceLogViewer } from '../internals/trace_log_viewer.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { TableColumnHeader } from '../query_result/data_table_cell.js';
import { useComputationRegistry } from '../../compute/computation_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useRelativeTime } from '../../utils/time_format.js';
import { VerticalTabs, VerticalTabVariant, type VerticalTabProps } from '../foundations/vertical_tabs.js';
import { VisualizationView } from '../visualization/visualization_view.js';

const FEED_LIMIT_RESULT_ROWS = 8;

const enum FooterTab {
    Log = 0,
    Table = 1,
    Visualization = 2,
}

interface FeedEntryFooterProps {
    sessionId: string;
    queryId: number;
    traceId: number;
    queryState: QueryExecutionState;
    vegaLiteSpec: TopLevelSpec | null;
    onShowTable?: () => void;
    onShowStatus?: () => void;
}

function useResultRowCount(queryState: QueryExecutionState, queryId: number): { hasResult: boolean; totalRows: number | null } {
    const [computationState] = useComputationRegistry();
    const hasResult = queryState.status === QueryExecutionStatus.SUCCEEDED
        && computationState.tableComputations[queryId] != null;
    const totalRows = hasResult
        ? (computationState.tableComputations[queryId]?.dataTable.numRows ?? null)
        : null;
    return { hasResult, totalRows };
}

function useLastTraceTimestamp(traceId: number): number | null {
    const logger = useLogger();
    const [timestamp, setTimestamp] = React.useState<number | null>(() => {
        const logs = logger.buffer.collectTraceLogs(traceId);
        return logs.length > 0 ? logs[logs.length - 1].timestamp : null;
    });

    React.useEffect(() => {
        const observer = (record: { timestamp: number }) => {
            setTimestamp(record.timestamp);
        };
        logger.buffer.subscribeTrace(traceId, observer);
        return () => {
            logger.buffer.unsubscribeTrace(traceId, observer);
        };
    }, [traceId, logger]);

    return timestamp;
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
    const { hasResult, totalRows } = useResultRowCount(props.queryState, props.queryId);
    const lastLogTimestamp = useLastTraceTimestamp(props.traceId);
    const lastLogAgo = useRelativeTime(lastLogTimestamp);
    const hasVisualization = hasResult && props.vegaLiteSpec != null;
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
            icon: `${icons}#graph_plus`,
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

    const tabRenderers = React.useMemo(() => ({
        [FooterTab.Log]: () => (
            <>
                <TabHeader title="Log" detail={lastLogAgo} onClick={props.onShowStatus} />
                <TraceLogViewer traceId={props.traceId} height={96} />
            </>
        ),
        [FooterTab.Table]: () => (
            <>
                <TabHeader title="Query Results" detail={rowCountDetail} onClick={props.onShowTable} />
                <QueryResultView
                    query={props.queryState}
                    debugMode={false}
                    maxRows={FEED_LIMIT_RESULT_ROWS}
                    columnHeader={TableColumnHeader.OnlyColumnName}
                    cellBackground="var(--notebook_feed_entry_footer_background)"
                    onShowTable={props.onShowTable}
                />
            </>
        ),
        [FooterTab.Visualization]: () => (
            <>
                <TabHeader title="Visualization" onClick={props.onShowTable} />
                <VisualizationView query={props.queryState} vegaLiteSpec={props.vegaLiteSpec} />
            </>
        ),
    }), [props.traceId, props.queryState, props.vegaLiteSpec, rowCountDetail, lastLogAgo, props.onShowTable, props.onShowStatus]);

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
