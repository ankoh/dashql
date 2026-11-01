import { describe, expect, it } from 'vitest';

import {
    SessionViewMode,
    sessionViewModeEnabled,
    sessionViewModeFromSearch,
    sessionViewNavigation,
    sessionViewSearch,
} from './session_view_mode.js';

describe('session view URL state', () => {
    const none = { dashboard: false, dataflow: false };
    const all = { dashboard: true, dataflow: true };

    it('reads Dashboard from the view query parameter only when enabled', () => {
        expect(sessionViewModeFromSearch('?view=dashboard', none)).toBe(SessionViewMode.Session);
        expect(sessionViewModeFromSearch('?view=dashboard', all)).toBe(SessionViewMode.Dashboard);
        expect(sessionViewModeFromSearch('?view=session', all)).toBe(SessionViewMode.Session);
    });

    it('reads Dataflow from the view query parameter only when enabled', () => {
        expect(sessionViewModeFromSearch('?view=dataflow', { dashboard: true, dataflow: false })).toBe(SessionViewMode.Session);
        expect(sessionViewModeFromSearch('?view=dataflow', { dashboard: false, dataflow: true })).toBe(SessionViewMode.Dataflow);
        expect(sessionViewModeEnabled(SessionViewMode.Dataflow, none)).toBe(false);
        expect(sessionViewModeEnabled(SessionViewMode.Shell, none)).toBe(true);
    });

    it('replaces only the view parameter and preserves other query state', () => {
        expect(sessionViewSearch('?foo=bar', SessionViewMode.Dashboard)).toBe('?foo=bar&view=dashboard');
        expect(sessionViewSearch('?foo=bar&view=dashboard', SessionViewMode.Shell)).toBe('?foo=bar');
        expect(sessionViewSearch('?view=dashboard', SessionViewMode.Dataflow)).toBe('?view=dataflow');
    });

    it('preserves router state when replacing the view query parameter', () => {
        const state = { appLoadingStatus: 2, sessionId: 'session' };
        expect(sessionViewNavigation({
            pathname: '/sessions/session',
            search: '?foo=bar',
            hash: '#result',
            state,
        }, SessionViewMode.Dashboard)).toEqual({
            to: {
                pathname: '/sessions/session',
                search: '?foo=bar&view=dashboard',
                hash: '#result',
            },
            options: { replace: true, state },
        });
    });
});
