import { describe, expect, it } from 'vitest';

import {
    WorkbookViewMode,
    workbookViewModeFromSearch,
    workbookViewNavigation,
    workbookViewSearch,
} from './workbook_view_mode.js';

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
        const state = { appLoadingStatus: 2, workbookId: 'workbook' };
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
