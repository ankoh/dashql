"use strict";
// Copyright (c) 2020 The DashQL Authors
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
exports.__esModule = true;
exports.QueryResultRowIterator = exports.MaterializedQueryResultChunks = exports.QueryResultChunkStream = exports.QueryResultChunkIterator = void 0;
var proto_1 = require("@dashql/proto");
/// An abstract chunk iterator
var QueryResultChunkIterator = /** @class */ (function () {
    /// Constructor
    function QueryResultChunkIterator(connection, resultBuffer) {
        this._connection = connection;
        this._resultBuffer = resultBuffer;
        this._currentChunkID = -1;
        this._currentChunk = new proto_1.webdb.QueryResultChunk();
        this._columnTypes = new Array();
        this._tmp = new VectorVariants();
        // Collect the column types
        for (var i = 0; i < this.result.columnTypesLength(); ++i) {
            var t = new proto_1.webdb.SQLType();
            this.result.columnTypes(i, t);
            this._columnTypes.push(t);
        }
    }
    Object.defineProperty(QueryResultChunkIterator.prototype, "result", {
        /// Get the result
        get: function () { return this._resultBuffer; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(QueryResultChunkIterator.prototype, "columnCount", {
        /// Get the column count
        get: function () { return this._columnTypes.length; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(QueryResultChunkIterator.prototype, "columnTypes", {
        /// Get the column count
        get: function () { return this._columnTypes; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(QueryResultChunkIterator.prototype, "currentChunk", {
        /// Get the current chunk
        get: function () { return this._currentChunk; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(QueryResultChunkIterator.prototype, "tmp", {
        /// Get the temporary buffers
        get: function () { return this._tmp; },
        enumerable: false,
        configurable: true
    });
    /// Iterate over a number column
    QueryResultChunkIterator.prototype.iterateNumberColumn = function (cid, fn) {
        if (cid >= this.columnCount) {
            throw Error("column index out of bounds");
        }
        var c = this.currentChunk.columns(cid, this.tmp.vector);
        if (c == null) {
            return;
        }
        var v;
        switch (c.variantType()) {
            case proto_1.webdb.VectorVariant.VectorI8:
                v = c.variant(this.tmp.vectorI8);
                break;
            case proto_1.webdb.VectorVariant.VectorU8:
                v = c.variant(this.tmp.vectorU8);
                break;
            case proto_1.webdb.VectorVariant.VectorI16:
                v = c.variant(this.tmp.vectorI16);
                break;
            case proto_1.webdb.VectorVariant.VectorU16:
                v = c.variant(this.tmp.vectorU16);
                break;
            case proto_1.webdb.VectorVariant.VectorI32:
                v = c.variant(this.tmp.vectorI32);
                break;
            case proto_1.webdb.VectorVariant.VectorU32:
                v = c.variant(this.tmp.vectorU32);
                break;
            case proto_1.webdb.VectorVariant.VectorF32:
                v = c.variant(this.tmp.vectorF32);
                break;
            case proto_1.webdb.VectorVariant.VectorF64:
                v = c.variant(this.tmp.vectorF64);
                break;
            case proto_1.webdb.VectorVariant.NONE:
            case proto_1.webdb.VectorVariant.VectorI128:
            case proto_1.webdb.VectorVariant.VectorI64:
            case proto_1.webdb.VectorVariant.VectorU64:
            case proto_1.webdb.VectorVariant.VectorInterval:
            case proto_1.webdb.VectorVariant.VectorString:
            default:
                return;
        }
        var a = v.valuesArray();
        var n = v.nullMaskArray();
        if (a == null)
            return;
        if (n != null) {
            for (var i = 0; i < a.length; ++i) {
                fn(i, n[i] ? null : a[i]);
            }
        }
        else {
            for (var i = 0; i < a.length; ++i) {
                fn(i, a[i]);
            }
        }
    };
    return QueryResultChunkIterator;
}());
exports.QueryResultChunkIterator = QueryResultChunkIterator;
/// A stream of query result chunks
var QueryResultChunkStream = /** @class */ (function (_super) {
    __extends(QueryResultChunkStream, _super);
    /// Constructor
    function QueryResultChunkStream(connection, resultBuffer) {
        var _this = _super.call(this, connection, resultBuffer) || this;
        _this._currentChunkBuffer = null;
        return _this;
    }
    /// Get the next chunk
    QueryResultChunkStream.prototype.next = function () {
        var result = this._resultBuffer;
        if (++this._currentChunkID < result.dataChunksLength()) {
            result.dataChunks(0, this._currentChunk);
        }
        else {
            var chunkBuffer = this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
            this._currentChunkBuffer = chunkBuffer;
        }
        return this._currentChunk.rowCount().low > 0;
    };
    return QueryResultChunkStream;
}(QueryResultChunkIterator));
exports.QueryResultChunkStream = QueryResultChunkStream;
/// Materialized result chunks
var MaterializedQueryResultChunks = /** @class */ (function (_super) {
    __extends(MaterializedQueryResultChunks, _super);
    /// Constructor
    function MaterializedQueryResultChunks(connection, resultBuffer, chunks) {
        var _this = _super.call(this, connection, resultBuffer) || this;
        _this._chunks = [];
        for (var i = 0; i < _this.result.dataChunksLength(); ++i) {
            _this._chunks.push(_this.result.dataChunks(i));
        }
        for (var i = 0; i < chunks.length; ++i) {
            _this._chunks.push(chunks[i]);
        }
        if (_this._chunks.length == 0 || _this._chunks[_this._chunks.length - 1].rowCount().low == 0) {
            _this._chunks.push(new proto_1.webdb.QueryResultChunk());
        }
        return _this;
    }
    /// Restart  the chunk iterator
    MaterializedQueryResultChunks.prototype.rewind = function () { this._currentChunkID = -1; };
    /// Get the next chunk
    MaterializedQueryResultChunks.prototype.next = function () {
        this._currentChunkID = Math.min(this._currentChunkID + 1, this._chunks.length - 1);
        this._currentChunk = this._chunks[this._currentChunkID];
        return this._currentChunk.rowCount().low > 0;
    };
    return MaterializedQueryResultChunks;
}(QueryResultChunkIterator));
exports.MaterializedQueryResultChunks = MaterializedQueryResultChunks;
/// A query result row iterator
var QueryResultRowIterator = /** @class */ (function () {
    /// Constructor
    function QueryResultRowIterator(resultChunks) {
        this._chunkIter = resultChunks;
        this._globalRowIndex = 0;
        this._currentChunkBegin = 0;
    }
    /// Iterate over a result buffer
    QueryResultRowIterator.iterate = function (resultChunks) {
        var iter = new QueryResultRowIterator(resultChunks);
        resultChunks.next();
        iter._currentChunkBegin = 0;
        return iter;
    };
    Object.defineProperty(QueryResultRowIterator.prototype, "currentRow", {
        /// Get the chunk row
        get: function () { return this._globalRowIndex - this._currentChunkBegin; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(QueryResultRowIterator.prototype, "currentChunk", {
        /// Get the current chunk
        get: function () { return this._chunkIter.currentChunk; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(QueryResultRowIterator.prototype, "tmp", {
        /// Get the temporary buffers
        get: function () { return this._chunkIter.tmp; },
        enumerable: false,
        configurable: true
    });
    /// Get the column count
    QueryResultRowIterator.prototype.getColumnName = function (idx) { return this._chunkIter.result.columnNames(idx); };
    /// Is the end?
    QueryResultRowIterator.prototype.isEnd = function () { return this.currentRow >= this.currentChunk.rowCount().low; };
    /// Advance the iterator
    QueryResultRowIterator.prototype.next = function () {
        // Reached end?
        if (this.isEnd())
            return false;
        // Still in current chunk?
        ++this._globalRowIndex;
        if (this.currentRow < this.currentChunk.rowCount().low)
            return true;
        // Get next chunk
        this._chunkIter.next();
        this._currentChunkBegin = this._globalRowIndex;
        var empty = this.currentChunk.rowCount().low == 0;
        return !empty;
    };
    /// Get a value
    QueryResultRowIterator.prototype.getValue = function (cid, v) {
        if (cid >= this._chunkIter.columnCount) {
            throw Error("column index out of bounds");
        }
        v.sqlType = this._chunkIter.columnTypes[cid];
        var r = this.currentRow;
        // Read the vector
        var c = this.currentChunk.columns(cid, this.tmp.vector);
        if (c == null) {
            v.nullFlag = true;
            return v;
        }
        switch (c.variantType()) {
            case proto_1.webdb.VectorVariant.NONE:
                break;
            case proto_1.webdb.VectorVariant.VectorI8:
                c.variant(this.tmp.vectorI8);
                v.asNumber().value = this.tmp.vectorI8.values(r);
                v.nullFlag = this.tmp.vectorI8.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorU8:
                c.variant(this.tmp.vectorU8);
                v.asNumber().value = this.tmp.vectorU8.values(r);
                v.nullFlag = this.tmp.vectorU8.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorI16:
                c.variant(this.tmp.vectorI16);
                v.asNumber().value = this.tmp.vectorI16.values(r);
                v.nullFlag = this.tmp.vectorI16.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorU16:
                c.variant(this.tmp.vectorU16);
                v.asNumber().value = this.tmp.vectorU16.values(r);
                v.nullFlag = this.tmp.vectorU16.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorI32:
                c.variant(this.tmp.vectorI32);
                v.asNumber().value = this.tmp.vectorI32.values(r);
                v.nullFlag = this.tmp.vectorI32.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorU32:
                c.variant(this.tmp.vectorU32);
                v.asNumber().value = this.tmp.vectorU32.values(r);
                v.nullFlag = this.tmp.vectorU32.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorI64:
                c.variant(this.tmp.vectorI64);
                v.asLong().value = this.tmp.vectorI64.values(r);
                v.nullFlag = this.tmp.vectorI64.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorU64:
                c.variant(this.tmp.vectorU64);
                v.asLong().value = this.tmp.vectorU64.values(r);
                v.nullFlag = this.tmp.vectorU64.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorI128:
                c.variant(this.tmp.vectorI128);
                this.tmp.vectorI128.values(r, v.asI128().value);
                v.nullFlag = this.tmp.vectorI128.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorF32:
                c.variant(this.tmp.vectorF32);
                v.asNumber().value = this.tmp.vectorF32.values(r);
                v.nullFlag = this.tmp.vectorF32.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorF64:
                c.variant(this.tmp.vectorF64);
                v.asNumber().value = this.tmp.vectorF64.values(r);
                v.nullFlag = this.tmp.vectorF64.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorInterval:
                c.variant(this.tmp.vectorInterval);
                this.tmp.vectorInterval.values(r, v.asInterval().value);
                v.nullFlag = this.tmp.vectorInterval.nullMask(r);
                break;
            case proto_1.webdb.VectorVariant.VectorString:
                c.variant(this.tmp.vectorString);
                v.asString().value = this.tmp.vectorString.values(r);
                v.nullFlag = this.tmp.vectorString.nullMask(r);
                break;
        }
        return v;
    };
    return QueryResultRowIterator;
}());
exports.QueryResultRowIterator = QueryResultRowIterator;
/// Flatbuffer objects to decode flatbuffers without allocation
var VectorVariants = /** @class */ (function () {
    /// Constructor
    function VectorVariants() {
        this.vector = new proto_1.webdb.Vector();
        this.vectorI8 = new proto_1.webdb.VectorI8();
        this.vectorU8 = new proto_1.webdb.VectorU8();
        this.vectorI16 = new proto_1.webdb.VectorI16();
        this.vectorU16 = new proto_1.webdb.VectorU16();
        this.vectorI32 = new proto_1.webdb.VectorI32();
        this.vectorU32 = new proto_1.webdb.VectorU32();
        this.vectorI64 = new proto_1.webdb.VectorI64();
        this.vectorU64 = new proto_1.webdb.VectorU64();
        this.vectorI128 = new proto_1.webdb.VectorI128();
        this.vectorF32 = new proto_1.webdb.VectorF32();
        this.vectorF64 = new proto_1.webdb.VectorF64();
        this.vectorInterval = new proto_1.webdb.VectorInterval();
        this.vectorString = new proto_1.webdb.VectorString();
    }
    return VectorVariants;
}());
;
