import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';

import { connectionMergeCandidates } from './connection_merge.js';
import { createDefaultConnectionParamsForConnector } from '@akohn/dashql/platform/connections/connection_params';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionRowMenu } from './connection_tree.js';
import { testConnectionTreeActions } from './connection_tree_test_actions.js';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const grpc = (endpoint: string, token?: string) => ({ hyper: { protocol: 'V3_GRPC', endpoint, ...(token ? { metadata: { auth: token } } : {}) } }) as ConnectionParams;
const trino = (endpoint: string) => ({ trino: { endpoint } }) as ConnectionParams;
/// The embedded database as exported workbooks store it
const wasm = () => ({ hyper: {
    protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
    attachedDatabases: [], metadata: {}, queryParameters: {},
} }) as ConnectionParams;

/// A connection as far as the merge looks at it
function database(connectionId: string, params: ConnectionParams, health = ConnectionHealth.NOT_STARTED, active = true): ConnectionState {
    const connectorType = 'hyper' in params ? ConnectorType.HYPER : ConnectorType.TRINO;
    return {
        connectionId,
        params,
        active,
        connectionHealth: health,
        connectorType,
        details: { setupParams: Object.values(params)[0], channel: null, connector: { kind: connectorType === ConnectorType.HYPER ? 'hyper' : 'trino' } },
        catalogUpdates: { currentFullRefresh: null, tasksRunning: [], refreshRunning: false, outOfDate: false },
        canRefresh: health === ConnectionHealth.ONLINE,
    } as unknown as ConnectionState;
}

/// The connections and their list as the runtime shows them. A connection is listed if it is active or a workbook
/// uses it.
function views(databases: ConnectionState[], used: readonly string[] = []) {
    const connectionsByType = CONNECTOR_TYPES.map((): string[] => []);
    for (const db of databases) connectionsByType[db.connectorType].push(db.connectionId);
    return {
        connections: new Map(databases.map(db => [db.connectionId, db])),
        list: {
            connections: databases.map(db => ({
                connectionId: db.connectionId,
                connectorType: db.connectorType,
                active: db.active,
                listed: db.active || used.includes(db.connectionId),
                ordinal: null,
            })),
            connectionsByType,
        } as unknown as core.ConnectionListView,
    };
}

describe('connectionMergeCandidates', () => {
    it('lists the listed connections that describe the same database', () => {
        const { connections, list } = views([
            database('target', grpc('http://hyper', 'one')),
            // Secrets don't tell connections apart
            database('same', grpc('http://hyper', 'two')),
            database('other-endpoint', grpc('http://elsewhere')),
            database('other-connector', trino('http://hyper')),
            // Inactive connections that no workbook uses are not listed
            database('unlisted', grpc('http://hyper'), ConnectionHealth.NOT_STARTED, false),
        ]);
        expect(connectionMergeCandidates(dql, connections, list, 'target').map(db => db.connectionId)).toEqual(['same']);
    });

    it('lists the embedded database of an imported workbook next to the default one', () => {
        const { connections, list } = views([
            database('default', createDefaultConnectionParamsForConnector(dql, CONNECTOR_INFOS[ConnectorType.HYPER]), ConnectionHealth.ONLINE),
            // Exported workbooks carry every list and map, even when empty
            database('example', wasm(), ConnectionHealth.ONLINE),
        ]);
        expect(connectionMergeCandidates(dql, connections, list, 'default').map(db => db.connectionId)).toEqual(['example']);
    });

    it('lists unlisted connections once workbooks use them', () => {
        const { connections, list } = views([database('target', grpc('http://hyper')), database('used', grpc('http://hyper'), ConnectionHealth.NOT_STARTED, false)], ['used']);
        expect(connectionMergeCandidates(dql, connections, list, 'target').map(db => db.connectionId)).toEqual(['used']);
        expect(connectionMergeCandidates(dql, connections, list, 'missing')).toEqual([]);
    });
});

describe('connection merge ui', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('offers merging in the row menu only when there are duplicates', () => {
        const merge = vi.fn();
        const render = (mergeCandidateCount: number) => {
            act(() => root.render(
                <ConnectionRowMenu
                    database={database('target', grpc('http://hyper'))}
                    label="Hyper gRPC"
                    actions={testConnectionTreeActions({ merge, mergeCandidateCount: () => mergeCandidateCount })}
                    onRename={vi.fn()}
                />,
            ));
            act(() => (container.querySelector('[data-testid="connection-row-menu"]') as HTMLButtonElement).click());
            return document.querySelector<HTMLElement>('[data-testid="connection-menu-item"][data-action="merge"]');
        };
        expect(render(0)).toBeNull();
        act(() => root.unmount());
        root = createRoot(container);
        const item = render(2)!;
        act(() => item.click());
        expect(merge).toHaveBeenCalledExactlyOnceWith('target');
    });
});
