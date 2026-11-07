import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as arrow from 'apache-arrow';
import * as dashql from '@ankoh/dashql-core';

import type { QueryExecutionResponseStream } from '../query/query_execution_state.js';
import { AsyncConsumerLambdas } from '../utils/async_consumer.js';
import { executeConnectionClientFunction, ensureConnectionClientFunctions } from './connection_client_functions.js';
import type { ConnectionStateDetailsVariant } from './connection_state_details.js';
import { createConnectionState, reduceConnectionState, RESET_CONNECTION, SWITCH_CONNECTOR_TYPE, type ConnectionState } from './connection_state.js';
import { createConnectionStateDetails } from './connection_state_details.js';
import { CONNECTOR_INFOS, ConnectorType, SALESFORCE_DATA_CLOUD_CONNECTOR } from './connector_info.js';
import { TestLogger } from '../platform/logger/test_logger.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;
const logger = new TestLogger();

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

function connection(type: ConnectorType): ConnectionState {
    return { ...createConnectionState(dql, CONNECTOR_INFOS[type], createConnectionStateDetails(type)), connectionId: 'c' };
}

/// The calls in the namespace of the Data 360 client functions
function calls(state: ConnectionState): number {
    const script = dql.createScript(state.catalog);
    script.insertTextAt(0, 'call cdp.segment_list ();');
    script.analyze();
    return script.getAnalyzed().read().clientFunctionCallsLength();
}

/// Register the client functions of a connection and wait for the spec
async function sync(connections: Map<string, ConnectionState>): Promise<ReturnType<typeof vi.fn>> {
    const onDidUpdate = vi.fn();
    ensureConnectionClientFunctions(connections, 'c', onDidUpdate, logger);
    await vi.waitFor(() => expect(onDidUpdate).toHaveBeenCalledWith('c'), { timeout: 5000 });
    return onDidUpdate;
}

describe('The client functions of a connection', () => {
    it('come with a Salesforce connection, before any login', async () => {
        const state = connection(ConnectorType.SALESFORCE_DATA_CLOUD);
        expect(calls(state)).toEqual(0);
        await sync(new Map([['c', state]]));
        expect(calls(state)).toEqual(1);

        const text = 'call cdp.segment_pub';
        const script = dql.createScript(state.catalog);
        script.insertTextAt(0, text);
        script.analyze();
        script.moveCursor(text.length);
        expect(script.completeAtCursor(10).read().candidates(0)!.completionText()).toEqual('segment_publish');
    });

    it('are registered once', async () => {
        const state = connection(ConnectorType.SALESFORCE_DATA_CLOUD);
        const connections = new Map([['c', state]]);
        const register = vi.spyOn(state.catalog, 'registerClientFunctions');
        const onDidUpdate = await sync(connections);
        ensureConnectionClientFunctions(connections, 'c', onDidUpdate as never, logger);
        expect(register).toHaveBeenCalledTimes(1);
        expect(onDidUpdate).toHaveBeenCalledTimes(1);
    });

    it('survive a reset of the connection', async () => {
        const state = connection(ConnectorType.SALESFORCE_DATA_CLOUD);
        await sync(new Map([['c', state]]));
        const next = reduceConnectionState(state, { type: RESET_CONNECTION, value: null }, logger);
        expect(next.catalog).toBe(state.catalog);
        expect(calls(next)).toEqual(1);
    });

    it('are dropped when the connection switches to a connector without them', async () => {
        const state = connection(ConnectorType.SALESFORCE_DATA_CLOUD);
        const connections = new Map([['c', state]]);
        await sync(connections);
        const next = reduceConnectionState(state, { type: SWITCH_CONNECTOR_TYPE, value: ConnectorType.TRINO }, logger);
        connections.set('c', next);
        const onDidUpdate = vi.fn();
        ensureConnectionClientFunctions(connections, 'c', onDidUpdate, logger);
        expect(onDidUpdate).toHaveBeenCalledWith('c');
        expect(calls(next)).toEqual(0);
    });

    it('do not reach a catalog that is gone by the time the spec loaded', async () => {
        const state = connection(ConnectorType.SALESFORCE_DATA_CLOUD);
        const connections = new Map([['c', state]]);
        const register = vi.spyOn(state.catalog, 'registerClientFunctions');
        const onDidUpdate = vi.fn();
        ensureConnectionClientFunctions(connections, 'c', onDidUpdate, logger);
        connections.delete('c');
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(register).not.toHaveBeenCalled();
        expect(onDidUpdate).not.toHaveBeenCalled();
    });

    it.each([ConnectorType.HYPER, ConnectorType.TRINO, ConnectorType.SIDB])('are not on connector %s', type => {
        const state = connection(type);
        const onDidUpdate = vi.fn();
        ensureConnectionClientFunctions(new Map([['c', state]]), 'c', onDidUpdate, logger);
        expect(onDidUpdate).not.toHaveBeenCalled();
        expect(calls(state)).toEqual(0);
    });
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

    it('sends no write', async () => {
        const s = services();
        await expect(executeConnectionClientFunction(SALESFORCE, call('segment_delete', { segment_api_name: 'Vip' }), s)).rejects.toThrow(/can only read/);
        expect(s.fetch).not.toHaveBeenCalled();
    });

    it('fails on a connector without the namespace', async () => {
        const hyper = createConnectionStateDetails(ConnectorType.HYPER);
        await expect(executeConnectionClientFunction(hyper, call('segment_list'), services())).rejects.toThrow(/no client functions/);
        await expect(executeConnectionClientFunction(SALESFORCE, { ...call('x'), namespace: 'other' }, services())).rejects.toThrow(/no client functions in other/);
    });
});
