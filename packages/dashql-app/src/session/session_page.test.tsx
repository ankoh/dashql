import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionViewMode } from './session_view_mode.js';
import { SessionPage, type SessionPageDependencies } from './session_page.js';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { PROMOTE_SESSION, sessionPath } from '../app/router/router.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = {
    mode: 0,
    sessionId: 'session',
    feedMounts: 0,
    feedUnmounts: 0,
    ephemeral: false,
    pathname: '/sessions/session',
    navigate: vi.fn(),
};

const DEFAULT_CONNECTION = { connectionId: 'database' };
const OTHER_CONNECTION = { connectionId: 'other' };

const dependencies = {
    useSessionViewMode: () => ({ mode: state.mode }),
    useSessionScripts: () => [{
        sessionMetadata: { ephemeral: state.ephemeral ? true : undefined },
        sessionId: state.sessionId, name: 'Session', pendingConnection: { connectionId: 'database' }, scripts: {}, scriptRefs: {}, scriptOrder: [],
    }, vi.fn()],
    useConnectionRegistry: () => [{ connections: new Map([['database', DEFAULT_CONNECTION], ['other', OTHER_CONNECTION]]) }] as any,
    useLogger: () => ({ warn: vi.fn() }),
    useRouteContext: () => ({ sessionId: state.sessionId }),
    useRouterNavigate: () => state.navigate,
    useLocation: () => ({ pathname: state.pathname }),
    SessionFeedPage: ({ active }: { active: boolean }) => {
        React.useEffect(() => {
            state.feedMounts += 1;
            return () => { state.feedUnmounts += 1; };
        }, []);
        return <div data-testid="feed" data-active={active} />;
    },
    SessionShellsPage: ({ connectionId, onPickConnection }: { connectionId: string | null; onPickConnection: (connectionId: string) => void }) => (
        <div data-testid="shell" data-connection-id={connectionId ?? ''}>
            <button type="button" data-testid="pick-other" onClick={() => onPickConnection('other')} />
        </div>
    ),
} as unknown as SessionPageDependencies;

describe('SessionPage view transitions', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        state.mode = 0;
        state.sessionId = 'session';
        state.feedMounts = 0;
        state.feedUnmounts = 0;
        state.ephemeral = false;
        state.pathname = '/sessions/session';
        state.navigate.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('moves to the path of the session once it is promoted', async () => {
        state.ephemeral = true;
        state.pathname = '/';
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(state.navigate).not.toHaveBeenCalled();

        state.ephemeral = false;
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(state.navigate).toHaveBeenCalledWith({ type: PROMOTE_SESSION, value: 'session' });

        state.navigate.mockClear();
        state.pathname = sessionPath('session');
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(state.navigate).not.toHaveBeenCalled();
    });

    it('keeps the feed mounted when the root moves to the path of the session', async () => {
        const routed = { ...dependencies, useLocation, useRouterNavigate: () => state.navigate } as SessionPageDependencies;
        let navigate!: ReturnType<typeof useNavigate>;
        const Capture = () => {
            navigate = useNavigate();
            return null;
        };
        const Page = () => <SessionPage dependencies={routed} />;
        await act(async () => root.render(
            <MemoryRouter initialEntries={['/']}>
                <Capture />
                <Routes>
                    <Route index Component={Page} />
                    <Route path="/session" Component={Page} />
                    <Route path="/sessions/:sessionId" Component={Page} />
                </Routes>
            </MemoryRouter>,
        ));
        expect(state.feedMounts).toBe(1);
        await act(async () => navigate(sessionPath('session'), { replace: true }));
        expect(state.feedMounts).toBe(1);
        expect(state.feedUnmounts).toBe(0);
    });

    it('keeps the feed mounted through a shell round trip', async () => {
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(state.feedMounts).toBe(1);
        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('true');

        state.mode = SessionViewMode.Shell;
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(state.feedUnmounts).toBe(0);
        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('false');
        expect(container.querySelector('[data-testid="shell"]')).not.toBeNull();

        state.mode = SessionViewMode.Session;
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(state.feedMounts).toBe(1);
        expect(state.feedUnmounts).toBe(0);
        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('true');
    });

    it('keeps the feed page mounted for the Dashboard view', async () => {
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        state.mode = SessionViewMode.Dashboard;
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));

        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('false');
        expect(state.feedMounts).toBe(1);
        expect(state.feedUnmounts).toBe(0);
    });

    it('reopens the shell on the picked connection until the session changes', async () => {
        const shellConnection = () => container.querySelector('[data-testid="shell"]')?.getAttribute('data-connection-id');
        state.mode = SessionViewMode.Shell;
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(shellConnection()).toBe('database');

        await act(async () => (container.querySelector('[data-testid="pick-other"]') as HTMLButtonElement).click());
        expect(shellConnection()).toBe('other');

        state.mode = SessionViewMode.Session;
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(container.querySelector('[data-testid="shell"]')).toBeNull();
        state.mode = SessionViewMode.Shell;
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(shellConnection()).toBe('other');

        state.sessionId = 'next';
        await act(async () => root.render(<SessionPage dependencies={dependencies} />));
        expect(shellConnection()).toBe('database');
    });
});
