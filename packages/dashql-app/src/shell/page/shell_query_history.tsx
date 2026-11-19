import * as React from 'react';

import { QueryType, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { getQueryTarget, QueryHistoryViewer, type QueryEntry } from '@akohn/dashql-react/components/query_history_viewer';
import { useAllQueries, useConnection, useRuntime } from '@akohn/dashql-react/hooks';

/// The id under which the queries of the shell are listed
export const SHELL_DATABASE_ID = 'shell';
/// The connection of the shell to the embedded Hyper of the page, a connection of the runtime of the shell
export const SHELL_CONNECTION_ID = 'shell';
/// The issuer of the queries of the catalog loader, the shell doesn't list them
const CATALOG_QUERY_ISSUER = 'Catalog Update';

/// The history of the shell: the queries of the connection of the shell since the history started. A reset of the shell
/// starts a new history.
export interface ShellQueryHistory {
    connectionId: string;
    /// The queries of the history have larger ids
    since: number;
}

const SHELL_QUERY_HISTORY_CTX = React.createContext<ShellQueryHistory | null>(null);

/// Provide the history of the queries that the shell executes on its connection, it starts with the component
export const ShellQueryHistoryProvider: React.FC<{ children: React.ReactElement }> = props => {
    const runtime = useRuntime();
    const [history] = React.useState<ShellQueryHistory>(() => ({ connectionId: SHELL_CONNECTION_ID, since: runtime.allocateId() }));
    return <SHELL_QUERY_HISTORY_CTX.Provider value={history}>{props.children}</SHELL_QUERY_HISTORY_CTX.Provider>;
};

/// The history of the shell
export function useShellQueryHistory(): ShellQueryHistory {
    return React.useContext(SHELL_QUERY_HISTORY_CTX)!;
}

/// The queries of the shell, the finished ones first, it renders again when they change: the statements of the shell
/// and the queries of the computations of their results, not the queries of the catalog loader
export function useShellQueries(): QueryExecutionState[] {
    const history = useShellQueryHistory();
    const connection = useConnection(history.connectionId);
    const queries = useAllQueries();
    return React.useMemo(() => [...connection?.queriesFinishedOrdered ?? [], ...connection?.queriesActiveOrdered ?? []]
        .filter(queryId => queryId > history.since)
        .map(queryId => queries.get(queryId))
        .filter((query): query is QueryExecutionState => query != null && query.queryMetadata.issuer !== CATALOG_QUERY_ISSUER), [connection, history, queries]);
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
    const queries = useShellQueries();
    const entries = React.useMemo(() => shellQueryEntries(queries), [queries]);
    return <QueryHistoryViewer entries={entries} onClose={props.onClose} />;
}
