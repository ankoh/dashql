import { describe, expect, it } from 'vitest';

import { connectionCatalogIsDurable, getConnectionStateDetailsFromParams, type ConnectionParams } from './connection_params.js';
import { connectionReadsAttachments, connectorOfDetails } from './connector_descriptor.js';

const embedded: ConnectionParams = { hyper: { protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } };
const server: ConnectionParams = { hyper: { protocol: 'V3_GRPC', endpoint: 'http://localhost:7484', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } } as ConnectionParams;
const trino: ConnectionParams = { trino: { endpoint: 'https://trino.example', catalogName: 'c', schemaNames: [] } } as unknown as ConnectionParams;

describe('connector capabilities', () => {
    it('runs statements of a Hyper server in parallel and the embedded Hyper one at a time', () => {
        const concurrency = (params: ConnectionParams) => {
            const details = getConnectionStateDetailsFromParams(params);
            return connectorOfDetails(details).maxConcurrentQueries(details.value);
        };
        expect(concurrency(server)).toBe(4);
        expect(concurrency(embedded)).toBe(1);
        expect(concurrency(trino)).toBe(1);
    });

    it('keeps the catalogs of all connections but the embedded Hyper', () => {
        expect(connectionCatalogIsDurable(embedded)).toBe(false);
        expect(connectionCatalogIsDurable(server)).toBe(true);
        expect(connectionCatalogIsDurable(trino)).toBe(true);
    });

    it('reads the attachments of a session only in the embedded Hyper', () => {
        expect(connectionReadsAttachments(getConnectionStateDetailsFromParams(embedded))).toBe(true);
        expect(connectionReadsAttachments(getConnectionStateDetailsFromParams(server))).toBe(false);
        expect(connectionReadsAttachments(getConnectionStateDetailsFromParams(trino))).toBe(false);
        expect(connectionReadsAttachments(null)).toBe(false);
    });
});
