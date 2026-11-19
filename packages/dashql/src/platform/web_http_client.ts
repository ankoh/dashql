import type { ClientOptions, HttpClient, HttpFetchResult } from './http_client.js';

/// The HTTP client of the browser and of Node: fetch, limited by CORS in the browser
export class WebHttpClient implements HttpClient {
    public async fetch(input: URL | Request | string, init?: RequestInit & ClientOptions): Promise<HttpFetchResult> {
        return await fetch(input, init);
    }
}
