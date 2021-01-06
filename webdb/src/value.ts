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
    scale: number
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

/// A value
export class Value {
    /// The type
    _type: SQLType;
    /// The value
    _valueVariant: NumberValue | StringValue | LongValue | I128Value | IntervalValue;
    /// The null flag
    _nullFlag: boolean;

    /// Constructor
    public constructor() {
        this._type = {
            typeId: proto.SQLTypeID.INVALID,
            width: 0,
            scale: 0,
        };
        this._nullFlag = true;
        this._valueVariant = {
            type: PhysicalType.NUMBER,
            value: 0
        };
    }

    /// As number value
    public asNumber() {
        if (this._valueVariant.type != PhysicalType.NUMBER)
            this._valueVariant = { type: PhysicalType.NUMBER, value: 0.0 };
        return this._valueVariant;
    }

    /// As string value
    public asString() {
        if (this._valueVariant.type != PhysicalType.STRING)
            this._valueVariant = { type: PhysicalType.STRING, value: "" };
        return this._valueVariant;
    }

    /// As long value
    public asLong() {
        if (this._valueVariant.type != PhysicalType.LONG)
            this._valueVariant = { type: PhysicalType.LONG, value: flatbuffers.Long.ZERO };
        return this._valueVariant;
    }

    /// As i128 value
    public asI128() {
        if (this._valueVariant.type != PhysicalType.I128)
            this._valueVariant = { type: PhysicalType.I128, value: new proto.I128() };
        return this._valueVariant;
    }

    /// As interval value
    public asInterval() {
        if (this._valueVariant.type != PhysicalType.INTERVAL)
            this._valueVariant = { type: PhysicalType.INTERVAL, value: new proto.Interval() };
        return this._valueVariant;
    }

    /// Getters
    public get type() { return this._type; }
    public get i8() { return (this._valueVariant as NumberValue).value; }
    public get u8() { return (this._valueVariant as NumberValue).value; }
    public get i16() { return (this._valueVariant as NumberValue).value; }
    public get u16() { return (this._valueVariant as NumberValue).value; }
    public get i32() { return (this._valueVariant as NumberValue).value; }
    public get u32() { return (this._valueVariant as NumberValue).value; }
    public get i64() { return (this._valueVariant as LongValue).value; }
    public get u64() { return (this._valueVariant as LongValue).value; }
    public get i128() { return (this._valueVariant as I128Value).value; }
    public get str() { return (this._valueVariant as StringValue).value; }
    public get interval() { return (this._valueVariant as IntervalValue).value; }
    public get nullFlag() { return this._nullFlag; }

    /// Setters
    public set sqlType(v: proto.SQLType) { this._type = getSQLType(v); }
    public set nullFlag(v: boolean) { this._nullFlag = v; }
}

/// A physical type
export enum PhysicalType { NUMBER, STRING, LONG, I128, INTERVAL, }

/// Value interfaces
export interface NumberValue { type: PhysicalType.NUMBER; value: number; }
export interface StringValue { type: PhysicalType.STRING; value: string; }
export interface LongValue { type: PhysicalType.LONG; value: flatbuffers.Long; }
export interface I128Value { type: PhysicalType.I128; value: proto.I128; }
export interface IntervalValue { type: PhysicalType.INTERVAL; value: proto.Interval; }
