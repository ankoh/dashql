import { describe, expect, it, vi } from 'vitest';

import { FeedRowHeightCache } from './notebook_feed_layout.js';

describe('FeedRowHeightCache', () => {
    it('uses exact separator and script estimates before rows mount', () => {
        const heights = new FeedRowHeightCache([
            { fileName: '01_one.sql', scriptId: 1, estimatedHeight: 122 },
            { fileName: '02_two.sql', scriptId: 2, estimatedHeight: 202 },
        ]);

        expect([0, 1, 2, 3, 4].map(index => heights.getRowHeight(index))).toEqual([
            48, 122, 40, 202, 40,
        ]);
    });

    it('retains measured script heights by identity while entries update', () => {
        const onChange = vi.fn();
        const heights = new FeedRowHeightCache([
            { fileName: '01_one.sql', scriptId: 1, estimatedHeight: 122 },
            { fileName: '02_two.sql', scriptId: 2, estimatedHeight: 202 },
        ], onChange);
        heights.setRowHeight(1, 137);
        heights.updateEntries([
            { fileName: '01_two.sql', scriptId: 2, estimatedHeight: 202 },
            { fileName: '02_one.sql', scriptId: 1, estimatedHeight: 162 },
        ]);

        expect(heights.getRowHeight(1)).toBe(202);
        expect(heights.getRowHeight(3)).toBe(137);
        expect(heights.getAverageRowHeight()).toBe((48 + 202 + 40 + 137 + 40) / 5);
        expect(heights.getRowOffset(3)).toBe(48 + 202 + 40);
        expect(onChange).toHaveBeenCalledWith(1, 122, 137);
    });
});
