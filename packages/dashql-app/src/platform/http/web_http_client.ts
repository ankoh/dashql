import { ClientOptions, HttpClient, HttpFetchResult } from './http_client.js';
import { applyHttpProxy, HttpProxyConfigHolder } from './http_proxy.js';
import { Logger } from '../logger/logger.js';

export class WebHttpClient implements HttpClient {
    logger: Logger;
    proxyConfig: HttpProxyConfigHolder;

    constructor(proxyConfig: HttpProxyConfigHolder, logger: Logger) {
        this.proxyConfig = proxyConfig;
        this.logger = logger;
    }
    public async fetch(input: URL | Request | string, init?: RequestInit & ClientOptions): Promise<HttpFetchResult> {
        const target = input instanceof URL
            ? input
            : input instanceof Request
                ? new URL(input.url)
                : new URL(input);
        const routed = applyHttpProxy(target, this.proxyConfig.get());
        if (routed.extraHeaders) {
            const headers = new Headers(init?.headers);
            for (const [k, v] of Object.entries(routed.extraHeaders)) {
                headers.set(k, v);
            }
            return await fetch(routed.url, { ...init, headers });
        }
        // No proxy rewrite, forward as-is
        if (input instanceof Request) {
            return await fetch(input, init);
        }
        return await fetch(routed.url, init);
    }
}
