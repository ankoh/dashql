import { LRUCache } from "../utils/lru_cache";
import { IHasher, createSHA256 } from "../utils/hash";

const REQUEST_CACHE_SIZE = 64;

type HTTPProgressHandler = (res: Response, sig: string, receivedBytes: number) => void;

export interface HTTPData {
    /// The cache key
    key: string;
    /// The request
    request: Request;
    /// The request body (if any)
    requestBody: Uint8Array | null;
    /// The response
    response: Response;
}

/// A HTTP request cache
class HTTPRequestCache extends LRUCache<HTTPData> {
    /// Constructor
    constructor(size: number) {
        super(size);
    }

    /// Update handler
    onEvict(_slot: number, _next: HTTPData, _evicted: HTTPData | null): void {
        // XXX
    }
}

export class HTTPManager {
    /// The request cache
    _request_cache: HTTPRequestCache;
    /// The hasher
    _hasher: IHasher | null;

    /// Constructor
    constructor() {
        this._request_cache = new HTTPRequestCache(REQUEST_CACHE_SIZE);
        this._hasher = null;
    }

    /// Init the http manager
    public async init() {
        this._hasher = await createSHA256();
    }

    /// Hash a request
    protected hashRequest(req: Request, reqBody: Uint8Array | null): string {
        console.assert(this._hasher != null, "hasher must be initialized");
        let hasher = this._hasher!;
        hasher.init();
        hasher.update(req.url);
        req.headers.forEach((value: string, key: string) => {
            hasher.update(value);
            hasher.update(key);
        });
        if (reqBody) hasher.update(reqBody);
        return hasher.digest("hex");
    }

    /// Send a HTTP request
    public async fetch(req: Request, reqBody: Uint8Array | null, onProgress: HTTPProgressHandler): Promise<HTTPData> {
        const sig = this.hashRequest(req, reqBody);
        const cached = this._request_cache.find(sig);
        if (cached) return cached;

        // Send HTTP request
        const res = await fetch(req);
        if (res.body) {
            // Read response stream
            const reader = res.body.getReader();
            let chunkBytes = 0;
            for (let c = await reader.read(); c.done; c = await reader.read()) {
                chunkBytes += c.value!.length;
                onProgress(res, sig, chunkBytes);
            }
        }

        // Cache response
        return this._request_cache.insert({
            key: sig,
            request: req,
            requestBody: reqBody,
            response: res,
        });
    }
}
