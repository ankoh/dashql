import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionFeedPage, type SessionFeedPageDependencies } from './session_feed_page.js';
import { SessionViewMode } from '../session_view_mode.js';
import { SegmentedControl } from '../../ui/foundations/segmented_control.js';
import { Button } from '../../ui/foundations/button.js';
import { ConnectionHealth } from '../../connections/connection_state.js';
import { SessionConnectionAttentionContext } from '../session_connection_attention.js';
import { FlavorProvider } from '../../config/flavor_provider.js';
import { SIDB_FLAVOR } from '../../config/flavors.js';
import { SELECT_SCRIPT } from '../scripts/session_scripts.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = {
    feedProps: null as any,
    mode: SessionViewMode.Session,
    setMode: vi.fn(),
    dashboardProps: null as any,
    dataflowProps: null as any,
    shareProps: null as any,
    exportProps: null as any,
    sidebarProps: null as any,
    attention: null as any,
    connectionButtonsProps: null as any,
    execution: { state: null, busy: false, start: vi.fn(), stop: vi.fn() } as any,
};
const dependencies = {
    SessionFeed: (props: any) => {
        state.attention = React.useContext(SessionConnectionAttentionContext);
        state.feedProps = props;
        return null;
    },
    ScriptEditorDialog: () => null,
    SessionWorkbenchSidebar: (props: any) => {
        state.sidebarProps = props;
        return null;
    },
    ConnectionOverviewPage: () => null,
    SessionNavigationDrawer: () => null,
    ThreeBarsIcon: () => null,
    IconButton: React.forwardRef((props: any, ref: React.ForwardedRef<HTMLButtonElement>) => <button {...props} ref={ref} />),
    Button,
    SessionURLShareOverlay: (props: any) => {
        state.shareProps = props;
        return null;
    },
    SessionFileSaveOverlay: (props: any) => {
        state.exportProps = props;
        return null;
    },
    Dashboard: (props: any) => {
        state.dashboardProps = props;
        return <div data-testid="dashboard" />;
    },
    DataflowCanvas: (props: any) => {
        state.dataflowProps = props;
        return <div data-testid="dataflow" />;
    },
    SessionConnectionButtons: (props: any) => {
        state.connectionButtonsProps = props;
        return null;
    },
    useSessionViewMode: () => ({ mode: state.mode, setMode: state.setMode }),
    SegmentedControl,
    useSessionExecution: () => state.execution,
} as unknown as SessionFeedPageDependencies;

/// The label of a button of the view switch, its tooltip
function viewLabel(button: HTMLButtonElement): string | null {
    const id = button.getAttribute('aria-labelledby');
    return button.getAttribute('aria-label') ?? (id != null ? document.getElementById(id)?.textContent ?? null : null);
}

function scripts() {
    return {
        sessionId: 'session',
        sessionMetadata: { originalFileName: 'session' },
        scriptFocus: { fileName: '01_alpha.sql' },
        scriptRefs: {
            '01_alpha.sql': { scriptId: 1, fileName: '01_alpha.sql' },
        },
        scriptOrder: ['01_alpha.sql'],
        scripts: {
            1: { scriptKey: 1, fileName: '01_alpha.sql', connection: { connectionId: 'main' } },
        },
    } as any;
}

