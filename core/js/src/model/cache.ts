export type CacheKey = string;
export type BlobKey = number;

export interface CachedFileData {
    cacheKey: string;
    fileName: string;
    data: BlobKey;
}

export interface HTTPRequest {
    headers: Map<string, string>;
    url: string;
    body: BlobKey | null;
}

export interface HTTPResponse {
    headers: Map<string, string>;
    ok: boolean;
    redirected: boolean;
    status: number;
    statusText: string;
    url: string;
    body: BlobKey | null;
}

export interface CachedHTTPData {
    cacheKey: string;
    request: HTTPRequest;
    response: HTTPResponse;
}

export interface CacheEntry {
    cacheKey: string;
    dateCreated: Date;
    dateLastAccess: Date;
    accessCount: number;
}
