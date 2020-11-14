// Copyright (c) 2020 The DashQL Authors

import { DuckDBConnection } from './webapi_bindings';
import { QueryResultBuffer, QueryResultChunkBuffer } from './webapi_buffer';
import { Value } from './value';
import * as proto from '../proto';

type NumberVector = proto.vector.VectorI8 | proto.vector.VectorI16 | proto.vector.VectorI32 | proto.vector.VectorU8 | proto.vector.VectorU16 | proto.vector.VectorU32 | proto.vector.VectorF32 | proto.vector.VectorF64;
type NumberArray = Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array;

/// An abstract chunk iterator
export abstract class QueryResultChunkIterator {
    /// The connection
    _connection: DuckDBConnection;
    /// The result buffer
    _resultBuffer: QueryResultBuffer;
    /// The chunk id
    _currentChunkID: number;
    /// The current chunk
    _currentChunk: proto.query_result.QueryResultChunk;
    /// The column types
    _columnTypes: proto.sql_type.SQLType[];
    /// The temporary flatbuffer objects
    _tmp: VectorVariants;

    /// Constructor
    public constructor(connection: DuckDBConnection, resultBuffer: QueryResultBuffer) {
        this._connection = connection;
        this._resultBuffer = resultBuffer;
        this._currentChunkID = -1;
        this._currentChunk = new proto.query_result.QueryResultChunk();
        this._columnTypes = new Array<proto.sql_type.SQLType>();
        this._tmp = new VectorVariants();

        // Collect the column types
        for (let i = 0; i < this.result.columnTypesLength(); ++i) {
            let t = new proto.sql_type.SQLType();
            this.result.columnTypes(i, t);
            this._columnTypes.push(t);
        }
    }
    /// Get the result
    public get result() { return this._resultBuffer.root; }
    /// Get the column count
    public get columnCount() { return this._columnTypes.length; }
    /// Get the column count
    public get columnTypes() { return this._columnTypes; }
    /// Get the current chunk
    public get currentChunk() { return this._currentChunk; }
    /// Get the temporary buffers
    public get tmp() { return this._tmp; }

    /// Get the next query result chunk
    public abstract next(): Promise<boolean>;

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
            case proto.vector.VectorVariant.VectorI8:
                v = c.variant(this.tmp.vectorI8)!;
                break;
            case proto.vector.VectorVariant.VectorU8:
                v = c.variant(this.tmp.vectorU8)!;
                break;
            case proto.vector.VectorVariant.VectorI16:
                v = c.variant(this.tmp.vectorI16)!;
                break;
            case proto.vector.VectorVariant.VectorU16:
                v = c.variant(this.tmp.vectorU16)!;
                break;
            case proto.vector.VectorVariant.VectorI32:
                v = c.variant(this.tmp.vectorI32)!;
                break;
            case proto.vector.VectorVariant.VectorU32:
                v = c.variant(this.tmp.vectorU32)!;
                break;
            case proto.vector.VectorVariant.VectorF32:
                v = c.variant(this.tmp.vectorF32)!;
                break;
            case proto.vector.VectorVariant.VectorF64:
                v = c.variant(this.tmp.vectorF64)!;
                break;
            case proto.vector.VectorVariant.NONE:
            case proto.vector.VectorVariant.VectorI128:
            case proto.vector.VectorVariant.VectorI64:
            case proto.vector.VectorVariant.VectorU64:
            case proto.vector.VectorVariant.VectorInterval:
            case proto.vector.VectorVariant.VectorString:
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

/// A stream of query result chunks
export class QueryResultChunkStream extends QueryResultChunkIterator {
    /// The current chunk buffer
    _currentChunkBuffer: QueryResultChunkBuffer | null;

    /// Constructor
    public constructor(connection: DuckDBConnection, resultBuffer: QueryResultBuffer) {
        super(connection, resultBuffer);
        this._currentChunkBuffer = null;
    }

