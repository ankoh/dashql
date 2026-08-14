import * as React from 'react';

import type { QueryExecutionState } from '../../../connections/query_execution_state.js';
import { TabHeader, formatRowCountDetail, useResultRowCount } from '../../../ui/tab_header.js';
import { QueryResultView } from './query_result_view.js';
import { classNames } from '../../../../../shared/utils/classnames.js';
import * as styles from './query_result_details.module.css';

interface Props {
    query: QueryExecutionState;
    debugMode: boolean;
    actions?: React.ReactNode;
    fitHeight?: boolean;
    maxHeight?: number;
}

const HEADER_HEIGHT = 32;

export const QueryResultDetails: React.FC<Props> = ({ query, debugMode, actions, fitHeight, maxHeight }) => {
    const { totalRows } = useResultRowCount(query);
    return (
        <div className={classNames(styles.root, { [styles.root_fit_height]: fitHeight })}>
            <TabHeader
                title="Query Results"
                detail={formatRowCountDetail(totalRows)}
                actions={actions}
            />
            <div className={classNames(styles.body, { [styles.body_fit_height]: fitHeight })}>
                <QueryResultView
                    query={query}
                    debugMode={debugMode}
                    fitHeight={fitHeight}
                    maxHeight={maxHeight == null ? undefined : Math.max(0, maxHeight - HEADER_HEIGHT)}
                />
            </div>
        </div>
    );
};
