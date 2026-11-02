import * as arrow from 'apache-arrow';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findResizableColumn, MIN_RESIZED_COLUMN_WIDTH, type DataTableColumnResizeHandlers, type ResizedColumnWidths, useDataTableColumnResize } from './data_table_column_resize.js';
import { createTestRoot } from '../../tests/react_root.js';
import * as styles from './data_table.module.css';
import type { DataTableLayout } from './data_table_layout.js';

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

describe('useDataTableColumnResize', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    let grid: HTMLDivElement | null = null;
    afterEach(() => {
        root?.unmount();
        grid?.remove();
        root = null;
    });

    /// The handlers of a grid at the top left of the window with the columns a, b and c after the row numbers
    function renderResize() {
        grid = document.createElement('div');
        grid.style.cssText = 'position: fixed; left: 0; top: 0; width: 500px; height: 200px;';
        document.body.appendChild(grid);
        const table = arrow.tableFromArrays({ rownum: Int32Array.from([0]), a: Int32Array.from([1]), b: Int32Array.from([2]), c: Int32Array.from([3]) });
        const layout = createLayout([0, 48, 168, 288, 408]);
        let widths: ResizedColumnWidths = new Map();
        const setWidths = (update: React.SetStateAction<ResizedColumnWidths>) => { widths = typeof update === 'function' ? update(widths) : update; };
        const current = { handlers: null as DataTableColumnResizeHandlers | null };
        function Probe() {
            current.handlers = useDataTableColumnResize({ element: grid }, layout, table, setWidths);
            return null;
        }
        root = createTestRoot();
        root.render(React.createElement(Probe));
        return { handlers: () => current.handlers!, widths: () => widths };
    }

    /// A pointer event at the position of the grid
    const event = (clientX: number, fields: object = {}) => {
        const target = grid!;
        target.setPointerCapture = vi.fn();
        return { clientX, clientY: 10, button: 0, pointerType: 'mouse', pointerId: 1, currentTarget: target, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...fields } as never;
    };

    it('resizes a column by dragging its right border and swallows the click', () => {
        const { handlers, widths } = renderResize();
        handlers().onPointerDownCapture(event(168));
        handlers().onPointerMove(event(200));
        handlers().onPointerUp(event(200));
        expect(widths()).toEqual(new Map([['a', 152]]));

        const click = event(200) as unknown as { preventDefault: () => void };
        handlers().onClickCapture(click as never);
        expect(click.preventDefault).toHaveBeenCalled();
    });

    it('keeps the minimum width', () => {
        const { handlers, widths } = renderResize();
        handlers().onPointerDownCapture(event(168));
        handlers().onPointerMove(event(0));
        handlers().onPointerCancel(event(0));
        expect(widths().get('a')).toBe(MIN_RESIZED_COLUMN_WIDTH);
    });

    it('ignores other buttons, touches, other pointers and the inside of cells', () => {
        const { handlers, widths } = renderResize();
        handlers().onPointerDownCapture(event(168, { button: 2 }));
        handlers().onPointerDownCapture(event(168, { pointerType: 'touch' }));
        handlers().onPointerDownCapture(event(100));
        handlers().onPointerUp(event(100));
        handlers().onPointerDownCapture(event(168));
        handlers().onPointerMove(event(220, { pointerId: 2 }));
        handlers().onLostPointerCapture(event(220));
        expect(widths().size).toBe(0);
    });

    it('marks hovered borders', () => {
        const { handlers } = renderResize();
        handlers().onPointerMove(event(288));
        expect(grid!.classList.contains(styles.column_resize_hover)).toBe(true);
        handlers().onPointerLeave(event(288));
        expect(grid!.classList.contains(styles.column_resize_hover)).toBe(false);
    });

    it('restores the natural width on a double click', () => {
        const { handlers, widths } = renderResize();
        handlers().onPointerDownCapture(event(168));
        handlers().onPointerMove(event(200));
        handlers().onPointerUp(event(200));
        // Columns without a resized width stay as they are, the layout keeps the border of a at 168
        handlers().onDoubleClickCapture(event(288));
        expect(widths()).toEqual(new Map([['a', 152]]));
        handlers().onDoubleClickCapture(event(168));
        expect(widths().size).toBe(0);
    });
});

