import type * as arrow from 'apache-arrow';
import * as React from 'react';

import type { ComputationView } from '@akohn/dashql';
import { resolveDataSearchMatches, type SummaryTables } from '@akohn/dashql/platform/compute/computation_types';

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

/// The handles of the tables of a view
interface ComputationTableHandles {
    dataTable: number | null | undefined;
    filterTable: number | null | undefined;
    orderingTable: number | null | undefined;
    dataSearchTable: number | null | undefined;
    hasMatchingRows: boolean;
}

function resolveTables(handles: ComputationTableHandles, tables: SummaryTables | null): ComputationTables {
    const table = (handle: number | null | undefined) => tables?.table(handle) ?? null;
    return {
        dataTable: table(handles.dataTable),
        filterTable: table(handles.filterTable),
        orderingTable: table(handles.orderingTable),
        dataSearchTable: table(handles.dataSearchTable),
        matchingRows: tables == null ? null : resolveDataSearchMatches(handles.hasMatchingRows, handles.dataSearchTable, tables),
    };
}

function tableHandles(view: ComputationView | null): ComputationTableHandles {
    return {
        dataTable: view?.dataTable,
        filterTable: view?.filterTable?.dataTable,
        orderingTable: view?.orderingTable?.dataTable,
        dataSearchTable: view?.dataSearchTable?.dataTable,
        hasMatchingRows: view?.dataSearch.hasMatchingRows ?? false,
    };
}

/// The tables of a view
export function resolveComputationTables(view: ComputationView | null, tables: SummaryTables | null): ComputationTables {
    return resolveTables(tableHandles(view), tables);
}

/// The tables of a view, the same object while its handles and the tables are the same
export function useComputationTables(view: ComputationView | null, tables: SummaryTables | null): ComputationTables {
    const { dataTable, filterTable, orderingTable, dataSearchTable, hasMatchingRows } = tableHandles(view);
    return React.useMemo(
        () => resolveTables({ dataTable, filterTable, orderingTable, dataSearchTable, hasMatchingRows }, tables),
        [tables, dataTable, filterTable, orderingTable, dataSearchTable, hasMatchingRows],
    );
}
