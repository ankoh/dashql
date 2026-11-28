import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { DashboardArrange, type DashboardArrangeSection } from './dashboard_arrange.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SECTIONS: DashboardArrangeSection[] = [
    { label: 'Scripts', items: [] },
    {
        label: 'Visualizations', items: [
            { placement: { id: 1, section: 'visualizations', row: 0, column: 0, width: 3, height: 3 }, name: 'revenue' },
            { placement: { id: 2, section: 'visualizations', row: 3, column: 6, width: 6, height: 6 }, name: 'by_region' },
        ],
    },
];

describe('DashboardArrange', () => {
    let root: ReturnType<typeof createTestRoot>;
    beforeEach(() => { root = createTestRoot(); });
    afterEach(() => root.unmount());
    const element = (testId: string) => root.container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    const card = (id: number) => root.container.querySelector<HTMLButtonElement>(`[data-testid="dashboard-arrange-card"][data-card="${id}"]`)!;

    it('draws the cards on the grid of the board, without the empty sections', () => {
        root.render(<DashboardArrange sections={SECTIONS} onChange={vi.fn()} onDone={vi.fn()} />);
        expect(root.container.querySelectorAll('section').length).toBe(1);
        expect(card(2).style.gridColumn).toBe('7 / span 6');
        expect(card(2).style.gridRow).toBe('4 / span 6');
        expect(card(2).textContent).toContain('6 × 6');
        expect(element('dashboard-arrange-panel')).toBeNull();
    });

    it('moves and resizes the picked card within the grid', () => {
        const onChange = vi.fn();
        const onDone = vi.fn();
        root.render(<DashboardArrange sections={SECTIONS} onChange={onChange} onDone={onDone} />);
        act(() => card(2).click());
        expect(card(2).getAttribute('aria-selected')).toBe('true');
        act(() => element('dashboard-arrange-width-less')!.click());
        expect(onChange).toHaveBeenLastCalledWith(2, { row: 3, column: 6, width: 5, height: 6 });
        act(() => element('dashboard-arrange-height-more')!.click());
        expect(onChange).toHaveBeenLastCalledWith(2, { row: 3, column: 6, width: 6, height: 7 });
        act(() => element('dashboard-arrange-left')!.click());
        expect(onChange).toHaveBeenLastCalledWith(2, { row: 3, column: 5, width: 6, height: 6 });
        // A card at the right edge doesn't move further right, it grows to the left
        onChange.mockClear();
        act(() => element('dashboard-arrange-right')!.click());
        expect(onChange).not.toHaveBeenCalled();
        act(() => element('dashboard-arrange-width-more')!.click());
        expect(onChange).toHaveBeenLastCalledWith(2, { row: 3, column: 5, width: 7, height: 6 });
        act(() => element('dashboard-arrange-done')!.click());
        expect(onDone).toHaveBeenCalledOnce();
    });
});
