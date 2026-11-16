import type * as arrow from 'apache-arrow';
import * as React from 'react';

import { resolveMatchingRows, type SummaryTables, type TableComputationState } from '@ankoh/dashql/platform/compute/computation_types';
import { useOptionalRuntime } from '../../runtime/runtime_hooks.js';

/// The Arrow tables of the view of a computation, resolved by their handles
export interface ComputationTables {
    /// The table with the system columns once they are computed
    dataTable: arrow.Table | null;
    /// The row numbers of the rows that pass the cross filters
    filterTable: arrow.Table | null;
    /// The row numbers in the order of the grid
    orderingTable: arrow.Table | null;
    /// The row numbers that the data search matched
    dataSearchTable: arrow.Table | null;
    /// The matching columns of the rows of the applied data search by row number from 1
    matchingRows: Map<number, number[]> | null;
}

/// The tables of a view
export function resolveComputationTables(view: TableComputationState | null, tables: SummaryTables | null): ComputationTables {
    const table = (handle: number | null | undefined) => tables?.table(handle) ?? null;
    return {
        dataTable: table(view?.dataTable),
        filterTable: table(view?.filterTable?.dataTable),
        orderingTable: table(view?.orderingTable?.dataTable),
        dataSearchTable: table(view?.dataSearchTable?.dataTable),
        matchingRows: tables == null ? null : resolveMatchingRows(view, tables),
    };
}

/// The tables of a view, the same object while the tables are the same
export function useComputationTables(view: TableComputationState | null): ComputationTables {
    const runtime = useOptionalRuntime();
    return React.useMemo(
        () => resolveComputationTables(view, runtime),
        [runtime, view?.dataTable, view?.filterTable, view?.orderingTable, view?.dataSearchTable, view?.dataSearch.hasMatchingRows],
    );
}
