import * as React from 'react';

import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import type { ComputationModel } from '../../models/computation_model.js';
import type { QueryModel } from '../../models/query_model.js';
import { QueryResultSearchControls } from './query_result_search_controls.js';
import { useQueryResultSearch } from './use_query_result_search.js';
import { forEachIntegerValue, useComputationTables, type ComputationDispatch, type ComputationTables } from '../data_table/data_table.js';

/// The dispatch of no computation, the search shows nothing then
const NO_DISPATCH: ComputationDispatch = () => ({ ok: false, changed: false, error: 'no computation', id: null });

interface TableSearchToolbarProps {
    /// The computation of the table, none before the table is analyzed
    computation: ComputationModel | null;
    children?: React.ReactNode;
}

/// The column and data search of any analyzed table, not only of query results
export function TableSearchToolbar(props: TableSearchToolbarProps) {
    const computation = props.computation;
    const search = useQueryResultSearch(computation?.computation ?? null, computation?.dispatch ?? NO_DISPATCH);
    const tables = useComputationTables(computation?.computation ?? null, computation?.tables ?? null);
    if (computation == null || search.columnSearch == null || search.dataSearch == null) return props.children;
    const dataMatchCount = getMatchingRowCount(tables);
    return (
        <>
            <QueryResultSearchControls
                columnSearch={search.columnSearch}
                dataSearch={search.dataSearch}
                onColumnPatternChange={search.setColumnPattern}
                onDataPatternChange={search.setDataPattern}
                columnMatchCount={search.columnSearch.matchingColumnGroups?.length ?? null}
                dataMatchCount={dataMatchCount}
            />
            {props.children}
        </>
    );
}

/// The rows of a result table: all of them, those that pass the cross filters, those that the data search matched
export interface ResultRowCounts {
    totalRows: number | null;
    currentRows: number | null;
    matchingRows: number | null;
}

/// The rows of the table of a computation, null counts without one
export function useResultRowCounts(computation: ComputationModel | null): ResultRowCounts {
    const table = computation?.computation ?? null;
    const tables = useComputationTables(table, computation?.tables ?? null);
    const totalRows = table?.dataTableRows ?? null;
    const matchingRows = getMatchingRowCount(tables);
    const currentRows = matchingRows ?? table?.filterTable?.rows ?? totalRows;
    return { totalRows, currentRows, matchingRows };
}

/// Did the query produce a result that is analyzed, and how many rows has it? The tabs of a result and the headers of
/// a chart and of the details count the same rows.
export function resultRowCount(model: QueryModel | null): { hasResult: boolean; totalRows: number | null } {
    const computation = model?.computation?.computation ?? null;
    if (model == null || computation == null || model.query.status !== QueryExecutionStatus.SUCCEEDED) return { hasResult: false, totalRows: null };
    return { hasResult: true, totalRows: computation.dataTableRows ?? null };
}

/// Matching row counts per filter table and data search matches.
/// Weakly keyed by both, so a count never outlives the tables it was computed from.
const matchingRowCounts = new WeakMap<object, WeakMap<object, number>>();

/// The rows that the data search matched among those that pass the cross filters, null without a data search
export function getMatchingRowCount(tables: ComputationTables): number | null {
    const dataMatches = tables.matchingRows;
    if (dataMatches == null) return null;
    if (tables.filterTable == null) return dataMatches.size;
    const filterDataTable = tables.filterTable;
    let countsByMatches = matchingRowCounts.get(filterDataTable);
    const cached = countsByMatches?.get(dataMatches);
    if (cached !== undefined) return cached;
    const rowIds = filterDataTable.getChildAt(0);
    if (rowIds == null) return 0;
    let count = 0;
    forEachIntegerValue(rowIds, rowId => {
        if (dataMatches.has(rowId)) ++count;
    });
    if (countsByMatches == null) {
        countsByMatches = new WeakMap();
        matchingRowCounts.set(filterDataTable, countsByMatches);
    }
    countsByMatches.set(dataMatches, count);
    return count;
}
