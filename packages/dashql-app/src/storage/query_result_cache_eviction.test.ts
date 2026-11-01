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

describe('evictToFit', () => {
    it('does nothing when the cache is within the thresholds', async () => {
        const store = new MemoryCacheStore([stat('a.parquet', 10, 1), stat('b.parquet', 10, 2)]);
        await evictToFit(store, /*maxBytes*/ 20, /*maxFiles*/ 2);
        expect(store.deleted).toEqual([]);
    });

    it('evicts least-recently-accessed files first until under the size threshold', async () => {
        const store = new MemoryCacheStore([stat('old.parquet', 40, 1), stat('mid.parquet', 40, 2), stat('new.parquet', 40, 3)]);
        // total 120, cap 50 -> drop old (40) then mid (40) => 40 left.
        await evictToFit(store, /*maxBytes*/ 50, /*maxFiles*/ 100);
        expect(store.deleted).toEqual(['old.parquet', 'mid.parquet']);
    });

    it('sorts by last-access time, not write time (true LRU)', async () => {
        // 'old' was written first but accessed most recently; 'new' was written last but never
        // re-accessed. LRU must evict the coldest by access time ('new'), not the oldest write.
        const store = new MemoryCacheStore([
            { name: 'old.parquet', size: 40, mtimeMs: 1, lastAccessMs: 99 },
            { name: 'mid.parquet', size: 40, mtimeMs: 2, lastAccessMs: 50 },
            { name: 'new.parquet', size: 40, mtimeMs: 3, lastAccessMs: 5 },
        ]);
        await evictToFit(store, /*maxBytes*/ 100, /*maxFiles*/ 100);
        expect(store.deleted).toEqual(['new.parquet']);
    });

    it('keeps as many files as the file-count threshold allows', async () => {
        const store = new MemoryCacheStore([stat('old.parquet', 1, 1), stat('mid.parquet', 1, 2), stat('new.parquet', 1, 3)]);
        // A write left 3 files, the threshold is 2 -> drop the single coldest.
        await evictToFit(store, /*maxBytes*/ 1000, /*maxFiles*/ 2);
        expect(store.deleted).toEqual(['old.parquet']);
        await evictToFit(store, 1000, 2);
        expect(store.deleted).toEqual(['old.parquet']);
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
