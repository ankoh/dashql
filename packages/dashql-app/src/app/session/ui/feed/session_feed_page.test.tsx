import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionFeedPage, type SessionFeedPageDependencies } from './session_feed_page.js';
import { SessionViewMode } from '../session_view_mode.js';
import { SegmentedControl } from '../../../../ui/foundations/segmented_control.js';
import { Button } from '../../../../ui/foundations/button.js';
import { ConnectionHealth } from '../../../connections/connection_state.js';
import { SessionConnectionAttentionContext } from '../session_connection_attention.js';
import { FlavorProvider } from '../../../flavor/flavor_provider.js';
import { SIDB_FLAVOR } from '../../../flavor/flavors.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = {
    feedProps: null as any,
    dashboardsEnabled: false,
    mode: SessionViewMode.Session,
    setMode: vi.fn(),
    dashboardProps: null as any,
    shareProps: null as any,
    exportProps: null as any,
    sidebarProps: null as any,
    attention: null as any,
    connectionButtonsProps: null as any,
    settingsProps: null as any,
    execution: { state: null, busy: false, start: vi.fn(), stop: vi.fn() } as any,
};
const dependencies = {
    SessionFeed: (props: any) => {
        state.attention = React.useContext(SessionConnectionAttentionContext);
        state.feedProps = props;
        return null;
    },
    ScriptDetails: () => null,
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
    SessionConnectionButtons: (props: any) => {
        state.connectionButtonsProps = props;
        return null;
    },
    ConnectionSettingsOverlay: (props: any) => {
        state.settingsProps = props;
        return null;
    },
    useSessionViewMode: () => ({ mode: state.mode, setMode: state.setMode }),
    useAppConfig: () => ({ settings: { experimental_dashboards: state.dashboardsEnabled } }),
    SegmentedControl,
    useSessionExecution: () => state.execution,
} as unknown as SessionFeedPageDependencies;

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
        state.dashboardsEnabled = false;
        state.mode = SessionViewMode.Session;
        state.setMode.mockReset();
        state.dashboardProps = null;
        state.shareProps = null;
        state.exportProps = null;
        state.connectionButtonsProps = null;
        state.settingsProps = null;
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
        // The top bar shows the connections of the scripts only
        expect(state.connectionButtonsProps.connections).toEqual([lake]);
        act(() => button.click());
        expect(state.execution.start).not.toHaveBeenCalled();
        expect(state.settingsProps.connectionId).toBe('lake');
        // Once connected the session runs
        const online = { ...lake, connectionHealth: ConnectionHealth.ONLINE };
        render([main, online, unused]);
        expect(state.connectionButtonsProps.connections).toEqual([online]);
        expect(button.getAttribute('aria-label')).toBe('Execute All');
        act(() => button.click());
        expect(state.execution.start).toHaveBeenCalledWith(modify);
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
        state.dashboardsEnabled = true;
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
        state.dashboardsEnabled = true;
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
        state.dashboardsEnabled = true;
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

    it('keeps the single action header when dashboards are disabled', () => {
        act(() => root.render(
            <SessionFeedPage
                sessionScripts={scripts()}
                modifySessionScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelectorAll('header')).toHaveLength(1);
        expect(container.querySelector('header [data-testid="session-view-switch"]')).toBeNull();
        expect(container.querySelector('header [data-testid="share-url"]')).not.toBeNull();
    });

    it('hides the Dashboard switch by default', () => {
        act(() => root.render(
            <SessionFeedPage
                sessionScripts={scripts()}
                modifySessionScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelector('[data-testid="session-view-switch"]')).toBeNull();
        expect(container.querySelector('[data-testid="dashboard"]')).toBeNull();
        expect(state.feedProps.active).toBe(true);
    });

    it('does not render a Dashboard requested while disabled', () => {
        state.mode = SessionViewMode.Dashboard;
        act(() => root.render(
            <SessionFeedPage
                sessionScripts={scripts()}
                modifySessionScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelector('[data-testid="dashboard"]')).toBeNull();
        expect(state.feedProps.active).toBe(true);
    });

    it('switches between Session and Dashboard from the content view bar when enabled', () => {
        state.dashboardsEnabled = true;
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
        state.dashboardsEnabled = true;
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

    it('closes the script details when another session is selected', () => {
        const ScriptDetails = vi.fn(() => <div data-testid="script-details" />);
        const render = (sessionId: string) => act(() => root.render(<SessionFeedPage
            sessionScripts={{ ...scripts(), sessionId }} modifySessionScripts={vi.fn()} connection={null} active
            dependencies={{ ...dependencies, ScriptDetails } as unknown as SessionFeedPageDependencies} />));
        render('session');
        act(() => state.feedProps.showDetails('01_alpha.sql'));
        expect(container.querySelector('[data-testid="script-details"]')).not.toBeNull();
        expect(state.feedProps.active).toBe(false);
        render('other');
        expect(container.querySelector('[data-testid="script-details"]')).toBeNull();
        expect(state.feedProps.active).toBe(true);
    });
});
