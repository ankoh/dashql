import { describe, expect, it } from 'vitest';

import { resolveSearchedRowIndices } from './visible_rows.js';
import type { ComputationTables } from './computation_tables.js';
import { mockTableComputation } from '../../tests/mocks/computation.js';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';

const tables = (fields: Partial<ComputationTables>): ComputationTables => ({
    dataTable: null,
    filterTable: null,
    orderingTable: null,
    dataSearchTable: null,
    matchingRows: null,
    ...fields,
});

describe('resolveSearchedRowIndices', () => {
    const computation = mockTableComputation([]);

    it('intersects Data matches with cross-filtered rows', () => {
        const resolved = tables({
            filterTable: tableFromArrays({ row_idx: new Int32Array([1, 3, 4]) }),
            matchingRows: new Map([[2, [0]], [3, [1]], [4, [0]]]),
        });
        expect(Array.from(resolveSearchedRowIndices(computation, resolved)!)).toEqual([2, 3]);
    });

    it('preserves the active ordering while intersecting matches', () => {
        const resolved = tables({
            orderingTable: tableFromArrays({ row_idx: new Int32Array([4, 2, 1]) }),
            matchingRows: new Map([[1, [0]], [4, [1]]]),
        });
        expect(Array.from(resolveSearchedRowIndices(computation, resolved)!)).toEqual([3, 0]);
    });

    it('uses a materialized Data-search table directly without cross-filters', () => {
        const resolved = tables({
            dataSearchTable: tableFromArrays({ row_idx: new Int32Array([2, 4]) }),
            matchingRows: new Map([[2, [0]], [4, [1]]]),
        });
        expect(Array.from(resolveSearchedRowIndices(computation, resolved)!)).toEqual([1, 3]);
    });
});
