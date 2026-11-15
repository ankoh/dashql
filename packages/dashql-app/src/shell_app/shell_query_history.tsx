import * as React from 'react';

import { QueryType, type QueryExecutionState } from '@ankoh/dashql-runtime/query/query_execution_state';
import type { QueryTracker } from '@ankoh/dashql-runtime/query/tracked_query_execution';
import { getQueryTarget, QueryHistoryViewer, type QueryEntry } from '../query/query_history_viewer.js';
import { useCoreRuntime, useView } from '../runtime/runtime_hooks.js';
import { useAllQueries } from '../connections/query_executor.js';

/// The id under which the queries of the shell are listed
export const SHELL_DATABASE_ID = 'shell';
/// The shell keeps the last queries, the oldest finished ones leave first
export const SHELL_QUERY_HISTORY_LIMIT = 100;

let NEXT_SHELL_HISTORY = 1;

const SHELL_QUERY_HISTORY_CTX = React.createContext<QueryTracker | null>(null);

/// Provide the history of the queries that the shell executes: a history without a connection of the runtime above,
/// it goes with the component
export const ShellQueryHistoryProvider: React.FC<{ children: React.ReactElement }> = props => {
    const runtime = useCoreRuntime();
    const [tracker] = React.useState<QueryTracker>(() => ({ runtime, target: { history: `shell-${NEXT_SHELL_HISTORY++}` } }));
    // The history exists once the runtime has its core, the queries before that run untracked
    const created = React.useRef(false);
    const create = () => {
        if (created.current) return;
        created.current = runtime.dispatch(tracker.target, { kind: 'createHistory', value: { limit: SHELL_QUERY_HISTORY_LIMIT } }).ok;
    };
    if (runtime.runtime != null) create();
    React.useEffect(() => {
        let dropped = false;
        void runtime.ready().then(() => { if (!dropped) create(); }).catch(() => { });
        return () => {
            dropped = true;
            created.current = false;
            runtime.dispatch(tracker.target, { kind: 'dropHistory' });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runtime, tracker]);
    return <SHELL_QUERY_HISTORY_CTX.Provider value={tracker}>{props.children}</SHELL_QUERY_HISTORY_CTX.Provider>;
};

/// Where the shell tracks its queries
export function useShellQueryHistory(): QueryTracker {
    return React.useContext(SHELL_QUERY_HISTORY_CTX)!;
}

/// The name of the history of the shell
function historyOf(tracker: QueryTracker): string {
    const target = tracker.target;
    return typeof target === 'object' && 'history' in target ? target.history : SHELL_DATABASE_ID;
}

/// The queries of the shell, the finished ones first, it renders again when they change
export function useShellQueries(): QueryExecutionState[] {
    const tracker = useShellQueryHistory();
    const history = useView('history', historyOf(tracker));
    const queries = useAllQueries();
    return React.useMemo(() => (history?.queries ?? [])
        .map(queryId => queries.get(queryId))
        .filter((query): query is QueryExecutionState => query != null), [history, queries]);
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
