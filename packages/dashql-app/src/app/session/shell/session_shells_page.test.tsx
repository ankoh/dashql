import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth } from '../../connections/connection_state.js';
import { SessionShellsPage, type SessionShellsPageDependencies } from './session_shells_page.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

function fakeConnection(connectionId: string, connector: string) {
    return {
        connectionId,
        connectionHealth: ConnectionHealth.ONLINE,
        connectorInfo: { names: { displayLong: connector, displayShort: connector }, icons: { colored: 'database', uncolored: 'database' } },
        details: { type: null },
    };
}

const state = {
    connections: new Map<string, unknown>(),
    ordinals: new Map<string, number>(),
    shellMounts: [] as string[],
};

const dependencies = {
    useConnectionRegistry: () => [{ connections: state.connections }],
    useConnectionOrdinals: () => state.ordinals,
    ConnectionMenu: ({ onPick }: { onPick: (connectionId: string) => void }) => (
        <div data-testid="connection-menu">
            {[...state.connections.keys()].map(connectionId => (
                <button key={connectionId} type="button" data-testid={`pick-${connectionId}`} onClick={() => onPick(connectionId)} />
            ))}
        </div>
    ),
    SessionShellPage: ({ connectionId, active }: { connectionId: string; active: boolean }) => {
        React.useEffect(() => { state.shellMounts.push(connectionId); }, []);
        return <div data-testid="shell" data-connection-id={connectionId} data-active={active} />;
    },
} as unknown as SessionShellsPageDependencies;

describe('SessionShellsPage', () => {
    let container: HTMLDivElement;
    let root: Root;
    let connectionId: string | null;
    const onPickConnection = vi.fn((next: string) => { connectionId = next; });

    const render = () => act(() => root.render(
        <SessionShellsPage
            sessionId="session"
            sessionName="Session"
            connectionId={connectionId}
            onPickConnection={onPickConnection}
            dependencies={dependencies}
        />,
    ));
    const shells = () => [...container.querySelectorAll('[data-testid="shell"]')].map(shell => ({
        connectionId: shell.getAttribute('data-connection-id'),
        active: shell.getAttribute('data-active') === 'true',
    }));
    const pick = (next: string) => {
        act(() => (container.querySelector('[data-testid="shell-connection-picker"]') as HTMLButtonElement).click());
        act(() => (document.querySelector(`[data-testid="pick-${next}"]`) as HTMLButtonElement).click());
        render();
    };

    beforeEach(() => {
        state.connections = new Map([
            ['main', fakeConnection('main', 'Hyper')],
            ['attached', fakeConnection('attached', 'Hyper')],
        ]);
        state.ordinals = new Map([['main', 1], ['attached', 2]]);
        state.shellMounts = [];
        connectionId = 'main';
        onPickConnection.mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('names the connection of the visible shell', () => {
        render();
        const trigger = container.querySelector('[data-testid="shell-connection-picker"]');
        expect(trigger?.textContent).toContain('Hyper #1');
        expect(shells()).toEqual([{ connectionId: 'main', active: true }]);
    });

    it('keeps the shells of other connections hidden while switching', () => {
        render();
        pick('attached');
        expect(onPickConnection).toHaveBeenCalledWith('attached');
        expect(shells()).toEqual([
            { connectionId: 'main', active: false },
            { connectionId: 'attached', active: true },
        ]);
        expect(container.querySelector('[data-testid="shell-connection-picker"]')?.textContent).toContain('Hyper #2');

        pick('main');
        expect(shells()).toEqual([
            { connectionId: 'main', active: true },
            { connectionId: 'attached', active: false },
        ]);
        expect(state.shellMounts).toEqual(['main', 'attached']);
    });

    it('closes the shell of a deleted connection', () => {
        render();
        pick('attached');
        state.connections = new Map([['main', state.connections.get('main')]]);
        connectionId = 'main';
        render();
        expect(shells()).toEqual([{ connectionId: 'main', active: true }]);
    });
});
