import * as arrow from 'apache-arrow';

import { TableComputationState } from '../../compute/computation_state.js';

/// Resolve the active row-id indirection for a table computation.
///
/// When a cross-filter and/or ordering is active, the compute module produces a
/// single-column table of row numbers (1-based, from `row_number()`) identifying the
/// visible rows in display order. Ordering supersedes filtering when both are present
/// (the ordering task already runs over the filtered subset). Returns `null` when the
/// full, unfiltered table should be shown.
///
/// The returned array holds 0-based positional indices into the analyzed data table,
/// ready to gather columns/rows for a renderer.
export function resolveVisibleRowIndices(computation: TableComputationState | null): Int32Array | null {
    if (computation == null) {
        return null;
    }
    const indirection = computation.orderingTable?.dataTable ?? computation.filterTable?.dataTable ?? null;
    if (indirection == null) {
        return null;
    }
    if (indirection.numCols !== 1) {
        return null;
    }
    const column = indirection.getChildAt(0) as arrow.Vector<arrow.Int> | null;
    if (column == null || column.type.typeId !== arrow.Type.Int) {
        return null;
    }
    const out = new Int32Array(column.length);
    for (let i = 0; i < column.length; ++i) {
        // Row numbers are 1-based; convert to a 0-based positional index.
        out[i] = Math.max(Number(column.get(i)), 1) - 1;
    }
    return out;
}
