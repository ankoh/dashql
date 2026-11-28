import * as React from 'react';
import * as core from '@akohn/dashql';
import { act, waitForRender } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { DndContext, KeyboardSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Runtime } from '@akohn/dashql/runtime';
import type { EmbeddedComputeDatabase } from '@akohn/dashql/platform/embedded_database';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { analyzeWorkbook } from '@akohn/dashql/runtime/testing/test_runtime';
import { WorkbookViewsPage } from './workbook_views_page.js';
import { WorkbookViewMode, WorkbookViewModeProvider, useWorkbookViewMode, type WorkbookViewModeContextValue } from '../workbook_view_mode.js';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { AppConfigProvider, useAppConfig, type AppConfig } from '../../config/app_config.js';
import { FlavorProvider } from '../../config/flavor_provider.js';
import { DBCOM_FLAVOR } from '../../config/flavors.js';
import { EmbeddedDatabaseProvider } from '../../host/embedded_database_provider.js';
import { LoggerProvider } from '../../host/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { TestRuntime } from '../../tests/test_runtime.js';
import { addTestConnection, pendingTestChannel } from '../../tests/test_connections.js';
import { WorkbookPromptPlacement } from '../feed/workbook_prompt.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

const WORKBOOK = '00000000-0000-4000-8000-000000000501';
const trino = (endpoint: string) => ({ trino: { endpoint } }) as ConnectionParams;

type PageProps = React.ComponentProps<typeof WorkbookViewsPage>;
/// The props of a slot of the page
type SlotProps<K extends 'feed' | 'prompt' | 'dashboard' | 'dataflow' | 'workbench'> = Parameters<NonNullable<PageProps[K]>>[0];

/// The props of the last render of the stand-ins of the slots: the views need editors, charts or the storage of the app
const slots = {
    feed: null as SlotProps<'feed'> | null,
    prompt: null as SlotProps<'prompt'> | null,
    dashboard: null as SlotProps<'dashboard'> | null,
    dataflow: null as SlotProps<'dataflow'> | null,
    workbench: null as SlotProps<'workbench'> | null,
};
const STAND_INS: Pick<PageProps, 'feed' | 'prompt' | 'dashboard' | 'dataflow' | 'workbench'> = {
    feed: props => { slots.feed = props; return null; },
    prompt: props => { slots.prompt = props; return null; },
    dashboard: props => { slots.dashboard = props; return <div data-testid="dashboard" />; },
    dataflow: props => { slots.dataflow = props; return <div data-testid="dataflow" />; },
    workbench: props => { slots.workbench = props; return <nav data-testid="workbench" />; },
};

/// The label of a button of the view switch, its tooltip
function viewLabel(button: HTMLButtonElement): string | null {
    const id = button.getAttribute('aria-labelledby');
    return button.getAttribute('aria-label') ?? (id != null ? document.getElementById(id)?.textContent ?? null : null);
}

/// What the providers of a render hold
interface Captured {
    runtime: Runtime;
    viewMode: WorkbookViewModeContextValue;
    config: AppConfig | null;
}

function Capture(props: { into: Captured }) {
    props.into.runtime = useRuntime();
    props.into.viewMode = useWorkbookViewMode();
    props.into.config = useAppConfig();
    return null;
}

/// The page in the providers of the app on a runtime of the test: the app config, a router, the storage, a compute
/// database that is ready at once and the view mode
function app(into: Captured, children: React.ReactNode) {
    return (
        <LoggerProvider>
            <AppConfigProvider>
                <MemoryRouter>
                    <StorageProvider backend={new WorkbookTestBackend()}>
                        <EmbeddedDatabaseProvider setupDatabase={async () => ({ terminate: vi.fn() }) as unknown as EmbeddedComputeDatabase}>
                            <TestRuntime>
                                <WorkbookViewModeProvider>
                                    <Capture into={into} />
                                    {children}
                                </WorkbookViewModeProvider>
                            </TestRuntime>
                        </EmbeddedDatabaseProvider>
                    </StorageProvider>
                </MemoryRouter>
            </AppConfigProvider>
        </LoggerProvider>
    );
}

