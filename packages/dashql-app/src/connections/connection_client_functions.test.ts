import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';

import { ensureConnectionClientFunctions } from './connection_client_functions.js';
import { createConnectionState, reduceConnectionState, RESET_CONNECTION, SWITCH_CONNECTOR_TYPE, type ConnectionState } from './connection_state.js';
import { createConnectionStateDetails } from './connection_state_details.js';
import { CONNECTOR_INFOS, ConnectorType } from './connector_info.js';
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
