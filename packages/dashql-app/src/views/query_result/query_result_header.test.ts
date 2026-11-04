import * as arrow from 'apache-arrow';

import { formatResultDetail, formatResultRowCount, getResultTableBytes } from './query_result_header.js';
import { tableFromArrays, vectorFromArray } from '../../tests/arrow_fixtures.js';

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

describe('getResultTableBytes', () => {
    it('sums the buffers of every column of every batch', () => {
        const table = new arrow.Table([
            tableFromArrays({ value: new Int32Array([1, 2, 3]) }).batches[0],
            tableFromArrays({ value: new Int32Array([4, 5]) }).batches[0],
        ]);
        const expected = table.batches.reduce((bytes, batch) => bytes + batch.data.byteLength, 0);
        expect(expected).toBeGreaterThanOrEqual(5 * 4);
        expect(getResultTableBytes(table)).toBe(expected);
    });

    it('counts a dictionary that the batches share once', () => {
        const dictionary = vectorFromArray(['alpha', 'beta'], new arrow.Utf8());
        const type = new arrow.Dictionary(new arrow.Utf8(), new arrow.Int32());
        const batch = (indices: number[]) => {
            const data = arrow.makeData({ type, length: indices.length, data: new Int32Array(indices), dictionary });
            return new arrow.RecordBatch({ value: data });
        };
        const table = new arrow.Table([batch([0, 1, 0]), batch([1])]);
        const indexBytes = table.batches.reduce((bytes, b) => bytes + b.data.byteLength, 0);
        const dictionaryBytes = dictionary.data.reduce((bytes, data) => bytes + data.byteLength, 0);
        expect(dictionaryBytes).toBeGreaterThan(0);
        expect(getResultTableBytes(table)).toBe(indexBytes + dictionaryBytes);
    });
});

describe('formatResultDetail', () => {
    it('appends the size of the result table to the row count', () => {
        const table = tableFromArrays({ value: new Float64Array(1000) });
        expect(formatResultDetail('1000 rows', table)).toBe('1000 rows, 8 kB');
    });

    it('shows only the row count without a result table', () => {
        expect(formatResultDetail('3 rows', null)).toBe('3 rows');
        expect(formatResultDetail(null, tableFromArrays({ value: [1] }))).toBeNull();
    });
});
