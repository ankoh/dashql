import * as React from 'react';

import { ComputeQueryExecutionProvider } from '../compute/compute_query_execution.js';
import type { ComputeQueryExecution, ComputeTaskContext } from '@ankoh/dashql-runtime/compute/compute_platform';
import { QueryType } from '@ankoh/dashql-runtime/query/query_execution_state';
import { executeTrackedQuery } from '@ankoh/dashql-runtime/query/tracked_query_execution';
import { useShellQueryHistory } from './shell_query_history.js';

const LOG_CTX = 'scheduler';

export function ShellComputeQueryExecutionProvider(props: React.PropsWithChildren) {
    const queryExecutions = useShellQueryHistory();
    const createExecution = React.useCallback((task: ComputeTaskContext) => {
        const execution: ComputeQueryExecution = (query, execute) => executeTrackedQuery({
            query,
            tracker: queryExecutions,
            metadata: {
                queryType: QueryType.INTERNAL_SQLFRAME,
                title: task.title,
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
