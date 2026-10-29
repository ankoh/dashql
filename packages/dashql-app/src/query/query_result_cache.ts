export interface CachedQueryResult {
    bytes: Uint8Array;
    cachedAtMs: number;
}

/// Optional result-cache capability supplied by an execution host.
/// Query execution does not know which storage namespace backs the cache.
export interface QueryResultCache {
    load(key: string): Promise<CachedQueryResult | null>;
    /// Record an access of a result, resolves true when it was recorded
    touch(key: string): Promise<boolean>;
    /// Store a result, resolves true when it was written
    store(key: string, bytes: Uint8Array): Promise<boolean>;
}
