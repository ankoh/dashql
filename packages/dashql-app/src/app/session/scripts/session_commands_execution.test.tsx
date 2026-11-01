import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCommands, type SessionCommandsDependencies } from './session_commands.js';
import { ConnectionHealth } from '../../../connections/connection_state.js';
import { SessionConnectionAttentionContext } from '../ui/session_connection_attention.js';
import { SessionViewMode } from '../ui/session_view_mode.js';

describe('global session execution feedback', () => {
    let container: HTMLDivElement;
    let root: Root;
    let connection: any;
    let attention: React.ContextType<typeof SessionConnectionAttentionContext>;
    const execute = vi.fn();
    const resolveMain = vi.fn();
    const sessionScripts = {
        sessionId: 'session',
        scriptFocus: { fileName: '01_query.sql' },
        scriptRefs: { '01_query.sql': { scriptId: 1, fileName: '01_query.sql' } },
        scriptOrder: ['01_query.sql'],
        scripts: { 1: { scriptKey: 1, connection: { connectionId: 'main', connectorInfo: {} }, annotations: {}, analysisOutdated: false } },
    };
    const runSessionScript = vi.fn();
    const dependencies = {
        useSessionScripts: () => [sessionScripts, vi.fn()],
        useSessionConnections: (sessionId: string) => { resolveMain(sessionId); return connection == null ? null : [connection]; },
        useConnectionRegistryStore: () => ({ get current() { return { connections: new Map(connection == null ? [] : [['main', connection]]) }; } }),
        useQueryExecutor: () => execute,
        useCatalogLoaderQueue: () => vi.fn(),
        useLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
        useSessionViewMode: () => ({ mode: SessionViewMode.Session, setMode: vi.fn() }),
        runSessionScript,
    } as unknown as SessionCommandsDependencies;
    function Probe() {
        attention = React.useContext(SessionConnectionAttentionContext);
        return <span data-active={attention?.active} />;
    }
    const render = () => act(() => root.render(<MemoryRouter initialEntries={['/sessions/session']}>
        <SessionCommands dependencies={dependencies}><Probe /></SessionCommands>
    </MemoryRouter>));
    const shortcut = () => act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true })));
    beforeEach(() => {
        connection = null;
        runSessionScript.mockReset();
        resolveMain.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('handles a missing script connection safely and pulses the descendant header signal', () => {
        render();
        const focused = document.activeElement;
        shortcut();
        expect(attention?.active).toBe(true);
        expect(runSessionScript).not.toHaveBeenCalled();
        expect(resolveMain).toHaveBeenCalledWith('session');
        expect(document.activeElement).toBe(focused);
        connection = { connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE };
        render();
        expect(attention?.active).toBe(false);
    });

    it('executes on the connection of the selected script', () => {
        connection = { connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE };
        render();
        shortcut();
        expect(runSessionScript).toHaveBeenCalledWith(sessionScripts, sessionScripts.scripts[1], execute, expect.any(Function), expect.anything());
        expect(attention?.active).toBe(false);
    });
});
