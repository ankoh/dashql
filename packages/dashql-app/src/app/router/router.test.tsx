import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestRoot } from '../../tests/react_root.js';
import { AppLoadingStatus } from '../loading/app_loading_status.js';
import { SessionSetupStatus } from '../loading/session_setup_status.js';
import {
    BEGIN_SESSION_SETUP,
    CANCEL_SESSION_SETUP,
    CHANGE_SESSION,
    CONFIRM_FINISHED_SETUP,
    FINISH_SETUP,
    OPEN_LINK_SESSION,
    OPEN_SESSION,
    type RouteContext,
    type RouteTarget,
    SELECT_SESSION,
    SESSION_PATH,
    sessionIdFromPathname,
    sessionPath,
    SKIP_SESSION_SETUP,
    SKIP_SETUP,
    useRouteContext,
    useRouterNavigate,
} from './router.js';

describe('session routes', () => {
    it('builds and reads the canonical session route', () => {
        expect(sessionPath('session id')).toBe('/sessions/session%20id');
        expect(sessionIdFromPathname('/sessions/session%20id')).toBe('session id');
    });

    it('ignores non-session and malformed routes', () => {
        expect(sessionIdFromPathname('/')).toBeNull();
        expect(sessionIdFromPathname('/sessions/%E0%A4%A')).toBeNull();
    });
});

describe('useRouterNavigate', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    const LOADING_SESSION: RouteContext = {
        appLoadingStatus: AppLoadingStatus.LOAD_STORAGE,
        confirmedFinishedSetup: false,
        sessionId: 's0',
        sessionSetupStatus: SessionSetupStatus.CONFIGURING,
    };

    /// Navigate from the route of session s0 and return the path and the context of the next location.
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
            <MemoryRouter initialEntries={[{ pathname: sessionPath('s0'), state: context }]}>
                <Probe />
            </MemoryRouter>,
        );
        const before = current.context;
        act(() => current.navigate!(target));
        await vi.waitFor(() => expect(current.context).not.toBe(before));
        return { pathname: current.pathname, context: current.context };
    }

    it.each<[string, RouteTarget, string, Partial<RouteContext>]>([
        ['a session path', { type: SESSION_PATH, value: 's1' }, '/sessions/s1', { sessionId: 's1', sessionSetupStatus: SessionSetupStatus.CONFIGURING }],
        ['no session path', { type: SESSION_PATH, value: null }, '/', { sessionId: null }],
        ['finished setup', { type: FINISH_SETUP, value: null }, '/sessions/s0', { appLoadingStatus: AppLoadingStatus.SETUP_DONE, sessionId: null }],
        ['skipped setup', { type: SKIP_SETUP, value: null }, '/sessions/s0', { appLoadingStatus: AppLoadingStatus.SETUP_DONE, sessionId: 's0' }],
        ['a selected session', { type: SELECT_SESSION, value: 's1' }, '/sessions/s1', { sessionId: 's1', sessionSetupStatus: SessionSetupStatus.NONE }],
        ['an opened session', { type: OPEN_SESSION, value: 's1' }, '/sessions/s1', { sessionSetupStatus: SessionSetupStatus.OPENING }],
        ['a session change', { type: CHANGE_SESSION, value: null }, '/', { sessionId: null, sessionSetupStatus: SessionSetupStatus.NONE }],
        ['a begun session setup', { type: BEGIN_SESSION_SETUP, value: 's1' }, '/sessions/s1', { sessionSetupStatus: SessionSetupStatus.CONFIGURING }],
        ['a cancelled session setup', { type: CANCEL_SESSION_SETUP, value: null }, '/', { sessionId: null, sessionSetupStatus: SessionSetupStatus.NONE }],
        ['a skipped session setup', { type: SKIP_SESSION_SETUP, value: null }, '/sessions/s0', { sessionId: 's0', sessionSetupStatus: SessionSetupStatus.NONE }],
        ['a link session', { type: OPEN_LINK_SESSION, value: 's1' }, '/sessions/s1', { appLoadingStatus: AppLoadingStatus.SETUP_DONE, sessionSetupStatus: SessionSetupStatus.OPENING }],
    ])('navigates to %s', async (_name, target, pathname, context) => {
        const next = await navigateFrom(LOADING_SESSION, target);
        expect(next.pathname).toBe(pathname);
        expect(next.context).toMatchObject(context);
    });

    it('confirms only finished setups', async () => {
        const finished = { ...LOADING_SESSION, appLoadingStatus: AppLoadingStatus.SETUP_DONE };
        expect((await navigateFrom(finished, { type: CONFIRM_FINISHED_SETUP, value: true })).context?.confirmedFinishedSetup).toBe(true);
        root?.unmount();
        root = null;
        await expect(navigateFrom(LOADING_SESSION, { type: CONFIRM_FINISHED_SETUP, value: true })).rejects.toThrow('non-finished setup');
    });

    it('reads a default context without route state', () => {
        const current = { context: null as RouteContext | null };
        function Probe() {
            current.context = useRouteContext();
            return null;
        }
        root = createTestRoot();
        root.render(<MemoryRouter initialEntries={['/sessions/s2']}><Probe /></MemoryRouter>);
        expect(current.context).toEqual({
            appLoadingStatus: AppLoadingStatus.NOT_STARTED,
            confirmedFinishedSetup: false,
            sessionId: 's2',
            sessionSetupStatus: SessionSetupStatus.NONE,
        });
    });
});
