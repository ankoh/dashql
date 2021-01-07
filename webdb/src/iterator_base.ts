// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { Value } from './value';

type NumberVector = proto.VectorI8 | proto.VectorI16 | proto.VectorI32 | proto.VectorU8 | proto.VectorU16 | proto.VectorU32 | proto.VectorF32 | proto.VectorF64;
type NumberArray = Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array;

/// A chunk iterator base class
export abstract class ChunkIteratorBase {
    /// The result buffer
    _resultBuffer: proto.QueryResult;
    /// The chunk id
    _currentChunkID: number;
    /// The current chunk
    _currentChunk: proto.QueryResultChunk;
    /// The column types
    _columnTypes: proto.SQLType[];
    /// The temporary flatbuffer objects
    _tmp: VectorBuffers;

    /// Constructor
    public constructor(resultBuffer: proto.QueryResult) {
        this._resultBuffer = resultBuffer;
        this._currentChunkID = -1;
        this._currentChunk = new proto.QueryResultChunk();
        this._columnTypes = new Array<proto.SQLType>();
        this._tmp = new VectorBuffers();

        // Collect the column types
        for (let i = 0; i < this.result.columnTypesLength(); ++i) {
            let t = new proto.SQLType();
            this.result.columnTypes(i, t);
            this._columnTypes.push(t);
        }
    }
    /// Get the result
    public get result() { return this._resultBuffer; }
    /// Get the column count
    public get columnCount() { return this._columnTypes.length; }
    /// Get the column count
    public get columnTypes() { return this._columnTypes; }
    /// Get the row count
    public get rowCount() { return this._currentChunk.rowCount(); }
    /// Get the current chunk
    public get currentChunk() { return this._currentChunk; }
    /// Get the temporary buffers
    public get tmp() { return this._tmp; }

    /// Iterate over a number column
    public iterateNumberColumn(cid: number, fn: (row: number, v: number | null) => void) {
        if (cid >= this.columnCount) {
            throw Error("column index out of bounds");
        }
        let c = this.currentChunk.columns(cid, this.tmp.vector);
        if (c == null) {
            return;
        }
        let v : NumberVector | null;
        switch (c.variantType()) {
            case proto.VectorVariant.VectorI8:
                v = c.variant(this.tmp.vectorI8)!;
                break;
            case proto.VectorVariant.VectorU8:
                v = c.variant(this.tmp.vectorU8)!;
                break;
            case proto.VectorVariant.VectorI16:
                v = c.variant(this.tmp.vectorI16)!;
                break;
            case proto.VectorVariant.VectorU16:
                v = c.variant(this.tmp.vectorU16)!;
                break;
            case proto.VectorVariant.VectorI32:
                v = c.variant(this.tmp.vectorI32)!;
                break;
            case proto.VectorVariant.VectorU32:
                v = c.variant(this.tmp.vectorU32)!;
                break;
            case proto.VectorVariant.VectorF32:
                v = c.variant(this.tmp.vectorF32)!;
                break;
            case proto.VectorVariant.VectorF64:
                v = c.variant(this.tmp.vectorF64)!;
                break;
            case proto.VectorVariant.NONE:
            case proto.VectorVariant.VectorI128:
            case proto.VectorVariant.VectorI64:
            case proto.VectorVariant.VectorU64:
            case proto.VectorVariant.VectorInterval:
            case proto.VectorVariant.VectorString:
            default:
                return;
        }
        let a: NumberArray | null = v.valuesArray();
        let n: Int8Array | null = v.nullMaskArray();
        if (a == null)
            return;
        if (n != null) {
            for (let i = 0; i < a.length; ++i) {
                fn(i, n[i] ? null : a[i]);
            }
        } else {
            for (let i = 0; i < a.length; ++i) {
                fn(i, a[i]);
            }
        }
    }
}

/// A row iterator base class
export abstract class RowIteratorBase {
    /// The query result
    _chunkIter: ChunkIteratorBase;
    /// The global row index
    _globalRowIndex: number = 0;
    /// The chunk row begin
    _currentChunkBegin: number = 0;

    constructor(iter: ChunkIteratorBase) {
        this._chunkIter = iter;
    }

    /// Get the temporary buffers
    public get tmp() { return this._chunkIter.tmp; }
    /// Get the chunk row
    public get currentRow() { return this._globalRowIndex - this._currentChunkBegin; }
    /// Get the current chunk
    public get currentChunk(): proto.QueryResultChunk { return this._chunkIter.currentChunk; }
    /// Get the column count
    public getColumnName(idx: number) { return this._chunkIter.result.columnNames(idx); }
    /// Is the end?
    public isEnd(): boolean { return this.currentRow >= this.currentChunk.rowCount(); }


