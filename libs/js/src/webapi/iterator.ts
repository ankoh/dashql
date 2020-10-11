// Copyright (c) 2020 The DashQL Authors

import { DuckDBBindings } from './webapi_bindings';
import { QueryResultBuffer, QueryResultChunkBuffer } from './webapi_buffer';
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
    public getValue(_column: number) {
    }
}
