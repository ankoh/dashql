import * as React from 'react';
import type * as arrow from 'apache-arrow';

import { useComputeDatabase } from '../compute/compute_connection_provider.js';
import { useOptionalCoreRuntime, useTable, useView } from '../runtime/runtime_hooks.js';
import type { CancelQuery, QueryExecutor } from '@ankoh/dashql-runtime/connections/query_execution_args';
import type { QueryExecutionProgress, QueryExecutionState } from '@ankoh/dashql-runtime/query/query_execution_state';
import { queryProgress } from '@ankoh/dashql-runtime/query/query_progress';

// The query executor is part of the runtime of the module (docs/wip/runtime_api.md): a query runs in the history of its
// connection from the start and is a slice `query` of the runtime, this module binds the commands to React

const NO_EXECUTOR: QueryExecutor = () => { throw new Error('the query executor needs a RuntimeProvider'); };
const NO_CANCEL: CancelQuery = async () => { };

// The functions change once the compute database is set up: effects that depend on the executor run again then, e.g.
// those that read cached results
function useExecutor() {
    const runtime = useOptionalCoreRuntime();
    const computeReady = useComputeDatabase() != null;
    return React.useMemo(() => runtime == null ? { execute: NO_EXECUTOR, cancel: NO_CANCEL } : {
        execute: ((connectionId, args) => runtime.execute(connectionId, args)) as QueryExecutor,
        cancel: ((connectionId, queryId) => runtime.cancel(connectionId, queryId)) as CancelQuery,
    }, [runtime, computeReady]);
}

/// The hook to resolve the query executor
export const useQueryExecutor = (): QueryExecutor => useExecutor().execute;
export const useCancelQuery = (): CancelQuery => useExecutor().cancel;
/// Show the profile of a query while the component is mounted: the connector then fetches the plan and its
/// statistics (Trino). Without runtime, e.g. in tests, nothing is fetched.
export function useQueryProfileDetail(queryId: number | null, enabled = true) {
    const runtime = useOptionalCoreRuntime();
    React.useEffect(() => {
        if (!enabled || queryId == null || runtime == null) return;
        return runtime.watchProfile(queryId);
    }, [runtime, queryId, enabled]);
}

/// The view of a query, it renders again when the query changes and no other
export function useQuery(queryId: number | null | undefined): QueryExecutionState | null {
    return useView('query', queryId) as QueryExecutionState | null;
}

/// Read the queries of the last flush without subscribing to them, e.g. in a handler
export function useQueryReader(): (queryId: number) => QueryExecutionState | null {
    const runtime = useOptionalCoreRuntime();
    return React.useCallback((queryId: number) => (runtime?.store.get('query', queryId) ?? null) as QueryExecutionState | null, [runtime]);
}

const NO_QUERIES: ReadonlyMap<number, QueryExecutionState> = new Map();
const NO_SUBSCRIPTION = () => () => { };

/// The queries of all histories, it renders again when any query changes, e.g. for the viewer of the query history
export function useAllQueries(): ReadonlyMap<number, QueryExecutionState> {
    const runtime = useOptionalCoreRuntime();
    const subscribe = React.useMemo(() => runtime == null ? NO_SUBSCRIPTION : (listener: () => void) => runtime.store.subscribeKind('query', listener), [runtime]);
    const getSnapshot = React.useCallback(() => (runtime?.store.all('query') ?? NO_QUERIES) as ReadonlyMap<number, QueryExecutionState>, [runtime]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/// Use the query state. The workbook only scopes it, query ids are unique across connections.
export function useQueryState(workbookId: string | null, queryId: number | null): QueryExecutionState | null {
    return useQuery(workbookId == null ? null : queryId);
}

/// The latest progress of a query with its structured progress
export function useQueryProgress(query: QueryExecutionState | null | undefined): QueryExecutionProgress | null {
    const runtime = useOptionalCoreRuntime();
    const core = runtime?.core ?? null;
    const module = runtime?.runtime ?? null;
    const view = query?.latestProgressUpdate ?? null;
    const queryId = query?.queryId ?? null;
    return React.useMemo(() => {
        if (core == null || view == null) return null;
        return queryProgress(core, view, module == null || queryId == null ? null : { runtime: module, queryId });
    }, [core, module, view, queryId]);
}

/// The result table of a query, null without one
export function useQueryResultTable(query: QueryExecutionState | null | undefined): arrow.Table | null {
    return useTable(query?.resultTable?.id ?? null);
}
