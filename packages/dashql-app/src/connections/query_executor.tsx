import * as React from 'react';

import { useConnectionDispatch, useConnectionRegistryStore } from './connection_registry.js';
import { useComputationDispatch } from '../compute/computation_registry.js';
import { useComputeDatabase } from '../compute/compute_connection_provider.js';
import { useHttpClient } from '../platform/http/http_client_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { useQueryResultCache } from '../storage/query_result_cache_provider.js';
import { useDashQLCoreSetup, type DashQLSetupFn } from '../runtime/core_provider.js';
import type { CancelQuery, QueryExecutionArgs, QueryExecutor } from '@ankoh/dashql-runtime/connections/query_execution_args';
import { QueryExecutorService, type QueryExecutorDependencies, type WatchQueryProfile } from '@ankoh/dashql-runtime/connections/query_executor_service';

// The executor is a service of the runtime (packages/dashql-runtime/src/connections/query_executor_service.ts), this module
// binds it to React
export type { CancelQuery, QueryExecutor } from '@ankoh/dashql-runtime/connections/query_execution_args';

/// The React context to resolve the active query executor
export interface QueryExecutorContextValue {
    execute: QueryExecutor;
    cancel: CancelQuery;
    watchProfile: WatchQueryProfile;
}
export const EXECUTOR_CTX = React.createContext<QueryExecutorContextValue | null>(null);
/// The hook to resolve the query executor
export const useQueryExecutor = () => React.useContext(EXECUTOR_CTX)!.execute;
export const useCancelQuery = () => React.useContext(EXECUTOR_CTX)!.cancel;
/// Show the profile of a query while the component is mounted: the connector then fetches the plan and its
/// statistics (Trino). Without executor, e.g. in tests, nothing is fetched.
export function useQueryProfileDetail(queryId: number | null, enabled = true) {
    const watchProfile = React.useContext(EXECUTOR_CTX)?.watchProfile;
    React.useEffect(() => {
        if (!enabled || queryId == null || watchProfile == null) return;
        return watchProfile(queryId);
    }, [watchProfile, queryId, enabled]);
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

export function QueryExecutorProvider(props: { children?: React.ReactElement }) {
    const logger = useLogger();
    const http = useHttpClient();
    // The connection registry changes frequently.
    // The executor resolves everything ad-hoc through the registry store and never re-renders for registry changes.
    const connStore = useConnectionRegistryStore();
    const dispatchConnection = useConnectionDispatch();
    const dispatchComputation = useComputationDispatch();
    const computeDatabase = useComputeDatabase();
    const resultCache = useQueryResultCache();
    const setupCore = useDashQLCoreSetup() as DashQLSetupFn | null;
    const deps = React.useMemo<QueryExecutorDependencies>(() => ({
        logger,
        http,
        readConnections: () => connStore.current,
        dispatchConnection,
        dispatchComputation,
        computeDatabase,
        resultCache,
        setupCore,
    }), [logger, http, connStore, dispatchConnection, dispatchComputation, computeDatabase, resultCache, setupCore]);

    // One service keeps the running queries across changes of the dependencies
    const [service] = React.useState(() => new QueryExecutorService(deps));

    // The functions change with the dependencies, like the callbacks of the former provider: effects that depend on
    // the executor run again, e.g. once the compute database is ready
    const value = React.useMemo<QueryExecutorContextValue>(() => {
        service.setDependencies(deps);
        return {
            execute: (connectionId: string, args: QueryExecutionArgs) => service.execute(connectionId, args),
            cancel: (connectionId: string, queryId: number) => service.cancel(connectionId, queryId),
            watchProfile: (queryId: number) => service.watchProfile(queryId),
        };
    }, [service, deps]);

    return (
        <EXECUTOR_CTX.Provider value={value}>
            {props.children}
        </EXECUTOR_CTX.Provider>
    );
}
