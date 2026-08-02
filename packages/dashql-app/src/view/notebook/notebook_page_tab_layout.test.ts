import { describe, expect, it } from 'vitest';

import { layoutNotebookPageTabs } from './notebook_page_tab_layout.js';

describe('layoutNotebookPageTabs', () => {
    it('keeps natural card widths when the row fits', () => {
        const layout = layoutNotebookPageTabs(400, [80, 100, 120], 1);

        expect(layout.stacked).toBe(false);
        expect(layout.placements.map(card => [card.left, card.width])).toEqual([
            [0, 80],
            [80, 100],
            [180, 120],
        ]);
    });

    it('anchors the selected page between left and right stacks', () => {
        const layout = layoutNotebookPageTabs(300, [100, 100, 100, 100, 100], 2);
        const selected = layout.placements[2];

        expect(layout.stacked).toBe(true);
        expect(selected.width).toBe(100);
        expect(selected.side).toBe('selected');
        expect(selected.left).toBeCloseTo(100);
        expect(layout.placements.slice(0, 2).every(card => card.side === 'left')).toBe(true);
        expect(layout.placements.slice(3).every(card => card.side === 'right')).toBe(true);
        expect(layout.placements[0].left).toBeLessThan(layout.placements[1].left);
        expect(layout.placements[3].left).toBeLessThan(layout.placements[4].left);
    });

    it('uses fixed dot slots at either boundary', () => {
        const first = layoutNotebookPageTabs(260, [100, 100, 100, 100], 0);
        const last = layoutNotebookPageTabs(260, [100, 100, 100, 100], 3);

        expect(first.placements.map(card => card.width)).toEqual([100, 18, 18, 18]);
        expect(last.placements.map(card => card.width)).toEqual([18, 18, 18, 100]);
        expect(first.placements[0].left).toBeCloseTo(53);
        expect(last.placements[3].left).toBeCloseTo(107);
    });

    it('preserves exposed edges when the viewport is narrower than the selected card', () => {
        const layout = layoutNotebookPageTabs(60, [100, 120, 100], 1);

        expect(layout.placements[1]).toMatchObject({ left: 18, width: 24 });
        expect(layout.placements[0].width).toBe(18);
        expect(layout.placements[2].width).toBe(18);
    });
});
