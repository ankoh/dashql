import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionMergeCandidates } from './connection_merge.js';
import { createDefaultConnectionParamsForConnector } from './connection_params.js';
import { NO_CONNECTION_REFERENCES, type ConnectionReferences, type ConnectionRegistry } from './connection_registry.js';
import { ConnectionHealth, type ConnectionState } from './connection_state.js';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType } from './connector_info.js';
import { ConnectionRowMenu, type ConnectionRefreshDependencies } from './ui/connection_tree.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const grpc = (endpoint: string, token?: string) => ({ hyper: { protocol: 'V3_GRPC', endpoint, ...(token ? { metadata: { auth: token } } : {}) } }) as any;
const trino = (endpoint: string) => ({ trino: { endpoint } }) as any;
/// The embedded database as exported sessions store it
const wasm = () => ({ hyper: {
    protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
    attachedDatabases: [], metadata: {}, queryParameters: {},
} }) as any;

/// A connection as far as the merge looks at it
function database(connectionId: string, params: any, health = ConnectionHealth.NOT_STARTED, active = true): ConnectionState {
    const connectorType = 'hyper' in params ? ConnectorType.HYPER : ConnectorType.TRINO;
    return {
        connectionId,
        params,
        active,
        connectionHealth: health,
        connectorInfo: CONNECTOR_INFOS[connectorType],
        catalogUpdates: { currentFullRefresh: null, tasksRunning: new Map() },
    } as unknown as ConnectionState;
}

function registry(...databases: ConnectionState[]): ConnectionRegistry {
    const reg: ConnectionRegistry = { connections: new Map(), connectionsByType: CONNECTOR_TYPES.map(() => []) };
    for (const db of databases) {
        reg.connections.set(db.connectionId, db);
        reg.connectionsByType[db.connectorInfo.connectorType].push(db.connectionId);
    }
    return reg;
}

describe('connectionMergeCandidates', () => {
    it('lists the listed connections that describe the same database', () => {
        const reg = registry(
            database('target', grpc('http://hyper', 'one')),
            // Secrets don't tell connections apart
            database('same', grpc('http://hyper', 'two')),
            database('other-endpoint', grpc('http://elsewhere')),
            database('other-connector', trino('http://hyper')),
            // Inactive connections that no session uses are not listed
            database('unlisted', grpc('http://hyper'), ConnectionHealth.NOT_STARTED, false),
        );
        expect(connectionMergeCandidates(reg, NO_CONNECTION_REFERENCES, 'target').map(db => db.connectionId)).toEqual(['same']);
    });

    it('lists the embedded database of an imported session next to the default one', () => {
        const reg = registry(
            database('default', createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.HYPER]), ConnectionHealth.ONLINE),
            // Exported sessions carry every list and map, even when empty
            database('example', wasm(), ConnectionHealth.ONLINE),
        );
        expect(connectionMergeCandidates(reg, NO_CONNECTION_REFERENCES, 'default').map(db => db.connectionId)).toEqual(['example']);
    });

    it('lists unlisted connections once sessions use them', () => {
        const reg = registry(database('target', grpc('http://hyper')), database('used', grpc('http://hyper'), ConnectionHealth.NOT_STARTED, false));
        const references: ConnectionReferences = { ...NO_CONNECTION_REFERENCES, sessionsOf: id => id === 'used' ? ['session'] : [] };
        expect(connectionMergeCandidates(reg, references, 'target').map(db => db.connectionId)).toEqual(['used']);
        expect(connectionMergeCandidates(reg, references, 'missing')).toEqual([]);
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
        const dependencies: ConnectionRefreshDependencies = { useCatalogLoaderQueue: () => vi.fn() };
        const onMerge = vi.fn();
        const render = (mergeCandidateCount: number) => {
            act(() => root.render(
                <ConnectionRowMenu
                    database={database('target', grpc('http://hyper'))}
                    label="Hyper gRPC"
                    onOpenSettings={vi.fn()}
                    onMerge={onMerge}
                    mergeCandidateCount={mergeCandidateCount}
                    dependencies={dependencies}
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
        expect(onMerge).toHaveBeenCalledTimes(1);
    });
});
