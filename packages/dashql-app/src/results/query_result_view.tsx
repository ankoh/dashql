import * as React from 'react';
import * as styles from './query_result_view.module.css';

import { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { DataTableView } from './data_table_view.js';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { useComputation } from '@akohn/dashql-react/hooks';
import { classNames } from '@akohn/dashql-react/dom/classnames';

interface Props {
    query: QueryExecutionState | null;
    debugMode: boolean;
    maxRows?: number;
    columnHeader?: TableColumnHeader;
    cellBackground?: string;
    onShowTable?: () => void;
    fitHeight?: boolean;
    fillHeight?: boolean;
    maxHeight?: number;
    compact?: boolean;
}

export function QueryResultView(props: Props) {
    // The computation of the result of the query
    const tableComputation = useComputation(props.query?.queryId);
    if (props.query == null || tableComputation == null) {
        return <div />;
    }
    // Toggle data info
    return (
        <div className={classNames(styles.root, { [styles.root_fit_height]: props.fitHeight })}>
            <DataTableView
                className={styles.data_table}
                table={tableComputation}
                debugMode={props.debugMode}
                maxRows={props.maxRows}
                columnHeader={props.columnHeader}
                cellBackground={props.cellBackground}
                onShowTable={props.onShowTable}
                fitHeight={props.fitHeight}
                fillHeight={props.fillHeight}
                maxHeight={props.maxHeight}
                compact={props.compact}
            />
        </div>
    );
}
