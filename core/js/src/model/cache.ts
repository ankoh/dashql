export type CacheKey = string;
export type BlobKey = string;

export interface CachedFileData {
    cache_key: string;
    file_name: string;
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
    cache_key: string;
    request: HTTPRequest;
    response: HTTPResponse;
}
