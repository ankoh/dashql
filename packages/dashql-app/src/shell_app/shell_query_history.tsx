import * as core from '@ankoh/dashql-core';
import * as React from 'react';

import { QueryType, type QueryExecutionState } from '@ankoh/dashql-runtime/query/query_execution_state';
import { getQueryTarget, QueryHistoryViewer, type QueryEntry } from '../query/query_history_viewer.js';
import { ShellQueryExecutionTracker } from '@ankoh/dashql-runtime/query/shell_query_execution';
import { useDashQLCoreSetup } from '../runtime/core_provider.js';

/// The id under which the queries of the shell are listed
export const SHELL_DATABASE_ID = 'shell';

const SHELL_QUERY_HISTORY_CTX = React.createContext<ShellQueryExecutionTracker | null>(null);

/// Provide the history of the queries that the shell executes. The history lives in the core of the provider above,
/// without one in the default core, and is freed with the component.
export const ShellQueryHistoryProvider: React.FC<{ children: React.ReactElement }> = props => {
    const setupCore = useDashQLCoreSetup() as ReturnType<typeof useDashQLCoreSetup> | null;
    const [queryExecutions] = React.useState(() => new ShellQueryExecutionTracker(() => setupCore != null ? setupCore('shell') : core.DashQL.create()));
    React.useEffect(() => () => queryExecutions.release(), [queryExecutions]);
    return <SHELL_QUERY_HISTORY_CTX.Provider value={queryExecutions}>{props.children}</SHELL_QUERY_HISTORY_CTX.Provider>;
};

export function useShellQueryHistory(): ShellQueryExecutionTracker {
    return React.useContext(SHELL_QUERY_HISTORY_CTX)!;
}

/// The queries of the shell, the shell runs them on its embedded database
export function shellQueryEntries(queries: readonly QueryExecutionState[]): QueryEntry[] {
    return queries.map(query => ({
        connectionId: SHELL_DATABASE_ID,
        sourceName: query.queryMetadata.queryType == QueryType.INTERNAL_SQLFRAME ? 'SQLFrame' : 'Hyper',
        target: getQueryTarget(query),
        queryId: query.queryId,
        query,
    }));
}

/// The query history of the shell
export function ShellQueryViewer(props: { onClose: () => void }) {
    const queryExecutions = useShellQueryHistory();
    const queries = React.useSyncExternalStore(queryExecutions.subscribe, queryExecutions.getSnapshot);
    const entries = React.useMemo(() => shellQueryEntries(queries), [queries]);
    return <QueryHistoryViewer entries={entries} onClose={props.onClose} />;
}