    /// Get the next chunk
    public async next(): Promise<boolean> {
        let result = this._resultBuffer.root;
        if (++this._currentChunkID < result.dataChunksLength()) {
            result.dataChunks(0, this._currentChunk);
        } else {
            let chunkBuffer = await this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer.root;
            this._currentChunkBuffer = chunkBuffer;
        }
        return this._currentChunk.rowCount().low > 0;
    }
}

/// Materialized result chunks
export class MaterializedQueryResultChunks extends QueryResultChunkIterator {
    /// The current chunk buffer
    _chunkBuffers: QueryResultChunkBuffer[];
    /// The chunks
    _chunks: proto.query_result.QueryResultChunk[];

    /// Constructor
    public constructor(connection: DuckDBConnection, resultBuffer: QueryResultBuffer, chunkBuffers: QueryResultChunkBuffer[]) {
        super(connection, resultBuffer);
        this._chunkBuffers = chunkBuffers;
        this._chunks = [];
        for (let i = 0; i < this.result.dataChunksLength(); ++i) {
            this._chunks.push(this.result.dataChunks(i)!);
        }
        for (let i = 0; i < chunkBuffers.length; ++i) {
            this._chunks.push(chunkBuffers[i].root);
        }
        if (this._chunks.length == 0 || this._chunks[this._chunks.length - 1].rowCount().low == 0)  {
            this._chunks.push(new proto.query_result.QueryResultChunk());
        }
    }

    /// Restart  the chunk iterator
    public rewind() { this._currentChunkID = -1; }
    /// Get the next chunk
    public async next(): Promise<boolean> {
        this._currentChunkID = Math.min(this._currentChunkID + 1, this._chunks.length - 1);
        this._currentChunk = this._chunks[this._currentChunkID];
        return this._currentChunk.rowCount().low > 0;
    }
}

/// A query result row iterator
export class QueryResultRowIterator {
    /// The query result
    _chunkIter: QueryResultChunkIterator;
    /// The global row index
    _globalRowIndex: number;
    /// The chunk row begin
    _currentChunkBegin: number;

    /// Constructor
    protected constructor(resultChunks: QueryResultChunkIterator) {
        this._chunkIter = resultChunks;
        this._globalRowIndex = 0;
        this._currentChunkBegin = 0;
    }

    /// Iterate over a result buffer
    public static async iterate(resultChunks: QueryResultChunkIterator): Promise<QueryResultRowIterator> {
        let iter = new QueryResultRowIterator(resultChunks);
        await resultChunks.next();
        iter._currentChunkBegin = 0;
        return iter;
    }

    /// Get the chunk row
    public get currentRow() { return this._globalRowIndex - this._currentChunkBegin; }
    /// Get the current chunk
    public get currentChunk(): proto.query_result.QueryResultChunk { return this._chunkIter.currentChunk; }
    /// Get the temporary buffers
    public get tmp() { return this._chunkIter.tmp; }

    /// Get the column count
    public getColumnName(idx: number) { return this._chunkIter.result.columnNames(idx); }
    /// Is the end?
    public isEnd(): boolean { return this.currentRow >= this.currentChunk.rowCount().low; }

    /// Advance the iterator
    public async next(): Promise<boolean> {
        // Reached end?
        if (this.isEnd())
            return false;

        // Still in current chunk?
        ++this._globalRowIndex;
        if (this.currentRow < this.currentChunk.rowCount().low)
            return true;

        // Get next chunk
        await this._chunkIter.next();
        this._currentChunkBegin = this._globalRowIndex;
        let empty = this.currentChunk.rowCount().low == 0;
        return !empty;
    }

