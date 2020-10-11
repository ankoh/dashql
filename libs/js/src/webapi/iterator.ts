// Copyright (c) 2020 The DashQL Authors

import { DuckDBBindings } from './webapi_bindings';
import { QueryResultBuffer, QueryResultChunkBuffer } from './webapi_buffer';
import { Value } from './value';
import * as proto from '../proto';

/// Forward iterator
export class QueryResultIterator {
    /// The bindings
    bindings: DuckDBBindings;
    /// The connection
    connection: number;
    /// The query result
    resultBuffer: QueryResultBuffer;
    /// The global row index
    globalRowIndex: number;
    /// The chunk row begin
    chunkRowBegin: number;
    /// The chunk identifier
    chunkID: number;
    /// The chunk buffer (if any)
    chunkBuffer: QueryResultChunkBuffer | null;
    /// The chunk (if any)
    chunk: proto.query_result.QueryResultChunk | null;

    /// Constructor
    public constructor(bindings: DuckDBBindings, connection: number, result: QueryResultBuffer) {
        this.bindings = bindings;
        this.connection = connection;
        this.resultBuffer = result;
        this.globalRowIndex = 0;
        this.chunkRowBegin = 0;
        this.chunkID = 0;
        this.chunkBuffer = null;
        this.chunk = null;
    }

    /// Get the result
    protected getResult(): proto.query_result.QueryResult {
        return this.resultBuffer.get();
    }
    /// Get the column count
    public getColumnCount(): number {
        return this.resultBuffer.get().columnTypesLength();
    }
    /// Get the column count
    public getColumnType(idx: number): proto.sql_type.SQLType | null {
        return this.resultBuffer.get().columnTypes(idx);
    }
    /// Get the column count
    public getColumnName(idx: number): string {
        return this.resultBuffer.get().columnNames(idx);
    }
    /// Get the chunk row
    public getChunkRow(): number {
        return this.globalRowIndex - this.chunkRowBegin;
    }
    /// Is the end?
    public isEnd(): boolean {
        return this.chunk == null || this.getChunkRow() >= this.chunk.rowCount().low;
    }
    /// Advance the iterator
    public async next() {
        // Reached end?
        if (this.isEnd())
            return;

        // Still in current chunk?
        ++this.globalRowIndex;
        if (this.chunk == null || this.getChunkRow() < this.chunk.rowCount().low)
            return;

        // Get next chunk
        ++this.chunkID;
        if (this.chunkID < this.getResult().dataChunksLength()) {
            this.chunk = this.getResult().dataChunks(this.chunkID);
        } else {
            let result = await this.bindings.fetchQueryResults(this.connection);
            this.chunk = result.get();
            this.chunkBuffer = result;
        }
        this.chunkRowBegin = this.globalRowIndex;
    }

    /// Get a value
    public getValue(idx: number, v: Value) {
        if (this.chunk == null || idx >= this.chunk.columnsLength()) {
            return;
        }
        let column = this.chunk.columns(idx);
        let columnType = this.resultBuffer.get().columnTypes(idx);
        let chunkRow = this.getChunkRow();
        if (column == null || columnType == null) {
            return;
        }

        // Read the vector
        switch (column.variantType()) {
            case proto.vector.VectorVariant.NONE:
                break;
            case proto.vector.VectorVariant.VectorI8:
                break;
            case proto.vector.VectorVariant.VectorU8:
                break;
            case proto.vector.VectorVariant.VectorI16:
                break;
            case proto.vector.VectorVariant.VectorU16:
                break;
            case proto.vector.VectorVariant.VectorI32:
                break;
            case proto.vector.VectorVariant.VectorU32:
                break;
            case proto.vector.VectorVariant.VectorI64:
                break;
            case proto.vector.VectorVariant.VectorU64:
                break;
            case proto.vector.VectorVariant.VectorI128:
                break;
            case proto.vector.VectorVariant.VectorF32:
                break;
            case proto.vector.VectorVariant.VectorF64:
                break;
            case proto.vector.VectorVariant.VectorInterval:
                break;
            case proto.vector.VectorVariant.VectorString:
                break;
        }

        // Construct the value
        switch (columnType.typeId()) {
            case proto.sql_type.SQLTypeID.ANY:
                break;
            case proto.sql_type.SQLTypeID.INVALID:
            case proto.sql_type.SQLTypeID.UNKNOWN:
            case proto.sql_type.SQLTypeID.SQLNULL:
                break;
            case proto.sql_type.SQLTypeID.BOOLEAN:
                break;
            case proto.sql_type.SQLTypeID.TINYINT:
                break;
            case proto.sql_type.SQLTypeID.SMALLINT:
                break;
            case proto.sql_type.SQLTypeID.INTEGER:
                break;
            case proto.sql_type.SQLTypeID.BIGINT:
                break;
            case proto.sql_type.SQLTypeID.FLOAT:
                break;
            case proto.sql_type.SQLTypeID.DOUBLE:
                break;
            case proto.sql_type.SQLTypeID.CHAR:
                break;
            case proto.sql_type.SQLTypeID.VARCHAR:
                break;
            case proto.sql_type.SQLTypeID.HUGEINT:
                break;
            case proto.sql_type.SQLTypeID.DATE:
                break;
            case proto.sql_type.SQLTypeID.TIME:
                break;
            case proto.sql_type.SQLTypeID.TIMESTAMP:
                break;
            case proto.sql_type.SQLTypeID.INTERVAL:
                break;
            case proto.sql_type.SQLTypeID.BLOB:
            case proto.sql_type.SQLTypeID.DECIMAL:
            case proto.sql_type.SQLTypeID.HASH:
            case proto.sql_type.SQLTypeID.LIST:
            case proto.sql_type.SQLTypeID.POINTER:
            case proto.sql_type.SQLTypeID.STRUCT:
            case proto.sql_type.SQLTypeID.VARBINARY:
                break;
        }
    }
}
