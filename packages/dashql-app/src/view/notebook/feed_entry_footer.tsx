import * as React from 'react';
import * as styles from './feed_entry_footer.module.css';

import icons from '@ankoh/dashql-svg-symbols';

import { QueryExecutionState, QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { TraceLogViewer } from '../internals/trace_log_viewer.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { TableColumnHeader } from '../query_result/data_table_cell.js';
import { useComputationRegistry } from '../../compute/computation_registry.js';
import { VerticalTabs, VerticalTabVariant, type VerticalTabProps } from '../foundations/vertical_tabs.js';

const enum FooterTab {
    Log = 0,
    Table = 1,
}

interface FeedEntryFooterProps {
    sessionId: string;
    queryId: number;
    traceId: number;
    queryState: QueryExecutionState;
}

export const FeedEntryFooter: React.FC<FeedEntryFooterProps> = (props) => {
    const [selectedTab, setSelectedTab] = React.useState<FooterTab>(FooterTab.Log);
    const [computationState] = useComputationRegistry();

    const hasResult = props.queryState.status === QueryExecutionStatus.SUCCEEDED
        && computationState.tableComputations[props.queryId] != null;

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
    }), [hasResult]);

    const tabRenderers = React.useMemo(() => ({
        [FooterTab.Log]: () => (
            <TraceLogViewer traceId={props.traceId} height={96} />
        ),
        [FooterTab.Table]: () => (
            <QueryResultView query={props.queryState} debugMode={false} maxRows={10} columnHeader={TableColumnHeader.OnlyColumnName} />
        ),
    }), [props.traceId, props.queryState]);

    return (
        <VerticalTabs
            className={styles.footer_container}
            variant={VerticalTabVariant.Stacked}
            tabKeys={[FooterTab.Log, FooterTab.Table]}
            tabProps={tabProps}
            tabRenderers={tabRenderers}
            selectedTab={selectedTab}
            selectTab={setSelectedTab}
        />
    );
};
