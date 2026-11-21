import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';
import type * as connection from '@akohn/dashql-jsonschema/connection.js';

import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { createRuntime } from '@akohn/dashql/runtime/runtime';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { CONNECTOR_INFOS } from '@akohn/dashql/platform/connections/connector_info';
import { connectionParamsOf } from '@akohn/dashql/platform/connections/connection_params';
import { TASK_UPDATE_SCHEDULER } from '@akohn/dashql/runtime/store/update_scheduler';
import type { HttpClient } from '@akohn/dashql/platform/http_client';
import { PlatformType } from '../../host/platform_type.js';
import { AppOAuthFlow } from '../../oauth/app_oauth_flow.js';
import type { PlatformEventListener } from '../../host/events/event_listener.js';
import { BASE64URL_CODEC } from '@akohn/dashql/platform/utils/base64';
import { DATA_CLOUD_JWT, fakeSalesforceHttp } from './salesforce_test_http.js';
import { mockSalesforceHttp, mockSalesforceOAuthFlow, type SalesforceConnectorMockConfig } from '@akohn/dashql/platform/connections/salesforce/salesforce_api_client_mock';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => vi.unstubAllGlobals());

/// A runtime whose setups send their requests with the HTTP client. The runtime speaks the Hyper of Salesforce itself,
/// the platform connects no channel.
function runtimeOf(http: HttpClient, oauthFlow: AppOAuthFlow) {
    const runtime = createRuntime({
        logger: new TestLogger(),
        scheduler: TASK_UPDATE_SCHEDULER,
        core: dql,
        http,
        oauthFlow,
        channels: { connect: () => Promise.reject(new Error('the runtime speaks the Hyper of Salesforce itself')) },
    });
    runtime.module.runCatalogLoader(false);
    return runtime;
}

for (const connector of [ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.DBCOM] as const) for (const exchangeFails of [false, true]) for (const databaseName of [undefined, 'sales']) describe(`the setup of ${ConnectorType[connector]} with exchange failure=${exchangeFails} and dbcom=${databaseName}`, () => {
    it('queries the Hyper of Data Cloud over http with the tokens of the login', async () => {
        const popup = { closed: false, focus: vi.fn(), close: vi.fn() };
        const open = vi.fn((_url: string | URL) => popup);
        vi.stubGlobal('open', open);
        const params = {
            instanceUrl: 'https://example.my.salesforce.com',
            appConsumerKey: 'consumer-key',
            appConsumerSecret: '',
            login: '',
            databaseName,
        } as connection.SalesforceConnectionParams;
        const http = fakeSalesforceHttp({ exchangeError: exchangeFails ? 'exchange failed' : null });
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
        const runtime = runtimeOf(http, new AppOAuthFlow(events as unknown as PlatformEventListener, PlatformType.WEB));
        const connectionParams = connectionParamsOf(CONNECTOR_INFOS[connector], params);
        runtime.createConnection({ connectorType: connector, setupParams: params, params: connectionParams }, 'salesforce');
        const outcome = await runtime.setupConnection('salesforce', { oauthRedirect: 'https://example.com/callback' });

        if (exchangeFails) {
            expect(outcome).toMatchObject({ status: 'failed', message: expect.stringContaining('exchange failed') });
            expect(http.paths).not.toContain('/api/v3/query');
            expect(http.paths).toContain('/services/a360/token');
            runtime.destroy();
            return;
        }
        // The probe of the health check is a query of the HTTP API of the tenant with the tokens of the login, the
        // fake answers it with 404
        const call = http.fetch.mock.calls.find(([input]) => new URL(input.toString()).pathname === '/api/v3/query')!;
        expect(String(call[0])).toBe('https://hyper.example.com/api/v3/query');
        const headers = new Headers(call[1]!.headers);
        expect(headers.get('audience')).toBe('tenant-id');
        expect(headers.get('authorization')).toBe(`Bearer ${DATA_CLOUD_JWT}`);
        const body = JSON.parse(String(call[1]!.body));
        expect(body.databases ?? []).toEqual(connector === ConnectorType.DBCOM
            ? [{ path: `hyper.cloud:${databaseName ?? 'default'}`, alias: 'lakehouse' }]
            : []);
        expect(outcome).toMatchObject({ status: 'failed' });
        const state = runtime.connection('salesforce')!;
        expect(state.connectionHealth).toBe(ConnectionHealth.FAILED);
        // The connection holds no channel of the platform
        expect(state.details.channel).toBeNull();
        runtime.destroy();
    });
});

describe('the setup of Salesforce', () => {
    const params = { instanceUrl: 'https://example.my.salesforce.com', appConsumerKey: 'key' } as connection.SalesforceConnectionParams;
    const create = (connector: ConnectorType) => {
        const runtime = runtimeOf({ fetch: () => Promise.reject(new Error('no network')) }, new AppOAuthFlow({} as never, PlatformType.WEB));
        runtime.createConnection({ connectorType: connector, setupParams: params, params: connectionParamsOf(CONNECTOR_INFOS[connector], params) }, 'salesforce');
        return runtime;
    };

    it('fails without the redirect page of the config', async () => {
        const runtime = create(ConnectorType.SALESFORCE_DATA_CLOUD);
        expect(await runtime.setupConnection('salesforce')).toMatchObject({ status: 'failed', message: expect.stringMatching(/oauth redirect/i) });
        expect(runtime.connection('salesforce')!.connectionHealth).toBe(ConnectionHealth.FAILED);
        runtime.destroy();
    });

    it('cancels a setup', async () => {
        const runtime = create(ConnectorType.DBCOM);
        const setup = runtime.setupConnection('salesforce', { oauthRedirect: 'https://dashql.app/oauth.html' });
        runtime.module.cancelSetup('salesforce');
        expect(await setup).toMatchObject({ status: 'cancelled' });
        expect(runtime.connection('salesforce')!.connectionHealth).not.toBe(ConnectionHealth.ONLINE);
        runtime.destroy();
    });
});

