import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { ArrowTableFormatter } from '../../compute/arrow_formatter.js';
import { createTableComputationState } from '../../compute/computation_state.js';
import { ColumnGroup, ORDINAL_COLUMN, ROWNUMBER_COLUMN, STRING_COLUMN } from '../../compute/computation_types.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { computeTableLayout, DataTableLayout } from './data_table_layout.js';

function createTableState() {
    const table = arrow.tableFromArrays({
        rownum: Int32Array.from([0, 1]),
        a: Int32Array.from([1, 2]),
        b: Int32Array.from([3, 4]),
    });
    const ordinal = (name: string): ColumnGroup => ({
        type: ORDINAL_COLUMN,
        value: {
            inputFieldName: name,
            inputFieldType: new arrow.Int32(),
            inputFieldNullable: false,
            statsFields: null,
            binFieldName: null,
            binCount: 0,
        },
    });
    const columnGroups: ColumnGroup[] = [
        { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } },
        ordinal('a'),
        ordinal('b'),
    ];
    const state = createTableComputationState(1, table, columnGroups, new AbortController());
    const formatter = new ArrowTableFormatter(table.schema, table.batches, new TestLogger());
    return { state, formatter };
}

function columnWidths(layout: DataTableLayout): number[] {
    return Array.from({ length: layout.columnCount }, (_, i) => layout.columnXOffsets[i + 1] - layout.columnXOffsets[i]);
}

/// A table with an ordinal column a and its bin column, and a string column s and its value ids
function createTableStateWithSystemColumns() {
    const ints = (...values: number[]) => arrow.vectorFromArray(Int32Array.from(values));
    const table = new arrow.Table({
        rownum: ints(0, 1),
        a: ints(1, 2),
        a_bin: ints(0, 1),
        s: arrow.vectorFromArray(['x', 'y'], new arrow.Utf8()),
        s_id: ints(0, 1),
    });
    const columnGroups: ColumnGroup[] = [
        { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } },
        { type: ORDINAL_COLUMN, value: { inputFieldName: 'a', inputFieldType: new arrow.Int32(), inputFieldNullable: false, statsFields: null, binFieldName: 'a_bin', binCount: 2 } },
        { type: STRING_COLUMN, value: { inputFieldName: 's', inputFieldType: new arrow.Utf8(), inputFieldNullable: false, statsFields: null, valueIdFieldName: 's_id' } },
    ];
    const state = createTableComputationState(1, table, columnGroups, new AbortController());
    const formatter = new ArrowTableFormatter(table.schema, table.batches, new TestLogger());
    return { state, formatter, table };
}

describe('computeTableLayout', () => {
    it('applies resized widths and stretches only the other columns', () => {
        const { state, formatter } = createTableState();
        const natural = columnWidths(computeTableLayout(formatter, state, false, 1));
        expect(natural).toEqual([48, 120, 120]);

        const resized = computeTableLayout(formatter, state, false, 1, 0, null, new Map([['a', 200]]));
        expect(columnWidths(resized)).toEqual([48, 200, 120]);

        const stretched = computeTableLayout(formatter, state, false, 1, 600, null, new Map([['a', 80]]));
        expect(columnWidths(stretched)).toEqual([48, 80, 472]);
    });

    it('shows the bin and value id columns as system columns', () => {
        const { state, formatter, table } = createTableStateWithSystemColumns();
        const fieldNames = (layout: DataTableLayout) => Array.from(layout.arrowFieldByColumnIndex, field => table.schema.fields[field].name);

        const hidden = computeTableLayout(formatter, state, false, 1);
        expect(fieldNames(hidden)).toEqual(['rownum', 'a', 's']);

        const shown = computeTableLayout(formatter, state, true, 1);
        expect(fieldNames(shown)).toEqual(['rownum', 'a', 'a_bin', 's', 's_id']);
        expect([...shown.isSystemColumn]).toEqual([0, 0, 1, 0, 1]);
        expect([...shown.isTextColumn]).toEqual([0, 0, 0, 1, 0]);
        expect([...shown.columnGroupByColumnIndex]).toEqual([0, 1, 1, 2, 2]);
    });

    it('lays out only the visible column groups next to the row numbers', () => {
        const { state, formatter, table } = createTableStateWithSystemColumns();
        const layout = computeTableLayout(formatter, state, true, 1, 0, new Set([2]));
        expect(Array.from(layout.arrowFieldByColumnIndex, field => table.schema.fields[field].name)).toEqual(['rownum', 's', 's_id']);
    });
});

