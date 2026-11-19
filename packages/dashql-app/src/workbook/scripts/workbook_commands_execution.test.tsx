import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbookCommands, type WorkbookCommandsDependencies } from './workbook_commands.js';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { WorkbookViewMode } from '../workbook_view_mode.js';

describe('global workbook execution feedback', () => {
    let container: HTMLDivElement;
    let root: Root;
    let connection: any;
    let attention: React.ContextType<typeof WorkbookConnectionAttentionContext>;
    const resolveMain = vi.fn();
    const workbookScripts = {
        workbookId: 'workbook',
        scriptRefs: { '01_query.sql': { scriptId: 1, fileName: '01_query.sql' } },
        scriptOrder: ['01_query.sql'],
        scriptKeys: [1],
        scriptConnections: ['main'],
        pendingConnectionId: null,
    };
    const script = { scriptKey: 1, connectionId: 'main', annotations: {}, analysisOutdated: false };
    const runScript = vi.fn();
    const dependencies = {
        useWorkbook: () => workbookScripts,
        useConnectionsOfWorkbook: (workbookId: string) => { resolveMain(workbookId); return connection == null ? null : [connection]; },
        useConnectionReader: () => (connectionId: string) => connectionId === 'main' ? connection : null,
        useRefreshCatalog: () => vi.fn(),
        useLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
        useWorkbookViewMode: () => ({ mode: WorkbookViewMode.Workbook, setMode: vi.fn() }),
        useScriptReader: () => (scriptKey: number) => scriptKey === 1 ? script : null,
        useScriptRun: () => runScript,
    } as unknown as WorkbookCommandsDependencies;
    function Probe() {
        attention = React.useContext(WorkbookConnectionAttentionContext);
        return <span data-active={attention?.active} />;
    }
    const render = () => act(() => root.render(<MemoryRouter initialEntries={['/workbooks/workbook']}>
        <WorkbookCommands dependencies={dependencies}><Probe /></WorkbookCommands>
    </MemoryRouter>));
    const shortcut = () => act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true })));
    beforeEach(() => {
        connection = null;
        runScript.mockReset();
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
        expect(runScript).not.toHaveBeenCalled();
        expect(resolveMain).toHaveBeenCalledWith('workbook');
        expect(document.activeElement).toBe(focused);
        connection = { connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE };
        render();
        expect(attention?.active).toBe(false);
    });

    it('executes on the connection of the selected script', () => {
        connection = { connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE };
        render();
        shortcut();
        expect(runScript).toHaveBeenCalledWith('workbook', 1);
        expect(attention?.active).toBe(false);
    });
});
