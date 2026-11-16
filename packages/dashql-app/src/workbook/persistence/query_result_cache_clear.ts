import type { Runtime } from '@akohn/dashql/runtime/runtime';

/// Mark the finished queries whose cached results were deleted, their results no longer advertise a cache entry. The
/// cache belongs to the app, the queries of every connection may advertise a key. Returns the number of marked queries.
export function markDeletedQueryResults(runtime: Runtime, keys: Iterable<string>): number {
    const deleted = new Set(keys);
    let marked = 0;
    for (const database of runtime.store.all('connection').values()) {
        for (const queryId of database.queriesFinishedOrdered) {
            const query = runtime.store.get('query', queryId);
            if (query?.cacheKey != null && deleted.has(query.cacheKey) && !query.cacheDeleted) {
                runtime.dispatch({ connection: database.connectionId }, { kind: 'queryCacheDeleted', value: { queryId } });
                ++marked;
            }
        }
    }
    return marked;
}
