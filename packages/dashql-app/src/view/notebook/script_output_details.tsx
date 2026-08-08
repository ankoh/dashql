import * as React from 'react';

import icons from '@ankoh/dashql-svg-symbols';

import type { AgentRunState } from '../../agent/agent_run_state.js';
import type { QueryExecutionState } from '../../connection/query_execution_state.js';
import { QueryExecutionStatus } from '../../connection/query_execution_state.js';
import type { ResolvedVisualizeQuery } from '../../scripts/script_types.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { QueryResultDetails } from '../query_result/query_result_details.js';
import { VisualizationDispatch } from '../visualization/visualization_dispatch.js';
import { ColumnAggregationBar } from '../visualization/column_aggregation_bar.js';
import { VerticalTabs, VerticalTabProps, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { IndicatorStatus } from '../foundations/status_indicator.js';
import { EntryStatusBar } from './entry_status_bar.js';
import { deriveEntryStatus, EntryStatusKind } from './entry_status_model.js';
import { TabHeader, formatRowCountDetail, useResultRowCount } from './tab_header.js';
import { TraceLogPanel } from './trace_log_panel.js';
import * as styles from './script_output_details.module.css';

export enum ScriptDetailsTab {
    Editor = 0,
    QueryStatusPanel = 1,
    QueryResultView = 2,
    Visualization = 3,
    AgentStatusPanel = 4,
}

interface Props {
    query: QueryExecutionState | null;
    agentRun?: AgentRunState | null;
    visualizeQuery: ResolvedVisualizeQuery | null;
    initialTab?: ScriptDetailsTab;
    tableDebugMode: boolean;
    statusActions?: React.ReactNode;
    onCancelQuery?: () => void;
    onCancelAgent?: () => void;
    onClose: () => void;
}

export const ScriptOutputDetails: React.FC<Props> = (props) => {
    const agentRun = props.agentRun ?? null;
    const queryTraceId = props.query?.traceId ?? null;
    const agentTraceId = agentRun?.traceId ?? null;
    const { hasResult, totalRows } = useResultRowCount(props.query);
    const hasVisualization = hasResult && props.visualizeQuery != null;
    const entryStatus = deriveEntryStatus(agentRun, props.query);

    const defaultTab = () => {
        if (props.initialTab != null && props.initialTab !== ScriptDetailsTab.Editor) return props.initialTab;
        if (hasVisualization) return ScriptDetailsTab.Visualization;
        if (hasResult) return ScriptDetailsTab.QueryResultView;
        if (queryTraceId != null) return ScriptDetailsTab.QueryStatusPanel;
        return ScriptDetailsTab.AgentStatusPanel;
    };
    const [selectedTab, selectTab] = React.useState<ScriptDetailsTab>(defaultTab);

    const tabProps = React.useMemo<Record<ScriptDetailsTab, VerticalTabProps>>(() => ({
        [ScriptDetailsTab.Editor]: {
            tabId: ScriptDetailsTab.Editor,
            icon: '',
            labelShort: 'Editor',
            disabled: true,
        },
        [ScriptDetailsTab.QueryStatusPanel]: {
            tabId: ScriptDetailsTab.QueryStatusPanel,
            icon: `${icons}#log_24`,
            labelShort: 'Log',
            ariaLabel: 'Execution log',
            description: 'Execution log',
            disabled: queryTraceId == null,
        },
        [ScriptDetailsTab.AgentStatusPanel]: {
            tabId: ScriptDetailsTab.AgentStatusPanel,
            icon: `${icons}#sparkles_fill_24`,
            labelShort: 'Agent',
            ariaLabel: 'Agent log',
            description: 'Agent log',
            disabled: agentTraceId == null,
        },
        [ScriptDetailsTab.QueryResultView]: {
            tabId: ScriptDetailsTab.QueryResultView,
            icon: `${icons}#table_24`,
            labelShort: 'Data',
            ariaLabel: 'Query results',
            description: 'Query results',
            disabled: !hasResult,
        },
        [ScriptDetailsTab.Visualization]: {
            tabId: ScriptDetailsTab.Visualization,
            icon: `${icons}#graph_24`,
            labelShort: 'Chart',
            ariaLabel: 'Visualization',
            description: 'Visualization',
            disabled: !hasVisualization,
        },
    }), [agentTraceId, hasResult, hasVisualization, queryTraceId]);

    const tabKeys = React.useMemo(() => {
        const tabs = [ScriptDetailsTab.QueryStatusPanel];
        if (agentTraceId != null) tabs.push(ScriptDetailsTab.AgentStatusPanel);
        if (hasResult) tabs.push(ScriptDetailsTab.QueryResultView);
        if (hasVisualization) tabs.push(ScriptDetailsTab.Visualization);
        return tabs;
    }, [agentTraceId, hasResult, hasVisualization]);
    const enabledTabs = React.useMemo(
        () => tabKeys.filter(tab => !tabProps[tab].disabled),
        [tabKeys, tabProps],
    );

    React.useEffect(() => {
        if (enabledTabs.length > 0 && !enabledTabs.includes(selectedTab)) {
            selectTab(enabledTabs[0]);
        }
    }, [enabledTabs, selectedTab]);

    const previousStatus = React.useRef<QueryExecutionStatus | null>(props.query?.status ?? null);
    React.useEffect(() => {
        const status = props.query?.status ?? null;
        if (status === previousStatus.current) return;
        previousStatus.current = status;
        if (status === QueryExecutionStatus.SUCCEEDED) {
            selectTab(props.visualizeQuery != null
                ? ScriptDetailsTab.Visualization
                : ScriptDetailsTab.QueryResultView);
        } else if (status != null) {
            selectTab(ScriptDetailsTab.QueryStatusPanel);
        }
    }, [props.query?.status, props.visualizeQuery]);

    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [{
        key: 'j',
        ctrlKey: true,
        callback: () => {
            if (enabledTabs.length === 0) return;
            selectTab(current => {
                const currentIndex = enabledTabs.indexOf(current);
                return enabledTabs[(currentIndex + 1) % enabledTabs.length];
            });
        },
    }, {
        key: 'Escape',
        ctrlKey: false,
        capture: true,
        callback: event => {
            props.onClose();
            event.stopImmediatePropagation();
        },
    }], [enabledTabs, props.onClose]);
    useKeyEvents(keyHandlers);

    const cancel = entryStatus.kind === EntryStatusKind.Agent
        ? props.onCancelAgent
        : entryStatus.kind === EntryStatusKind.Query
            ? props.onCancelQuery
            : undefined;
    const tabRenderers = React.useMemo(() => ({
        [ScriptDetailsTab.QueryStatusPanel]: () => (
            <div className={styles.tab_body}>
                <TraceLogPanel traceId={queryTraceId} title="Execution Logs" />
            </div>
        ),
        [ScriptDetailsTab.AgentStatusPanel]: () => (
            <div className={styles.tab_body}>
                <TraceLogPanel traceId={agentTraceId} title="Agent Logs" />
            </div>
        ),
        [ScriptDetailsTab.QueryResultView]: () => (
            <QueryResultDetails query={props.query!} debugMode={props.tableDebugMode} />
        ),
        [ScriptDetailsTab.Visualization]: () => (
            <div className={styles.visualization}>
                <TabHeader title="Visualization" detail={formatRowCountDetail(totalRows)} />
                <ColumnAggregationBar query={props.query} debugMode={props.tableDebugMode} />
                <div className={styles.visualization_body}>
                    <VisualizationDispatch query={props.query!} visualizeQuery={props.visualizeQuery} />
                </div>
            </div>
        ),
    }), [agentTraceId, props.query, props.tableDebugMode, props.visualizeQuery, queryTraceId, totalRows]);

    return (
        <div className={styles.card}>
            <EntryStatusBar
                status={entryStatus}
                onClick={entryStatus.traceId != null ? () => selectTab(
                    entryStatus.kind === EntryStatusKind.Agent
                        ? ScriptDetailsTab.AgentStatusPanel
                        : ScriptDetailsTab.QueryStatusPanel,
                ) : undefined}
                onCancel={entryStatus.indicator === IndicatorStatus.Running ? cancel : undefined}
                cancelLabel={entryStatus.kind === EntryStatusKind.Agent ? 'Cancel agent run' : 'Cancel query'}
                actions={props.statusActions}
            />
            <VerticalTabs
                className={styles.tabs}
                variant={VerticalTabVariant.Stacked}
                selectedTab={selectedTab}
                selectTab={tab => selectTab(tab as ScriptDetailsTab)}
                tabProps={tabProps}
                tabKeys={tabKeys}
                tabRenderers={tabRenderers}
            />
        </div>
    );
};
