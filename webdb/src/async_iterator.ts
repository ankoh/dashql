// Copyright (c) 2020 The DashQL Authors

import { ChunkIteratorBase, RowIteratorBase } from './iterator_base';
import { AsyncWebDBConnection } from './async_webdb';
import { webdb as proto } from '@dashql/proto';

/// An abstract chunk iterator
export abstract class QueryResultChunkIterator extends ChunkIteratorBase {
    /// The connection
    _connection: AsyncWebDBConnection;

    /// Constructor
    public constructor(connection: AsyncWebDBConnection, resultBuffer: proto.QueryResult) {
        super(resultBuffer);
        this._connection = connection;
    }

    /// Get the next query result chunk
    public abstract next(): Promise<boolean>;
}

/// A stream of query result chunks
export class QueryResultChunkStream extends QueryResultChunkIterator {
    /// The current chunk buffer
    _currentChunkBuffer: proto.QueryResultChunk | null;

    /// Constructor
    public constructor(connection: AsyncWebDBConnection, resultBuffer: proto.QueryResult) {
        super(connection, resultBuffer);
        this._currentChunkBuffer = null;
    }

    /// Get the next chunk
    public async next(): Promise<boolean> {
        let result = this._resultBuffer;
        if (++this._currentChunkID < result.dataChunksLength()) {
            this._currentChunk = result.dataChunks(this._currentChunkID, this._currentChunk)!;
        } else {
            let chunkBuffer = await this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
            this._currentChunkBuffer = chunkBuffer;
        }
        return this._currentChunk.rowCount().low > 0;
    }
}

/// Materialized result chunks
export class MaterializedQueryResultChunks extends QueryResultChunkIterator {
    /// The chunks
    _chunks: proto.QueryResultChunk[];

    /// Constructor
    public constructor(connection: AsyncWebDBConnection, resultBuffer: proto.QueryResult, chunks: proto.QueryResultChunk[] = []) {
        super(connection, resultBuffer);
        this._chunks = [];
        for (let i = 0; i < this.result.dataChunksLength(); ++i) {
            this._chunks.push(this.result.dataChunks(i)!);
        }
        for (let i = 0; i < chunks.length; ++i) {
            this._chunks.push(chunks[i]);
        }
        if (this._chunks.length == 0 || this._chunks[this._chunks.length - 1].rowCount().low == 0)  {
            this._chunks.push(new proto.QueryResultChunk());
        }
    }

    /// Restart the chunk iterator
    public rewind() { this._currentChunkID = -1; }
    /// Get the next chunk
    public async next(): Promise<boolean> {
        if (this._currentChunkID + 1 >= this._chunks.length) {
            return false;
        }
        ++this._currentChunkID;
        this._currentChunk = this._chunks[this._currentChunkID];
        return true;
    }
    /// The the next chunk synchronous
    public nextSync(): boolean {
        if (this._currentChunkID + 1 >= this._chunks.length) {
            return false;
        }
        ++this._currentChunkID;
        this._currentChunk = this._chunks[this._currentChunkID];
        return true;
    }
}

/// A query result row iterator
export class QueryResultRowIterator extends RowIteratorBase {
    /// Constructor
    protected constructor(chunks: QueryResultChunkIterator) {
        super(chunks);
    }
    /// Get iterator
    public get iter() { return this._chunkIter as QueryResultChunkIterator; }

    /// Iterate over a result buffer
    public static async iterate(chunks: QueryResultChunkIterator): Promise<QueryResultRowIterator> {
        let iter = new QueryResultRowIterator(chunks);
        await chunks.next();
        iter._currentChunkBegin = 0;
        return iter;
    }


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
        await this.iter.next();
        this._currentChunkBegin = this._globalRowIndex;
        let empty = this.currentChunk.rowCount().low == 0;
        return !empty;
    }

}
