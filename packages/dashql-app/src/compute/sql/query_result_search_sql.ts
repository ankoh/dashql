import * as arrow from 'apache-arrow';

import { quoteIdent, quoteStringLiteral } from './sqlframe_builder.js';
import { ColumnGroup, LIST_COLUMN, ORDINAL_COLUMN, ROWNUMBER_COLUMN, SKIPPED_COLUMN, STRING_COLUMN } from '../computation_types.js';

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
        `(${column.columnIdx}, ${column.columnGroupIdx}, ${quoteStringLiteral(column.fieldName)})`
    );
    return (
        `SELECT column_idx, column_group_idx\n` +
        `FROM (\n` +
        `    VALUES\n` +
        `        ${values.join(',\n        ')}\n` +
        `) AS columns(column_idx, column_group_idx, name)\n` +
        `WHERE name ILIKE ${quoteStringLiteral(`%${pattern}%`)}\n` +
        `ORDER BY column_idx`
    );
}

export function buildDataSearchSQL(
    tableName: string,
    rowNumberFieldName: string,
    columns: SearchableResultColumn[],
    pattern: string,
): string {
    if (columns.length === 0) {
        const quotedRowNumber = quoteIdent(rowNumberFieldName);
        return (
            `SELECT\n` +
            `    ${quotedRowNumber} AS row_idx,\n` +
            `    array_agg(0 ORDER BY 0) AS column_indices\n` +
            `FROM ${quoteIdent(tableName)}\n` +
            `WHERE FALSE\n` +
            `GROUP BY ${quotedRowNumber}\n` +
            `ORDER BY row_idx`
        );
    }
    const quotedPattern = quoteStringLiteral(`%${pattern}%`);
    const quotedRowNumber = quoteIdent(rowNumberFieldName);
    const quotedTable = quoteIdent(tableName);
    const unions = columns.map(column => (
        `    SELECT ${quotedRowNumber} AS row_idx, ${column.columnIdx} AS column_idx\n` +
        `    FROM ${quotedTable}\n` +
        `    WHERE CAST(${quoteIdent(column.fieldName)} AS TEXT) ILIKE ${quotedPattern}`
    ));
    return (
        `WITH search AS (\n` +
        `${unions.join('\n    UNION ALL\n')}\n` +
        `)\n` +
        `SELECT\n` +
        `    row_idx,\n` +
        `    array_agg(column_idx ORDER BY column_idx) AS column_indices\n` +
        `FROM search\n` +
        `GROUP BY row_idx\n` +
        `ORDER BY row_idx`
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
    const rowColumn = table.getChild('row_idx') ?? table.getChildAt(0);
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
