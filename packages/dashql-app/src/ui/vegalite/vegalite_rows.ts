import type * as arrow from 'apache-arrow';

/// Convert an arrow row object to a vega-compatible plain object.
function arrowRowToObject(row: any, fields: readonly arrow.Field[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const field of fields) {
        const value = row[field.name];
        // Convert BigInts to numbers for vega compatibility
        if (typeof value === 'bigint') {
            obj[field.name] = Number(value);
        } else if (value instanceof Date) {
            obj[field.name] = value.toISOString();
        } else {
            obj[field.name] = value;
        }
    }
    return obj;
}

/// The rows of an Arrow table as plain objects for the datasets of Vega
export function arrowTableToRows(table: arrow.Table): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (const row of table) {
        rows.push(arrowRowToObject(row, table.schema.fields));
    }
    return rows;
}
