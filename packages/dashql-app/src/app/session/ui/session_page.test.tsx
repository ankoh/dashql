import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionViewMode } from './session_view_mode.js';
import { SessionPage, type SessionPageDependencies } from './session_page.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = {
    mode: 0,
    sessionId: 'session',
    feedMounts: 0,
    feedUnmounts: 0,
};

const DEFAULT_CONNECTION = { connectionId: 'database' };
const OTHER_CONNECTION = { connectionId: 'other' };

const dependencies = {
    useSessionViewMode: () => ({ mode: state.mode }),
    useSessionScripts: () => [{ sessionId: state.sessionId, name: 'Session', connectionId: 'database', scripts: {} }, vi.fn()],
    useDefaultConnection: () => [DEFAULT_CONNECTION],
    useConnectionRegistry: () => [{ connections: new Map([['database', DEFAULT_CONNECTION], ['other', OTHER_CONNECTION]]) }] as any,
    useLogger: () => ({ warn: vi.fn() }),
    useRouteContext: () => ({ sessionId: state.sessionId }),
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
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
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
