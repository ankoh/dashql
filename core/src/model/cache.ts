export type ObjectURL = String;

export interface CacheEntry {
    /// The cache key
    key: string;
    /// The time at which the entry was created
    timeCreated: Date;
    /// The time at which the entry was last accessed
    timeLastAccess: Date;
    /// The access count
    accessCount: number;
}

export interface CachedFileData extends CacheEntry {
    /// The object URL
    objectURL: ObjectURL;
};

/// A cached HTTP entry
export interface CachedHTTPData extends CacheEntry {
    /// The request
    request: Request;
    /// The request body (if any)
    requestBody: Uint8Array | null;
    /// The response
    response: Response;
}