    /// Read a value
    public getValue(cid: number = 0, v: Value = new Value()): Value {
        if (cid >= this._chunkIter.columnCount) {
            throw Error("column index out of bounds");
        }
        v.sqlType = this._chunkIter.columnTypes[cid];
        let r = this.currentRow;
        let c = this.currentChunk.columns(cid, this.tmp.vector);
        if (c == null) {
            v.nullFlag = true;
            return v;
        }
        switch (c.variantType()) {
            case proto.VectorVariant.NONE:
                break;
            case proto.VectorVariant.VectorI8:
                c.variant(this.tmp.vectorI8);
                v.asNumber().value = this.tmp.vectorI8.values(r)!;
                v.nullFlag = this.tmp.vectorI8.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorU8:
                c.variant(this.tmp.vectorU8);
                v.asNumber().value = this.tmp.vectorU8.values(r)!;
                v.nullFlag = this.tmp.vectorU8.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorI16:
                c.variant(this.tmp.vectorI16);
                v.asNumber().value = this.tmp.vectorI16.values(r)!;
                v.nullFlag = this.tmp.vectorI16.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorU16:
                c.variant(this.tmp.vectorU16);
                v.asNumber().value = this.tmp.vectorU16.values(r)!;
                v.nullFlag = this.tmp.vectorU16.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorI32:
                c.variant(this.tmp.vectorI32);
                v.asNumber().value = this.tmp.vectorI32.values(r)!;
                v.nullFlag = this.tmp.vectorI32.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorU32:
                c.variant(this.tmp.vectorU32);
                v.asNumber().value = this.tmp.vectorU32.values(r)!;
                v.nullFlag = this.tmp.vectorU32.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorI64:
                c.variant(this.tmp.vectorI64);
                v.asLong().value = this.tmp.vectorI64.values(r)!;
                v.nullFlag = this.tmp.vectorI64.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorU64:
                c.variant(this.tmp.vectorU64);
                v.asLong().value = this.tmp.vectorU64.values(r)!;
                v.nullFlag = this.tmp.vectorU64.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorI128:
                c.variant(this.tmp.vectorI128);
                this.tmp.vectorI128.values(r, v.asI128().value)!;
                v.nullFlag = this.tmp.vectorI128.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorF32:
                c.variant(this.tmp.vectorF32);
                v.asNumber().value = this.tmp.vectorF32.values(r)!;
                v.nullFlag = this.tmp.vectorF32.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorF64:
                c.variant(this.tmp.vectorF64);
                v.asNumber().value = this.tmp.vectorF64.values(r)!;
                v.nullFlag = this.tmp.vectorF64.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorInterval:
                c.variant(this.tmp.vectorInterval);
                this.tmp.vectorInterval.values(r, v.asInterval().value)!;
                v.nullFlag = this.tmp.vectorInterval.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorString:
                c.variant(this.tmp.vectorString);
                v.asString().value = this.tmp.vectorString.values(r)!;
                v.nullFlag = this.tmp.vectorString.nullMask(r)!;
                break;
        }
        return v;
    }
}

/// Flatbuffer objects to decode flatbuffers without allocation
export class VectorBuffers {
    vector: proto.Vector;
    vectorI8: proto.VectorI8;
    vectorU8: proto.VectorU8;
    vectorI16: proto.VectorI16;
    vectorU16: proto.VectorU16;
    vectorI32: proto.VectorI32;
    vectorU32: proto.VectorU32;
    vectorI64: proto.VectorI64;
    vectorU64: proto.VectorU64;
    vectorI128: proto.VectorI128;
    vectorF32: proto.VectorF32;
    vectorF64: proto.VectorF64;
    vectorInterval: proto.VectorInterval;
    vectorString: proto.VectorString;

    /// Constructor
    constructor() {
        this.vector = new proto.Vector();
        this.vectorI8 = new proto.VectorI8();
        this.vectorU8 = new proto.VectorU8();
        this.vectorI16 = new proto.VectorI16();
        this.vectorU16 = new proto.VectorU16();
        this.vectorI32 = new proto.VectorI32();
        this.vectorU32 = new proto.VectorU32();
        this.vectorI64 = new proto.VectorI64();
        this.vectorU64 = new proto.VectorU64();
        this.vectorI128 = new proto.VectorI128();
        this.vectorF32 = new proto.VectorF32();
        this.vectorF64 = new proto.VectorF64();
        this.vectorInterval = new proto.VectorInterval();
        this.vectorString = new proto.VectorString();
    }
};
