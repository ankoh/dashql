import * as arrow from 'apache-arrow';

export type ScalarValue = BooleanValue | Int64Value | Float64Value | Utf8Value | StructValue | ListValue;

export interface BooleanValue {
    t: 'boolean';
    v: boolean;
}

export interface Int64Value {
    t: 'int64';
    v: number;
}

export interface Float64Value {
    t: 'float64';
    v: number;
}

export interface Utf8Value {
    t: 'utf8';
    v: string;
}

export interface StructValue {
    t: 'struct';
    v: {
        [key: string]: ScalarValue;
    };
}

export interface ListValue {
    t: 'list';
    v: [ScalarValue];
}

export function formatScalarValue(value?: ScalarValue | null): string {
    if (value === undefined || value == null) {
        return 'null';
    }
    switch (value.t) {
        case 'boolean':
            return value.v.toString();
        case 'int64':
            return value.v.toString();
        case 'float64':
            return value.v.toString();
        case 'utf8':
            return value.v.toString();
        default:
            return 'null';
    }
}

export function parseScalarValue(v: string | null, t: arrow.DataType): ScalarValue | null {
    switch (t.typeId) {
        case arrow.Type.Bool:
            return {
                t: 'boolean',
                v: v == 'true' || v == '1',
            };
        case arrow.Type.Int8:
        case arrow.Type.Int32:
        case arrow.Type.Int64:
        case arrow.Type.Uint8:
        case arrow.Type.Uint16:
        case arrow.Type.Uint32:
        case arrow.Type.Uint64:
            return {
                t: 'int64',
                v: parseInt(v),
            };
        case arrow.Type.Float32:
        case arrow.Type.Float64:
            return {
                t: 'float64',
                v: parseFloat(v),
            };
        default:
            return {
                t: 'utf8',
                v: v,
            };
    }
}
