import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@akohn/dashql';

import type { ConnectionState, NewConnection } from '@akohn/dashql/platform/connections/connection_state';
import { createAttachedConnectionParamsForConnector, newConnectionFromParams, newDefaultHyperWasmConnection, type ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { embeddedConnection, findEmbeddedConnection, newWorkbookConnection } from './embedded_connection.js';
import type { Runtime } from '@akohn/dashql/runtime';
import { testRuntime } from '@akohn/dashql/runtime/testing/test_runtime';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;
let runtime: Runtime;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
beforeEach(() => { runtime = testRuntime(dql); });
afterEach(() => {
    vi.restoreAllMocks();
    runtime.destroy();
});

/// Create connections in the runtime with ids in call order
function allocator() {
    let next = 0;
    return vi.fn((connection: NewConnection): ConnectionState => runtime.createConnection(connection, `allocated-${next++}`));
}

describe('embedded connection', () => {
    it('reuses the known connection to the embedded Hyper', () => {
        const server = runtime.createConnection(newConnectionFromParams(createAttachedConnectionParamsForConnector(dql, CONNECTOR_INFOS[ConnectorType.HYPER])), 'server');
        const embedded = runtime.createConnection(newDefaultHyperWasmConnection(), 'embedded');
        const allocate = allocator();
        expect(findEmbeddedConnection([server])).toBeNull();
        expect(embeddedConnection([server, embedded], allocate)).toBe(embedded);
        expect(allocate).not.toHaveBeenCalled();
    });

    it('allocates an active connection to the embedded Hyper when none is known', () => {
        const allocate = allocator();
        const connection = embeddedConnection([], allocate);
        expect(allocate).toHaveBeenCalledTimes(1);
        expect(connection.active).toBe(true);
        expect(connection.embedded).toBe(true);
    });
});

describe('new workbook connection', () => {
    const connections = () => {
        const embedded = runtime.createConnection(newDefaultHyperWasmConnection(), 'embedded');
        const linked = runtime.createConnection(newConnectionFromParams({ hyper: { protocol: 'V3_HTTP_LINK', endpoint: 'http://127.0.0.1:7484', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } } as ConnectionParams), 'linked');
        const cloud = runtime.createConnection(newConnectionFromParams({ hyper: { protocol: 'V3_HTTP', endpoint: 'http://localhost:7484', tls: {} } } as ConnectionParams), 'cloud');
        return { embedded, linked, cloud, all: new Map([['embedded', embedded], ['linked', linked], ['cloud', cloud]]) };
    };

    it('starts new workbooks on the embedded Hyper without a link, also with a cloud', () => {
        const { embedded, all } = connections();
        expect(newWorkbookConnection(all, allocator(), null)).toBe(embedded);
    });

    it('starts new workbooks on the connection of the latest link of the tab', () => {
        const { linked, all } = connections();
        const allocate = allocator();
        expect(newWorkbookConnection(all, allocate, 'linked')).toBe(linked);
        expect(allocate).not.toHaveBeenCalled();
    });

    it('falls back to the embedded Hyper when the connection of the link is gone', () => {
        const { embedded } = connections();
        expect(newWorkbookConnection(new Map([['embedded', embedded]]), allocator(), 'deleted')).toBe(embedded);
    });
});