/// The connections of a test and a workbook with one script on the first one. `main` is a Hyper of the host, online
/// with a channel whose queries run until they are cancelled, `lake` a Trino that is not connected.
async function seed(runtime: Runtime) {
    await act(async () => {
        await addTestConnection(runtime, { connectionId: 'main', params: { hyper: {} } as ConnectionParams, health: ConnectionHealth.ONLINE, channel: pendingTestChannel() });
        await addTestConnection(runtime, { connectionId: 'lake', params: trino('http://lake') });
        runtime.createWorkbook('main', 'Workbook', false, undefined, WORKBOOK);
        runtime.dispatch({ workbook: WORKBOOK }, { kind: 'createScript', value: { text: 'select 1', base: '01_alpha' } });
        analyzeWorkbook(runtime, WORKBOOK);
    });
}

/// The page as the workbook page shows it
function Page(props: Partial<PageProps> & Pick<PageProps, 'workbookScripts' | 'connection'>) {
    const scriptConnections = new Map(props.connection == null ? [] : [[props.connection.connectionId, props.connection]]);
    return <WorkbookViewsPage modifyWorkbookScripts={vi.fn()} scriptConnections={scriptConnections}
        {...STAND_INS} {...props} />;
}

describe('WorkbookViewsPage', () => {
    let root: ReturnType<typeof createTestRoot>;
    let container: HTMLDivElement;
    const captured = {} as Captured;

    /// The workbook of the test, the view of the runtime
    const scripts = (): WorkbookScripts => captured.runtime.store.get('workbook', WORKBOOK)!;
    /// A connection of the test, the view of the runtime
    const connection = (connectionId: string): ConnectionState => captured.runtime.connection(connectionId)!;
    const mode = () => captured.viewMode.mode;
    /// The view mode is part of the URL, the router navigates in a transition
    const expectMode = (expected: WorkbookViewMode) => waitForRender(() => expect(mode()).toBe(expected));
    const setMode = async (next: WorkbookViewMode) => {
        act(() => captured.viewMode.setMode(next));
        await expectMode(next);
    };
    /// Render what is pending, e.g. a navigation that would change the view mode
    const settle = () => waitForRender(() => { });
    const show = (page: React.ReactNode) => root.render(app(captured, page));
    /// The buttons of the connections in the bar by their health
    const barConnections = () => [...container.querySelectorAll<HTMLElement>('[data-testid="workbook-connection"]')].map(button => button.dataset.health);

    beforeEach(async () => {
        for (const key of Object.keys(slots) as (keyof typeof slots)[]) slots[key] = null;
        root = createTestRoot();
        container = root.container;
        await show(null);
        await seed(captured.runtime);
    });
    afterEach(() => {
        root.unmount();
    });

    it('does not request automatic feed scrolling', async () => {
        await show(<Page workbookScripts={scripts()} connection={null} />);
        expect(slots.feed).not.toBeNull();
        expect(slots.feed).not.toHaveProperty('scrollTarget');
    });

    it('runs the workbook once its connections are idle', async () => {
        const executeAll = () => container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!;
        const render = (main: ConnectionState | null, workbook = scripts()) => show(<Page workbookScripts={workbook} connection={main} />);
        await render(null);
        expect(executeAll().disabled).toBe(true);
        // The compute database that reads the cached results is set up a moment later
        await render(connection('main'));
        await vi.waitFor(() => expect(executeAll().disabled).toBe(false));
        await render({ ...connection('main'), queriesActiveOrdered: [1] });
        expect(executeAll().disabled).toBe(true);
        // A connection that is connecting would join a moment later, the run waits for it
        await render({ ...connection('main'), connectionHealth: ConnectionHealth.CONNECTING });
        expect(executeAll().disabled).toBe(true);
        // An empty workbook has nothing to run
        await render(connection('main'), { ...scripts(), scriptOrder: [], scriptKeys: [] });
        expect(executeAll().disabled).toBe(true);
    });

    it('runs while the connections of the scripts are not connected, they serve their cached results', async () => {
        const main = connection('main');
        const lake = connection('lake');
        // The script runs on another connection than the one of the composer
        const workbook = { ...scripts(), scriptConnections: ['lake'], connectionIds: ['lake'] } as WorkbookScripts;
        await show(<Page workbookScripts={workbook} connection={main} scriptConnections={new Map([['main', main], ['lake', lake]])} />);
        const button = container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!;
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(button.getAttribute('aria-label')).toBe('Execute All');
        // The top bar shows the connections of the workbook only
        expect(barConnections()).toEqual(['NOT_STARTED']);
    });

    it('starts and stops the run of the workbook', async () => {
        await show(<Page workbookScripts={scripts()} connection={connection('main')} />);
        const executeAll = container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!;
        await vi.waitFor(() => expect(executeAll.disabled).toBe(false));
        await act(async () => executeAll.click());
        // The query of the script runs until it is cancelled
        await vi.waitFor(() => expect(container.querySelector('[data-testid="execution-status"]')?.getAttribute('data-phase')).toBe('running'));
        const stop = container.querySelector<HTMLButtonElement>('[data-testid="stop-execution"]')!;
        expect(stop).toBe(executeAll);
        await act(async () => stop.click());
        await vi.waitFor(() => expect(container.querySelector('[data-testid="execution-status"]')?.getAttribute('data-phase')).toBe('cancelled'));
        expect(container.querySelector('[data-testid="execute-all"]')).toBe(executeAll);
    });

    it('shows the attention of the connections in the bar', async () => {
        const lake = connection('lake');
        const workbook = { ...scripts(), scriptConnections: ['lake'], connectionIds: ['lake'] } as WorkbookScripts;
        const render = (active: boolean) => show(
            <WorkbookConnectionAttentionContext.Provider value={{ active, request: vi.fn() }}>
                <Page workbookScripts={workbook} connection={lake} scriptConnections={new Map([['lake', lake]])} />
            </WorkbookConnectionAttentionContext.Provider>,
        );
        const attention = () => container.querySelector('[data-testid="workbook-connection"]')!.hasAttribute('data-attention');
        await render(false);
        expect(attention()).toBe(false);
        await render(true);
        expect(attention()).toBe(true);
    });

    it('shows the connection picked for the next script in the top bar without running it', async () => {
        const lake = connection('lake');
        // An empty workbook runs nothing yet, the composer drafts its first script on the picked connection
        const workbook = { ...scripts(), scriptRefs: {}, scriptOrder: [], scriptKeys: [], scriptConnections: [], connectionIds: ['lake'], pendingConnectionId: 'lake' } as unknown as WorkbookScripts;
        await show(<Page workbookScripts={workbook} connection={lake} scriptConnections={new Map([['lake', lake]])} />);
        expect(barConnections()).toEqual(['NOT_STARTED']);
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
        const frameRoot: Root = createRoot(host);
        // The page in the frame has a runtime of its own
        const frameCaptured = {} as Captured;
        const render = (page: React.ReactNode) => act(async () => {
            frameRoot.render(app(frameCaptured, page));
            await new Promise(resolve => setTimeout(resolve, 50));
        });
        try {
            await render(null);
            await seed(frameCaptured.runtime);
            const page = () => (
                <Page workbookScripts={frameCaptured.runtime.store.get('workbook', WORKBOOK)!} connection={frameCaptured.runtime.connection('main')} />
            );
            for (const busy of [false, true]) {
                if (busy) {
                    // The query of the script runs until the runtime goes
                    const executeAll = host.querySelector<HTMLButtonElement>('[data-testid="execute-all"]')!;
                    await vi.waitFor(() => expect(executeAll.disabled).toBe(false));
                    await act(async () => executeAll.click());
                    await vi.waitFor(() => expect(host.querySelector('[data-testid="stop-execution"]')).not.toBeNull());
                }
                for (const width of [320, 375, 800, 1024, 1440]) {
                    frame.style.width = `${width}px`;
                    await render(page());
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

    it('uses one header for the workbench toggle, view switcher, and workbook actions', async () => {
        const workbookScripts = scripts();
        await show(<Page workbookScripts={workbookScripts} connection={connection('main')} />);

        const header = container.querySelector('header')!;
        expect(container.querySelectorAll('header')).toHaveLength(1);
        expect(header.querySelector('[data-testid="open-workbench"]')).not.toBeNull();
        expect(header.querySelector('[data-testid="workbook-view-switch"]')).not.toBeNull();
        // The DashQL flavor shows Export .dashql next to the menu of the workbook actions
        const menuButton = header.querySelector<HTMLButtonElement>('[data-testid="workbook-actions"]')!;
        const exportButton = header.querySelector<HTMLButtonElement>('[data-testid="export-workbook"]')!;
        expect(menuButton).not.toBeNull();
        expect(exportButton).not.toBeNull();
        expect(header.querySelector('[data-testid="share-url"]')).toBeNull();
        const exportOverlay = () => document.querySelector('button[aria-label="Save File"]');
        const shareOverlay = () => document.querySelector('input[aria-label="Workbook share URL"]');

        act(() => exportButton.click());
        expect(exportOverlay()).not.toBeNull();
        expect(exportButton.getAttribute('aria-expanded')).toBe('true');

        // The menu holds Share as URL and Export .dashql, they open at the menu button
        const action = (name: string) => document.querySelector<HTMLButtonElement>(`[data-testid="workbook-action"][data-action="${name}"]`);
        act(() => menuButton.click());
        // Attach File is experimental
        expect(action('attach')).toBeNull();
        act(() => action('share-url')!.click());
        expect(shareOverlay()).not.toBeNull();
        expect(exportOverlay()).toBeNull();
        expect(exportButton.getAttribute('aria-expanded')).toBe('false');
        act(() => menuButton.click());
        act(() => action('export')!.click());
        expect(exportOverlay()).not.toBeNull();
        expect(shareOverlay()).toBeNull();
        // The export opened from the menu, not from its button
        expect(exportButton.getAttribute('aria-expanded')).toBe('false');
        // Storage lives in the workbook row menu of the workbench
        expect(header.querySelector('[data-testid="workbook-storage"]')).toBeNull();
    });

    it('hides the workbench and shows it again from the toggle of the bar', async () => {
        // The setting of the workbench is saved in the app config, it is downloaded first
        await vi.waitFor(() => expect(captured.config).not.toBeNull());
        await show(<Page workbookScripts={scripts()} connection={connection('main')} />);
        const toggle = container.querySelector<HTMLButtonElement>('header [data-testid="workbench-toggle"]')!;
        const workbench = () => container.querySelector<HTMLElement>('[data-testid="workbench"]')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.getAttribute('aria-label')).toBe('Hide workbench');
        expect(workbench().checkVisibility()).toBe(true);

        act(() => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.getAttribute('aria-label')).toBe('Show workbench');
        // The workbench stays mounted and keeps its state, nothing takes its place
        expect(workbench().checkVisibility()).toBe(false);
        expect(container.querySelector('aside')!.getBoundingClientRect().width).toBe(0);

        act(() => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(workbench().checkVisibility()).toBe(true);
    });

    it('starts the bar with the workbench and the execution and ends it with the connections, the actions and the views, apart', async () => {
        const render = (workbookScripts: WorkbookScripts, main: ConnectionState | null) => show(<Page workbookScripts={workbookScripts} connection={main} />);
        await render(scripts(), connection('main'));
        const header = container.querySelector('header')!;
        const buttons = Array.from(header.querySelectorAll('button')).filter(button => button.dataset.testid !== 'open-workbench');
        expect(buttons[0]?.dataset.testid).toBe('workbench-toggle');
        // The groups at the start, separated: the workbench, then Execute All with its status
        const start = () => Array.from(header.children).slice(0, 3).map(child => child.getAttribute('data-testid'));
        expect(start()).toEqual(['workbook-workbench-group', 'workbook-bar-separator', 'workbook-execution-group']);
        expect(header.querySelector('[data-testid="workbook-workbench-group"] [data-testid="workbench-toggle"]')).not.toBeNull();
        expect(header.querySelector('[data-testid="workbook-execution-group"] [data-testid="execute-all"]')).not.toBeNull();
        expect(header.querySelector('[data-testid="workbook-execution-group"] [data-testid="execution-status"]')).not.toBeNull();
        // The groups at the end, separated: the connections, the actions, the views with the arrows that step through them
        const end = () => Array.from(header.querySelector('[data-testid="workbook-actions-group"], [data-testid="workbook-connections-group"]')!
            .parentElement!.children).map(child => child.getAttribute('data-testid'));
        expect(end()).toEqual(['workbook-connections-group', 'workbook-bar-separator', 'workbook-actions-group',
            'workbook-bar-separator', 'workbook-views-group']);
        expect(barConnections()).toEqual(['ONLINE']);
        expect(header.querySelector('[data-testid="workbook-actions-group"] [data-testid="workbook-actions"]')).not.toBeNull();
        expect(header.querySelector('[data-testid="workbook-views-group"] [data-testid="workbook-view-switch"]')).not.toBeNull();
        expect(buttons[buttons.length - 1]?.dataset.testid).toBe('workbook-view-next');

        // A workbook without a known connection leaves out the group of the connections and its separator
        await render(scripts(), null);
        expect(end()).toEqual(['workbook-actions-group', 'workbook-bar-separator', 'workbook-views-group']);

        // An ephemeral workbook has neither an execution nor actions, its connections and its views stay apart
        await render({ ...scripts(), ephemeral: true }, connection('main'));
        expect(start()[0]).toBe('workbook-workbench-group');
        expect(start()[1]).not.toBe('workbook-bar-separator');
        expect(end()).toEqual(['workbook-connections-group', 'workbook-bar-separator', 'workbook-views-group']);
    });

    it('hides the workbook controls while a connection overview is open', async () => {
        await show(<Page workbookScripts={scripts()} connection={connection('main')} />);
        const header = container.querySelector('header')!;
        const workbookControls = ['workbook-view-switch', 'execute-all', 'workbook-actions'];
        for (const testId of workbookControls) expect(header.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();

        act(() => slots.workbench!.onOpenOverview!('lake'));
        expect(container.querySelector('[data-testid="connection-metrics-unavailable"]')).not.toBeNull();
        for (const testId of workbookControls) expect(header.querySelector(`[data-testid="${testId}"]`)).toBeNull();
        expect(header.querySelector('[data-testid="open-workbench"]')).not.toBeNull();

        act(() => slots.workbench!.onOpenOverview!(null));
        expect(container.querySelector('[data-testid="connection-metrics-unavailable"]')).toBeNull();
        for (const testId of workbookControls) expect(header.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    });

    it('bookmarks the view that the workbook opens in', async () => {
        const modify = vi.fn();
        const render = (defaultView: string) => show(<Page workbookScripts={{ ...scripts(), defaultView } as WorkbookScripts}
            modifyWorkbookScripts={modify} connection={null} />);
        const bookmark = () => container.querySelector<HTMLButtonElement>('[data-testid="workbook-view-default"]')!;
        // The feed is the default view, it can't be bookmarked away. A name that the app doesn't know opens the feed.
        await render('feed');
        expect(bookmark().getAttribute('aria-pressed')).toBe('true');
        act(() => bookmark().click());
        expect(modify).not.toHaveBeenCalled();
        // The dashboard shows, the bookmark makes it the default view
        await setMode(WorkbookViewMode.Dashboard);
        expect(bookmark().getAttribute('aria-pressed')).toBe('false');
        act(() => bookmark().click());
        expect(modify).toHaveBeenLastCalledWith({ kind: 'setDefaultView', value: { view: 'dashboard' } });
        // The bookmarked dashboard returns the workbook to the feed
        await render('dashboard');
        expect(bookmark().getAttribute('aria-pressed')).toBe('true');
        act(() => bookmark().click());
        expect(modify).toHaveBeenLastCalledWith({ kind: 'setDefaultView', value: { view: null } });
        // The bookmark sits left of the arrow before the switch
        const previous = container.querySelector('[data-testid="workbook-view-previous"]')!;
        expect(bookmark().compareDocumentPosition(previous) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps the connections and the view switch in the header while the workbook is ephemeral', async () => {
        const ephemeral = { ...scripts(), ephemeral: true, scriptOrder: [], scriptKeys: [], scriptConnections: [], scriptRefs: {} } as unknown as WorkbookScripts;
        await show(<Page workbookScripts={ephemeral} connection={connection('main')} />);
        const header = container.querySelector('header')!;
        expect(header.querySelector('[data-testid="workbook-view-switch"]')).not.toBeNull();
        for (const control of ['execute-all', 'workbook-actions', 'export-workbook', 'workbook-view-default']) {
            expect(header.querySelector(`[data-testid="${control}"]`)).toBeNull();
        }
        expect(header.querySelector('[data-testid="open-workbench"]')).not.toBeNull();
        expect(barConnections()).toEqual(['ONLINE']);
        await settle();
        expect(mode()).toBe(WorkbookViewMode.Feed);
    });

    it.each([WorkbookViewMode.Dashboard, WorkbookViewMode.Dataflow])('stays in a view while the workbook is ephemeral (%s)', async view => {
        await setMode(view);
        const ephemeral = { ...scripts(), ephemeral: true, scriptOrder: [], scriptKeys: [], scriptConnections: [], scriptRefs: {} } as unknown as WorkbookScripts;
        await show(<Page workbookScripts={ephemeral} connection={null} />);
        await settle();
        expect(mode()).toBe(view);
        expect(container.querySelector('[data-testid="workbook-view-switch"]')).not.toBeNull();
    });

    it('hides the archive export when the flavor does not support it', async () => {
        await show(
            <FlavorProvider requested={DBCOM_FLAVOR}>
                <Page workbookScripts={scripts()} connection={connection('main')} />
            </FlavorProvider>,
        );

        const header = container.querySelector('header')!;
        expect(header.querySelector('[data-testid="export-workbook"]')).toBeNull();
        act(() => header.querySelector<HTMLButtonElement>('[data-testid="workbook-actions"]')!.click());
        const actions = [...document.querySelectorAll('[data-testid="workbook-action"]')].map(item => item.getAttribute('data-action'));
        expect(actions).toEqual(['share-url']);
    });

    it('switches between Workbook and Dashboard from the content view bar', async () => {
        await show(<Page workbookScripts={scripts()} connection={null} />);
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-view-switch"] button');
        expect(buttons[0]?.getAttribute('aria-current')).toBe('true');
        act(() => buttons[1]?.click());
        await expectMode(WorkbookViewMode.Dashboard);
    });

    it('renders the Dashboard beneath the view bar without activating the feed', async () => {
        await setMode(WorkbookViewMode.Dashboard);
        const workbookScripts = scripts();
        const modifyWorkbookScripts = vi.fn();
        // The workbook page is active in the feed only, like in the app
        await show(<Page workbookScripts={workbookScripts} modifyWorkbookScripts={modifyWorkbookScripts} connection={null} />);

        expect(container.querySelector('[data-testid="dashboard"]')).not.toBeNull();
        expect(slots.dashboard).toMatchObject({ workbookScripts, modifyWorkbookScripts });
        expect(slots.feed?.active).toBe(false);
        // The prompt shrinks to the bar of Wobble over the dashboard
        expect(slots.prompt?.placement).toBe(WorkbookPromptPlacement.Overlay);
        const switchButtons = () => container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-view-switch"] button');
        expect(switchButtons()[1]?.getAttribute('aria-current')).toBe('true');
        // A connection overview hides the bar with the dashboard
        act(() => slots.workbench!.onOpenOverview!('lake'));
        expect(slots.prompt?.placement).toBe(WorkbookPromptPlacement.Hidden);
        act(() => slots.workbench!.onOpenOverview!(null));
        act(() => switchButtons()[0]?.click());
        await expectMode(WorkbookViewMode.Feed);
    });

    it('leaves the feed and the prompt inactive while the shell is open', async () => {
        await show(<Page workbookScripts={scripts()} connection={null} />);
        expect(slots.feed?.active).toBe(true);
        await setMode(WorkbookViewMode.Shell);
        expect(slots.feed?.active).toBe(false);
        expect(slots.prompt?.placement).toBe(WorkbookPromptPlacement.Hidden);
        await setMode(WorkbookViewMode.Feed);
        expect(slots.feed?.active).toBe(true);
    });

    it('connects the prompt over the views with the feed', async () => {
        const workbookScripts = scripts();
        await show(<Page workbookScripts={workbookScripts} connection={null} />);
        expect(slots.prompt?.placement).toBe(WorkbookPromptPlacement.Feed);
        expect(slots.prompt?.workbookScripts).toBe(workbookScripts);
        // The feed keeps the height of the docked prompt free below its last script
        act(() => slots.prompt!.onHeight!(96));
        expect(slots.feed?.bottomInset).toBe(96);
        // The feed gets what the prompt asks of it and the prompt of the feed
        const feed = { follow: vi.fn(), show: vi.fn(), followAgent: vi.fn(), appended: vi.fn() };
        (slots.feed!.handleRef as unknown as React.RefObject<typeof feed>).current = feed;
        slots.prompt!.feed.follow(1, 'result');
        slots.prompt!.feed.followAgent();
        slots.prompt!.feed.appended(1);
        expect(feed.follow).toHaveBeenCalledExactlyOnceWith(1, 'result');
        expect(feed.followAgent).toHaveBeenCalledOnce();
        expect(feed.appended).toHaveBeenCalledOnce();
        expect(slots.feed!.promptRef).toBe(slots.prompt!.handleRef);
    });

    it('shows the composer in the feed and shrinks it over the other views until a click on the bar', async () => {
        await show(<Page workbookScripts={scripts()} connection={null} />);
        expect(slots.prompt?.expanded).toBe(true);
        act(() => slots.prompt!.onExpandedChange!(false));
        expect(slots.prompt?.expanded).toBe(false);
        // A switch of the view returns the composer to the default of the view
        await setMode(WorkbookViewMode.Dashboard);
        expect(slots.prompt).toMatchObject({ placement: WorkbookPromptPlacement.Overlay, expanded: false });
        act(() => slots.prompt!.onExpandedChange!(true));
        expect(slots.prompt?.expanded).toBe(true);
        await setMode(WorkbookViewMode.Dataflow);
        expect(slots.prompt?.expanded).toBe(false);
        await setMode(WorkbookViewMode.Feed);
        expect(slots.prompt?.expanded).toBe(true);
    });

    it('shows a script that the prompt appended in the dashboard and the dataflow', async () => {
        const feed = { follow: vi.fn(), show: vi.fn(), followAgent: vi.fn(), appended: vi.fn() };
        const showView = async (view: WorkbookViewMode) => {
            await setMode(view);
            (slots.feed!.handleRef as unknown as React.RefObject<typeof feed>).current = feed;
        };
        await show(<Page workbookScripts={scripts()} connection={null} />);
        // The feed scrolls to an appended script itself
        await showView(WorkbookViewMode.Feed);
        act(() => slots.prompt!.feed.appended(1));
        expect(feed.appended).toHaveBeenLastCalledWith(1);

        await showView(WorkbookViewMode.Dashboard);
        expect(slots.dashboard?.revealRequest).toBeNull();
        act(() => slots.prompt!.feed.appended(2));
        expect(slots.dashboard?.revealRequest).toMatchObject({ scriptKey: 2 });
        // The hidden feed still scrolls to its end
        expect(feed.appended).toHaveBeenLastCalledWith(2);

        // The dataflow keeps the prompt over its bottom free, a switch of the view drops the request
        await showView(WorkbookViewMode.Dataflow);
        expect(slots.dataflow?.revealRequest).toBeNull();
        act(() => slots.prompt!.onHeight!(180));
        expect(slots.dataflow?.bottomInset?.()).toBe(180);
        act(() => slots.prompt!.feed.appended(3));
        expect(slots.dataflow?.revealRequest).toMatchObject({ scriptKey: 3 });
        await showView(WorkbookViewMode.Dashboard);
        expect(slots.dashboard?.revealRequest).toBeNull();
    });

    it('shows a script that the user picks in the log of the agent in the feed', async () => {
        await setMode(WorkbookViewMode.Dashboard);
        await show(<Page workbookScripts={scripts()} connection={null} />);
        // The prompt shrunk over the dashboard keeps the space of the docked prompt in the hidden feed
        act(() => slots.prompt!.onHeight!(40));
        expect(slots.feed?.bottomInset).toBe(0);
        const showScript = vi.fn();
        (slots.feed!.handleRef as unknown as React.RefObject<{ show: typeof showScript }>).current = { show: showScript };
        act(() => slots.prompt!.feed.show(1));
        await expectMode(WorkbookViewMode.Feed);
        expect(showScript).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('steps through the views with the arrow keys and the arrows beside the switch', async () => {
        await setMode(WorkbookViewMode.Dashboard);
        await show(<Page workbookScripts={scripts()} connection={null} />);
        const press = (key: string, target: EventTarget = document.body) => act(() => {
            target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        });
        press('ArrowRight');
        await expectMode(WorkbookViewMode.Dataflow);
        press('ArrowLeft');
        await expectMode(WorkbookViewMode.Dashboard);

        // Text and a key with a modifier keep their arrow keys
        const input = document.createElement('input');
        container.appendChild(input);
        press('ArrowLeft', input);
        act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true })); });
        await settle();
        expect(mode()).toBe(WorkbookViewMode.Dashboard);

        const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
        act(() => button('workbook-view-next').click());
        await expectMode(WorkbookViewMode.Dataflow);
        act(() => button('workbook-view-previous').click());
        await expectMode(WorkbookViewMode.Dashboard);
        act(() => button('workbook-view-previous').click());
        await expectMode(WorkbookViewMode.Feed);

        // The feed is the first view, nothing is left of it
        expect(button('workbook-view-previous').disabled).toBe(true);
        press('ArrowLeft');
        await settle();
        expect(mode()).toBe(WorkbookViewMode.Feed);
    });

    it('keeps the arrow keys for a card that the keyboard drags', async () => {
        await setMode(WorkbookViewMode.Dashboard);
        const onDragEnd = vi.fn();
        // A card of the dashboard with its drag handle, dragged by the keyboard sensor of dnd-kit
        const Card = () => {
            const draggable = useDraggable({ id: 1 });
            return (
                <div ref={draggable.setNodeRef}>
                    <button type="button" data-testid="drag-handle" {...draggable.listeners} {...draggable.attributes} />
                </div>
            );
        };
        const Dashboard = () => {
            const sensors = useSensors(useSensor(KeyboardSensor));
            return <DndContext sensors={sensors} onDragEnd={onDragEnd}><Card /></DndContext>;
        };
        await show(<Page workbookScripts={scripts()} connection={null} dashboard={() => <Dashboard />} />);
        const handle = container.querySelector<HTMLButtonElement>('[data-testid="drag-handle"]')!;
        const press = (key: string, code: string) => act(() => {
            handle.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
        });
        act(() => handle.focus());
        press(' ', 'Space');
        // The sensor listens to the keys of the drag after a timeout
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
        expect(handle.getAttribute('aria-pressed')).toBe('true');
        press('ArrowRight', 'ArrowRight');
        await settle();
        expect(mode()).toBe(WorkbookViewMode.Dashboard);
        press(' ', 'Space');
        await vi.waitFor(() => expect(onDragEnd).toHaveBeenCalledOnce());

        // Once the card is dropped, the arrow keys switch the views again
        press('ArrowRight', 'ArrowRight');
        await expectMode(WorkbookViewMode.Dataflow);
    });

    it('offers the Dataflow view after the Dashboard', async () => {
        await show(<Page workbookScripts={scripts()} connection={null} />);
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-view-switch"] button');
        expect([...buttons].map(viewLabel)).toEqual(['Feed', 'Dashboard', 'Dataflow']);
        act(() => buttons[2]?.click());
        await expectMode(WorkbookViewMode.Dataflow);
    });

    it('renders the Dataflow beneath the view bar without activating the feed', async () => {
        await setMode(WorkbookViewMode.Dataflow);
        const workbookScripts = scripts();
        const modifyWorkbookScripts = vi.fn();
        await show(<Page workbookScripts={workbookScripts} modifyWorkbookScripts={modifyWorkbookScripts} connection={null} />);
        expect(container.querySelector('[data-testid="dataflow"]')).not.toBeNull();
        expect(slots.dataflow).toMatchObject({ workbookScripts, modifyWorkbookScripts });
        expect(slots.feed?.active).toBe(false);
        expect(slots.prompt?.placement).toBe(WorkbookPromptPlacement.Overlay);
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="workbook-view-switch"] button');
        expect(buttons[2]?.getAttribute('aria-current')).toBe('true');
        // A connection overview covers the dataflow
        act(() => slots.workbench!.onOpenOverview!('lake'));
        expect(container.querySelector('[data-testid="dataflow"]')).toBeNull();
    });
});
