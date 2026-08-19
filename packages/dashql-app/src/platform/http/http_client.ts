export interface ClientOptions {
    maxRedirections?: number;
    connectTimeout?: number;
}

/// A `Response` subset that is also implemented by our native http proxy
export interface HttpFetchResult {
    headers: Headers,
    status: number,
    statusText: string,

    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<any>;
    text(): Promise<string>;
}

/// An abstract http client
export interface HttpClient {
    fetch(input: URL | Request | string, init?: RequestInit & ClientOptions): Promise<HttpFetchResult>;
}

export const B3_TRACE_ID_HEADER = "x-b3-traceid";
export const B3_SPAN_ID_HEADER = "x-b3-spanid";

/// Adds a B3 trace id to every request made by the wrapped client.
export class B3TraceHttpClient implements HttpClient {
    constructor(private readonly inner: HttpClient) { }

    public fetch(input: URL | Request | string, init?: RequestInit & ClientOptions): Promise<HttpFetchResult> {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        if (!headers.has(B3_TRACE_ID_HEADER)) {
            headers.set(B3_TRACE_ID_HEADER, crypto.randomUUID().replace(/-/g, ''));
        }
        if (!headers.has(B3_SPAN_ID_HEADER)) {
            headers.set(B3_SPAN_ID_HEADER, crypto.randomUUID().replace(/-/g, '').slice(0, 16));
        }
        return this.inner.fetch(input, { ...init, headers });
    }
}
