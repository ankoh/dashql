import type { QueryResultCache } from '../../query/query_result_cache.js';
import type { StorageBackend } from './storage_backend.js';
import {
    type StorageWriter,
    TOUCH_QUERY_RESULT_CACHE,
    WRITE_QUERY_RESULT_CACHE,
    groupQueryResultCacheTouches,
    groupQueryResultCacheWrites,
} from './storage_writer.js';

/// The query result cache of a session. The writes go through the storage writer, they wait for a
/// paused session and are discarded once the session is deleted.
export function createSessionQueryResultCache(
    backend: StorageBackend,
    writer: StorageWriter,
    sessionId: string,
): QueryResultCache {
    return {
        load: key => backend.loadQueryResultCache(sessionId, key),
        touch: key => writer.write(groupQueryResultCacheTouches(sessionId, key), { type: TOUCH_QUERY_RESULT_CACHE, value: [sessionId, key] }),
        store: (key, bytes) => writer.write(groupQueryResultCacheWrites(sessionId, key), { type: WRITE_QUERY_RESULT_CACHE, value: [sessionId, key, bytes] }),
    };
}
