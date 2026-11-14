import { ClientOptions, HttpClient, HttpFetchResult } from '@ankoh/dashql-sdk/platform/http/http_client';
import { Logger } from '@ankoh/dashql-sdk/platform/logger/logger';

export class WebHttpClient implements HttpClient {
    logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }
    public async fetch(input: URL | Request | string, init?: RequestInit & ClientOptions): Promise<HttpFetchResult> {
        if (input instanceof Request) {
            return await fetch(input, init);
        }
        return await fetch(input, init);
    }
}
