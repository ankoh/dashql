import { LRUCache } from '../utils/lru_cache';
import { IHasher, createSHA256 } from '../utils/hash';
import { DerivedReduxStore, StateMutationType } from '../model';
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
    /// The redux store
    _store: DerivedReduxStore;

    /// Constructor
    constructor(store: DerivedReduxStore, size: number) {
        super(size);
        this._store = store;
    }

    /// Insert handler
    onInsert(_slot: number, next: HTTPData, evicted: HTTPData | null): void {
        this._store.dispatch({
            type: StateMutationType.CACHE_HTTP_DATA,
            payload: [next, evicted?.key]
        });
    }

    /// Hit handler
    onHit(_slot: number, next: HTTPData): void {
        this._store.dispatch({
            type: StateMutationType.HIT_CACHED_HTTP_DATA,
            payload: next.key
        });
    }
}

export class HTTPManager {
    /// The redux store
    _store: DerivedReduxStore;
    /// The request cache
    _request_cache: HTTPRequestCache;
    /// The hasher
    _hasher: IHasher | null;

    /// Constructor
    constructor(store: DerivedReduxStore,cache_size: number = REQUEST_CACHE_SIZE) {
        this._store = store;
        this._request_cache = new HTTPRequestCache(store, cache_size);
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
        if (req.url) {
            hasher.update(req.url);
        }
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
