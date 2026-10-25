import * as React from 'react';

import { ComputeQueryExecutionProvider } from '../../compute/computation_query_execution.js';
import type { ComputeQueryExecution } from '../../compute/computation_tasks.js';
import { useComputationStore } from '../../compute/computation_registry.js';
import { computationTaskTitle, type TaskVariant } from '../../compute/computation_types.js';
import { QueryType } from '../../query/query_execution_state.js';
import { executeTrackedQuery } from '../../query/tracked_query_execution.js';
import { useConnectionDispatch } from './connection_registry.js';
import { sqlframeClientContext } from './hyper/hyper_log_metrics.js';

const LOG_CTX = 'scheduler';

/// Track the queries of computations in the query history of the connection that ran the query of the table
export function SessionComputeQueryExecutionProvider(props: React.PropsWithChildren) {
    // Resolve the connection when the task starts, subscribing to the computations would re-create the
    // execution factory and re-render the scheduler for every task step.
    const computations = useComputationStore();
    const dispatch = useConnectionDispatch();
    const createExecution = React.useCallback((task: TaskVariant) => {
        const computation = computations.current.tableComputations[task.value.tableId];
        const connectionId = computation?.connectionId ?? null;
        const execution: ComputeQueryExecution = (query, execute) => {
            if (connectionId == null) return execute(computation?.clientContext ?? null);
            return executeTrackedQuery({
                query,
                tracker: { dispatch: action => dispatch(connectionId, action) },
                metadata: {
                    queryType: QueryType.INTERNAL_SQLFRAME,
                    title: computationTaskTitle(task),
                    description: null,
                    issuer: 'SQLFrame',
                    userProvided: false,
                },
                // Attribute the query to the connection in the Hyper log, it runs on a pooled compute connection
                execute: () => execute(sqlframeClientContext(connectionId)),
                errorTarget: LOG_CTX,
            });
        };
        return execution;
    }, [computations, dispatch]);

    return (
        <ComputeQueryExecutionProvider createExecution={createExecution}>
            {props.children}
        </ComputeQueryExecutionProvider>
    );
}
