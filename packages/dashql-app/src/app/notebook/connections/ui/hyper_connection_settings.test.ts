import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import {
    buildHyperConnectionPageState,
    buildHyperConnectionSetupParams,
} from './hyper_connection_settings.js';

describe('Hyper connection settings', () => {
    it('preserves restored mTLS paths and gRPC metadata in setup params', () => {
        const params = {
            protocol: 'V3_GRPC',
            endpoint: 'https://hyper.example.com:443',
            tls: {
                clientKeyPath: '/certs/client.key',
                clientCertPath: '/certs/client.pem',
                caCertsPath: '/certs/ca.pem',
            },
            attachedDatabases: [],
            metadata: { 'ctx-tenant-id': 'tenant-123' },
            queryParameters: {},
        } as connection.HyperConnectionParams;

        const setupParams = buildHyperConnectionSetupParams(buildHyperConnectionPageState(params));

        expect(setupParams.tls).toEqual(params.tls);
        expect(setupParams.metadata).toEqual(params.metadata);
    });

    it('reads metadata persisted with the legacy details wrapper', () => {
        const params = {
            protocol: 'V3_GRPC',
            endpoint: 'https://hyper.example.com:443',
            tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
            metadata: { details: { 'ctx-tenant-id': 'tenant-123' } },
        } as unknown as connection.HyperConnectionParams;

        const setupParams = buildHyperConnectionSetupParams(buildHyperConnectionPageState(params));

        expect(setupParams.metadata).toEqual({ 'ctx-tenant-id': 'tenant-123' });
    });
});
