import { QUERY_CACHE_DELETED } from '../../query/query_execution_state.js';
import type { ConnectionRegistry, DynamicConnectionDispatch } from '../../connections/connection_registry.js';

/// Mark the finished queries whose cached results were deleted, their results no longer advertise a cache entry. The
/// cache belongs to the app, the queries of every connection may advertise a key. Returns the number of marked queries.
export function markDeletedQueryResults(
    registry: ConnectionRegistry,
    dispatch: DynamicConnectionDispatch,
    keys: Iterable<string>,
): number {
    const deleted = new Set(keys);
    let marked = 0;
    for (const database of registry.connections.values()) {
        for (const query of database.queriesFinished.values()) {
            if (query.cacheKey != null && deleted.has(query.cacheKey) && !query.cacheDeleted) {
                dispatch(database.connectionId, { type: QUERY_CACHE_DELETED, value: [query.queryId] });
                ++marked;
            }
        }
    }
    return marked;
}
