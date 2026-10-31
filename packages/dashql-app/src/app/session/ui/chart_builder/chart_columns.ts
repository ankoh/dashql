import * as arrow from 'apache-arrow';

import type { FieldType } from './chart_spec_paths.js';

/// A column of the query result that the builder can encode
export interface ChartColumn {
    name: string;
    /// The Vega-Lite type that the builder picks when the column is encoded
    type: FieldType;
    /// The spec encodes the column but the result has no such column
    missing?: boolean;
}

/// The Vega-Lite type of an Arrow type: numbers are quantitative, dates and times temporal, the rest nominal
export function vegaLiteTypeOf(type: arrow.DataType): FieldType {
    switch (type.typeId) {
        case arrow.Type.Int:
        case arrow.Type.Int8:
        case arrow.Type.Int16:
        case arrow.Type.Int32:
        case arrow.Type.Int64:
        case arrow.Type.Uint8:
        case arrow.Type.Uint16:
        case arrow.Type.Uint32:
        case arrow.Type.Uint64:
        case arrow.Type.Float:
        case arrow.Type.Float16:
        case arrow.Type.Float32:
        case arrow.Type.Float64:
        case arrow.Type.Decimal:
            return 'quantitative';
        case arrow.Type.Date:
        case arrow.Type.DateDay:
        case arrow.Type.DateMillisecond:
        case arrow.Type.Timestamp:
        case arrow.Type.TimestampSecond:
        case arrow.Type.TimestampMillisecond:
        case arrow.Type.TimestampMicrosecond:
        case arrow.Type.TimestampNanosecond:
        case arrow.Type.Time:
        case arrow.Type.TimeSecond:
        case arrow.Type.TimeMillisecond:
        case arrow.Type.TimeMicrosecond:
        case arrow.Type.TimeNanosecond:
            return 'temporal';
        default:
            return 'nominal';
    }
}

/// The columns of the result, followed by the fields that the spec encodes but the result lacks.
/// Columns of the system, e.g. the row numbers of the cross filter, are not in the result schema.
export function chartColumns(schema: arrow.Schema | null, encodedFields: readonly string[]): ChartColumn[] {
    const columns: ChartColumn[] = (schema?.fields ?? []).map(field => ({ name: field.name, type: vegaLiteTypeOf(field.type) }));
    // Without a result, nothing is known to be missing
    if (schema == null) return encodedFields.map(name => ({ name, type: 'nominal' }));
    const names = new Set(columns.map(column => column.name));
    for (const name of encodedFields) {
        if (!names.has(name)) columns.push({ name, type: 'nominal', missing: true });
    }
    return columns;
}
