export interface CachedQueryResult {
    bytes: Uint8Array;
    cachedAtMs: number;
}

/// Optional result-cache capability supplied by an execution host.
/// Query execution does not know which storage namespace backs the cache.
export interface QueryResultCache {
    load(key: string): Promise<CachedQueryResult | null>;
    touch(key: string): Promise<void>;
    store(key: string, bytes: Uint8Array): Promise<void>;
}
