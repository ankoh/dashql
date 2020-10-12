// Copyright (c) 2020 The DashQL Authors

import { DuckDBBindings } from './webapi_bindings';
import { QueryResultBuffer, QueryResultChunkBuffer } from './webapi_buffer';
import { Value } from './value';
import * as proto from '../proto';

/// A query result iterator
export class QueryResultIterator {
    /// The bindings
    _bindings: DuckDBBindings;
    /// The connection
    _connection: number;
    /// The query result
    _resultBuffer: QueryResultBuffer;
    /// The column types
    _columnTypes: proto.sql_type.SQLType[];
    /// The global row index
    _globalRowIndex: number;
    /// The chunk identifier
    _currentChunkID: number;
    /// The chunk row begin
    _currentChunkBegin: number;
    /// The chunk buffer (if any)
    _currentChunkBuffer: QueryResultChunkBuffer | null;
    /// The chunk (if any)
    _currentChunk: proto.query_result.QueryResultChunk;
    /// The temporary flatbuffer objects
    _tmp: VectorVariants;

    /// Constructor
    protected constructor(bindings: DuckDBBindings, connection: number, result: QueryResultBuffer) {
        this._bindings = bindings;
        this._connection = connection;
        this._resultBuffer = result;
        this._columnTypes = new Array<proto.sql_type.SQLType>();
        this._globalRowIndex = 0;
        this._currentChunkID = 0;
        this._currentChunkBegin = 0;
        this._currentChunkBuffer = null;
        this._currentChunk = new proto.query_result.QueryResultChunk();
        this._tmp = new VectorVariants();

        // Collect the column types
        for (let i = 0; i < result.get().columnTypesLength(); ++i) {
            let t = new proto.sql_type.SQLType();
            result.get().columnTypes(i, t);
            this.columnTypes.push(t);
        }
    }

    /// Iterate over a result buffer
    public static async iterate(bindings: DuckDBBindings, connection: number, resultBuffer: QueryResultBuffer): Promise<QueryResultIterator> {
        let iter = new QueryResultIterator(bindings, connection, resultBuffer);
        let result = resultBuffer.get()
        if (result.dataChunksLength() > 0) {
            result.dataChunks(0, iter._currentChunk);
        } else {
            let chunkBuffer = await bindings.fetchQueryResults(connection);
            iter._currentChunk = chunkBuffer.get();
            iter._currentChunkBuffer = chunkBuffer;
        }
        return iter;
    }

    /// Get the result
    public get result() { return this._resultBuffer.get(); }
    /// Get the column count
    public get columnCount() { return this._columnTypes.length; }
    /// Get the column count
    public get columnTypes() { return this._columnTypes; }
    /// Get the chunk row
    public get currentRow() { return this._globalRowIndex - this._currentChunkBegin; }
    /// Get the current chunk
    public get currentChunk(): proto.query_result.QueryResultChunk { return this._currentChunk; }

    /// Get the column count
    public getColumnName(idx: number) { return this.result.columnNames(idx); }
    /// Is the end?
    public isEnd(): boolean { return this.currentRow >= this._currentChunk.rowCount().low; }

    /// Advance the iterator
    public async next(): Promise<void> {
        // Reached end?
        if (this.isEnd())
            return;

        // Still in current chunk?
        ++this._globalRowIndex;
        if (this._currentChunk == null || this.currentRow < this._currentChunk.rowCount().low)
            return;

        // Get next chunk
        ++this._currentChunkID;
        if (this._currentChunkID < this.result.dataChunksLength()) {
            this.result.dataChunks(this._currentChunkID, this._currentChunk);
        } else {
            let result = await this._bindings.fetchQueryResults(this._connection);
            this._currentChunk = result.get();
            this._currentChunkBuffer = result;
        }
        this._currentChunkBegin = this._globalRowIndex;
    }

    /// Get a value
    public getValue(cid: number, v: Value): Value {
        if (cid >= this.columnCount) {
            throw Error("column index out of bounds");
        }
        v.sqlType = this.columnTypes[cid];
        v.value = null;
        let r = this.currentRow;

        // Read the vector
        let c = this.currentChunk.columns(cid, this._tmp.vector);
        if (c == null) {
            return v;
        }
        switch (c.variantType()) {
            case proto.vector.VectorVariant.NONE:
                break;
            case proto.vector.VectorVariant.VectorI8:
                c.variant(this._tmp.vectorI8);
                v.value = this._tmp.vectorI8.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorU8:
                c.variant(this._tmp.vectorU8);
                v.value = this._tmp.vectorU8.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorI16:
                c.variant(this._tmp.vectorI16);
                v.value = this._tmp.vectorI16.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorU16:
                c.variant(this._tmp.vectorU16);
                v.value = this._tmp.vectorU16.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorI32:
                c.variant(this._tmp.vectorI32);
                v.value = this._tmp.vectorI32.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorU32:
                c.variant(this._tmp.vectorU32);
                v.value = this._tmp.vectorU32.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorI64:
                c.variant(this._tmp.vectorI64);
                v.value = this._tmp.vectorI64.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorU64:
                c.variant(this._tmp.vectorU64);
                v.value = this._tmp.vectorU64.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorI128:
                c.variant(this._tmp.vectorI128);
                v.value = this._tmp.vectorI128.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorF32:
                c.variant(this._tmp.vectorF32);
                v.value = this._tmp.vectorF32.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorF64:
                c.variant(this._tmp.vectorF64);
                v.value = this._tmp.vectorF64.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorInterval:
                c.variant(this._tmp.vectorInterval);
                v.value = this._tmp.vectorInterval.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorString:
                c.variant(this._tmp.vectorString);
                v.value = this._tmp.vectorString.values(r)!;
                break;
        }
        return v;
    }
}

/// Flatbuffer objects to repeatedly decode vectors without allocation
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
