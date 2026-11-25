import * as React from 'react';
import { act, waitForRender } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry, type Location } from 'react-router-dom';
import * as core from '@akohn/dashql';

import type { Runtime } from '@akohn/dashql/runtime/runtime';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { LoggerProvider } from '../host/logger_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { TestRuntime } from '../tests/test_runtime.js';
import { addTestConnection } from '../tests/test_connections.js';
import { WorkbookViewMode, WorkbookViewModeProvider, useWorkbookViewMode, type WorkbookViewModeContextValue } from './workbook_view_mode.js';
import { WorkbookPage } from './workbook_page.js';
import { OPEN_IMPORTED_WORKBOOK, OPEN_LINK_WORKBOOK, SELECT_WORKBOOK, useRouterNavigate, useSelectOpeningWorkbook, workbookPath } from '../app/router.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

const WORKBOOK = '00000000-0000-4000-8000-000000000301';
const NEXT = '00000000-0000-4000-8000-000000000302';
const hyperServer = (endpoint: string) => ({ hyper: { protocol: 'V3_HTTP', endpoint } }) as ConnectionParams;

/// The root with the greeter of a workbook, as the app shows it
const greeter = (workbookId: string): InitialEntry => ({
    pathname: '/',
    state: { setupDone: true, confirmedFinishedSetup: true, workbookId, openingWorkbook: false, importedWorkbookId: null },
});

