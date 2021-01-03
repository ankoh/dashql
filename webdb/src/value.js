"use strict";
// Copyright (c) 2020 The DashQL Authors
exports.__esModule = true;
exports.PhysicalType = exports.Value = void 0;
var proto_1 = require("@dashql/proto");
var flatbuffers_1 = require("flatbuffers");
/// A value
var Value = /** @class */ (function () {
    /// Constructor
    function Value() {
        this._sqlType = new proto_1.webdb.SQLType();
        this._nullFlag = true;
        this._valueVariant = {
            type: PhysicalType.NUMBER,
            value: 0
        };
    }
    /// As number value
    Value.prototype.asNumber = function () {
        if (this._valueVariant.type != PhysicalType.NUMBER)
            this._valueVariant = { type: PhysicalType.NUMBER, value: 0.0 };
        return this._valueVariant;
    };
    /// As string value
    Value.prototype.asString = function () {
        if (this._valueVariant.type != PhysicalType.STRING)
            this._valueVariant = { type: PhysicalType.STRING, value: "" };
        return this._valueVariant;
    };
    /// As long value
    Value.prototype.asLong = function () {
        if (this._valueVariant.type != PhysicalType.LONG)
            this._valueVariant = { type: PhysicalType.LONG, value: flatbuffers_1.flatbuffers.Long.ZERO };
        return this._valueVariant;
    };
    /// As i128 value
    Value.prototype.asI128 = function () {
        if (this._valueVariant.type != PhysicalType.I128)
            this._valueVariant = { type: PhysicalType.I128, value: new proto_1.webdb.I128() };
        return this._valueVariant;
    };
    /// As interval value
    Value.prototype.asInterval = function () {
        if (this._valueVariant.type != PhysicalType.INTERVAL)
            this._valueVariant = { type: PhysicalType.INTERVAL, value: new proto_1.webdb.Interval() };
        return this._valueVariant;
    };
    Object.defineProperty(Value.prototype, "sqlType", {
        /// Getters
        get: function () { return this._sqlType; },
        /// Setters
        set: function (v) { this._sqlType = v; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "i8", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "u8", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "i16", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "u16", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "i32", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "u32", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "i64", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "u64", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "i128", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "str", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "interval", {
        get: function () { return this._valueVariant.value; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Value.prototype, "nullFlag", {
        get: function () { return this._nullFlag; },
        set: function (v) { this._nullFlag = v; },
        enumerable: false,
        configurable: true
    });
    return Value;
}());
exports.Value = Value;
/// A physical type
var PhysicalType;
(function (PhysicalType) {
    PhysicalType[PhysicalType["NUMBER"] = 0] = "NUMBER";
    PhysicalType[PhysicalType["STRING"] = 1] = "STRING";
    PhysicalType[PhysicalType["LONG"] = 2] = "LONG";
    PhysicalType[PhysicalType["I128"] = 3] = "I128";
    PhysicalType[PhysicalType["INTERVAL"] = 4] = "INTERVAL";
})(PhysicalType = exports.PhysicalType || (exports.PhysicalType = {}));
