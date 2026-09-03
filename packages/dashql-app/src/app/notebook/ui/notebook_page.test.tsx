import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = vi.hoisted(() => ({
    mode: 0,
    feedMounts: 0,
    feedUnmounts: 0,
}));

vi.mock('../scripts/notebook_commands.js', () => ({
    NotebookViewMode: { Notebook: 0, Shell: 1 },
    useNotebookViewMode: () => ({ mode: state.mode }),
}));
vi.mock('../scripts/notebook_scripts_registry.js', () => ({
    useNotebookScriptsRegistry: () => [{ notebookScriptsByConnection: new Map() }],
    useNotebookScripts: () => [{ notebookId: 'notebook', name: 'Notebook' }, vi.fn()],
}));
vi.mock('../connections/attached_database_registry.js', () => ({
    useAttachedDatabaseState: () => [null],
}));
vi.mock('../../../platform/logger/logger_provider.js', () => ({
    useLogger: () => ({ warn: vi.fn() }),
}));
vi.mock('../../router/router.js', () => ({
    NOTEBOOK_PATH: Symbol('NOTEBOOK_PATH'),
    useRouteContext: () => ({ notebookId: 'notebook' }),
    useRouterNavigate: () => vi.fn(),
}));
vi.mock('./feed/notebook_feed_page.js', async () => {
    const React = await import('react');
    return {
        NotebookFeedPage: ({ active }: { active: boolean }) => {
            React.useEffect(() => {
                state.feedMounts += 1;
                return () => { state.feedUnmounts += 1; };
            }, []);
            return React.createElement('div', { 'data-testid': 'feed', 'data-active': active });
        },
    };
});
vi.mock('../shell/notebook_shell_page.js', async () => {
    const React = await import('react');
    return { default: () => React.createElement('div', { 'data-testid': 'shell' }) };
});

import { NotebookPage } from './notebook_page.js';

describe('NotebookPage view transitions', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        state.mode = 0;
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
        await act(async () => root.render(<NotebookPage />));
        expect(state.feedMounts).toBe(1);
        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('true');

        state.mode = 1;
        await act(async () => root.render(<NotebookPage />));
        expect(state.feedUnmounts).toBe(0);
        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('false');
        expect(container.querySelector('[data-testid="shell"]')).not.toBeNull();

        state.mode = 0;
        await act(async () => root.render(<NotebookPage />));
        expect(state.feedMounts).toBe(1);
        expect(state.feedUnmounts).toBe(0);
        expect(container.querySelector('[data-testid="feed"]')?.getAttribute('data-active')).toBe('true');
    });
});
