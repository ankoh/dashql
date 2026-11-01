import { describe, expect, it, vi } from 'vitest';

import { FeedRowHeightCache, revealScrollOffset } from './session_feed_layout.js';

describe('FeedRowHeightCache', () => {
    it('uses exact separator and script estimates before rows mount', () => {
        const heights = new FeedRowHeightCache([
            { scriptId: 1, estimatedHeight: 122 },
            { scriptId: 2, estimatedHeight: 202 },
        ]);

        expect([0, 1, 2, 3, 4].map(index => heights.getRowHeight(index))).toEqual([
            48, 122, 40, 202, 40,
        ]);
    });

    it('uses the compact first separator height on mobile', () => {
        const heights = new FeedRowHeightCache([
            { scriptId: 1, estimatedHeight: 122 },
        ], undefined, 40);

        expect([0, 1, 2].map(index => heights.getRowHeight(index))).toEqual([40, 122, 40]);
        expect(heights.getAverageRowHeight()).toBe((40 + 122 + 40) / 3);
    });

    it('retains measured script heights by identity while entries update', () => {
        const onChange = vi.fn();
        const heights = new FeedRowHeightCache([
            { scriptId: 1, estimatedHeight: 122 },
            { scriptId: 2, estimatedHeight: 202 },
        ], onChange);
        heights.setRowHeight(1, 137);
        heights.updateEntries([
            { scriptId: 2, estimatedHeight: 202 },
            { scriptId: 1, estimatedHeight: 162 },
        ]);

        // Script 1 measures 25px below its new estimate, the unmeasured script 2 follows
        expect(heights.getRowHeight(1)).toBe(177);
        expect(heights.getRowHeight(3)).toBe(137);
        expect(heights.getAverageRowHeight()).toBe((48 + 177 + 40 + 137 + 40) / 5);
        expect(onChange).toHaveBeenCalledWith(1, 122, 137);
    });

    it('raises the estimates of unmeasured scripts by the excess of the measured ones', () => {
        const heights = new FeedRowHeightCache([
            { scriptId: 1, estimatedHeight: 104 },
            { scriptId: 2, estimatedHeight: 104 },
            { scriptId: 3, estimatedHeight: 140 },
        ]);
        heights.setRowHeight(1, 504);
        heights.setRowHeight(3, 304);

        expect([1, 3, 5].map(index => heights.getRowHeight(index))).toEqual([504, 304, 440]);
    });

    it('keeps the extrapolated height of a long feed close to its rows', () => {
        // A long feed of result cards, react-window lays out the rows down to the viewport
        const scripts = 200;
        const rowCount = scripts * 2 + 1;
        const heights = new FeedRowHeightCache(Array.from({ length: scripts }, (_, i) => ({ scriptId: i, estimatedHeight: 104 })));
        const laidOut = 41;
        for (let index = 1; index < laidOut; index += 2) heights.setRowHeight(index, 520);

        // react-window sizes the list as the row count times the mean of the rows it has laid out
        const extrapolated = rowCount * heights.getRowOffset(laidOut) / laidOut;
        const actual = heights.getRowOffset(rowCount);
        expect(Math.abs(extrapolated - actual) / actual).toBeLessThan(0.05);
    });


    it('sums the rows above a row for its offset', () => {
        const heights = new FeedRowHeightCache([
            { scriptId: 1, estimatedHeight: 122 },
            { scriptId: 2, estimatedHeight: 202 },
        ]);
        heights.setRowHeight(1, 137);

        expect([0, 1, 2, 3, 4].map(index => heights.getRowOffset(index))).toEqual([
            0, 48, 185, 225, 442,
        ]);
    });
});

describe('revealScrollOffset', () => {
    it('keeps a span that is in view', () => {
        expect(revealScrollOffset(100, 200, 50, 300)).toBeNull();
    });

    it('scrolls up to a span above the viewport', () => {
        expect(revealScrollOffset(100, 200, 400, 300)).toBe(84);
    });

    it('scrolls a span below the viewport just above the composer', () => {
        expect(revealScrollOffset(500, 600, 0, 300)).toBe(316);
    });

    it('shows the start of a span taller than the viewport', () => {
        expect(revealScrollOffset(500, 1200, 0, 300)).toBe(484);
        expect(revealScrollOffset(500, 1200, 484, 300)).toBeNull();
    });
});
