import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';

import type { ConnectionState, ConnectionStateWithoutId } from './connection_state.js';
import { createAttachedConnectionParamsForConnector, createConnectionStateFromParams, createDefaultHyperWasmConnectionState } from './connection_params.js';
import { CONNECTOR_INFOS, ConnectorType } from './connector_info.js';
import { embeddedConnection, findEmbeddedConnection, newSessionConnection } from './embedded_connection.js';
import { createHyperLinkConnectionParams } from '../hyper_link/hyper_link.js';
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

describe('new session connection', () => {
    const embedded = () => ({ ...createDefaultHyperWasmConnectionState(dql), connectionId: 'embedded' });
    const linked = () => ({ ...createConnectionStateFromParams(dql, createHyperLinkConnectionParams('http://127.0.0.1:7484')), connectionId: 'linked' });

    it('starts new sessions on the embedded Hyper without a link', () => {
        const connection = embedded();
        expect(newSessionConnection(new Map([['embedded', connection], ['linked', linked()]]), allocator(), dql, null)).toBe(connection);
    });

    it('starts new sessions on the connection of the latest link of the tab', () => {
        const connection = linked();
        const allocate = allocator();
        expect(newSessionConnection(new Map([['embedded', embedded()], ['linked', connection]]), allocate, dql, 'linked')).toBe(connection);
        expect(allocate).not.toHaveBeenCalled();
    });

    it('falls back to the embedded Hyper when the connection of the link is gone', () => {
        const connection = embedded();
        expect(newSessionConnection(new Map([['embedded', connection]]), allocator(), dql, 'deleted')).toBe(connection);
    });
});
