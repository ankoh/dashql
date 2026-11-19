import * as React from 'react';
import type * as arrow from 'apache-arrow';

import type { QueryExecutionProgress, QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';

import { useOptionalRuntime, useQuery, useQueryProfileDetail, useTable } from '../hooks.js';

// The model of a query (docs/agents/writing_components.md): what a component shows of a query of a connection and what
// it can do with it. The views, the handles of the result and the commands of the runtime stay in this module.

/// A query as a component shows it, and what the component can do with it
export interface QueryModel {
    readonly queryId: number;
    /// The query: its status, metadata, metrics and error
    readonly query: QueryExecutionState;
    /// The latest progress with its structured progress, null before the first
    readonly progress: QueryExecutionProgress | null;
    /// The result as an Arrow table, null before the query succeeded or without a result
    readonly result: arrow.Table | null;

    /// Cancel the query, resolves once it ended
    cancel(): Promise<void>;
}

/// Where the models of the queries come from: the runtime of the app, or a fake model of a test
export interface QueryModelSource {
    /// The model of a query, null while the query is unknown. `profile` shows the profile of the query while the
    /// component is mounted: the connector then fetches the plan and its statistics. A hook, the source of a provider
    /// never changes.
    useQueryModel(queryId: number | null | undefined, options?: { profile?: boolean }): QueryModel | null;
}

/// The model of a query over the runtime of the provider above
function useRuntimeQueryModel(queryId: number | null | undefined, options: { profile?: boolean } = {}): QueryModel | null {
    const runtime = useOptionalRuntime();
    const query = useQuery(queryId);
    const result = useTable(query?.resultTable?.id ?? null);
    useQueryProfileDetail(queryId ?? null, options.profile === true);
    return React.useMemo(() => {
        if (query == null || queryId == null) return null;
        return {
            queryId,
            query,
            progress: query.progress ?? null,
            result,
            cancel: async () => await runtime?.cancel(queryId),
        };
    }, [runtime, queryId, query, result]);
}

/// The models of the runtime of the provider above
export const RUNTIME_QUERY_MODELS: QueryModelSource = { useQueryModel: useRuntimeQueryModel };

const QUERY_MODELS = React.createContext<QueryModelSource>(RUNTIME_QUERY_MODELS);

/// Hand the components below another source of query models, e.g. the fake models of a test
export const QueryModelProvider = QUERY_MODELS.Provider;

/// The model of a query, null while the query is unknown. It renders again when the query changes and no other.
export function useQueryModel(queryId: number | null | undefined, options?: { profile?: boolean }): QueryModel | null {
    return React.useContext(QUERY_MODELS).useQueryModel(queryId, options);
}
