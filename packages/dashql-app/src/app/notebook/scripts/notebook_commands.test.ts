import { describe, expect, it } from 'vitest';

import {
    NotebookViewMode,
    notebookViewModeFromSearch,
    notebookViewNavigation,
    notebookViewSearch,
} from './notebook_commands.js';

describe('notebook view URL state', () => {
    it('reads Dashboard from the view query parameter only when enabled', () => {
        expect(notebookViewModeFromSearch('?view=dashboard', false)).toBe(NotebookViewMode.Notebook);
        expect(notebookViewModeFromSearch('?view=dashboard', true)).toBe(NotebookViewMode.Dashboard);
        expect(notebookViewModeFromSearch('?view=notebook', true)).toBe(NotebookViewMode.Notebook);
    });

    it('replaces only the view parameter and preserves other query state', () => {
        expect(notebookViewSearch('?foo=bar', NotebookViewMode.Dashboard)).toBe('?foo=bar&view=dashboard');
        expect(notebookViewSearch('?foo=bar&view=dashboard', NotebookViewMode.Shell)).toBe('?foo=bar');
    });

    it('preserves router state when replacing the view query parameter', () => {
        const state = { appLoadingStatus: 2, notebookId: 'notebook' };
        expect(notebookViewNavigation({
            pathname: '/notebooks/notebook',
            search: '?foo=bar',
            hash: '#result',
            state,
        }, NotebookViewMode.Dashboard)).toEqual({
            to: {
                pathname: '/notebooks/notebook',
                search: '?foo=bar&view=dashboard',
                hash: '#result',
            },
            options: { replace: true, state },
        });
    });
});
