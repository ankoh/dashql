// Copyright (c) 2020 The DashQL Authors

import { webdb as proto, fb as flatbuffers } from '@dashql/proto';

/** A sql type */
export interface SQLType {
    /** A type id */
    typeId: proto.SQLTypeID;
    /** The width */
    width: number;
    /** The scale */
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

/** A physical type */
export enum PhysicalType {
    NULL_,
    NUMBER,
    STRING,
    LONG,
    I128,
    INTERVAL,
}

/** A value */
export class Value {
    /** The type */
    _logicalType: SQLType;
    /** The value */
    _physicalType: PhysicalType;
    /** The number value */
    _value_number?: number;
    /** The long value */
    _value_long?: flatbuffers.Long;
    /** The i128 value */
    _value_i128?: proto.I128;
    /** The interval value */
    _value_interval?: proto.Interval;
    /** The string value */
    _value_string?: string;

    /** Constructor */
    public constructor(
        type: SQLType = {
            typeId: proto.SQLTypeID.INVALID,
            width: 0,
            scale: 0,
        },
    ) {
        this._logicalType = type;
        this._physicalType = PhysicalType.NULL_;
    }

    /** Get the sql type */
    public get logicalType() {
        return this._logicalType;
    }
    /** Set the sql type */
    public set sqlType(v: proto.SQLType) {
        this._logicalType = getSQLType(v);
    }
    /** Is null? */
    public isNull(): boolean {
        return this._physicalType == PhysicalType.NULL_;
    }
    /** Reset a value */
    public setNull(isNull: boolean = true) {
        if (!isNull) return;
        this._physicalType = PhysicalType.NULL_;
        this._value_number = undefined;
        this._value_long = undefined;
        this._value_i128 = undefined;
        this._value_interval = undefined;
    }
    /** Set a number */
    public setNumber(v: number) {
        this._physicalType = PhysicalType.NUMBER;
        this._value_number = v;
    }
    /** Set a long */
    public setLong(v: flatbuffers.Long) {
        this._physicalType = PhysicalType.LONG;
        this._value_long = v;
    }
    /** Set an i128 */
    public setI128(v: proto.I128) {
        this._physicalType = PhysicalType.I128;
        this._value_i128 = v;
    }
    /** Set an interval */
    public setInterval(v: proto.Interval) {
        this._physicalType = PhysicalType.INTERVAL;
        this._value_interval = v;
    }
    /** Set an interval */
    public setString(v: string) {
        this._physicalType = PhysicalType.STRING;
        this._value_string = v;
    }

    /** Cast as floating point number */
    public castAsFloat(): number {
        switch (this._physicalType) {
            case PhysicalType.NUMBER:
                return this._value_number!;
            case PhysicalType.LONG:
                return this._value_long!.low;
            case PhysicalType.I128:
                return this._value_i128!.lower().toFloat64();
            case PhysicalType.STRING:
                return parseFloat(this._value_string!);
            default:
                return 0.0;
        }
    }

    /** As integer value */
    public castAsInteger(): number {
        switch (this._physicalType) {
            case PhysicalType.NUMBER:
                return Math.trunc(this._value_number!);
            case PhysicalType.LONG:
                return this._value_long!.low;
            case PhysicalType.I128:
                return this._value_i128!.lower().toFloat64();
            case PhysicalType.STRING:
                return parseInt(this._value_string!);
            default:
                return 0.0;
        }
    }

    /** As string value */
    public castAsString(): string {
        switch (this._physicalType) {
            case PhysicalType.NUMBER:
                return this._value_number!.toString();
            case PhysicalType.STRING:
                return this._value_string!;
            default:
                return '';
        }
    }

    /** Print for script */
    public printScript(): string {
        // XXX
        return this.castAsString();
    }

    /** Read from proto */
    public static FromProto(buffer: proto.SQLValue, v: Value | null = null) {
        v = v || new Value();
        v.sqlType = buffer.logicalType()!;
        switch (buffer.physicalType()!) {
            case proto.PhysicalType.U32:
                v._physicalType = PhysicalType.NUMBER;
                v._value_number = buffer.dataU32()!;
                break;
            case proto.PhysicalType.F64:
                v._physicalType = PhysicalType.NUMBER;
                v._value_number = buffer.dataF64()!;
                break;
            case proto.PhysicalType.I64:
                v._physicalType = PhysicalType.LONG;
                v._value_long = buffer.dataI64()!;
                break;
            case proto.PhysicalType.STRING:
                v._physicalType = PhysicalType.STRING;
                v._value_string = buffer.dataStr()!;
                break;
        }
        return v;
    }

    public static DOUBLE(lit: number): Value {
        const v = new Value({
            typeId: proto.SQLTypeID.DOUBLE,
            width: 0,
            scale: 0,
        });
        v._physicalType = PhysicalType.NUMBER;
        v._value_number = lit;
        return v;
    }
}
