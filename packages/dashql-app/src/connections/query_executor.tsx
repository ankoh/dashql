import * as React from 'react';

import { useConnectionRegistryStore } from './connection_registry.js';
import { useComputeDatabase } from '../compute/compute_connection_provider.js';
import { useOptionalRuntime } from '../runtime/runtime_provider.js';
import type { CancelQuery, QueryExecutionArgs, QueryExecutor } from '@ankoh/dashql-runtime/connections/query_execution_args';

// The executor is a service of the runtime (packages/dashql-runtime/src/connections/query_executor_service.ts), this module
// binds it to React

// The functions change once the compute database is set up: effects that depend on the executor run again then, e.g.
// those that read cached results
function useExecutor() {
    const runtime = useOptionalRuntime();
    const computeReady = useComputeDatabase() != null;
    return React.useMemo(() => runtime == null ? null : {
        execute: ((connectionId: string, args: QueryExecutionArgs) => runtime.executor.execute(connectionId, args)) as QueryExecutor,
        cancel: ((connectionId: string, queryId: number) => runtime.executor.cancel(connectionId, queryId)) as CancelQuery,
    }, [runtime, computeReady]);
}

/// The hook to resolve the query executor
export const useQueryExecutor = (): QueryExecutor => useExecutor()!.execute;
export const useCancelQuery = (): CancelQuery => useExecutor()!.cancel;
/// Show the profile of a query while the component is mounted: the connector then fetches the plan and its
/// statistics (Trino). Without runtime, e.g. in tests, nothing is fetched.
export function useQueryProfileDetail(queryId: number | null, enabled = true) {
    const runtime = useOptionalRuntime();
    React.useEffect(() => {
        if (!enabled || queryId == null || runtime == null) return;
        return runtime.executor.watchProfile(queryId);
    }, [runtime, queryId, enabled]);
}
/// Use the query state
export function useQueryState(workbookId: string | null, queryId: number | null) {
    // Subscribe to the single query instead of the registry.
    // The registry changes with every lifecycle event of every query, including the internal queries of computations.
    const store = useConnectionRegistryStore();
    const getQueryState = React.useCallback(() => {
        if (queryId == null || workbookId == null) return null;
        // Query ids are unique across connections. A script that moved to another connection keeps
        // the result of its last query on the connection it left.
        for (const database of store.current.connections.values()) {
            const query = database.queriesActive.get(queryId) ?? database.queriesFinished.get(queryId);
            if (query != null) return query;
        }
        return null;
    }, [store, workbookId, queryId]);
    return React.useSyncExternalStore(store.subscribe, getQueryState);
}
