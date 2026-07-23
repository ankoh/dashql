import * as React from 'react';
import * as styles from './query_result_cache_controls.module.css';

import { TrashIcon } from '@primer/octicons-react';

import { QueryExecutionState } from '../../connection/query_execution_state.js';
import { QUERY_CACHE_DELETED } from '../../connection/connection_state.js';
import { useDynamicConnectionDispatch } from '../../connection/connection_registry.js';
import { useStorageReader } from '../../platform/storage/storage_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '../../platform/logger/logger.js';

const LOG_CTX = 'query_result_cache';

interface QueryResultCacheControlsProps {
    sessionId: string;
    query: QueryExecutionState | null;
}

/// The cache indicator + "delete cached" button shown in the Query Results header. Renders nothing
/// unless the result has an associated cache entry. The button label reflects whether this run
/// served the result from cache ("Was Cached") or just wrote it ("Now Cached"). The entry's write
/// time isn't surfaced here — it's logged on the cache hit (see query_executor).
export const QueryResultCacheControls: React.FC<QueryResultCacheControlsProps> = ({ sessionId, query }) => {
    const [, connDispatch] = useDynamicConnectionDispatch();
    const storageReader = useStorageReader();
    const logger = useLogger();

    const cacheKey = query?.cacheKey ?? null;
    const cacheDeleted = query?.cacheDeleted ?? false;

    const onDelete = React.useCallback(() => {
        if (query == null || cacheKey == null) {
            return;
        }
        const queryId = query.queryId;
        // Delete on disk, then flag the state so the button disables. A failure just logs — the
        // cache is best-effort and a stale entry is harmless (it will be overwritten or evicted).
        void storageReader.backend.deleteQueryResultCache(sessionId, cacheKey).then(() => {
            connDispatch(sessionId, {
                type: QUERY_CACHE_DELETED,
                value: [queryId],
            });
        }).catch((e: any) => {
            logger.warn('Failed to delete cached query result', { session: sessionId, error: stringifyError(e) }, LOG_CTX);
        });
    }, [query, cacheKey, sessionId, storageReader, connDispatch, logger]);

    // No cache entry for this result: nothing to show.
    if (cacheKey == null) {
        return null;
    }

    // A cache hit reads "Was Cached"; a fresh miss we just wrote reads "Now Cached". Deleted entries
    // drop to the icon-only disabled state below.
    const servedFromCache = !cacheDeleted && query?.servedFromCache === true;
    const buttonLabel = servedFromCache ? 'Was Cached' : 'Now Cached';

    return (
        <>
            <button
                type="button"
                className={styles.delete_button}
                onClick={onDelete}
                disabled={cacheDeleted}
                aria-label="Delete cached query result"
                title={cacheDeleted ? 'Cached result deleted' : 'Delete cached result'}
            >
                <TrashIcon size={12} />
                {!cacheDeleted && <span>{buttonLabel}</span>}
            </button>
        </>
    );
};
