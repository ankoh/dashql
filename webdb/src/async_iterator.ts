// Copyright (c) 2020 The DashQL Authors

import {
    ChunkIteratorBase,
    RowIteratorBase,
    AsyncChunkIterator,
    BlockingChunkIterator,
    AsyncRowIterator,
    BlockingRowIterator
} from './iterator_base';
import { AsyncConnection } from './async_webdb';
import { webdb as proto } from '@dashql/proto';

/// A stream of query result chunks
export class QueryResultChunkStream extends ChunkIteratorBase implements AsyncChunkIterator {
    /// The connection
    _connection: AsyncConnection;
    /// The current chunk buffer
    _currentChunkBuffer: proto.QueryResultChunk | null;

    /// Constructor
    public constructor(connection: AsyncConnection, resultBuffer: proto.QueryResult) {
        super(resultBuffer);
        this._connection = connection;
        this._currentChunkBuffer = null;
    }

    /// Get the next chunk
    public async nextAsync(): Promise<boolean> {
        let result = this._resultBuffer;
        if (++this._currentChunkID < result.dataChunksLength()) {
            this._currentChunk = result.dataChunks(this._currentChunkID, this._currentChunk)!;
        } else {
            let chunkBuffer = await this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
            this._currentChunkBuffer = chunkBuffer;
        }
        return this._currentChunk.rowCount() > 0;
    }
}

/// Materialized result chunks
export class MaterializedQueryResultChunks extends ChunkIteratorBase
    implements AsyncChunkIterator, BlockingChunkIterator {
    /// The chunks
    _chunks: proto.QueryResultChunk[];

    /// Constructor
    public constructor(resultBuffer: proto.QueryResult, chunks: proto.QueryResultChunk[] = []) {
        super(resultBuffer);
        this._chunks = [];
        for (let i = 0; i < this.result.dataChunksLength(); ++i) {
            this._chunks.push(this.result.dataChunks(i)!);
        }
        for (let i = 0; i < chunks.length; ++i) {
            this._chunks.push(chunks[i]);
        }
        if (this._chunks.length == 0 || this._chunks[this._chunks.length - 1].rowCount() == 0) {
            this._chunks.push(new proto.QueryResultChunk());
        }
    }

    /// Restart the chunk iterator
    public rewind() {
        this._currentChunkID = -1;
    }
    /// Get the next chunk
    public async nextAsync(): Promise<boolean> {
        if (++this._currentChunkID >= this._chunks.length) {
            return false;
        }
        console.log(`chunk id ${this._currentChunkID} of ${this._chunks.length}`);
        this._currentChunk = this._chunks[this._currentChunkID];
        return true;
    }
    /// The the next chunk synchronous
    public nextBlocking(): boolean {
        if (this._currentChunkID + 1 >= this._chunks.length) {
            return false;
        }
        ++this._currentChunkID;
        this._currentChunk = this._chunks[this._currentChunkID];
        return true;
    }
}

/// A query result row iterator
export class QueryResultRowIterator extends RowIteratorBase implements AsyncRowIterator {
    /// Constructor
    protected constructor(chunks: AsyncChunkIterator) {
        super(chunks);
    }
    /// Get iterator
    public get iter() {
        return this._chunkIter as AsyncChunkIterator;
    }

    /// Iterate over a result buffer
    public static async iterate(chunks: AsyncChunkIterator): Promise<QueryResultRowIterator> {
        let iter = new QueryResultRowIterator(chunks);
        await chunks.nextAsync();
        iter._currentChunkBegin = 0;
        return iter;
    }

    /// Advance the iterator
    public async nextAsync(): Promise<boolean> {
        // Reached end?
        if (this.isEnd()) return false;

        // Still in current chunk?
        ++this._globalRowIndex;
        if (this.currentRow < this.currentChunk.rowCount()) return true;

        // Get next chunk
        await this.iter.nextAsync();
        this._currentChunkBegin = this._globalRowIndex;
        let empty = this.currentChunk.rowCount() == 0;
        return !empty;
    }
}
