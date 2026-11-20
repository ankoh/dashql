export interface ClientOptions {
    maxRedirections?: number;
    connectTimeout?: number;
    /// The request or its response carries credentials, e.g. a token request: a log keeps no record of their bodies
    /// and of the values of their credential headers
    sensitive?: boolean;
}

/// A `Response` subset that is also implemented by our native http proxy
export interface HttpFetchResult {
    headers: Headers,
    status: number,
    statusText: string,

    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<unknown>;
    text(): Promise<string>;
}

/// An abstract http client
export interface HttpClient {
    fetch(input: URL | Request | string, init?: RequestInit & ClientOptions): Promise<HttpFetchResult>;
}
