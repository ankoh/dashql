import type * as arrow from 'apache-arrow';

import type { QueryResultCache, QueryResultCacheEntry } from '../query/query_result_cache.js';
import { copyArrowTableAsParquet, type ParquetDatabase } from '../platform/hyperdb/hyperdb_parquet_export.js';
import { getOPFSRoot } from '../platform/opfs_root.js';
import { DEFAULT_CACHE_MAX_BYTES, DEFAULT_CACHE_MAX_FILES, evictToFit, type CacheFileStat, type QueryResultCacheStore } from './query_result_cache_eviction.js';

/// The folder of the query result cache in the origin private file system
export const QUERY_RESULT_CACHE_DIRECTORY = 'cache';
/// The mount path of the query result cache in the compute database
export const QUERY_RESULT_CACHE_MOUNT = '/mnt/external/cache';
/// The empty marker beside a file whose modification time is the last read of the file
const ACCESS_SUFFIX = '.last_access';
/// The file of a key, `<key>.<uuid>.parquet`
const KEY_FILE = /^([0-9a-f]{64})\.[0-9a-f-]{36}\.parquet$/;
/// The suffix of a transient file, a result that can't be reused or a file that is being written. A transient file
/// that nobody pins is garbage, every listing removes it.
const TRANSIENT_SUFFIX = '.transient.parquet';
/// The Web Lock of a file, readers hold it shared, eviction and deletion take it exclusively if nobody holds it
const LOCK_PREFIX = 'dashql-query-result-cache/';

/// The options of the query result cache
export interface OPFSQueryResultCacheOptions {
    /// The origin private file system, the root of the files of the app
    getRoot?: () => Promise<FileSystemDirectoryHandle>;
    /// The locks of the windows of the app
    locks?: LockManager;
    /// The maximum total size of the files
    maxBytes?: number;
    /// The maximum number of files
    maxFiles?: number;
}

/// The key of a file, null for transient files and files of other versions
export function cacheFileKey(name: string): string | null {
    return KEY_FILE.exec(name)?.[1] ?? null;
}

/// Is a file transient, i.e. removed once nobody pins it?
export function isTransientCacheFile(name: string): boolean {
    return name.endsWith(TRANSIENT_SUFFIX);
}

