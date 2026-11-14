import { vi } from 'vitest';

import { TrinoApiClient, TrinoApiEndpoint } from '@ankoh/dashql-sdk/connections/trino/trino_api_client';
import { TestLogger } from '@ankoh/dashql-sdk/testing/test_logger';

/// A Trino endpoint with basic auth of `user` and an API client whose HTTP client answers every request with the response
export function basicTrinoApi(response: () => Response) {
    const fetch = vi.fn(async (_input: URL | Request | string, _init?: RequestInit) => response());
    const endpoint = new TrinoApiEndpoint('https://trino.example.com', { authType: 'AUTH_BASIC', basic: { username: 'user', secret: 'secret' } } as never);
    return { fetch, endpoint, client: new TrinoApiClient(new TestLogger(), { fetch }) };
}
