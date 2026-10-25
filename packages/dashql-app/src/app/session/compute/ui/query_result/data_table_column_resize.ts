import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './data_table.module.css';

import { DataTableLayout } from './data_table_layout.js';

/// The distance in pixels from a column border that still grabs the border
const RESIZE_HANDLE_TOLERANCE = 4;
/// Resized columns stay wide enough to show a few characters
export const MIN_RESIZED_COLUMN_WIDTH = 40;

/// Widths of the columns that the user resized, keyed by field name
export type ResizedColumnWidths = ReadonlyMap<string, number>;

/// Find the column whose right border is under the pointer.
/// The sticky row-number column is not resizable and borders scrolled behind it can't be grabbed.
export function findResizableColumn(layout: DataTableLayout, contentX: number, viewportX: number): number | null {
    const offsets = layout.columnXOffsets;
    if (layout.columnCount < 2) {
        return null;
    }
    // Find the first data column whose right border is not left of the pointer
    let lo = 1;
    let hi = layout.columnCount - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid + 1] < contentX - RESIZE_HANDLE_TOLERANCE) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    const border = offsets[lo + 1];
    if (Math.abs(border - contentX) > RESIZE_HANDLE_TOLERANCE) {
        return null;
    }
    const stickyColumnWidth = offsets[1] - offsets[0];
    const borderViewportX = border - (contentX - viewportX);
    if (borderViewportX <= stickyColumnWidth) {
        return null;
    }
    return lo;
}

/// A column border that is being dragged
interface ColumnResizeDrag {
    /// The pointer that grabbed the border
    pointerId: number;
    /// The field name of the resized column
    fieldName: string;
    /// The pointer position when grabbing the border
    startX: number;
    /// The column width when grabbing the border
    startWidth: number;
}

/// A column width that waits for the next animation frame
interface PendingColumnWidth {
    /// The field name of the resized column
    fieldName: string;
    /// The new column width
    width: number;
}

/// The grid element that scrolls the cells
interface GridApi {
    element: HTMLDivElement | null;
}

/// The pointer handlers of the grid container
export interface DataTableColumnResizeHandlers {
    onPointerDownCapture: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp: React.PointerEventHandler<HTMLDivElement>;
    onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
    onLostPointerCapture: React.PointerEventHandler<HTMLDivElement>;
    onPointerLeave: React.PointerEventHandler<HTMLDivElement>;
    onClickCapture: React.MouseEventHandler<HTMLDivElement>;
    onDoubleClickCapture: React.MouseEventHandler<HTMLDivElement>;
}

/// Resize columns by dragging the right border of any cell, double-clicking a border restores the width.
/// The grid container hit-tests the borders against the layout, the cells don't carry any handles.
export function useDataTableColumnResize(
    gridApi: GridApi | null,
    gridLayout: DataTableLayout,
    table: arrow.Table,
    setResizedColumnWidths: React.Dispatch<React.SetStateAction<ResizedColumnWidths>>,
): DataTableColumnResizeHandlers {
    // Read the latest layout from the stable handlers
    const layout = React.useRef(gridLayout);
    layout.current = gridLayout;
    const schema = React.useRef(table.schema);
    schema.current = table.schema;

    const drag = React.useRef<ColumnResizeDrag | null>(null);
    const suppressClick = React.useRef(false);
    const pendingWidth = React.useRef<PendingColumnWidth | null>(null);
    const pendingFrame = React.useRef<number | null>(null);
    React.useEffect(() => () => {
        if (pendingFrame.current != null) {
            cancelAnimationFrame(pendingFrame.current);
        }
    }, []);

    return React.useMemo(() => {
        const hitTest = (event: React.MouseEvent<HTMLDivElement>): number | null => {
            const grid = gridApi?.element;
            if (grid == null) {
                return null;
            }
            const bounds = grid.getBoundingClientRect();
            const viewportX = event.clientX - bounds.left;
            const viewportY = event.clientY - bounds.top;
            // Ignore the scrollbars
            if (viewportX > grid.clientWidth || viewportY > grid.clientHeight) {
                return null;
            }
            return findResizableColumn(layout.current, viewportX + grid.scrollLeft, viewportX);
        };
        const applyPendingWidth = () => {
            if (pendingFrame.current != null) {
                cancelAnimationFrame(pendingFrame.current);
                pendingFrame.current = null;
            }
            const pending = pendingWidth.current;
            pendingWidth.current = null;
            if (pending != null) {
                setResizedColumnWidths(prev => new Map(prev).set(pending.fieldName, pending.width));
            }
        };
        const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
            if (drag.current?.pointerId !== event.pointerId) {
                return;
            }
            applyPendingWidth();
            drag.current = null;
        };
        return {
            onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => {
                suppressClick.current = false;
                if (event.button !== 0 || event.pointerType === 'touch') {
                    return;
                }
                const column = hitTest(event);
                if (column == null) {
                    return;
                }
                // Keep the cells and plots from seeing the press, also prevents text selection
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                const offsets = layout.current.columnXOffsets;
                const fieldId = layout.current.arrowFieldByColumnIndex[column];
                drag.current = {
                    pointerId: event.pointerId,
                    fieldName: schema.current.fields[fieldId].name,
                    startX: event.clientX,
                    startWidth: offsets[column + 1] - offsets[column],
                };
                suppressClick.current = true;
            },
            onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
                const active = drag.current;
                if (active == null) {
                    event.currentTarget.classList.toggle(styles.column_resize_hover, hitTest(event) != null);
                    return;
                }
                if (active.pointerId !== event.pointerId) {
                    return;
                }
                // Coalesce the widths per frame, every width re-renders the visible cells
                pendingWidth.current = {
                    fieldName: active.fieldName,
                    width: Math.max(MIN_RESIZED_COLUMN_WIDTH, active.startWidth + event.clientX - active.startX),
                };
                if (pendingFrame.current == null) {
                    pendingFrame.current = requestAnimationFrame(() => {
                        pendingFrame.current = null;
                        applyPendingWidth();
                    });
                }
            },
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onLostPointerCapture: endDrag,
            onPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => {
                if (drag.current == null) {
                    event.currentTarget.classList.remove(styles.column_resize_hover);
                }
            },
            onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
                // A press on a border neither opens cells nor sorts columns
                if (suppressClick.current) {
                    suppressClick.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                }
            },
            onDoubleClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
                const column = hitTest(event);
                if (column == null) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                const fieldName = schema.current.fields[layout.current.arrowFieldByColumnIndex[column]].name;
                setResizedColumnWidths(prev => {
                    if (!prev.has(fieldName)) {
                        return prev;
                    }
                    const next = new Map(prev);
                    next.delete(fieldName);
                    return next;
                });
            },
        };
    }, [gridApi, setResizedColumnWidths]);
}
