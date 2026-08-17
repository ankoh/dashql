import type { QueryResultCache } from '../../../query/query_result_cache.js';
import type { StorageBackend } from './storage_backend.js';

export function createNotebookQueryResultCache(
    backend: StorageBackend,
    notebookId: string,
): QueryResultCache {
    return {
        load: key => backend.loadQueryResultCache(notebookId, key),
        touch: key => backend.touchQueryResultCacheAccess(notebookId, key),
        store: (key, bytes) => backend.saveQueryResultCache(notebookId, key, bytes),
    };
}