describe('the mock of Salesforce of the config', () => {
    const MOCK: SalesforceConnectorMockConfig = {
        enabled: true,
        coreAccess: { createdAt: '2026-01-01T00:00:00Z', accessToken: 'mock-core-token', instanceUrl: 'https://mock.my.salesforce.com', tokenType: 'Bearer' } as connection.SalesforceCoreAccessToken,
        coreUserInfo: { preferredUsername: 'mock@example.com' } as connection.SalesforceCoreUserInfo,
        dataCloudAccess: {
            createdAt: '2026-01-01T00:00:00Z',
            expiresAt: '2099-01-01T00:00:00Z',
            instanceUrl: 'https://mock.c360a.salesforce.com',
            tokenType: 'Bearer',
            jwt: { raw: '', header: { alg: 'none' }, payload: { exp: 4_070_908_800, audienceTenantId: 'mock-tenant' } },
        } as connection.SalesforceDataCloudAccessToken,
        dataCloudMetadata: {
            metadata: [{ name: 'Account__dlm', displayName: 'Account', category: 'Profile', primaryKeys: [], fields: [{ name: 'Id__c', displayName: 'Id', type: 'Text', businessType: 'Text' }] }],
        },
    };

    it('sets a connection up with the setup of the runtime, the requests answered from the config', async () => {
        const offline = { fetch: vi.fn(() => Promise.reject(new Error('no network'))) };
        const flow = { authorizeWithRedirectPage: vi.fn(), authorizeWithLoopback: vi.fn() } as unknown as AppOAuthFlow;
        const runtime = createRuntime({
            logger: new TestLogger(),
            scheduler: TASK_UPDATE_SCHEDULER,
            core: dql,
            http: mockSalesforceHttp(() => MOCK, offline),
            oauthFlow: mockSalesforceOAuthFlow(() => MOCK, flow),
        });
        runtime.module.runCatalogLoader(false);
        const params = { instanceUrl: 'https://mock.my.salesforce.com', appConsumerKey: 'key', appConsumerSecret: '', login: '' } as connection.SalesforceConnectionParams;
        const connector = CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
        runtime.createConnection({ connectorType: ConnectorType.SALESFORCE_DATA_CLOUD, setupParams: params, params: connectionParamsOf(connector, params) }, 'salesforce');
        const outcome = await runtime.setupConnection('salesforce', { oauthRedirect: 'https://dashql.app/oauth.html' });

        // The probe of the health check is a query of the Hyper of Data Cloud that the mock answers
        expect(outcome).toMatchObject({ status: 'succeeded' });
        expect(offline.fetch).not.toHaveBeenCalled();
        expect(flow.authorizeWithRedirectPage).not.toHaveBeenCalled();
        const state = runtime.connection('salesforce')!;
        expect(state.connectionHealth).toBe(ConnectionHealth.ONLINE);

        // The view summarizes the tokens, the runtime hands them out on request
        const oauthState = state.details.connector.kind === 'salesforce' ? state.details.connector.oauthState : null;
        expect(oauthState).toMatchObject({
            pkceGenerated: true,
            coreAccessToken: { instanceUrl: 'https://mock.my.salesforce.com', tokenType: 'Bearer' },
            dataCloudAccessToken: { instanceUrl: 'https://mock.c360a.salesforce.com/', tenantId: 'mock-tenant', tokenType: 'Bearer' },
        });
        expect(JSON.stringify(state)).not.toContain('mock-core-token');
        const secrets = runtime.module.revealConnectionSecrets('salesforce')!;
        expect(JSON.parse(secrets.coreAccessToken!).accessToken).toBe('mock-core-token');
        expect(JSON.parse(secrets.dataCloudAccessToken!).jwt.payload.audienceTenantId).toBe('mock-tenant');

        // The catalog loader fetches the metadata of the mock
        runtime.module.runCatalogLoader(true);
        await vi.waitFor(() => expect(runtime.connection('salesforce')!.catalogUpdates.tasksFinished).toHaveLength(1));
        expect(runtime.connection('salesforce')!.catalogUpdates.tasksFinished[0].error).toBeNull();

        // A reset forgets the tokens and the OAuth flow, the view and the secrets show none
        runtime.dispatch({ connection: 'salesforce' }, { kind: 'resetConnection' });
        const reset = runtime.connection('salesforce')!;
        expect(reset.details.connector.kind === 'salesforce' ? reset.details.connector.oauthState : 'other').toBeNull();
        expect(runtime.module.revealConnectionSecrets('salesforce')).toMatchObject({ coreAccessToken: null, dataCloudAccessToken: null });
        runtime.destroy();
    });
});
