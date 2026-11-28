import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { ArrowTableFormatter } from '@akohn/dashql/platform/compute/arrow_formatter';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { act } from '../../testing/react_act.js';
import { createTestRoot } from '../../testing/react_root.js';
import type { DataTableLayout } from './data_table_layout.js';
import { DataTableRowDetail, rowDetailOf } from './data_table_row_detail.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

// The row number, then the columns of the result. The fixture builds the table without the eval of Arrow, which the
// Content-Security-Policy of the test page forbids.
const TABLE = tableFromArrays({
    _rownum: Int32Array.from([1, 2, 3]),
    region: ['East', 'West', null],
    orders: Int32Array.from([12, 7, 3]),
});
const FORMATTER = new ArrowTableFormatter(TABLE.schema, TABLE.batches, new TestLogger());
// The layout shows the row number first, then orders before region
const LAYOUT = { arrowFieldByColumnIndex: [0, 2, 1] } as unknown as DataTableLayout;

describe('rowDetailOf', () => {
    it('lists the fields of a row in the order of the columns, without the row number', () => {
        const detail = rowDetailOf(TABLE, FORMATTER, LAYOUT, 2, 12)!;
        expect(detail.visibleRow).toBe(12);
        expect(detail.fields.map(field => [field.name, field.value])).toEqual([['orders', '3'], ['region', null]]);
        expect(detail.fields[0].type).toBe('Int32');
    });

    it('has no detail for a row outside of the table', () => {
        expect(rowDetailOf(TABLE, FORMATTER, LAYOUT, 3, 3)).toBeNull();
        expect(rowDetailOf(TABLE, FORMATTER, LAYOUT, -1, 0)).toBeNull();
    });
});

describe('DataTableRowDetail', () => {
    let root: ReturnType<typeof createTestRoot>;
    beforeEach(() => { root = createTestRoot(); });
    afterEach(() => root.unmount());
    const button = (testId: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

    it('shows the fields of the row and steps through the rows', () => {
        const onNavigate = vi.fn();
        const onClose = vi.fn();
        root.render(<DataTableRowDetail detail={rowDetailOf(TABLE, FORMATTER, LAYOUT, 0, 0)!} rowCount={3} onNavigate={onNavigate} onClose={onClose} />);
        const sheet = document.querySelector('[data-testid="data-table-row-detail"]')!;
        expect(sheet.querySelector('h2')!.textContent).toBe('Row 1 of 3');
        expect([...sheet.querySelectorAll('[data-testid="data-table-row-field"] dd')].map(value => value.textContent)).toEqual(['12', 'East']);
        // The first row has no row before it
        expect(button('data-table-row-previous').disabled).toBe(true);
        act(() => button('data-table-row-next').click());
        expect(onNavigate).toHaveBeenCalledWith(1);
        act(() => button('sheet-close').click());
        expect(onClose).toHaveBeenCalledOnce();
    });
});
