/// The eviction policy of the query result cache.
///
/// The cache of the app stores query results as Parquet files in the folder `cache/` of the origin private file
/// system (see `opfs_query_result_cache.ts`). Listing and deleting the files live behind `QueryResultCacheStore`, the
/// policy below is shared and unit-testable.
///
/// Eviction is a true LRU keyed on `lastAccessMs`. The origin private file system exposes no last-access time, and
/// re-touching a file on a hit would rewrite a potentially large file and clobber its write time. So each file has an
/// empty sibling marker (`<file>.last_access`) whose own mtime is bumped on every hit; the store reports that marker's
/// mtime as `lastAccessMs`. The marker is advisory, a file without a marker falls back to its write time.
///
/// The cache is best-effort, not transactional: under concurrent writes the size/count totals are approximate, a
/// delete of an already-gone file is tolerated, and a file that is read is kept (see `deleteCacheFile`).

/// Size/recency metadata for a single cached file.
export interface CacheFileStat {
    /// The file name, unique within the cache folder.
    name: string;
    /// The file size in bytes.
    size: number;
    /// The last-modified (write) time in milliseconds since the epoch. Doubles as the "cached at"
    /// timestamp surfaced in the UI (a cache hit never re-touches the payload).
    mtimeMs: number;
    /// The last-*access* time in milliseconds since the epoch: the mtime of the entry's
    /// `<file>.last_access` marker, bumped on every cache hit. Eviction drops the
    /// least-recently-accessed entries first. When no marker exists the backend falls back to
    /// `mtimeMs` here, so an un-accessed entry evicts by its write time.
    lastAccessMs: number;
}

/// The primitives of the cache folder that the eviction policy operates over.
export interface QueryResultCacheStore {
    /// List every file of the cache folder with its size and times. Returns an empty array when the folder does not
    /// exist yet.
    listCacheFiles(): Promise<CacheFileStat[]>;
    /// Delete a single cache file by name. Must tolerate a missing file (treat NotFound as success). Resolves false if
    /// the file is kept because it is read.
    deleteCacheFile(name: string): Promise<boolean | void>;
}

/// Default cap on the total size of the query result cache of the app.
export const DEFAULT_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/// Default cap on the number of cached query results of the app.
export const DEFAULT_CACHE_MAX_FILES = 1000;

/// Evict least-recently-accessed cache files until the cache is within both the size and count thresholds, e.g.
/// after a write.
///
/// Age is last-access time (`lastAccessMs`, the marker's mtime — see the module header): the
/// least-recently-*used* entries are dropped first, so this is a true LRU. Files are deleted
/// oldest-access-first until `totalBytes <= maxBytes` and `count <= maxFiles`. A file that is read stays, the next
/// one goes instead, so a single file larger than `maxBytes` empties the rest of the cache while it is read.
export async function evictToFit(
    store: QueryResultCacheStore,
    maxBytes: number = DEFAULT_CACHE_MAX_BYTES,
    maxFiles: number = DEFAULT_CACHE_MAX_FILES,
): Promise<void> {
    const files = await store.listCacheFiles();
    let totalBytes = files.reduce((total, f) => total + f.size, 0);
    let count = files.length;
    const fits = () => totalBytes <= maxBytes && count <= maxFiles;
    if (fits()) return;

    // Least-recently-accessed first (ascending lastAccessMs) so we drop the coldest entries.
    const byAge = [...files].sort((a, b) => a.lastAccessMs - b.lastAccessMs);
    for (const f of byAge) {
        if (fits()) break;
        // A file that is read stays, the next one goes instead
        if (await store.deleteCacheFile(f.name) === false) continue;
        totalBytes -= f.size;
        count -= 1;
    }
}
