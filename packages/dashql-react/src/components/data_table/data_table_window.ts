import * as arrow from 'apache-arrow';
import * as React from 'react';

import { ArrowTableFormatter } from '@akohn/dashql/platform/compute/arrow_formatter';
import type { ComputationView } from '@akohn/dashql';
import type { ComputationModel, ResultRowWindow } from '../../models/computation_model.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useLogger } from '../../logger.js';

// The rows that the grid shows are read in windows: the rows that it renders and some rows around them. The core
// decides which rows show and in which order, the grid only knows their count and the window it read
// (docs/wip/result_windows.md). There is one window, a new one replaces it.

/// The rows above and below the rendered rows that a window reads, so that a short scroll needs no read
export const WINDOW_MARGIN_ROWS = 100;

/// A window of the rows that show, formatted when a cell renders
export interface DataTableWindow {
    /// The position of the first row of the window among the rows that show, from 0
    offset: number;
    /// The rows of the window, the fields of the result and its row numbers
    table: arrow.Table;
    /// The formatted values of the rows of the window
    formatter: ArrowTableFormatter;
    /// The row of the result of each row of the window, from 0
    dataRows: Int32Array;
}

/// The window of a table and the rows that show
export interface DataTableRows {
    /// The window, null until the first read finished
    window: DataTableWindow | null;
    /// The rows that show
    rows: number;
    /// Why the read of the rendered rows failed, null while none failed
    error: string | null;
    /// Read the rendered rows again after a read failed
    retry: () => void;
}

/// Visit the values of an integer column as numbers, like `Number(column.get(i))` (nulls become 0).
/// Integer chunks are read from their value buffers directly. A chunk's values are already narrowed
/// to the chunk's window, so value `i` of the chunk is `values[i]`, exactly what `Vector.get` reads.
export function forEachIntegerValue(column: arrow.Vector, visit: (value: number, index: number) => void): void {
    if (column.type.typeId !== arrow.Type.Int) {
        for (let i = 0; i < column.length; ++i) {
            visit(Number(column.get(i)), i);
        }
        return;
    }
    let index = 0;
    for (const chunk of column.data) {
        const values = chunk.values as ArrayLike<number | bigint>;
        if (chunk.nullCount === 0) {
            for (let i = 0; i < chunk.length; ++i) {
                visit(Number(values[i]), index++);
            }
        } else {
            for (let i = 0; i < chunk.length; ++i) {
                visit(chunk.getValid(i) ? Number(values[i]) : 0, index++);
            }
        }
    }
}

/// The rows of a window by position, the row numbers of a result count from 1. A window has the fields of the result
/// and then its row numbers, the last field, whatever the result names its fields.
function dataRowsOf(table: arrow.Table): Int32Array {
    const out = new Int32Array(table.numRows);
    const column = table.numCols === 0 ? null : table.getChildAt(table.numCols - 1);
    if (column == null) return out;
    forEachIntegerValue(column, (rowNumber, index) => {
        out[index] = rowNumber - 1;
    });
    return out;
}

/// The rows that show according to the view, until a read counted them
function rowsOfView(view: ComputationView): number {
    return view.orderingTable?.rows ?? view.filterTable?.rows ?? view.dataSearchTable?.rows ?? view.dataTableRows;
}

/// The table that a window was read from: a window of another table has other columns
function tableKey(view: ComputationView): string {
    return `${view.tableId}:${view.dataTable}`;
}

/// What changes the rows that show: the table, its data frame, the filter, the ordering and the data search
function selectionKey(view: ComputationView): string {
    return [tableKey(view), view.dataFrame, view.filterTable?.dataTable, view.orderingTable?.dataTable, view.dataSearchTable?.dataTable].join(':');
}

/// Does a window hold the rendered rows?
function holds(offset: number, length: number, rows: number, start: number, stop: number): boolean {
    return start >= offset && (stop < offset + length || offset + length >= rows);
}

/// A read that failed: the rows it read and why
interface FailedRead {
    key: string;
    offset: number;
    limit: number;
    error: string;
}

/// The window of the rows that the grid renders, from `start` to `stop`. A read starts when the rendered rows leave the
/// window or the rows that show change, a read that a newer one replaced is dropped. The previous window stays until the
/// next one arrived, unless it is a window of another table. The core reads again when a read failed since its
/// computation changed meanwhile; a read that fails all the same is an error that the grid shows, and the same rows
/// are read again once the rows that show change, the rendered rows leave the failed read, or `retry`.
export function useDataTableWindow(model: ComputationModel, start: number, stop: number): DataTableRows {
    const logger = useLogger();
    const view = model.computation;
    const key = selectionKey(view);
    const table = tableKey(view);
    const [state, setState] = React.useState<{ key: string; table: string; rows: number; window: DataTableWindow } | null>(null);
    const [failed, setFailed] = React.useState<FailedRead | null>(null);
    // The latest read of the model, its identity changes with every change of the computation
    const readRows = React.useRef(model.readRows);
    readRows.current = model.readRows;
    // The read that runs: its key and rows, a newer one replaces it
    const pending = React.useRef<{ key: string; offset: number; limit: number } | null>(null);

    React.useEffect(() => {
        const current = state?.key === key ? state : null;
        if (current != null && holds(current.window.offset, current.window.table.numRows, current.rows, start, stop)) {
            return;
        }
        const running = pending.current;
        if (running != null && running.key === key && holds(running.offset, running.limit, Number.POSITIVE_INFINITY, start, stop)) {
            return;
        }
        // A read of these rows failed, the grid shows why until something changes
        if (failed != null && failed.key === key && holds(failed.offset, failed.limit, Number.POSITIVE_INFINITY, start, stop)) {
            return;
        }
        const offset = Math.max(0, start - WINDOW_MARGIN_ROWS);
        const limit = Math.max(0, stop - start + 1) + 2 * WINDOW_MARGIN_ROWS;
        const read = { key, offset, limit };
        pending.current = read;
        readRows.current(offset, limit).then(
            (result: ResultRowWindow) => {
                if (pending.current !== read) return;
                pending.current = null;
                const formatter = new ArrowTableFormatter(result.table.schema, result.table.batches, logger);
                const window = { offset: result.offset, table: result.table, formatter, dataRows: dataRowsOf(result.table) };
                setFailed(null);
                setState({ key, table, rows: result.rows, window });
            },
            (error: unknown) => {
                if (pending.current !== read) return;
                pending.current = null;
                const message = stringifyError(error);
                logger.warn('Failed to read the rows of a table', { error: message }, 'data_table');
                setFailed({ key, offset, limit, error: message });
            },
        );
    }, [key, table, start, stop, state, failed, logger]);

    const retry = React.useCallback(() => setFailed(null), []);
    const shown = state?.table === table ? state : null;
    // The error of a read of the rows that show now, the rendered rows that a window holds show
    const error = failed != null && failed.key === key && (shown == null || shown.key !== key || !holds(shown.window.offset, shown.window.table.numRows, shown.rows, start, stop))
        ? failed.error
        : null;
    return { window: shown?.window ?? null, rows: shown?.rows ?? rowsOfView(view), error, retry };
}
