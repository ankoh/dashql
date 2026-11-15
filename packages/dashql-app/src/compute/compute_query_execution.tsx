import * as React from 'react';

import type { CreateComputeQueryExecution } from '@ankoh/dashql-runtime/compute/compute_platform';

export type { CreateComputeQueryExecution };

const COMPUTE_QUERY_EXECUTION_CTX = React.createContext<CreateComputeQueryExecution | null>(null);

export function ComputeQueryExecutionProvider(props: React.PropsWithChildren<{ createExecution: CreateComputeQueryExecution }>) {
    return (
        <COMPUTE_QUERY_EXECUTION_CTX.Provider value={props.createExecution}>
            {props.children}
        </COMPUTE_QUERY_EXECUTION_CTX.Provider>
    );
}

export function useCreateComputeQueryExecution(): CreateComputeQueryExecution | null {
    return React.useContext(COMPUTE_QUERY_EXECUTION_CTX);
}
