import { AxiosRequestConfig, AxiosResponse } from 'axios';

export type ObjectURL = string;

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
}

/// A cached HTTP entry
export interface CachedHTTPData extends CacheEntry {
    /// The request
    request: AxiosRequestConfig;
    /// The response
    response: AxiosResponse<ArrayBuffer>;
}
