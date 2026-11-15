import * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

/// The row number of a matching row in the result of a Data search
export const DATA_SEARCH_ROW_FIELD = 'row_idx';

export interface SearchableResultColumn {
    /// Display-column index among original result columns, excluding the row-number column.
    columnIdx: number;
    /// Index into the column groups of the computation.
    columnGroupIdx: number;
    /// Arrow field name of the original result column.
    fieldName: string;
}

/// The columns that a search searches, like `collect_searchable_result_columns` of the runtime
export function collectSearchableResultColumns(columnGroups: core.ComputationColumnGroup[]): SearchableResultColumn[] {
    const columns: SearchableResultColumn[] = [];
    for (let columnGroupIdx = 0; columnGroupIdx < columnGroups.length; ++columnGroupIdx) {
        const columnGroup = columnGroups[columnGroupIdx];
        switch (columnGroup.type) {
            case 'ROWNUMBER':
            case 'SKIPPED':
                break;
            case 'ORDINAL':
            case 'STRING':
            case 'LIST':
                columns.push({
                    columnIdx: columns.length,
                    columnGroupIdx,
                    fieldName: columnGroup.value.inputFieldName,
                });
                break;
        }
    }
    return columns;
}

/// The matching columns by row number from 1 of the table of a data search
export function parseDataSearchMatches(table: arrow.Table): Map<number, number[]> {
    const rowColumn = table.getChild(DATA_SEARCH_ROW_FIELD) ?? table.getChildAt(0);
    const matchColumn = table.getChild('column_indices') ?? table.getChildAt(1);
    const matches = new Map<number, number[]>();
    if (rowColumn == null || matchColumn == null) {
        return matches;
    }
    for (let i = 0; i < rowColumn.length; ++i) {
        const rowIdx = Number(rowColumn.get(i));
        const rawMatches = matchColumn.get(i);
        const columnIndices = rawMatches == null
            ? []
            : Array.from(rawMatches as Iterable<unknown>, value => Number(value));
        matches.set(rowIdx, columnIndices);
    }
    return matches;
}
