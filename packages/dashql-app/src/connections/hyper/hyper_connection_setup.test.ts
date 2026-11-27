import { vi } from 'vitest';
import * as connection from '@akohn/dashql-jsonschema/connection.js';

import { connectChannel, type ChannelClients } from './hyper_connection_setup.js';
import { HyperDatabaseChannel, HyperDatabaseClient } from '@akohn/dashql/platform/connections/hyper/hyperdb_grpc_client';
import { connectionClientContext } from '@akohn/dashql/platform/connections/hyper/hyper_client_context';
import type { EmbeddedClientContext, EmbeddedComputeDatabase } from '@akohn/dashql/platform/embedded_database';

/// The clients of a test, none by default
function clients(overrides: Partial<ChannelClients>): ChannelClients {
    return { grpcClient: null, setupEmbeddedDatabase: vi.fn(), ...overrides };
}

// The runtime sets up the connections and asks the app to connect their channels
describe('Hyper channels of the setups', () => {
    it('connects the embedded Hyper on a session of the embedded database', async () => {
        const session = {};
        const embedded = { connect: vi.fn(async () => session) };
        const params = { protocol: 'WASM', endpoint: '' } as connection.HyperConnectionParams;
        const channel = await connectChannel(clients({ setupEmbeddedDatabase: vi.fn(async () => embedded as unknown as EmbeddedComputeDatabase) }), 'memory', { type: 'hyper', kind: 'embedded', params, session: { defaultDatabase: 'hyper', attachedDatabases: [] } });
        expect(channel).toBeInstanceOf(Object);
        expect(embedded.connect).toHaveBeenCalledWith(expect.objectContaining({ defaultDatabase: 'hyper', clientContext: connectionClientContext('memory') }));
    });

    it('connects the gRPC client with the params and the client context', async () => {
        const channel = { close: vi.fn() } as unknown as HyperDatabaseChannel;
        let captured: [connection.HyperConnectionParams, EmbeddedClientContext | null] | null = null;
        const client: HyperDatabaseClient = {
            connect: vi.fn(async (params, context) => {
                captured = [params, context];
                return channel;
            }),
        };
        const params = {
            protocol: 'V3_GRPC',
            endpoint: 'https://hyper.example.com:443',
            tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
            metadata: { 'ctx-tenant-id': 'tenant-123' },
        } as connection.HyperConnectionParams;

        // The runtime hands the app a copy of the params
        expect(await connectChannel(clients({ grpcClient: client }), 'connection-1', { type: 'hyper', kind: 'grpc', session: null, params: structuredClone(params) })).toBe(channel);
        expect(captured).not.toBeNull();
        params.metadata!['ctx-tenant-id'] = 'edited-after-setup';
        expect(captured![0].metadata).toEqual({ 'ctx-tenant-id': 'tenant-123' });
        expect(captured![1]).toEqual(connectionClientContext('connection-1'));
    });

    it('fails without a client of the protocol', async () => {
        const params = { protocol: 'V3_GRPC', endpoint: 'https://hyper.example.com' } as connection.HyperConnectionParams;
        await expect(connectChannel(clients({}), 'connection-1', { type: 'hyper', kind: 'grpc', session: null, params })).rejects.toThrow('gRPC client is not available');
    });
});
