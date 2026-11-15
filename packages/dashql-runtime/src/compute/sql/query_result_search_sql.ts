import * as arrow from 'apache-arrow';

import { quoteLiteral } from '../../utils/sql_quote.js';
import { ColumnGroup, LIST_COLUMN, ORDINAL_COLUMN, ROWNUMBER_COLUMN, SKIPPED_COLUMN, STRING_COLUMN } from '../computation_types.js';

/// The row number of a matching row in the result of a Data search
export const DATA_SEARCH_ROW_FIELD = 'row_idx';

export interface SearchableResultColumn {
    /// Display-column index among original result columns, excluding the row-number column.
    columnIdx: number;
    /// Index into `TableComputationState.columnGroups`.
    columnGroupIdx: number;
    /// Arrow field name of the original result column.
    fieldName: string;
}

export function collectSearchableResultColumns(columnGroups: ColumnGroup[]): SearchableResultColumn[] {
    const columns: SearchableResultColumn[] = [];
    for (let columnGroupIdx = 0; columnGroupIdx < columnGroups.length; ++columnGroupIdx) {
        const columnGroup = columnGroups[columnGroupIdx];
        switch (columnGroup.type) {
            case ROWNUMBER_COLUMN:
            case SKIPPED_COLUMN:
                break;
            case ORDINAL_COLUMN:
            case STRING_COLUMN:
            case LIST_COLUMN:
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

export function buildColumnSearchSQL(columns: SearchableResultColumn[], pattern: string): string | null {
    if (columns.length === 0) {
        return null;
    }
    const values = columns.map(column =>
        `(${column.columnIdx}, ${column.columnGroupIdx}, ${quoteLiteral(column.fieldName)})`
    );
    return (
        `SELECT column_idx, column_group_idx\n` +
        `FROM (\n` +
        `    VALUES\n` +
        `        ${values.join(',\n        ')}\n` +
        `) AS columns(column_idx, column_group_idx, name)\n` +
        `WHERE name ILIKE ${quoteLiteral(`%${pattern}%`)}\n` +
        `ORDER BY column_idx`
    );
}

export function parseColumnSearchMatches(table: arrow.Table): number[] {
    const groupColumn = table.getChild('column_group_idx') ?? table.getChildAt(1);
    if (groupColumn == null) {
        return [];
    }
    const matches: number[] = [];
    for (let i = 0; i < groupColumn.length; ++i) {
        matches.push(Number(groupColumn.get(i)));
    }
    return matches;
}

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
