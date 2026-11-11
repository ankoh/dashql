import { describe, expect, it } from 'vitest';

import { createLocalCloudParams, findCloudConnection, isCloudCapable, isLocalCloud, LOCAL_CLOUD_DATABASE } from './cloud_connection.js';
import { isHyperWasmConnection } from './connection_label.js';
import { getConnectionStateDetailsFromParams } from './connection_params.js';
import { isLocalHyperWasmParams } from '../storage/workbook_validation.js';
import type { ConnectionState } from './connection_state.js';

describe('cloud connection', () => {
    it('is a Hyper server that the user logs in to, Database.com or the local cloud', () => {
        expect(isCloudCapable({ hyper: { protocol: 'V3_HTTP', endpoint: 'http://localhost:7484' } } as any)).toBe(true);
        expect(isCloudCapable({ hyper: { protocol: 'V3_GRPC', endpoint: 'http://localhost:7483' } } as any)).toBe(true);
        expect(isCloudCapable({ dbcom: { instanceUrl: 'https://example.my.salesforce.com' } } as any)).toBe(true);
        // The local cloud attaches a database of this browser, the embedded Hyper keeps its own until the window closes
        expect(isCloudCapable(createLocalCloudParams())).toBe(true);
        expect(isLocalCloud(createLocalCloudParams())).toBe(true);
        expect(isCloudCapable({ hyper: {} } as any)).toBe(false);
        expect(isCloudCapable({ hyper: { protocol: 'WASM' } } as any)).toBe(false);
        expect(isLocalCloud({ hyper: { protocol: 'V3_HTTP', attachedDatabases: [LOCAL_CLOUD_DATABASE] } } as any)).toBe(false);
        // The token of a Hyper link lives in its tab
        expect(isCloudCapable({ hyper: { protocol: 'V3_HTTP_LINK', endpoint: 'http://127.0.0.1:7484' } } as any)).toBe(false);
        // Salesforce Data Cloud and Trino don't write
        expect(isCloudCapable({ salesforce: { instanceUrl: 'https://example.my.salesforce.com' } } as any)).toBe(false);
        expect(isCloudCapable({ trino: { endpoint: 'https://trino.example' } } as any)).toBe(false);
        expect(isCloudCapable(null)).toBe(false);
    });

    it('is found by its id among the connections', () => {
        const connection = { connectionId: 'c1' } as ConnectionState;
        const connections = new Map([['c1', connection]]);
        expect(findCloudConnection(connections, 'c1')).toBe(connection);
        expect(findCloudConnection(connections, 'gone')).toBeNull();
        expect(findCloudConnection(connections, null)).toBeNull();
    });

    it('makes the local cloud a connection of its own, not the embedded Hyper', () => {
        const local = createLocalCloudParams();
        const embedded = { hyper: { protocol: 'WASM' } } as any;
        // Workbooks that name the embedded Hyper don't take the local cloud for it
        expect(isLocalHyperWasmParams(local as any)).toBe(false);
        expect(isLocalHyperWasmParams(embedded)).toBe(true);
        const connection = (params: any) => ({ details: getConnectionStateDetailsFromParams(params) }) as ConnectionState;
        expect(isHyperWasmConnection(connection(local))).toBe(false);
        expect(isHyperWasmConnection(connection(embedded))).toBe(true);
    });
});
