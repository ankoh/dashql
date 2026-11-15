import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as arrow from 'apache-arrow';
import * as dashql from '@ankoh/dashql-core';

import type { QueryExecutionResponseStream } from '../query/query_execution_state.js';
import { AsyncConsumerLambdas } from '../utils/async_consumer.js';
import { executeConnectionClientFunction } from './connection_client_functions.js';
import type { ConnectionStateDetailsVariant } from './connection_state_details.js';
import { createConnectionStateDetails } from './connection_state_details.js';
import { ConnectorType, SALESFORCE_DATA_CLOUD_CONNECTOR } from './connector_info.js';
import { TestLogger } from '../testing/test_logger.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;
const logger = new TestLogger();

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

describe('A client function call of a connection', () => {
    const SALESFORCE = {
        type: SALESFORCE_DATA_CLOUD_CONNECTOR,
        value: {
            channel: {
                coreToken: { accessToken: 'core-token', instanceUrl: 'https://org.my.salesforce.com' },
                dataCloudToken: { instanceUrl: 'https://tenant.c360a.salesforce.com/', jwt: { raw: 'tenant-jwt' } },
            },
        },
    } as unknown as ConnectionStateDetailsVariant;
    const call = (name: string, options: Record<string, unknown> = {}, explain = false) => ({ namespace: 'cdp', function: name, effect: 'read' as const, explain, options });
    const services = (body: unknown = { segments: [{ apiName: 'Vip' }] }) => {
        const fetch = vi.fn(async (_input: URL | Request | string, _init?: RequestInit) => new Response(JSON.stringify(body)));
        return { http: { fetch }, logger, fetch };
    };
    const read = async (stream: QueryExecutionResponseStream) => {
        const batches: arrow.RecordBatch[] = [];
        await stream.produce(new AsyncConsumerLambdas((_, batch) => { batches.push(batch); }), new AsyncConsumerLambdas(() => {}));
        return new arrow.Table(batches);
    };

    it('sends the request of the spec to its host with its token', async () => {
        const s = services();
        const table = await read(await executeConnectionClientFunction(SALESFORCE, call('segment_list', { batch_size: 10 }), s));
        expect(s.fetch.mock.calls[0][0].toString()).toEqual('https://org.my.salesforce.com/services/data/v68.0/ssot/segments?batchSize=10');
        expect(new Headers(s.fetch.mock.calls[0][1]!.headers).get('Authorization')).toEqual('Bearer core-token');
        expect(table.getChild('api_name')!.get(0)).toEqual('Vip');
    });

    it('prints a request without a login and sends nothing', async () => {
        const s = services();
        const offline = { ...SALESFORCE, value: { channel: null } } as unknown as ConnectionStateDetailsVariant;
        const table = await read(await executeConnectionClientFunction(offline, call('segment_delete', { segment_api_name: 'Vip' }, true), s));
        expect(s.fetch).not.toHaveBeenCalled();
        expect(table.getChild('method')!.get(0)).toEqual('DELETE');
        expect(table.getChild('path')!.get(0)).toEqual('/services/data/v68.0/ssot/segments/Vip');
    });

    it('fails without a login', async () => {
        const offline = { ...SALESFORCE, value: { channel: null } } as unknown as ConnectionStateDetailsVariant;
        await expect(executeConnectionClientFunction(offline, call('segment_list'), services())).rejects.toThrow(/not set up/);
    });

    it('sends a write, such as creating a connection', async () => {
        const s = services({ id: '0Xx000000000001', name: 'snowflake_prod' });
        const create = { ...call('connection_create', { connector_type: 'SNOWFLAKE', label: 'Snowflake prod', name: 'snowflake_prod', method: 'Ingress' }), effect: 'write' as const };
        const table = await read(await executeConnectionClientFunction(SALESFORCE, create, s));
        const [url, init] = s.fetch.mock.calls[0];
        expect([init!.method, url.toString()]).toEqual(['POST', 'https://org.my.salesforce.com/services/data/v68.0/ssot/connections']);
        expect(JSON.parse(init!.body as string)).toEqual({ connectorType: 'SNOWFLAKE', label: 'Snowflake prod', name: 'snowflake_prod', method: 'Ingress' });
        expect(table.getChild('_status')!.get(0)).toEqual(200);
    });

    it('fails on a connector without the namespace', async () => {
        const hyper = createConnectionStateDetails(ConnectorType.HYPER);
        await expect(executeConnectionClientFunction(hyper, call('segment_list'), services())).rejects.toThrow(/no client functions/);
        await expect(executeConnectionClientFunction(SALESFORCE, { ...call('x'), namespace: 'other' }, services())).rejects.toThrow(/no client functions in other/);
    });
});
