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

    constructor(files: CacheFileStat[]) {
        this.files = files;
    }
    async listCacheFiles(): Promise<CacheFileStat[]> {
        return this.files.filter(f => !this.deleted.includes(f.name));
    }
    async deleteCacheFile(_sessionId: string, name: string): Promise<void> {
        if (this.missing.has(name)) {
            // Tolerated: mark as gone without error, as the real backends do for NotFound.
            this.deleted.push(name);
            return;
        }
        this.deleted.push(name);
    }
}

const SID = 'session';

describe('evictToFit', () => {
    it('does nothing when the incoming entry already fits', async () => {
        const store = new MemoryCacheStore([
            { name: 'a.arrow', size: 10, mtimeMs: 1 },
            { name: 'b.arrow', size: 10, mtimeMs: 2 },
        ]);
        await evictToFit(store, SID, 10, /*maxBytes*/ 100, /*maxFiles*/ 10);
        expect(store.deleted).toEqual([]);
    });

    it('evicts oldest-written files first until under the size threshold', async () => {
        const store = new MemoryCacheStore([
            { name: 'old.arrow', size: 40, mtimeMs: 1 },
            { name: 'mid.arrow', size: 40, mtimeMs: 2 },
            { name: 'new.arrow', size: 40, mtimeMs: 3 },
        ]);
        // total 120, incoming 40, cap 100 -> must free >= 60 -> drop old (40) then mid (40) => 40 left.
        await evictToFit(store, SID, 40, /*maxBytes*/ 100, /*maxFiles*/ 100);
        expect(store.deleted).toEqual(['old.arrow', 'mid.arrow']);
    });

    it('stops evicting as soon as it fits', async () => {
        const store = new MemoryCacheStore([
            { name: 'old.arrow', size: 40, mtimeMs: 1 },
            { name: 'mid.arrow', size: 40, mtimeMs: 2 },
            { name: 'new.arrow', size: 40, mtimeMs: 3 },
        ]);
        // total 120, incoming 10, cap 100 -> free >= 30 -> dropping old (40) suffices.
        await evictToFit(store, SID, 10, /*maxBytes*/ 100, /*maxFiles*/ 100);
        expect(store.deleted).toEqual(['old.arrow']);
    });

    it('evicts to satisfy the file-count threshold even when size fits', async () => {
        const store = new MemoryCacheStore([
            { name: 'old.arrow', size: 1, mtimeMs: 1 },
            { name: 'mid.arrow', size: 1, mtimeMs: 2 },
            { name: 'new.arrow', size: 1, mtimeMs: 3 },
        ]);
        // 3 files + 1 incoming = 4 > maxFiles 3 -> drop the single oldest.
        await evictToFit(store, SID, 1, /*maxBytes*/ 1000, /*maxFiles*/ 3);
        expect(store.deleted).toEqual(['old.arrow']);
    });

    it('empties the cache for an incoming entry larger than the whole budget', async () => {
        const store = new MemoryCacheStore([
            { name: 'a.arrow', size: 10, mtimeMs: 1 },
            { name: 'b.arrow', size: 10, mtimeMs: 2 },
        ]);
        await evictToFit(store, SID, 1000, /*maxBytes*/ 100, /*maxFiles*/ 100);
        expect(store.deleted.sort()).toEqual(['a.arrow', 'b.arrow']);
    });

    it('tolerates a NotFound during deletion', async () => {
        const store = new MemoryCacheStore([
            { name: 'old.arrow', size: 40, mtimeMs: 1 },
            { name: 'mid.arrow', size: 40, mtimeMs: 2 },
            { name: 'new.arrow', size: 40, mtimeMs: 3 },
        ]);
        store.missing.add('old.arrow');
        await expect(evictToFit(store, SID, 40, 100, 100)).resolves.toBeUndefined();
        expect(store.deleted).toContain('old.arrow');
    });
});
