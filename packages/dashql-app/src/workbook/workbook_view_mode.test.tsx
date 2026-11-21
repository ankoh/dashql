import * as React from 'react';
import { act, waitForRender } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    WorkbookViewMode,
    WorkbookViewModeProvider,
    useWorkbookViewMode,
    workbookViewModeFromSearch,
    workbookViewNavigation,
    workbookViewSearch,
    type WorkbookViewModeContextValue,
} from './workbook_view_mode.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('workbook view URL state', () => {
    it('reads the view from the view query parameter', () => {
        expect(workbookViewModeFromSearch('?view=dashboard')).toBe(WorkbookViewMode.Dashboard);
        expect(workbookViewModeFromSearch('?view=dataflow')).toBe(WorkbookViewMode.Dataflow);
        expect(workbookViewModeFromSearch('?view=workbook')).toBe(WorkbookViewMode.Workbook);
        expect(workbookViewModeFromSearch('')).toBe(WorkbookViewMode.Workbook);
    });

    it('replaces only the view parameter and preserves other query state', () => {
        expect(workbookViewSearch('?foo=bar', WorkbookViewMode.Dashboard)).toBe('?foo=bar&view=dashboard');
        expect(workbookViewSearch('?foo=bar&view=dashboard', WorkbookViewMode.Shell)).toBe('?foo=bar');
        expect(workbookViewSearch('?view=dashboard', WorkbookViewMode.Dataflow)).toBe('?view=dataflow');
    });

    it('preserves router state when replacing the view query parameter', () => {
        const state = { setupDone: true, workbookId: 'workbook' };
        expect(workbookViewNavigation({
            pathname: '/workbooks/workbook',
            search: '?foo=bar',
            hash: '#result',
            state,
        }, WorkbookViewMode.Dashboard)).toEqual({
            to: {
                pathname: '/workbooks/workbook',
                search: '?foo=bar&view=dashboard',
                hash: '#result',
            },
            options: { replace: true, state },
        });
    });
});

describe('workbook view mode', () => {
    let container: HTMLDivElement;
    let root: Root;
    let view: WorkbookViewModeContextValue;
    let navigate: NavigateFunction;
    let search: string;
    function Probe() {
        view = useWorkbookViewMode();
        navigate = useNavigate();
        search = useLocation().search;
        return null;
    }
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(
            <MemoryRouter initialEntries={['/workbooks/a']}>
                <WorkbookViewModeProvider><Probe /></WorkbookViewModeProvider>
            </MemoryRouter>,
        ));
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    // The router navigates in a transition, a view of the URL shows once it rendered
    it('shows the views of the URL and keeps the shell until a view of the URL closes it', async () => {
        expect(view.mode).toBe(WorkbookViewMode.Workbook);
        act(() => view.setMode(WorkbookViewMode.Dashboard));
        await waitForRender(() => expect(view.mode).toBe(WorkbookViewMode.Dashboard));
        expect(search).toBe('?view=dashboard');
        // The shell leaves the view of the URL
        act(() => view.setMode(WorkbookViewMode.Shell));
        await waitForRender(() => expect(view.mode).toBe(WorkbookViewMode.Shell));
        expect(search).toBe('');
        // A view that the URL names closes the shell, e.g. when going back
        act(() => void navigate('/workbooks/a?view=dataflow'));
        await waitForRender(() => expect(view.mode).toBe(WorkbookViewMode.Dataflow));
        act(() => void navigate('/workbooks/a'));
        await waitForRender(() => expect(view.mode).toBe(WorkbookViewMode.Workbook));
    });

    it('falls back to the workbook for an unknown view, also in the URL', async () => {
        act(() => void navigate('/workbooks/a?view=unknown&foo=bar'));
        await waitForRender(() => expect(search).toBe('?foo=bar'));
        expect(view.mode).toBe(WorkbookViewMode.Workbook);
    });
});