/// The query result cache of the app in the folder `cache/` of the origin private file system
export function createOPFSQueryResultCache(options: OPFSQueryResultCacheOptions = {}): QueryResultCache {
    const getRoot = options.getRoot ?? getOPFSRoot;
    const locks = options.locks ?? navigator.locks;
    const maxBytes = options.maxBytes ?? DEFAULT_CACHE_MAX_BYTES;
    const maxFiles = options.maxFiles ?? DEFAULT_CACHE_MAX_FILES;
    const directory = async () => await (await getRoot()).getDirectoryHandle(QUERY_RESULT_CACHE_DIRECTORY, { create: true });

    /// The Parquet files with their sizes and times. Transient files that nobody pins and markers without a file are
    /// removed.
    const listFiles = async (): Promise<CacheFileStat[]> => {
        const dir = await directory();
        const accessMs = new Map<string, number>();
        let files: { name: string; size: number; mtimeMs: number }[] = [];
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind !== 'file') continue;
            try {
                const file = await (handle as FileSystemFileHandle).getFile();
                if (name.endsWith(ACCESS_SUFFIX)) accessMs.set(name.slice(0, -ACCESS_SUFFIX.length), file.lastModified);
                else if (name.endsWith('.parquet')) files.push({ name, size: file.size, mtimeMs: file.lastModified });
            } catch {
                // A file that another window removed meanwhile
            }
        }
        // The pinned transient files are written or read right now, they stay and count towards the limits. An empty
        // file of a key is being written without `move` or was left by a window that closed during the write: readers
        // find no result in it.
        const removed = new Set<string>();
        const incomplete = (file: { name: string; size: number }) => file.size === 0 && cacheFileKey(file.name) != null;
        for (const file of files) {
            if ((isTransientCacheFile(file.name) || incomplete(file)) && await tryRemove(file.name)) removed.add(file.name);
        }
        files = files.filter(file => !removed.has(file.name) && !incomplete(file));
        const names = new Set(files.map(file => file.name));
        for (const name of accessMs.keys()) {
            if (!names.has(name)) await dir.removeEntry(`${name}${ACCESS_SUFFIX}`).catch(() => {});
        }
        return files.map(file => ({ ...file, lastAccessMs: accessMs.get(file.name) ?? file.mtimeMs }));
    };
    const entries = async (): Promise<QueryResultCacheEntry[]> => (await listFiles()).flatMap(file => {
        const key = cacheFileKey(file.name);
        return key == null ? [] : [{ name: file.name, key, size: file.size, cachedAtMs: file.mtimeMs, lastAccessMs: file.lastAccessMs }];
    });

    // The compute database that the files are mounted in, shared by the readers and writers of this window
    let mountedIn: ParquetDatabase | null = null;
    // Did this window remove files since the mount was refreshed? The database still knows the files it opened.
    let mountStale = false;
    let mountChain: Promise<unknown> = Promise.resolve();
    const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
        const result = mountChain.then(operation);
        mountChain = result.catch(() => {});
        return result;
    };

    /// Remove a file and its marker if nobody reads it, resolves true if the file is gone
    const tryRemove = async (name: string): Promise<boolean> => {
        return await locks.request(`${LOCK_PREFIX}${name}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
            if (lock == null) return false;
            const dir = await directory();
            let gone = true;
            await dir.removeEntry(name).catch((error: unknown) => {
                if ((error as DOMException)?.name !== 'NotFoundError') gone = false;
            });
            if (!gone) return false;
            await dir.removeEntry(`${name}${ACCESS_SUFFIX}`).catch(() => {});
            mountStale = true;
            return true;
        });
    };
    const store: QueryResultCacheStore = {
        listCacheFiles: listFiles,
        deleteCacheFile: async name => await tryRemove(name),
    };
    const touch = async (name: string) => {
        const writable = await (await (await directory()).getFileHandle(`${name}${ACCESS_SUFFIX}`, { create: true })).createWritable();
        await writable.close();
    };
    const pin = (name: string): Promise<() => Promise<void>> => new Promise(acquired => {
        // The request settles once the lock is released, not when the callback returns
        const held = locks.request(`${LOCK_PREFIX}${name}`, { mode: 'shared' }, () => new Promise<void>(release => {
            acquired(async () => {
                release();
                await held.catch(() => {});
            });
        }));
    });
    const mount = (database: ParquetDatabase) => serialize(async () => {
        if (mountedIn != null && mountedIn !== database) {
            await mountedIn.removeExternalDirectory(QUERY_RESULT_CACHE_MOUNT).catch(() => {});
            mountedIn = null;
        }
        if (mountedIn == null) {
            mountStale = false;
            await database.registerExternalDirectory(await directory(), QUERY_RESULT_CACHE_MOUNT, 'readwrite');
            mountedIn = database;
        } else if (mountStale) {
            // Removals during the refresh mark the mount stale again
            mountStale = false;
            try {
                await database.refreshExternalDirectory(QUERY_RESULT_CACHE_MOUNT);
            } catch (error) {
                mountStale = true;
                throw error;
            }
        }
    });

    const lookup = async (key: string) => {
        const files = (await entries()).filter(entry => entry.key === key);
        files.sort((a, b) => b.cachedAtMs - a.cachedAtMs || b.name.localeCompare(a.name));
        return files[0] ?? null;
    };

    return {
        mountPath: QUERY_RESULT_CACHE_MOUNT,
        lookup,
        has: async key => (await entries()).some(entry => entry.key === key),
        retain: async key => {
            // Another window may remove the file between the lookup and the pin, then a newer file may be there
            for (let attempt = 0; attempt < 3; ++attempt) {
                const entry = await lookup(key);
                if (entry == null) return null;
                const release = await pin(entry.name);
                try {
                    await (await directory()).getFileHandle(entry.name);
                } catch {
                    await release();
                    continue;
                }
                await touch(entry.name).catch(() => {});
                return { entry, release };
            }
            return null;
        },
        list: entries,
        touch,
        delete: async key => {
            let gone = true;
            for (const entry of (await entries()).filter(entry => entry.key === key)) {
                if (!await tryRemove(entry.name)) gone = false;
            }
            return gone;
        },
        clear: async () => {
            // Also the files without keys that nobody reads, e.g. those of runs of a window that was closed
            const keys = new Set<string>();
            for (const file of await listFiles()) {
                const key = cacheFileKey(file.name);
                if (await tryRemove(file.name) && key != null) keys.add(key);
            }
            // A key whose newer file is read stays cached
            const remaining = new Set((await entries()).map(entry => entry.key));
            return [...keys].filter(key => !remaining.has(key));
        },
        pin,
        newFileName: key => `${key}.${crypto.randomUUID()}.parquet`,
        newTransientFileName: () => `${crypto.randomUUID()}${TRANSIENT_SUFFIX}`,
        mount,
        writeTable: async (database: ParquetDatabase, table: arrow.Table, name: string) => {
            await mount(database);
            const dir = await directory();
            const key = cacheFileKey(name);
            if (key == null) {
                await copyArrowTableAsParquet(database, table, `${QUERY_RESULT_CACHE_MOUNT}/${name}`);
                return await (await dir.getFileHandle(name)).getFile();
            }
            // Readers of other windows find the file of a key once it is complete
            const temporary = `${crypto.randomUUID()}${TRANSIENT_SUFFIX}`;
            const releaseTemporary = await pin(temporary);
            try {
                await copyArrowTableAsParquet(database, table, `${QUERY_RESULT_CACHE_MOUNT}/${temporary}`);
                const handle = await dir.getFileHandle(temporary);
                if ('move' in handle && typeof (handle as { move?: unknown }).move === 'function') {
                    await (handle as FileSystemFileHandle & { move(name: string): Promise<void> }).move(name);
                } else {
                    await (await handle.getFile()).stream().pipeTo(await (await dir.getFileHandle(name, { create: true })).createWritable());
                    await dir.removeEntry(temporary);
                }
            } finally {
                await releaseTemporary();
            }
            await touch(name);
            // The older files of the key are removed once nobody reads them, eviction keeps the files below the limits
            for (const entry of await entries()) {
                if (entry.key === key && entry.name !== name) await tryRemove(entry.name);
            }
            await evictToFit(store, maxBytes, maxFiles);
            return await (await dir.getFileHandle(name)).getFile();
        },
        readTable: async (database: ParquetDatabase, name: string) => {
            const release = await pin(name);
            try {
                // The file may have been removed between the lookup and the pin
                await (await directory()).getFileHandle(name);
                await mount(database);
                const connection = await database.connect({ pooled: true });
                try {
                    return await connection.query(`SELECT * FROM external('${QUERY_RESULT_CACHE_MOUNT}/${name}', format => 'parquet')`);
                } finally {
                    await connection.close();
                }
            } finally {
                await release();
            }
        },
        remove: async name => { await tryRemove(name); },
    };
}
