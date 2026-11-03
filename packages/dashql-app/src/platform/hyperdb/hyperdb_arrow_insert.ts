import * as arrow from 'apache-arrow';

import { binaryVector, boolVector, floatVector, intVector, utf8Vector } from '../../utils/arrow_vectors.js';

/// An Arrow table that Hyper can read with external(format => 'arrowstream').
export interface HyperArrowInsert {
    /// The table with the columns converted to types that Hyper reads
    table: arrow.Table;
    /// The column descriptor of the external scan, Hyper cannot infer it from the Arrow schema
    columns: string;
}

function quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

/// The Hyper type that the metadata of a field names, e.g. of a json or varchar(n) column exported by Hyper.
/// Hyper insists on this type when it reads the field back.
function annotatedHyperType(field: arrow.Field): string | null {
    const length = field.metadata.get('hyper:max_string_length');
    switch (field.metadata.get('hyper:type')) {
        case 'JSON':
            return 'json';
        case 'Oid':
            return 'oid';
        case 'Geography':
            return 'geography';
        case 'Char':
            return length == null ? null : `char(${length})`;
    }
    return length == null ? null : `varchar(${length})`;
}

/// The Hyper type of an Arrow field that Hyper reads, null when the column needs converting first.
/// Hyper insists on the type that corresponds to the Arrow type, a wider type is rejected.
function readableHyperType(field: arrow.Field): string | null {
    const type = field.type as arrow.DataType;
    const annotated = annotatedHyperType(field);
    if (annotated != null) return annotated;
    switch (type.typeId) {
        case arrow.Type.Int: {
            const int = type as arrow.Int;
            switch (int.bitWidth) {
                case 8:
                case 16:
                    return int.isSigned || int.bitWidth === 8 ? 'smallint' : 'integer';
                case 32:
                    return int.isSigned ? 'integer' : 'bigint';
                case 64:
                    return int.isSigned ? 'bigint' : 'numeric(20,0)';
            }
            return null;
        }
        case arrow.Type.Float:
            switch ((type as arrow.Float).precision) {
                case arrow.Precision.SINGLE:
                    return 'real';
                case arrow.Precision.DOUBLE:
                    return 'double precision';
            }
            return null;
        case arrow.Type.Utf8:
            return 'text';
        case arrow.Type.Binary:
            return 'bytea';
        case arrow.Type.Bool:
            return 'boolean';
        case arrow.Type.Decimal: {
            const decimal = type as arrow.Decimal;
            return decimal.bitWidth === 128 ? `numeric(${decimal.precision},${decimal.scale})` : null;
        }
        case arrow.Type.Date:
            return 'date';
        case arrow.Type.Time:
            return 'time';
        case arrow.Type.Timestamp: {
            const timestamp = type as arrow.Timestamp;
            if (timestamp.unit === arrow.TimeUnit.NANOSECOND) return null;
            return timestamp.timezone == null ? 'timestamp' : 'timestamptz';
        }
        case arrow.Type.Interval:
            return 'interval';
        case arrow.Type.List: {
            // The element nullability is part of the array type, e.g. array_agg yields non-null elements.
            const child = (type as arrow.List).children[0];
            const element = readableHyperType(child);
            if (element == null) return null;
            return child.nullable ? `array(${element})` : `array(${element} not null)`;
        }
        default:
            return null;
    }
}

/// A vector of values of an Arrow type in a type that Hyper reads, one chunk.
/// The vector is assembled from its buffers, the Arrow builders evaluate code (see arrow_vectors.ts).
function readableVector(type: arrow.DataType, values: unknown[]): arrow.Vector {
    switch (type.typeId) {
        case arrow.Type.Utf8:
        case arrow.Type.LargeUtf8:
            return utf8Vector(values as Array<string | null>);
        case arrow.Type.Binary:
        case arrow.Type.LargeBinary:
        case arrow.Type.FixedSizeBinary:
            return binaryVector(values as Array<Uint8Array | null>);
        case arrow.Type.Float:
            return (type as arrow.Float).precision === arrow.Precision.DOUBLE
                ? floatVector(new arrow.Float64(), values as Array<number | null>)
                : floatVector(new arrow.Float32(), values as Array<number | null>);
        case arrow.Type.Int:
            return intVector(type as arrow.Int, values as Array<number | bigint | null>);
        case arrow.Type.Bool:
            return boolVector(values as Array<boolean | null>);
        case arrow.Type.Null:
            return utf8Vector(values.map(() => null));
        default:
            throw new Error(`Hyper cannot import Arrow columns of type ${String(type)}`);
    }
}

/// Convert a column that Hyper cannot read to a type that it reads.
function convertColumn(vector: arrow.Vector): arrow.Vector {
    const type = vector.type as arrow.DataType;
    switch (type.typeId) {
        case arrow.Type.Dictionary:
            return readableVector((type as arrow.Dictionary).dictionary, [...vector]);
        case arrow.Type.LargeUtf8:
        case arrow.Type.LargeBinary:
        case arrow.Type.FixedSizeBinary:
        case arrow.Type.Float:
        case arrow.Type.Null:
            return readableVector(type, [...vector]);
        case arrow.Type.Timestamp: {
            // Hyper keeps microseconds, nanoseconds are truncated.
            const timezone = (type as arrow.Timestamp).timezone;
            return new arrow.Vector(vector.data.map(data => arrow.makeData({
                type: new arrow.TimestampMicrosecond(timezone),
                length: data.length,
                nullCount: data.nullCount,
                nullBitmap: data.nullBitmap,
                data: (data.values as BigInt64Array).map(value => value / 1000n),
            })));
        }
        default:
            throw new Error(`Hyper cannot import Arrow columns of type ${String(type)}`);
    }
}

/// Prepare an Arrow table for an external Arrow stream scan in Hyper.
export function prepareHyperArrowInsert(table: arrow.Table): HyperArrowInsert {
    const columns: Record<string, arrow.Vector> = {};
    let converted = false;
    table.schema.fields.forEach((field, index) => {
        let column = table.getChildAt(index)!;
        if (readableHyperType(field) == null) {
            column = convertColumn(column);
            converted = true;
        }
        columns[field.name] = column;
    });
    // Converted columns are single chunks, the table redistributes the other columns into matching batches.
    // The rebuilt table drops the field metadata, so the descriptor follows the fields of the scanned table.
    const scanned = converted ? new arrow.Table(columns) : table;
    const descriptor = scanned.schema.fields.map(field => {
        const type = readableHyperType(field);
        if (type == null) {
            throw new Error(`Hyper cannot import Arrow columns of type ${String(field.type)}`);
        }
        return `${quoteIdentifier(field.name)} ${type}`;
    });
    return { table: scanned, columns: descriptor.join(', ') };
}
