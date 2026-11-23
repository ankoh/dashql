import * as React from 'react';
import { act, waitForRender } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbookViewMode, WorkbookViewModeProvider, useWorkbookViewMode } from './workbook_view_mode.js';
import { WorkbookPage, type WorkbookPageDependencies } from './workbook_page.js';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { OPEN_IMPORTED_WORKBOOK, OPEN_LINK_WORKBOOK, PROMOTE_WORKBOOK, useRouteContext, useRouterNavigate, useSelectOpeningWorkbook, workbookPath } from '../app/router.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = {
    mode: 0,
    workbookId: 'workbook',
    feedMounts: 0,
    feedUnmounts: 0,
    ephemeral: false,
    pathname: '/workbooks/workbook',
    search: '',
    defaultView: 'feed',
    navigate: vi.fn(),
    setMode: vi.fn(),
};

const DEFAULT_CONNECTION = { connectionId: 'database' };
const OTHER_CONNECTION = { connectionId: 'other' };
const CONNECTIONS = new Map([['database', DEFAULT_CONNECTION], ['other', OTHER_CONNECTION]]);

const dependencies = {
    useWorkbookViewMode: () => ({ mode: state.mode, setMode: state.setMode }),
    useWorkbook: () => ({
        workbookMetadata: { ephemeral: state.ephemeral ? true : undefined }, ephemeral: state.ephemeral,
        workbookId: state.workbookId, name: 'Workbook', defaultView: state.defaultView, pendingConnectionId: 'database', nextScriptConnectionId: 'database', connectionIds: ['database'], scriptConnections: [],
        scriptKeys: [], scriptRefs: {}, scriptOrder: [],
    }),
    useDispatch: () => vi.fn(),
    useConnections: () => CONNECTIONS,
    useLogger: () => ({ warn: vi.fn() }),
    useRouteContext: () => ({ workbookId: state.workbookId }),
    useRouterNavigate: () => state.navigate,
    useLocation: () => ({ pathname: state.pathname, search: state.search }),
    WorkbookFeedPage: ({ active }: { active: boolean }) => {
        React.useEffect(() => {
            state.feedMounts += 1;
            return () => { state.feedUnmounts += 1; };
        }, []);
        return <div data-testid="feed" data-active={active} />;
    },
    WorkbookShellsPage: ({ connectionId, onPickConnection }: { connectionId: string | null; onPickConnection: (connectionId: string) => void }) => (
        <div data-testid="shell" data-connection-id={connectionId ?? ''}>
            <button type="button" data-testid="pick-other" onClick={() => onPickConnection('other')} />
        </div>
    ),
} as unknown as WorkbookPageDependencies;

