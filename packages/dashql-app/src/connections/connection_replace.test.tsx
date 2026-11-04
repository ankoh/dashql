import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionReplaceBlocker, connectionReplaceCandidates } from './connection_replace.js';
import { NO_CONNECTION_REFERENCES, type ConnectionReferences, type ConnectionRegistry } from './connection_registry.js';
import { ConnectionHealth, type ConnectionState } from './connection_state.js';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType, HYPER_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';
import { ConnectionRowMenu, type ConnectionRefreshDependencies } from './connection_tree.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const grpc = (endpoint: string) => ({ hyper: { protocol: 'V3_GRPC', endpoint } }) as any;
const wasm = () => ({ hyper: { protocol: 'WASM', endpoint: '' } }) as any;
const trino = (endpoint: string) => ({ trino: { endpoint } }) as any;

/// A connection as far as the replacement looks at it
function database(connectionId: string, params: any, options: { active?: boolean; queries?: number } = {}): ConnectionState {
    const connectorType = 'hyper' in params ? ConnectorType.HYPER : ConnectorType.TRINO;
    return {
        connectionId,
        name: connectionId,
        params,
        active: options.active ?? true,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        connectorInfo: CONNECTOR_INFOS[connectorType],
        details: {
            type: connectorType === ConnectorType.HYPER ? HYPER_CONNECTOR : TRINO_CONNECTOR,
            value: { proto: { setupParams: Object.values(params)[0] } },
        },
        catalogUpdates: { currentFullRefresh: null, tasksRunning: new Map() },
        queriesActiveOrdered: Array.from({ length: options.queries ?? 0 }, (_, i) => i),
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

const ids = (databases: ConnectionState[]) => databases.map(db => db.connectionId);

describe('connectionReplaceCandidates', () => {
    it('lists the other listed connections, the ones of the same connector first', () => {
        const reg = registry(
            database('hyper-a', grpc('http://a')),
            database('trino-a', trino('http://a')),
            database('source', trino('http://source')),
            database('trino-b', trino('http://b')),
            database('embedded', wasm()),
            // Inactive connections that no session uses are not listed
            database('unlisted', trino('http://hidden'), { active: false }),
        );
        const candidates = connectionReplaceCandidates(reg, NO_CONNECTION_REFERENCES, 'source');
        expect(ids(candidates.sameConnector)).toEqual(['trino-a', 'trino-b']);
        expect(ids(candidates.otherConnectors)).toEqual(['hyper-a', 'embedded']);
        expect(connectionReplaceCandidates(reg, NO_CONNECTION_REFERENCES, 'missing')).toEqual({ sameConnector: [], otherConnectors: [] });
    });
});

describe('connectionReplaceBlocker', () => {
    const references: ConnectionReferences = { ...NO_CONNECTION_REFERENCES, sessionsOf: id => id === 'source' ? ['s1', 's2'] : [] };
    const notHeld = () => false;

    it('lets a connection be replaced when another connection can take its sessions', () => {
        const reg = registry(database('source', trino('http://source')), database('other', grpc('http://other')));
        expect(connectionReplaceBlocker(reg, references, 'source', notHeld)).toBeNull();
    });

    it('names what keeps a connection from being replaced', () => {
        const other = database('other', trino('http://other'));
        expect(connectionReplaceBlocker(registry(other), references, 'source', notHeld)).toBe('Unknown connection');
        expect(connectionReplaceBlocker(registry(database('source', trino('http://source'))), references, 'source', notHeld)).toBe('No other connection');
        expect(connectionReplaceBlocker(registry(database('source', wasm()), other), references, 'source', notHeld)).toBe('Sessions fall back to it');
        expect(connectionReplaceBlocker(registry(database('source', trino('http://source'), { queries: 2 }), other), references, 'source', notHeld))
            .toBe('2 queries running');
        expect(connectionReplaceBlocker(registry(database('source', trino('http://source')), other), references, 'source', id => id === 's2'))
            .toBe('1 session changed outside the app');
    });
});

describe('connection replace ui', () => {
    let container: HTMLDivElement;
    let root: Root;
    const dependencies: ConnectionRefreshDependencies = { useCatalogLoaderQueue: () => vi.fn() };
    const source = database('source', trino('http://source'));
    const candidates = {
        sameConnector: [database('trino-b', trino('http://b'))],
        otherConnectors: [database('hyper-a', grpc('http://a'))],
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const open = (blocker: string | null, onReplace: (targetId: string) => void) => {
        act(() => root.render(
            <ConnectionRowMenu
                database={source}
                label="Trino source"
                onOpenSettings={vi.fn()}
                onReplace={onReplace}
                replaceBlocker={() => blocker}
                replaceCandidates={() => candidates}
                dependencies={dependencies}
            />,
        ));
        act(() => (container.querySelector('[data-testid="connection-row-menu"]') as HTMLButtonElement).click());
        return document.querySelector<HTMLButtonElement>('[data-testid="connection-menu-item"][data-action="replace"]')!;
    };

    it('disables replacing with the reason', () => {
        const item = open('2 queries running', vi.fn());
        expect(item.disabled).toBe(true);
        expect(item.textContent).toContain('2 queries running');
    });

    it('picks the connection of the same connector first and replaces after confirming', () => {
        const onReplace = vi.fn();
        act(() => open(null, onReplace).click());
        const picker = document.querySelector<HTMLElement>('[data-testid="connection-replace-picker"]')!;
        expect(picker).not.toBeNull();
        const options = [...picker.querySelectorAll<HTMLButtonElement>('[data-testid="connection-replace-option"]')];
        expect(options.map(option => option.dataset.connectionId)).toEqual(['trino-b', 'hyper-a']);
        const confirm = picker.querySelector<HTMLButtonElement>('[data-testid="connection-replace-confirm"]')!;
        expect(confirm.disabled).toBe(true);

        act(() => options[1].click());
        expect(options[1].getAttribute('aria-selected')).toBe('true');
        act(() => confirm.click());
        expect(onReplace).toHaveBeenCalledWith('hyper-a');
        expect(document.querySelector('[data-testid="connection-replace-picker"]')).toBeNull();
    });

    it('goes back to the actions without replacing', () => {
        const onReplace = vi.fn();
        act(() => open(null, onReplace).click());
        act(() => document.querySelector<HTMLButtonElement>('[data-testid="connection-replace-cancel"]')!.click());
        expect(document.querySelector('[data-testid="connection-replace-picker"]')).toBeNull();
        expect(document.querySelector('[data-testid="connection-menu-item"][data-action="replace"]')).not.toBeNull();
        expect(onReplace).not.toHaveBeenCalled();
    });
});
