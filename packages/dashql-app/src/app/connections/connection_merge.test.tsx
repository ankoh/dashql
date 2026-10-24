import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionMergeCandidates } from './connection_merge.js';
import { NO_CONNECTION_REFERENCES, type ConnectionReferences, type ConnectionRegistry } from './connection_registry.js';
import { ConnectionHealth, type ConnectionState } from './connection_state.js';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType } from './connector_info.js';
import { ConnectionMergeDialog } from './ui/connection_merge_dialog.js';
import { ConnectionRowMenu, type ConnectionRefreshDependencies } from './ui/connection_tree.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const grpc = (endpoint: string, token?: string) => ({ hyper: { protocol: 'V3_GRPC', endpoint, ...(token ? { metadata: { auth: token } } : {}) } }) as any;
const trino = (endpoint: string) => ({ trino: { endpoint } }) as any;

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

    it('merges only the chosen disconnected connections', () => {
        const onConfirm = vi.fn();
        const candidates = [
            { database: database('offline', grpc('http://hyper')), label: 'Hyper #2 gRPC', sessionCount: 1 },
            { database: database('online', grpc('http://hyper'), ConnectionHealth.ONLINE), label: 'Hyper #3 gRPC', sessionCount: 0 },
            { database: database('unchecked', grpc('http://hyper'), ConnectionHealth.FAILED), label: 'Hyper #4 gRPC', sessionCount: 2 },
        ];
        act(() => root.render(
            <ConnectionMergeDialog targetLabel="Hyper #1 gRPC" candidates={candidates} busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />,
        ));
        const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="connection-merge-candidate"]')];
        expect(rows.map(row => row.dataset.state)).toEqual(['disconnected', 'connected', 'disconnected']);
        const boxes = rows.map(row => row.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
        expect(boxes.map(box => [box.checked, box.disabled])).toEqual([[true, false], [false, true], [true, false]]);
        act(() => boxes[2].click());
        act(() => document.querySelector<HTMLButtonElement>('[data-testid="connection-merge-confirm"]')!.click());
        expect(onConfirm).toHaveBeenCalledWith(['offline']);
    });
});
