import { vi } from 'vitest';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { setupHyperConnection } from './hyper_connection_setup.js';
import { HyperDatabaseChannel, HyperDatabaseClient, HyperDatabaseConnectionContext } from './hyperdb_grpc_client.js';
import { TestLogger } from '../../../../platform/logger/test_logger.js';

describe('Hyper connection setup', () => {
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

        await setupHyperConnection(
            vi.fn(),
            new TestLogger(),
            params,
            {},
            client,
            null,
            vi.fn(),
            new AbortController().signal,
        );

        expect(capturedContext).not.toBeNull();
        expect(await capturedContext!.getRequestMetadata()).toEqual({ 'ctx-tenant-id': 'tenant-123' });
    });

    it('normalizes metadata persisted with the legacy details wrapper', async () => {
        let capturedContext: HyperDatabaseConnectionContext | null = null;
        const client: HyperDatabaseClient = {
            connect: vi.fn(async (_params, context) => {
                capturedContext = context;
                return { close: vi.fn() } as unknown as HyperDatabaseChannel;
            }),
        };
        const params = {
            protocol: 'V3_GRPC',
            endpoint: 'https://hyper.example.com:443',
            tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
            metadata: { details: { 'ctx-tenant-id': 'tenant-123' } },
        } as unknown as connection.HyperConnectionParams;

        await setupHyperConnection(
            vi.fn(),
            new TestLogger(),
            params,
            {},
            client,
            null,
            vi.fn(),
            new AbortController().signal,
        );

        expect(await capturedContext!.getRequestMetadata()).toEqual({ 'ctx-tenant-id': 'tenant-123' });
    });
});
