import * as arrow from 'apache-arrow';

/// The first rows of a result that a chart draws, a result with more is capped and the chart says so
export const CHART_ROWS = 10_000;

/// The number of a value of a decimal column: Arrow gives the unscaled 128-bit integer, e.g. 1969200000 for 1969.2 of
/// a Decimal(28,6), the chart draws the scaled number
function decimalToNumber(value: unknown, scale: number): unknown {
    if (!(value instanceof Uint32Array)) return value;
    return arrow.util.bigNumToNumber(value as unknown as Parameters<typeof arrow.util.bigNumToNumber>[0], scale);
}

/// Convert an arrow row object to a vega-compatible plain object.
function arrowRowToObject(row: arrow.StructRowProxy, fields: readonly arrow.Field[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const field of fields) {
        const value = row[field.name];
        if (arrow.DataType.isDecimal(field.type)) {
            obj[field.name] = decimalToNumber(value, field.type.scale);
        } else if (typeof value === 'bigint') {
            // Convert BigInts to numbers for vega compatibility
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
