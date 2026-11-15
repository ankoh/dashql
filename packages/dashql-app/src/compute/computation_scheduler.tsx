import * as React from 'react';

import { useComputations } from "./computation_registry.js";
import { useCreateComputeQueryExecution } from './compute_query_execution.js';

/// Tracks the queries of the computation tasks with the query execution of the provider above. The tasks run in the
/// runtime of the core (`packages/dashql-core-runtime/src/compute`).
export function ComputationScheduler(props: React.PropsWithChildren<{}>) {
    const computations = useComputations();
    const createQueryExecution = useCreateComputeQueryExecution();
    React.useEffect(() => {
        computations?.setQueryExecution(createQueryExecution);
        return () => computations?.setQueryExecution(null);
    }, [computations, createQueryExecution]);

    return props.children;
}
