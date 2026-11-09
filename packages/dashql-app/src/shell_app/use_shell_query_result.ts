import * as React from 'react';

import type { QueryExecutionState } from '../query/query_execution_state.js';
import type { ShellQueryExecutionTracker } from '../shell/query_execution.js';

/// The result that the overlay of the shell shows. Closing the overlay keeps the result so that it can open again, the
/// computation of a result is released once another result replaces it.
export function useShellQueryResult(queryExecutions: ShellQueryExecutionTracker, releaseResult: (queryId: number) => void) {
    const [lastQuery, setLastQuery] = React.useState<QueryExecutionState | null>(null);
    const [open, setOpen] = React.useState(false);
    const lastQueryRef = React.useRef(lastQuery);
    lastQueryRef.current = lastQuery;
    const lastQueryId = lastQuery?.queryId ?? null;
    React.useEffect(() => {
        if (lastQueryId == null) return;
        return () => releaseResult(lastQueryId);
    }, [lastQueryId, releaseResult]);
    const showResultQuery = React.useCallback((queryId: number) => {
        const query = queryExecutions.getSnapshot().find(candidate => candidate.queryId === queryId) ?? null;
        setLastQuery(query);
        setOpen(query != null);
    }, [queryExecutions]);
    const closeResultQuery = React.useCallback(() => setOpen(false), []);
    const reopenResultQuery = React.useCallback(() => {
        if (lastQueryRef.current == null) return false;
        setOpen(true);
        return true;
    }, []);
    /// A result that failed to render doesn't open again
    const dropResultQuery = React.useCallback(() => {
        setLastQuery(null);
        setOpen(false);
    }, []);

    return { resultQuery: open ? lastQuery : null, showResultQuery, closeResultQuery, reopenResultQuery, dropResultQuery };
}