describe('WorkbookPage view transitions', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        state.mode = 0;
        state.workbookId = 'workbook';
        state.feedMounts = 0;
        state.feedUnmounts = 0;
        state.ephemeral = false;
        state.pathname = '/workbooks/workbook';
        state.search = '';
        state.defaultView = 'feed';
        state.navigate.mockReset();
        state.setMode.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('moves to the path of the workbook once it is promoted', async () => {
        state.ephemeral = true;
        state.pathname = '/';
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.navigate).not.toHaveBeenCalled();

        state.ephemeral = false;
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.navigate).toHaveBeenCalledWith({ type: PROMOTE_WORKBOOK, value: 'workbook' });

        state.navigate.mockClear();
        state.pathname = workbookPath('workbook');
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.navigate).not.toHaveBeenCalled();
    });

    it('keeps the feed mounted when the root moves to the path of the workbook', async () => {
        const routed = { ...dependencies, useLocation, useRouterNavigate: () => state.navigate } as WorkbookPageDependencies;
        let navigate!: ReturnType<typeof useNavigate>;
        const Capture = () => {
            navigate = useNavigate();
            return null;
        };
        const Page = () => <WorkbookPage dependencies={routed} />;
        await act(async () => root.render(
            <MemoryRouter initialEntries={['/']}>
                <Capture />
                <Routes>
                    <Route index Component={Page} />
                    <Route path="/workbook" Component={Page} />
                    <Route path="/workbooks/:workbookId" Component={Page} />
                </Routes>
            </MemoryRouter>,
        ));
        expect(state.feedMounts).toBe(1);
        await act(async () => navigate(workbookPath('workbook'), { replace: true }));
        expect(state.feedMounts).toBe(1);
        expect(state.feedUnmounts).toBe(0);
    });

    it('keeps the feed mounted through a shell round trip', async () => {
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.feedMounts).toBe(1);
        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('true');

        state.mode = WorkbookViewMode.Shell;
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.feedUnmounts).toBe(0);
        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('false');
        expect(container.querySelector('[data-testid="shell"]')).not.toBeNull();

        state.mode = WorkbookViewMode.Workbook;
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.feedMounts).toBe(1);
        expect(state.feedUnmounts).toBe(0);
        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('true');
    });

    it('keeps the feed page mounted for the Dashboard view', async () => {
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        state.mode = WorkbookViewMode.Dashboard;
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));

        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('false');
        expect(state.feedMounts).toBe(1);
        expect(state.feedUnmounts).toBe(0);
    });

    it('reopens the shell on the picked connection until the workbook changes', async () => {
        const shellConnection = () => container.querySelector('[data-testid="shell"]')?.getAttribute('data-connection-id');
        state.mode = WorkbookViewMode.Shell;
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(shellConnection()).toBe('database');

        await act(async () => (container.querySelector('[data-testid="pick-other"]') as HTMLButtonElement).click());
        expect(shellConnection()).toBe('other');

        state.mode = WorkbookViewMode.Workbook;
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(container.querySelector('[data-testid="shell"]')).toBeNull();
        state.mode = WorkbookViewMode.Shell;
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(shellConnection()).toBe('other');

        state.workbookId = 'next';
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(shellConnection()).toBe('database');
    });

    it('opens a workbook in its default view once', async () => {
        state.defaultView = 'dashboard';
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.setMode).toHaveBeenCalledExactlyOnceWith(WorkbookViewMode.Dashboard);
        // The user picks another view, the workbook stays in it
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.setMode).toHaveBeenCalledOnce();
        // Another workbook opens in its own default view
        state.workbookId = 'next';
        state.defaultView = 'dataflow';
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.setMode).toHaveBeenLastCalledWith(WorkbookViewMode.Dataflow);
    });

    it('opens the default view of a workbook that the app loader selects', async () => {
        state.defaultView = 'dashboard';
        const routed = { ...dependencies, useLocation, useRouteContext, useRouterNavigate, useWorkbookViewMode } as WorkbookPageDependencies;
        let navigate!: ReturnType<typeof useRouterNavigate>;
        let location!: ReturnType<typeof useLocation>;
        // The app loader around the routes selects the workbook that opens
        const Loader = (props: React.PropsWithChildren) => {
            navigate = useRouterNavigate();
            location = useLocation();
            useSelectOpeningWorkbook();
            return props.children;
        };
        await act(async () => root.render(
            <MemoryRouter initialEntries={['/']}>
                <WorkbookViewModeProvider>
                    <Loader>
                        <Routes>
                            <Route index element={<div />} />
                            <Route path="/workbooks/:workbookId" element={<WorkbookPage dependencies={routed} />} />
                        </Routes>
                    </Loader>
                </WorkbookViewModeProvider>
            </MemoryRouter>,
        ));
        // The router renders a navigation in a transition, the act of the tests doesn't wait for it
        const shown = () => ({
            pathname: location.pathname,
            search: location.search,
            opening: (location.state as { openingWorkbook?: boolean } | null)?.openingWorkbook,
        });
        // A dropped file or a shared link
        await act(async () => navigate({ type: OPEN_IMPORTED_WORKBOOK, value: 'workbook' }));
        await waitForRender(() => expect(shown()).toEqual({ pathname: workbookPath('workbook'), search: '?view=dashboard', opening: false }));

        // A workbook that the app restores at its start
        state.workbookId = 'next';
        state.defaultView = 'dataflow';
        await act(async () => navigate({ type: OPEN_LINK_WORKBOOK, value: 'next' }));
        await waitForRender(() => expect(shown()).toEqual({ pathname: workbookPath('next'), search: '?view=dataflow', opening: false }));
    });

    it('keeps the view that the URL names and an open shell', async () => {
        state.defaultView = 'dashboard';
        state.search = '?view=dataflow';
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        state.search = '';
        state.mode = WorkbookViewMode.Shell;
        state.workbookId = 'next';
        await act(async () => root.render(<WorkbookPage dependencies={dependencies} />));
        expect(state.setMode).not.toHaveBeenCalled();
    });
});
