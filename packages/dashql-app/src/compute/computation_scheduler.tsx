import * as React from 'react';

import { useOptionalCoreRuntime } from "../runtime/runtime_hooks.js";
import { useCreateComputeQueryExecution } from './compute_query_execution.js';

/// Tracks the queries of the computation tasks with the query execution of the provider above. The tasks run in the
/// runtime of the core (`packages/dashql-core-runtime/src/compute`).
export function ComputationScheduler(props: React.PropsWithChildren<{}>) {
    const runtime = useOptionalCoreRuntime();
    const createQueryExecution = useCreateComputeQueryExecution();
    React.useEffect(() => {
        runtime?.setQueryExecution(createQueryExecution);
        return () => runtime?.setQueryExecution(null);
    }, [runtime, createQueryExecution]);

    return props.children;
}
