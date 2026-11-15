import * as React from 'react';

import { ComputeQueryExecutionProvider } from '../compute/compute_query_execution.js';
import { clientContextOf, type ComputeQueryExecution, type ComputeTaskContext } from '@ankoh/dashql-runtime/compute/compute_platform';
import { useOptionalCoreRuntime } from '../runtime/runtime_hooks.js';
import { QueryType } from '@ankoh/dashql-runtime/query/query_execution_state';
import { executeTrackedQuery } from '@ankoh/dashql-runtime/query/tracked_query_execution';
import { useConnectionDispatch } from '../connections/connection_registry.js';
import { sqlframeClientContext } from '../connections/hyper/hyper_log_metrics.js';

const LOG_CTX = 'scheduler';

/// Track the queries of computations in the query history of the connection that ran the query of the table
export function WorkbookComputeQueryExecutionProvider(props: React.PropsWithChildren) {
    // Resolve the connection when the task starts, subscribing to the computations would re-create the
    // execution factory and re-render the scheduler for every task step.
    const runtime = useOptionalCoreRuntime();
    const dispatch = useConnectionDispatch();
    const createExecution = React.useCallback((task: ComputeTaskContext) => {
        const computation = runtime?.store.get('computation', task.tableId) ?? null;
        const connectionId = computation?.connectionId ?? null;
        const execution: ComputeQueryExecution = (query, execute) => {
            if (connectionId == null) return execute(clientContextOf(computation?.clientContext));
            return executeTrackedQuery({
                query,
                tracker: { dispatch: action => dispatch(connectionId, action) },
                metadata: {
                    queryType: QueryType.INTERNAL_SQLFRAME,
                    title: task.title,
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
    }, [runtime, dispatch]);

    return (
        <ComputeQueryExecutionProvider createExecution={createExecution}>
            {props.children}
        </ComputeQueryExecutionProvider>
    );
}
