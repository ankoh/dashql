import * as React from 'react';

import type { QueryExecutionState } from '@ankoh/dashql/platform/query/query_execution_state';
import type { TableComputationState } from '@ankoh/dashql/platform/compute/computation_types';
import { useComputation, useComputationDispatch } from '../../runtime/runtime_hooks.js';
import { QueryResultSearchControls } from './query_result_search_controls.js';
import { useQueryResultSearch } from './use_query_result_search.js';
import { forEachIntegerValue } from './visible_rows.js';
import { useComputationTables, type ComputationTables } from './computation_tables.js';
import type { ComputationDispatch } from './use_cross_filters.js';

interface Props {
    query: QueryExecutionState;
    children?: React.ReactNode;
}

export function QueryResultToolbar(props: Props): React.ReactNode {
    const table = useComputation(props.query.queryId);
    const dispatch = useComputationDispatch(props.query.queryId);
    return <TableSearchToolbar table={table} dispatch={dispatch}>{props.children}</TableSearchToolbar>;
}

interface TableSearchToolbarProps {
    table: TableComputationState | null;
    dispatch: ComputationDispatch;
    children?: React.ReactNode;
}

/// The column and data search of any analyzed table, not only of query results
export function TableSearchToolbar(props: TableSearchToolbarProps) {
    const { table, dispatch } = props;
    const search = useQueryResultSearch(table, dispatch);
    const tables = useComputationTables(table);
    if (search.columnSearch == null || search.dataSearch == null) return props.children;
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

export function useQueryResultRowCounts(query: QueryExecutionState | null) {
    const table = useComputation(query?.queryId);
    const tables = useComputationTables(table);
    const totalRows = table?.dataTableRows ?? null;
    const matchingRows = getMatchingRowCount(tables);
    const currentRows = matchingRows ?? table?.filterTable?.rows ?? totalRows;
    return { totalRows, currentRows, matchingRows };
}

/// Matching row counts per filter table and data search matches.
/// Weakly keyed by both, so a count never outlives the tables it was computed from.
const matchingRowCounts = new WeakMap<object, WeakMap<object, number>>();

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
