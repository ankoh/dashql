import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import {
    OPEN_IMPORTED_WORKBOOK,
    SELECT_IMPORTED_WORKBOOK,
    OPEN_LINK_WORKBOOK,
    OPEN_WORKBOOK,
    type RouteContext,
    type RouteTarget,
    SELECT_WORKBOOK,
    SETTLE_IMPORTED_WORKBOOK,
    WORKBOOK_PATH,
    workbookIdFromPathname,
    workbookPath,
    useRouteContext,
    useRouterNavigate,
} from './router.js';

describe('workbook routes', () => {
    it('builds and reads the canonical workbook route', () => {
        expect(workbookPath('workbook id')).toBe('/workbooks/workbook%20id');
        expect(workbookIdFromPathname('/workbooks/workbook%20id')).toBe('workbook id');
    });

    it('ignores non-workbook and malformed routes', () => {
        expect(workbookIdFromPathname('/')).toBeNull();
        expect(workbookIdFromPathname('/workbooks/%E0%A4%A')).toBeNull();
    });
});

describe('useRouterNavigate', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    const LOADING_WORKBOOK: RouteContext = {
        workbookId: 's0',
        openingWorkbook: true,
    };

    /// Navigate from the route of workbook s0 and return the path and the context of the next location.
    /// The router navigates in a transition, so we wait for the next route context.
    async function navigateFrom(context: RouteContext, target: RouteTarget, search = '') {
        const current = { navigate: null as ReturnType<typeof useRouterNavigate> | null, pathname: '', search: '', context: null as RouteContext | null };
        function Probe() {
            current.navigate = useRouterNavigate();
            current.pathname = useLocation().pathname;
            current.search = useLocation().search;
            current.context = useRouteContext();
            return null;
        }
        root = createTestRoot();
        root.render(
            <MemoryRouter initialEntries={[{ pathname: workbookPath('s0'), search, state: context }]}>
                <Probe />
            </MemoryRouter>,
        );
        const before = current.context;
        act(() => current.navigate!(target));
        await vi.waitFor(() => expect(current.context).not.toBe(before));
        return { pathname: current.pathname, search: current.search, context: current.context };
    }

    it.each<[string, RouteTarget, string, Partial<RouteContext>]>([
        ['a workbook path', { type: WORKBOOK_PATH, value: 's1' }, '/workbooks/s1', { workbookId: 's1', openingWorkbook: true }],
        ['no workbook path', { type: WORKBOOK_PATH, value: null }, '/', { workbookId: null }],
        ['a selected workbook', { type: SELECT_WORKBOOK, value: 's1' }, '/workbooks/s1', { workbookId: 's1', openingWorkbook: false }],
        ['an opened workbook', { type: OPEN_WORKBOOK, value: 's1' }, '/workbooks/s1', { openingWorkbook: true }],
        ['a link workbook', { type: OPEN_LINK_WORKBOOK, value: 's1' }, '/workbooks/s1', { workbookId: 's1', openingWorkbook: true, importedWorkbookId: null }],
        ['an imported workbook', { type: OPEN_IMPORTED_WORKBOOK, value: 's1' }, '/workbooks/s1', { workbookId: 's1', openingWorkbook: true, importedWorkbookId: 's1' }],
        ['a selected imported workbook', { type: SELECT_IMPORTED_WORKBOOK, value: 's1' }, '/workbooks/s1', { workbookId: 's1', openingWorkbook: false, importedWorkbookId: 's1' }],
    ])('navigates to %s', async (_name, target, pathname, context) => {
        const next = await navigateFrom(LOADING_WORKBOOK, target);
        expect(next.pathname).toBe(pathname);
        expect(next.context).toMatchObject(context);
    });

    it.each<[string, RouteTarget, string | null]>([
        ['the loader selects it', { type: SELECT_WORKBOOK, value: 's0' }, 's0'],
        ['it opens again', { type: OPEN_WORKBOOK, value: 's0' }, 's0'],
        ['another workbook is selected', { type: SELECT_WORKBOOK, value: 's1' }, null],
        ['another workbook opens', { type: WORKBOOK_PATH, value: 's1' }, null],
        ['a link workbook opens', { type: OPEN_LINK_WORKBOOK, value: 's0' }, null],
    ])('keeps an imported workbook only while it shows: %s', async (_name, target, importedWorkbookId) => {
        const imported = { ...LOADING_WORKBOOK, importedWorkbookId: 's0' };
        expect((await navigateFrom(imported, target)).context?.importedWorkbookId).toBe(importedWorkbookId);
    });

    it('settles an imported workbook in place', async () => {
        const imported = { ...LOADING_WORKBOOK, openingWorkbook: false, importedWorkbookId: 's0' };
        const next = await navigateFrom(imported, { type: SETTLE_IMPORTED_WORKBOOK, value: null }, '?view=dashboard');
        expect(next.pathname).toBe('/workbooks/s0');
        expect(next.search).toBe('?view=dashboard');
        expect(next.context).toEqual({ workbookId: 's0', openingWorkbook: false, importedWorkbookId: null });
    });

    it('reads a default context without route state', () => {
        const current = { context: null as RouteContext | null };
        function Probe() {
            current.context = useRouteContext();
            return null;
        }
        root = createTestRoot();
        root.render(<MemoryRouter initialEntries={['/workbooks/s2']}><Probe /></MemoryRouter>);
        expect(current.context).toEqual({
            workbookId: 's2',
            openingWorkbook: false,
            importedWorkbookId: null,
        });
    });
});
