import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { setupSalesforceConnection } from './salesforce_connection_setup.js';
import type { SalesforceApiClientInterface } from './salesforce_api_client.js';
import type { HyperDatabaseClient, HyperDatabaseConnectionContext } from '../hyper/hyperdb_grpc_client.js';
import { TestLogger } from '../../../platform/logger/test_logger.js';
import { PlatformType } from '../../../platform/platform_type.js';
import { BASE64URL_CODEC } from '../../../utils/base64.js';
import { SETUP_FAILED, SF_CHANNEL_READY } from './salesforce_connection_state.js';
import { ConnectorType } from '../connector_info.js';

afterEach(() => vi.unstubAllGlobals());

for (const connector of [ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.SIDB] as const) for (const exchangeFails of [false, true]) describe(`setupSalesforceConnection of ${ConnectorType[connector]} with exchange failure=${exchangeFails}`, () => {
    it('configures the Salesforce database over http', async () => {
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
            instanceUrl: 'https://example.my.salesforce.com',
            appConsumerKey: 'consumer-key',
            appConsumerSecret: '',
            login: '',
        } as connection.SalesforceConnectionParams;
        const coreToken: connection.SalesforceCoreAccessToken = {
            createdAt: new Date(0).toISOString(),
            accessToken: 'core-token',
            instanceUrl: params.instanceUrl,
        };
        const dataCloudToken: connection.SalesforceDataCloudAccessToken = {
            createdAt: new Date(0).toISOString(),
            expiresAt: new Date(7_200_000).toISOString(),
            instanceUrl: 'https://hyper.example.com/',
            jwt: {
                raw: 'offcore-token',
                header: { alg: 'RS256' },
                payload: {
                    exp: 7_200,
                    audienceTenantId: 'tenant-id',
                    customAttributes: { dataspace: 'analytics' },
                },
            },
        };
        const api = {
            getCoreAccessToken: vi.fn().mockResolvedValue(coreToken),
            getCoreUserInfo: vi.fn().mockResolvedValue({ preferredUsername: 'test@example.com', photos: {} }),
            getDataCloudAccessToken: exchangeFails
                ? vi.fn().mockRejectedValue(new Error('exchange failed'))
                : vi.fn().mockResolvedValue(dataCloudToken),
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
        const dispatch = vi.fn();
        const setup = setupSalesforceConnection(
            dispatch,
            new TestLogger(),
            connector,
            params,
            { auth: { oauthRedirect: 'https://example.com/callback' } },
            PlatformType.WEB,
            api,
            client,
            events as any,
            false,
            new AbortController().signal,
        );

        if (exchangeFails) {
            await expect(setup).rejects.toThrow('exchange failed');
            expect(client.connect).not.toHaveBeenCalled();
            expect(api.getDataCloudAccessToken).toHaveBeenCalledWith(coreToken, expect.any(AbortSignal));
            expect(dispatch).toHaveBeenLastCalledWith({ type: SETUP_FAILED, value: { message: expect.any(String) } });
            return;
        }
        const channel = await setup;
        expect(client.connect).toHaveBeenCalledWith(expect.objectContaining({
            protocol: 'V3_HTTP',
            endpoint: 'https://hyper.example.com/',
        }), context);
        expect(context?.getAttachedDatabases()).toEqual(connector === ConnectorType.SIDB
            ? [{ path: 'hyper.cloud:tenant-id', alias: 'lakehouse' }]
            : []);
        expect(await context?.getRequestMetadata()).toEqual({
            audience: 'tenant-id',
            authorization: 'Bearer offcore-token',
        });
        expect(channel.coreToken).toBe(coreToken);
        expect(channel.dataCloudToken).toBe(dataCloudToken);
        expect(params.login).toBe('');
        expect(dispatch).toHaveBeenLastCalledWith({ type: SF_CHANNEL_READY, value: channel });
    });
});
