import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { ArrowTableFormatter } from '@akohn/dashql/platform/compute/arrow_formatter';
import { valueColumn } from '../../testing/computation_mocks.js';
import type { ComputationColumnGroup } from '@akohn/dashql';
import { ORDINAL_COLUMN, ROWNUMBER_COLUMN, STRING_COLUMN } from '@akohn/dashql/platform/compute/computation_types';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { computeTableLayout, DataTableLayout, MIN_COLUMN_WIDTH, ROW_HEADER_WIDTH } from './data_table_layout.js';
import { tableFromArrays, vectorFromArray } from '@akohn/dashql/platform/testing/arrow_fixtures';

function createTableState() {
    const table = tableFromArrays({
        rownum: Int32Array.from([0, 1]),
        a: Int32Array.from([1, 2]),
        b: Int32Array.from([3, 4]),
    });
    const ordinal = (name: string): ComputationColumnGroup => ({
        type: ORDINAL_COLUMN,
        value: valueColumn(name, 'Int32', { inputFieldNullable: false }),
    });
    const columnGroups: ComputationColumnGroup[] = [
        { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } },
        ordinal('a'),
        ordinal('b'),
    ];
    const state = { columnGroups, dataTable: table };
    const formatter = new ArrowTableFormatter(table.schema, table.batches, new TestLogger());
    return { state, formatter };
}

function columnWidths(layout: DataTableLayout): number[] {
    return Array.from({ length: layout.columnCount }, (_, i) => layout.columnXOffsets[i + 1] - layout.columnXOffsets[i]);
}

/// A table with an ordinal column a and a string column s
function createTableStateWithTwoKinds() {
    const ints = (...values: number[]) => vectorFromArray(Int32Array.from(values));
    const table = new arrow.Table({
        rownum: ints(0, 1),
        a: ints(1, 2),
        s: vectorFromArray(['x', 'y'], new arrow.Utf8()),
    });
    const columnGroups: ComputationColumnGroup[] = [
        { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } },
        { type: ORDINAL_COLUMN, value: valueColumn('a', 'Int32', { inputFieldNullable: false, binFieldName: 'a_bin', binCount: 2 }) },
        { type: STRING_COLUMN, value: valueColumn('s', 'Utf8', { inputFieldNullable: false, valueIdFieldName: 's_id' }) },
    ];
    const state = { columnGroups, dataTable: table };
    const formatter = new ArrowTableFormatter(table.schema, table.batches, new TestLogger());
    return { state, formatter, table };
}

describe('computeTableLayout', () => {
    it('applies resized widths and stretches only the other columns', () => {
        const { state, formatter } = createTableState();
        const natural = columnWidths(computeTableLayout(formatter, state, 1));
        expect(natural).toEqual([ROW_HEADER_WIDTH, MIN_COLUMN_WIDTH, MIN_COLUMN_WIDTH]);

        const resized = computeTableLayout(formatter, state, 1, 0, null, new Map([['a', 200]]));
        expect(columnWidths(resized)).toEqual([ROW_HEADER_WIDTH, 200, MIN_COLUMN_WIDTH]);

        const stretched = computeTableLayout(formatter, state, 1, 600, null, new Map([['a', 80]]));
        expect(columnWidths(stretched)).toEqual([ROW_HEADER_WIDTH, 80, 600 - ROW_HEADER_WIDTH - 80]);
    });

    it('lays out a column per value column, the bins and the value ids stay in the compute database', () => {
        const { state, formatter, table } = createTableStateWithTwoKinds();
        const layout = computeTableLayout(formatter, state, 1);
        expect(Array.from(layout.arrowFieldByColumnIndex, field => table.schema.fields[field].name)).toEqual(['rownum', 'a', 's']);
        expect([...layout.isTextColumn]).toEqual([0, 0, 1]);
        expect([...layout.columnGroupByColumnIndex]).toEqual([0, 1, 2]);
    });

    it('lays out only the visible column groups next to the row numbers', () => {
        const { state, formatter, table } = createTableStateWithTwoKinds();
        const layout = computeTableLayout(formatter, state, 1, 0, new Set([2]));
        expect(Array.from(layout.arrowFieldByColumnIndex, field => table.schema.fields[field].name)).toEqual(['rownum', 's']);
    });
});

