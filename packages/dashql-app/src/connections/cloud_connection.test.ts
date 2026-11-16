import { describe, expect, it } from 'vitest';

import { cloudConnectionIdsOf, createLocalCloudParams, findCloudConnections, isCloudCapable, isLocalCloud } from './cloud_connection.js';
import { LOCAL_CLOUD_DATABASE } from '@ankoh/dashql-platform/connections/hyper/local_cloud';
import { isHyperWasmConnection } from './connection_label.js';
import { ConnectorType } from '@ankoh/dashql-platform/connections/connector_info';
import type { ConnectionState } from '@ankoh/dashql-platform/connections/connection_state';

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

    it('are found by their ids among the connections', () => {
        const c1 = { connectionId: 'c1' } as ConnectionState;
        const c2 = { connectionId: 'c2' } as ConnectionState;
        const connections = new Map([['c1', c1], ['c2', c2]]);
        expect(findCloudConnections(connections, ['c2', 'gone', 'c1'])).toEqual([c2, c1]);
        expect(findCloudConnections(connections, [])).toEqual([]);
    });

    it('reads the single cloud connection of earlier versions as the first cloud', () => {
        expect(cloudConnectionIdsOf(undefined)).toEqual([]);
        expect(cloudConnectionIdsOf({ cloudConnectionIds: ['a', 'b'] })).toEqual(['a', 'b']);
        expect(cloudConnectionIdsOf({ cloudConnectionIds: ['b', 'a', 'b'] })).toEqual(['b', 'a']);
    });

    it('makes the local cloud a connection of its own, not the embedded Hyper', () => {
        const local = createLocalCloudParams();
        const embedded = { hyper: { protocol: 'WASM' } } as any;
        // Workbooks that name the embedded Hyper don't take the local cloud for it (`is_local_hyper_wasm_params` of the
        // core, tested there)
        const connection = (params: any) => ({ connectorType: ConnectorType.HYPER, details: { setupParams: params.hyper } }) as unknown as ConnectionState;
        expect(isHyperWasmConnection(connection(local))).toBe(false);
        expect(isHyperWasmConnection(connection(embedded))).toBe(true);
    });
});
