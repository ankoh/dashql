import { describe, expect, it, vi } from 'vitest';

import { FeedRowHeightCache, revealScrollOffset } from './session_feed_layout.js';

describe('FeedRowHeightCache', () => {
    it('adds the spaces of the feed to the script estimates before rows mount', () => {
        const heights = new FeedRowHeightCache([
            { scriptId: 1, estimatedHeight: 122 },
            { scriptId: 2, estimatedHeight: 202 },
            { scriptId: 3, estimatedHeight: 82 },
        ]);

        // The top padding, the gaps between the scripts, the end padding
        expect([0, 1, 2].map(index => heights.getRowHeight(index))).toEqual([
            32 + 122 + 32, 202 + 32, 82 + 32,
        ]);
        expect(heights.getRowHeight(3)).toBeUndefined();
        expect(heights.getAverageRowHeight()).toBe((32 + 122 + 32 + 202 + 32 + 82 + 32) / 3);
    });

    it('holds both paddings in the row of a single script', () => {
        const heights = new FeedRowHeightCache([{ scriptId: 1, estimatedHeight: 122 }]);

        expect(heights.getRowHeight(0)).toBe(32 + 122 + 32);
        expect(heights.getEntrySpan(0)).toEqual([32, 154]);
    });

    it('retains measured script heights by identity while entries update', () => {
        const onChange = vi.fn();
        const heights = new FeedRowHeightCache([
            { scriptId: 1, estimatedHeight: 122 },
            { scriptId: 2, estimatedHeight: 202 },
        ], onChange);
        heights.setRowHeight(0, 137);
        heights.updateEntries([
            { scriptId: 2, estimatedHeight: 202 },
            { scriptId: 1, estimatedHeight: 162 },
        ]);

        // Script 1 measures 25px below its new estimate, the unmeasured script 2 follows
        expect(heights.getRowHeight(0)).toBe(32 + 177 + 32);
        expect(heights.getRowHeight(1)).toBe(137 + 32);
        expect(onChange).toHaveBeenCalledOnce();
    });

    /// Four measured scripts of 100px: the rows start at 0, 164, 296 and 428
    function measuredHeights(scrollOffset: number) {
        const onChange = vi.fn();
        const heights = new FeedRowHeightCache(
            [1, 2, 3, 4].map(scriptId => ({ scriptId, estimatedHeight: 100 })),
            onChange,
            () => scrollOffset,
        );
        for (let index = 0; index < 4; ++index) heights.setRowHeight(index, 100);
        onChange.mockClear();
        return { heights, onChange };
    }

    it('reports how far a row above the viewport moves the row at the top of the viewport', () => {
        const { heights, onChange } = measuredHeights(200);
        heights.setRowHeight(0, 150);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(50);
    });

    it('keeps the scroll position when the top row of the viewport or a row below it changes', () => {
        const { heights, onChange } = measuredHeights(200);
        heights.setRowHeight(1, 150);
        heights.setRowHeight(3, 150);
        expect(onChange.mock.calls).toEqual([[0], [0]]);
    });

    it('keeps the scroll position at the top of the feed', () => {
        const { heights, onChange } = measuredHeights(0);
        heights.setRowHeight(0, 150);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(0);
    });

    it('reports the estimates above the viewport that follow a measured row', () => {
        const onChange = vi.fn();
        const heights = new FeedRowHeightCache(
            [1, 2, 3, 4].map(scriptId => ({ scriptId, estimatedHeight: 100 })),
            onChange,
            () => 300,
        );
        // The script below the viewport measures 80px above its estimate, so do the estimates of the two rows above
        heights.setRowHeight(3, 180);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(160);
    });

    it('raises the estimates of unmeasured scripts by the excess of the measured ones', () => {
        const heights = new FeedRowHeightCache([
            { scriptId: 1, estimatedHeight: 104 },
            { scriptId: 2, estimatedHeight: 104 },
            { scriptId: 3, estimatedHeight: 140 },
        ]);
        heights.setRowHeight(0, 504);
        heights.setRowHeight(1, 304);

        expect([0, 1, 2].map(index => heights.getEntrySpan(index)[1] - heights.getEntrySpan(index)[0])).toEqual([504, 304, 440]);
    });

    it('keeps the extrapolated height of a long feed close to its rows', () => {
        // A long feed of result cards, react-window lays out the rows down to the viewport
        const rowCount = 200;
        const heights = new FeedRowHeightCache(Array.from({ length: rowCount }, (_, i) => ({ scriptId: i, estimatedHeight: 104 })));
        const laidOut = 20;
        for (let index = 0; index < laidOut; ++index) heights.setRowHeight(index, 520);

        // react-window sizes the list as the row count times the mean of the rows it has laid out
        const extrapolated = rowCount * heights.getRowOffset(laidOut) / laidOut;
        const actual = heights.getRowOffset(rowCount);
        expect(Math.abs(extrapolated - actual) / actual).toBeLessThan(0.05);
    });

    it('sums the rows above a row for its offset and spans the card without the spaces', () => {
        const heights = new FeedRowHeightCache([
            { scriptId: 1, estimatedHeight: 122 },
            { scriptId: 2, estimatedHeight: 202 },
        ]);
        heights.setRowHeight(0, 137);

        // Script 2 is not measured, it follows the 15px excess of script 1
        expect([0, 1, 2].map(index => heights.getRowOffset(index))).toEqual([0, 201, 450]);
        expect(heights.getEntrySpan(0)).toEqual([32, 169]);
        expect(heights.getEntrySpan(1)).toEqual([201, 418]);
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
