import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { ArrowTableFormatter } from '../../../../../compute/arrow_formatter.js';
import { createTableComputationState } from '../../../../../compute/computation_state.js';
import { ColumnGroup, ORDINAL_COLUMN, ROWNUMBER_COLUMN } from '../../../../../compute/computation_types.js';
import { TestLogger } from '../../../../../platform/logger/test_logger.js';
import { findResizableColumn } from './data_table_column_resize.js';
import { computeTableLayout, DataTableLayout } from './data_table_layout.js';

function createLayout(columnXOffsets: number[]): DataTableLayout {
    const columnCount = columnXOffsets.length - 1;
    return {
        columnCount,
        arrowFieldByColumnIndex: Uint32Array.from({ length: columnCount }, (_, i) => i),
        columnXOffsets: new Float64Array(columnXOffsets),
        columnAggregateByColumnIndex: new Int32Array(columnCount),
        columnGroupByColumnIndex: new Uint32Array(columnCount),
        isSystemColumn: new Uint8Array(columnCount),
        isTextColumn: new Uint8Array(columnCount),
        headerRowCount: 1,
    };
}

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

describe('findResizableColumn', () => {
    const layout = createLayout([0, 48, 168, 288, 408]);

    it('grabs the right border of a data column within the tolerance', () => {
        expect(findResizableColumn(layout, 168, 168)).toBe(1);
        expect(findResizableColumn(layout, 165, 165)).toBe(1);
        expect(findResizableColumn(layout, 291, 291)).toBe(2);
        expect(findResizableColumn(layout, 408, 408)).toBe(3);
    });

    it('ignores the inside of cells and the sticky row-number column', () => {
        expect(findResizableColumn(layout, 120, 120)).toBeNull();
        expect(findResizableColumn(layout, 48, 48)).toBeNull();
        expect(findResizableColumn(layout, 420, 420)).toBeNull();
    });

    it('ignores borders scrolled behind the sticky column', () => {
        // Scrolled by 122px, the border of column 1 sits at 46px in the viewport
        expect(findResizableColumn(layout, 168, 46)).toBeNull();
        expect(findResizableColumn(layout, 288, 166)).toBe(2);
    });
});

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
});
