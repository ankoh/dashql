import * as React from 'react';
import * as styles from './query_result_view.module.css';

import { QueryExecutionState } from '../../connection/query_execution_state.js';
import { DataTable } from './data_table.js';
import { TableColumnHeader } from './data_table_cell.js';
import { useComputationRegistry } from '../../compute/computation_registry.js';

interface Props {
    query: QueryExecutionState | null;
    debugMode: boolean;
    maxRows?: number;
    columnHeader?: TableColumnHeader;
}

export function QueryResultView(props: Props) {
    const [computationState, computationDispatch] = useComputationRegistry();

    // Query is null?
    if (props.query == null) {
        console.log("QUERY NULL");
        return <div />;
    }
    // Resolve the table computation
    const tableComputation = computationState.tableComputations[props.query.queryId] ?? null;
    if (tableComputation == null) {
        console.log("TABLE COMPUTATION NULL");
        return <div />;
    }
    // Toggle data info
    return (
        <div className={styles.root}>
            <DataTable
                className={styles.data_table}
                table={tableComputation}
                dispatchComputation={computationDispatch}
                debugMode={props.debugMode}
                maxRows={props.maxRows}
                columnHeader={props.columnHeader}
            />
        </div>
    );
}
