import type * as arrow from 'apache-arrow';
import { vi } from 'vitest';

import type { QueryResultCache, QueryResultCacheEntry } from '../query/query_result_cache.js';

/// A cached file of the memory cache, the key is empty for the files of results that can't be cached
interface MemoryCacheFile {
    key: string;
    cachedAtMs: number;
    table: arrow.Table | null;
}

/// A query result cache of the tests in memory. Files are named like the files of the OPFS cache, writes and reads
/// don't touch the database. The cache remembers the key of every name it handed out.
export function memoryQueryResultCache(mountPath: string = '/mnt/external/cache') {
    const files = new Map<string, MemoryCacheFile>();
    const keysOfNames = new Map<string, string>();
    let clock = 0;
    const entries = (): QueryResultCacheEntry[] => [...files].filter(([, file]) => file.key !== '').map(([name, file]) => ({
        name, key: file.key, size: 1, cachedAtMs: file.cachedAtMs, lastAccessMs: file.cachedAtMs,
    }));
    const newFileName = (key: string) => {
        const name = `${key}.${crypto.randomUUID()}.parquet`;
        keysOfNames.set(name, key);
        return name;
    };
    const cache = {
        mountPath,
        files,
        /// Add a cached file of a key
        put: (key: string, table: arrow.Table | null = null) => {
            const name = newFileName(key);
            files.set(name, { key, cachedAtMs: ++clock, table });
            return name;
        },
        lookup: vi.fn(async (key: string) => entries().filter(e => e.key === key).sort((a, b) => b.cachedAtMs - a.cachedAtMs)[0] ?? null),
        has: vi.fn(async (key: string) => entries().some(e => e.key === key)),
        retain: vi.fn(async (key: string) => {
            const entry = entries().filter(e => e.key === key).sort((a, b) => b.cachedAtMs - a.cachedAtMs)[0] ?? null;
            return entry == null ? null : { entry, release: async () => {} };
        }),
        list: vi.fn(async () => entries()),
        touch: vi.fn(async (_name: string) => {}),
        delete: vi.fn(async (key: string) => {
            for (const e of entries()) if (e.key === key) files.delete(e.name);
            return true;
        }),
        clear: vi.fn(async () => {
            const keys = [...new Set(entries().map(e => e.key))];
            files.clear();
            return keys;
        }),
        pin: vi.fn(async (_name: string) => async () => {}),
        newFileName,
        newTransientFileName: () => `${crypto.randomUUID()}.transient.parquet`,
        acquireMount: vi.fn(async (_database: unknown) => () => {}),
        writeTable: vi.fn(async (_database: unknown, table: arrow.Table, name: string) => {
            const key = keysOfNames.get(name) ?? '';
            if (key !== '') for (const e of entries()) if (e.key === key) files.delete(e.name);
            files.set(name, { key, cachedAtMs: ++clock, table });
            return new File([], name);
        }),
        readTable: vi.fn(async (_database: unknown, name: string) => {
            const file = files.get(name);
            if (file?.table == null) throw new Error(`The file ${name} is not cached`);
            return file.table;
        }),
        remove: vi.fn(async (name: string) => { files.delete(name); }),
    } satisfies QueryResultCache & Record<string, unknown>;
    return cache;
}
