import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbookCommands, type WorkbookCommandsDependencies } from './workbook_commands.js';
import { ConnectionHealth } from '@ankoh/dashql-runtime/connections/connection_state';
import { WorkbookConnectionAttentionContext } from '../workbook_connection_attention.js';
import { WorkbookViewMode } from '../workbook_view_mode.js';

describe('global workbook execution feedback', () => {
    let container: HTMLDivElement;
    let root: Root;
    let connection: any;
    let attention: React.ContextType<typeof WorkbookConnectionAttentionContext>;
    const execute = vi.fn();
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
    const services = { runs: {} };
    const runWorkbookScript = vi.fn();
    const dependencies = {
        useWorkbookScripts: () => [workbookScripts, vi.fn()],
        useWorkbookConnections: (workbookId: string) => { resolveMain(workbookId); return connection == null ? null : [connection]; },
        useConnectionRegistryStore: () => ({ get current() { return { connections: new Map(connection == null ? [] : [['main', connection]]) }; } }),
        useQueryExecutor: () => execute,
        useCatalogLoaderQueue: () => vi.fn(),
        useLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
        useWorkbookViewMode: () => ({ mode: WorkbookViewMode.Workbook, setMode: vi.fn() }),
        useScriptReader: () => (scriptKey: number) => scriptKey === 1 ? script : null,
        useScriptRunServices: () => services,
        runWorkbookScript,
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
        runWorkbookScript.mockReset();
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
        expect(runWorkbookScript).not.toHaveBeenCalled();
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
        expect(runWorkbookScript).toHaveBeenCalledWith(services, workbookScripts, script, execute, expect.any(Function), expect.anything());
        expect(attention?.active).toBe(false);
    });
});
