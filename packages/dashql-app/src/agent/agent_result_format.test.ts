import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { formatResultSlice, sliceResult } from './agent_result_format.js';

describe('agent result format', () => {
    const table = arrow.tableFromArrays({
        id: Int32Array.from({ length: 120 }, (_, i) => i + 1),
        name: Array.from({ length: 120 }, (_, i) => (i === 1 ? null : `name\t${i}`)),
    });

    it('prints the first rows with a hint for more', () => {
        const slice = sliceResult(table, 0, 2);
        expect(slice.rowCount).toBe(120);
        expect(slice.rows).toEqual([[1, 'name\t0'], [2, null]]);
        expect(formatResultSlice(slice, 'q1')).toBe([
            '120 rows, 2 columns',
            'id (Int32)\tname (Dictionary<Int32, Utf8>)',
            '1\tname 0',
            '2\tNULL',
            '(rows 1-2 of 120)',
            'More rows: dashql agent result q1 --page 1',
        ].join('\n'));
    });

    it('pages through the rows', () => {
        const text = formatResultSlice(sliceResult(table, 50, 50), 'q1');
        expect(text).toContain('(rows 51-100 of 120)');
        expect(text).toContain('--page 3');
        const last = formatResultSlice(sliceResult(table, 100, 50), 'q1');
        expect(last).toContain('(rows 101-120 of 120)');
        expect(last).not.toContain('More rows');
    });

    it('converts values to JSON', () => {
        const values = arrow.tableFromArrays({ big: BigInt64Array.from([1n, 2n ** 60n]) });
        expect(sliceResult(values, 0, 10).rows).toEqual([[1], ['1152921504606846976']]);
    });

    it('prints an empty result', () => {
        expect(formatResultSlice(sliceResult(arrow.tableFromArrays({ id: Int32Array.from([]) }), 0, 20), 'q1')).toBe('0 rows, 1 column\nid (Int32)');
    });
});
