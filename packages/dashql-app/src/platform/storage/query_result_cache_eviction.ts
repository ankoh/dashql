/// Backend-agnostic eviction policy for the file-based query result cache.
///
/// The cache stores query results as `<hash>.arrow` files in a `cache/` folder inside each session's
/// storage. Only *listing* and *deleting* those files differs between backends (OPFS reads size and
/// `lastModified` from a `File`; the native backend has to `stat()` each entry), so those primitives
/// live behind `QueryResultCacheStore` while the policy below is shared and unit-testable.
///
/// Eviction is by write time, not access time: neither OPFS nor the Tauri fs plugin gives us a
/// reliable last-access time (and no way to set one), so we deliberately do NOT re-touch a file on a
/// cache hit — that also keeps the write time meaningful as a "cached at" timestamp for the UI. The
/// policy is therefore least-recently-*written* (effectively FIFO by creation), not a true LRU.
///
/// The cache is best-effort, not transactional: under concurrent writes the size/count totals are
/// approximate, and a delete of an already-gone file is tolerated (see `deleteCacheFile`).

/// Size/recency metadata for a single cached `.arrow` file.
export interface CacheFileStat {
    /// The file name (including the `.arrow` extension), unique within the cache folder.
    name: string;
    /// The file size in bytes.
    size: number;
    /// The last-modified (write) time in milliseconds since the epoch. Used as the age signal for
    /// eviction: oldest-written entries are dropped first.
    mtimeMs: number;
}

/// The per-backend primitives the eviction policy operates over.
export interface QueryResultCacheStore {
    /// List every `*.arrow` entry in the session's cache folder with its size and mtime. Returns an
    /// empty array when the folder does not exist yet.
    listCacheFiles(sessionId: string): Promise<CacheFileStat[]>;
    /// Delete a single cache file by name. Must tolerate a missing file (treat NotFound as success).
    deleteCacheFile(sessionId: string, name: string): Promise<void>;
}

/// Default cap on the total size of a session's query result cache.
export const DEFAULT_CACHE_MAX_BYTES = 512 * 1024 * 1024;
/// Default cap on the number of cached query results per session.
export const DEFAULT_CACHE_MAX_FILES = 200;

/// Evict oldest-written cache files until a new entry of `incomingBytes` fits under both the size and
/// count thresholds.
///
/// Age is write time (`mtimeMs`): a cache *hit* does not re-touch the file, so this is a
/// least-recently-*written* policy (effectively FIFO by creation), not a true LRU — see the module
/// header for why access time is unavailable. Files are deleted oldest-first until
/// `totalBytes + incomingBytes <= maxBytes` and `count + 1 <= maxFiles`. A single incoming entry
/// larger than `maxBytes` simply empties the cache (nothing more can be freed); the caller still
/// writes it, and the next write will evict it in turn.
export async function evictToFit(
    store: QueryResultCacheStore,
    sessionId: string,
    incomingBytes: number,
    maxBytes: number = DEFAULT_CACHE_MAX_BYTES,
    maxFiles: number = DEFAULT_CACHE_MAX_FILES,
): Promise<void> {
    const files = await store.listCacheFiles(sessionId);

    let totalBytes = 0;
    for (const f of files) {
        totalBytes += f.size;
    }
    let count = files.length;

    // Already room for the incoming entry (which will overwrite any existing same-hash file, but we
    // conservatively treat it as an addition — the totals are approximate by design).
    if (totalBytes + incomingBytes <= maxBytes && count + 1 <= maxFiles) {
        return;
    }

    // Oldest-written first (ascending mtime) so we drop the least-recently-written entries.
    const byAge = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of byAge) {
        if (totalBytes + incomingBytes <= maxBytes && count + 1 <= maxFiles) {
            break;
        }
        await store.deleteCacheFile(sessionId, f.name);
        totalBytes -= f.size;
        count -= 1;
    }
}
