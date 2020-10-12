// Copyright (c) 2020 The DashQL Authors

import { DuckDBBindings } from './webapi_bindings';
import { QueryResultBuffer, QueryResultChunkBuffer } from './webapi_buffer';
import { Value } from './value';
import * as proto from '../proto';

/// Forward iterator
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
    /// The chunk row begin
    _chunkRowBegin: number;
    /// The chunk identifier
    _chunkID: number;
    /// The chunk buffer (if any)
    _chunkBuffer: QueryResultChunkBuffer | null;
    /// The chunk (if any)
    _chunk: proto.query_result.QueryResultChunk | null;
    /// The temporary flatbuffer objects
    _tmp: VectorVariants;

    /// Constructor
    public constructor(bindings: DuckDBBindings, connection: number, result: QueryResultBuffer) {
        this._bindings = bindings;
        this._connection = connection;
        this._resultBuffer = result;
        this._columnTypes = new Array<proto.sql_type.SQLType>();
        this._globalRowIndex = 0;
        this._chunkRowBegin = 0;
        this._chunkID = 0;
        this._chunkBuffer = null;
        this._chunk = null;

        for (let i = 0; i < result.get().columnTypesLength(); ++i) {
            let t =  new proto.sql_type.SQLType();
            result.get().columnTypes(i, t);
            this.columnTypes.push(t);
        }
        this._tmp = new VectorVariants();
    }

    /// Get the result
    protected get result(): proto.query_result.QueryResult {
        return this._resultBuffer.get();
    }
    /// Get the column count
    public get columnCount(): number {
        return this._columnTypes.length;
    }
    /// Get the column count
    public get columnTypes(): proto.sql_type.SQLType[] {
        return this.columnTypes;
    }
    /// Get the chunk row
    public get chunkRow(): number {
        return this._globalRowIndex - this._chunkRowBegin;
    }
    /// Get the column count
    public getColumnName(idx: number): string {
        return this._resultBuffer.get().columnNames(idx);
    }
    /// Is the end?
    public isEnd(): boolean {
        return this._chunk == null || this.chunkRow >= this._chunk.rowCount().low;
    }
    /// Advance the iterator
    public async next() {
        // Reached end?
        if (this.isEnd())
            return;

        // Still in current chunk?
        ++this._globalRowIndex;
        if (this._chunk == null || this.chunkRow < this._chunk.rowCount().low)
            return;

        // Get next chunk
        ++this._chunkID;
        if (this._chunkID < this.result.dataChunksLength()) {
            this._chunk = this.result.dataChunks(this._chunkID, this._chunk);
        } else {
            let result = await this._bindings.fetchQueryResults(this._connection);
            this._chunk = result.get();
            this._chunkBuffer = result;
        }
        this._chunkRowBegin = this._globalRowIndex;
    }

    /// Get a value
    public getValue(idx: number, v: Value) {
        if (this._chunk == null || idx >= this.columnCount) {
            return;
        }
        v.sqlType = this.columnTypes[idx];
        v.value = null;
        let r = this.chunkRow;

        // Read the vector
        let column = this._chunk.columns(idx, this._tmp.vector);
        if (column == null) {
            return;
        }
        switch (column.variantType()) {
            case proto.vector.VectorVariant.NONE:
                break;
            case proto.vector.VectorVariant.VectorI8:
                column.variant(this._tmp.vectorI8);
                v.value = this._tmp.vectorI8.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorU8:
                column.variant(this._tmp.vectorU8);
                v.value = this._tmp.vectorU8.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorI16:
                column.variant(this._tmp.vectorI16);
                v.value = this._tmp.vectorI16.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorU16:
                column.variant(this._tmp.vectorU16);
                v.value = this._tmp.vectorU16.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorI32:
                column.variant(this._tmp.vectorI32);
                v.value = this._tmp.vectorI32.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorU32:
                column.variant(this._tmp.vectorU32);
                v.value = this._tmp.vectorU32.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorI64:
                column.variant(this._tmp.vectorI64);
                v.value = this._tmp.vectorI64.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorU64:
                column.variant(this._tmp.vectorU64);
                v.value = this._tmp.vectorU64.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorI128:
                column.variant(this._tmp.vectorI128);
                v.value = this._tmp.vectorI128.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorF32:
                column.variant(this._tmp.vectorF32);
                v.value = this._tmp.vectorF32.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorF64:
                column.variant(this._tmp.vectorF64);
                v.value = this._tmp.vectorF64.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorInterval:
                column.variant(this._tmp.vectorInterval);
                v.value = this._tmp.vectorInterval.values(r)!;
                break;
            case proto.vector.VectorVariant.VectorString:
                column.variant(this._tmp.vectorString);
                v.value = this._tmp.vectorString.values(r)!;
                break;
        }
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
