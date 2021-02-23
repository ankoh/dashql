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

type PhysicalValue = NullValue | NumberValue | StringValue | LongValue | I128Value | IntervalValue;

/// A value
export class Value {
    /// The type
    _logicalType: SQLType;
    /// The value
    _physicalValue: PhysicalValue;

    /// Constructor
    public constructor(
        type: SQLType = {
            typeId: proto.SQLTypeID.INVALID,
            width: 0,
            scale: 0,
        },
        value: PhysicalValue = {
            type: PhysicalType.NULL_,
            value: null
        }
    ) {
        this._logicalType = type;
        this._physicalValue = value;
    }

    /// Get the sql type 
    public get logicalType() {
        return this._logicalType;
    }
    /// Set the sql type
    public set sqlType(v: proto.SQLType) {
        this._logicalType = getSQLType(v);
    }
    /// Access the raw value
    public set rawValue(v: PhysicalValue) {
        this._physicalValue = v;
    }
    /// Reset a value
    public resetValue() {
        this._physicalValue = {
            type: PhysicalType.NULL_,
            value: null,
        };
    }
    /// Is null?
    public isNull(): boolean {
        return this._physicalValue.type == PhysicalType.NULL_;
    }

    /// Set a number
    public setNumber(v: number, isNull: boolean) {
        this._physicalValue = !isNull ? {
            type: PhysicalType.NUMBER,
            value: v,
        } : {
            type: PhysicalType.NULL_,
            value: null,
        }
    }
    /// Set a long
    public setLong(v: flatbuffers.Long, isNull: boolean) {
        this._physicalValue = !isNull ? {
            type: PhysicalType.LONG,
            value: v,
        } : {
            type: PhysicalType.NULL_,
            value: null,
        }
    }
    /// Set an i128
    public setI128(v: proto.I128, isNull: boolean) {
        this._physicalValue = !isNull ? {
            type: PhysicalType.I128,
            value: v,
        } : {
            type: PhysicalType.NULL_,
            value: null,
        }
    }
    /// Set an interval
    public setInterval(v: proto.Interval, isNull: boolean) {
        this._physicalValue = !isNull ? {
            type: PhysicalType.INTERVAL,
            value: v,
        } : {
            type: PhysicalType.NULL_,
            value: null,
        }
    }
    /// Set an interval
    public setString(v: string, isNull: boolean) {
        this._physicalValue = !isNull ? {
            type: PhysicalType.STRING,
            value: v,
        } : {
            type: PhysicalType.NULL_,
            value: null,
        }
    }

    /// As number value
    public castAsNumber(): number {
        switch (this._physicalValue.type) {
            case PhysicalType.NUMBER:
                return this._physicalValue.value;
            case PhysicalType.LONG:
                return this._physicalValue.value.toFloat64();
            case PhysicalType.I128:
                return this._physicalValue.value.lower().toFloat64();
            case PhysicalType.STRING:
                return parseFloat(this._physicalValue.value);
            default:
                return 0.0;
        }
    }

    /// As string value
    public castAsString(): string {
        switch (this._physicalValue.type) {
            case PhysicalType.NUMBER:
                return this._physicalValue.value.toString();
            case PhysicalType.STRING:
                return this._physicalValue.value.toString();
            default:
                return "";
        }
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
    NULL_,
    NUMBER,
    STRING,
    LONG,
    I128,
    INTERVAL,
}

/// Value interfaces
export interface NullValue {
    type: PhysicalType.NULL_;
    value: null;
}
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
