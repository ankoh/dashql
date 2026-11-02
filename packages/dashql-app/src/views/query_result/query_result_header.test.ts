import { formatResultRowCount } from './query_result_header.js';

describe('formatResultRowCount', () => {
    it('is null while the total is unknown', () => {
        expect(formatResultRowCount({ totalRows: null, currentRows: null, matchingRows: null })).toBeNull();
    });

    it('counts all rows of a full table', () => {
        expect(formatResultRowCount({ totalRows: 1, currentRows: 1, matchingRows: null })).toBe('1 row');
        expect(formatResultRowCount({ totalRows: 1000, currentRows: 1000, matchingRows: null })).toBe('1000 rows');
    });

    it('counts the matches of a search', () => {
        expect(formatResultRowCount({ totalRows: 1000, currentRows: 400, matchingRows: 12 })).toBe('12 of 400 rows');
    });

    it('counts the shown rows of a preview', () => {
        expect(formatResultRowCount({ totalRows: 1000, currentRows: 1000, matchingRows: null }, 6)).toBe('6 of 1000 rows');
        expect(formatResultRowCount({ totalRows: 3, currentRows: 3, matchingRows: null }, 6)).toBe('3 rows');
        expect(formatResultRowCount({ totalRows: 1000, currentRows: 1000, matchingRows: 12 }, 6)).toBe('6 of 12 matching rows');
        expect(formatResultRowCount({ totalRows: 1000, currentRows: 1000, matchingRows: 4 }, 6)).toBe('4 of 1000 rows');
    });
});
