import { vi } from 'vitest';

import type { HttpClient, HttpFetchResult } from '@ankoh/dashql/platform/http_client';
import { BASE64URL_CODEC } from '@ankoh/dashql/platform/utils/base64';

// A fake Salesforce for the tests of the setup and the login: the core token, the user info and the Data Cloud token
// over the HTTP client, the requests that the setup of the Rust runtime sends.

function encodePart(value: object): string {
    return BASE64URL_CODEC.encode(new TextEncoder().encode(JSON.stringify(value)).buffer);
}

/// The raw Data Cloud JWT of the fake
export const DATA_CLOUD_JWT = `${encodePart({ alg: 'RS256' })}.${encodePart({
    exp: 7_200,
    audienceTenantId: 'tenant-id',
    customAttributes: { dataspace: 'analytics' },
})}.signature`;

export interface FakeSalesforceOptions {
    /// The user info, null if its request fails
    userInfo?: object | null;
    /// The Data Cloud exchange fails with this description
    exchangeError?: string | null;
    /// Called when the Data Cloud token is requested
    onExchange?: () => void;
}

function json(body: object, status = 200): HttpFetchResult {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/// An HTTP client that answers like Salesforce, it records the paths of the requests
export function fakeSalesforceHttp(options: FakeSalesforceOptions = {}) {
    const paths: string[] = [];
    const fetch = vi.fn(async (input: URL | Request | string, _init?: RequestInit): Promise<HttpFetchResult> => {
        const url = new URL(input.toString());
        paths.push(url.pathname);
        switch (url.pathname) {
            case '/services/oauth2/token':
                return json({ access_token: 'core-token', instance_url: url.origin, token_type: 'Bearer', issued_at: '0' });
            case '/services/oauth2/userinfo':
                return options.userInfo === null ? new Response('unavailable', { status: 503 }) : json(options.userInfo ?? { preferred_username: 'test@example.com' });
            case '/services/a360/token':
                options.onExchange?.();
                if (options.exchangeError != null) return json({ error: 'invalid_grant', error_description: options.exchangeError }, 400);
                return json({ access_token: DATA_CLOUD_JWT, instance_url: 'hyper.example.com', token_type: 'Bearer', expires_in: 7_200 });
            default:
                return new Response('not found', { status: 404 });
        }
    });
    return { fetch, paths } satisfies HttpClient & { paths: string[] };
}
