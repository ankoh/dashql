import * as React from 'react';

import type { QueryExecutionState } from '@ankoh/dashql-platform/query/query_execution_state';
import { useQuery } from '../runtime/runtime_hooks.js';

/// The result that the overlay of the shell shows. Closing the overlay keeps the result so that it can open again, the
/// computation of a result is released once another result replaces it. The query is the view of the runtime, a result
/// whose query left the history of the shell keeps its computation.
export function useShellQueryResult(releaseResult: (queryId: number) => void) {
    const [lastQueryId, setLastQueryId] = React.useState<number | null>(null);
    const [open, setOpen] = React.useState(false);
    const lastQuery: QueryExecutionState | null = useQuery(lastQueryId);
    const lastQueryRef = React.useRef(lastQueryId);
    lastQueryRef.current = lastQueryId;
    React.useEffect(() => {
        if (lastQueryId == null) return;
        return () => releaseResult(lastQueryId);
    }, [lastQueryId, releaseResult]);
    const showResultQuery = React.useCallback((queryId: number) => {
        setLastQueryId(queryId);
        setOpen(true);
    }, []);
    const closeResultQuery = React.useCallback(() => setOpen(false), []);
    const reopenResultQuery = React.useCallback(() => {
        if (lastQueryRef.current == null) return false;
        setOpen(true);
        return true;
    }, []);
    /// A result that failed to render doesn't open again
    const dropResultQuery = React.useCallback(() => {
        setLastQueryId(null);
        setOpen(false);
    }, []);

    return { resultQuery: open ? lastQuery : null, showResultQuery, closeResultQuery, reopenResultQuery, dropResultQuery };
}