describe('SessionFeedPage', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        state.feedProps = null;
        state.dataflowProps = null;
        state.mode = SessionViewMode.Session;
        state.setMode.mockReset();
        state.dashboardProps = null;
        state.shareProps = null;
        state.exportProps = null;
        state.connectionButtonsProps = null;
        state.execution = { state: null, busy: false, start: vi.fn(), stop: vi.fn() };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('does not request automatic feed scrolling', () => {
        act(() => root.render(
            <SessionFeedPage
                sessionScripts={scripts()}
                modifySessionScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(state.feedProps).not.toHaveProperty('scrollTarget');
    });

    it('starts all scripts only when online and idle', () => {
        const modify = vi.fn();
        const render = (connection: any) => act(() => root.render(<SessionFeedPage
            sessionScripts={scripts()} modifySessionScripts={modify} connection={connection} active dependencies={dependencies} />));
        render(null);
        expect(container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')?.disabled).toBe(true);
        render({ connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE, queriesActive: new Map() });
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!.click());
        expect(state.execution.start).toHaveBeenCalledWith(modify);
        render({ connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE, queriesActive: new Map([[1, {}]]) });
        expect(container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')?.disabled).toBe(true);
    });

    it('asks to connect the connections of the scripts instead of running', () => {
        const modify = vi.fn();
        const main = { connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE, queriesActive: new Map() } as any;
        const lake = { connectionId: 'lake', connectionHealth: ConnectionHealth.NOT_STARTED, queriesActive: new Map() } as any;
        const unused = { connectionId: 'unused', connectionHealth: ConnectionHealth.NOT_STARTED, queriesActive: new Map() } as any;
        const session = scripts();
        session.scripts[1].connection = { connectionId: 'lake' };
        const render = (connections: any[]) => act(() => root.render(<SessionFeedPage
            sessionScripts={session} modifySessionScripts={modify} connection={main}
            scriptConnections={new Map(connections.map(connection => [connection.connectionId, connection]))} active dependencies={dependencies} />));
        // The connection of the composer is online, the script runs on another one
        render([main, lake, unused]);
        const button = container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!;
        expect(button.disabled).toBe(false);
        expect(button.getAttribute('aria-label')).toBe('Connect to run');
        // The top bar shows the connections of the session only
        expect(state.connectionButtonsProps.connections).toEqual([lake]);
        // A click draws attention to the connections that are not connected, it opens nothing
        const request = vi.spyOn(state.attention, 'request');
        act(() => button.click());
        expect(state.execution.start).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledWith('session');
        // Once connected the session runs
        const online = { ...lake, connectionHealth: ConnectionHealth.ONLINE };
        render([main, online, unused]);
        expect(state.connectionButtonsProps.connections).toEqual([online]);
        expect(button.getAttribute('aria-label')).toBe('Execute All');
        // While a script of the session runs, the session doesn't run
        state.execution = { ...state.execution, runActive: true };
        render([main, online, unused]);
        expect(button.disabled).toBe(true);
        state.execution = { ...state.execution, runActive: false };
        render([main, online, unused]);
        act(() => button.click());
        expect(state.execution.start).toHaveBeenCalledWith(modify);
    });

    it('shows the connection picked for the next script in the top bar without running it', () => {
        const lake = { connectionId: 'lake', connectionHealth: ConnectionHealth.NOT_STARTED, queriesActive: new Map() } as any;
        // An empty session runs nothing yet, the composer drafts its first script on the picked connection
        const session = { ...scripts(), scriptRefs: {}, scriptOrder: [], scripts: {}, pendingConnection: { connectionId: 'lake' } };
        act(() => root.render(<SessionFeedPage
            sessionScripts={session} modifySessionScripts={vi.fn()} connection={lake}
            scriptConnections={new Map([['lake', lake]])} active dependencies={dependencies} />));
        expect(state.connectionButtonsProps.connections).toEqual([lake]);
        const button = container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!;
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-label')).toBe('Execute All');
    });

    it('requests connection attention on blocked execution hover and clears on main health or session changes', async () => {
        const render = (sessionId: string, health: ConnectionHealth) => act(() => root.render(<SessionFeedPage
            sessionScripts={{ ...scripts(), sessionId }} modifySessionScripts={vi.fn()}
            connection={{ connectionId: 'main', connectionHealth: health } as any} active dependencies={dependencies} />));
        render('session', ConnectionHealth.NOT_STARTED);
        const wrapper = container.querySelector('[data-execution-connection-blocked="true"]')!;
        expect(wrapper.contains(container.querySelector('[data-testid="execute-all"]'))).toBe(true);
        const request = vi.spyOn(state.attention, 'request');
        act(() => wrapper.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
        expect(request).toHaveBeenCalledWith('session');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
        expect(state.attention.active).toBe(true);
        render('session', ConnectionHealth.CONNECTING);
        expect(state.attention.active).toBe(false);
        act(() => state.attention.request('session'));
        render('other', ConnectionHealth.CONNECTING);
        expect(state.attention.active).toBe(false);
    });

    it('keeps the view switch and execution controls inside mobile and desktop headers', async () => {
        const frame = document.createElement('iframe');
        frame.style.height = '600px';
        document.body.appendChild(frame);
        const frameDocument = frame.contentDocument!;
        const style = frameDocument.createElement('style');
        style.textContent = Array.from(document.styleSheets)
            .flatMap(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText)).join('\n');
        frameDocument.head.appendChild(style);
        frameDocument.body.style.margin = '0';
        const host = frameDocument.createElement('div');
        host.style.height = '600px';
        frameDocument.body.appendChild(host);
        const frameRoot = createRoot(host);
        try {
            for (const width of [320, 375, 800, 1024, 1440]) {
                frame.style.width = `${width}px`;
                for (const busy of [false, true]) {
                    state.execution = { busy, start: vi.fn(), stop: vi.fn(), state: busy ? {
                        phase: 'running', completedScripts: 123, totalScripts: 456,
                        completedStatements: 123, totalStatements: 456, error: null,
                    } : null };
                    await act(async () => {
                        frameRoot.render(<SessionFeedPage sessionScripts={scripts()} modifySessionScripts={vi.fn()}
                            connection={null} active dependencies={dependencies} />);
                        await new Promise(resolve => setTimeout(resolve, 50));
                    });
                    const header = host.querySelector('header')!;
                    const bounds = header.getBoundingClientRect();
                    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
                    const controls = [host.querySelector('[data-testid="session-view-switch"]')!,
                        host.querySelector(busy ? '[data-testid="stop-execution"]' : '[data-testid="execute-all"]')!];
                    for (const control of controls) {
                        const rect = control.getBoundingClientRect();
                        expect(rect.width).toBeGreaterThan(0);
                        expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
                        expect(rect.right).toBeLessThanOrEqual(bounds.right);
                        expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
                    }
                }
            }
        } finally {
            act(() => frameRoot.unmount());
            frame.remove();
        }
    });

    it('shows the execution progress and stops the running session', () => {
        state.execution = { busy: true, start: vi.fn(), stop: vi.fn(), state: {
            phase: 'running', completedScripts: 2, totalScripts: 5, completedStatements: 4, totalStatements: 9,
            activeFileName: '3_customers.sql', activeStatementIndex: 2, activeStatementCount: 3, error: null,
        } };
        const render = () => act(() => root.render(<SessionFeedPage sessionScripts={scripts()}
            modifySessionScripts={vi.fn()} connection={null} active dependencies={dependencies} />));
        const details = () => document.querySelector('[data-testid="execution-details"]');
        const status = () => container.querySelector('[data-testid="execution-status"]');
        const toggleDetails = () => act(() => container.querySelector<HTMLButtonElement>('[data-testid="execution-details-toggle"]')!.click());
        const closeDetails = () => act(() => document.querySelector<HTMLButtonElement>('[data-testid="execution-details-close"]')!.click());
        render();
        expect(status()?.getAttribute('data-phase')).toBe('running');
        expect(container.querySelector('[data-testid="execution-indicator"]')).not.toBeNull();
        expect(details()).toBeNull();
        toggleDetails();
        expect(details()?.textContent).toContain('3_customers.sql');
        closeDetails();
        expect(details()).toBeNull();
        expect(container.querySelector('[data-testid="execute-all"]')).toBeNull();
        const executeButton = container.querySelector<HTMLButtonElement>('[data-testid="stop-execution"]')!;
        expect(executeButton.disabled).toBe(false);
        act(() => executeButton.click());
        expect(state.execution.stop).toHaveBeenCalledOnce();
        state.execution.state.phase = 'stopping';
        render();
        expect(status()?.getAttribute('data-phase')).toBe('stopping');
        expect(container.querySelector<HTMLButtonElement>('[data-testid="stop-execution"]')?.disabled).toBe(true);
        expect(container.querySelector('[data-testid="stop-execution"]')).toBe(executeButton);
        state.execution.busy = false;
        state.execution.state.phase = 'failed';
        state.execution.state.error = 'Backend failure';
        render();
        expect(status()?.getAttribute('data-phase')).toBe('failed');
        expect(container.querySelector('[data-testid="stop-execution"]')).toBeNull();
        expect(container.querySelector('[data-testid="execute-all"]')).toBe(executeButton);
        expect(status()?.getAttribute('aria-label')).toContain('Backend failure');
        expect(details()).toBeNull();
        toggleDetails();
        expect(details()?.textContent).toContain('Backend failure');
        expect(details()?.textContent).toContain('3_customers.sql');
        closeDetails();
        expect(details()).toBeNull();
        state.execution.state.phase = 'succeeded';
        state.execution.state.completedScripts = 5;
        state.execution.state.error = null;
        render();
        expect(status()?.getAttribute('data-phase')).toBe('succeeded');
        toggleDetails();
        expect(details()).not.toBeNull();
    });

    it('keeps the running status indicator mounted as execution progress changes', () => {
        state.execution = { busy: true, start: vi.fn(), stop: vi.fn(), state: {
            phase: 'running', completedScripts: 1, totalScripts: 5,
            completedStatements: 1, totalStatements: 9, error: null,
        } };
        const render = () => act(() => root.render(<SessionFeedPage sessionScripts={scripts()}
            modifySessionScripts={vi.fn()} connection={null} active dependencies={dependencies} />));
        render();
        const indicator = container.querySelector('[data-testid="execution-indicator"] svg');
        expect(indicator).not.toBeNull();
        state.execution.state = { ...state.execution.state, completedScripts: 2, completedStatements: 4 };
        render();
        expect(container.querySelector('[data-testid="execution-indicator"] svg')).toBe(indicator);
    });

    it('uses one header for the workbench toggle, view switcher, and session actions', () => {
        const sessionScripts = scripts();
        const connection = { connectionId: 'database' } as any;
        act(() => root.render(
            <SessionFeedPage
                sessionScripts={sessionScripts}
                modifySessionScripts={vi.fn()}
                connection={connection}
                active
                dependencies={dependencies}
            />,
        ));

        const header = container.querySelector('header')!;
        expect(container.querySelectorAll('header')).toHaveLength(1);
        expect(header.querySelector('[data-testid="open-workbench"]')).not.toBeNull();
        expect(header.querySelector('[data-testid="session-view-switch"]')).not.toBeNull();
        const shareButton = header.querySelector<HTMLButtonElement>('[data-testid="share-url"]')!;
        const exportButton = header.querySelector<HTMLButtonElement>('[data-testid="export-session"]')!;
        for (const button of [shareButton, exportButton]) {
            expect(button).not.toBeNull();
        }

        act(() => shareButton.click());
        expect(state.shareProps).toMatchObject({ sessionId: 'session', isOpen: true });
        expect(state.shareProps.anchorRef.current).toBe(shareButton);
        expect(shareButton.getAttribute('aria-expanded')).toBe('true');

        act(() => exportButton.click());
        expect(state.exportProps).toMatchObject({ sessionScripts, isOpen: true });
        expect(state.exportProps.anchorRef.current).toBe(exportButton);
        expect(exportButton.getAttribute('aria-expanded')).toBe('true');
        // Storage lives in the session row menu of the workbench
        expect(header.querySelector('[data-testid="session-storage"]')).toBeNull();
    });

    it('hides the session controls while a connection overview is open', () => {
        act(() => root.render(
            <SessionFeedPage
                sessionScripts={scripts()}
                modifySessionScripts={vi.fn()}
                connection={{ connectionId: 'database' } as any}
                active
                dependencies={dependencies}
            />,
        ));
        const header = container.querySelector('header')!;
        const sessionControls = ['session-view-switch', 'execute-all', 'share-url'];
        for (const testId of sessionControls) expect(header.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();

        act(() => state.sidebarProps.onOpenOverview('database'));
        for (const testId of sessionControls) expect(header.querySelector(`[data-testid="${testId}"]`)).toBeNull();
        expect(header.querySelector('[data-testid="open-workbench"]')).not.toBeNull();

        act(() => state.sidebarProps.onOpenOverview(null));
        for (const testId of sessionControls) expect(header.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    });

    it('keeps only the connections and the agent in the header while the session is ephemeral', () => {
        const ephemeral = { ...scripts(), sessionMetadata: { ephemeral: true }, scriptOrder: [], scripts: {}, scriptRefs: {} };
        act(() => root.render(<SessionFeedPage sessionScripts={ephemeral} modifySessionScripts={vi.fn()} connection={null} active dependencies={dependencies} />));
        const header = container.querySelector('header')!;
        for (const control of ['session-view-switch', 'execute-all', 'share-url', 'export-session']) {
            expect(header.querySelector(`[data-testid="${control}"]`)).toBeNull();
        }
        expect(header.querySelector('[data-testid="open-workbench"]')).not.toBeNull();
        expect(state.connectionButtonsProps).not.toBeNull();
        expect(state.setMode).not.toHaveBeenCalled();
    });

    it.each([SessionViewMode.Dashboard, SessionViewMode.Dataflow])('leaves a view without a switch while the session is ephemeral (%s)', mode => {
        state.mode = mode;
        const ephemeral = { ...scripts(), sessionMetadata: { ephemeral: true }, scriptOrder: [], scripts: {}, scriptRefs: {} };
        act(() => root.render(<SessionFeedPage sessionScripts={ephemeral} modifySessionScripts={vi.fn()} connection={null} active dependencies={dependencies} />));
        expect(state.setMode).toHaveBeenCalledWith(SessionViewMode.Session);
    });

    it('hides the archive export when the flavor does not support it', () => {
        act(() => root.render(
            <FlavorProvider requested={SIDB_FLAVOR}>
                <SessionFeedPage
                    sessionScripts={scripts()}
                    modifySessionScripts={vi.fn()}
                    connection={{ connectionId: 'database' } as any}
                    active
                    dependencies={dependencies}
                />
            </FlavorProvider>,
        ));

        const header = container.querySelector('header')!;
        expect(header.querySelector('[data-testid="share-url"]')).not.toBeNull();
        expect(header.querySelector('[data-testid="export-session"]')).toBeNull();
    });

    it('switches between Session and Dashboard from the content view bar', () => {
        act(() => root.render(
            <SessionFeedPage
                sessionScripts={scripts()}
                modifySessionScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="session-view-switch"] button');
        expect(buttons[0]?.getAttribute('aria-current')).toBe('true');
        act(() => buttons[1]?.click());
        expect(state.setMode).toHaveBeenCalledWith(SessionViewMode.Dashboard);
    });

    it('renders the Dashboard beneath the view bar without activating the feed', () => {
        state.mode = SessionViewMode.Dashboard;
        const sessionScripts = scripts();
        const modifySessionScripts = vi.fn();
        act(() => root.render(
            <SessionFeedPage
                sessionScripts={sessionScripts}
                modifySessionScripts={modifySessionScripts}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelector('[data-testid="dashboard"]')).not.toBeNull();
        expect(state.dashboardProps).toMatchObject({ sessionScripts, modifySessionScripts });
        expect(state.feedProps.active).toBe(false);
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="session-view-switch"] button');
        expect(buttons[1]?.getAttribute('aria-current')).toBe('true');
        act(() => buttons[0]?.click());
        expect(state.setMode).toHaveBeenCalledWith(SessionViewMode.Session);
    });

    it('offers the Dataflow view after the Dashboard', () => {
        act(() => root.render(
            <SessionFeedPage sessionScripts={scripts()} modifySessionScripts={vi.fn()} connection={null} active dependencies={dependencies} />,
        ));
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="session-view-switch"] button');
        expect([...buttons].map(viewLabel)).toEqual(['Feed', 'Dashboard', 'Dataflow']);
        act(() => buttons[2]?.click());
        expect(state.setMode).toHaveBeenCalledWith(SessionViewMode.Dataflow);
    });

    it('renders the Dataflow canvas and opens a script in the editor dialog', () => {
        state.mode = SessionViewMode.Dataflow;
        const sessionScripts = scripts();
        const modifySessionScripts = vi.fn();
        const ScriptEditorDialog = vi.fn((_props: any) => <div data-testid="script-editor-dialog" />);
        act(() => root.render(
            <SessionFeedPage sessionScripts={sessionScripts} modifySessionScripts={modifySessionScripts} connection={null} active
                dependencies={{ ...dependencies, ScriptEditorDialog } as unknown as SessionFeedPageDependencies} />,
        ));
        expect(container.querySelector('[data-testid="dataflow"]')).not.toBeNull();
        expect(state.dataflowProps).toMatchObject({ sessionScripts, modifySessionScripts });
        expect(state.feedProps.active).toBe(false);
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="session-view-switch"] button');
        expect([...buttons].map(viewLabel)).toEqual(['Feed', 'Dashboard', 'Dataflow']);
        expect(buttons[2]?.getAttribute('aria-current')).toBe('true');

        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
        act(() => state.dataflowProps.onInspect(1));
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).not.toBeNull();
        expect(ScriptEditorDialog.mock.calls[ScriptEditorDialog.mock.calls.length - 1]?.[0].scriptKey).toBe(1);
        // The dialog selects its script, the commands of the session run it
        expect(modifySessionScripts).toHaveBeenCalledWith({ type: SELECT_SCRIPT, value: sessionScripts.scripts[1].fileName });
        act(() => ScriptEditorDialog.mock.calls[ScriptEditorDialog.mock.calls.length - 1]?.[0].onClose());
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
    });

    it('closes the dataflow editor dialog when another session is selected', () => {
        state.mode = SessionViewMode.Dataflow;
        const ScriptEditorDialog = vi.fn(() => <div data-testid="script-editor-dialog" />);
        const render = (sessionId: string) => act(() => root.render(<SessionFeedPage
            sessionScripts={{ ...scripts(), sessionId }} modifySessionScripts={vi.fn()} connection={null} active
            dependencies={{ ...dependencies, ScriptEditorDialog } as unknown as SessionFeedPageDependencies} />));
        render('session');
        act(() => state.dataflowProps.onInspect(1));
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).not.toBeNull();
        render('other');
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
        // Coming back does not reopen the dialog
        render('session');
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
    });

    it('closes the dataflow editor dialog when its script is gone', () => {
        state.mode = SessionViewMode.Dataflow;
        const ScriptEditorDialog = vi.fn(() => <div data-testid="script-editor-dialog" />);
        const render = (sessionScripts: any) => act(() => root.render(<SessionFeedPage
            sessionScripts={sessionScripts} modifySessionScripts={vi.fn()} connection={null} active
            dependencies={{ ...dependencies, ScriptEditorDialog } as unknown as SessionFeedPageDependencies} />));
        render(scripts());
        act(() => state.dataflowProps.onInspect(1));
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).not.toBeNull();
        render({ ...scripts(), scriptRefs: {}, scriptOrder: [], scripts: {} });
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
    });
});
