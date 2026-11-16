import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as core from '@akohn/dashql';

import { connectionReplaceBlocker, connectionReplaceCandidates } from './connection_replace.js';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType, HYPER_CONNECTOR, TRINO_CONNECTOR } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionRowMenu, type ConnectionRefreshDependencies } from './connection_tree.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const grpc = (endpoint: string) => ({ hyper: { protocol: 'V3_GRPC', endpoint } }) as any;
const wasm = () => ({ hyper: { protocol: 'WASM', endpoint: '' } }) as any;
const trino = (endpoint: string) => ({ trino: { endpoint } }) as any;

/// A connection as far as the replacement looks at it
function database(connectionId: string, params: any, options: { active?: boolean; queries?: number; workbooks?: string[] } = {}): ConnectionState {
    const connectorType = 'hyper' in params ? ConnectorType.HYPER : ConnectorType.TRINO;
    return {
        connectionId,
        name: connectionId,
        params,
        active: options.active ?? true,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        connectorType,
        details: { setupParams: Object.values(params)[0], channel: null, connector: { kind: connectorType === ConnectorType.HYPER ? 'hyper' : 'trino' } },
        catalogUpdates: { currentFullRefresh: null, tasksRunning: [], refreshRunning: false, outOfDate: false },
        queriesActiveOrdered: Array.from({ length: options.queries ?? 0 }, (_, i) => i),
        workbooks: options.workbooks ?? [],
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

const ids = (databases: ConnectionState[]) => databases.map(db => db.connectionId);

describe('connectionReplaceCandidates', () => {
    it('lists the other listed connections, the ones of the same connector first', () => {
        const { connections, list } = views([
            database('hyper-a', grpc('http://a')),
            database('trino-a', trino('http://a')),
            database('source', trino('http://source')),
            database('trino-b', trino('http://b')),
            database('embedded', wasm()),
            // Inactive connections that no workbook uses are not listed
            database('unlisted', trino('http://hidden'), { active: false }),
        ]);
        const candidates = connectionReplaceCandidates(connections, list, 'source');
        expect(ids(candidates.sameConnector)).toEqual(['trino-a', 'trino-b']);
        expect(ids(candidates.otherConnectors)).toEqual(['hyper-a', 'embedded']);
        expect(connectionReplaceCandidates(connections, list, 'missing')).toEqual({ sameConnector: [], otherConnectors: [] });
    });
});

describe('connectionReplaceBlocker', () => {
    const notHeld = () => false;
    /// The blocker of the source among connections, two workbooks use the source
    const blocker = (databases: ConnectionState[], isWorkbookHeld: (workbookId: string) => boolean) => {
        const { connections, list } = views(databases);
        return connectionReplaceBlocker(connections, list, 'source', isWorkbookHeld);
    };
    const used = { workbooks: ['s1', 's2'] };

    it('lets a connection be replaced when another connection can take its workbooks', () => {
        expect(blocker([database('source', trino('http://source'), used), database('other', grpc('http://other'))], notHeld)).toBeNull();
    });

    it('names what keeps a connection from being replaced', () => {
        const other = database('other', trino('http://other'));
        expect(blocker([other], notHeld)).toBe('Unknown connection');
        expect(blocker([database('source', trino('http://source'), used)], notHeld)).toBe('No other connection');
        expect(blocker([database('source', wasm(), used), other], notHeld)).toBe('Workbooks fall back to it');
        expect(blocker([database('source', trino('http://source'), { queries: 2, ...used }), other], notHeld))
            .toBe('2 queries running');
        expect(blocker([database('source', trino('http://source'), used), other], id => id === 's2'))
            .toBe('1 workbook changed outside the app');
    });
});

describe('connection replace ui', () => {
    let container: HTMLDivElement;
    let root: Root;
    const dependencies: ConnectionRefreshDependencies = { useRefreshCatalog: () => vi.fn() };
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
