// Copyright (c) 2020 The DashQL Authors

import { DuckDBBindings } from './webapi_bindings';
import { QueryResultBuffer, QueryResultChunkBuffer } from './webapi_buffer';
import { Value } from './value';
import * as proto from '../proto';

/// An abstract chunk iterator
export abstract class QueryResultChunkIterator {
    /// The bindings
    _bindings: DuckDBBindings;
    /// The connection
    _connection: number;
    /// The result buffer
    _resultBuffer: QueryResultBuffer;
    /// The chunk id
    _currentChunkID: number;

    /// Constructor
    public constructor(bindings: DuckDBBindings, connection: number, resultBuffer: QueryResultBuffer) {
        this._bindings = bindings;
        this._connection = connection;
        this._resultBuffer = resultBuffer;
        this._currentChunkID = -1;
    }
    /// Get the result
    public get result() { return this._resultBuffer.root; }
    /// Get the next query result chunk
    public abstract next(): Promise<proto.query_result.QueryResultChunk>
}

/// A stream of query result chunks
export class QueryResultChunkStream extends QueryResultChunkIterator {
    /// The current chunk
    _currentChunk: proto.query_result.QueryResultChunk;
    /// The current chunk buffer
    _currentChunkBuffer: QueryResultChunkBuffer | null;

    /// Constructor
    public constructor(bindings: DuckDBBindings, connection: number, resultBuffer: QueryResultBuffer) {
        super(bindings, connection, resultBuffer);
        this._currentChunk = new proto.query_result.QueryResultChunk();
        this._currentChunkBuffer = null;
    }

    /// Get the next chunk
    public async next(): Promise<proto.query_result.QueryResultChunk> {
        let result = this._resultBuffer.root;
        if (++this._currentChunkID < result.dataChunksLength()) {
            result.dataChunks(0, this._currentChunk);
        } else {
            let chunkBuffer = await this._bindings.fetchQueryResults(this._connection);
            this._currentChunk = chunkBuffer.root;
            this._currentChunkBuffer = chunkBuffer;
        }
        return this._currentChunk;
    }
}

/// Materialized result chunks
export class MaterializedQueryResultChunks extends QueryResultChunkIterator {
    /// The current chunk buffer
    _chunkBuffers: QueryResultChunkBuffer[];
    /// The chunks
    _chunks: proto.query_result.QueryResultChunk[];

    /// Constructor
    public constructor(bindings: DuckDBBindings, connection: number, resultBuffer: QueryResultBuffer, chunkBuffers: QueryResultChunkBuffer[]) {
        super(bindings, connection, resultBuffer);
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
    public async next(): Promise<proto.query_result.QueryResultChunk> {
        this._currentChunkID = Math.min(this._currentChunkID + 1, this._chunks.length - 1);
        return this._chunks[this._currentChunkID];
    }
}

/// A query result iterator
export class QueryResultIterator {
    /// The query result
    _resultChunks: QueryResultChunkIterator;
    /// The column types
    _columnTypes: proto.sql_type.SQLType[];
    /// The global row index
    _globalRowIndex: number;
    /// The chunk row begin
    _currentChunkBegin: number;
    /// The chunk (if any)
    _currentChunk: proto.query_result.QueryResultChunk;
    /// The temporary flatbuffer objects
    _tmp: VectorVariants;

    /// Constructor
    protected constructor(resultChunks: QueryResultChunkIterator) {
        this._resultChunks = resultChunks;
        this._columnTypes = new Array<proto.sql_type.SQLType>();
        this._globalRowIndex = 0;
        this._currentChunkBegin = 0;
        this._currentChunk = new proto.query_result.QueryResultChunk();
        this._tmp = new VectorVariants();

        // Collect the column types
        for (let i = 0; i < this._resultChunks.result.columnTypesLength(); ++i) {
            let t = new proto.sql_type.SQLType();
            this._resultChunks.result.columnTypes(i, t);
            this.columnTypes.push(t);
        }
    }

    /// Iterate over a result buffer
    public static async iterate(resultChunks: QueryResultChunkIterator): Promise<QueryResultIterator> {
        let iter = new QueryResultIterator(resultChunks);
        iter._currentChunkBegin = 0;
        iter._currentChunk = await resultChunks.next();
        return iter;
    }

