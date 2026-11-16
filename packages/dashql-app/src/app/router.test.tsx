import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestRoot } from '../tests/react_root.js';
import { AppLoadingStatus } from './loading/app_loading_status.js';
import { WorkbookSetupStatus } from './loading/workbook_setup_status.js';
import {
    BEGIN_WORKBOOK_SETUP,
    CANCEL_WORKBOOK_SETUP,
    CHANGE_WORKBOOK,
    CONFIRM_FINISHED_SETUP,
    FINISH_SETUP,
    OPEN_LINK_WORKBOOK,
    OPEN_WORKBOOK,
    type RouteContext,
    type RouteTarget,
    SELECT_WORKBOOK,
    WORKBOOK_PATH,
    workbookIdFromPathname,
    workbookPath,
    SKIP_WORKBOOK_SETUP,
    SKIP_SETUP,
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
        appLoadingStatus: AppLoadingStatus.LOAD_STORAGE,
        confirmedFinishedSetup: false,
        workbookId: 's0',
        workbookSetupStatus: WorkbookSetupStatus.CONFIGURING,
    };

    /// Navigate from the route of workbook s0 and return the path and the context of the next location.
    /// The router navigates in a transition, so we wait for the next route context.
    async function navigateFrom(context: RouteContext, target: RouteTarget) {
        const current = { navigate: null as ReturnType<typeof useRouterNavigate> | null, pathname: '', context: null as RouteContext | null };
        function Probe() {
            current.navigate = useRouterNavigate();
            current.pathname = useLocation().pathname;
            current.context = useRouteContext();
            return null;
        }
        root = createTestRoot();
        root.render(
            <MemoryRouter initialEntries={[{ pathname: workbookPath('s0'), state: context }]}>
                <Probe />
            </MemoryRouter>,
        );
        const before = current.context;
        act(() => current.navigate!(target));
        await vi.waitFor(() => expect(current.context).not.toBe(before));
        return { pathname: current.pathname, context: current.context };
    }

    it.each<[string, RouteTarget, string, Partial<RouteContext>]>([
        ['a workbook path', { type: WORKBOOK_PATH, value: 's1' }, '/workbooks/s1', { workbookId: 's1', workbookSetupStatus: WorkbookSetupStatus.CONFIGURING }],
        ['no workbook path', { type: WORKBOOK_PATH, value: null }, '/', { workbookId: null }],
        ['finished setup', { type: FINISH_SETUP, value: null }, '/workbooks/s0', { appLoadingStatus: AppLoadingStatus.SETUP_DONE, workbookId: null }],
        ['skipped setup', { type: SKIP_SETUP, value: null }, '/workbooks/s0', { appLoadingStatus: AppLoadingStatus.SETUP_DONE, workbookId: 's0' }],
        ['a selected workbook', { type: SELECT_WORKBOOK, value: 's1' }, '/workbooks/s1', { workbookId: 's1', workbookSetupStatus: WorkbookSetupStatus.NONE }],
        ['an opened workbook', { type: OPEN_WORKBOOK, value: 's1' }, '/workbooks/s1', { workbookSetupStatus: WorkbookSetupStatus.OPENING }],
        ['a workbook change', { type: CHANGE_WORKBOOK, value: null }, '/', { workbookId: null, workbookSetupStatus: WorkbookSetupStatus.NONE }],
        ['a begun workbook setup', { type: BEGIN_WORKBOOK_SETUP, value: 's1' }, '/workbooks/s1', { workbookSetupStatus: WorkbookSetupStatus.CONFIGURING }],
        ['a cancelled workbook setup', { type: CANCEL_WORKBOOK_SETUP, value: null }, '/', { workbookId: null, workbookSetupStatus: WorkbookSetupStatus.NONE }],
        ['a skipped workbook setup', { type: SKIP_WORKBOOK_SETUP, value: null }, '/workbooks/s0', { workbookId: 's0', workbookSetupStatus: WorkbookSetupStatus.NONE }],
        ['a link workbook', { type: OPEN_LINK_WORKBOOK, value: 's1' }, '/workbooks/s1', { appLoadingStatus: AppLoadingStatus.SETUP_DONE, workbookSetupStatus: WorkbookSetupStatus.OPENING }],
    ])('navigates to %s', async (_name, target, pathname, context) => {
        const next = await navigateFrom(LOADING_WORKBOOK, target);
        expect(next.pathname).toBe(pathname);
        expect(next.context).toMatchObject(context);
    });

    it('confirms only finished setups', async () => {
        const finished = { ...LOADING_WORKBOOK, appLoadingStatus: AppLoadingStatus.SETUP_DONE };
        expect((await navigateFrom(finished, { type: CONFIRM_FINISHED_SETUP, value: true })).context?.confirmedFinishedSetup).toBe(true);
        root?.unmount();
        root = null;
        await expect(navigateFrom(LOADING_WORKBOOK, { type: CONFIRM_FINISHED_SETUP, value: true })).rejects.toThrow('non-finished setup');
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
            appLoadingStatus: AppLoadingStatus.NOT_STARTED,
            confirmedFinishedSetup: false,
            workbookId: 's2',
            workbookSetupStatus: WorkbookSetupStatus.NONE,
        });
    });
});
