import { describe, expect, it } from 'vitest';
import type * as core from '@ankoh/dashql-core';

import { connectionCatalogIsDurable, type ConnectionParams } from './connection_params.js';
import { connectionMaxConcurrentQueries, connectionReadsAttachments, connectorOfParams, connectorParams } from './connector_descriptor.js';

const embedded: ConnectionParams = { hyper: { protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } };
const server: ConnectionParams = { hyper: { protocol: 'V3_GRPC', endpoint: 'http://localhost:7484', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } } as ConnectionParams;
const trino: ConnectionParams = { trino: { endpoint: 'https://trino.example', catalogName: 'c', schemaNames: [] } } as unknown as ConnectionParams;

/// The connector and the details of a connection whose setup started with params, as the runtime shows them
function connectionOf(params: ConnectionParams): { connectorType: number; details: core.ConnectionDetailsView } {
    const connector = connectorOfParams(params);
    const setupParams = connectorParams(connector, params) as unknown as Record<string, unknown>;
    const details = { setupTimings: {}, setupParams, channelError: null, healthCheckError: null, channel: null, connector: { kind: 'hyper' } } as core.ConnectionDetailsView;
    return { connectorType: connector.info.connectorType, details };
}

describe('connector capabilities', () => {
    it('runs statements of a Hyper server in parallel and the embedded Hyper one at a time', () => {
        expect(connectionMaxConcurrentQueries(connectionOf(server))).toBe(4);
        expect(connectionMaxConcurrentQueries(connectionOf(embedded))).toBe(1);
        expect(connectionMaxConcurrentQueries(connectionOf(trino))).toBe(1);
        expect(connectionMaxConcurrentQueries(null)).toBe(1);
    });

    it('keeps the catalogs of all connections but the embedded Hyper', () => {
        expect(connectionCatalogIsDurable(embedded)).toBe(false);
        expect(connectionCatalogIsDurable(server)).toBe(true);
        expect(connectionCatalogIsDurable(trino)).toBe(true);
    });

    it('reads the attachments of a workbook only in the embedded Hyper', () => {
        expect(connectionReadsAttachments(connectionOf(embedded))).toBe(true);
        expect(connectionReadsAttachments(connectionOf(server))).toBe(false);
        expect(connectionReadsAttachments(connectionOf(trino))).toBe(false);
        expect(connectionReadsAttachments(null)).toBe(false);
    });
});
