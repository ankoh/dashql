import * as arrow from 'apache-arrow';

/// The row number of a matching row in the result of a Data search
export const DATA_SEARCH_ROW_FIELD = 'row_idx';

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