    /// Get the column count
    public get columnCount() { return this._columnTypes.length; }
    /// Get the column count
    public get columnTypes() { return this._columnTypes; }
    /// Get the chunk row
    public get currentRow() { return this._globalRowIndex - this._currentChunkBegin; }
    /// Get the current chunk
    public get currentChunk(): proto.query_result.QueryResultChunk { return this._currentChunk; }

    /// Get the column count
    public getColumnName(idx: number) { return this._resultChunks.result.columnNames(idx); }
    /// Is the end?
    public isEnd(): boolean { return this.currentRow >= this._currentChunk.rowCount().low; }

    /// Advance the iterator
    public async next(): Promise<boolean> {
        // Reached end?
        if (this.isEnd())
            return false;

        // Still in current chunk?
        ++this._globalRowIndex;
        if (this.currentRow < this._currentChunk.rowCount().low)
            return true;

        // Get next chunk
        this._currentChunkBegin = this._globalRowIndex;
        this._currentChunk = await this._resultChunks.next();
        let empty = this._currentChunk.rowCount().low == 0;
        return !empty;
    }

    /// Get a value
    public getValue(cid: number, v: Value): Value {
        if (cid >= this.columnCount) {
            throw Error("column index out of bounds");
        }
        v.sqlType = this.columnTypes[cid];
        let r = this.currentRow;

        // Read the vector
        let c = this.currentChunk.columns(cid, this._tmp.vector);
        if (c == null) {
            v.nullFlag = true;
            return v;
        }
        switch (c.variantType()) {
            case proto.vector.VectorVariant.NONE:
                break;
            case proto.vector.VectorVariant.VectorI8:
                c.variant(this._tmp.vectorI8);
                v.asNumber().value = this._tmp.vectorI8.values(r)!;
                v.nullFlag = this._tmp.vectorI8.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorU8:
                c.variant(this._tmp.vectorU8);
                v.asNumber().value = this._tmp.vectorU8.values(r)!;
                v.nullFlag = this._tmp.vectorU8.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorI16:
                c.variant(this._tmp.vectorI16);
                v.asNumber().value = this._tmp.vectorI16.values(r)!;
                v.nullFlag = this._tmp.vectorI16.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorU16:
                c.variant(this._tmp.vectorU16);
                v.asNumber().value = this._tmp.vectorU16.values(r)!;
                v.nullFlag = this._tmp.vectorU16.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorI32:
                c.variant(this._tmp.vectorI32);
                v.asNumber().value = this._tmp.vectorI32.values(r)!;
                v.nullFlag = this._tmp.vectorI32.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorU32:
                c.variant(this._tmp.vectorU32);
                v.asNumber().value = this._tmp.vectorU32.values(r)!;
                v.nullFlag = this._tmp.vectorU32.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorI64:
                c.variant(this._tmp.vectorI64);
                v.asLong().value = this._tmp.vectorI64.values(r)!;
                v.nullFlag = this._tmp.vectorI64.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorU64:
                c.variant(this._tmp.vectorU64);
                v.asLong().value = this._tmp.vectorU64.values(r)!;
                v.nullFlag = this._tmp.vectorU64.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorI128:
                c.variant(this._tmp.vectorI128);
                this._tmp.vectorI128.values(r, v.asI128().value)!;
                v.nullFlag = this._tmp.vectorI128.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorF32:
                c.variant(this._tmp.vectorF32);
                v.asNumber().value = this._tmp.vectorF32.values(r)!;
                v.nullFlag = this._tmp.vectorF32.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorF64:
                c.variant(this._tmp.vectorF64);
                v.asNumber().value = this._tmp.vectorF64.values(r)!;
                v.nullFlag = this._tmp.vectorF64.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorInterval:
                c.variant(this._tmp.vectorInterval);
                this._tmp.vectorInterval.values(r, v.asInterval().value)!;
                v.nullFlag = this._tmp.vectorInterval.nullMask(r)!;
                break;
            case proto.vector.VectorVariant.VectorString:
                c.variant(this._tmp.vectorString);
                v.asString().value = this._tmp.vectorString.values(r)!;
                v.nullFlag = this._tmp.vectorString.nullMask(r)!;
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
