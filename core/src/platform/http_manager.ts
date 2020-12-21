import { LRUCache } from '../utils/lru_cache';
import { IHasher, createSHA256 } from '../utils/hash';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import axios from 'axios';

const REQUEST_CACHE_SIZE = 64;

type HTTPProgressHandler = (sig: string, progress: ProgressEvent) => void;

export interface HTTPData {
    /// The cache key
    key: string;
    /// The request
    request: AxiosRequestConfig;
    /// The response
    response: AxiosResponse<ArrayBuffer>;
}

/// A HTTP request cache
class HTTPRequestCache extends LRUCache<HTTPData> {
    /// Constructor
    constructor(size: number) {
        super(size);
    }

    /// Update handler
    onEvict(_slot: number, _next: HTTPData, _evicted: HTTPData | null): void {
        // if (evicted) {
        //     console.log("evict: " + evicted.key);
        // }
        // XXX
    }
}

export class HTTPManager {
    /// The request cache
    _request_cache: HTTPRequestCache;
    /// The hasher
    _hasher: IHasher | null;

    /// Constructor
    constructor(cache_size: number = REQUEST_CACHE_SIZE) {
        this._request_cache = new HTTPRequestCache(cache_size);
        this._hasher = null;
    }

    /// Init the http manager
    public async init() {
        this._hasher = await createSHA256();
    }

    /// Hash a request
    protected hashRequest(req: AxiosRequestConfig): string {
        console.assert(this._hasher != null, 'hasher must be initialized');
        let hasher = this._hasher!;
        hasher.init();
        if (req.url)
            hasher.update(req.url);
        for (const key in req.headers) {
            const value = req.headers[key];
            hasher.update(key);
            hasher.update(value);
        }
        if (req.data) {
            if (typeof req.data === 'string' || req.data instanceof String) {
                hasher.update(req.data.toString());
            } else if (req.data.constructor == Uint8Array) {
                hasher.update(req.data);
            }
        }
        return hasher.digest('hex');
    }

    /// Send a HTTP request
    public async request(req: AxiosRequestConfig, onProgress: HTTPProgressHandler = (_sig: string, _event: ProgressEvent) => {}): Promise<HTTPData> {
        const sig = this.hashRequest(req);
        const cached = this._request_cache.find(sig);
        if (cached) return cached;

        // Send HTTP request
        req.onDownloadProgress = (event: ProgressEvent) => onProgress(sig, event);
        const res = await axios.request<ArrayBuffer>(req);

        // Cache response
        return this._request_cache.insert({
            key: sig,
            request: req,
            response: res,
        });
    }
}
