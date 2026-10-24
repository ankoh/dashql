import * as React from 'react';

import { ComputeQueryExecutionProvider } from '../compute/computation_query_execution.js';
import type { ComputeQueryExecution } from '../compute/computation_tasks.js';
import { computationTaskTitle, type TaskVariant } from '../compute/computation_types.js';
import { QueryType } from '../query/query_execution_state.js';
import { executeTrackedQuery } from '../query/tracked_query_execution.js';
import { useShellQueryHistory } from './shell_query_history.js';

const LOG_CTX = 'scheduler';

export function ShellComputeQueryExecutionProvider(props: React.PropsWithChildren) {
    const queryExecutions = useShellQueryHistory();
    const createExecution = React.useCallback((task: TaskVariant) => {
        const execution: ComputeQueryExecution = (query, execute) => executeTrackedQuery({
            query,
            tracker: queryExecutions,
            metadata: {
                queryType: QueryType.INTERNAL_SQLFRAME,
                title: computationTaskTitle(task),
                description: null,
                issuer: 'SQLFrame',
                userProvided: false,
            },
            execute: () => execute(null),
            errorTarget: LOG_CTX,
        });
        return execution;
    }, [queryExecutions]);

    return (
        <ComputeQueryExecutionProvider createExecution={createExecution}>
            {props.children}
        </ComputeQueryExecutionProvider>
    );
}
