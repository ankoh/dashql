import type * as arrow from 'apache-arrow';

import type { ParquetDatabase } from '../platform/hyperdb/hyperdb_parquet_export.js';

/// The error of a query that may only read a cached result, see `cacheOnly` of the query execution args
export class QueryCacheMissError extends Error {
    constructor() {
        super('The query result is not cached');
        this.name = 'QueryCacheMissError';
    }
}

/// Did a query fail because it may only read a cached result that is not cached?
export function isQueryCacheMiss(error: unknown): boolean {
    return error instanceof Error && error.name === 'QueryCacheMissError';
}

/// A cached query result, a Parquet file of the query result cache of the app
export interface QueryResultCacheEntry {
    /// The file name, `<key>.<uuid>.parquet`
    name: string;
    /// The cache key
    key: string;
    /// The size in bytes
    size: number;
    /// The time the result was written
    cachedAtMs: number;
    /// The time the result was read last
    lastAccessMs: number;
}

/// The query result cache of the app (docs/design/query_cache.md).
///
/// The cache holds Parquet files in the origin private file system for every session and connection, keyed by the
/// connection, the script and the scripts it references. The compute database mounts the files at `mountPath` and
/// writes and reads them there. A file keeps its content: a write of a key creates a new file and removes the older
/// files of the key, a lookup finds the newest one. A transient file holds a result that can't be reused, e.g. the
/// materialized result of a script whose connection doesn't cache results: it has no key and is removed once nobody
/// pins it. Readers pin the files they read, eviction and deletion leave pinned files alone, also those of other
/// windows of the app.
export interface QueryResultCache {
    /// The mount path of the files in the compute database
    readonly mountPath: string;
    /// The newest file of a key, null on a miss
    lookup(key: string): Promise<QueryResultCacheEntry | null>;
    /// Is a key cached?
    has(key: string): Promise<boolean>;
    /// The newest file of a key, pinned until the release and present when it resolves, null on a miss. Records a
    /// read of the file.
    retain(key: string): Promise<{ entry: QueryResultCacheEntry; release: () => Promise<void> } | null>;
    /// The cached results
    list(): Promise<QueryResultCacheEntry[]>;
    /// Record a read of a file, eviction drops the least recently read files first
    touch(name: string): Promise<void>;
    /// Remove the files of a key that nobody reads, resolves true if no file of the key is left
    delete(key: string): Promise<boolean>;
    /// Remove every file that nobody reads, also files without keys, returns the keys that no file is left of
    clear(): Promise<string[]>;
    /// Keep a file while it is read, resolves with the release once the file is pinned. The release resolves once
    /// the file can be removed.
    pin(name: string): Promise<() => Promise<void>>;
    /// The name of a new file of a key
    newFileName(key: string): string;
    /// The name of a new transient file, removed by the first listing after nobody pins it any more
    newTransientFileName(): string;
    /// Mount the files in a database. The mount is shared and stays, after files were removed it is refreshed, so
    /// the database forgets the files it opened. Queries that read files keep reading them.
    mount(database: ParquetDatabase): Promise<void>;
    /// Write a table as file `name` while the files are mounted in the database. The file of a key is written under
    /// another name and moved in place once it is complete, the older files of the key are removed. Returns the file.
    writeTable(database: ParquetDatabase, table: arrow.Table, name: string): Promise<File>;
    /// Read a file into a table while it is pinned and mounted in the database
    readTable(database: ParquetDatabase, name: string): Promise<arrow.Table>;
    /// Remove a file that nobody reads, e.g. a transient file of a run once the run ended
    remove(name: string): Promise<void>;
}
