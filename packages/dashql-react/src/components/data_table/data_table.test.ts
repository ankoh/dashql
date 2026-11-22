import { describe, expect, it } from 'vitest';

import { COLUMN_HEADER_HEIGHT, computeGridHeight, fittingRowCount, ROW_HEIGHT } from './data_table.js';

describe('computeGridHeight', () => {
    it('keeps a fitted grid at its base result height when cross-filtering rows', () => {
        const initialHeight = computeGridHeight(8, 8, 108, 0, true, 568);
        const heightAfterCrossFiltering = computeGridHeight(8, 1, 108, 0, true, 568);
        const heightAfterCrossFilteringToZero = computeGridHeight(8, 0, 108, 0, true, 568);

        expect(initialHeight).toBe(108 + 8 * ROW_HEIGHT);
        expect(heightAfterCrossFiltering).toBe(initialHeight);
        expect(heightAfterCrossFilteringToZero).toBe(initialHeight);
    });

    it('caps large results at the configured maximum height', () => {
        expect(computeGridHeight(100, 100, 108, 15, true, 568)).toBe(568);
    });
});

describe('fittingRowCount', () => {
    it('counts the rows below the column header, the last one may be cut off', () => {
        expect(fittingRowCount(COLUMN_HEADER_HEIGHT + 5 * ROW_HEIGHT)).toBe(5);
        expect(fittingRowCount(COLUMN_HEADER_HEIGHT + 5 * ROW_HEIGHT + 1)).toBe(6);
        // A host that is a little taller than 7 rows shows a cut off eighth row and not 7 rows over a hole
        expect(fittingRowCount(COLUMN_HEADER_HEIGHT + 7 * ROW_HEIGHT + 12)).toBe(8);
    });

    it('shows one row in a host that is too small', () => {
        expect(fittingRowCount(0)).toBe(1);
    });
});
