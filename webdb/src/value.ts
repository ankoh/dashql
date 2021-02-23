// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { flatbuffers } from 'flatbuffers';

/// A sql type
export interface SQLType {
    /// A type id
    typeId: proto.SQLTypeID;
    /// The width
    width: number;
    /// The scale
    scale: number;
}

export function getSQLType(t: proto.SQLType | null) {
    if (t == null) {
        return {
            typeId: proto.SQLTypeID.INVALID,
            width: 0,
            scale: 0,
        };
    }
    return {
        typeId: t.typeId(),
        width: t.width(),
        scale: t.scale(),
    };
}

type PhysicalValue = NumberValue | StringValue | LongValue | I128Value | IntervalValue;

/// A value
export class Value {
    /// The type
    _logicalType: SQLType;
    /// The value
    _physicalValue: PhysicalValue;
    /// The null flag
    _nullFlag: boolean;

    /// Constructor
    public constructor(
        type: SQLType = {
            typeId: proto.SQLTypeID.INVALID,
            width: 0,
            scale: 0,
        },
    ) {
        this._logicalType = type;
        this._nullFlag = true;
        this._physicalValue = {
            type: PhysicalType.NUMBER,
            value: 0,
        };
    }

    /// As number value
    public asNumber() {
        if (this._physicalValue.type != PhysicalType.NUMBER)
            this._physicalValue = { type: PhysicalType.NUMBER, value: 0.0 };
        return this._physicalValue;
    }

    /// As string value
    public asString() {
        if (this._physicalValue.type != PhysicalType.STRING)
            this._physicalValue = { type: PhysicalType.STRING, value: '' };
        return this._physicalValue;
    }

    /// As long value
    public asLong() {
        if (this._physicalValue.type != PhysicalType.LONG)
            this._physicalValue = { type: PhysicalType.LONG, value: flatbuffers.Long.ZERO };
        return this._physicalValue;
    }

    /// As i128 value
    public asI128() {
        if (this._physicalValue.type != PhysicalType.I128)
            this._physicalValue = { type: PhysicalType.I128, value: new proto.I128() };
        return this._physicalValue;
    }

    /// As interval value
    public asInterval() {
        if (this._physicalValue.type != PhysicalType.INTERVAL)
            this._physicalValue = { type: PhysicalType.INTERVAL, value: new proto.Interval() };
        return this._physicalValue;
    }

    /// Getters
    public get logicalType() {
        return this._logicalType;
    }
    public get i8() {
        return (this._physicalValue as NumberValue).value;
    }
    public get u8() {
        return (this._physicalValue as NumberValue).value;
    }
    public get i16() {
        return (this._physicalValue as NumberValue).value;
    }
    public get u16() {
        return (this._physicalValue as NumberValue).value;
    }
    public get i32() {
        return (this._physicalValue as NumberValue).value;
    }
    public get u32() {
        return (this._physicalValue as NumberValue).value;
    }
    public get i64() {
        return (this._physicalValue as LongValue).value;
    }
    public get u64() {
        return (this._physicalValue as LongValue).value;
    }
    public get i128() {
        return (this._physicalValue as I128Value).value;
    }
    public get str() {
        return (this._physicalValue as StringValue).value;
    }
    public get interval() {
        return (this._physicalValue as IntervalValue).value;
    }
    public get nullFlag() {
        return this._nullFlag;
    }

    /// Setters
    public set sqlType(v: proto.SQLType) {
        this._logicalType = getSQLType(v);
    }
    public set nullFlag(v: boolean) {
        this._nullFlag = v;
    }
    public set rawValue(v: PhysicalValue) {
        this._physicalValue = v;
    }

    /// Read from proto
    public static FromProto(buffer: proto.SQLValue, v: Value | null = null) {
        v = v || new Value();
        v.sqlType = buffer.logicalType()!;
        switch (buffer.physicalType()!) {
            case proto.PhysicalType.U32:
                v.rawValue = {
                    type: PhysicalType.NUMBER,
                    value: buffer.dataU32()!,
                };
                break;
            case proto.PhysicalType.F64:
                v.rawValue = {
                    type: PhysicalType.NUMBER,
                    value: buffer.dataF64()!,
                };
                break;
            case proto.PhysicalType.I64:
                v.rawValue = {
                    type: PhysicalType.LONG,
                    value: buffer.dataI64()!,
                };
                break;
            case proto.PhysicalType.STRING:
                v.rawValue = {
                    type: PhysicalType.STRING,
                    value: buffer.dataStr()!,
                };
                break;
        }
        return v;
    }
}

/// A physical type
export enum PhysicalType {
    NUMBER,
    STRING,
    LONG,
    I128,
    INTERVAL,
}

/// Value interfaces
export interface NumberValue {
    type: PhysicalType.NUMBER;
    value: number;
}
export interface StringValue {
    type: PhysicalType.STRING;
    value: string;
}
export interface LongValue {
    type: PhysicalType.LONG;
    value: flatbuffers.Long;
}
export interface I128Value {
    type: PhysicalType.I128;
    value: proto.I128;
}
export interface IntervalValue {
    type: PhysicalType.INTERVAL;
    value: proto.Interval;
}
