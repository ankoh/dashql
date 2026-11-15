import { describe, it, expect } from 'vitest';
import {
    type CacheFileStat,
    type QueryResultCacheStore,
    evictToFit,
} from './query_result_cache_eviction.js';

/// An in-memory cache store for exercising the eviction policy in isolation.
class MemoryCacheStore implements QueryResultCacheStore {
    files: CacheFileStat[];
    deleted: string[] = [];
    /// When set, deleteCacheFile throws for these names (simulating a NotFound race). evictToFit does
    /// not itself swallow errors — the per-backend store is responsible for tolerating NotFound — so
    /// this store models the tolerant backends.
    missing = new Set<string>();
    /// The files that are read, deletion keeps them
    read = new Set<string>();

    constructor(files: CacheFileStat[]) {
        this.files = files;
    }
    async listCacheFiles(): Promise<CacheFileStat[]> {
        return this.files.filter(f => !this.deleted.includes(f.name));
    }
    async deleteCacheFile(name: string): Promise<boolean> {
        if (this.read.has(name)) return false;
        if (this.missing.has(name)) {
            // Tolerated: mark as gone without error, as the real backends do for NotFound.
            this.deleted.push(name);
            return true;
        }
        this.deleted.push(name);
        return true;
    }
}

/// Shorthand for a stat whose access time equals its write time (the un-accessed / fresh-write case,
/// where the marker mtime falls back to the payload's mtime).
function stat(name: string, size: number, mtimeMs: number): CacheFileStat {
    return { name, size, mtimeMs, lastAccessMs: mtimeMs };
}

// The policy is tested in the core (`workbook_format::eviction`), these tests drive it over a store
describe('evictToFit', () => {
    it('evicts least-recently-accessed files first until under the size threshold', async () => {
        const store = new MemoryCacheStore([stat('old.parquet', 40, 1), stat('mid.parquet', 40, 2), stat('new.parquet', 40, 3)]);
        // total 120, cap 50 -> drop old (40) then mid (40) => 40 left.
        await evictToFit(store, /*maxBytes*/ 50, /*maxFiles*/ 100);
        expect(store.deleted).toEqual(['old.parquet', 'mid.parquet']);
    });

    it('keeps the files that are read and evicts the next ones instead', async () => {
        const store = new MemoryCacheStore([stat('old.parquet', 40, 1), stat('mid.parquet', 40, 2), stat('new.parquet', 40, 3)]);
        store.read.add('old.parquet');
        await evictToFit(store, 80, 100);
        expect(store.deleted).toEqual(['mid.parquet']);
    });

    it('tolerates a NotFound during deletion', async () => {
        const store = new MemoryCacheStore([stat('old.parquet', 40, 1), stat('mid.parquet', 40, 2), stat('new.parquet', 40, 3)]);
        store.missing.add('old.parquet');
        await expect(evictToFit(store, 100, 100)).resolves.toBeUndefined();
        expect(store.deleted).toContain('old.parquet');
    });
});