describe('WorkbookPage view transitions', () => {
    let root: ReturnType<typeof createTestRoot>;
    let runtime: Runtime;
    let location: Location;
    let viewMode: WorkbookViewModeContextValue;
    let navigate: ReturnType<typeof useRouterNavigate>;
    let feedMounts: number;
    let feedUnmounts: number;

    /// Capture what is committed, not what is rendered. The router navigates in a transition, which React renders
    /// in slices: a check between two slices would see the location of this component and the page of the old one.
    function Capture() {
        const renderedRuntime = useRuntime();
        const renderedLocation = useLocation();
        const renderedViewMode = useWorkbookViewMode();
        const renderedNavigate = useRouterNavigate();
        React.useLayoutEffect(() => {
            runtime = renderedRuntime;
            location = renderedLocation;
            viewMode = renderedViewMode;
            navigate = renderedNavigate;
        });
        return null;
    }

    /// The feed of the workbook, counts its mounts
    function Feed(props: { active: boolean }) {
        React.useEffect(() => {
            feedMounts += 1;
            return () => { feedUnmounts += 1; };
        }, []);
        return <div data-testid="feed" data-active={props.active} />;
    }

    /// The shells of the workbook, without a session
    function Shells(props: { connectionId: string | null; onPickConnection: (connectionId: string) => void }) {
        return (
            <div data-testid="shell" data-connection-id={props.connectionId ?? ''}>
                <button type="button" data-testid="pick-other" onClick={() => props.onPickConnection('other')} />
            </div>
        );
    }

    const page = (
        <WorkbookPage
            feed={props => <Feed active={props.active} />}
            shells={props => <Shells connectionId={props.connectionId} onPickConnection={props.onPickConnection} />}
        />
    );

    /// Show the app at a location with the routes of the page, the page alone by default
    function render(initial: InitialEntry, children: React.ReactNode = page) {
        root.render(
            <LoggerProvider>
                <MemoryRouter initialEntries={[initial]}>
                    <StorageProvider backend={new WorkbookTestBackend()}>
                        <TestRuntime>
                            <WorkbookViewModeProvider>
                                <Capture />
                                {children}
                            </WorkbookViewModeProvider>
                        </TestRuntime>
                    </StorageProvider>
                </MemoryRouter>
            </LoggerProvider>,
        );
    }

    /// Create the connections and a workbook on the first one, with a default view
    async function seed(workbooks: { workbookId: string; ephemeral?: boolean; defaultView?: core.WorkbookDefaultView }[]) {
        await act(async () => {
            await addTestConnection(runtime, { connectionId: 'database', params: hyperServer('http://database') });
            await addTestConnection(runtime, { connectionId: 'other', params: hyperServer('http://other') });
            for (const workbook of workbooks) {
                runtime.createWorkbook('database', 'Workbook', workbook.ephemeral ?? false, undefined, workbook.workbookId);
                if (workbook.defaultView != null) {
                    runtime.dispatch({ workbook: workbook.workbookId }, { kind: 'setDefaultView', value: { view: workbook.defaultView } });
                }
            }
            runtime.flush();
        });
    }

    /// Promote an ephemeral workbook with its first script
    function promote(workbookId: string) {
        act(() => {
            runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: 'select 1', base: '1' } });
            runtime.flush();
        });
    }

    const feed = () => root.container.querySelector('[data-testid="feed"]');
    const shellConnection = () => root.container.querySelector('[data-testid="shell"]')?.getAttribute('data-connection-id');
    const setMode = (mode: WorkbookViewMode) => act(() => viewMode.setMode(mode));

    beforeEach(() => {
        feedMounts = 0;
        feedUnmounts = 0;
        root = createTestRoot();
    });
    afterEach(() => {
        root.unmount();
    });

    it('moves to the path of the workbook once it is promoted', async () => {
        render(greeter(WORKBOOK));
        await seed([{ workbookId: WORKBOOK, ephemeral: true }]);
        expect(feed()).not.toBeNull();
        expect(location.pathname).toBe('/');

        promote(WORKBOOK);
        await waitForRender(() => expect(location.pathname).toBe(workbookPath(WORKBOOK)));
    });

    it('keeps the feed mounted when the root moves to the path of the workbook', async () => {
        render(greeter(WORKBOOK), (
            <Routes>
                <Route index element={page} />
                <Route path="/workbook" element={page} />
                <Route path="/workbooks/:workbookId" element={page} />
            </Routes>
        ));
        await seed([{ workbookId: WORKBOOK, ephemeral: true }]);
        expect(feedMounts).toBe(1);
        promote(WORKBOOK);
        await waitForRender(() => expect(location.pathname).toBe(workbookPath(WORKBOOK)));
        expect(feedMounts).toBe(1);
        expect(feedUnmounts).toBe(0);
    });

    it('keeps the feed mounted through a shell round trip', async () => {
        render(workbookPath(WORKBOOK));
        await seed([{ workbookId: WORKBOOK }]);
        expect(feedMounts).toBe(1);
        expect(feed()?.getAttribute('data-active')).toBe('true');

        setMode(WorkbookViewMode.Shell);
        expect(feedUnmounts).toBe(0);
        expect(feed()?.getAttribute('data-active')).toBe('false');
        expect(shellConnection()).not.toBeUndefined();

        setMode(WorkbookViewMode.Workbook);
        expect(feedMounts).toBe(1);
        expect(feedUnmounts).toBe(0);
        expect(feed()?.getAttribute('data-active')).toBe('true');
    });

    it('keeps the feed page mounted for the Dashboard view', async () => {
        render(workbookPath(WORKBOOK));
        await seed([{ workbookId: WORKBOOK }]);
        setMode(WorkbookViewMode.Dashboard);
        await waitForRender(() => expect(location.search).toBe('?view=dashboard'));

        expect(feed()?.getAttribute('data-active')).toBe('false');
        expect(feedMounts).toBe(1);
        expect(feedUnmounts).toBe(0);
    });

    it('reopens the shell on the picked connection until the workbook changes', async () => {
        render(workbookPath(WORKBOOK));
        await seed([{ workbookId: WORKBOOK }, { workbookId: NEXT }]);
        setMode(WorkbookViewMode.Shell);
        expect(shellConnection()).toBe('database');

        act(() => (root.container.querySelector('[data-testid="pick-other"]') as HTMLButtonElement).click());
        expect(shellConnection()).toBe('other');

        setMode(WorkbookViewMode.Workbook);
        expect(shellConnection()).toBeUndefined();
        setMode(WorkbookViewMode.Shell);
        expect(shellConnection()).toBe('other');

        act(() => navigate({ type: SELECT_WORKBOOK, value: NEXT }));
        await waitForRender(() => expect(location.pathname).toBe(workbookPath(NEXT)));
        expect(shellConnection()).toBe('database');
    });

    it('opens a workbook in its default view once', async () => {
        render(workbookPath(WORKBOOK));
        await seed([{ workbookId: WORKBOOK, defaultView: 'dashboard' }, { workbookId: NEXT, defaultView: 'dataflow' }]);
        await waitForRender(() => expect(viewMode.mode).toBe(WorkbookViewMode.Dashboard));
        // The user picks another view, the workbook stays in it
        setMode(WorkbookViewMode.Workbook);
        await waitForRender(() => expect(location.search).toBe(''));
        expect(viewMode.mode).toBe(WorkbookViewMode.Workbook);
        // Another workbook opens in its own default view
        act(() => navigate({ type: SELECT_WORKBOOK, value: NEXT }));
        await waitForRender(() => expect(viewMode.mode).toBe(WorkbookViewMode.Dataflow));
    });

    it('opens the default view of a workbook that the app loader selects', async () => {
        // The app loader around the routes selects the workbook that opens
        const Loader = (props: React.PropsWithChildren) => {
            useSelectOpeningWorkbook();
            return props.children;
        };
        render('/', (
            <Loader>
                <Routes>
                    <Route index element={<div />} />
                    <Route path="/workbooks/:workbookId" element={page} />
                </Routes>
            </Loader>
        ));
        await seed([{ workbookId: WORKBOOK, defaultView: 'dashboard' }, { workbookId: NEXT, defaultView: 'dataflow' }]);
        // The router renders a navigation in a transition, the act of the tests doesn't wait for it
        const shown = () => ({
            pathname: location.pathname,
            search: location.search,
            opening: (location.state as { openingWorkbook?: boolean } | null)?.openingWorkbook,
        });
        // A dropped file or a shared link
        await act(async () => navigate({ type: OPEN_IMPORTED_WORKBOOK, value: WORKBOOK }));
        await waitForRender(() => expect(shown()).toEqual({ pathname: workbookPath(WORKBOOK), search: '?view=dashboard', opening: false }));

        // A workbook that the app restores at its start
        await act(async () => navigate({ type: OPEN_LINK_WORKBOOK, value: NEXT }));
        await waitForRender(() => expect(shown()).toEqual({ pathname: workbookPath(NEXT), search: '?view=dataflow', opening: false }));
    });

    it('keeps the view that the URL names and an open shell', async () => {
        render(`${workbookPath(WORKBOOK)}?view=dataflow`);
        await seed([{ workbookId: WORKBOOK, defaultView: 'dashboard' }, { workbookId: NEXT, defaultView: 'dashboard' }]);
        expect(viewMode.mode).toBe(WorkbookViewMode.Dataflow);
        setMode(WorkbookViewMode.Shell);
        act(() => navigate({ type: SELECT_WORKBOOK, value: NEXT }));
        await waitForRender(() => expect(location.pathname).toBe(workbookPath(NEXT)));
        expect(viewMode.mode).toBe(WorkbookViewMode.Shell);
    });
});
