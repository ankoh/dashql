import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { setupSalesforceConnection } from './salesforce_connection_setup.js';
import type { SalesforceApiClientInterface } from './salesforce_api_client.js';
import type { HyperDatabaseClient, HyperDatabaseConnectionContext } from '../hyper/hyperdb_grpc_client.js';
import { TestLogger } from '../../../../platform/logger/test_logger.js';
import { PlatformType } from '../../../../platform/platform_type.js';
import { BASE64URL_CODEC } from '../../../../utils/base64.js';

afterEach(() => vi.unstubAllGlobals());

describe('setupSalesforceConnection', () => {
    it.each(['V3_GRPC', 'V3_HTTP'] as const)('configures the Salesforce database for %s', async protocol => {
        let context: HyperDatabaseConnectionContext | undefined;
        const client: HyperDatabaseClient = {
            connect: vi.fn(async (_params, connectionContext) => {
                context = connectionContext;
                return { executeQuery: vi.fn(), close: vi.fn() } as any;
            }),
        };
        const popup = { closed: false, focus: vi.fn(), close: vi.fn() };
        const open = vi.fn((_url: string | URL) => popup);
        vi.stubGlobal('open', open);
        const params = {
            hyperProtocol: protocol,
            instanceUrl: 'https://example.my.salesforce.com',
            appConsumerKey: 'consumer-key',
            appConsumerSecret: '',
            login: '',
        } as connection.SalesforceConnectionParams;
        const api = {
            getCoreAccessToken: vi.fn().mockResolvedValue({ accessToken: 'core-token' }),
            getCoreUserInfo: vi.fn().mockResolvedValue({ preferredUsername: 'test@example.com' }),
            getDataCloudAccessToken: vi.fn().mockResolvedValue({
                instanceUrl: 'https://hyper.example.com',
                jwt: { raw: 'offcore-token', payload: { audienceTenantId: 'tenant-id' } },
            }),
        } as unknown as SalesforceApiClientInterface;
        const events = {
            waitForOAuthRedirect: vi.fn(async (_signal, matches) => {
                const url = new URL(open.mock.calls[0][0]);
                const encoded = url.searchParams.get('state')!;
                const state = JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(encoded)));
                const callback = { state, code: 'auth-code' };
                expect(matches(callback)).toBe(true);
                return callback;
            }),
        };
        await setupSalesforceConnection(
            vi.fn(),
            new TestLogger(),
            params,
            { auth: { oauthRedirect: 'https://example.com/callback' } },
            PlatformType.WEB,
            api,
            client,
            client,
            events as any,
            false,
            new AbortController().signal,
        );

        expect(context?.getAttachedDatabases()).toEqual(protocol === 'V3_HTTP' ? [] : [{
            path: 'sf:tenant-id;default',
            alias: 'sf',
        }]);
    });
});
