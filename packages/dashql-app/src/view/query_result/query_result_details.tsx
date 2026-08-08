import * as React from 'react';

import type { QueryExecutionState } from '../../connection/query_execution_state.js';
import { TabHeader, formatRowCountDetail, useResultRowCount } from '../notebook/tab_header.js';
import { QueryResultView } from './query_result_view.js';
import * as styles from './query_result_details.module.css';

interface Props {
    query: QueryExecutionState;
    debugMode: boolean;
    actions?: React.ReactNode;
}

export const QueryResultDetails: React.FC<Props> = ({ query, debugMode, actions }) => {
    const { totalRows } = useResultRowCount(query);
    return (
        <div className={styles.root}>
            <TabHeader
                title="Query Results"
                detail={formatRowCountDetail(totalRows)}
                actions={actions}
            />
            <div className={styles.body}>
                <QueryResultView query={query} debugMode={debugMode} />
            </div>
        </div>
    );
};
