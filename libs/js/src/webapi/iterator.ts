// Copyright (c) 2020 The DashQL Authors

import { DuckDBBindings } from './webapi_bindings';
import { QueryResultBuffer, QueryResultChunkBuffer } from './webapi_buffer';
import { Value } from './value';
import * as proto from '../proto';

/// Flatbuffer objects to repeatedly decode vectors without allocation
class VariantObjects {
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
    tmp: VariantObjects;

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
        this.tmp = new VariantObjects();
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
        if (this._chunk == null || idx >= this._chunk.columnsLength()) {
            return;
        }
        let column = this._chunk.columns(idx, this.tmp.vector);
        let columnType = this._resultBuffer.get().columnTypes(idx, v.sqlType);
        v.value = null;
        let chunkRow = this.chunkRow;
        if (column == null || columnType == null) {
            return;
        }

        // Read the vector
        switch (column.variantType()) {
            case proto.vector.VectorVariant.NONE:
                break;
            case proto.vector.VectorVariant.VectorI8:
                column.variant(this.tmp.vectorI8);
                v.value = this.tmp.vectorI8.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorU8:
                column.variant(this.tmp.vectorU8);
                v.value = this.tmp.vectorU8.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorI16:
                column.variant(this.tmp.vectorI16);
                v.value = this.tmp.vectorI16.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorU16:
                column.variant(this.tmp.vectorU16);
                v.value = this.tmp.vectorU16.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorI32:
                column.variant(this.tmp.vectorI32);
                v.value = this.tmp.vectorI32.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorU32:
                column.variant(this.tmp.vectorU32);
                v.value = this.tmp.vectorU32.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorI64:
                column.variant(this.tmp.vectorI64);
                v.value = this.tmp.vectorI64.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorU64:
                column.variant(this.tmp.vectorU64);
                v.value = this.tmp.vectorU64.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorI128:
                column.variant(this.tmp.vectorI128);
                v.value = this.tmp.vectorI128.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorF32:
                column.variant(this.tmp.vectorF32);
                v.value = this.tmp.vectorF32.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorF64:
                column.variant(this.tmp.vectorF64);
                v.value = this.tmp.vectorF64.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorInterval:
                column.variant(this.tmp.vectorInterval);
                v.value = this.tmp.vectorInterval.values(chunkRow)!;
                break;
            case proto.vector.VectorVariant.VectorString:
                column.variant(this.tmp.vectorString);
                v.value = this.tmp.vectorString.values(chunkRow)!;
                break;
        }
    }
}
