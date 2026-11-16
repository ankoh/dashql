import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbookFeedPage, type WorkbookFeedPageDependencies } from './workbook_feed_page.js';
import { WorkbookViewMode } from '../workbook_view_mode.js';
import { SegmentedControl } from '../../ui/foundations/segmented_control.js';
import { Button } from '../../ui/foundations/button.js';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { WorkbookConnectionAttentionContext } from '../workbook_connection_attention.js';
import { FlavorProvider } from '../../config/flavor_provider.js';
import { DBCOM_FLAVOR } from '../../config/flavors.js';
import { scriptSelectionOf } from '../scripts/script_selection.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = {
    feedProps: null as any,
    mode: WorkbookViewMode.Workbook,
    setMode: vi.fn(),
    dashboardProps: null as any,
    dataflowProps: null as any,
    shareProps: null as any,
    exportProps: null as any,
    sidebarProps: null as any,
    attention: null as any,
    connectionButtonsProps: null as any,
    execution: { state: null, busy: false, ready: true, start: vi.fn(), stop: vi.fn() } as any,
};
const dependencies = {
    WorkbookFeed: (props: any) => {
        state.attention = React.useContext(WorkbookConnectionAttentionContext);
        state.feedProps = props;
        return null;
    },
    ScriptEditorDialog: () => null,
    WorkbookWorkbenchSidebar: (props: any) => {
        state.sidebarProps = props;
        return null;
    },
    ConnectionOverviewPage: () => null,
    CloudOverviewPage: () => null,
    WorkbookStatusBar: (props: any) => <div data-testid="workbook-status-bar" data-variant={props.variant} />,
    WorkbookNavigationDrawer: () => null,
    ThreeBarsIcon: () => null,
    IconButton: React.forwardRef((props: any, ref: React.ForwardedRef<HTMLButtonElement>) => <button {...props} ref={ref} />),
    Button,
    WorkbookURLShareOverlay: (props: any) => {
        state.shareProps = props;
        return null;
    },
    WorkbookFileSaveOverlay: (props: any) => {
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
    WorkbookConnectionButtons: (props: any) => {
        state.connectionButtonsProps = props;
        return null;
    },
    useWorkbookViewMode: () => ({ mode: state.mode, setMode: state.setMode }),
    SegmentedControl,
    useWorkbookExecution: () => state.execution,
    CloudWorkbookLoadingCard: () => null,
} as unknown as WorkbookFeedPageDependencies;

/// The label of a button of the view switch, its tooltip
function viewLabel(button: HTMLButtonElement): string | null {
    const id = button.getAttribute('aria-labelledby');
    return button.getAttribute('aria-label') ?? (id != null ? document.getElementById(id)?.textContent ?? null : null);
}

function scripts() {
    return {
        workbookId: 'workbook',
        workbookMetadata: { originalFileName: 'workbook' },
        scriptRefs: {
            '01_alpha.sql': { scriptId: 1, fileName: '01_alpha.sql' },
        },
        scriptOrder: ['01_alpha.sql'],
        scriptKeys: [1],
        scriptConnections: ['main'],
        connectionIds: ['main'],
        pendingConnectionId: null,
    } as any;
}

describe('WorkbookFeedPage', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        state.feedProps = null;
        state.dataflowProps = null;
        state.mode = WorkbookViewMode.Workbook;
        state.setMode.mockReset();
        state.dashboardProps = null;
        state.shareProps = null;
        state.exportProps = null;
        state.connectionButtonsProps = null;
        state.execution = { state: null, busy: false, ready: true, start: vi.fn(), stop: vi.fn() };
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
            <WorkbookFeedPage
                workbookScripts={scripts()}
                modifyWorkbookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(state.feedProps).not.toHaveProperty('scrollTarget');
    });

    it('starts all scripts when idle', () => {
        const modify = vi.fn();
        const render = (connection: any) => act(() => root.render(<WorkbookFeedPage
            workbookScripts={scripts()} modifyWorkbookScripts={modify} connection={connection} active dependencies={dependencies} />));
        render(null);
        expect(container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')?.disabled).toBe(true);
        render({ connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE, queriesActiveOrdered: [] });
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!.click());
        expect(state.execution.start).toHaveBeenCalledWith();
        render({ connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE, queriesActiveOrdered: [1] });
        expect(container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')?.disabled).toBe(true);
        // A connection that is connecting would join a moment later, the run waits for it
        render({ connectionId: 'main', connectionHealth: ConnectionHealth.CONNECTING, queriesActiveOrdered: [] });
        expect(container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')?.disabled).toBe(true);
    });

    it('runs while the connections of the scripts are not connected, they serve their cached results', () => {
        const modify = vi.fn();
        const main = { connectionId: 'main', connectionHealth: ConnectionHealth.ONLINE, queriesActiveOrdered: [] } as any;
        const lake = { connectionId: 'lake', connectionHealth: ConnectionHealth.NOT_STARTED, queriesActiveOrdered: [] } as any;
        const unused = { connectionId: 'unused', connectionHealth: ConnectionHealth.NOT_STARTED, queriesActiveOrdered: [] } as any;
        const workbook = scripts();
        workbook.scriptConnections = ['lake'];
        workbook.connectionIds = ['lake'];
        const render = (connections: any[]) => act(() => root.render(<WorkbookFeedPage
            workbookScripts={workbook} modifyWorkbookScripts={modify} connection={main}
            scriptConnections={new Map(connections.map(connection => [connection.connectionId, connection]))} active dependencies={dependencies} />));
        // The connection of the composer is online, the script runs on another one
        render([main, lake, unused]);
        const button = container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!;
        expect(button.disabled).toBe(false);
        expect(button.getAttribute('aria-label')).toBe('Execute All');
        // The top bar shows the connections of the workbook only
        expect(state.connectionButtonsProps.connections).toEqual([lake]);
        act(() => button.click());
        expect(state.execution.start).toHaveBeenCalledWith();
        // While a script of the workbook runs, the workbook doesn't run
        state.execution = { ...state.execution, start: vi.fn(), runActive: true };
        render([main, lake, unused]);
        expect(button.disabled).toBe(true);
        // Nor before the compute database that reads the cached results is set up
        state.execution = { ...state.execution, runActive: false, ready: false };
        render([main, lake, unused]);
        expect(button.disabled).toBe(true);
    });

    it('points at the connections once a run skipped the scripts that need them', async () => {
        const lake = { connectionId: 'lake', connectionHealth: ConnectionHealth.NOT_STARTED, queriesActiveOrdered: [] } as any;
        const workbook = scripts();
        workbook.scriptConnections = ['lake'];
        workbook.connectionIds = ['lake'];
        const render = (phase: string, skippedScripts: number, connection = lake) => {
            state.execution = { ...state.execution, busy: phase === 'running', state: {
                phase, completedScripts: 3, totalScripts: 5, completedStatements: 3, totalStatements: 3,
                activeFileName: null, activeStatementIndex: null, activeStatementCount: null, error: null, skippedScripts,
                skippedFiles: ['2.sql', '3.sql'].slice(0, skippedScripts),
            } };
            act(() => root.render(<WorkbookFeedPage workbookScripts={workbook} modifyWorkbookScripts={vi.fn()} connection={connection}
                scriptConnections={new Map([['lake', connection]])} active dependencies={dependencies} />));
        };
        const status = () => container.querySelector('[data-testid="execution-status"]')!;
        // A run that settled before the page mounted points at nothing
        render('succeeded', 2);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(state.attention.active).toBe(false);
        render('running', 2);
        expect(state.attention.active).toBe(false);
        render('succeeded', 2);
        expect(status().textContent).toContain('3/5 completed · 2 need a connection');
        expect(status().getAttribute('title')).toBe('Need a connection: 2.sql, 3.sql');
        // The request lands with the commit of the settled run, the attention lasts a while
        await vi.waitFor(() => expect(state.attention.active).toBe(true));
        // The attention clears once the connection changes its health
        render('succeeded', 2, { ...lake, connectionHealth: ConnectionHealth.CONNECTING });
        expect(state.attention.active).toBe(false);
        // A run that skipped nothing succeeded
        render('succeeded', 0);
        expect(status().textContent).toContain('3/5 succeeded');
    });

    it('shows the connection picked for the next script in the top bar without running it', () => {
        const lake = { connectionId: 'lake', connectionHealth: ConnectionHealth.NOT_STARTED, queriesActiveOrdered: [] } as any;
        // An empty workbook runs nothing yet, the composer drafts its first script on the picked connection
        const workbook = { ...scripts(), scriptRefs: {}, scriptOrder: [], scriptKeys: [], scriptConnections: [], connectionIds: ['lake'], pendingConnectionId: 'lake' };
        act(() => root.render(<WorkbookFeedPage
            workbookScripts={workbook} modifyWorkbookScripts={vi.fn()} connection={lake}
            scriptConnections={new Map([['lake', lake]])} active dependencies={dependencies} />));
        expect(state.connectionButtonsProps.connections).toEqual([lake]);
        const button = container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!;
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-label')).toBe('Execute All');
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
                    state.execution = { busy, ready: true, start: vi.fn(), stop: vi.fn(), state: busy ? {
                        phase: 'running', completedScripts: 123, totalScripts: 456,
                        completedStatements: 123, totalStatements: 456, error: null, skippedScripts: 0, skippedFiles: [],
                    } : null };
                    await act(async () => {
                        frameRoot.render(<WorkbookFeedPage workbookScripts={scripts()} modifyWorkbookScripts={vi.fn()}
                            connection={null} active dependencies={dependencies} />);
                        await new Promise(resolve => setTimeout(resolve, 50));
                    });
                    const header = host.querySelector('header')!;
                    const bounds = header.getBoundingClientRect();
                    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
                    const controls = [host.querySelector('[data-testid="workbook-view-switch"]')!,
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

    it('shows the execution progress and stops the running workbook', () => {
        state.execution = { busy: true, start: vi.fn(), stop: vi.fn(), state: {
            phase: 'running', completedScripts: 2, totalScripts: 5, completedStatements: 4, totalStatements: 9,
            activeFileName: '3_customers.sql', activeStatementIndex: 2, activeStatementCount: 3, error: null,
            skippedScripts: 0, skippedFiles: [],
        } };
        const render = () => act(() => root.render(<WorkbookFeedPage workbookScripts={scripts()}
            modifyWorkbookScripts={vi.fn()} connection={null} active dependencies={dependencies} />));
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
            completedStatements: 1, totalStatements: 9, error: null, skippedScripts: 0, skippedFiles: [],
        } };
        const render = () => act(() => root.render(<WorkbookFeedPage workbookScripts={scripts()}
            modifyWorkbookScripts={vi.fn()} connection={null} active dependencies={dependencies} />));
        render();
        const indicator = container.querySelector('[data-testid="execution-indicator"] svg');
        expect(indicator).not.toBeNull();
        state.execution.state = { ...state.execution.state, completedScripts: 2, completedStatements: 4 };
        render();
        expect(container.querySelector('[data-testid="execution-indicator"] svg')).toBe(indicator);
    });

    it('uses one header for the workbench toggle, view switcher, and workbook actions', () => {
        const workbookScripts = scripts();
        const connection = { connectionId: 'database' } as any;
        act(() => root.render(
            <WorkbookFeedPage
                workbookScripts={workbookScripts}
                modifyWorkbookScripts={vi.fn()}
                connection={connection}
                active
                dependencies={dependencies}
            />,
        ));

        const header = container.querySelector('header')!;
        expect(container.querySelectorAll('header')).toHaveLength(1);
        expect(header.querySelector('[data-testid="open-workbench"]')).not.toBeNull();
        expect(header.querySelector('[data-testid="workbook-view-switch"]')).not.toBeNull();
        const shareButton = header.querySelector<HTMLButtonElement>('[data-testid="share-url"]')!;
        const exportButton = header.querySelector<HTMLButtonElement>('[data-testid="export-workbook"]')!;
        for (const button of [shareButton, exportButton]) {
            expect(button).not.toBeNull();
        }

        act(() => shareButton.click());
        expect(state.shareProps).toMatchObject({ workbookId: 'workbook', isOpen: true });
        expect(state.shareProps.anchorRef.current).toBe(shareButton);
        expect(shareButton.getAttribute('aria-expanded')).toBe('true');

        act(() => exportButton.click());
        expect(state.exportProps).toMatchObject({ workbookScripts, isOpen: true });
        expect(state.exportProps.anchorRef.current).toBe(exportButton);
        expect(exportButton.getAttribute('aria-expanded')).toBe('true');
        // Storage lives in the workbook row menu of the workbench
        expect(header.querySelector('[data-testid="workbook-storage"]')).toBeNull();
    });

    it('hides the workbook controls while a connection overview is open', () => {
        act(() => root.render(
            <WorkbookFeedPage
                workbookScripts={scripts()}
                modifyWorkbookScripts={vi.fn()}
                connection={{ connectionId: 'database' } as any}
                active
                dependencies={dependencies}
            />,
        ));
        const header = container.querySelector('header')!;
        const workbookControls = ['workbook-view-switch', 'execute-all', 'share-url'];
        for (const testId of workbookControls) expect(header.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();

        act(() => state.sidebarProps.onOpenOverview('database'));
        for (const testId of workbookControls) expect(header.querySelector(`[data-testid="${testId}"]`)).toBeNull();
        expect(header.querySelector('[data-testid="open-workbench"]')).not.toBeNull();

        act(() => state.sidebarProps.onOpenOverview(null));
        for (const testId of workbookControls) expect(header.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    });

    it('keeps only the connections in the header while the workbook is ephemeral', () => {
        const ephemeral = { ...scripts(), workbookMetadata: { ephemeral: true }, ephemeral: true, scriptOrder: [], scriptKeys: [], scriptConnections: [], scriptRefs: {} };
        act(() => root.render(<WorkbookFeedPage workbookScripts={ephemeral} modifyWorkbookScripts={vi.fn()} connection={null} active dependencies={dependencies} />));
        const header = container.querySelector('header')!;
        for (const control of ['workbook-view-switch', 'execute-all', 'share-url', 'export-workbook']) {
            expect(header.querySelector(`[data-testid="${control}"]`)).toBeNull();
        }
        expect(header.querySelector('[data-testid="open-workbench"]')).not.toBeNull();
        expect(state.connectionButtonsProps).not.toBeNull();
        expect(state.setMode).not.toHaveBeenCalled();
    });

    it.each([WorkbookViewMode.Dashboard, WorkbookViewMode.Dataflow])('leaves a view without a switch while the workbook is ephemeral (%s)', mode => {
        state.mode = mode;
        const ephemeral = { ...scripts(), workbookMetadata: { ephemeral: true }, ephemeral: true, scriptOrder: [], scriptKeys: [], scriptConnections: [], scriptRefs: {} };
        act(() => root.render(<WorkbookFeedPage workbookScripts={ephemeral} modifyWorkbookScripts={vi.fn()} connection={null} active dependencies={dependencies} />));
        expect(state.setMode).toHaveBeenCalledWith(WorkbookViewMode.Workbook);
    });

    it('hides the archive export when the flavor does not support it', () => {
        act(() => root.render(
            <FlavorProvider requested={DBCOM_FLAVOR}>
                <WorkbookFeedPage
                    workbookScripts={scripts()}
                    modifyWorkbookScripts={vi.fn()}
                    connection={{ connectionId: 'database' } as any}
                    active
                    dependencies={dependencies}
                />
            </FlavorProvider>,
        ));

        const header = container.querySelector('header')!;
        expect(header.querySelector('[data-testid="share-url"]')).not.toBeNull();
        expect(header.querySelector('[data-testid="export-workbook"]')).toBeNull();
    });

    it('switches between Workbook and Dashboard from the content view bar', () => {
        act(() => root.render(
            <WorkbookFeedPage
                workbookScripts={scripts()}
                modifyWorkbookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-view-switch"] button');
        expect(buttons[0]?.getAttribute('aria-current')).toBe('true');
        act(() => buttons[1]?.click());
        expect(state.setMode).toHaveBeenCalledWith(WorkbookViewMode.Dashboard);
    });

    it('renders the Dashboard beneath the view bar without activating the feed', () => {
        state.mode = WorkbookViewMode.Dashboard;
        const workbookScripts = scripts();
        const modifyWorkbookScripts = vi.fn();
        act(() => root.render(
            <WorkbookFeedPage
                workbookScripts={workbookScripts}
                modifyWorkbookScripts={modifyWorkbookScripts}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelector('[data-testid="dashboard"]')).not.toBeNull();
        expect(state.dashboardProps).toMatchObject({ workbookScripts, modifyWorkbookScripts });
        expect(state.feedProps.active).toBe(false);
        // The bar of Wobble stands alone below the dashboard, the feed has the bar on its prompt
        expect(container.querySelector('[data-testid="workbook-status-bar"]')?.getAttribute('data-variant')).toBe('standalone');
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-view-switch"] button');
        expect(buttons[1]?.getAttribute('aria-current')).toBe('true');
        act(() => buttons[0]?.click());
        expect(state.setMode).toHaveBeenCalledWith(WorkbookViewMode.Workbook);
    });

    it('offers the Dataflow view after the Dashboard', () => {
        act(() => root.render(
            <WorkbookFeedPage workbookScripts={scripts()} modifyWorkbookScripts={vi.fn()} connection={null} active dependencies={dependencies} />,
        ));
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-view-switch"] button');
        expect([...buttons].map(viewLabel)).toEqual(['Feed', 'Dashboard', 'Dataflow']);
        act(() => buttons[2]?.click());
        expect(state.setMode).toHaveBeenCalledWith(WorkbookViewMode.Dataflow);
    });

    it('renders the Dataflow canvas and opens a script in the editor dialog', () => {
        state.mode = WorkbookViewMode.Dataflow;
        const workbookScripts = scripts();
        const modifyWorkbookScripts = vi.fn();
        const ScriptEditorDialog = vi.fn((_props: any) => <div data-testid="script-editor-dialog" />);
        act(() => root.render(
            <WorkbookFeedPage workbookScripts={workbookScripts} modifyWorkbookScripts={modifyWorkbookScripts} connection={null} active
                dependencies={{ ...dependencies, ScriptEditorDialog } as unknown as WorkbookFeedPageDependencies} />,
        ));
        expect(container.querySelector('[data-testid="dataflow"]')).not.toBeNull();
        expect(state.dataflowProps).toMatchObject({ workbookScripts, modifyWorkbookScripts });
        expect(state.feedProps.active).toBe(false);
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-view-switch"] button');
        expect([...buttons].map(viewLabel)).toEqual(['Feed', 'Dashboard', 'Dataflow']);
        expect(buttons[2]?.getAttribute('aria-current')).toBe('true');

        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
        act(() => state.dataflowProps.onInspect(1));
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).not.toBeNull();
        expect(ScriptEditorDialog.mock.calls[ScriptEditorDialog.mock.calls.length - 1]?.[0].scriptKey).toBe(1);
        // The dialog selects its script, the commands of the workbook run it
        expect(scriptSelectionOf(null).store.current.get(workbookScripts.workbookId)).toBe(1);
        act(() => ScriptEditorDialog.mock.calls[ScriptEditorDialog.mock.calls.length - 1]?.[0].onClose());
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
    });

    it('closes the dataflow editor dialog when another workbook is selected', () => {
        state.mode = WorkbookViewMode.Dataflow;
        const ScriptEditorDialog = vi.fn(() => <div data-testid="script-editor-dialog" />);
        const render = (workbookId: string) => act(() => root.render(<WorkbookFeedPage
            workbookScripts={{ ...scripts(), workbookId }} modifyWorkbookScripts={vi.fn()} connection={null} active
            dependencies={{ ...dependencies, ScriptEditorDialog } as unknown as WorkbookFeedPageDependencies} />));
        render('workbook');
        act(() => state.dataflowProps.onInspect(1));
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).not.toBeNull();
        render('other');
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
        // Coming back does not reopen the dialog
        render('workbook');
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
    });

    it('closes the dataflow editor dialog when its script is gone', () => {
        state.mode = WorkbookViewMode.Dataflow;
        const ScriptEditorDialog = vi.fn(() => <div data-testid="script-editor-dialog" />);
        const render = (workbookScripts: any) => act(() => root.render(<WorkbookFeedPage
            workbookScripts={workbookScripts} modifyWorkbookScripts={vi.fn()} connection={null} active
            dependencies={{ ...dependencies, ScriptEditorDialog } as unknown as WorkbookFeedPageDependencies} />));
        render(scripts());
        act(() => state.dataflowProps.onInspect(1));
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).not.toBeNull();
        render({ ...scripts(), scriptRefs: {}, scriptOrder: [], scriptKeys: [], scriptConnections: [] });
        expect(container.querySelector('[data-testid="script-editor-dialog"]')).toBeNull();
    });
});
