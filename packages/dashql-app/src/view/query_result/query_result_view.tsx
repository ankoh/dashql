import * as React from 'react';
import * as styles from './query_result_view.module.css';

import { QueryExecutionState } from '../../connection/query_execution_state.js';
import { DataTable } from './data_table.js';
import { useComputationRegistry } from '../../compute/computation_registry.js';

interface Props {
    query: QueryExecutionState | null;
    debugMode: boolean;
}

export function QueryResultView(props: Props) {
    const [computationState, computationDispatch] = useComputationRegistry();

    // Query is null?
    if (props.query == null) {
        return <div />;
    }
    // Resolve the table computation
    const tableComputation = computationState.tableComputations[props.query.queryId] ?? null;
    if (tableComputation == null) {
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
            />
        </div>
    );
}
