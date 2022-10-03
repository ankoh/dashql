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