    /// Get a value
    public getValue(cid: number, v: Value): Value {
        if (cid >= this._chunkIter.columnCount) {
            throw Error("column index out of bounds");
        }
        v.sqlType = this._chunkIter.columnTypes[cid];
        let r = this.currentRow;

        // Read the vector
        let c = this.currentChunk.columns(cid, this.tmp.vector);
        if (c == null) {
            v.nullFlag = true;
            return v;
        }
        switch (c.variantType()) {
            case proto.vector.VectorVariant.NONE:
                break;
            case proto.vector.VectorVariant.VectorI8:
                c.variant(this.tmp.vectorI8);
                v.asNumber().value = this.tmp.vectorI8.values(r)!;
                v.nullFlag = this.tmp.vectorI8.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorU8:
                c.variant(this.tmp.vectorU8);
                v.asNumber().value = this.tmp.vectorU8.values(r)!;
                v.nullFlag = this.tmp.vectorU8.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorI16:
                c.variant(this.tmp.vectorI16);
                v.asNumber().value = this.tmp.vectorI16.values(r)!;
                v.nullFlag = this.tmp.vectorI16.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorU16:
                c.variant(this.tmp.vectorU16);
                v.asNumber().value = this.tmp.vectorU16.values(r)!;
                v.nullFlag = this.tmp.vectorU16.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorI32:
                c.variant(this.tmp.vectorI32);
                v.asNumber().value = this.tmp.vectorI32.values(r)!;
                v.nullFlag = this.tmp.vectorI32.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorU32:
                c.variant(this.tmp.vectorU32);
                v.asNumber().value = this.tmp.vectorU32.values(r)!;
                v.nullFlag = this.tmp.vectorU32.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorI64:
                c.variant(this.tmp.vectorI64);
                v.asLong().value = this.tmp.vectorI64.values(r)!;
                v.nullFlag = this.tmp.vectorI64.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorU64:
                c.variant(this.tmp.vectorU64);
                v.asLong().value = this.tmp.vectorU64.values(r)!;
                v.nullFlag = this.tmp.vectorU64.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorI128:
                c.variant(this.tmp.vectorI128);
                this.tmp.vectorI128.values(r, v.asI128().value)!;
                v.nullFlag = this.tmp.vectorI128.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorF32:
                c.variant(this.tmp.vectorF32);
                v.asNumber().value = this.tmp.vectorF32.values(r)!;
                v.nullFlag = this.tmp.vectorF32.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorF64:
                c.variant(this.tmp.vectorF64);
                v.asNumber().value = this.tmp.vectorF64.values(r)!;
                v.nullFlag = this.tmp.vectorF64.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorInterval:
                c.variant(this.tmp.vectorInterval);
                this.tmp.vectorInterval.values(r, v.asInterval().value)!;
                v.nullFlag = this.tmp.vectorInterval.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorString:
                c.variant(this.tmp.vectorString);
                v.asString().value = this.tmp.vectorString.values(r)!;
                v.nullFlag = this.tmp.vectorString.nullMask(r)!;
                break;
        }
        return v;
    }
}

/// Flatbuffer objects to decode flatbuffers without allocation
class VectorVariants {
    vector: proto.vector.Vector;
    vectorI8: proto.vector.VectorI8;
    vectorU8: proto.vector.VectorU8;
    vectorI16: proto.vector.VectorI16;
    vectorU16: proto.vector.VectorU16;
    vectorI32: proto.vector.VectorI32;
    vectorU32: proto.vector.VectorU32;
    vectorI64: proto.vector.VectorI64;
    vectorU64: proto.vector.VectorU64;
    vectorI128: proto.vector.VectorI128;
    vectorF32: proto.vector.VectorF32;
    vectorF64: proto.vector.VectorF64;
    vectorInterval: proto.vector.VectorInterval;
    vectorString: proto.vector.VectorString;

    /// Constructor
    constructor() {
        this.vector = new proto.vector.Vector();
        this.vectorI8 = new proto.vector.VectorI8();
        this.vectorU8 = new proto.vector.VectorU8();
        this.vectorI16 = new proto.vector.VectorI16();
        this.vectorU16 = new proto.vector.VectorU16();
        this.vectorI32 = new proto.vector.VectorI32();
        this.vectorU32 = new proto.vector.VectorU32();
        this.vectorI64 = new proto.vector.VectorI64();
        this.vectorU64 = new proto.vector.VectorU64();
        this.vectorI128 = new proto.vector.VectorI128();
        this.vectorF32 = new proto.vector.VectorF32();
        this.vectorF64 = new proto.vector.VectorF64();
        this.vectorInterval = new proto.vector.VectorInterval();
        this.vectorString = new proto.vector.VectorString();
    }
};
