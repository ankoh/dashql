import * as proto from '../proto';

/// A value
export class Value {
    /// The type
    _sqlType: proto.sql_type.SQLType;
    /// The value
    _valueVariant: NumberValue | StringValue | LongValue | I128Value | IntervalValue;
    /// The null flag
    _nullFlag: boolean;

    /// Constructor
    public constructor() {
        this._sqlType = new proto.sql_type.SQLType();
        this._nullFlag = true;
        this._valueVariant = {
            type: PhysicalType.NUMBER,
            value: 0
        };
    }

    protected asNumber() {
        if (this._valueVariant.type != PhysicalType.NUMBER)
            this._valueVariant = { type: PhysicalType.NUMBER, value: 0.0 };
        return this._valueVariant;
    }

    protected asString() {
        if (this._valueVariant.type != PhysicalType.STRING)
            this._valueVariant = { type: PhysicalType.STRING, value: "" };
        return this._valueVariant;
    }

    protected asLong() {
        if (this._valueVariant.type != PhysicalType.LONG)
            this._valueVariant = { type: PhysicalType.LONG, value: flatbuffers.Long.ZERO };
        return this._valueVariant;
    }

    protected asI128() {
        if (this._valueVariant.type != PhysicalType.I128)
            this._valueVariant = { type: PhysicalType.I128, value: new proto.vector.I128() };
        return this._valueVariant;
    }

    protected asInterval() {
        if (this._valueVariant.type != PhysicalType.INTERVAL)
            this._valueVariant = { type: PhysicalType.INTERVAL, value: new proto.vector.Interval() };
        return this._valueVariant;
    }

    public get sqlType() { return this._sqlType; }
    public get i32() { return this.asNumber().value; }
    public get u32() { return this.asNumber().value; }
    public get f64() { return this.asNumber().value; }
    public get i64() { return this.asLong().value; }
    public get u64() { return this.asLong().value; }
    public get i128() { return this.asI128().value; }
    public get str() { return this.asString().value; }
    public get interval() { return this.asInterval().value; }
    public get nullFlag() { return this._nullFlag; }

    public set sqlType(v: proto.sql_type.SQLType) { this._sqlType = v; }
    public set i32(v: number) { this.asNumber().value = v; }
    public set u32(v: number) { this.asNumber().value = v; }
    public set f64(v: number) { this.asNumber().value = v; }
    public set i64(v: flatbuffers.Long) { this.asLong().value = v; }
    public set u64(v: flatbuffers.Long) { this.asLong().value = v; }
    public set str(v: string) { this.asString().value = v; }
    public set nullFlag(v: boolean) { this._nullFlag = v; }
}

enum PhysicalType {
    NULL,
    NUMBER,
    STRING,
    LONG,
    I128,
    INTERVAL,
}

interface NumberValue {
    type: PhysicalType.NUMBER;
    value: number;
}

interface StringValue {
    type: PhysicalType.STRING;
    value: string;
}

interface LongValue {
    type: PhysicalType.LONG;
    value: flatbuffers.Long;
}

interface I128Value {
    type: PhysicalType.I128;
    value: proto.vector.I128;
}

interface IntervalValue {
    type: PhysicalType.INTERVAL;
    value: proto.vector.Interval;
}
