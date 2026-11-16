import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@ankoh/dashql';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { SalesforceApiClient, SalesforceDatabaseChannel } from '@ankoh/dashql/platform/connections/salesforce/salesforce_api_client';
import type { HyperDatabaseClient, HyperDatabaseConnectionContext } from '@ankoh/dashql/platform/connections/hyper/hyperdb_grpc_client';
import { TestLogger } from '@ankoh/dashql/platform/testing/test_logger';
import { createRuntime } from '@ankoh/dashql/runtime/runtime';
import { ConnectionHealth } from '@ankoh/dashql/platform/connections/connection_state';
import { ConnectorType } from '@ankoh/dashql/platform/connections/connector_info';
import { connectionParamsOf, CONNECTOR_DESCRIPTORS } from '@ankoh/dashql/platform/connections/connector_descriptor';
import { TASK_UPDATE_SCHEDULER } from '@ankoh/dashql/runtime/store/store';
import type { HttpClient } from '@ankoh/dashql/platform/platform/http/http_client';
import { PlatformType } from '../../platform/platform_type.js';
import { AppOAuthFlow } from '../../oauth/app_oauth_flow.js';
import { BASE64URL_CODEC } from '@ankoh/dashql/platform/utils/base64';
import { connectChannel } from '../hyper/hyper_connection_setup.js';
import { DATA_CLOUD_JWT, fakeSalesforceHttp } from './salesforce_test_http.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => vi.unstubAllGlobals());

/// A runtime whose setups send their requests with the HTTP client and connect the Hyper of Salesforce with the client
function runtimeOf(http: HttpClient, client: HyperDatabaseClient | null, oauthFlow: AppOAuthFlow) {
    const salesforce = new SalesforceApiClient(new TestLogger(), http);
    const runtime = createRuntime({
        logger: new TestLogger(),
        scheduler: TASK_UPDATE_SCHEDULER,
        setupCore: dql,
        http,
        oauthFlow,
        channels: {
            connect: (connectionId, request) => connectChannel({
                grpcClient: null, httpClient: client, setupEmbeddedDatabase: vi.fn(), logMetrics: null, salesforce,
            }, connectionId, request),
        },
    });
    runtime.runCatalogLoader(false);
    return runtime;
}

for (const connector of [ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.DBCOM] as const) for (const exchangeFails of [false, true]) for (const databaseName of [undefined, 'sales']) describe(`the setup of ${ConnectorType[connector]} with exchange failure=${exchangeFails} and dbcom=${databaseName}`, () => {
    it('configures the Salesforce database over http', async () => {
        let context: HyperDatabaseConnectionContext | undefined;
        const client: HyperDatabaseClient = {
            connect: vi.fn(async (_params, connectionContext) => {
                context = connectionContext;
                return { executeQuery: vi.fn(async () => { throw new Error('no queries in this test'); }), close: vi.fn() } as any;
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
        const runtime = runtimeOf(http, client, new AppOAuthFlow(events as any, PlatformType.WEB));
        const connectionParams = connectionParamsOf(CONNECTOR_DESCRIPTORS[connector], params);
        runtime.createConnection({ connectorType: connector, setupParams: params, params: connectionParams }, 'salesforce');
        const outcome = await runtime.setupConnection('salesforce', { oauthRedirect: 'https://example.com/callback' });

        if (exchangeFails) {
            expect(outcome).toMatchObject({ status: 'failed', message: expect.stringContaining('exchange failed') });
            expect(client.connect).not.toHaveBeenCalled();
            expect(http.paths).toContain('/services/a360/token');
            runtime.destroy();
            return;
        }
        expect(client.connect).toHaveBeenCalledWith(expect.objectContaining({
            protocol: 'V3_HTTP',
            endpoint: 'https://hyper.example.com/',
        }), context);
        expect(context?.getAttachedDatabases()).toEqual(connector === ConnectorType.DBCOM
            ? [{ path: `hyper.cloud:${databaseName ?? 'default'}`, alias: 'lakehouse' }]
            : []);
        expect(await context?.getRequestMetadata()).toEqual({
            audience: 'tenant-id',
            authorization: `Bearer ${DATA_CLOUD_JWT}`,
        });
        const state = runtime.connection('salesforce')!;
        const channel = runtime.channel<SalesforceDatabaseChannel>(state)!;
        expect(channel.coreToken.accessToken).toBe('core-token');
        expect(channel.dataCloudToken.jwt.raw).toBe(DATA_CLOUD_JWT);
        expect(channel.dataCloudToken.instanceUrl).toBe('https://hyper.example.com/');
        // The probe of the health check runs on the channel, it fails in this test
        expect(outcome).toMatchObject({ status: 'failed', message: 'no queries in this test' });
        expect(state.connectionHealth).toBe(ConnectionHealth.FAILED);
        runtime.destroy();
    });
});

describe('the setup of Salesforce', () => {
    const params = { instanceUrl: 'https://example.my.salesforce.com', appConsumerKey: 'key' } as connection.SalesforceConnectionParams;
    const create = (connector: ConnectorType) => {
        const runtime = runtimeOf({ fetch: () => Promise.reject(new Error('no network')) }, null, new AppOAuthFlow({} as never, PlatformType.WEB));
        runtime.createConnection({ connectorType: connector, setupParams: params, params: connectionParamsOf(CONNECTOR_DESCRIPTORS[connector], params) }, 'salesforce');
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
        runtime.module?.cancelSetup('salesforce');
        expect(await setup).toMatchObject({ status: 'cancelled' });
        expect(runtime.connection('salesforce')!.connectionHealth).not.toBe(ConnectionHealth.ONLINE);
        runtime.destroy();
    });
});
