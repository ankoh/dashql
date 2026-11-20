import { vi } from 'vitest';
import * as connection from '@akohn/dashql-jsonschema/connection.js';

import { connectChannel, type ChannelClients } from './hyper_connection_setup.js';
import { HyperDatabaseChannel, HyperDatabaseClient, HyperDatabaseConnectionContext } from '@akohn/dashql/platform/connections/hyper/hyperdb_grpc_client';
import { connectionClientContext, type HyperLogMetrics } from './hyper_log_metrics.js';
import type { EmbeddedComputeDatabase } from '@akohn/dashql/platform/embedded_database';

/// The clients of a test, none by default
function clients(overrides: Partial<ChannelClients>): ChannelClients {
    return { grpcClient: null, setupEmbeddedDatabase: vi.fn(), logMetrics: null, ...overrides };
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

    it('provides configured gRPC metadata to the client context', async () => {
        const channel = { close: vi.fn() } as unknown as HyperDatabaseChannel;
        let capturedContext: HyperDatabaseConnectionContext | null = null;
        const client: HyperDatabaseClient = {
            connect: vi.fn(async (_params, context) => {
                capturedContext = context;
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
        expect(capturedContext).not.toBeNull();
        params.metadata!['ctx-tenant-id'] = 'edited-after-setup';
        expect(await capturedContext!.getRequestMetadata()).toEqual({ 'ctx-tenant-id': 'tenant-123' });
        expect(capturedContext!.getClientContext?.()).toEqual(connectionClientContext('connection-1'));
    });

    it('attributes the queries of a remote channel and monitors its log without sessions', async () => {
        const contexts: HyperDatabaseConnectionContext[] = [];
        const client: HyperDatabaseClient = {
            connect: vi.fn(async (_params, context) => {
                contexts.push(context);
                return { close: vi.fn() } as unknown as HyperDatabaseChannel;
            }),
        };
        const logMetrics = { watch: vi.fn() };
        const params = {
            protocol: 'V3_GRPC',
            endpoint: 'https://hyper.example.com',
            tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
        } as connection.HyperConnectionParams;

        await connectChannel(clients({ grpcClient: client, logMetrics: logMetrics as unknown as HyperLogMetrics }), 'connection-1', { type: 'hyper', kind: 'grpc', session: null, params });

        expect(contexts.map(context => context.getClientContext?.())).toEqual([connectionClientContext('connection-1')]);
        expect(logMetrics.watch).toHaveBeenCalledTimes(1);
        const [origin, connectionId] = logMetrics.watch.mock.calls[0];
        expect(connectionId).toBe('connection-1');
        expect(origin.sessions).toBe(false);
        // The monitor connects channels of its own, with its own client context
        await origin.database.connect({ clientContext: { dashql: { connectionId: 'connection-1', queryType: 'monitor' } } });
        expect(contexts[1].getClientContext?.()).toEqual({ dashql: { connectionId: 'connection-1', queryType: 'monitor' } });
    });

    it('fails without a client of the protocol', async () => {
        const params = { protocol: 'V3_GRPC', endpoint: 'https://hyper.example.com' } as connection.HyperConnectionParams;
        await expect(connectChannel(clients({}), 'connection-1', { type: 'hyper', kind: 'grpc', session: null, params })).rejects.toThrow('gRPC client is not available');
    });
});
