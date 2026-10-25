import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';

import type { ConnectionState, ConnectionStateWithoutId } from './connection_state.js';
import { createAttachedConnectionParamsForConnector, createConnectionStateFromParams, createDefaultHyperWasmConnectionState } from './connection_params.js';
import { CONNECTOR_INFOS, ConnectorType } from './connector_info.js';
import { embeddedConnection, findEmbeddedConnection } from './embedded_connection.js';
import { isHyperWasmConnection } from './ui/connection_label.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    vi.restoreAllMocks();
    dql.resetUnsafe();
});

/// Allocate connections with ids in call order
function allocator() {
    let next = 0;
    return vi.fn((state: ConnectionStateWithoutId): ConnectionState => ({ ...state, connectionId: `allocated-${next++}` }));
}

describe('embedded connection', () => {
    it('reuses the known connection to the embedded Hyper', () => {
        const server = { ...createConnectionStateFromParams(dql, createAttachedConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.HYPER])), connectionId: 'server' };
        const embedded = { ...createDefaultHyperWasmConnectionState(dql), connectionId: 'embedded' };
        const allocate = allocator();
        expect(findEmbeddedConnection([server])).toBeNull();
        expect(embeddedConnection([server, embedded], allocate, dql)).toBe(embedded);
        expect(allocate).not.toHaveBeenCalled();
    });

    it('allocates an active connection to the embedded Hyper when none is known', () => {
        const allocate = allocator();
        const connection = embeddedConnection([], allocate, dql);
        expect(allocate).toHaveBeenCalledTimes(1);
        expect(connection.active).toBe(true);
        expect(isHyperWasmConnection(connection)).toBe(true);
    });
});
